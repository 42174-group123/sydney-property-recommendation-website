from __future__ import annotations

import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
os.environ.setdefault("MPLCONFIGDIR", str(Path.cwd() / ".matplotlib"))
os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (
    ExtraTreesRegressor,
    GradientBoostingRegressor,
    HistGradientBoostingRegressor,
    RandomForestRegressor,
)
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import RandomizedSearchCV, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.tree import DecisionTreeRegressor

from .clearml_utils import ClearMLRun, init_clearml_run, write_json
from .config import Settings
from .features.review_rating import REVIEW_FEATURE_COLUMNS, build_review_dataset
from .features.user_preference import (
    PREFERENCE_CATEGORICAL_FEATURES,
    PREFERENCE_NUMERIC_FEATURES,
    PREFERENCE_TARGET_COLUMN,
    build_user_preference_dataset,
    feature_schema,
)


@dataclass
class TrainingOutput:
    model_path: Path
    metrics_path: Path
    info_path: Path
    best_model_name: str
    best_metrics: dict[str, Any]


@dataclass
class ReviewTrainingOutput(TrainingOutput):
    pass


def _make_one_hot_encoder() -> OneHotEncoder:
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:  # scikit-learn < 1.2
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def _prepare_dirs(base_dir: Path) -> tuple[Path, Path, Path]:
    plots_dir = base_dir / "plots"
    models_dir = base_dir / "models"
    outputs_dir = base_dir / "outputs"
    plots_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)
    outputs_dir.mkdir(parents=True, exist_ok=True)
    return outputs_dir, models_dir, plots_dir


def _save_current_figure(run: ClearMLRun, title: str, series: str, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(output_path, dpi=180, bbox_inches="tight")
    plt.close()
    run.report_image(title, series, output_path)
    run.upload_artifact(output_path.stem, output_path)


def _plot_metric_bar(metrics_df: pd.DataFrame, metric: str, output_path: Path, run: ClearMLRun) -> None:
    lower_is_better = metric in {"mse", "rmse", "mae", "cv_rmse", "cv_mae"}
    plot_df = metrics_df.sort_values(metric, ascending=not lower_is_better)
    plt.figure(figsize=(10, 5))
    bars = plt.barh(plot_df["model"], plot_df[metric])
    direction = "lower is better" if lower_is_better else "higher is better"
    plt.title(f"Model Comparison by {metric.upper()} ({direction})")
    plt.xlabel(metric.upper())
    plt.ylabel("Model")
    span = max(float(plot_df[metric].max() - plot_df[metric].min()), 1e-6)
    for bar in bars:
        width = bar.get_width()
        plt.text(width + span * 0.01, bar.get_y() + bar.get_height() / 2, f"{width:.4f}", va="center")
    _save_current_figure(run, f"Model Comparison by {metric.upper()}", "model_comparison", output_path)


def _plot_hpo_trials(hpo_df: pd.DataFrame, title_prefix: str, output_path: Path, run: ClearMLRun) -> None:
    if "mean_test_score" not in hpo_df.columns:
        return
    plot_df = hpo_df.copy()
    scores = pd.to_numeric(plot_df["mean_test_score"], errors="coerce")
    plot_df["cv_rmse"] = np.sqrt((-scores).clip(lower=0.0))
    plot_df = plot_df.dropna(subset=["cv_rmse"]).sort_values("cv_rmse").head(30)
    if plot_df.empty:
        return
    labels = plot_df["model"].astype(str) + " trial " + plot_df.index.astype(str)
    plt.figure(figsize=(10, 8))
    plt.barh(labels.iloc[::-1], plot_df["cv_rmse"].iloc[::-1])
    plt.title(f"{title_prefix}: Top HPO Trials by CV RMSE")
    plt.xlabel("CV RMSE (lower is better)")
    plt.ylabel("Trial")
    _save_current_figure(run, f"{title_prefix} Top HPO Trials", "hpo", output_path)


def _plot_residuals(y_true: pd.Series, y_pred: np.ndarray, title_prefix: str, plots_dir: Path, run: ClearMLRun) -> None:
    residuals = y_true.to_numpy() - y_pred
    plt.figure(figsize=(6, 6))
    plt.scatter(y_true, y_pred, alpha=0.35)
    plt.plot([0, 1], [0, 1], linestyle="--")
    plt.title(f"{title_prefix}: Actual vs Predicted")
    plt.xlabel("Actual")
    plt.ylabel("Predicted")
    _save_current_figure(run, f"{title_prefix} Actual vs Predicted", "diagnostic", plots_dir / "actual_vs_predicted.png")

    plt.figure(figsize=(8, 4))
    plt.hist(residuals, bins=40)
    plt.title(f"{title_prefix}: Residual Distribution")
    plt.xlabel("Residual")
    plt.ylabel("Samples")
    _save_current_figure(run, f"{title_prefix} Residual Distribution", "diagnostic", plots_dir / "residual_distribution.png")

    plt.figure(figsize=(8, 4))
    plt.scatter(y_pred, residuals, alpha=0.35)
    plt.axhline(0, linestyle="--")
    plt.title(f"{title_prefix}: Residuals vs Predicted")
    plt.xlabel("Predicted")
    plt.ylabel("Residual")
    _save_current_figure(run, f"{title_prefix} Residuals vs Predicted", "diagnostic", plots_dir / "residuals_vs_predicted.png")


def _plot_feature_importance(
    feature_names: list[str],
    importances: np.ndarray,
    output_path: Path,
    run: ClearMLRun,
    title: str,
    top_n: int = 25,
) -> pd.DataFrame:
    feature_df = pd.DataFrame({"feature": feature_names, "importance": importances})
    feature_df = feature_df.sort_values("importance", ascending=False).reset_index(drop=True)
    top = feature_df.head(top_n).iloc[::-1]
    plt.figure(figsize=(10, 8))
    plt.barh(top["feature"], top["importance"])
    plt.title(title)
    plt.xlabel("Importance")
    _save_current_figure(run, title, "feature_importance", output_path)
    return feature_df


def _evaluate_predictions(y_test: pd.Series, y_pred: np.ndarray) -> dict[str, float]:
    y_pred = np.clip(y_pred, 0.0, 1.0)
    mse = mean_squared_error(y_test, y_pred)
    return {
        "mse": float(mse),
        "rmse": float(math.sqrt(mse)),
        "mae": float(mean_absolute_error(y_test, y_pred)),
        "r2": float(r2_score(y_test, y_pred)),
        "prediction_min": float(np.min(y_pred)),
        "prediction_max": float(np.max(y_pred)),
        "prediction_mean": float(np.mean(y_pred)),
    }


def _param_space_size(param_space: dict[str, list[Any]]) -> int:
    total = 1
    for values in param_space.values():
        total *= max(len(values), 1)
    return total


def _fit_with_hpo(
    *,
    model_name: str,
    estimator: Pipeline,
    param_space: dict[str, list[Any]],
    X_train: pd.DataFrame,
    y_train: pd.Series,
    settings: Settings,
) -> tuple[Pipeline, dict[str, Any], pd.DataFrame]:
    if param_space:
        search = RandomizedSearchCV(
            estimator=estimator,
            param_distributions=param_space,
            n_iter=min(settings.hpo_iterations, _param_space_size(param_space)),
            scoring="neg_mean_squared_error",
            cv=settings.cv_folds,
            random_state=settings.random_state,
            n_jobs=settings.train_n_jobs,
            refit=True,
            return_train_score=True,
        )
        search.fit(X_train, y_train)
        hpo_df = pd.DataFrame(search.cv_results_)
        hpo_df["model"] = model_name
        return search.best_estimator_, search.best_params_, hpo_df

    estimator.fit(X_train, y_train)
    scores = cross_val_score(
        estimator,
        X_train,
        y_train,
        scoring="neg_mean_squared_error",
        cv=settings.cv_folds,
        n_jobs=settings.train_n_jobs,
    )
    hpo_df = pd.DataFrame(
        {
            "model": [model_name],
            "mean_test_score": [float(scores.mean())],
            "std_test_score": [float(scores.std())],
            "params": [{}],
        },
    )
    return estimator, {}, hpo_df


def _review_candidates(settings: Settings) -> dict[str, tuple[Pipeline, dict[str, list[Any]]]]:
    random_state = settings.random_state
    return {
        "LinearRegression": (Pipeline([("model", LinearRegression())]), {}),
        "Ridge": (
            Pipeline([("scaler", StandardScaler()), ("model", Ridge(random_state=random_state))]),
            {"model__alpha": [0.01, 0.1, 1.0, 3.0, 10.0, 30.0]},
        ),
        "DecisionTree": (
            Pipeline([("model", DecisionTreeRegressor(random_state=random_state))]),
            {
                "model__max_depth": [4, 6, 8, 12, None],
                "model__min_samples_leaf": [1, 3, 5, 10],
            },
        ),
        "RandomForest": (
            Pipeline([("model", RandomForestRegressor(random_state=random_state, n_jobs=settings.train_n_jobs))]),
            {
                "model__n_estimators": [120, 200, 350],
                "model__max_depth": [8, 12, 18, None],
                "model__min_samples_leaf": [1, 2, 4],
                "model__max_features": ["sqrt", 0.7, 1.0],
            },
        ),
        "ExtraTrees": (
            Pipeline([("model", ExtraTreesRegressor(random_state=random_state, n_jobs=settings.train_n_jobs))]),
            {
                "model__n_estimators": [120, 200, 350],
                "model__max_depth": [8, 12, 18, None],
                "model__min_samples_leaf": [1, 2, 4],
                "model__max_features": ["sqrt", 0.7, 1.0],
            },
        ),
        "GradientBoosting": (
            Pipeline([("model", GradientBoostingRegressor(random_state=random_state))]),
            {
                "model__n_estimators": [100, 200, 350],
                "model__learning_rate": [0.03, 0.05, 0.08, 0.12],
                "model__max_depth": [2, 3, 4],
                "model__subsample": [0.7, 0.9, 1.0],
            },
        ),
        "HistGradientBoosting": (
            Pipeline([("model", HistGradientBoostingRegressor(random_state=random_state))]),
            {
                "model__learning_rate": [0.03, 0.05, 0.08, 0.12],
                "model__max_iter": [100, 200, 350],
                "model__max_leaf_nodes": [15, 31, 63],
                "model__l2_regularization": [0.0, 0.01, 0.1],
            },
        ),
    }


def train_review_score_model(
    listings: pd.DataFrame,
    *,
    settings: Settings,
    run_id: str,
    run_dir: Path,
) -> ReviewTrainingOutput:
    outputs_dir, models_dir, plots_dir = _prepare_dirs(run_dir / "review_score_rating")
    run = init_clearml_run(
        enabled=settings.enable_clearml,
        project_name=settings.clearml_project_review,
        task_name=f"Review Score Rating Training {run_id}",
        tags=["scheduled", "review_score_rating", run_id],
        output_uri=settings.clearml_output_uri,
    )
    run.connect_params(
        {
            "run_id": run_id,
            "hpo_iterations": settings.hpo_iterations,
            "train_n_jobs": settings.train_n_jobs,
            "cv_folds": settings.cv_folds,
            "test_size": settings.test_size,
            "target": "review_scores_rating_norm",
        },
    )

    dataset = build_review_dataset(listings)
    dataset_path = outputs_dir / "review_training_dataset.csv"
    dataset.to_csv(dataset_path, index=False)
    run.upload_artifact("review_training_dataset", dataset_path)
    run.upload_artifact("processed_dataset", dataset_path)

    labeled = dataset[dataset["has_real_rating"] == 1].copy()
    if len(labeled) < 20:
        raise ValueError(f"Need at least 20 labeled review ratings, found {len(labeled)}.")

    X = labeled[REVIEW_FEATURE_COLUMNS]
    y = labeled["review_scores_rating_norm"]
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=settings.test_size,
        random_state=settings.random_state,
    )

    results: list[dict[str, Any]] = []
    hpo_tables: list[pd.DataFrame] = []
    trained_models: dict[str, Pipeline] = {}
    predictions: dict[str, np.ndarray] = {}

    for model_name, (estimator, param_space) in _review_candidates(settings).items():
        best_estimator, best_params, hpo_df = _fit_with_hpo(
            model_name=model_name,
            estimator=estimator,
            param_space=param_space,
            X_train=X_train,
            y_train=y_train,
            settings=settings,
        )
        y_pred = np.clip(best_estimator.predict(X_test), 0.0, 1.0)
        metrics = _evaluate_predictions(y_test, y_pred)
        best_cv_rmse = math.sqrt(max(-float(hpo_df["mean_test_score"].max()), 0.0))
        metrics.update({"model": model_name, "cv_rmse": best_cv_rmse, "best_params": best_params})
        results.append(metrics)
        hpo_tables.append(hpo_df)
        trained_models[model_name] = best_estimator
        predictions[model_name] = y_pred
        for metric_name in ["rmse", "mae", "r2", "cv_rmse"]:
            run.report_scalar(metric_name, model_name, float(metrics[metric_name]))

    metrics_df = pd.DataFrame(results).sort_values(["cv_rmse", "rmse", "mae"]).reset_index(drop=True)
    metrics_path = outputs_dir / "review_model_metrics.csv"
    metrics_df.to_csv(metrics_path, index=False)
    run.report_table("Review Model Comparison", "metrics", metrics_df)
    run.upload_artifact("review_model_metrics", metrics_path)
    run.upload_artifact("metrics_summary", metrics_path)

    hpo_df = pd.concat(hpo_tables, ignore_index=True)
    hpo_path = outputs_dir / "review_hpo_results.csv"
    hpo_df.to_csv(hpo_path, index=False)
    run.report_table("Review HPO Results", "cv_results", hpo_df[["model", "mean_test_score", "std_test_score", "params"]])
    run.upload_artifact("review_hpo_results", hpo_path)
    run.upload_artifact("hpo_results", hpo_path)
    _plot_hpo_trials(hpo_df, "Review Rating", plots_dir / "review_hpo_top_trials.png", run)

    for metric in ["cv_rmse", "rmse", "mae", "r2"]:
        _plot_metric_bar(metrics_df, metric, plots_dir / f"review_model_comparison_{metric}.png", run)

    best_model_name = str(metrics_df.iloc[0]["model"])
    best_model = trained_models[best_model_name]
    best_y_pred = predictions[best_model_name]
    _plot_residuals(y_test, best_y_pred, "Review Rating", plots_dir, run)

    final_model = clone(best_model)
    final_model.fit(dataset.loc[dataset["has_real_rating"] == 1, REVIEW_FEATURE_COLUMNS], y)

    model_payload = {
        "model": final_model,
        "feature_columns": REVIEW_FEATURE_COLUMNS,
        "target": "review_scores_rating_norm",
        "target_scale": "0-1 normalized review score; inference backend should inverse-transform to the original 1-5 score when needed.",
        "inference_note": "This training backend only registers the model. Missing review-score inference happens later in the production backend.",
    }
    model_path = models_dir / "review_score_rating_model.joblib"
    joblib.dump(model_payload, model_path)
    run.upload_artifact("best_review_score_rating_model", model_path)
    run.upload_artifact("best_model", model_path)

    regressor = final_model.named_steps.get("model") if isinstance(final_model, Pipeline) else final_model
    if hasattr(regressor, "feature_importances_"):
        feature_df = _plot_feature_importance(
            REVIEW_FEATURE_COLUMNS,
            regressor.feature_importances_,
            plots_dir / "review_feature_importance.png",
            run,
            "Review Rating Feature Importance",
        )
        feature_path = outputs_dir / "review_feature_importance.csv"
        feature_df.to_csv(feature_path, index=False)
        run.report_table("Review Feature Importance", "top_features", feature_df.head(30))
        run.upload_artifact("review_feature_importance", feature_path)

    best_metrics = metrics_df.iloc[0].to_dict()
    info = {
        "run_id": run_id,
        "best_model_name": best_model_name,
        "selection_metric": "lowest_cv_rmse_then_rmse_then_mae",
        "best_metrics": best_metrics,
        "labeled_rows": int(len(labeled)),
        "unlabeled_rows_excluded_from_training": int((dataset["has_real_rating"] == 0).sum()),
        "feature_columns": REVIEW_FEATURE_COLUMNS,
    }
    info_path = outputs_dir / "review_best_model_info.json"
    write_json(info_path, info)
    run.upload_artifact("review_best_model_info", info_path)
    run.upload_artifact("best_model_info", info_path)
    run.close()

    return ReviewTrainingOutput(
        model_path=model_path,
        metrics_path=metrics_path,
        info_path=info_path,
        best_model_name=best_model_name,
        best_metrics=best_metrics,
    )


def _preference_candidates(settings: Settings) -> dict[str, tuple[Pipeline, dict[str, list[Any]]]]:
    random_state = settings.random_state
    tree_preprocessor = ColumnTransformer(
        transformers=[
            ("cat", _make_one_hot_encoder(), PREFERENCE_CATEGORICAL_FEATURES),
            ("num", "passthrough", PREFERENCE_NUMERIC_FEATURES),
        ],
    )
    scaled_preprocessor = ColumnTransformer(
        transformers=[
            ("cat", _make_one_hot_encoder(), PREFERENCE_CATEGORICAL_FEATURES),
            ("num", StandardScaler(), PREFERENCE_NUMERIC_FEATURES),
        ],
    )
    return {
        "LinearRegression": (
            Pipeline([("preprocessor", scaled_preprocessor), ("regressor", LinearRegression())]),
            {},
        ),
        "Ridge": (
            Pipeline([("preprocessor", scaled_preprocessor), ("regressor", Ridge(random_state=random_state))]),
            {"regressor__alpha": [0.01, 0.1, 1.0, 3.0, 10.0, 30.0]},
        ),
        "DecisionTree": (
            Pipeline([("preprocessor", tree_preprocessor), ("regressor", DecisionTreeRegressor(random_state=random_state))]),
            {
                "regressor__max_depth": [4, 6, 8, 12, None],
                "regressor__min_samples_leaf": [1, 3, 5, 10],
            },
        ),
        "RandomForest": (
            Pipeline([("preprocessor", tree_preprocessor), ("regressor", RandomForestRegressor(random_state=random_state, n_jobs=settings.train_n_jobs))]),
            {
                "regressor__n_estimators": [120, 200, 350],
                "regressor__max_depth": [8, 12, 18, None],
                "regressor__min_samples_leaf": [1, 2, 4],
                "regressor__max_features": ["sqrt", 0.7, 1.0],
            },
        ),
        "ExtraTrees": (
            Pipeline([("preprocessor", tree_preprocessor), ("regressor", ExtraTreesRegressor(random_state=random_state, n_jobs=settings.train_n_jobs))]),
            {
                "regressor__n_estimators": [120, 200, 350],
                "regressor__max_depth": [8, 12, 18, None],
                "regressor__min_samples_leaf": [1, 2, 4],
                "regressor__max_features": ["sqrt", 0.7, 1.0],
            },
        ),
        "GradientBoosting": (
            Pipeline([("preprocessor", tree_preprocessor), ("regressor", GradientBoostingRegressor(random_state=random_state))]),
            {
                "regressor__n_estimators": [100, 200, 350],
                "regressor__learning_rate": [0.03, 0.05, 0.08, 0.12],
                "regressor__max_depth": [2, 3, 4],
                "regressor__subsample": [0.7, 0.9, 1.0],
            },
        ),
        "HistGradientBoosting": (
            Pipeline([("preprocessor", tree_preprocessor), ("regressor", HistGradientBoostingRegressor(random_state=random_state))]),
            {
                "regressor__learning_rate": [0.03, 0.05, 0.08, 0.12],
                "regressor__max_iter": [100, 200, 350],
                "regressor__max_leaf_nodes": [15, 31, 63],
                "regressor__l2_regularization": [0.0, 0.01, 0.1],
            },
        ),
    }


def _pipeline_feature_names(pipeline: Pipeline) -> list[str]:
    preprocessor = pipeline.named_steps["preprocessor"]
    feature_names: list[str] = []
    cat_transformer = preprocessor.named_transformers_.get("cat")
    if cat_transformer is not None:
        try:
            feature_names.extend(
                cat_transformer.get_feature_names_out(PREFERENCE_CATEGORICAL_FEATURES).tolist(),
            )
        except Exception:
            feature_names.extend(PREFERENCE_CATEGORICAL_FEATURES)
    feature_names.extend(PREFERENCE_NUMERIC_FEATURES)
    return feature_names


def train_user_preference_model(
    listings_with_review_scores: pd.DataFrame,
    actions: pd.DataFrame,
    *,
    settings: Settings,
    run_id: str,
    run_dir: Path,
) -> TrainingOutput:
    outputs_dir, models_dir, plots_dir = _prepare_dirs(run_dir / "user_preference")
    run = init_clearml_run(
        enabled=settings.enable_clearml,
        project_name=settings.clearml_project_preference,
        task_name=f"User Preference Training {run_id}",
        tags=["scheduled", "user_preference", run_id],
        output_uri=settings.clearml_output_uri,
    )
    run.connect_params(
        {
            "run_id": run_id,
            "hpo_iterations": settings.hpo_iterations,
            "train_n_jobs": settings.train_n_jobs,
            "cv_folds": settings.cv_folds,
            "test_size": settings.test_size,
            "target": PREFERENCE_TARGET_COLUMN,
            "label_strategy": "event_type_strength_plus_recency",
        },
    )

    dataset, user_features, listing_features = build_user_preference_dataset(
        listings_with_review_scores,
        actions,
    )

    dataset_path = outputs_dir / "user_preference_training_dataset.csv"
    user_features_path = outputs_dir / "user_features.csv"
    listing_features_path = outputs_dir / "listing_features_for_preference.csv"
    schema_path = outputs_dir / "user_preference_feature_schema.json"
    dataset.to_csv(dataset_path, index=False)
    user_features.to_csv(user_features_path, index=False)
    listing_features.to_csv(listing_features_path, index=False)
    write_json(schema_path, feature_schema())
    run.upload_artifact("user_preference_training_dataset", dataset_path)
    run.upload_artifact("preference_model_dataset", dataset_path)
    run.upload_artifact("user_features", user_features_path)
    run.upload_artifact("listing_features_for_preference", listing_features_path)
    run.upload_artifact("user_preference_feature_schema", schema_path)
    run.upload_artifact("feature_schema", schema_path)

    X = dataset[PREFERENCE_NUMERIC_FEATURES + PREFERENCE_CATEGORICAL_FEATURES].copy()
    y = pd.to_numeric(dataset[PREFERENCE_TARGET_COLUMN], errors="coerce")
    valid_mask = y.notna()
    X = X.loc[valid_mask]
    y = y.loc[valid_mask]
    if len(X) < 20:
        raise ValueError(f"Need at least 20 user preference rows, found {len(X)}.")

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=settings.test_size,
        random_state=settings.random_state,
    )

    results: list[dict[str, Any]] = []
    hpo_tables: list[pd.DataFrame] = []
    trained_models: dict[str, Pipeline] = {}
    predictions: dict[str, np.ndarray] = {}

    for model_name, (estimator, param_space) in _preference_candidates(settings).items():
        best_estimator, best_params, hpo_df = _fit_with_hpo(
            model_name=model_name,
            estimator=estimator,
            param_space=param_space,
            X_train=X_train,
            y_train=y_train,
            settings=settings,
        )
        y_pred = np.clip(best_estimator.predict(X_test), 0.0, 1.0)
        metrics = _evaluate_predictions(y_test, y_pred)
        best_cv_rmse = math.sqrt(max(-float(hpo_df["mean_test_score"].max()), 0.0))
        metrics.update({"model": model_name, "cv_rmse": best_cv_rmse, "best_params": best_params})
        results.append(metrics)
        hpo_tables.append(hpo_df)
        trained_models[model_name] = best_estimator
        predictions[model_name] = y_pred
        for metric_name in ["rmse", "mae", "r2", "cv_rmse"]:
            run.report_scalar(metric_name, model_name, float(metrics[metric_name]))

    metrics_df = pd.DataFrame(results).sort_values(["cv_rmse", "rmse", "mae"]).reset_index(drop=True)
    metrics_path = outputs_dir / "user_preference_model_metrics.csv"
    metrics_df.to_csv(metrics_path, index=False)
    run.report_table("User Preference Model Comparison", "metrics", metrics_df)
    run.upload_artifact("user_preference_model_metrics", metrics_path)
    run.upload_artifact("metrics_summary", metrics_path)

    hpo_df = pd.concat(hpo_tables, ignore_index=True)
    hpo_path = outputs_dir / "user_preference_hpo_results.csv"
    hpo_df.to_csv(hpo_path, index=False)
    run.report_table(
        "User Preference HPO Results",
        "cv_results",
        hpo_df[["model", "mean_test_score", "std_test_score", "params"]],
    )
    run.upload_artifact("user_preference_hpo_results", hpo_path)
    run.upload_artifact("hpo_results", hpo_path)
    _plot_hpo_trials(hpo_df, "User Preference", plots_dir / "user_preference_hpo_top_trials.png", run)

    for metric in ["cv_rmse", "rmse", "mae", "r2"]:
        _plot_metric_bar(metrics_df, metric, plots_dir / f"user_preference_model_comparison_{metric}.png", run)

    best_model_name = str(metrics_df.iloc[0]["model"])
    best_model = trained_models[best_model_name]
    best_y_pred = predictions[best_model_name]
    _plot_residuals(y_test, best_y_pred, "User Preference", plots_dir, run)

    test_predictions = X_test.copy()
    test_predictions["actual_preference_score"] = y_test.values
    test_predictions["predicted_preference_score"] = best_y_pred
    test_predictions["residual"] = test_predictions["actual_preference_score"] - test_predictions["predicted_preference_score"]
    test_predictions_path = outputs_dir / "user_preference_test_predictions.csv"
    test_predictions.to_csv(test_predictions_path, index=False)
    run.upload_artifact("user_preference_test_predictions", test_predictions_path)
    run.upload_artifact("test_prediction_samples", test_predictions_path)
    run.report_table("User Preference Example Predictions", best_model_name, test_predictions.head(30))

    final_model = clone(best_model)
    final_model.fit(X, y)
    model_payload = {
        "model": final_model,
        "numeric_features": PREFERENCE_NUMERIC_FEATURES,
        "categorical_features": PREFERENCE_CATEGORICAL_FEATURES,
        "target": PREFERENCE_TARGET_COLUMN,
        "label_strategy": "preference_score = 1 - exp(-(sum_final_event_weight + strongest_event_weight) / 6)",
        "inference_note": "Build user features from canonical user_action rows, join candidate listing features, predict, then clip to [0, 1].",
    }
    model_path = models_dir / "user_preference_model.joblib"
    joblib.dump(model_payload, model_path)
    run.upload_artifact("best_user_preference_model", model_path)
    run.upload_artifact("best_user_preference_model_refit_full_dataset", model_path)
    run.upload_artifact("best_model", model_path)

    regressor = final_model.named_steps["regressor"]
    if hasattr(regressor, "feature_importances_"):
        feature_df = _plot_feature_importance(
            _pipeline_feature_names(final_model),
            regressor.feature_importances_,
            plots_dir / "user_preference_feature_importance.png",
            run,
            "User Preference Feature Importance",
        )
        feature_path = outputs_dir / "user_preference_feature_importance.csv"
        feature_df.to_csv(feature_path, index=False)
        run.report_table("User Preference Feature Importance", "top_features", feature_df.head(30))
        run.upload_artifact("user_preference_feature_importance", feature_path)

    plt.figure(figsize=(8, 4))
    dataset[PREFERENCE_TARGET_COLUMN].hist(bins=40)
    plt.title("User Preference Target Distribution")
    plt.xlabel("Preference Score")
    plt.ylabel("User-Property Pairs")
    _save_current_figure(run, "User Preference Target Distribution", "target", plots_dir / "preference_target_distribution.png")

    event_counts = actions["event_type"].value_counts().reset_index()
    event_counts.columns = ["event_type", "count"]
    run.report_table("Canonical Event Counts", "event_type", event_counts)
    plt.figure(figsize=(9, 4))
    plt.bar(event_counts["event_type"], event_counts["count"])
    plt.title("Canonical Event Type Distribution")
    plt.xticks(rotation=35, ha="right")
    plt.ylabel("Events")
    _save_current_figure(run, "Canonical Event Type Distribution", "event_type", plots_dir / "event_type_distribution.png")

    best_metrics = metrics_df.iloc[0].to_dict()
    info = {
        "run_id": run_id,
        "best_model_name": best_model_name,
        "selection_metric": "lowest_cv_rmse_then_rmse_then_mae",
        "best_metrics": best_metrics,
        "rows": int(len(X)),
        "unique_users": int(dataset["user_id"].nunique()),
        "unique_properties": int(dataset["property_id"].nunique()),
        "numeric_features": PREFERENCE_NUMERIC_FEATURES,
        "categorical_features": PREFERENCE_CATEGORICAL_FEATURES,
        "final_score_recommendation": "overall_score = 0.6 * user_preference_score + 0.4 * review_quality_score",
    }
    info_path = outputs_dir / "user_preference_best_model_info.json"
    write_json(info_path, info)
    run.upload_artifact("user_preference_best_model_info", info_path)
    run.upload_artifact("best_model_info", info_path)
    run.close()

    return TrainingOutput(
        model_path=model_path,
        metrics_path=metrics_path,
        info_path=info_path,
        best_model_name=best_model_name,
        best_metrics=best_metrics,
    )
