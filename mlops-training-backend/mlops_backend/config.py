from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - dependency may not be installed during static checks
    load_dotenv = None


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return int(value)


def _float_env(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return float(value)


@dataclass(frozen=True)
class Settings:
    supabase_url: str | None
    supabase_service_role_key: str | None
    enable_clearml: bool
    clearml_output_uri: str | None
    clearml_project_data: str
    clearml_project_review: str
    clearml_project_preference: str
    clearml_reuse_tasks: bool
    clearml_review_task_id: str | None
    clearml_preference_task_id: str | None
    clearml_review_artifact_name: str
    clearml_preference_artifact_name: str
    clearml_use_latest_artifacts: bool
    clearml_review_task_name: str
    clearml_preference_task_name: str
    prefer_clearml_artifacts: bool
    force_heuristic_model_fallback: bool
    model_cache_seconds: int
    review_model_local_path: Path
    preference_model_local_path: Path
    listings_snapshot_local_path: Path
    ranking_prefer_local_snapshot: bool
    ranking_fetch_user_actions: bool
    ranking_user_action_cache_seconds: int
    ranking_user_action_timeout_seconds: float
    ranking_listing_cache_seconds: int
    max_ranking_candidates: int
    preference_score_weight: float
    review_score_weight: float
    train_interval_minutes: int
    enable_scheduler: bool
    run_on_startup: bool
    include_synthetic_events: bool
    synthetic_events_path: Path
    random_state: int
    test_size: float
    cv_folds: int
    hpo_iterations: int
    train_n_jobs: int
    max_tree_estimators: int
    max_table_rows: int
    page_size: int
    retain_local_runs: bool
    upload_input_snapshots: bool
    cors_allow_origins: tuple[str, ...]
    workspace_dir: Path
    data_dir: Path
    outputs_dir: Path
    models_dir: Path


def load_settings(workspace_dir: Path | None = None) -> Settings:
    root = workspace_dir or Path.cwd()
    if load_dotenv is not None:
        load_dotenv(root / ".env")

    data_dir = root / "data"
    outputs_dir = root / "outputs"
    models_dir = root / "models"

    return Settings(
        supabase_url=os.getenv("SUPABASE_URL"),
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
        enable_clearml=_bool_env("ENABLE_CLEARML", True),
        clearml_output_uri=os.getenv("CLEARML_OUTPUT_URI") or None,
        clearml_project_data=os.getenv(
            "CLEARML_PROJECT_DATA",
            "Stay Scout MLOps/Data Snapshots",
        ),
        clearml_project_review=os.getenv(
            "CLEARML_PROJECT_REVIEW",
            "Stay Scout MLOps/Review Score Rating",
        ),
        clearml_project_preference=os.getenv(
            "CLEARML_PROJECT_PREFERENCE",
            "Stay Scout MLOps/User Preference",
        ),
        clearml_reuse_tasks=_bool_env("CLEARML_REUSE_TASKS", True),
        clearml_review_task_id=os.getenv("CLEARML_REVIEW_TASK_ID") or None,
        clearml_preference_task_id=os.getenv("CLEARML_PREFERENCE_TASK_ID") or None,
        clearml_review_artifact_name=os.getenv(
            "CLEARML_REVIEW_ARTIFACT_NAME",
            "best_review_score_rating_model",
        ),
        clearml_preference_artifact_name=os.getenv(
            "CLEARML_PREFERENCE_ARTIFACT_NAME",
            "best_user_preference_model",
        ),
        clearml_use_latest_artifacts=_bool_env("CLEARML_USE_LATEST_ARTIFACTS", False),
        clearml_review_task_name=os.getenv(
            "CLEARML_REVIEW_TASK_NAME",
            "Review Score Rating Training",
        ),
        clearml_preference_task_name=os.getenv(
            "CLEARML_PREFERENCE_TASK_NAME",
            "User Preference Training",
        ),
        prefer_clearml_artifacts=_bool_env("PREFER_CLEARML_ARTIFACTS", True),
        force_heuristic_model_fallback=_bool_env("FORCE_HEURISTIC_MODEL_FALLBACK", False),
        model_cache_seconds=_int_env("MODEL_CACHE_SECONDS", 1800),
        review_model_local_path=Path(
            os.getenv(
                "REVIEW_MODEL_LOCAL_PATH",
                "data/runs/clearml_full_20260522_02/review_score_rating/models/review_score_rating_model.joblib",
            ),
        ),
        preference_model_local_path=Path(
            os.getenv(
                "PREFERENCE_MODEL_LOCAL_PATH",
                "data/runs/clearml_full_20260522_02/user_preference/models/user_preference_model.joblib",
            ),
        ),
        listings_snapshot_local_path=Path(
            os.getenv(
                "LISTINGS_SNAPSHOT_LOCAL_PATH",
                "data/runs/clearml_full_20260522_02/supabase_listings_snapshot.csv",
            ),
        ),
        ranking_prefer_local_snapshot=_bool_env("RANKING_PREFER_LOCAL_SNAPSHOT", False),
        ranking_fetch_user_actions=_bool_env("RANKING_FETCH_USER_ACTIONS", True),
        ranking_user_action_cache_seconds=_int_env("RANKING_USER_ACTION_CACHE_SECONDS", 1800),
        ranking_user_action_timeout_seconds=_float_env("RANKING_USER_ACTION_TIMEOUT_SECONDS", 6.0),
        ranking_listing_cache_seconds=_int_env("RANKING_LISTING_CACHE_SECONDS", 300),
        max_ranking_candidates=_int_env("MAX_RANKING_CANDIDATES", 5000),
        preference_score_weight=_float_env("PREFERENCE_SCORE_WEIGHT", 0.6),
        review_score_weight=_float_env("REVIEW_SCORE_WEIGHT", 0.4),
        train_interval_minutes=_int_env("TRAIN_INTERVAL_MINUTES", 30),
        enable_scheduler=_bool_env("ENABLE_SCHEDULER", True),
        run_on_startup=_bool_env("RUN_ON_STARTUP", False),
        include_synthetic_events=_bool_env("INCLUDE_SYNTHETIC_EVENTS", True),
        synthetic_events_path=Path(
            os.getenv(
                "SYNTHETIC_EVENTS_PATH",
                "_source_artifacts/user_preference_model/synthetic_browsing_events.csv",
            ),
        ),
        random_state=_int_env("RANDOM_STATE", 42),
        test_size=_float_env("TEST_SIZE", 0.2),
        cv_folds=_int_env("CV_FOLDS", 3),
        hpo_iterations=_int_env("HPO_ITERATIONS", 12),
        train_n_jobs=_int_env("TRAIN_N_JOBS", 1),
        max_tree_estimators=_int_env("MAX_TREE_ESTIMATORS", 200),
        max_table_rows=_int_env("MAX_TABLE_ROWS", 100000),
        page_size=_int_env("PAGE_SIZE", 1000),
        retain_local_runs=_bool_env("RETAIN_LOCAL_RUNS", False),
        upload_input_snapshots=_bool_env("UPLOAD_INPUT_SNAPSHOTS", False),
        cors_allow_origins=tuple(
            origin.strip()
            for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
            if origin.strip()
        )
        or ("*",),
        workspace_dir=root,
        data_dir=data_dir,
        outputs_dir=outputs_dir,
        models_dir=models_dir,
    )
