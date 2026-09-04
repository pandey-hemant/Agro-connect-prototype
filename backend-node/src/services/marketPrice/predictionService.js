/**
 * services/marketPrice/predictionService.js — placeholder prediction.
 *
 * This is NOT an AI/ML forecast. The default response is
 *   { available: false, ... }
 * with a clear "insufficient data" message. Only when there are at
 * least `minHistoryDates` distinct dates (default 5) for the crop
 * do we attempt a transparent linear-trend extrapolation.
 *
 * The extrapolation is a deterministic least-squares fit on
 * (dayIndex, avgPrice) pairs. The result carries a mandatory
 * disclaimer string and `is_estimate: true` on the wire.
 *
 * NEVER throws. Any error returns a structured "insufficient data"
 * response.
 */
'use strict';

const MarketPrice = require('../../models/MarketPrice');

const NUM = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const DISCLAIMER = 'Trend extrapolation only; not an AI/ML prediction.';

function buildUnavailable(payload) {
  return {
    available: false,
    method: null,
    is_estimate: true,
    disclaimer: DISCLAIMER,
    message: `Insufficient historical data for a forecast. Need at least ${payload.minHistoryDates} distinct dates; found ${payload.distinctDates}.`,
    crop: payload.crop || null,
    state: payload.state || null,
    market: payload.market || null,
    distinct_dates: payload.distinctDates,
    history_summary: null,
    projection: null,
  };
}

function fitLinear(xs, ys) {
  // Closed-form least squares: y = slope * x + intercept.
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

async function predictPrice({
  crop,
  state,
  market,
  days = 7,
  minHistoryDates = 5,
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

  let rows;
  try {
    rows = await MarketPrice.find(filter).lean();
  } catch (_) {
    return buildUnavailable({
      crop,
      state: state || null,
      market: market || null,
      distinctDates: 0,
      minHistoryDates,
    });
  }

  // Aggregate avg per distinct date.
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
    });
  }

  // Day-index 0..N-1 from the earliest date.
  const xs = [];
  const ys = [];
  sortedDates.forEach((pd, i) => {
    xs.push(i);
    const arr = byDate.get(pd);
    ys.push(arr.reduce((a, b) => a + b, 0) / arr.length);
  });

  const { slope, intercept } = fitLinear(xs, ys);
  const lastY = ys[ys.length - 1];
  const band = Math.max(0.05 * lastY, 0.5); // ±5% of last OR ₹0.50, whichever is larger

  const projection = [];
  for (let i = 0; i < days; i += 1) {
    const point = intercept + slope * (xs.length + i);
    projection.push({
      day: i + 1,
      point: Math.round(point * 100) / 100,
      low: Math.round((point - band) * 100) / 100,
      high: Math.round((point + band) * 100) / 100,
    });
  }

  return {
    available: true,
    method: 'linear_trend',
    is_estimate: true,
    disclaimer: DISCLAIMER,
    crop,
    state: state || null,
    market: market || null,
    distinct_dates: distinctDates,
    history_summary: {
      first_date: sortedDates[0],
      last_date: sortedDates[sortedDates.length - 1],
      last_avg: Math.round(lastY * 100) / 100,
      slope: Math.round(slope * 10000) / 10000,
      intercept: Math.round(intercept * 100) / 100,
    },
    projection,
  };
}

module.exports = { predictPrice, DISCLAIMER };
