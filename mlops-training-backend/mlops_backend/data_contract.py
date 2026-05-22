from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

USER_ACTION_COLUMNS = [
    "event_id",
    "user_id",
    "user_type",
    "property_id",
    "event_type",
    "event_timestamp",
]

EVENT_TYPE_WEIGHTS = {
    "impression": 0.2,
    "open_listing": 1.0,
    "view_images": 3.0,
    "check_amenities": 3.0,
    "check_location": 3.0,
    "save_property": 6.0,
    "contact_host": 10.0,
}

SUPPORTED_EVENT_TYPES = set(EVENT_TYPE_WEIGHTS)


def canonicalise_user_actions(events: pd.DataFrame, *, source: str) -> pd.DataFrame:
    """Return events in the same shape as Supabase public.user_action."""
    if events.empty:
        return pd.DataFrame(columns=USER_ACTION_COLUMNS + ["source"])

    canonical = events.copy()
    missing_core = [col for col in ["user_id", "property_id", "event_type"] if col not in canonical.columns]
    if missing_core:
        raise ValueError(f"Events from {source} are missing required columns: {missing_core}")

    if "event_id" not in canonical.columns:
        canonical["event_id"] = [f"{source}_{i}" for i in range(len(canonical))]
    if "user_type" not in canonical.columns:
        canonical["user_type"] = None
    if "event_timestamp" not in canonical.columns:
        canonical["event_timestamp"] = pd.Timestamp.utcnow().isoformat()

    canonical["event_type"] = canonical["event_type"].astype(str)
    canonical = canonical[canonical["event_type"].isin(SUPPORTED_EVENT_TYPES)].copy()

    canonical["user_id"] = canonical["user_id"].astype(str)
    canonical["user_type"] = canonical["user_type"].fillna("unknown").astype(str)
    canonical["property_id"] = pd.to_numeric(canonical["property_id"], errors="coerce")
    canonical = canonical.dropna(subset=["property_id"]).copy()
    canonical["property_id"] = canonical["property_id"].astype("int64")
    canonical["event_timestamp"] = pd.to_datetime(
        canonical["event_timestamp"],
        errors="coerce",
        utc=True,
    )
    canonical["event_timestamp"] = canonical["event_timestamp"].fillna(pd.Timestamp.now(tz="UTC"))
    canonical["event_timestamp"] = canonical["event_timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    canonical["event_id"] = canonical["event_id"].astype(str)
    canonical["source"] = source

    return canonical[USER_ACTION_COLUMNS + ["source"]].reset_index(drop=True)


def load_synthetic_actions(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Synthetic events file does not exist: {path}")
    raw = pd.read_csv(path)
    return canonicalise_user_actions(raw, source="synthetic")


def add_training_event_features(actions: pd.DataFrame) -> pd.DataFrame:
    enriched = actions.copy()
    enriched["event_timestamp_dt"] = pd.to_datetime(
        enriched["event_timestamp"],
        errors="coerce",
        utc=True,
    )
    reference_time = enriched["event_timestamp_dt"].max()
    if pd.isna(reference_time):
        reference_time = pd.Timestamp.now(tz="UTC")

    age_seconds = (reference_time - enriched["event_timestamp_dt"]).dt.total_seconds()
    enriched["event_age_days"] = age_seconds.fillna(0).clip(lower=0) / 86400
    enriched["event_weight"] = enriched["event_type"].map(EVENT_TYPE_WEIGHTS).fillna(0.0)
    enriched["recency_weight"] = np.exp(-enriched["event_age_days"] / 90.0)
    enriched["final_event_weight"] = enriched["event_weight"] * enriched["recency_weight"]
    enriched["strong_interaction"] = enriched["event_type"].isin(
        {"save_property", "contact_host"},
    ).astype(int)
    return enriched
