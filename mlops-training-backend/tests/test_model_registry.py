import numpy as np
import pandas as pd

from mlops_backend.model_registry import HeuristicPreferenceModel, HeuristicReviewScoreModel


def test_heuristic_review_score_model_returns_bounded_scores() -> None:
    frame = pd.DataFrame(
        [
            {
                "amenities_weight_norm": 0.8,
                "availability_score": 0.7,
                "minimum_nights_norm": 0.6,
                "price_norm": 0.4,
                "accommodates_norm": 0.6,
                "bathrooms_norm": 0.5,
                "bedrooms_norm": 0.5,
                "beds_norm": 0.6,
                "host_response_rate_filled": 1.0,
                "host_acceptance_rate_filled": 0.9,
                "host_response_time_filled": 0.8,
                "host_is_superhost_filled": 1.0,
                "host_identity_verified_filled": 1.0,
                "is_apartment": 1,
            },
        ],
    )

    scores = HeuristicReviewScoreModel().predict(frame)

    assert scores.shape == (1,)
    assert np.isfinite(scores).all()
    assert ((scores >= 0.0) & (scores <= 1.0)).all()


def test_heuristic_preference_model_returns_one_score_per_candidate() -> None:
    frame = pd.DataFrame(
        [
            {
                "property_price_norm": 0.3,
                "property_accommodates_norm": 0.6,
                "property_bathrooms_norm": 0.5,
                "property_bedrooms_norm": 0.5,
                "property_beds_norm": 0.6,
                "property_minimum_nights_norm": 0.4,
                "property_amenities_weight_norm": 0.8,
                "property_review_scores_rating_norm": 0.9,
                "user_avg_price": 0.35,
                "user_avg_accommodates": 0.55,
                "user_avg_bathrooms": 0.45,
                "user_avg_bedrooms": 0.45,
                "user_avg_beds": 0.55,
                "user_avg_minimum_nights": 0.4,
                "user_avg_amenities": 0.75,
                "user_avg_rating": 0.85,
                "user_total_events": 8,
                "user_strong_interaction_rate": 0.5,
                "user_avg_final_event_weight": 2.0,
                "user_type": "budget_traveller",
                "property_group": "apartment",
            },
            {
                "property_price_norm": 0.9,
                "property_accommodates_norm": 0.2,
                "property_bathrooms_norm": 0.2,
                "property_bedrooms_norm": 0.2,
                "property_beds_norm": 0.2,
                "property_minimum_nights_norm": 0.8,
                "property_amenities_weight_norm": 0.3,
                "property_review_scores_rating_norm": 0.4,
                "user_avg_price": 0.35,
                "user_avg_accommodates": 0.55,
                "user_avg_bathrooms": 0.45,
                "user_avg_bedrooms": 0.45,
                "user_avg_beds": 0.55,
                "user_avg_minimum_nights": 0.4,
                "user_avg_amenities": 0.75,
                "user_avg_rating": 0.85,
                "user_total_events": 8,
                "user_strong_interaction_rate": 0.5,
                "user_avg_final_event_weight": 2.0,
                "user_type": "budget_traveller",
                "property_group": "hotel",
            },
        ],
    )

    scores = HeuristicPreferenceModel().predict(frame)

    assert scores.shape == (2,)
    assert np.isfinite(scores).all()
    assert ((scores >= 0.0) & (scores <= 1.0)).all()
    assert scores[0] > scores[1]
