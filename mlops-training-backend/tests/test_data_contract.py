from __future__ import annotations

import pandas as pd

from mlops_backend.data_contract import USER_ACTION_COLUMNS, canonicalise_user_actions


def test_canonicalise_synthetic_events_trims_to_real_user_action_shape() -> None:
    raw = pd.DataFrame(
        [
            {
                "event_id": "E1",
                "user_id": "U1",
                "user_group": "long_term",
                "user_type": "budget_traveller",
                "session_id": "S1",
                "property_id": "123",
                "event_type": "save_property",
                "event_timestamp": "2026-04-24 12:00:00",
                "hidden_match_score": 0.9,
            },
        ],
    )

    canonical = canonicalise_user_actions(raw, source="synthetic")

    assert canonical.columns.tolist() == USER_ACTION_COLUMNS + ["source"]
    assert canonical.loc[0, "property_id"] == 123
    assert canonical.loc[0, "source"] == "synthetic"
    assert "hidden_match_score" not in canonical.columns

