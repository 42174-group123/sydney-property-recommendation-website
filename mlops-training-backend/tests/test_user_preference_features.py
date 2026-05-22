from __future__ import annotations

import pandas as pd

from mlops_backend.data_contract import canonicalise_user_actions
from mlops_backend.features.user_preference import build_user_preference_dataset


def test_user_preference_dataset_builds_from_real_action_contract() -> None:
    listings = pd.DataFrame(
        [
            {
                "id": 1,
                "property_type": "Entire rental unit",
                "room_type": "Entire home/apt",
                "accommodates": 2,
                "bathrooms": "1",
                "bedrooms": "1",
                "beds": "1",
                "price": "$120.00",
                "amenities": '["Wifi", "Kitchen"]',
                "minimum_nights": 2,
                "review_scores_rating": "4.8",
            },
            {
                "id": 2,
                "property_type": "Private room in home",
                "room_type": "Private room",
                "accommodates": 1,
                "bathrooms": "1",
                "bedrooms": "1",
                "beds": "1",
                "price": "$80.00",
                "amenities": '["Wifi"]',
                "minimum_nights": 7,
                "review_scores_rating": "4.2",
            },
        ],
    )
    actions = pd.DataFrame(
        [
            {
                "event_id": "A1",
                "user_id": "user-1",
                "user_type": "budget_traveller",
                "property_id": 1,
                "event_type": "open_listing",
                "event_timestamp": "2026-05-20T00:00:00Z",
            },
            {
                "event_id": "A2",
                "user_id": "user-1",
                "user_type": "budget_traveller",
                "property_id": 1,
                "event_type": "save_property",
                "event_timestamp": "2026-05-20T00:05:00Z",
            },
        ],
    )

    canonical = canonicalise_user_actions(actions, source="supabase")
    dataset, user_features, listing_features = build_user_preference_dataset(listings, canonical)

    assert len(dataset) == 1
    assert dataset.loc[0, "preference_score"] > 0
    assert len(user_features) == 1
    assert set(listing_features["property_id"]) == {1, 2}

