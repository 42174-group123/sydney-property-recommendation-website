from __future__ import annotations

import gc
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .clearml_utils import init_clearml_run, write_json
from .config import Settings
from .data_contract import canonicalise_user_actions, load_synthetic_actions
from .supabase_io import fetch_training_tables
from .training import ReviewTrainingOutput, TrainingOutput, train_review_score_model, train_user_preference_model


@dataclass
class TrainingCycleResult:
    run_id: str
    run_dir: Path
    review: ReviewTrainingOutput
    preference: TrainingOutput


def make_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _prepare_run_dir(settings: Settings, run_id: str) -> Path:
    run_name = run_id if settings.retain_local_runs else "latest"
    run_dir = settings.data_dir / "runs" / run_name
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def _resolve_path(settings: Settings, path: Path) -> Path:
    return path if path.is_absolute() else settings.workspace_dir / path


def load_training_inputs(
    settings: Settings,
    *,
    listings_csv: Path | None = None,
    actions_csv: Path | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame | None, pd.DataFrame]:
    if listings_csv is not None:
        listings = pd.read_csv(listings_csv)
        raw_actions = pd.read_csv(actions_csv) if actions_csv is not None and actions_csv.exists() else pd.DataFrame()
    else:
        listings, raw_actions = fetch_training_tables(settings)

    canonical_actions = canonicalise_user_actions(raw_actions, source="supabase") if not raw_actions.empty else pd.DataFrame()
    synthetic_actions = None

    if settings.include_synthetic_events:
        synthetic_path = _resolve_path(settings, settings.synthetic_events_path)
        if synthetic_path.exists():
            synthetic_actions = load_synthetic_actions(synthetic_path)
            canonical_actions = pd.concat([canonical_actions, synthetic_actions], ignore_index=True)
        else:
            print(f"Synthetic events path not found, continuing without it: {synthetic_path}")

    if canonical_actions.empty:
        raise ValueError(
            "No user_action events were available after canonicalisation. "
            "Provide Supabase rows or a synthetic events file.",
        )

    return listings, canonical_actions, synthetic_actions, raw_actions


def _save_and_log_input_snapshot(
    *,
    settings: Settings,
    run_id: str,
    run_dir: Path,
    source: str,
    listings: pd.DataFrame,
    raw_actions: pd.DataFrame,
    canonical_actions: pd.DataFrame,
    synthetic_actions: pd.DataFrame | None,
) -> None:
    listings_path = run_dir / "supabase_listings_snapshot.csv"
    raw_actions_path = run_dir / "supabase_user_action_snapshot_raw.csv"
    canonical_actions_path = run_dir / "canonical_user_action_training_events.csv"
    synthetic_path = run_dir / "synthetic_user_action_trimmed.csv"
    listings_artifact_path = run_dir / "supabase_listings_snapshot.csv.gz"
    raw_actions_artifact_path = run_dir / "supabase_user_action_snapshot_raw.csv.gz"
    canonical_actions_artifact_path = run_dir / "canonical_user_action_training_events.csv.gz"
    synthetic_artifact_path = run_dir / "synthetic_user_action_trimmed.csv.gz"
    metadata_path = run_dir / "snapshot_metadata.json"

    listings.to_csv(listings_path, index=False)
    raw_actions.to_csv(raw_actions_path, index=False)
    canonical_actions.to_csv(canonical_actions_path, index=False)
    listings.to_csv(listings_artifact_path, index=False, compression="gzip")
    raw_actions.to_csv(raw_actions_artifact_path, index=False, compression="gzip")
    canonical_actions.to_csv(canonical_actions_artifact_path, index=False, compression="gzip")
    synthetic_rows = 0
    if synthetic_actions is not None:
        synthetic_actions.to_csv(synthetic_path, index=False)
        synthetic_actions.to_csv(synthetic_artifact_path, index=False, compression="gzip")
        synthetic_rows = int(len(synthetic_actions))

    metadata = {
        "run_id": run_id,
        "source": source,
        "listings_rows": int(len(listings)),
        "raw_user_action_rows": int(len(raw_actions)),
        "canonical_user_action_rows": int(len(canonical_actions)),
        "synthetic_user_action_rows": synthetic_rows,
        "include_synthetic_events": settings.include_synthetic_events,
        "listings_columns": list(listings.columns),
        "raw_user_action_columns": list(raw_actions.columns),
        "canonical_user_action_columns": list(canonical_actions.columns),
        "artifact_compression": "gzip",
    }
    write_json(metadata_path, metadata)

    run = init_clearml_run(
        enabled=settings.enable_clearml,
        project_name=settings.clearml_project_data,
        task_name=f"Supabase Training Snapshot {run_id}",
        tags=["scheduled", "data_snapshot", run_id, source],
        output_uri=settings.clearml_output_uri,
    )
    run.connect_params(metadata)
    run.upload_artifact("supabase_listings_snapshot", listings_artifact_path)
    run.upload_artifact("supabase_user_action_snapshot_raw", raw_actions_artifact_path)
    run.upload_artifact("canonical_user_action_training_events", canonical_actions_artifact_path)
    if synthetic_actions is not None:
        run.upload_artifact("synthetic_user_action_trimmed", synthetic_artifact_path)
    run.upload_artifact("snapshot_metadata", metadata_path)

    if not canonical_actions.empty and "event_type" in canonical_actions.columns:
        event_counts = canonical_actions["event_type"].value_counts().reset_index()
        event_counts.columns = ["event_type", "count"]
        run.report_table("Canonical Event Counts", "event_type", event_counts)
    if not listings.empty:
        run.report_table("Listings Snapshot Preview", "head", listings.head(50))
    if not canonical_actions.empty:
        run.report_table("Canonical User Action Preview", "head", canonical_actions.head(50))
    run.close()


def run_training_cycle(
    settings: Settings,
    *,
    listings_csv: Path | None = None,
    actions_csv: Path | None = None,
    run_id: str | None = None,
) -> TrainingCycleResult:
    run_id = run_id or make_run_id()
    run_dir = _prepare_run_dir(settings, run_id)

    listings, actions, synthetic_actions, raw_actions = load_training_inputs(
        settings,
        listings_csv=listings_csv,
        actions_csv=actions_csv,
    )

    if settings.upload_input_snapshots:
        _save_and_log_input_snapshot(
            settings=settings,
            run_id=run_id,
            run_dir=run_dir,
            source="local_csv" if listings_csv is not None else "supabase",
            listings=listings,
            raw_actions=raw_actions,
            canonical_actions=actions,
            synthetic_actions=synthetic_actions,
        )

    review_output = train_review_score_model(
        listings,
        settings=settings,
        run_id=run_id,
        run_dir=run_dir,
    )
    gc.collect()

    preference_output = train_user_preference_model(
        listings,
        actions,
        settings=settings,
        run_id=run_id,
        run_dir=run_dir,
    )
    gc.collect()

    return TrainingCycleResult(
        run_id=run_id,
        run_dir=run_dir,
        review=review_output,
        preference=preference_output,
    )
