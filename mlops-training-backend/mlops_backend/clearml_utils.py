from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd


@dataclass
class ClearMLRun:
    task: Any | None
    enabled: bool

    @property
    def logger(self) -> Any | None:
        if self.task is None:
            return None
        return self.task.get_logger()

    def report_scalar(self, title: str, series: str, value: float, iteration: int = 0) -> None:
        if self.logger is not None:
            self.logger.report_scalar(title, series, value, iteration=iteration)

    def report_table(self, title: str, series: str, table: pd.DataFrame, iteration: int = 0) -> None:
        if self.logger is not None:
            self.logger.report_table(title=title, series=series, iteration=iteration, table_plot=table)

    def report_image(self, title: str, series: str, image_path: Path, iteration: int = 0) -> None:
        if self.logger is not None:
            self.logger.report_image(
                title=title,
                series=series,
                iteration=iteration,
                local_path=str(image_path),
            )

    def upload_artifact(self, name: str, artifact: str | Path | dict[str, Any] | pd.DataFrame) -> None:
        if self.task is None:
            return
        if isinstance(artifact, Path):
            artifact = str(artifact)
        try:
            ok = self.task.upload_artifact(
                name=name,
                artifact_object=artifact,
                wait_on_upload=True,
                retries=2,
            )
            if ok is False:
                print(f"ClearML artifact upload returned false for {name}; continuing run.")
        except Exception as exc:
            print(f"ClearML artifact upload failed for {name}: {exc}; continuing run.")

    def connect_params(self, params: dict[str, Any]) -> None:
        if self.task is not None:
            self.task.connect(params)

    def close(self) -> None:
        if self.task is not None:
            try:
                self.task.flush(wait_for_uploads=False)
                self.task.mark_completed(ignore_errors=True)
                type(self.task)._reset_current_task_obj()
            except Exception as exc:
                print(f"ClearML task close failed: {exc}; continuing run.")


def init_clearml_run(
    *,
    enabled: bool,
    project_name: str,
    task_name: str,
    tags: list[str] | None = None,
    output_uri: str | None = None,
) -> ClearMLRun:
    if not enabled:
        return ClearMLRun(task=None, enabled=False)

    try:
        from clearml import Task

        task = Task.init(
            project_name=project_name,
            task_name=task_name,
            tags=tags,
            reuse_last_task_id=False,
            output_uri=output_uri,
            auto_resource_monitoring=False,
        )
        return ClearMLRun(task=task, enabled=True)
    except Exception as exc:  # ClearML should not prevent local dry-runs.
        print(f"ClearML disabled for this run because initialisation failed: {exc}")
        return ClearMLRun(task=None, enabled=False)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
