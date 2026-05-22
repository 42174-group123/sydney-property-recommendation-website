from __future__ import annotations

from pathlib import Path
import time
from typing import Any

import joblib
import numpy as np
import pandas as pd

from .config import Settings


def _numeric_column(frame: pd.DataFrame, name: str, default: float = 0.5) -> pd.Series:
    if name not in frame:
        return pd.Series(default, index=frame.index, dtype="float64")
    return pd.to_numeric(frame[name], errors="coerce").fillna(default).astype("float64")


def _text_column(frame: pd.DataFrame, name: str, default: str = "unknown") -> pd.Series:
    if name not in frame:
        return pd.Series(default, index=frame.index, dtype="object")
    return frame[name].fillna(default).astype(str).str.lower()


class HeuristicReviewScoreModel:
    """Last-resort scorer used when the registered artifact cannot be loaded."""

    def predict(self, features: Any) -> np.ndarray:
        frame = pd.DataFrame(features)
        amenities = _numeric_column(frame, "amenities_weight_norm")
        availability = _numeric_column(frame, "availability_score")
        minimum_nights = _numeric_column(frame, "minimum_nights_norm")
        price = _numeric_column(frame, "price_norm")
        space = pd.concat(
            [
                _numeric_column(frame, "accommodates_norm"),
                _numeric_column(frame, "bathrooms_norm"),
                _numeric_column(frame, "bedrooms_norm"),
                _numeric_column(frame, "beds_norm"),
            ],
            axis=1,
        ).mean(axis=1)
        host = pd.concat(
            [
                _numeric_column(frame, "host_response_rate_filled"),
                _numeric_column(frame, "host_acceptance_rate_filled"),
                _numeric_column(frame, "host_response_time_filled"),
                _numeric_column(frame, "host_is_superhost_filled"),
                _numeric_column(frame, "host_identity_verified_filled"),
            ],
            axis=1,
        ).mean(axis=1)
        property_mix = pd.concat(
            [
                _numeric_column(frame, "is_apartment", 0.0),
                _numeric_column(frame, "is_house", 0.0),
                _numeric_column(frame, "is_unique", 0.0),
                _numeric_column(frame, "is_hotel", 0.0),
            ],
            axis=1,
        ).max(axis=1)
        affordability = 1.0 - (price - 0.45).abs()
        score = (
            0.27 * amenities
            + 0.22 * host
            + 0.16 * availability
            + 0.14 * space
            + 0.11 * minimum_nights
            + 0.06 * property_mix
            + 0.04 * affordability
        )
        return score.clip(0.0, 1.0).to_numpy()


class HeuristicPreferenceModel:
    """Last-resort user/property match scorer used when the artifact is unavailable."""

    def predict(self, features: Any) -> np.ndarray:
        frame = pd.DataFrame(features)

        price_fit = 1.0 - (_numeric_column(frame, "property_price_norm") - _numeric_column(frame, "user_avg_price")).abs()
        space_fit = pd.concat(
            [
                1.0
                - (
                    _numeric_column(frame, "property_accommodates_norm")
                    - _numeric_column(frame, "user_avg_accommodates")
                ).abs(),
                1.0
                - (
                    _numeric_column(frame, "property_bathrooms_norm")
                    - _numeric_column(frame, "user_avg_bathrooms")
                ).abs(),
                1.0
                - (
                    _numeric_column(frame, "property_bedrooms_norm")
                    - _numeric_column(frame, "user_avg_bedrooms")
                ).abs(),
                1.0
                - (_numeric_column(frame, "property_beds_norm") - _numeric_column(frame, "user_avg_beds")).abs(),
            ],
            axis=1,
        ).mean(axis=1)
        night_fit = 1.0 - (
            _numeric_column(frame, "property_minimum_nights_norm")
            - _numeric_column(frame, "user_avg_minimum_nights")
        ).abs()
        amenity_fit = 1.0 - (
            _numeric_column(frame, "property_amenities_weight_norm") - _numeric_column(frame, "user_avg_amenities")
        ).abs()
        rating = _numeric_column(frame, "property_review_scores_rating_norm")
        event_signal = (
            np.log1p(_numeric_column(frame, "user_total_events", 0.0)) / np.log1p(50.0) * 0.08
            + _numeric_column(frame, "user_strong_interaction_rate", 0.0) * 0.07
            + _numeric_column(frame, "user_avg_final_event_weight", 0.0).clip(0.0, 5.0) / 5.0 * 0.05
        ).clip(0.0, 0.2)

        user_type = _text_column(frame, "user_type")
        property_group = _text_column(frame, "property_group")
        type_bonus = pd.Series(0.0, index=frame.index, dtype="float64")
        type_bonus += np.where(user_type.str.contains("budget"), (1.0 - _numeric_column(frame, "property_price_norm")) * 0.08, 0.0)
        type_bonus += np.where(user_type.str.contains("luxury"), (rating + _numeric_column(frame, "property_amenities_weight_norm")) * 0.04, 0.0)
        type_bonus += np.where(user_type.str.contains("family|large"), space_fit * 0.06, 0.0)
        type_bonus += np.where(
            user_type.str.contains("business") & property_group.isin(["hotel", "apartment"]),
            0.05,
            0.0,
        )
        type_bonus += np.where(
            user_type.str.contains("couple") & property_group.isin(["apartment", "unique", "nature"]),
            0.04,
            0.0,
        )

        score = (
            0.30 * price_fit.clip(0.0, 1.0)
            + 0.24 * space_fit.clip(0.0, 1.0)
            + 0.14 * night_fit.clip(0.0, 1.0)
            + 0.14 * amenity_fit.clip(0.0, 1.0)
            + 0.18 * rating.clip(0.0, 1.0)
            + event_signal
            + type_bonus.clip(0.0, 0.12)
        )
        return score.clip(0.0, 1.0).to_numpy()


class ModelRegistry:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._review_payload: tuple[float, dict[str, Any]] | None = None
        self._preference_payload: tuple[float, dict[str, Any]] | None = None

    def review_model(self) -> dict[str, Any]:
        if self._needs_reload(self._review_payload):
            self._review_payload = (
                time.monotonic(),
                self._load_payload(
                    task_id=self.settings.clearml_review_task_id,
                    project_name=self.settings.clearml_project_review,
                    task_name=self.settings.clearml_review_task_name,
                    tags=["review_score_rating"],
                    artifact_name=self.settings.clearml_review_artifact_name,
                    local_path=self.settings.review_model_local_path,
                    label="review score rating",
                    fallback_model=HeuristicReviewScoreModel(),
                ),
            )
        return self._review_payload[1]

    def preference_model(self) -> dict[str, Any]:
        if self._needs_reload(self._preference_payload):
            self._preference_payload = (
                time.monotonic(),
                self._load_payload(
                    task_id=self.settings.clearml_preference_task_id,
                    project_name=self.settings.clearml_project_preference,
                    task_name=self.settings.clearml_preference_task_name,
                    tags=["user_preference"],
                    artifact_name=self.settings.clearml_preference_artifact_name,
                    local_path=self.settings.preference_model_local_path,
                    label="user preference",
                    fallback_model=HeuristicPreferenceModel(),
                ),
            )
        return self._preference_payload[1]

    def _needs_reload(self, cached: tuple[float, dict[str, Any]] | None) -> bool:
        if cached is None:
            return True
        loaded_at, _ = cached
        return time.monotonic() - loaded_at >= self.settings.model_cache_seconds

    def _resolve_local_path(self, path: Path) -> Path:
        return path if path.is_absolute() else self.settings.workspace_dir / path

    def _load_payload(
        self,
        *,
        task_id: str | None,
        project_name: str,
        task_name: str,
        tags: list[str],
        artifact_name: str,
        local_path: Path,
        label: str,
        fallback_model: Any,
    ) -> dict[str, Any]:
        if self.settings.force_heuristic_model_fallback:
            return self._fallback_payload(
                label,
                fallback_model,
                RuntimeError("FORCE_HEURISTIC_MODEL_FALLBACK is enabled"),
            )

        if self.settings.prefer_clearml_artifacts:
            try:
                task = self._get_clearml_task(
                    task_id=task_id,
                    project_name=project_name,
                    task_name=task_name,
                    tags=tags,
                    artifact_name=artifact_name,
                )
                artifact = task.artifacts.get(artifact_name)
                if artifact is None:
                    raise KeyError(f"artifact {artifact_name!r} was not found on ClearML task {task.id}")
                downloaded_path = artifact.get_local_copy()
                print(f"Loaded {label} model artifact from ClearML task {task.id}: {artifact_name}")
                return self._with_model_source(joblib.load(downloaded_path), f"clearml:{task.id}")
            except Exception as exc:
                print(f"Could not load {label} model from ClearML; falling back to local artifact: {exc}")

        resolved = self._resolve_local_path(local_path)
        if not resolved.exists():
            reason = FileNotFoundError(f"{label} model artifact not found: {resolved}")
            return self._fallback_payload(label, fallback_model, reason)
        try:
            print(f"Loaded {label} model artifact from local path: {resolved}")
            return self._with_model_source(joblib.load(resolved), "local_artifact")
        except Exception as exc:
            return self._fallback_payload(label, fallback_model, exc)

    def _with_model_source(self, payload: dict[str, Any], source: str) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise TypeError(f"model artifact payload must be a dict, got {type(payload).__name__}")
        payload.setdefault("model_source", source)
        return payload

    def _fallback_payload(self, label: str, model: Any, reason: Exception) -> dict[str, Any]:
        print(f"Could not load {label} model artifact; using heuristic fallback scorer: {reason}")
        return {
            "model": model,
            "model_source": "heuristic_fallback",
            "fallback_reason": f"{type(reason).__name__}: {reason}",
        }

    def source_summary(self) -> str:
        parts = []
        if self._review_payload is not None:
            parts.append(f"review={self._review_payload[1].get('model_source', 'unknown')}")
        if self._preference_payload is not None:
            parts.append(f"preference={self._preference_payload[1].get('model_source', 'unknown')}")
        if parts:
            return ",".join(parts)
        if self.settings.prefer_clearml_artifacts:
            return "clearml_with_local_fallback"
        return "local"

    def _get_clearml_task(
        self,
        *,
        task_id: str | None,
        project_name: str,
        task_name: str,
        tags: list[str],
        artifact_name: str,
    ) -> Any:
        from clearml import Task

        if task_id and not self.settings.clearml_use_latest_artifacts:
            return Task.get_task(task_id=task_id)

        tasks = Task.get_tasks(
            project_name=project_name,
            task_name=task_name,
            tags=tags,
            allow_archived=False,
        )
        candidates = []
        for task in tasks:
            status = getattr(task, "status", "")
            status_value = getattr(status, "value", status)
            if str(status_value).lower() not in {"completed", "closed", "published"}:
                continue
            if artifact_name not in getattr(task, "artifacts", {}):
                continue
            candidates.append(task)
        if not candidates:
            raise LookupError(
                f"No completed ClearML task in project {project_name!r} matched {task_name!r} "
                f"with artifact {artifact_name!r}.",
            )
        return sorted(candidates, key=self._task_sort_key, reverse=True)[0]

    def _task_sort_key(self, task: Any) -> str:
        data = getattr(task, "data", None)
        for attr in ("completed", "started", "created", "last_update"):
            value = getattr(data, attr, None)
            if value:
                return str(value)
        return str(getattr(task, "id", ""))
