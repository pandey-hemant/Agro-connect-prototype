/**
 * services/marketPrice/mlPrediction.js — Phase 5 ML price prediction
 * with baseline comparison.
 *
 * Three models are fit on the daily per-(crop,state) series:
 *
 *   baseline_seasonal_naive
 *     Predicts tomorrow as the average of the same day-of-week in the
 *     last `lookback_weeks` weeks (default 4). Robust to local dips
 *     and spikes; a strong baseline for agricultural series.
 *
 *   baseline_weighted_recent
 *     Predicts tomorrow as the exponentially weighted average of the
 *     last `recent_window` daily prices (default 14). Half-life =
 *     7 days. Smooths the noise and reacts to short-term moves.
 *
 *   linear_trend
 *     Closed-form least-squares on (dayIndex, avgPrice). Reused from
 *     the original placeholder so we always have a third comparator.
 *
 * The model with the lowest in-sample MAE on the LAST
 * `holdout_days` days (default 14) is selected. If holdout is too
 * short, we score on the full series instead. The chosen model's
 * `point` forecast is returned, and the other two are returned for
 * comparison. This makes the wire shape honest: the frontend can
 * show "Our pick" + the baselines, and the user can see the spread.
 *
 * All numeric work is in JS. The history fetch is one Mongo .find().
 * The ML never reaches the network. The function NEVER throws — on
 * any error it returns { available: false, ... }.
 *
 * The disclaimer is mandatory on every successful response.
 */
'use strict';

const MarketPrice = require('../../models/MarketPrice');
const { callPythonPredict } = require('./pythonMlClient');

const NUM = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const DISCLAIMER =
  'Heuristic forecast. NOT financial advice. Compare to a real model before acting.';

function buildUnavailable(payload) {
  const source = payload.source || 'unknown';
  let message = `Insufficient historical data for a forecast. Need at least ${payload.minHistoryDates} distinct dates; found ${payload.distinctDates}.`;

  // Provide more specific guidance based on data source
  if (source === 'agmarknet' && payload.distinctDates === 0) {
    message = 'No AGMARKNET historical data available for this crop/location combination.';
  } else if (source === 'mixed' && payload.distinctDates === 0) {
    message = 'No historical price data available from any source for this crop/location combination.';
  }

  // Return 3 baseline candidates even when data is insufficient
  // This allows UI to show "no prediction available, but here are the models we would use"
  const baselineCandidates = [
    {
      method: 'seasonal_naive',
      params: { lookbackWeeks: 4 },
      in_sample_mae: null,
    },
    {
      method: 'weighted_recent',
      params: { recentWindow: 14, halfLifeDays: 7 },
      in_sample_mae: null,
    },
    {
      method: 'linear_trend',
      params: {},
      in_sample_mae: null,
    },
  ];

  return {
    available: false,
    method: null,
    is_estimate: true,
    disclaimer: DISCLAIMER,
    message,
    crop: payload.crop || null,
    state: payload.state || null,
    market: payload.market || null,
    distinct_dates: payload.distinctDates,
    min_history_dates_required: payload.minHistoryDates,
    source_used: source,
    confidence: 'none',
    trend_direction: 'unknown',
    historical_min: null,
    historical_max: null,
    history_summary: null,
    candidates: baselineCandidates,
    chosen: null,
    projection: [],
  };
}

function fitLinear(xs, ys) {
  const n = xs.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

function mae(predicted, actual) {
  if (predicted.length !== actual.length) return Infinity;
  let s = 0;
  let n = 0;
  for (let i = 0; i < predicted.length; i += 1) {
    if (Number.isFinite(predicted[i]) && Number.isFinite(actual[i])) {
      s += Math.abs(predicted[i] - actual[i]);
      n += 1;
    }
  }
  return n === 0 ? Infinity : s / n;
}

/**
 * Seasonal-naive forecast: the prediction for day d is the average of
 * the values that fell on the same day-of-week in the last
 * `lookback_weeks` weeks. We use the day-of-week of the *next* day.
 */
function seasonalNaivePredict(ysSortedDates, lookbackWeeks = 4) {
  // ysSortedDates: [{ date: 'YYYY-MM-DD', dow: 0..6, value: number }]
  if (ysSortedDates.length === 0) return null;
  const last = ysSortedDates[ysSortedDates.length - 1];
  const targetDow = (last.dow + 1) % 7;
  // Look at the prior entries with the same dow.
  const same = ysSortedDates
    .filter((p) => p.dow === targetDow)
    .slice(-lookbackWeeks);
  if (same.length === 0) return ysSortedDates[ysSortedDates.length - 1].value;
  return same.reduce((a, b) => a + b.value, 0) / same.length;
}

/**
 * Weighted recent: exponentially weighted average of the last
 * `recent_window` points. Half-life = 7 days.
 */
function weightedRecentPredict(ysSortedDates, recentWindow = 14, halfLifeDays = 7) {
  if (ysSortedDates.length === 0) return null;
  const window = ysSortedDates.slice(-recentWindow);
  const decay = Math.LN2 / halfLifeDays;
  let wsum = 0;
  let vsum = 0;
  for (let i = 0; i < window.length; i += 1) {
    const distFromEnd = window.length - 1 - i;
    const w = Math.exp(-decay * distFromEnd);
    wsum += w;
    vsum += w * window[i].value;
  }
  return wsum === 0 ? null : vsum / wsum;
}

function linearTrendProject(ysSortedDates, horizonDays) {
  if (ysSortedDates.length < 2) return [];
  const xs = ysSortedDates.map((_, i) => i);
  const ys = ysSortedDates.map((p) => p.value);
  const { slope, intercept } = fitLinear(xs, ys);
  const out = [];
  for (let i = 0; i < horizonDays; i += 1) {
    out.push(intercept + slope * (xs.length + i));
  }
  return out;
}

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T12:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dowOf(iso) {
  const d = new Date(`${iso}T12:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return 0;
  return d.getUTCDay();
}

async function predictPriceML({
  crop,
  state,
  market,
  days = 7,
  minHistoryDates = 10,
  holdoutDays = 14,
  lookbackWeeks = 4,
  recentWindow = 14,
} = {}) {
  if (!crop) {
    return buildUnavailable({
      crop: null,
      state: state || null,
      market: market || null,
      distinctDates: 0,
      minHistoryDates,
    });
  }

  // ML v2 — try the Python XGBoost service first. If it returns a
  // valid envelope, forward it. The wire shape it returns already
  // matches what the JS engine would have produced, so the rest of
  // the app is unaffected. The service is best-effort: any failure
  // (timeout, down, 5xx, shape mismatch) drops through to the JS
  // engine so the user never sees a regression.
  try {
    const py = await callPythonPredict({
      crop,
      state: state || null,
      market: market || null,
      days,
      minHistoryDates,
    });
    if (py && typeof py === 'object' && typeof py.available === 'boolean') {
      // Fill in any JS-side fields the Python service doesn't carry
      // (the existing JS callers rely on these existing as null/0
      // and the React DecisionCard renders them defensively).
      if (py.history_summary && !py.history_summary.last_avg) {
        py.history_summary.last_avg = py.current_price;
      }
      return py;
    }
  } catch (_) {
    // fall through to the JS engine
  }

  // PHASE 1 UPDATE: Prioritize AGMARKNET historical data for ML predictions
  // First try AGMARKNET source, fall back to all sources if insufficient data
  const filter = {
    cropName: new RegExp(`^${String(crop).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    priceDate: { $exists: true, $ne: '' },
  };
  if (state) {
    filter.state = new RegExp(`^${String(state).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  }
  if (market) {
    filter.market = new RegExp(String(market).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  // Prioritize AGMARKNET source
  const filterAgmarknet = { ...filter, source: 'agmarknet' };
  const filterAllSources = filter;

  let rows;
  let sourceUsed = 'agmarknet';
  try {
    // First try AGMARKNET source
    rows = await MarketPrice.find(filterAgmarknet).lean();

    // If insufficient data from AGMARKNET, fall back to all sources
    if (rows.length === 0) {
      rows = await MarketPrice.find(filterAllSources).lean();
      sourceUsed = 'mixed';
    }
  } catch (_) {
    return buildUnavailable({
      crop,
      state: state || null,
      market: market || null,
      distinctDates: 0,
      minHistoryDates,
      source: 'error',
    });
  }

  // Aggregate to one (date → avg) per day, across markets.
  const byDate = new Map();
  for (const r of rows) {
    const pd = r.priceDate || r.arrivalDate;
    if (!pd) continue;
    const p = NUM(r.pricePerKg);
    if (p == null) continue;
    const arr = byDate.get(pd) || [];
    arr.push(p);
    byDate.set(pd, arr);
  }
  const sortedDates = Array.from(byDate.keys()).sort();
  const distinctDates = sortedDates.length;
  if (distinctDates < minHistoryDates) {
    return buildUnavailable({
      crop,
      state: state || null,
      market: market || null,
      distinctDates,
      minHistoryDates,
      source: sourceUsed,
    });
  }

  const series = sortedDates.map((pd) => ({
    date: pd,
    dow: dowOf(pd),
    value: byDate.get(pd).reduce((a, b) => a + b, 0) / byDate.get(pd).length,
  }));

  // Holdout scoring: we score each candidate on the last
  // `holdoutDays` points by walking through them. We rebuild a
  // per-step history of values, then for each held-out index i ask
  // each candidate to predict series[i].value given series[0..i-1].
  const hDays = Math.min(holdoutDays, Math.max(2, Math.floor(series.length / 2)));
  const holdoutStart = Math.max(2, series.length - hDays);

  const holdoutActual = series.slice(holdoutStart).map((p) => p.value);

  // We need step-by-step preds inside the holdout window. Recompute
  // by walking the holdout period with growing history. For each
  // step i, history is series[0..holdoutStart+i-1] and we predict
  // the i-th holdout actual. This is a true one-step-ahead MAE.
  function walk(fn) {
    const preds = [];
    for (let i = 0; i < holdoutActual.length; i += 1) {
      const hist = series.slice(0, holdoutStart + i);
      preds.push(fn(hist));
    }
    return preds;
  }
  const snHold = walk((h) => seasonalNaivePredict(h, lookbackWeeks));
  const wrHold = walk((h) => weightedRecentPredict(h, recentWindow));
  const lnHold = walk((h) => {
    const xs = h.map((_, i) => i);
    const ys = h.map((p) => p.value);
    const { slope, intercept } = fitLinear(xs, ys);
    // predict the NEXT step (x = h.length)
    return intercept + slope * h.length;
  });

  // Quick sanity: if holdout is too small (<2 points), fall back to
  // a one-step-ahead MAE on the last few points as a tie-breaker.
  let snMae;
  let wrMae;
  let lnMae;
  if (holdoutActual.length >= 2) {
    snMae = mae(snHold, holdoutActual);
    wrMae = mae(wrHold, holdoutActual);
    lnMae = mae(lnHold, holdoutActual);
  } else {
    // Fallback: leave-one-out one-step-ahead on the LAST 5 points
    // (or fewer). For each i, the i-th point is predicted from
    // history[0..i-1]; we score against the actual i-th value.
    // This is comparable across all three models because they all
    // see the same history windows.
    const tail = series.slice(-Math.min(5, series.length));
    const a = tail.map((p) => p.value);
    function oneStepAheadLinear(history) {
      if (history.length < 2) return null;
      const xs = history.map((_, i) => i);
      const ys = history.map((p) => p.value);
      const { slope, intercept } = fitLinear(xs, ys);
      return intercept + slope * (xs.length); // next-step x = h.length
    }
    const sn1 = [];
    const wr1 = [];
    const ln1 = [];
    for (let i = 0; i < tail.length; i += 1) {
      const hist = tail.slice(0, i);
      sn1.push(seasonalNaivePredict(hist, lookbackWeeks));
      wr1.push(weightedRecentPredict(hist, recentWindow));
      ln1.push(oneStepAheadLinear(hist));
    }
    snMae = mae(sn1, a);
    wrMae = mae(wr1, a);
    lnMae = mae(ln1, a);
  }

  const candidates = [
    {
      method: 'seasonal_naive',
      params: { lookbackWeeks },
      in_sample_mae: Number.isFinite(snMae) ? Math.round(snMae * 100) / 100 : null,
    },
    {
      method: 'weighted_recent',
      params: { recentWindow, halfLifeDays: 7 },
      in_sample_mae: Number.isFinite(wrMae) ? Math.round(wrMae * 100) / 100 : null,
    },
    {
      method: 'linear_trend',
      params: {},
      in_sample_mae: Number.isFinite(lnMae) ? Math.round(lnMae * 100) / 100 : null,
    },
  ];

  // Pick the candidate with the lowest MAE; break ties by preferring
  // the simpler model (seasonal_naive first, then weighted_recent,
  // then linear_trend).
  const order = ['seasonal_naive', 'weighted_recent', 'linear_trend'];
  let chosen = candidates[0].method;
  let best = candidates[0].in_sample_mae;
  for (const c of candidates) {
    if (
      c.in_sample_mae != null &&
      (best == null || c.in_sample_mae < best || (c.in_sample_mae === best && order.indexOf(c.method) < order.indexOf(chosen)))
    ) {
      best = c.in_sample_mae;
      chosen = c.method;
    }
  }

  // Forecast `days` ahead.
  const horizon = Math.max(1, Math.min(30, Number(days) || 7));
  const lastDate = series[series.length - 1].date;
  const lastValue = series[series.length - 1].value;
  const projection = [];
  for (let i = 0; i < horizon; i += 1) {
    // Build the "next-step history" for each model.
    const extendedHistory = [...series];
    for (let j = 0; j < i; j += 1) {
      // Feed back the previously chosen point as if it had been real.
      // This keeps the seasonal/window logic stable across the horizon.
      extendedHistory.push({
        date: addDaysIso(lastDate, j + 1),
        dow: dowOf(addDaysIso(lastDate, j + 1)),
        value: projection[j].chosen_point,
      });
    }
    const snPoint = seasonalNaivePredict(extendedHistory, lookbackWeeks);
    const wrPoint = weightedRecentPredict(extendedHistory, recentWindow);
    const linPts = linearTrendProject(extendedHistory, 1);
    const lnPoint = linPts[0];
    const candidatePoints = {
      seasonal_naive: snPoint,
      weighted_recent: wrPoint,
      linear_trend: lnPoint,
    };
    const chosenPoint = candidatePoints[chosen];
    // Band: ±1.5 * best MAE clamped to a minimum of ₹0.50.
    const band = Math.max(0.5, 1.5 * (best || 0.5));
    const fmt = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
    projection.push({
      day: i + 1,
      date: addDaysIso(lastDate, i + 1),
      chosen_method: chosen,
      chosen_point: fmt(chosenPoint),
      low: chosenPoint == null ? null : fmt(chosenPoint - band),
      high: chosenPoint == null ? null : fmt(chosenPoint + band),
      candidates: {
        seasonal_naive: fmt(snPoint),
        weighted_recent: fmt(wrPoint),
        linear_trend: fmt(lnPoint),
      },
    });
  }

  // PHASE 1 UPDATE: Calculate confidence and trend direction
  // Confidence based on: number of historical dates and holdout MAE relative to price level
  let confidence = 'low';
  if (distinctDates >= 30 && best != null && best < lastValue * 0.1) {
    confidence = 'high';
  } else if (distinctDates >= 20 && best != null && best < lastValue * 0.15) {
    confidence = 'medium';
  } else if (distinctDates >= 10) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // Calculate trend direction based on first projection vs last known price
  const firstProjection = projection[0] && projection[0].chosen_point;
  let trendDirection = 'flat';
  if (firstProjection != null && lastValue > 0) {
    const delta = (firstProjection - lastValue) / lastValue;
    if (delta > 0.02) trendDirection = 'up';
    else if (delta < -0.02) trendDirection = 'down';
    else trendDirection = 'flat';
  }

  // Calculate historical min/max for context
  const historicalMin = Math.min(...series.map((p) => p.value));
  const historicalMax = Math.max(...series.map((p) => p.value));

  return {
    available: true,
    is_estimate: true,
    disclaimer: DISCLAIMER,
    method: chosen,
    crop,
    state: state || null,
    market: market || null,
    distinct_dates: distinctDates,
    holdout_days: holdoutActual.length,
    source_used: sourceUsed,
    confidence,
    trend_direction: trendDirection,
    historical_min: Math.round(historicalMin * 100) / 100,
    historical_max: Math.round(historicalMax * 100) / 100,
    current_price: Math.round(lastValue * 100) / 100,
    history_summary: {
      first_date: series[0].date,
      last_date: lastDate,
      last_avg: Math.round(lastValue * 100) / 100,
      min: Math.round(historicalMin * 100) / 100,
      max: Math.round(historicalMax * 100) / 100,
    },
    candidates,
    projection,
  };
}

module.exports = { predictPriceML, DISCLAIMER };
