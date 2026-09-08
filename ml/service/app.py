"""
app.py — FastAPI service for the AgroConnect XGBoost price model.

Endpoints:
    GET  /health       — liveness, model count, last training time
    POST /predict      — single (crop, state, market?, days?) → projection

Response shape on /predict mirrors the existing JS mlPrediction.js
shape so the Node backend can use this as a drop-in better model:

    {
        "available": true,
        "is_estimate": true,
        "disclaimer": "...",
        "method": "xgboost",
        "crop": "Onion",
        "state": "Maharashtra",
        "market": null,
        "distinct_dates": 412,
        "holdout_days": 0,
        "source_used": "agmarknet",
        "confidence": "high" | "medium" | "low",
        "trend_direction": "up" | "down" | "flat" | "unknown",
        "historical_min": 12.4,
        "historical_max": 38.0,
        "current_price": 22.5,
        "history_summary": { ... },
        "candidates": [
            { "method": "seasonal_naive", ... },
            { "method": "weighted_recent", ... },
            { "method": "linear_trend", ... }
        ],
        "chosen": { "method": "xgboost", "in_sample_mae": ... },
        "projection": [
            { "day": 1, "date": "2026-09-08",
              "chosen_method": "xgboost",
              "chosen_point": 22.6,
              "low": 21.9, "high": 23.3,
              "candidates": { "xgboost": 22.6, ... } }
        ]
    }

If the model is unavailable for the requested (crop, state), or the
series is too short, the response is:

    { "available": false, "method": null, "message": "...", ... }

This module is a thin HTTP layer. All numeric work happens via
features.py and the XGBoost Booster.
"""
from __future__ import annotations

import datetime as dt
import math
import os
import sys
from typing import List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from pymongo import MongoClient

_HERE = os.path.dirname(os.path.abspath(__file__))
_TRAINING = os.path.abspath(os.path.join(_HERE, "..", "training"))
if _TRAINING not in sys.path:
    sys.path.insert(0, _TRAINING)

import features as _F  # noqa: E402
from service.client_features import build_live_row  # noqa: E402
from .model_loader import ModelRegistry  # noqa: E402

MODELS_DIR = os.environ.get("ML_MODELS_DIR", "models")
MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017/agroconnect")
MONGO_DB = os.environ.get("MONGODB_DB", "agroconnect")
DEFAULT_MIN_HISTORY = int(os.environ.get("ML_MIN_HISTORY", "10"))
DEFAULT_HORIZON = int(os.environ.get("ML_DEFAULT_HORIZON", "7"))

app = FastAPI(title="AgroConnect ML", version="0.1.0")
_registry = ModelRegistry(MODELS_DIR).load()
_mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=10_000)
_db = _mongo[MONGO_DB]


class PredictRequest(BaseModel):
    crop: str = Field(..., min_length=1)
    state: Optional[str] = None
    market: Optional[str] = None
    days: int = Field(7, ge=1, le=30)
    min_history_dates: int = Field(DEFAULT_MIN_HISTORY, ge=2, le=60)
    source_preference: str = Field(
        "agmarknet",
        description="agmarknet | mixed",
    )


class HealthResponse(BaseModel):
    ok: bool
    models_loaded: int
    n_models: int
    disclaimer: str
    mongo_ok: bool


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    try:
        _mongo.admin.command("ping")
        mongo_ok = True
    except Exception:  # noqa: BLE001
        mongo_ok = False
    return HealthResponse(
        ok=mongo_ok and _registry.n_models > 0,
        models_loaded=_registry.n_models,
        n_models=_registry.n_models,
        disclaimer=_registry.disclaimer,
        mongo_ok=mongo_ok,
    )


def _load_daily_series(crop: str, state: Optional[str], market: Optional[str]) -> pd.DataFrame:
    q: dict = {
        "priceDate": {"$exists": True, "$ne": ""},
        "pricePerKg": {"$gt": 0},
        "cropName": {"$regex": f"^{crop}$", "$options": "i"},
    }
    if state:
        q["state"] = {"$regex": f"^{state}$", "$options": "i"}
    if market:
        q["market"] = {"$regex": market, "$options": "i"}
    cursor = _db["marketprices"].find(
        q,
        {"priceDate": 1, "cropName": 1, "state": 1, "pricePerKg": 1, "_id": 0},
    )
    return _F.build_daily_series(list(cursor))


def _trend(first: Optional[float], last: Optional[float]) -> str:
    if first is None or last is None or last == 0:
        return "unknown"
    delta = (first - last) / last
    if delta > 0.02:
        return "up"
    if delta < -0.02:
        return "down"
    return "flat"


def _confidence(distinct: int, last_value: float, mae: Optional[float]) -> str:
    if mae is None or last_value <= 0:
        return "low"
    ratio = mae / last_value
    if distinct >= 60 and ratio < 0.07:
        return "high"
    if distinct >= 30 and ratio < 0.12:
        return "medium"
    if distinct >= 10:
        return "low"
    return "none"


@app.post("/predict")
def predict(req: PredictRequest):
    series = _load_daily_series(req.crop, req.state, req.market)
    distinct = int(series.shape[0])
    if distinct < req.min_history_dates:
        return {
            "available": False,
            "method": None,
            "is_estimate": True,
            "disclaimer": _registry.disclaimer,
            "message": (
                f"Insufficient history for forecast. Need "
                f"{req.min_history_dates} distinct dates; found {distinct}."
            ),
            "crop": req.crop,
            "state": req.state,
            "market": req.market,
            "distinct_dates": distinct,
            "min_history_dates_required": req.min_history_dates,
            "source_used": "agmarknet" if not series.empty else "none",
            "confidence": "none",
            "trend_direction": "unknown",
            "historical_min": None,
            "historical_max": None,
            "current_price": None,
            "history_summary": None,
            "candidates": [],
            "chosen": None,
            "projection": [],
        }

    key, model = _registry.pick(req.crop, req.state)
    if model is None:
        return {
            "available": False,
            "method": None,
            "is_estimate": True,
            "disclaimer": _registry.disclaimer,
            "message": f"No trained model for crop={req.crop}.",
            "crop": req.crop,
            "state": req.state,
            "market": req.market,
            "distinct_dates": distinct,
            "min_history_dates_required": req.min_history_dates,
            "source_used": "agmarknet",
            "confidence": "none",
            "trend_direction": "unknown",
            "historical_min": None,
            "historical_max": None,
            "current_price": None,
            "history_summary": None,
            "candidates": [],
            "chosen": None,
            "projection": [],
        }

    # We need a single feature row for "today" (i.e. the row after
    # the last known date). Build the extended history so the lag
    # features all see the full series.
    feat_row = build_live_row(series)
    if feat_row is None:
        return {
            "available": False,
            "method": None,
            "is_estimate": True,
            "disclaimer": _registry.disclaimer,
            "message": "Could not derive a live feature row from history.",
            "crop": req.crop,
            "state": req.state,
            "market": req.market,
            "distinct_dates": distinct,
            "min_history_dates_required": req.min_history_dates,
            "source_used": "agmarknet",
            "confidence": "none",
            "trend_direction": "unknown",
            "historical_min": None,
            "historical_max": None,
            "current_price": None,
            "history_summary": None,
            "candidates": [],
            "chosen": None,
            "projection": [],
        }

    feat_array = np.array(feat_row, dtype=float).reshape(1, -1)
    first_point = float(model.predict(feat_array)[0])

    # Recursive forecast: each subsequent day feeds back the previous
    # prediction as if it had been observed.
    history_extended = series.copy()
    points: List[float] = []
    for d in range(req.days):
        if d == 0:
            row = build_live_row(history_extended)
        else:
            row = feat_row  # fallback; rebuild below
        if row is None:
            # Insufficient lags after extension — stop projecting
            # rather than emit NaN.
            break
        # Rebuild the row for THIS day by extending history with
        # all previously-predicted points.
        history_extended = _F.extend_with_forecast(
            series, points
        )
        row = build_live_row(history_extended)
        if row is None:
            break
        yhat = float(model.predict(np.array(row, dtype=float).reshape(1, -1))[0])
        points.append(yhat)

    if not points:
        return {
            "available": False,
            "method": None,
            "is_estimate": True,
            "disclaimer": _registry.disclaimer,
            "message": "Forecast could not be produced (insufficient lags).",
            "crop": req.crop,
            "state": req.state,
            "market": req.market,
            "distinct_dates": distinct,
            "min_history_dates_required": req.min_history_dates,
            "source_used": "agmarknet",
            "confidence": "none",
            "trend_direction": "unknown",
            "historical_min": None,
            "historical_max": None,
            "current_price": None,
            "history_summary": None,
            "candidates": [],
            "chosen": None,
            "projection": [],
        }

    # Build the projection envelope. Width is derived from the
    # training MAE on this (crop, state) — pulled from metadata.
    metadata = _registry.metadata() or {}
    model_mae = None
    for entry in metadata.get("models", []):
        if (
            (entry.get("crop") or "").lower() == (req.crop or "").lower()
            and (entry.get("state") or "").lower() == ((req.state or "") or "").lower()
        ):
            model_mae = entry.get("val_mae") or entry.get("test_mae")
            break
    if model_mae is None:
        # Fall back to a conservative default.
        model_mae = max(1.0, series["value"].std() * 0.1) if not series.empty else 1.0

    band = max(0.5, 1.5 * float(model_mae))

    last_date = pd.Timestamp(series["date"].iloc[-1])
    projection = []
    for i, yhat in enumerate(points, start=1):
        target_date = (last_date + pd.Timedelta(days=i)).strftime("%Y-%m-%d")
        projection.append(
            {
                "day": i,
                "date": target_date,
                "chosen_method": "xgboost",
                "chosen_point": round(yhat, 2),
                "low": round(yhat - band, 2),
                "high": round(yhat + band, 2),
                "candidates": {
                    "xgboost": round(yhat, 2),
                },
            }
        )

    last_value = float(series["value"].iloc[-1])
    hist_min = float(series["value"].min())
    hist_max = float(series["value"].max())

    candidates = [
        {
            "method": "seasonal_naive",
            "params": {"lookbackWeeks": 4},
            "in_sample_mae": None,
        },
        {
            "method": "weighted_recent",
            "params": {"recentWindow": 14, "halfLifeDays": 7},
            "in_sample_mae": None,
        },
        {
            "method": "linear_trend",
            "params": {},
            "in_sample_mae": None,
        },
        {
            "method": "xgboost",
            "params": {"key": key, "val_mae": model_mae},
            "in_sample_mae": round(float(model_mae), 4)
            if model_mae is not None and not (isinstance(model_mae, float) and math.isnan(model_mae))
            else None,
        },
    ]

    first_point = points[0]
    trend = _trend(first_point, last_value)

    return {
        "available": True,
        "is_estimate": True,
        "disclaimer": _registry.disclaimer,
        "method": "xgboost",
        "crop": req.crop,
        "state": req.state,
        "market": req.market,
        "distinct_dates": distinct,
        "holdout_days": 0,
        "source_used": "agmarknet",
        "confidence": _confidence(distinct, last_value, model_mae),
        "trend_direction": trend,
        "historical_min": round(hist_min, 2),
        "historical_max": round(hist_max, 2),
        "current_price": round(last_value, 2),
        "history_summary": {
            "first_date": str(series["date"].iloc[0]),
            "last_date": str(series["date"].iloc[-1]),
            "last_avg": round(last_value, 2),
            "min": round(hist_min, 2),
            "max": round(hist_max, 2),
        },
        "candidates": candidates,
        "chosen": {
            "method": "xgboost",
            "in_sample_mae": round(float(model_mae), 4) if model_mae is not None else None,
        },
        "projection": projection,
    }


@app.post("/reload")
def reload_models() -> dict:
    """Hot-reload model artifacts. Useful after a fresh training run
    without restarting the service.
    """
    _registry.reload()
    return {
        "ok": True,
        "n_models": _registry.n_models,
    }
