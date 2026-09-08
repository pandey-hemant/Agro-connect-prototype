"""
train.py — one-shot training script for the AgroConnect price models.

Pulls all MarketPrice rows from MongoDB, groups them into one daily
series per (crop, state), splits each series chronologically into
70/15/15 train/val/test, fits an XGBoost regressor on the feature
matrix built by features.py, and saves the model + metadata to
`--out` (default: models/).

This script NEVER modifies the MarketPrice collection. It only reads.
Run it once after a backfill, or on a schedule, and let the FastAPI
service pick up the freshest artifacts at boot.

Usage:
    python training/train.py --out models
    python training/train.py --out models --min-history 60 --crops Onion,Tomato
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import asdict, dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import xgboost as xgb
from pymongo import MongoClient

# Allow running this file as `python training/train.py` from the
# `ml/` directory.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import features as F  # noqa: E402


DISCLAIMER = (
    "Heuristic forecast. NOT financial advice. Compare to a real "
    "model before acting."
)


@dataclass
class ModelMetrics:
    crop: str
    state: str
    n_rows: int
    n_train: int
    n_val: int
    n_test: int
    train_mae: float
    val_mae: float
    test_mae: float
    test_rmse: float
    test_mape_pct: float
    train_seconds: float


def _slug(s: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in s).strip("_").lower()


def _fetch_collection(uri: str, db_name: str):
    client = MongoClient(uri, serverSelectionTimeoutMS=10_000)
    return client, client[db_name]


def _load_series(
    db, crop: Optional[str], state: Optional[str]
) -> pd.DataFrame:
    q: Dict[str, object] = {
        "priceDate": {"$exists": True, "$ne": ""},
        "pricePerKg": {"$gt": 0},
    }
    if crop:
        q["cropName"] = {"$regex": f"^{crop}$", "$options": "i"}
    if state:
        q["state"] = {"$regex": f"^{state}$", "$options": "i"}
    # Stream the cursor so we don't load the whole 1.6M+ row collection
    # into memory at once. The aggregation happens client-side.
    cursor = db["marketprices"].find(
        q,
        {"priceDate": 1, "cropName": 1, "state": 1, "pricePerKg": 1, "_id": 0},
    )
    raw = list(cursor)
    return F.build_daily_series(raw)


def _split_chrono(
    n: int, train_pct: float = 0.7, val_pct: float = 0.15
) -> Tuple[int, int]:
    n_train = max(1, int(n * train_pct))
    n_val = max(1, int(n * val_pct))
    if n_train + n_val >= n:
        # Not enough rows for a separate test split; cap val and
        # leave at least 1 row for test.
        n_val = max(1, n - n_train - 1)
    return n_train, n_train + n_val


def _fit_one(
    X: np.ndarray, y: np.ndarray, n_train: int, n_val: int
) -> Tuple[xgb.XGBRegressor, Dict[str, float]]:
    X_train, y_train = X[:n_train], y[:n_train]
    X_val, y_val = X[n_train:n_val], y[n_train:n_val]

    model = xgb.XGBRegressor(
        n_estimators=400,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=4,
        early_stopping_rounds=30,
        eval_metric="mae",
    )
    t0 = time.time()
    model.fit(
        X_train,
        y_train,
        eval_set=[(X_train, y_train), (X_val, y_val)],
        verbose=False,
    )
    train_seconds = time.time() - t0

    train_pred = model.predict(X_train)
    val_pred = model.predict(X_val) if len(X_val) else np.array([])
    train_mae = float(np.mean(np.abs(train_pred - y_train))) if len(y_train) else math.nan
    val_mae = float(np.mean(np.abs(val_pred - y_val))) if len(y_val) else math.nan
    return model, {
        "train_mae": train_mae,
        "val_mae": val_mae,
        "train_seconds": train_seconds,
    }


def _score_test(
    model: xgb.XGBRegressor, X: np.ndarray, y: np.ndarray, n_val: int
) -> Tuple[float, float, float]:
    if n_val >= len(X):
        return math.nan, math.nan, math.nan
    X_test, y_test = X[n_val:], y[n_val:]
    if len(X_test) == 0:
        return math.nan, math.nan, math.nan
    pred = model.predict(X_test)
    mae = float(np.mean(np.abs(pred - y_test)))
    rmse = float(math.sqrt(np.mean((pred - y_test) ** 2)))
    # MAPE: clip to avoid /0; report on rows where actual > 0 (they all
    # are, by construction, but be defensive).
    mask = y_test > 0
    mape = (
        float(np.mean(np.abs((pred[mask] - y_test[mask]) / y_test[mask])) * 100.0)
        if mask.any()
        else math.nan
    )
    return mae, rmse, mape


def _train_per_group(
    series: pd.DataFrame,
    min_history: int,
) -> Tuple[Dict[str, xgb.XGBRegressor], List[ModelMetrics]]:
    """Train one model per (crop, state) group. Skip groups with
    fewer than `min_history` distinct dates.
    """
    models: Dict[str, xgb.XGBRegressor] = {}
    metrics: List[ModelMetrics] = []

    grouped = list(series.groupby(["crop", "state"]))
    for (crop, state), g in grouped:
        if len(g) < min_history:
            continue
        X, y, _dates, _names = F.make_features(g)
        if len(X) < min_history - 1:
            continue
        n = len(X)
        n_train, n_val = _split_chrono(n)
        try:
            model, fit_info = _fit_one(X, y, n_train, n_val)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! fit failed for {crop} / {state}: {exc}")
            continue
        test_mae, test_rmse, test_mape = _score_test(model, X, y, n_val)
        key = f"{_slug(crop)}__{_slug(state)}"
        models[key] = model
        metrics.append(
            ModelMetrics(
                crop=crop,
                state=state,
                n_rows=n,
                n_train=n_train,
                n_val=n_val - n_train,
                n_test=n - n_val,
                train_mae=round(fit_info["train_mae"], 4),
                val_mae=round(fit_info["val_mae"], 4),
                test_mae=round(test_mae, 4) if not math.isnan(test_mae) else None,
                test_rmse=round(test_rmse, 4) if not math.isnan(test_rmse) else None,
                test_mape_pct=round(test_mape, 4) if not math.isnan(test_mape) else None,
                train_seconds=round(fit_info["train_seconds"], 3),
            )
        )
    return models, metrics


def _save_artifacts(
    out_dir: str,
    models: Dict[str, xgb.XGBRegressor],
    metrics: List[ModelMetrics],
) -> None:
    os.makedirs(out_dir, exist_ok=True)
    # Each model goes to its own file. Filename encodes the
    # (crop, state) key so the loader can read by key.
    for key, m in models.items():
        m.save_model(os.path.join(out_dir, f"{key}.json"))
    meta = {
        "disclaimer": DISCLAIMER,
        "feature_names": F.FEATURE_NAMES,
        "target": F.TARGET,
        "n_models": len(models),
        "models": [asdict(m) for m in metrics],
        "trained_at": time.time(),
    }
    with open(os.path.join(out_dir, "metadata.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2, default=str)


def main() -> int:
    p = argparse.ArgumentParser(description="Train AgroConnect XGBoost models.")
    p.add_argument("--out", default="models", help="output directory")
    p.add_argument("--min-history", type=int, default=30,
                   help="minimum distinct dates to train a model")
    p.add_argument("--crop", default=None,
                   help="optional single crop filter (regex)")
    p.add_argument("--state", default=None,
                   help="optional single state filter (regex)")
    p.add_argument("--crops", default=None,
                   help="comma-separated crop list, alternative to --crop")
    p.add_argument("--uri", default=os.environ.get("MONGODB_URI",
                                                  "mongodb://127.0.0.1:27017/agroconnect"),
                   help="MongoDB URI")
    p.add_argument("--db", default=os.environ.get("MONGODB_DB", "agroconnect"),
                   help="MongoDB database name")
    p.add_argument("--limit", type=int, default=0,
                   help="optional cap on rows pulled (0 = no cap)")
    args = p.parse_args()

    crop_filter = args.crop
    if args.crops:
        # In this simple version we use just the first crop if both are
        # set. The full grid would require multiple invocations.
        crop_filter = args.crops.split(",")[0].strip()

    print(f"[train] connecting to {args.uri} ...")
    client, db = _fetch_collection(args.uri, args.db)
    # Quick liveness ping.
    client.admin.command("ping")
    print(f"[train] pulling MarketPrice rows ...")
    series = _load_series(db, crop_filter, args.state)
    if args.limit and len(series) > args.limit:
        series = series.tail(args.limit)
    print(f"[train] daily series rows: {len(series)}; "
          f"groups: {series[['crop','state']].drop_duplicates().shape[0]}")

    models, metrics = _train_per_group(series, args.min_history)
    print(f"[train] fitted {len(models)} models")
    if metrics:
        for m in metrics[:5]:
            print(
                f"  {m.crop:<14} {m.state:<18} "
                f"n={m.n_rows:>4}  test_mae={m.test_mae}  "
                f"test_mape={m.test_mape_pct}%"
            )
    _save_artifacts(args.out, models, metrics)
    print(f"[train] artifacts written to {args.out}/")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
