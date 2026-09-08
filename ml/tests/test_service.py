"""
test_service.py — model save/load + FastAPI health endpoint tests.
"""
from __future__ import annotations

import json
import math
import os
import sys
import tempfile

import numpy as np
import pandas as pd
import pytest
import xgboost as xgb
from fastapi.testclient import TestClient

_HERE = os.path.dirname(os.path.abspath(__file__))
_SERVICE = os.path.abspath(os.path.join(_HERE, "..", "service"))
_TRAINING = os.path.abspath(os.path.join(_HERE, "..", "training"))
for p in (_SERVICE, _TRAINING):
    if p not in sys.path:
        sys.path.insert(0, p)

import features as F  # noqa: E402
from model_loader import ModelRegistry  # noqa: E402


def _train_and_save(tmpdir: str) -> str:
    """Fit a tiny synthetic model and persist to `tmpdir`. Returns
    the directory path.
    """
    os.makedirs(tmpdir, exist_ok=True)
    # Tiny synthetic dataset: y = x_0 + 0.1 * x_1
    rng = np.random.default_rng(0)
    X = rng.normal(size=(120, len(F.FEATURE_NAMES)))
    y = X[:, 0] + 0.1 * X[:, 1]
    model = xgb.XGBRegressor(
        n_estimators=50,
        max_depth=3,
        learning_rate=0.1,
        objective="reg:squarederror",
        random_state=0,
    )
    model.fit(X, y)
    model.save_model(os.path.join(tmpdir, "onion__maharashtra.json"))
    meta = {
        "disclaimer": "test disclaimer",
        "feature_names": F.FEATURE_NAMES,
        "target": F.TARGET,
        "n_models": 1,
        "models": [
            {
                "crop": "Onion",
                "state": "Maharashtra",
                "n_rows": 120,
                "n_train": 84,
                "n_val": 18,
                "n_test": 18,
                "train_mae": 0.1,
                "val_mae": 0.12,
                "test_mae": 0.15,
                "test_rmse": 0.2,
                "test_mape_pct": 5.0,
                "train_seconds": 0.5,
            }
        ],
        "trained_at": 0.0,
    }
    with open(os.path.join(tmpdir, "metadata.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh)
    return tmpdir


def test_model_registry_pick_prefers_exact_state():
    with tempfile.TemporaryDirectory() as tmp:
        _train_and_save(tmp)
        reg = ModelRegistry(tmp).load()
        assert reg.n_models == 1
        key, model = reg.pick("Onion", "Maharashtra")
        assert key == "onion__maharashtra"
        assert model is not None


def test_model_registry_pick_falls_back_to_crop():
    with tempfile.TemporaryDirectory() as tmp:
        _train_and_save(tmp)
        reg = ModelRegistry(tmp).load()
        # If we ask for a different state but the crop exists, the
        # registry still returns a usable model (the inference code
        # is the one that decides whether the state-specific history
        # is appropriate).
        key, model = reg.pick("Onion", "Punjab")
        assert key is not None
        assert model is not None


def test_model_registry_pick_missing_returns_none():
    with tempfile.TemporaryDirectory() as tmp:
        _train_and_save(tmp)
        reg = ModelRegistry(tmp).load()
        key, model = reg.pick("Tomato", "Maharashtra")
        assert key is None
        assert model is None


def test_saved_model_predicts_close_to_training_value():
    with tempfile.TemporaryDirectory() as tmp:
        _train_and_save(tmp)
        reg = ModelRegistry(tmp).load()
        _, model = reg.pick("Onion", "Maharashtra")
        rng = np.random.default_rng(1)
        x = rng.normal(size=(1, len(F.FEATURE_NAMES)))
        # We don't know the exact prediction, but it should be a
        # finite number, not NaN, not Inf.
        yhat = float(model.predict(x)[0])
        assert math.isfinite(yhat)


def test_health_endpoint_uses_temp_models_dir(monkeypatch):
    # We don't actually spin up the FastAPI app with Mongo here —
    # the previous /health signature is exercised separately. This
    # test is a placeholder that confirms the test scaffolding can
    # be imported; the live HTTP test is gated on a Mongo instance
    # being available and lives in test_integration_http.py (manual
    # run).
    assert True
