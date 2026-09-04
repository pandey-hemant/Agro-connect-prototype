/**
 * scripts/verify_ml_prediction.cjs — Phase 5 ML unit checks.
 *
 * Runs offline against an in-memory Mongo. Inserts a synthetic daily
 * price series (with a known trend and weekly seasonality), then
 * checks:
 *
 *   1.  predictPriceML returns available:false when there are fewer
 *       than `minHistoryDates` distinct dates.
 *   2.  With a flat series (no trend) the chosen method is one of
 *       {seasonal_naive, weighted_recent, linear_trend} and the
 *       candidates[] array has all three.
 *   3.  With a strongly rising series the projection is non-decreasing
 *       on average and the chosen method is reported.
 *   4.  The disclaimer is present and is_estimate is true.
 *   5.  The history_summary carries first_date, last_date, last_avg,
 *       min, max.
 */
'use strict';

const path = require('path');
const { connectMongo, disconnectMongo } = require('../src/db/connect');
const MarketPrice = require('../src/models/MarketPrice');
const { predictPriceML } = require('../src/services/marketPrice/mlPrediction');

let PASS = 0;
let FAIL = 0;
const failures = [];

function step(n, label, ok, detail = '') {
  if (ok) { PASS += 1; console.log(`[OK]   ${n}. ${label}${detail ? '  — ' + detail : ''}`); }
  else { FAIL += 1; failures.push(`${n}. ${label}${detail ? ' — ' + detail : ''}`); console.log(`[FAIL] ${n}. ${label}${detail ? '  — ' + detail : ''}`); }
}

function pad2(n) { return String(n).padStart(2, '0'); }
function isoOf(year, month, day) { return `${year}-${pad2(month)}-${pad2(day)}`; }

async function insertSeries(crop, state, start, days, valueAt) {
  // start: {y,m,d}
  const docs = [];
  const d = new Date(Date.UTC(start.y, start.m - 1, start.d));
  for (let i = 0; i < days; i += 1) {
    const cur = new Date(d.getTime() + i * 86400000);
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth() + 1;
    const dd = cur.getUTCDate();
    const v = valueAt(i);
    docs.push({
      source: 'agmarknet',
      cropName: crop,
      state,
      market: `Market-${i % 3}`,
      pricePerQuintal: v * 100,
      pricePerKg: v,
      arrivalDate: isoOf(y, m, dd),
      priceDate: isoOf(y, m, dd),
      variety: '',
    });
  }
  await MarketPrice.insertMany(docs);
}

async function withFreshDb(fn) {
  await MarketPrice.deleteMany({});
  await fn();
}

async function main() {
  const conn = await connectMongo({ uri: '' });
  console.log(`[verify_ml] mongo mode=${conn.mode}`);
  const ix = await MarketPrice.syncIndexesSafe();
  if (!ix.ok) console.warn(`[verify_ml] index sync warning: ${ix.error}`);

  // ---- 1. insufficient data ----
  await withFreshDb(async () => {
    const r = await predictPriceML({ crop: 'Onion', state: 'Maharashtra', minHistoryDates: 10 });
    // When data is insufficient, available:false but candidates[]
    // still carries the 3 baseline models with null MAE so the UI
    // can show "3 models available, insufficient data" instead of
    // an empty list.
    step(1, 'predictPriceML returns available:false with 3 baseline candidates when < minHistoryDates',
      r.available === false &&
        Array.isArray(r.candidates) &&
        r.candidates.length === 3 &&
        r.candidates.every((c) => c.in_sample_mae === null));
  });

  // ---- 2. flat series ----
  await withFreshDb(async () => {
    await insertSeries('Onion', 'Maharashtra', { y: 2025, m: 1, d: 1 }, 30, () => 20);
    const r = await predictPriceML({ crop: 'Onion', state: 'Maharashtra', days: 7, minHistoryDates: 10, holdoutDays: 7 });
    step(2, 'flat series returns 3 candidates and one chosen',
      r.available === true &&
        r.candidates.length === 3 &&
        r.candidates.every((c) => c.method) &&
        ['seasonal_naive', 'weighted_recent', 'linear_trend'].includes(r.method) &&
        r.projection.length === 7);
  });

  // ---- 3. rising series ----
  await withFreshDb(async () => {
    // Linear rise from ₹10 to ₹30 over 60 days, plus weekly wiggle.
    await insertSeries('Onion', 'Maharashtra', { y: 2025, m: 1, d: 1 }, 60, (i) => {
      const trend = 10 + (20 * i) / 59;
      const dow = i % 7;
      const wig = [0, 0.2, -0.1, 0.3, 0, -0.2, 0.1][dow];
      return Math.round((trend + wig) * 100) / 100;
    });
    const r = await predictPriceML({ crop: 'Onion', state: 'Maharashtra', days: 7, minHistoryDates: 10, holdoutDays: 14 });
    // The first projected point should be > last_avg (since the series
    // is rising) — give the linear model a chance to win, but at
    // least the *first* projection's chosen_point should exceed
    // history_summary.last_avg.
    const first = r.projection[0] && r.projection[0].chosen_point;
    const lastAvg = r.history_summary && r.history_summary.last_avg;
    step(3, 'rising series projects above last_avg',
      r.available && first != null && lastAvg != null && first > lastAvg,
      `first=${first} last=${lastAvg} method=${r.method}`);
  });

  // ---- 4. disclaimer + is_estimate ----
  await withFreshDb(async () => {
    await insertSeries('Onion', 'Maharashtra', { y: 2025, m: 1, d: 1 }, 30, () => 20);
    const r = await predictPriceML({ crop: 'Onion', state: 'Maharashtra', days: 7, minHistoryDates: 10 });
    step(4, 'disclaimer is present and is_estimate is true',
      r.disclaimer && r.is_estimate === true);
  });

  // ---- 5. history_summary shape ----
  await withFreshDb(async () => {
    await insertSeries('Onion', 'Maharashtra', { y: 2025, m: 1, d: 1 }, 30, (i) => 15 + (i % 10));
    const r = await predictPriceML({ crop: 'Onion', state: 'Maharashtra', days: 7, minHistoryDates: 10 });
    const hs = r.history_summary;
    step(5, 'history_summary carries first_date, last_date, last_avg, min, max',
      hs &&
        hs.first_date && hs.last_date && hs.last_avg != null &&
        hs.min != null && hs.max != null,
      `first=${hs && hs.first_date} last=${hs && hs.last_date} min=${hs && hs.min} max=${hs && hs.max}`);
  });

  await disconnectMongo();
  console.log('');
  console.log(`=== ${PASS} passed, ${FAIL} failed ===`);
  if (FAIL > 0) {
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[verify_ml] fatal:', err);
  process.exit(99);
});
