from __future__ import annotations

import argparse
from pathlib import Path

from mlops_backend.config import load_settings
from mlops_backend.pipeline import run_training_cycle


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one Stay Scout MLOps training cycle.")
    parser.add_argument("--listings-csv", type=Path, default=None)
    parser.add_argument("--actions-csv", type=Path, default=None)
    parser.add_argument("--run-id", default=None)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    settings = load_settings(root)
    result = run_training_cycle(
        settings,
        listings_csv=args.listings_csv,
        actions_csv=args.actions_csv,
        run_id=args.run_id,
    )

    print("Training cycle complete")
    print(f"Run ID: {result.run_id}")
    print(f"Run directory: {result.run_dir}")
    print(f"Review model: {result.review.best_model_name} -> {result.review.model_path}")
    print(f"Preference model: {result.preference.best_model_name} -> {result.preference.model_path}")


if __name__ == "__main__":
    main()

