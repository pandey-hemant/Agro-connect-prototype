"""
test_features.py — pure unit tests for the no-leakage feature
engineering contract.

The most important thing these tests pin is: the lag/rolling features
for row N NEVER see the target at index N. If they did, training MAE
would be artificially low and the model would be useless in
production.
"""
from __future__ import annotations

import math
import sys
import os

import numpy as np
import pandas as pd
import pytest

# Make training/features.py importable when running pytest from the
# ml/ directory.
_HERE = os.path.dirname(os.path.abspath(__file__))
_TRAINING = os.path.abspath(os.path.join(_HERE, "..", "training"))
if _TRAINING not in sys.path:
    sys.path.insert(0, _TRAINING)

import features as F  # noqa: E402


def _synthetic_series(n: int = 60, base: float = 20.0) -> pd.DataFrame:
    """A simple series with a sine wave so the seasonal feature has
    something to latch onto. No NaN gaps so we can also exercise
    the rolling stats.
    """
    dates = pd.date_range("2025-01-01", periods=n, freq="D")
    values = [base + 2.0 * np.sin(i / 7.0) + 0.05 * i for i in range(n)]
    return pd.DataFrame(
        {
            "date": dates.strftime("%Y-%m-%d"),
            "crop": "Onion",
            "state": "Maharashtra",
            "value": values,
            "market_count": 5,
        }
    )


def test_feature_names_match_documented_contract():
    expected = {
        "lag_1",
        "lag_7",
        "lag_14",
        "lag_30",
        "roll_mean_7",
        "roll_mean_14",
        "roll_mean_30",
        "roll_std_7",
        "roll_std_30",
        "roll_median_14",
        "dow_sin",
        "dow_cos",
        "month_sin",
        "month_cos",
        "days_since_last_obs",
        "same_dow_mean_4w",
    }
    assert set(F.FEATURE_NAMES) == expected


def test_no_target_leakage_in_lag1():
    """If lag_1 is ever equal to today's target y_next, the model
    would learn to copy the input. Force the y at index i to be
    wildly different from value[i-1] and confirm lag_1 != y.
    """
    s = _synthetic_series(40)
    s.loc[s.index[-5:], "value"] = [100.0, 100.0, 100.0, 100.0, 100.0]
    X, y, dates, names = F.make_features(s)
    # For the last 4 rows, y should NOT match the X[:, lag_1_idx] column
    lag1_idx = names.index("lag_1")
    last_four = X[-4:, lag1_idx]
    last_four_y = y[-4:]
    # All last_four_y are ~100. lag_1 for those rows is the value at
    # the previous day, which is the synthetic sine (~20). So the
    # two arrays should NOT be close.
    assert not np.allclose(last_four, last_four_y, atol=1.0), (
        "lag_1 == y for the last 4 rows — leakage"
    )


def test_lag_features_skip_nan_in_window():
    """A series with a 2-day gap should still produce a numeric
    lag_1 from the most recent non-NaN value.
    """
    s = _synthetic_series(20)
    s.loc[s.index[5:7], "value"] = np.nan  # 2-day gap
    X, y, dates, names = F.make_features(s)
    lag1_idx = names.index("lag_1")
    # For rows at index >= 7 (i.e. after the gap), lag_1 should be a
    # real number, not NaN.
    post_gap_X = X[7 - 1:]  # rows whose target is index >= 7
    assert not np.any(np.isnan(post_gap_X[:, lag1_idx])), (
        "lag_1 should look back past NaN to the most recent value"
    )


def test_sin_cos_periodicity():
    """dow_sin/dow_cos of Monday and the same Monday a week later
    should be identical.
    """
    s = _synthetic_series(14)
    X, y, dates, names = F.make_features(s)
    dow_sin_idx = names.index("dow_sin")
    dow_cos_idx = names.index("dow_cos")
    # Pick two Mondays (7 days apart) and confirm the sin/cos match.
    mondays = [i for i, d in enumerate(dates) if d.dayofweek == 0]
    assert len(mondays) >= 2
    a, b = mondays[0], mondays[1]
    assert X[a, dow_sin_idx] == pytest.approx(X[b, dow_sin_idx], abs=1e-9)
    assert X[a, dow_cos_idx] == pytest.approx(X[b, dow_cos_idx], abs=1e-9)


def test_extend_with_forecast_advances_date_by_one():
    s = _synthetic_series(5)
    ext = F.extend_with_forecast(s, [99.0, 100.0])
    assert len(ext) == 7
    last_known = pd.Timestamp(s["date"].iloc[-1])
    assert str(ext["date"].iloc[-1]) == (last_known + pd.Timedelta(days=2)).strftime("%Y-%m-%d")
    assert ext["value"].iloc[-1] == 100.0


def test_same_features_uses_full_history():
    s = _synthetic_series(45)
    row = F.same_features(s)
    assert len(row) == len(F.FEATURE_NAMES)
    assert all(isinstance(v, float) and not math.isnan(v) for v in row)


def test_empty_series_handled():
    s = pd.DataFrame(columns=["date", "crop", "state", "value", "market_count"])
    X, y, dates, names = F.make_features(s)
    assert X.shape == (0, len(F.FEATURE_NAMES))
    assert y.shape == (0,)


def test_build_daily_series_aggregates_across_markets():
    """Same (date, crop, state) from multiple markets should produce
    one row with the mean price.
    """
    records = [
        {"priceDate": "2025-01-01", "cropName": "Onion",
         "state": "Maharashtra", "pricePerKg": 20.0},
        {"priceDate": "2025-01-01", "cropName": "Onion",
         "state": "Maharashtra", "pricePerKg": 30.0},
        {"priceDate": "2025-01-02", "cropName": "Onion",
         "state": "Maharashtra", "pricePerKg": 25.0},
    ]
    s = F.build_daily_series(records)
    assert s.shape[0] == 2
    by_date = dict(zip(s["date"], s["value"]))
    assert by_date["2025-01-01"] == pytest.approx(25.0, abs=1e-9)
    assert by_date["2025-01-02"] == pytest.approx(25.0, abs=1e-9)


def test_build_daily_series_drops_zero_prices():
    """pricePerKg=0 is a sentinel for 'not actually quoted'. Drop it
    rather than poison the rolling mean.
    """
    records = [
        {"priceDate": "2025-01-01", "cropName": "Onion",
         "state": "Maharashtra", "pricePerKg": 0},
        {"priceDate": "2025-01-02", "cropName": "Onion",
         "state": "Maharashtra", "pricePerKg": 22.0},
    ]
    s = F.build_daily_series(records)
    assert s.shape[0] == 1
    assert s["value"].iloc[0] == 22.0
