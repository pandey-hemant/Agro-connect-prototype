"""
evaluate.py — re-scores the saved models on the test split and prints
a summary table. Useful after training to eyeball the per-(crop,state)
quality of the predictions without re-fitting.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from typing import Dict, List

import numpy as np
import pandas as pd
import xgboost as xgb
from pymongo import MongoClient

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import features as F  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--models", default="models")
    p.add_argument("--uri", default=os.environ.get("MONGODB_URI",
                                                   "mongodb://127.0.0.1:27017/agroconnect"))
    p.add_argument("--db", default=os.environ.get("MONGODB_DB", "agroconnect"))
    p.add_argument("--crop", default=None)
    p.add_argument("--state", default=None)
    args = p.parse_args()

    meta_path = os.path.join(args.models, "metadata.json")
    if not os.path.exists(meta_path):
        print(f"no metadata.json at {meta_path}")
        return 1
    with open(meta_path, "r", encoding="utf-8") as fh:
        meta = json.load(fh)

    print(f"metadata: {meta.get('n_models')} models, "
          f"disclaimer={meta.get('disclaimer')!r}")

    client = MongoClient(args.uri, serverSelectionTimeoutMS=10_000)
    db = client[args.db]
    q = {"priceDate": {"$exists": True, "$ne": ""}, "pricePerKg": {"$gt": 0}}
    if args.crop:
        q["cropName"] = {"$regex": f"^{args.crop}$", "$options": "i"}
    if args.state:
        q["state"] = {"$regex": f"^{args.state}$", "$options": "i"}
    raw = list(
        db["marketprices"].find(
            q,
            {"priceDate": 1, "cropName": 1, "state": 1, "pricePerKg": 1, "_id": 0},
        )
    )
    series = F.build_daily_series(raw)
    print(f"series rows: {len(series)}; "
          f"groups: {series[['crop','state']].drop_duplicates().shape[0]}")

    # Replay the per-group split used in train.py and report metrics.
    rows = []
    for m in meta["models"]:
        crop, state = m["crop"], m["state"]
        key = f"{''.join(c if c.isalnum() else '_' for c in crop).strip('_').lower()}__{''.join(c if c.isalnum() else '_' for c in state).strip('_').lower()}"
        model_path = os.path.join(args.models, f"{key}.json")
        if not os.path.exists(model_path):
            continue
        g = series[(series["crop"] == crop) & (series["state"] == state)]
        if len(g) < m["n_rows"] * 0.5:
            continue
        X, y, dates, names = F.make_features(g)
        if len(X) < m["n_train"] + m["n_val"] + 1:
            continue
        booster = xgb.XGBRegressor()
        booster.load_model(model_path)
        n_val = m["n_train"] + m["n_val"]
        X_test, y_test = X[n_val:], y[n_val:]
        if len(X_test) == 0:
            continue
        pred = booster.predict(X_test)
        mae = float(np.mean(np.abs(pred - y_test)))
        rmse = float(math.sqrt(np.mean((pred - y_test) ** 2)))
        rows.append(
            {"crop": crop, "state": state, "n_test": len(X_test),
             "mae": round(mae, 4), "rmse": round(rmse, 4)}
        )

    if not rows:
        print("no models could be re-evaluated (artifacts missing or data drift).")
        return 2

    df = pd.DataFrame(rows).sort_values("mae")
    print(df.to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
