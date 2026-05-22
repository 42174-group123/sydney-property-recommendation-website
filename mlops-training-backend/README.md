# Stay Scout MLOps Training Backend

This is a standalone backend for the two Stay Scout model pipelines:

- `review_score_rating_model`: predicts missing `listings.review_scores_rating` values for new or unrated listings.
- `user_preference_model`: learns a user-property match score from canonical user browsing events and listing features.

The current frontend still calls Supabase directly. In particular, `searchListings` calls the Supabase SQL RPC `filter_listings`, so today's filtering is database-side and the frontend receives already-filtered listing cards. This backend is a separate training service. A later inference backend can pull the ClearML artifacts produced here, run hard/soft filtering, fill missing review ratings, score user-property matchability, combine scores, rank listings, and return them to the frontend.

## Data Contract

The real Supabase user action table is the source-of-truth event contract:

```text
event_id
user_id
user_type
property_id
event_type
event_timestamp
```

The old synthetic file has extra columns such as `user_group`, `session_id`, recency weights, and `hidden_match_score`. This backend deliberately trims synthetic events to the real `user_action` contract before training. From there it rebuilds training features consistently for both synthetic and real Supabase events.

The preference label is now a weak supervised score derived from event strength plus recency:

```text
preference_score = 1 - exp(-(sum_final_event_weight + strongest_event_weight) / 6)
```

This is not as pure as explicit user ratings, but it lets real `user_action` rows train the same model shape as synthetic rows. Stronger events such as `save_property` and `contact_host` produce higher labels than lightweight events such as `open_listing`.

## Setup

```sh
cd "/Users/ryanluo/Documents/ai project/mlops-training-backend"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
```

Then create `.env` from `.env.example`.

Important values:

```text
SUPABASE_URL=https://rmonjbexchkyvkgecacn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
ENABLE_CLEARML=true
TRAIN_N_JOBS=1
LOKY_MAX_CPU_COUNT=1
```

Use the Supabase service role key for this backend. `user_action` has row-level security, so anon/authenticated keys cannot pull all users' training events.

If Supabase returns `permission denied for table listings`, grant read access to the service role in the Supabase SQL Editor:

```sql
grant usage on schema public to service_role;
grant select on table public.listings to service_role;
grant select on table public.user_action to service_role;
```

Configure ClearML hosted web with environment values in `.env`:

```text
CLEARML_WEB_HOST=https://app.clear.ml/
CLEARML_API_HOST=https://api.clear.ml
CLEARML_FILES_HOST=https://files.clear.ml
CLEARML_API_ACCESS_KEY=<access key>
CLEARML_API_SECRET_KEY=<secret key>
CLEARML_PROJECT_DATA=Stay Scout MLOps/Data Snapshots
CLEARML_PROJECT_REVIEW=Stay Scout MLOps/Review Score Rating
CLEARML_PROJECT_PREFERENCE=Stay Scout MLOps/User Preference
```

The code is defensive: if ClearML is not configured, local dry-runs still produce files under `data/runs/...`.

## Run One Training Cycle

Against Supabase:

```sh
python scripts/run_once.py
```

For local dry-runs with the extracted model CSVs:

```sh
ENABLE_CLEARML=false python scripts/run_once.py \
  --listings-csv _source_artifacts/user_preference_model/listings.csv
```

If `INCLUDE_SYNTHETIC_EVENTS=true`, the default synthetic file is:

```text
_source_artifacts/user_preference_model/synthetic_browsing_events.csv
```

## Run As Scheduled Backend

```sh
python scripts/serve.py
```

The FastAPI backend starts a scheduler that runs every 30 minutes by default and also exposes the listing ranking inference endpoint.

Endpoints:

```text
GET  /health
POST /run-now
POST /rank-listings
POST /rank-candidates
```

`POST /run-now` triggers a training cycle immediately while preserving the 30-minute schedule.

`POST /rank-listings` is the legacy all-in-one route. It accepts filters, fetches matching listings, fills missing review quality with the review-score model, predicts user-property matchability with the preference model, combines the scores, converts the combined score to `0-10`, and returns listing cards sorted by score.

`POST /rank-candidates` is the preferred route for the current frontend flow. The frontend/server keeps using the existing Supabase filter RPC to fetch one page of candidates, usually 20 listing IDs. It then sends those IDs to this endpoint. The backend pulls full listing features for only those candidates, scores just that page, ranks that page, and returns the same listings with match scores.

Example:

```json
{
  "user_id": "optional-supabase-user-id",
  "offset": 0,
  "limit": 20,
  "filters": {
    "min_bedrooms": 2,
    "max_price": 500
  }
}
```

Candidate ranking example:

```json
{
  "user_id": "optional-supabase-user-id",
  "listing_ids": ["123", "456", "789"],
  "candidates": [
    {
      "id": "123",
      "name": "Bondi Beach Apartment",
      "picture_url": "https://...",
      "host_picture_url": "https://...",
      "price": "$220.00"
    }
  ]
}
```

`listing_ids` are enough. `candidates` are optional card-field overrides for preserving exactly what the frontend already received from Supabase.

Response items include:

```text
match_score
combined_score
user_preference_score
review_quality_score
review_scores_rating_final
review_score_source
```

`match_score` is an absolute `0-10` score derived from the combined model score, not a page-local min-max. This keeps scores comparable as the frontend appends more 20-item batches during infinite scroll.

## What Each Cycle Does

1. Pulls `listings` and `user_action` from Supabase.
2. Pulls only the columns needed by the two feature pipelines, instead of the full wide listing table.
3. Canonicalises real `user_action` rows.
4. Optionally trims and merges synthetic browsing events into the same canonical event shape.
5. Optionally uploads input snapshots when `UPLOAD_INPUT_SNAPSHOTS=true`.
6. Trains the review score rating pipeline with HPO.
7. Registers the best review model as a ClearML artifact for later backend inference.
8. Trains the user preference pipeline with HPO by joining combined real/synthetic action rows to listing features.
9. Uploads model artifacts, metrics, HPO tables, plots, prediction samples, and metadata to ClearML.
10. Replaces the local `data/runs/latest` directory on the next scheduled retrain unless `RETAIN_LOCAL_RUNS=true`.
11. Reuses the same ClearML task names on scheduled runs unless `CLEARML_REUSE_TASKS=false`.

## ClearML Artifacts

Data snapshot project:

```text
Stay Scout MLOps/Data Snapshots
```

Key artifacts:

```text
supabase_listings_snapshot
supabase_user_action_snapshot_raw
canonical_user_action_training_events
synthetic_user_action_trimmed
snapshot_metadata
```

Snapshot table artifacts are disabled by default on small Render cron instances to stay below the memory limit. Enable `UPLOAD_INPUT_SNAPSHOTS=true` for a heavier evidence run when you have more memory.

Review rating project:

```text
Stay Scout MLOps/Review Score Rating
```

Key artifact:

```text
best_review_score_rating_model
best_model
metrics_summary
hpo_results
processed_dataset
best_model_info
```

User preference project:

```text
Stay Scout MLOps/User Preference
```

Key artifact:

```text
best_user_preference_model
best_user_preference_model_refit_full_dataset
best_model
metrics_summary
hpo_results
preference_model_dataset
feature_schema
test_prediction_samples
best_model_info
```

Both models are `joblib` payloads containing the fitted model plus feature schema metadata.

## HPO And Marking Visualisations

Both pipelines now run `RandomizedSearchCV` over several candidate models and parameter spaces.

Logged/produced evaluation material includes:

- model comparison tables
- HPO result tables
- RMSE, MAE, R2, MSE comparison plots
- actual vs predicted plots
- residual distribution plots
- residuals vs predicted plots
- feature importance tables and charts when supported
- user preference event type distribution
- user preference target distribution
- test prediction samples
- best model info JSON

## Current Limitation

This backend trains and publishes the models. The production inference path is the next piece: update the app/backend to pull these ClearML artifacts, apply hard/soft filtering, fill missing review scores, calculate user preference scores, combine them, rank properties, and return ranked listings to the frontend.
