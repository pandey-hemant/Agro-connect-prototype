"""
features.py — time-series feature engineering for AgroConnect price prediction.

Pinned contract (so training and inference always agree on the exact
column set):

    FEATURE_NAMES = [
        "lag_1", "lag_7", "lag_14", "lag_30",
        "roll_mean_7", "roll_mean_14", "roll_mean_30",
        "roll_std_7", "roll_std_30",
        "roll_median_14",
        "dow_sin", "dow_cos",
        "month_sin", "month_cos",
        "days_since_last_obs",
        "same_dow_mean_4w",     # mean of same DOW in last 4 weeks
    ]

    TARGET = "y_next"           # the price the next day ACTUALLY closed at

No future information ever enters the features. The training function
builds rows by walking the series in chronological order and emitting
one row per (date, target=next-day price). At inference, the caller
provides the most-recent feature row and a `horizon`, and the same
function extends the series using model outputs as if they were
ground truth — a common, honest practice for short-horizon forecasting
and explicitly called out so it is never confused with a real ground
truth loop.

Public functions:
    build_daily_series(records) -> pd.DataFrame
        Accepts the raw Mongo rows and returns a sorted DataFrame
        with one row per (date, crop, state) carrying the daily mean
        price. Empty rows are dropped.

    make_features(series) -> (X, y, dates, feature_names)
        For every date that has a known next-day price, emits one
        feature row + the next-day target. Returns numpy arrays.

    extend_with_forecast(series, forecast_values) -> pd.DataFrame
        Appends a `value` column onto a copy of `series`. Used at
        inference to feed back the model's own predictions so the
        seasonal/window logic stays stable across the horizon.

    same_features(series, as_of) -> np.ndarray
        Single-row feature extraction. Used at inference time to
        produce the row that goes into the model for `day=1`. Then
        the caller can call extend_with_forecast + same_features for
        `day=2`, etc.
"""
from __future__ import annotations

import math
from typing import Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd


FEATURE_NAMES: List[str] = [
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
]

TARGET = "y_next"


def build_daily_series(records: Iterable[dict]) -> pd.DataFrame:
    """Take raw Mongo rows and produce a tidy daily series.

    Each output row is (date, crop, state, market_count, value) where
    `value` is the mean of pricePerKg across all markets of the same
    (crop, state, date). `market_count` is retained for diagnostics
    but is not used as a feature (it would leak the test split's
    information density).
    """
    if not records:
        return pd.DataFrame(
            columns=["date", "crop", "state", "value", "market_count"]
        )

    df = pd.DataFrame(list(records))
    if df.empty:
        return pd.DataFrame(
            columns=["date", "crop", "state", "value", "market_count"]
        )

    # Defensive: drop rows with no price or no date.
    df = df.dropna(subset=["pricePerKg", "priceDate"])
    df = df[df["pricePerKg"] > 0]
    df["priceDate"] = df["priceDate"].astype(str)
    df["cropName"] = df["cropName"].astype(str)
    df["state"] = df["state"].fillna("").astype(str)

    grouped = (
        df.groupby(["priceDate", "cropName", "state"], as_index=False)
        .agg(value=("pricePerKg", "mean"), market_count=("pricePerKg", "size"))
        .rename(columns={"priceDate": "date", "cropName": "crop"})
        .sort_values("date")
        .reset_index(drop=True)
    )
    return grouped


def _dow_sin_cos(date: pd.Timestamp) -> Tuple[float, float]:
    dow = date.dayofweek  # Monday=0
    rad = 2.0 * math.pi * dow / 7.0
    return math.sin(rad), math.cos(rad)


def _month_sin_cos(date: pd.Timestamp) -> Tuple[float, float]:
    # day_of_year=1..366, map to 0..2π
    doy = date.timetuple().tm_yday
    rad = 2.0 * math.pi * (doy - 1) / 365.0
    return math.sin(rad), math.cos(rad)


def _safe(values: Sequence[float], idx: int, default: float = np.nan) -> float:
    if idx < 0 or idx >= len(values):
        return default
    v = values[idx]
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return default
    return float(v)


def _row_features(
    values: Sequence[float],
    dates: Sequence[pd.Timestamp],
    target_idx: int,
    target_date: Optional[pd.Timestamp] = None,
) -> List[float]:
    """Compute the feature vector for the row whose TARGET is
    `values[target_idx]`. The features look ONLY at indices
    `0..target_idx-1`. This is the no-leakage invariant.

    For inference, `target_date` should be provided explicitly (the date
    of the prediction target, i.e., tomorrow). For training, it defaults
    to `dates[target_idx]`.
    """
    if target_idx <= 0:
        return [np.nan] * len(FEATURE_NAMES)

    cur_date = target_date if target_date is not None else dates[target_idx]
    # We want features as of (target_idx - 1) — i.e. what we'd have
    # known the day BEFORE we want to predict. lag_1 = value[-1].
    last_known = target_idx - 1

    # Lags: walk back, skipping NaN cells, to find the most recent
    # observed value at the requested offset. If none, NaN.
    def lag(offset: int) -> float:
        # offset=1 means "yesterday" (i.e. index last_known itself).
        # offset=7 means 7 days before the last known index.
        idx = last_known - (offset - 1)
        if idx < 0:
            return np.nan
        # walk back over NaN to find the most recent observed value
        # within a 3-day window — agricultural series have gaps.
        for j in range(idx, max(-1, idx - 3), -1):
            v = _safe(values, j, np.nan)
            if not (isinstance(v, float) and math.isnan(v)):
                return float(v)
        return np.nan

    lag_1 = lag(1)
    lag_7 = lag(7)
    lag_14 = lag(14)
    lag_30 = lag(30)

    # Rolling stats use the last N KNOWN values (not the last N
    # calendar days) — this matches the way the inference path sees
    # the data: the caller always passes the full series and we look
    # back to the most recent observation.
    def take_known(n: int) -> List[float]:
        out: List[float] = []
        for j in range(last_known, -1, -1):
            v = _safe(values, j, np.nan)
            if not (isinstance(v, float) and math.isnan(v)):
                out.append(float(v))
            if len(out) >= n:
                break
        return list(reversed(out))

    last7 = take_known(7)
    last14 = take_known(14)
    last30 = take_known(30)

    roll_mean_7 = float(np.mean(last7)) if last7 else np.nan
    roll_mean_14 = float(np.mean(last14)) if last14 else np.nan
    roll_mean_30 = float(np.mean(last30)) if last30 else np.nan
    roll_std_7 = float(np.std(last7, ddof=0)) if len(last7) >= 2 else np.nan
    roll_std_30 = float(np.std(last30, ddof=0)) if len(last30) >= 2 else np.nan
    roll_median_14 = float(np.median(last14)) if last14 else np.nan

    dow_sin, dow_cos = _dow_sin_cos(cur_date)
    month_sin, month_cos = _month_sin_cos(cur_date)

    # Days since last observed value (target_idx - last_observed_idx).
    last_obs_idx = last_known
    days_since_last_obs = float(target_idx - last_obs_idx)

    # Same DOW mean over the prior 4 weeks. Walk back up to 4*7=28
    # days looking for entries whose day-of-week equals cur_date's.
    target_dow = cur_date.dayofweek
    same_dow: List[float] = []
    for j in range(last_known, -1, -1):
        if dates[j].dayofweek == target_dow:
            v = _safe(values, j, np.nan)
            if not (isinstance(v, float) and math.isnan(v)):
                same_dow.append(float(v))
        if len(same_dow) >= 4:
            break
    same_dow_mean_4w = float(np.mean(same_dow)) if same_dow else np.nan

    return [
        lag_1,
        lag_7,
        lag_14,
        lag_30,
        roll_mean_7,
        roll_mean_14,
        roll_mean_30,
        roll_std_7,
        roll_std_30,
        roll_median_14,
        dow_sin,
        dow_cos,
        month_sin,
        month_cos,
        days_since_last_obs,
        same_dow_mean_4w,
    ]


def make_features(
    series: pd.DataFrame,
) -> Tuple[np.ndarray, np.ndarray, pd.Series, List[str]]:
    """Walk the series and emit one (X, y) row per index >= 1.

    The target at index i is `values[i]` (the price on day i+1 relative
    to the features at i-1). Drop the first row (no lag available).
    Drop any row whose feature vector contains NaN — these are early
    days of the series where the rolling windows have not yet filled.
    """
    if series.empty:
        return (
            np.zeros((0, len(FEATURE_NAMES)), dtype=float),
            np.zeros((0,), dtype=float),
            pd.Series(dtype="datetime64[ns]"),
            list(FEATURE_NAMES),
        )

    s = series.sort_values("date").reset_index(drop=True)
    values: List[float] = [float(v) for v in s["value"].tolist()]
    dates: List[pd.Timestamp] = [pd.Timestamp(d) for d in s["date"].tolist()]

    X_rows: List[List[float]] = []
    y_rows: List[float] = []
    keep_dates: List[pd.Timestamp] = []

    for i in range(1, len(values)):
        feats = _row_features(values, dates, i)
        # Skip the row only if a CRITICAL feature is NaN. We tolerate
        # one or two missing lags early in the series.
        # lag_1 is critical; if NaN, skip.
        if feats[0] != feats[0]:  # NaN check
            continue
        X_rows.append(feats)
        y_rows.append(values[i])
        keep_dates.append(dates[i])

    X = np.array(X_rows, dtype=float)
    y = np.array(y_rows, dtype=float)
    return X, y, pd.Series(keep_dates, name="date"), list(FEATURE_NAMES)


def extend_with_forecast(
    series: pd.DataFrame, forecast_values: Sequence[float]
) -> pd.DataFrame:
    """Append `forecast_values` onto a copy of `series` as if they had
    been observed. Used at inference for the day-by-day recursive
    forecast. Caller is responsible for ensuring the dates line up.
    """
    s = series.copy().sort_values("date").reset_index(drop=True)
    if not forecast_values:
        return s
    last_date = pd.Timestamp(s["date"].iloc[-1])
    extra_rows = []
    for i, v in enumerate(forecast_values, start=1):
        extra_rows.append(
            {
                "date": (last_date + pd.Timedelta(days=i)).strftime("%Y-%m-%d"),
                "crop": s["crop"].iloc[-1] if "crop" in s.columns else "",
                "state": s["state"].iloc[-1] if "state" in s.columns else "",
                "value": float(v),
                "market_count": 0,
            }
        )
    return pd.concat([s, pd.DataFrame(extra_rows)], ignore_index=True)


def same_features(series: pd.DataFrame) -> List[float]:
    """Build the single feature row representing "today" using every
    known observation in `series`. Returns a list of length
    len(FEATURE_NAMES) with no NaN — the caller is expected to have
    already verified there is enough history.
    """
    if series.empty:
        raise ValueError("series is empty")
    s = series.sort_values("date").reset_index(drop=True)
    values: List[float] = [float(v) for v in s["value"].tolist()]
    dates: List[pd.Timestamp] = [pd.Timestamp(d) for d in s["date"].tolist()]

# The prediction target is the next day after the last observed date.
# Add only the future DATE; do not add a future price/value.
    next_date = dates[-1] + pd.Timedelta(days=1)
    inference_dates = dates + [next_date]

    feats = _row_features(values, inference_dates, len(values))
    if any(math.isnan(f) for f in feats):
        raise ValueError("insufficient history for same_features")
    return feats
