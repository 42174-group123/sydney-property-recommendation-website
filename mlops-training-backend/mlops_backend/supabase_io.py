from __future__ import annotations

import pandas as pd

from .config import Settings
from .data_contract import USER_ACTION_COLUMNS
from .features.review_rating import REVIEW_REQUIRED_COLUMNS
from .features.user_preference import PREFERENCE_LISTING_REQUIRED_COLUMNS


TRAINING_LISTING_COLUMNS = tuple(
    dict.fromkeys([*REVIEW_REQUIRED_COLUMNS, *PREFERENCE_LISTING_REQUIRED_COLUMNS]),
)


def _client(settings: Settings):
    if not settings.supabase_url:
        raise ValueError("SUPABASE_URL is required to fetch training data.")
    if not settings.supabase_service_role_key:
        raise ValueError(
            "SUPABASE_SERVICE_ROLE_KEY is required because user_action is protected by RLS.",
        )

    from supabase import create_client

    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def fetch_table(
    settings: Settings,
    table_name: str,
    *,
    order_by: str | None = None,
    columns: str = "*",
) -> pd.DataFrame:
    client = _client(settings)
    page_size = settings.page_size
    max_rows = settings.max_table_rows
    rows: list[dict] = []
    offset = 0

    while offset < max_rows:
        query = client.table(table_name).select(columns)
        if order_by:
            query = query.order(order_by)
        response = query.range(offset, offset + page_size - 1).execute()
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    return pd.DataFrame(rows)


def fetch_training_tables(settings: Settings) -> tuple[pd.DataFrame, pd.DataFrame]:
    listings = fetch_table(
        settings,
        "listings",
        order_by="id",
        columns=",".join(TRAINING_LISTING_COLUMNS),
    )
    user_actions = fetch_table(
        settings,
        "user_action",
        order_by="event_timestamp",
        columns=",".join(USER_ACTION_COLUMNS),
    )
    return listings, user_actions
