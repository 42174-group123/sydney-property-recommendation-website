# Stay Scout Deployment

Recommended production split:

1. Supabase stays hosted on Supabase.
2. Frontend deploys as the TanStack Start app.
3. ML inference API deploys as a Python web service.
4. ML retraining deploys as a separate cron job that runs every 30 minutes.
5. ClearML stores model artifacts, metrics, HPO tables, and plots.

## Why not put everything on Vercel?

Vercel is fine for the frontend and small request/response APIs, but the ML training job is not a good Vercel Function workload. Training needs longer CPU time, stable Python dependencies, model artifact uploads, and a scheduler that must not disappear after a request finishes.

The safer layout is:

- Frontend: Vercel, using Nitro as the TanStack Start deployment target.
- ML API: Render/Railway/Fly.io/Cloud Run.
- ML training: Render cron job, Cloud Run job, Railway cron, or any worker scheduler.

This repo is now Vercel-oriented: `stay-scout/vite.config.ts` disables the Cloudflare build plugin and adds Nitro for Vercel builds.

## Frontend

Directory:

```bash
cd stay-scout
```

Production environment variables:

```bash
VITE_SUPABASE_URL=https://rmonjbexchkyvkgecacn.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_PROJECT_ID=rmonjbexchkyvkgecacn
SUPABASE_URL=https://rmonjbexchkyvkgecacn.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
ML_BACKEND_URL=https://YOUR-ML-API-HOST
```

Run the frontend checks locally if possible:

```bash
cd stay-scout
npm install
npm run ci
```

Then follow `GITHUB_ACTIONS_SETUP.md` to push to GitHub and import the repo in Vercel. The normal Vercel GitHub integration does not require `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID`; those are only for the optional manual Vercel CLI workflow. After deploy, add the production frontend URL to:

- Supabase Authentication URL Configuration
- Google OAuth Authorized JavaScript origins

For Google OAuth, keep the redirect URI pointing at Supabase:

```text
https://rmonjbexchkyvkgecacn.supabase.co/auth/v1/callback
```

## ML API

Directory:

```bash
cd mlops-training-backend
```

The ML API should run as a web service:

```bash
uvicorn mlops_backend.app:app --host 0.0.0.0 --port $PORT
```

Production environment variables:

```bash
SUPABASE_URL=https://rmonjbexchkyvkgecacn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

CLEARML_WEB_HOST=https://app.clear.ml/
CLEARML_API_HOST=https://api.clear.ml
CLEARML_FILES_HOST=https://files.clear.ml
CLEARML_API_ACCESS_KEY=...
CLEARML_API_SECRET_KEY=...

ENABLE_SCHEDULER=false
ENABLE_CLEARML=true
PREFER_CLEARML_ARTIFACTS=true
CLEARML_USE_LATEST_ARTIFACTS=true
MODEL_CACHE_SECONDS=1800

CLEARML_PROJECT_REVIEW=Stay Scout MLOps/Review Score Rating
CLEARML_PROJECT_PREFERENCE=Stay Scout MLOps/User Preference
CLEARML_REVIEW_TASK_NAME=Review Score Rating Training
CLEARML_PREFERENCE_TASK_NAME=User Preference Training
CLEARML_REVIEW_ARTIFACT_NAME=best_review_score_rating_model
CLEARML_PREFERENCE_ARTIFACT_NAME=best_user_preference_model
```

The API pulls the latest completed ClearML task artifact and keeps models cached for `MODEL_CACHE_SECONDS`.

## ML Training Cron

The trainer should run as a separate scheduled job every 30 minutes:

```bash
python scripts/run_once.py
```

Cron expression:

```text
*/30 * * * *
```

The trainer needs the same Supabase and ClearML credentials, plus:

```bash
ENABLE_CLEARML=true
INCLUDE_SYNTHETIC_EVENTS=true
HPO_ITERATIONS=4
CV_FOLDS=2
TEST_SIZE=0.2
TRAIN_N_JOBS=1
LOKY_MAX_CPU_COUNT=1
MAX_TREE_ESTIMATORS=120
MAX_TABLE_ROWS=50000
PAGE_SIZE=1000
RETAIN_LOCAL_RUNS=false
UPLOAD_INPUT_SNAPSHOTS=false
MPLCONFIGDIR=/tmp/matplotlib
JOBLIB_TEMP_FOLDER=/tmp/joblib
```

The Render cron plan has a 512 MiB memory ceiling, so the production defaults
use bounded HPO and overwrite `data/runs/latest` on each retrain. ClearML still
receives the model artifacts, metrics, HPO tables, and plots needed for marking.

Each run:

1. Pulls `listings` and `user_action` from Supabase.
2. Canonicalises real user actions.
3. Merges trimmed synthetic browsing events.
4. Builds the review-rating training dataset.
5. Runs HPO and model comparison for the review-rating model.
6. Uploads metrics, HPO results, plots, and the best review model to ClearML.
7. Builds the user-preference training dataset.
8. Runs HPO and model comparison for the preference model.
9. Uploads metrics, HPO results, plots, and the best preference model to ClearML.

## Render Blueprint

The root `render.yaml` defines:

- `stay-scout-ml-api`: Python web service for `/rank-listings`
- `stay-scout-ml-trainer`: Python cron job scheduled every 30 minutes

The blueprint intentionally marks secrets with `sync: false`, so Render will ask for those values in the dashboard instead of storing them in git.

## Production Check

After deployment:

1. Open the ML API `/health`.
2. Trigger one trainer run manually.
3. Confirm new ClearML tasks are created.
4. Confirm artifacts named `best_review_score_rating_model` and `best_user_preference_model` exist.
5. Set frontend `ML_BACKEND_URL` to the deployed ML API URL.
6. Open frontend and verify listing cards display `Match X.X`.
