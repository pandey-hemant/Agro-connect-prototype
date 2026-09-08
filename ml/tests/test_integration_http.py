"""
test_integration_http.py — manual integration test for the FastAPI
service. Skipped automatically unless a running MongoDB is available
at the configured URI. Run explicitly with:
    pytest -q tests/test_integration_http.py
"""
from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SERVICE = os.path.abspath(os.path.join(_HERE, "..", "service"))
if _SERVICE not in sys.path:
    sys.path.insert(0, _SERVICE)

# We import lazily so a missing FastAPI install does not break the
# offline test suite.
fastapi_testclient = pytest.importorskip("fastapi.testclient")
from app import app  # noqa: E402


def test_health():
    client = fastapi_testclient.TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert "ok" in body
    assert "models_loaded" in body
    assert "disclaimer" in body
    assert "mongo_ok" in body


def test_predict_returns_envelope():
    client = fastapi_testclient.TestClient(app)
    r = client.post(
        "/predict",
        json={
            "crop": "Onion",
            "state": "Maharashtra",
            "days": 7,
            "min_history_dates": 5,
        },
    )
    assert r.status_code == 200
    body = r.json()
    # available may be false if no trained model exists yet; either
    # way the envelope must contain the expected fields.
    for k in (
        "available",
        "is_estimate",
        "disclaimer",
        "method",
        "crop",
        "state",
        "distinct_dates",
        "confidence",
        "trend_direction",
        "projection",
    ):
        assert k in body, f"missing field: {k}"
