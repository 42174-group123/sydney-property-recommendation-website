from __future__ import annotations

import ast
import json
from typing import Any

import numpy as np
import pandas as pd

AMENITIES_WEIGHTS = {
    "wifi": 4,
    "ethernet": 2,
    "tv": 3,
    "hdtv": 3,
    "netflix": 2,
    "chromecast": 2,
    "apple tv": 2,
    "fire tv": 2,
    "roku": 2,
    "sound system": 3,
    "air conditioning": 5,
    "heating": 4,
    "fan": 1,
    "kitchen": 5,
    "refrigerator": 4,
    "fridge": 4,
    "oven": 4,
    "stove": 4,
    "cooktop": 4,
    "microwave": 3,
    "dishwasher": 3,
    "coffee maker": 2,
    "espresso": 2,
    "nespresso": 2,
    "kettle": 1,
    "toaster": 1,
    "washer": 4,
    "dryer": 4,
    "drying rack": 1,
    "shampoo": 1,
    "conditioner": 1,
    "body soap": 1,
    "body wash": 1,
    "bed linens": 3,
    "extra pillows": 2,
    "hangers": 1,
    "clothing storage": 2,
    "workspace": 3,
    "desk": 2,
    "balcony": 3,
    "backyard": 4,
    "bbq": 3,
    "grill": 3,
    "pool": 5,
    "hot tub": 5,
    "sauna": 5,
    "gym": 4,
    "exercise equipment": 3,
    "smoke alarm": 3,
    "carbon monoxide alarm": 3,
    "fire extinguisher": 2,
    "first aid kit": 2,
    "security camera": 3,
    "parking": 4,
    "ev charger": 5,
    "crib": 3,
    "high chair": 2,
    "children": 1,
    "elevator": 4,
    "private entrance": 4,
    "self check-in": 3,
    "self checkin": 3,
    "lockbox": 3,
    "cleaning": 3,
    "building staff": 3,
}

SORTED_AMENITY_KEYS = sorted(AMENITIES_WEIGHTS.keys(), key=len, reverse=True)


def ensure_columns(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    out = df.copy()
    for col in columns:
        if col not in out.columns:
            out[col] = np.nan
    return out


def clean_price(value: Any) -> float:
    if pd.isna(value):
        return np.nan
    text = str(value).replace("$", "").replace(",", "").strip()
    if text == "":
        return np.nan
    try:
        return float(text)
    except ValueError:
        return np.nan


def numeric_from_text(value: Any) -> float:
    if pd.isna(value):
        return np.nan
    text = "".join(ch for ch in str(value) if ch.isdigit() or ch == ".")
    if text == "":
        return np.nan
    try:
        return float(text)
    except ValueError:
        return np.nan


def percentage_to_decimal(value: Any) -> float:
    if pd.isna(value):
        return np.nan
    text = str(value).replace("%", "").strip()
    if text == "":
        return np.nan
    try:
        return float(text) / 100
    except ValueError:
        return np.nan


def normalize_amenity_text(text: str) -> str:
    text = text.lower().strip()
    text = text.replace("-", " ")
    text = text.replace("/", " ")
    return " ".join(text.split())


def parse_amenities(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, dict):
        return [str(item) for item in value.values()]
    if pd.isna(value):
        return []

    text = str(value).strip()
    if text == "":
        return []

    for parser in (json.loads, ast.literal_eval):
        try:
            parsed = parser(text)
            if isinstance(parsed, list):
                return [str(item) for item in parsed]
        except Exception:
            continue

    return [text]


def compute_amenities_weight(value: Any) -> float:
    total = 0.0
    for item in parse_amenities(value):
        item_lower = normalize_amenity_text(item)
        matched = False
        for key in SORTED_AMENITY_KEYS:
            if key in item_lower:
                if key == "dryer" and "hair dryer" in item_lower:
                    continue
                total += AMENITIES_WEIGHTS[key]
                matched = True
                break
        if not matched and item_lower:
            total += 1.0
    return total


def privacy_type(value: Any) -> float:
    text = str(value).strip().lower()
    if "shared" in text:
        return 0.0
    if "private" in text:
        return 0.5
    if "entire" in text:
        return 1.0
    return 1.0


def property_group(value: Any) -> str:
    text = str(value).strip().lower()
    groups = {
        "apartment": ["apartment", "rental unit", "condo", "loft", "serviced apartment", "aparthotel"],
        "house": ["home", "house", "townhouse", "villa", "bungalow", "cottage", "guesthouse", "guest suite", "vacation home", "farm stay", "chalet"],
        "nature": ["cabin", "treehouse", "yurt", "tent", "dome", "barn", "campsite", "camper", "rv", "island", "boat", "houseboat"],
        "hotel": ["hotel", "hostel", "resort", "holiday park"],
        "unique": ["train", "tiny home", "entire place"],
    }
    for group_name, keywords in groups.items():
        if any(keyword in text for keyword in keywords):
            return group_name
    return "unique"


def safe_numeric(series: pd.Series, fill: float | None = None) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    if fill is not None:
        return numeric.fillna(fill)
    median_value = numeric.median()
    if pd.isna(median_value):
        median_value = 0.0
    return numeric.fillna(median_value)


def cap_and_normalize(series: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    lower = numeric.quantile(0.01)
    upper = numeric.quantile(0.99)
    capped = numeric.clip(lower, upper)
    min_val = capped.min()
    max_val = capped.max()
    if pd.isna(min_val) or pd.isna(max_val) or max_val == min_val:
        return pd.Series(0.5, index=series.index)
    return (capped - min_val) / (max_val - min_val)


def review_rating_to_norm(series: pd.Series) -> pd.Series:
    rating = pd.to_numeric(series, errors="coerce")
    return ((rating - 1.0) / 4.0).clip(0.0, 1.0)


def norm_to_review_rating(series: pd.Series | np.ndarray) -> np.ndarray:
    return np.clip(np.asarray(series, dtype=float), 0.0, 1.0) * 4.0 + 1.0

