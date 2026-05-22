from __future__ import annotations

import numpy as np
import pandas as pd

from .common import (
    cap_and_normalize,
    clean_price,
    compute_amenities_weight,
    ensure_columns,
    numeric_from_text,
    percentage_to_decimal,
    privacy_type,
    property_group,
    review_rating_to_norm,
    safe_numeric,
)

REVIEW_REQUIRED_COLUMNS = [
    "id",
    "property_type",
    "accommodates",
    "bathrooms",
    "bedrooms",
    "beds",
    "price",
    "amenities",
    "minimum_nights",
    "availability_365",
    "host_is_superhost",
    "host_response_time",
    "host_response_rate",
    "host_acceptance_rate",
    "host_identity_verified",
    "review_scores_rating",
    "number_of_reviews",
    "number_of_reviews_ltm",
    "reviews_per_month",
]

REVIEW_FEATURE_COLUMNS = [
    "privacy_type",
    "is_apartment",
    "is_house",
    "is_nature",
    "is_unique",
    "is_hotel",
    "accommodates_norm",
    "bathrooms_norm",
    "bedrooms_norm",
    "beds_norm",
    "price_norm",
    "price_originally_empty",
    "amenities_weight_norm",
    "minimum_nights_norm",
    "availability_score",
    "host_response_rate_filled",
    "host_acceptance_rate_filled",
    "host_response_time_filled",
    "host_is_superhost_filled",
    "host_identity_verified_filled",
]

REVIEW_TARGET_COLUMN = "review_scores_rating_norm"


def build_review_dataset(listings_raw: pd.DataFrame) -> pd.DataFrame:
    listings = ensure_columns(listings_raw, REVIEW_REQUIRED_COLUMNS)
    df = listings[REVIEW_REQUIRED_COLUMNS].copy()

    df["listing_id"] = pd.to_numeric(df["id"], errors="coerce")
    df["price_originally_empty"] = df["price"].isna().astype(int)
    df["price_clean"] = df["price"].apply(clean_price)
    df["price_clean"] = safe_numeric(df["price_clean"])
    df["price_norm"] = cap_and_normalize(np.log1p(df["price_clean"]))

    for col in ["accommodates", "bathrooms", "bedrooms", "beds"]:
        numeric = df[col].apply(numeric_from_text) if df[col].dtype == object else df[col]
        df[f"{col}_filled"] = safe_numeric(numeric)
        df[f"{col}_norm"] = cap_and_normalize(df[f"{col}_filled"])

    df["minimum_nights_filled"] = safe_numeric(df["minimum_nights"])
    min_nights_log = np.log1p(df["minimum_nights_filled"])
    df["minimum_nights_inverse_log"] = np.where(min_nights_log > 0, 1.0 / min_nights_log, np.nan)
    df["minimum_nights_norm"] = cap_and_normalize(df["minimum_nights_inverse_log"])

    df["availability_365_filled"] = safe_numeric(df["availability_365"], fill=365.0)
    df["availability_score"] = (1.0 - (df["availability_365_filled"] / 365.0)).clip(0.0, 1.0)

    df["amenities_weight"] = df["amenities"].apply(compute_amenities_weight)
    df["amenities_weight_norm"] = cap_and_normalize(df["amenities_weight"])

    groups = df["property_type"].apply(property_group)
    df["privacy_type"] = df["property_type"].apply(privacy_type)
    df["is_apartment"] = (groups == "apartment").astype(int)
    df["is_house"] = (groups == "house").astype(int)
    df["is_nature"] = (groups == "nature").astype(int)
    df["is_unique"] = (groups == "unique").astype(int)
    df["is_hotel"] = (groups == "hotel").astype(int)

    response_mapping = {
        "within an hour": 1.0,
        "within a few hours": 0.75,
        "within a day": 0.5,
        "a few days or more": 0.25,
    }
    df["host_response_time_filled"] = (
        df["host_response_time"].astype(str).str.strip().str.lower().map(response_mapping).fillna(0.5)
    )
    df["host_response_rate_filled"] = df["host_response_rate"].apply(percentage_to_decimal).fillna(0.5)
    df["host_acceptance_rate_filled"] = df["host_acceptance_rate"].apply(percentage_to_decimal).fillna(0.5)
    df["host_is_superhost_filled"] = df["host_is_superhost"].map({"t": 1.0, "f": 0.0}).fillna(0.5)
    df["host_identity_verified_filled"] = (
        df["host_identity_verified"].map({"t": 1.0, "f": 0.0}).fillna(0.5)
    )

    df[REVIEW_TARGET_COLUMN] = review_rating_to_norm(df["review_scores_rating"])
    df["has_real_rating"] = df[REVIEW_TARGET_COLUMN].notna().astype(int)

    output_cols = ["listing_id"] + REVIEW_FEATURE_COLUMNS + [REVIEW_TARGET_COLUMN, "has_real_rating"]
    dataset = df[output_cols].copy()
    dataset[REVIEW_FEATURE_COLUMNS] = dataset[REVIEW_FEATURE_COLUMNS].replace([np.inf, -np.inf], np.nan)
    dataset[REVIEW_FEATURE_COLUMNS] = dataset[REVIEW_FEATURE_COLUMNS].fillna(0.5)
    return dataset

