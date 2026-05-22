from __future__ import annotations

import http.client
import json
import math
import ssl
import threading
import time
from typing import Any
from urllib.parse import urlencode, urlsplit
from uuid import UUID

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from .config import Settings
from .data_contract import add_training_event_features, canonicalise_user_actions
from .features.common import norm_to_review_rating, numeric_from_text, review_rating_to_norm
from .features.review_rating import (
    REVIEW_FEATURE_COLUMNS,
    REVIEW_REQUIRED_COLUMNS,
    REVIEW_TARGET_COLUMN,
    build_review_dataset,
)
from .features.user_preference import (
    PREFERENCE_CATEGORICAL_FEATURES,
    PREFERENCE_LISTING_REQUIRED_COLUMNS,
    PREFERENCE_NUMERIC_FEATURES,
    build_listing_features,
)
from .model_registry import ModelRegistry
from .supabase_io import fetch_table


class RankingFilters(BaseModel):
    min_accommodates: int | None = None
    min_bathrooms: float | None = None
    min_bedrooms: float | None = None
    min_beds: float | None = None
    min_price: float | None = None
    max_price: float | None = None
    min_nights: int | None = None
    instant_bookable: bool | None = None
    neighbourhood: str | None = None


class RankingRequest(BaseModel):
    user_id: str | None = None
    offset: int = Field(default=0, ge=0, le=100000)
    limit: int = Field(default=20, ge=1, le=100)
    listing_ids: list[int | str] | None = Field(default=None, max_length=500)
    filters: RankingFilters = Field(default_factory=RankingFilters)


class RankedListing(BaseModel):
    id: str
    name: str | None = None
    picture_url: str | None = None
    host_picture_url: str | None = None
    price: str | None = None
    match_score: float
    combined_score: float
    user_preference_score: float
    review_quality_score: float
    review_scores_rating_final: float
    review_score_source: str


class RankingResponse(BaseModel):
    items: list[RankedListing]
    nextOffset: int
    total: int
    model_source: str


def _clean_json_value(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    return value


def _numeric_series(series: pd.Series) -> pd.Series:
    if not pd.api.types.is_numeric_dtype(series):
        return series.apply(numeric_from_text)
    return pd.to_numeric(series, errors="coerce")


def _is_uuid(value: str) -> bool:
    try:
        UUID(str(value))
    except (TypeError, ValueError):
        return False
    return True


class RankingService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.registry = ModelRegistry(settings)
        self._cache_lock = threading.Lock()
        self._ranking_cache_lock = threading.Lock()
        self._ranking_compute_lock = threading.Lock()
        self._user_context_cache_lock = threading.Lock()
        self._listings_cache: tuple[float, pd.DataFrame] | None = None
        self._ranking_cache: dict[str, tuple[float, pd.DataFrame, str]] = {}
        self._user_context_cache: dict[str, tuple[float, pd.DataFrame, str]] = {}
        self._user_context_refreshing: set[str] = set()

    def rank(self, request: RankingRequest) -> RankingResponse:
        cache_key = self._ranking_cache_key(request)
        cached = self._get_cached_ranking(cache_key)
        if cached is not None:
            result, model_source = cached
            return self._ranking_response(result, request, model_source)

        with self._ranking_compute_lock:
            cached = self._get_cached_ranking(cache_key)
            if cached is not None:
                result, model_source = cached
                return self._ranking_response(result, request, model_source)

            result = self._compute_ranking(request)
            model_source = self._model_source()
            self._set_cached_ranking(cache_key, result, model_source)
            return self._ranking_response(result, request, model_source)

    def _compute_ranking(self, request: RankingRequest) -> pd.DataFrame:
        listings = self._get_listings()
        filtered = self._apply_filters(listings, request.filters)
        if request.listing_ids:
            requested_ids = {int(listing_id) for listing_id in request.listing_ids}
            listing_id_series = pd.to_numeric(filtered["id"], errors="coerce")
            filtered = filtered[listing_id_series.isin(requested_ids)].copy()
        filtered = filtered.sort_values("id").head(self.settings.max_ranking_candidates).copy()
        if filtered.empty:
            return pd.DataFrame()

        candidate_ids = pd.to_numeric(filtered["id"], errors="coerce").dropna().astype("int64")
        user_actions, user_type = self._fetch_user_context(request.user_id)

        feature_ids = set(candidate_ids.tolist())
        if not user_actions.empty and "property_id" in user_actions:
            action_ids = pd.to_numeric(user_actions["property_id"], errors="coerce").dropna().astype("int64")
            feature_ids.update(action_ids.tolist())

        listing_id_series = pd.to_numeric(listings["id"], errors="coerce")
        feature_listings = listings[listing_id_series.isin(feature_ids)].copy()
        enriched_features = self._add_review_quality(feature_listings)
        listing_features = self._listing_features(enriched_features)

        candidate_features = listing_features[listing_features["property_id"].isin(candidate_ids)].copy()
        if candidate_features.empty:
            return pd.DataFrame()

        user_features = self._build_user_features(listing_features, user_actions, user_type)
        scoring_frame = self._build_preference_input(candidate_features, user_features)

        preference_payload = self.registry.preference_model()
        preference_model = preference_payload["model"]
        preference_scores = np.clip(preference_model.predict(scoring_frame[PREFERENCE_NUMERIC_FEATURES + PREFERENCE_CATEGORICAL_FEATURES]), 0.0, 1.0)
        scored = candidate_features[["property_id"]].copy()
        scored["user_preference_score"] = preference_scores

        review_cols = enriched_features[
            [
                "id",
                "review_quality_score",
                "review_scores_rating_final",
                "review_score_source",
            ]
        ].rename(columns={"id": "property_id"})
        scored = scored.merge(review_cols, on="property_id", how="left")
        scored["review_quality_score"] = pd.to_numeric(scored["review_quality_score"], errors="coerce").fillna(0.5)

        weight_total = self.settings.preference_score_weight + self.settings.review_score_weight
        preference_weight = self.settings.preference_score_weight / weight_total if weight_total else 0.6
        review_weight = self.settings.review_score_weight / weight_total if weight_total else 0.4
        scored["combined_score"] = (
            preference_weight * scored["user_preference_score"]
            + review_weight * scored["review_quality_score"]
        ).clip(0.0, 1.0)
        scored["match_score"] = self._score_0_to_10(scored["combined_score"])

        card_cols = filtered[["id", "name", "picture_url", "host_picture_url", "price"]].copy()
        card_cols["property_id"] = pd.to_numeric(card_cols["id"], errors="coerce").astype("Int64")
        result = card_cols.merge(scored, on="property_id", how="inner")
        result = result.sort_values(["combined_score", "property_id"], ascending=[False, True]).reset_index(drop=True)
        return result

    def _ranking_response(
        self,
        result: pd.DataFrame,
        request: RankingRequest,
        model_source: str,
    ) -> RankingResponse:
        total = len(result)
        page = result.iloc[request.offset : request.offset + request.limit]
        items = [
            RankedListing(
                id=str(row["id"]),
                name=_clean_json_value(row.get("name")),
                picture_url=_clean_json_value(row.get("picture_url")),
                host_picture_url=_clean_json_value(row.get("host_picture_url")),
                price=_clean_json_value(row.get("price")),
                match_score=round(float(row["match_score"]), 1),
                combined_score=round(float(row["combined_score"]), 6),
                user_preference_score=round(float(row["user_preference_score"]), 6),
                review_quality_score=round(float(row["review_quality_score"]), 6),
                review_scores_rating_final=round(float(row["review_scores_rating_final"]), 3),
                review_score_source=str(row["review_score_source"]),
            )
            for _, row in page.iterrows()
        ]
        return RankingResponse(
            items=items,
            nextOffset=request.offset + len(items),
            total=total,
            model_source=model_source,
        )

    def _ranking_cache_key(self, request: RankingRequest) -> str:
        filters = (
            request.filters.model_dump()
            if hasattr(request.filters, "model_dump")
            else request.filters.dict()
        )
        filter_items = tuple(sorted(filters.items()))
        listing_ids = tuple(int(listing_id) for listing_id in request.listing_ids or [])
        return repr((request.user_id or "", listing_ids, filter_items))

    def _get_cached_ranking(self, key: str) -> tuple[pd.DataFrame, str] | None:
        now = time.monotonic()
        with self._ranking_cache_lock:
            cached = self._ranking_cache.get(key)
            if cached is None:
                return None
            cached_at, result, model_source = cached
            if now - cached_at >= self.settings.ranking_listing_cache_seconds:
                self._ranking_cache.pop(key, None)
                return None
            return result.copy(), model_source

    def _set_cached_ranking(self, key: str, result: pd.DataFrame, model_source: str) -> None:
        now = time.monotonic()
        with self._ranking_cache_lock:
            self._ranking_cache[key] = (now, result.copy(), model_source)

    def _model_source(self) -> str:
        return self.registry.source_summary()

    def _get_listings(self) -> pd.DataFrame:
        now = time.monotonic()
        with self._cache_lock:
            if self._listings_cache is not None:
                cached_at, listings = self._listings_cache
                if now - cached_at < self.settings.ranking_listing_cache_seconds:
                    return listings.copy()
            snapshot_path = self.settings.listings_snapshot_local_path
            snapshot_path = snapshot_path if snapshot_path.is_absolute() else self.settings.workspace_dir / snapshot_path
            if self.settings.ranking_prefer_local_snapshot:
                if not snapshot_path.exists():
                    raise FileNotFoundError(f"Listings snapshot not found: {snapshot_path}")
                listings = pd.read_csv(snapshot_path, low_memory=False)
                self._listings_cache = (now, listings.copy())
                return listings
            try:
                listing_columns = [
                    "name",
                    "picture_url",
                    "host_picture_url",
                    "neighbourhood_cleansed",
                    "instant_bookable",
                    *REVIEW_REQUIRED_COLUMNS,
                    *PREFERENCE_LISTING_REQUIRED_COLUMNS,
                ]
                select_columns = ",".join(dict.fromkeys(listing_columns))
                listings = fetch_table(self.settings, "listings", order_by="id", columns=select_columns)
            except Exception as exc:
                if not snapshot_path.exists():
                    raise
                print(f"Supabase listings fetch failed; using local snapshot {snapshot_path}: {exc}")
                listings = pd.read_csv(snapshot_path, low_memory=False)
            self._listings_cache = (now, listings.copy())
            return listings

    def _apply_filters(self, listings: pd.DataFrame, filters: RankingFilters) -> pd.DataFrame:
        df = listings.copy()
        mask = pd.Series(True, index=df.index)
        if filters.min_accommodates is not None and "accommodates" in df:
            mask &= pd.to_numeric(df["accommodates"], errors="coerce") >= filters.min_accommodates
        if filters.min_bathrooms is not None and "bathrooms" in df:
            mask &= _numeric_series(df["bathrooms"]) >= filters.min_bathrooms
        if filters.min_bedrooms is not None and "bedrooms" in df:
            mask &= _numeric_series(df["bedrooms"]) >= filters.min_bedrooms
        if filters.min_beds is not None and "beds" in df:
            mask &= _numeric_series(df["beds"]) >= filters.min_beds
        if filters.min_price is not None and "price" in df:
            mask &= _numeric_series(df["price"]) >= filters.min_price
        if filters.max_price is not None and "price" in df:
            mask &= _numeric_series(df["price"]) <= filters.max_price
        if filters.min_nights is not None and "minimum_nights" in df:
            mask &= pd.to_numeric(df["minimum_nights"], errors="coerce") >= filters.min_nights
        if filters.instant_bookable is True and "instant_bookable" in df:
            mask &= df["instant_bookable"].astype(str).str.lower().eq("t")
        if filters.neighbourhood and "neighbourhood_cleansed" in df:
            mask &= df["neighbourhood_cleansed"].astype(str).str.lower().eq(filters.neighbourhood.lower())
        return df[mask].copy()

    def _add_review_quality(self, listings: pd.DataFrame) -> pd.DataFrame:
        review_payload = self.registry.review_model()
        review_model = review_payload["model"]
        dataset = build_review_dataset(listings)
        final_norm = dataset[REVIEW_TARGET_COLUMN].copy()
        source = pd.Series("real", index=dataset.index)
        missing_mask = dataset["has_real_rating"] == 0
        source.loc[missing_mask] = "fallback"

        if missing_mask.any():
            predictions = np.clip(review_model.predict(dataset.loc[missing_mask, REVIEW_FEATURE_COLUMNS]), 0.0, 1.0)
            final_norm.loc[missing_mask] = predictions
            source.loc[missing_mask] = "predicted"

        final_norm = final_norm.fillna(0.5).clip(0.0, 1.0)
        enriched = listings.copy()
        valid_listing_ids = dataset["listing_id"].notna()
        valid_dataset = dataset.loc[valid_listing_ids].copy()
        valid_final_norm = final_norm.loc[valid_listing_ids]
        valid_source = source.loc[valid_listing_ids]
        mapping = pd.DataFrame(
            {
                "id": valid_dataset["listing_id"].astype("int64"),
                "review_quality_score": valid_final_norm,
                "review_scores_rating_final": norm_to_review_rating(valid_final_norm),
                "review_score_source": valid_source,
            },
        )
        return enriched.merge(mapping, on="id", how="left")

    def _listing_features(self, enriched_listings: pd.DataFrame) -> pd.DataFrame:
        _, listing_features = build_listing_features(enriched_listings)
        return listing_features

    def _fetch_user_context(self, user_id: str | None) -> tuple[pd.DataFrame, str]:
        if not user_id or not self.settings.ranking_fetch_user_actions:
            return pd.DataFrame(), "unknown"
        if not _is_uuid(user_id):
            return pd.DataFrame(), "unknown"
        if not self.settings.supabase_url or not self.settings.supabase_service_role_key:
            return pd.DataFrame(), "unknown"

        now = time.monotonic()
        ttl = max(1, self.settings.ranking_user_action_cache_seconds)
        cached_context: tuple[pd.DataFrame, str] | None = None
        with self._user_context_cache_lock:
            cached = self._user_context_cache.get(user_id)
            if cached is not None:
                cached_at, actions, user_type = cached
                cached_context = (actions.copy(), user_type)
                if now - cached_at < ttl:
                    return cached_context

        self._schedule_user_context_refresh(user_id)
        return cached_context if cached_context is not None else (pd.DataFrame(), "unknown")

    def _schedule_user_context_refresh(self, user_id: str) -> None:
        with self._user_context_cache_lock:
            if user_id in self._user_context_refreshing:
                return
            self._user_context_refreshing.add(user_id)
        thread = threading.Thread(target=self._refresh_user_context, args=(user_id,), daemon=True)
        thread.start()

    def _refresh_user_context(self, user_id: str) -> None:
        actions: pd.DataFrame | None = None
        user_type: str | None = None
        try:
            actions = self._fetch_user_actions_from_supabase_rest(user_id)
        except Exception as exc:
            print(f"Supabase user_action refresh failed; using cached/default user features: {exc}")
        try:
            user_type = self._fetch_user_type_from_supabase_rest(user_id)
        except Exception as exc:
            print(f"Supabase user_type refresh failed; using cached/default user features: {exc}")
        finally:
            with self._user_context_cache_lock:
                existing = self._user_context_cache.get(user_id)
                if actions is None:
                    actions = existing[1].copy() if existing is not None else pd.DataFrame()
                if user_type is None:
                    user_type = existing[2] if existing is not None else "unknown"
                self._user_context_cache[user_id] = (time.monotonic(), actions.copy(), user_type)
                self._user_context_refreshing.discard(user_id)

    def _fetch_user_actions_from_supabase_rest(self, user_id: str) -> pd.DataFrame:
        rows = self._supabase_rest_get(
            "user_action",
            {
                "select": "*",
                "user_id": f"eq.{user_id}",
                "order": "event_timestamp.asc",
                "limit": "5000",
            },
        )
        raw = pd.DataFrame(rows or [])
        if raw.empty:
            return raw
        return canonicalise_user_actions(raw, source="supabase")

    def _fetch_user_type_from_supabase_rest(self, user_id: str) -> str:
        rows = self._supabase_rest_get(
            "hosts",
            {
                "select": "user_type",
                "user_id": f"eq.{user_id}",
                "limit": "1",
            },
        )
        if not rows:
            return "unknown"
        return str((rows[0] or {}).get("user_type") or "unknown")

    def _supabase_rest_get(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        base_url = (self.settings.supabase_url or "").rstrip("/")
        key = self.settings.supabase_service_role_key or ""
        parsed = urlsplit(base_url)
        if parsed.scheme != "https":
            raise ValueError(f"Supabase REST requests require https, got {parsed.scheme!r}")

        query = urlencode(params)
        path_prefix = parsed.path.rstrip("/")
        path = f"{path_prefix}/rest/v1/{table}?{query}"
        connection = http.client.HTTPSConnection(
            parsed.netloc,
            timeout=self.settings.ranking_user_action_timeout_seconds,
            context=self._ssl_context(),
        )
        try:
            connection.request(
                "GET",
                path,
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Accept": "application/json",
                },
            )
            response = connection.getresponse()
            body = response.read()
        finally:
            connection.close()

        if response.status < 200 or response.status >= 300:
            detail = body.decode("utf-8", errors="replace")[:300]
            raise RuntimeError(f"Supabase REST {table} request failed: {response.status} {response.reason}: {detail}")
        data = json.loads(body.decode("utf-8")) if body else []
        return data if isinstance(data, list) else []

    def _ssl_context(self) -> ssl.SSLContext:
        try:
            import certifi

            with open(certifi.where(), encoding="utf-8") as cert_file:
                return ssl.create_default_context(cadata=cert_file.read())
        except Exception:
            return ssl.create_default_context()

    def _build_user_features(
        self,
        all_listing_features: pd.DataFrame,
        actions: pd.DataFrame,
        fallback_user_type: str,
    ) -> pd.DataFrame:
        if not actions.empty:
            event_features = add_training_event_features(actions)
            event_features["property_id"] = pd.to_numeric(event_features["property_id"], errors="coerce")
            event_features = event_features.dropna(subset=["property_id"]).copy()
            event_features["property_id"] = event_features["property_id"].astype("int64")
            event_property = event_features.merge(all_listing_features, on="property_id", how="inner")
            if not event_property.empty:
                user_features = event_property.groupby("user_id").agg(
                    user_type=("user_type", lambda s: s.mode().iloc[0] if not s.mode().empty else fallback_user_type),
                    user_avg_price=("property_price_norm", "mean"),
                    user_avg_accommodates=("property_accommodates_norm", "mean"),
                    user_avg_bathrooms=("property_bathrooms_norm", "mean"),
                    user_avg_bedrooms=("property_bedrooms_norm", "mean"),
                    user_avg_beds=("property_beds_norm", "mean"),
                    user_avg_minimum_nights=("property_minimum_nights_norm", "mean"),
                    user_avg_amenities=("property_amenities_weight_norm", "mean"),
                    user_avg_rating=("property_review_scores_rating_norm", "mean"),
                    user_total_events=("event_id", "count"),
                    user_strong_events=("strong_interaction", "sum"),
                    user_avg_final_event_weight=("final_event_weight", "mean"),
                    user_max_final_event_weight=("final_event_weight", "max"),
                    user_days_since_last_event=("event_age_days", "min"),
                ).reset_index(drop=True)
                user_features["user_strong_interaction_rate"] = (
                    user_features["user_strong_events"] / user_features["user_total_events"].clip(lower=1)
                )
                return user_features.head(1)

        return self._default_user_features(all_listing_features, fallback_user_type)

    def _default_user_features(self, listing_features: pd.DataFrame, fallback_user_type: str) -> pd.DataFrame:
        def mean_or_half(col: str) -> float:
            value = pd.to_numeric(listing_features[col], errors="coerce").mean()
            return 0.5 if pd.isna(value) else float(value)

        return pd.DataFrame(
            [
                {
                    "user_type": fallback_user_type or "unknown",
                    "user_avg_price": mean_or_half("property_price_norm"),
                    "user_avg_accommodates": mean_or_half("property_accommodates_norm"),
                    "user_avg_bathrooms": mean_or_half("property_bathrooms_norm"),
                    "user_avg_bedrooms": mean_or_half("property_bedrooms_norm"),
                    "user_avg_beds": mean_or_half("property_beds_norm"),
                    "user_avg_minimum_nights": mean_or_half("property_minimum_nights_norm"),
                    "user_avg_amenities": mean_or_half("property_amenities_weight_norm"),
                    "user_avg_rating": mean_or_half("property_review_scores_rating_norm"),
                    "user_total_events": 0.0,
                    "user_strong_events": 0.0,
                    "user_strong_interaction_rate": 0.0,
                    "user_avg_final_event_weight": 0.0,
                    "user_max_final_event_weight": 0.0,
                    "user_days_since_last_event": 365.0,
                },
            ],
        )

    def _build_preference_input(self, candidate_features: pd.DataFrame, user_features: pd.DataFrame) -> pd.DataFrame:
        left = candidate_features.copy()
        right = user_features.copy()
        left["_join_key"] = 1
        right["_join_key"] = 1
        scoring = left.merge(right, on="_join_key", how="left").drop(columns=["_join_key"])
        for col in PREFERENCE_NUMERIC_FEATURES:
            if col not in scoring:
                scoring[col] = 0.5
            scoring[col] = pd.to_numeric(scoring[col], errors="coerce").fillna(0.5)
        for col in PREFERENCE_CATEGORICAL_FEATURES:
            if col not in scoring:
                scoring[col] = "unknown"
            scoring[col] = scoring[col].fillna("unknown").astype(str)
        return scoring

    def _score_0_to_10(self, values: pd.Series) -> pd.Series:
        numeric = pd.to_numeric(values, errors="coerce").fillna(0.0)
        min_val = float(numeric.min())
        max_val = float(numeric.max())
        if math.isclose(min_val, max_val):
            return (numeric.clip(0.0, 1.0) * 10.0).clip(0.0, 10.0)
        return ((numeric - min_val) / (max_val - min_val) * 10.0).clip(0.0, 10.0)
