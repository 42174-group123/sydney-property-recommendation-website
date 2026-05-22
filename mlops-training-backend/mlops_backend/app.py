from __future__ import annotations

import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import Settings, load_settings
from .ranking import RankingRequest, RankingResponse, RankingService

try:
    from apscheduler.schedulers.background import BackgroundScheduler
except Exception as exc:  # pragma: no cover - local env may have broken optional metadata
    BackgroundScheduler = None  # type: ignore[assignment]
    scheduler_import_error: str | None = f"{type(exc).__name__}: {exc}"
else:
    scheduler_import_error = None

settings: Settings = load_settings(Path(__file__).resolve().parents[1])
app = FastAPI(title="Stay Scout MLOps Training Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_allow_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
scheduler = BackgroundScheduler(timezone="UTC") if BackgroundScheduler is not None else None
ranking_service = RankingService(settings)
state: dict[str, Any] = {
    "last_started_at": None,
    "last_finished_at": None,
    "last_status": "idle",
    "last_error": None,
    "last_run_id": None,
}
run_lock = threading.Lock()


class RunNowResponse(BaseModel):
    accepted: bool
    status: str


def _summarise_result(result: Any) -> dict[str, Any]:
    return {
        "run_id": result.run_id,
        "run_dir": str(result.run_dir),
        "review_best_model": result.review.best_model_name,
        "review_model_path": str(result.review.model_path),
        "preference_best_model": result.preference.best_model_name,
        "preference_model_path": str(result.preference.model_path),
    }


def training_job() -> None:
    if not run_lock.acquire(blocking=False):
        print("Training run skipped because a previous run is still active.")
        return

    state["last_started_at"] = datetime.now(timezone.utc).isoformat()
    state["last_status"] = "running"
    state["last_error"] = None

    try:
        from .pipeline import run_training_cycle

        result = run_training_cycle(settings)
        state["last_run_id"] = result.run_id
        state["last_result"] = _summarise_result(result)
        state["last_status"] = "succeeded"
    except Exception as exc:
        state["last_status"] = "failed"
        state["last_error"] = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
    finally:
        state["last_finished_at"] = datetime.now(timezone.utc).isoformat()
        run_lock.release()


@app.on_event("startup")
def on_startup() -> None:
    if settings.enable_scheduler and scheduler is not None:
        scheduler.add_job(
            training_job,
            "interval",
            minutes=settings.train_interval_minutes,
            id="stay_scout_training_cycle",
            replace_existing=True,
            max_instances=1,
        )
        scheduler.start()
        if settings.run_on_startup:
            threading.Thread(target=training_job, daemon=True).start()
    elif settings.enable_scheduler and scheduler_import_error:
        print(f"Training scheduler disabled because APScheduler could not load: {scheduler_import_error}")


@app.on_event("shutdown")
def on_shutdown() -> None:
    if scheduler is not None and scheduler.running:
        scheduler.shutdown(wait=False)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "scheduler_enabled": settings.enable_scheduler and scheduler is not None,
        "scheduler_error": scheduler_import_error,
        "interval_minutes": settings.train_interval_minutes,
        "state": state,
    }


@app.post("/rank-listings", response_model=RankingResponse)
def rank_listings(request: RankingRequest) -> RankingResponse:
    return ranking_service.rank(request)


@app.post("/run-now", response_model=RunNowResponse)
def run_now() -> RunNowResponse:
    if run_lock.locked():
        return RunNowResponse(accepted=False, status="already_running")
    threading.Thread(target=training_job, daemon=True).start()
    return RunNowResponse(accepted=True, status="started")
