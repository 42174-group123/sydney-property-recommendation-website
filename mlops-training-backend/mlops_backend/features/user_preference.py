from __future__ import annotations

import numpy as np
import pandas as pd

from ..data_contract import add_training_event_features
from .common import (
    cap_and_normalize,
    clean_price,
    compute_amenities_weight,
    ensure_columns,
    numeric_from_text,
    privacy_type,
    property_group,
    review_rating_to_norm,
    safe_numeric,
)

PREFERENCE_LISTING_REQUIRED_COLUMNS = [
    "id",
    "property_type",
    "room_type",
    "accommodates",
    "bathrooms",
    "bedrooms",
    "beds",
    "price",
    "amenities",
    "minimum_nights",
    "review_scores_rating",
]

PREFERENCE_NUMERIC_FEATURES = [
    "property_price_norm",
    "property_accommodates_norm",
    "property_bathrooms_norm",
    "property_bedrooms_norm",
    "property_beds_norm",
    "property_minimum_nights_norm",
    "property_amenities_weight_norm",
    "property_review_scores_rating_norm",
    "privacy_type",
    "user_avg_price",
    "user_avg_accommodates",
    "user_avg_bathrooms",
    "user_avg_bedrooms",
    "user_avg_beds",
    "user_avg_minimum_nights",
    "user_avg_amenities",
    "user_avg_rating",
    "user_total_events",
    "user_strong_events",
    "user_strong_interaction_rate",
    "user_avg_final_event_weight",
    "user_max_final_event_weight",
    "user_days_since_last_event",
]

PREFERENCE_CATEGORICAL_FEATURES = [
    "user_type",
    "property_group",
]

PREFERENCE_TARGET_COLUMN = "preference_score"


def build_listing_features(listings_raw: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    listings = ensure_columns(listings_raw, PREFERENCE_LISTING_REQUIRED_COLUMNS)
    df = listings[PREFERENCE_LISTING_REQUIRED_COLUMNS].copy()

    df["property_id"] = pd.to_numeric(df["id"], errors="coerce")
    df = df.dropna(subset=["property_id"]).copy()
    df["property_id"] = df["property_id"].astype("int64")

    df["price_clean"] = df["price"].apply(clean_price)
    df["price_clean"] = safe_numeric(df["price_clean"])
    df["price_norm"] = cap_and_normalize(df["price_clean"])

    for col in ["accommodates", "bathrooms", "bedrooms", "beds", "minimum_nights"]:
        numeric = df[col].apply(numeric_from_text) if df[col].dtype == object else df[col]
        df[f"{col}_filled"] = safe_numeric(numeric)
        df[f"{col}_norm"] = cap_and_normalize(df[f"{col}_filled"])

    rating_source = df["review_scores_rating"]
    if "review_scores_rating_final" in listings_raw.columns:
        rating_source = listings_raw.loc[df.index, "review_scores_rating_final"]
    df["review_scores_rating_norm"] = review_rating_to_norm(rating_source)
    df["review_scores_rating_norm"] = df["review_scores_rating_norm"].fillna(
        df["review_scores_rating_norm"].median(),
    )
    df["review_scores_rating_norm"] = df["review_scores_rating_norm"].fillna(0.5)

    df["privacy_type"] = df["property_type"].apply(privacy_type)
    df["property_group"] = df["property_type"].apply(property_group)
    df["amenities_weight"] = df["amenities"].apply(compute_amenities_weight)
    df["amenities_weight_norm"] = cap_and_normalize(df["amenities_weight"])

    model_features = df[
        [
            "property_id",
            "privacy_type",
            "property_group",
            "price_norm",
            "accommodates_norm",
            "bathrooms_norm",
            "bedrooms_norm",
            "beds_norm",
            "minimum_nights_norm",
            "amenities_weight_norm",
            "review_scores_rating_norm",
        ]
    ].rename(
        columns={
            "price_norm": "property_price_norm",
            "accommodates_norm": "property_accommodates_norm",
            "bathrooms_norm": "property_bathrooms_norm",
            "bedrooms_norm": "property_bedrooms_norm",
            "beds_norm": "property_beds_norm",
            "minimum_nights_norm": "property_minimum_nights_norm",
            "amenities_weight_norm": "property_amenities_weight_norm",
            "review_scores_rating_norm": "property_review_scores_rating_norm",
        },
    )

    return df, model_features


def build_user_preference_dataset(
    listings_raw: pd.DataFrame,
    actions_raw: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    _, listing_features = build_listing_features(listings_raw)

    if actions_raw.empty:
        raise ValueError("No user_action rows available for user preference training.")

    actions = add_training_event_features(actions_raw)
    actions["property_id"] = pd.to_numeric(actions["property_id"], errors="coerce")
    actions = actions.dropna(subset=["property_id"]).copy()
    actions["property_id"] = actions["property_id"].astype("int64")
    actions["user_type"] = actions["user_type"].fillna("unknown").astype(str)

    event_property = actions.merge(listing_features, on="property_id", how="inner")
    if event_property.empty:
        raise ValueError("No user_action rows could be joined to listings by property_id.")

    user_features = event_property.groupby("user_id").agg(
        user_type=("user_type", lambda s: s.mode().iloc[0] if not s.mode().empty else "unknown"),
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
    ).reset_index()

    user_features["user_strong_interaction_rate"] = (
        user_features["user_strong_events"] / user_features["user_total_events"].clip(lower=1)
    )

    user_property = event_property.groupby(["user_id", "property_id"]).agg(
        interaction_weight_sum=("final_event_weight", "sum"),
        interaction_count=("event_id", "count"),
        strongest_event=("event_weight", "max"),
    ).reset_index()

    user_property[PREFERENCE_TARGET_COLUMN] = (
        1.0 - np.exp(-(user_property["interaction_weight_sum"] + user_property["strongest_event"]) / 6.0)
    ).clip(0.0, 1.0)

    dataset = user_property.merge(user_features, on="user_id", how="left")
    dataset = dataset.merge(listing_features, on="property_id", how="left")
    dataset = dataset.dropna(subset=PREFERENCE_NUMERIC_FEATURES + [PREFERENCE_TARGET_COLUMN]).copy()

    for col in PREFERENCE_CATEGORICAL_FEATURES:
        dataset[col] = dataset[col].fillna("unknown").astype(str)

    return dataset, user_features, listing_features


def feature_schema() -> dict[str, list[str] | str]:
    return {
        "numeric_features": PREFERENCE_NUMERIC_FEATURES,
        "categorical_features": PREFERENCE_CATEGORICAL_FEATURES,
        "target_col": PREFERENCE_TARGET_COLUMN,
    }

