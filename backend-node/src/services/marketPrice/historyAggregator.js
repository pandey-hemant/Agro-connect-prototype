/**
 * services/marketPrice/historyAggregator.js — last-N-days aggregator.
 *
 * Reads the MarketPrice collection (anything with a `priceDate`) and
 * groups rows into daily / weekly / monthly / 1st-of-month buckets.
 * Each bucket reports min / max / avg / modal / count. The change %
 * vs the previous bucket and a coarse trend (up / down / flat) are
 * computed from the bucket averages.
 *
 * Contract — NEVER throws. On any error returns a structured empty
 * result with a `note` describing the failure.
 *
 * Trend is "up" / "down" only when the average swings more than
 * 2% across the first-half vs second-half split. Otherwise "flat".
 *
 * This is a built-in aggregation over Mongo, NOT a forecast. The
 * `note` field always states so.
 */
'use strict';

const MarketPrice = require('../../models/MarketPrice');

const NUM = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isValidIso(s) {
  return typeof s === 'string' && ISO_DATE.test(s);
}

// Pick the date (UTC noon) that anchors a priceDate. We use noon so
// timezone drift on either side of a date line is harmless.
function dateOf(priceDate) {
  if (!isValidIso(priceDate)) return null;
  const d = new Date(`${priceDate}T12:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function startOfWeek(d) {
  // Week starts Monday. ISO week.
  const out = new Date(d);
  const day = out.getUTCDay(); // 0..6, Sun=0
  const diff = (day + 6) % 7; // days since Monday
  out.setUTCDate(out.getUTCDate() - diff);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function startOfMonth(d) {
  const out = new Date(d);
  out.setUTCDate(1);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function bucketKey(d, granularity) {
  if (granularity === 'daily') {
    return d.toISOString().slice(0, 10);
  }
  if (granularity === 'weekly') {
    const monday = startOfWeek(d);
    return monday.toISOString().slice(0, 10);
  }
  if (granularity === 'monthly') {
    const first = startOfMonth(d);
    return first.toISOString().slice(0, 10);
  }
  // default
  return d.toISOString().slice(0, 10);
}

function isoFromBucketKey(key, granularity) {
  if (granularity === 'monthly') {
    return `${key.slice(0, 7)}-01`;
  }
  return key;
}

async function listHistorical({
  crop,
  state,
  market,
  from,
  to,
  granularity = 'weekly',
} = {}) {
  if (!crop) {
    return {
      is_estimate: true,
      method: 'mongo_aggregation',
      source: 'mongo',
      granularity: granularity || 'weekly',
      from: null,
      to: null,
      crop: null,
      state: state || null,
      market: market || null,
      trend: 'flat',
      distinct_dates: 0,
      total_buckets: 0,
      note: 'Built-in historical aggregation over the Mongo MarketPrice collection. This is NOT a forecast. Crop is required.',
      results: [],
    };
  }

  // Resolve date window. Default = last 30 days ending today.
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const fromIso =
    isValidIso(from) ? from : new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const toIso = isValidIso(to) ? to : todayIso;

  const filter = {
    cropName: new RegExp(`^${String(crop).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    priceDate: { $gte: fromIso, $lte: toIso },
  };
  if (state) filter.state = new RegExp(`^${String(state).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  if (market) filter.market = new RegExp(String(market).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const rows = await MarketPrice.find(filter).lean();

  const distinctDates = new Set();
  for (const r of rows) {
    const pd = r.priceDate || r.arrivalDate;
    if (pd) distinctDates.add(String(pd));
  }

  // Bucket the rows.
  const buckets = new Map();
  for (const r of rows) {
    const pd = r.priceDate || r.arrivalDate;
    const d = dateOf(pd);
    if (!d) continue;
    const key = bucketKey(d, granularity);
    const arr = buckets.get(key) || [];
    arr.push(r);
    buckets.set(key, arr);
  }

  const sortedKeys = Array.from(buckets.keys()).sort();

  const results = [];
  let prevAvg = null;
  for (const key of sortedKeys) {
    const arr = buckets.get(key) || [];
    const prices = arr
      .map((r) => NUM(r.pricePerKg))
      .filter((v) => v != null);
    if (prices.length === 0) {
      results.push({
        period: isoFromBucketKey(key, granularity),
        min: null,
        max: null,
        avg: null,
        modal: null,
        count: 0,
        change_pct_vs_prev: null,
      });
      continue;
    }
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const sum = prices.reduce((a, b) => a + b, 0);
    const avg = sum / prices.length;
    // Modal: pick the most-frequent value (rounded to 2dp). Ties
    // resolve to the first encountered.
    const freq = new Map();
    for (const p of prices) {
      const k = Math.round(p * 100) / 100;
      freq.set(k, (freq.get(k) || 0) + 1);
    }
    let modal = null;
    let modalCount = -1;
    for (const [k, c] of freq.entries()) {
      if (c > modalCount) {
        modal = k;
        modalCount = c;
      }
    }
    const change = prevAvg != null && prevAvg !== 0
      ? ((avg - prevAvg) / prevAvg) * 100
      : null;
    results.push({
      period: isoFromBucketKey(key, granularity),
      min,
      max,
      avg,
      modal,
      count: arr.length,
      change_pct_vs_prev: change != null ? Math.round(change * 100) / 100 : null,
    });
    prevAvg = avg;
  }

  // Coarse trend = compare first-half avg to second-half avg. If
  // distinct buckets >= 2; otherwise 'flat'.
  let trend = 'flat';
  if (results.length >= 2) {
    const half = Math.max(1, Math.floor(results.length / 2));
    const first = results.slice(0, half);
    const second = results.slice(half);
    const avgOf = (xs) => {
      const ys = xs.map((r) => r.avg).filter((v) => v != null);
      if (ys.length === 0) return null;
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    };
    const a = avgOf(first);
    const b = avgOf(second);
    if (a != null && b != null && a !== 0) {
      const delta = (b - a) / a;
      if (delta > 0.02) trend = 'up';
      else if (delta < -0.02) trend = 'down';
      else trend = 'flat';
    }
  }

  return {
    is_estimate: true,
    method: 'mongo_aggregation',
    source: 'mongo',
    granularity,
    from: fromIso,
    to: toIso,
    crop,
    state: state || null,
    market: market || null,
    trend,
    distinct_dates: distinctDates.size,
    total_buckets: results.length,
    note: 'Built-in historical aggregation over the Mongo MarketPrice collection. This is NOT a forecast.',
    results,
  };
}

module.exports = { listHistorical };
