/**
 * scripts/verify_ml_agmarknet_integration.cjs — Phase 6 real-data
 * integration verifier.
 *
 * Validates the full pipeline:
 *   AGMARKNET historical data → MongoDB → mlPrediction.js → API
 *
 * Runs against the real MongoDB (not in-memory). Reads the actual
 * AGMARKNET records that were persisted by the backfill, and verifies
 * that the ML service:
 *
 *   1. Detects sufficient historical dates
 *   2. Loads real historical values
 *   3. Produces an actual prediction (available: true)
 *   4. Returns trend direction + confidence
 *   5. Surfaces historical min/max
 *   6. Identifies the data source as 'agmarknet' (not 'mixed')
 *
 * Test cases (real crops in the validation dataset):
 *   - Onion + Maharashtra
 *   - Onion + Karnataka
 *   - Potato + Maharashtra
 *
 * Exits 0 on full pass, 1 on any failure.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const MarketPrice = require('../src/models/MarketPrice');
const { predictPriceML } = require('../src/services/marketPrice/mlPrediction');

let PASS = 0;
let FAIL = 0;
const failures = [];

function step(n, label, ok, detail = '') {
  if (ok) {
    PASS += 1;
    console.log(`[OK]   ${n}. ${label}${detail ? '  — ' + detail : ''}`);
  } else {
    FAIL += 1;
    failures.push(`${n}. ${label}${detail ? ' — ' + detail : ''}`);
    console.log(`[FAIL] ${n}. ${label}${detail ? '  — ' + detail : ''}`);
  }
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agroconnect';
  await mongoose.connect(uri);
  console.log(`[verify_ml_real] connected to ${uri}`);

  // ---- 0. Sanity: confirm AGMARKNET data exists ----
  const totalAgmarknet = await MarketPrice.countDocuments({ source: 'agmarknet' });
  step(0, 'AGMARKNET records present in real MongoDB',
    totalAgmarknet > 0,
    `total=${totalAgmarknet}`);

  if (totalAgmarknet === 0) {
    console.log('[verify_ml_real] no AGMARKNET data found; cannot proceed');
    await mongoose.disconnect();
    console.log('');
    console.log(`=== ${PASS} passed, ${FAIL} failed ===`);
    if (FAIL > 0) {
      failures.forEach((f) => console.log('  - ' + f));
    }
    process.exit(1);
  }

  // ---- Per-crop-state tests ----
  const cases = [
    { crop: 'Onion', state: 'Maharashtra' },
    { crop: 'Onion', state: 'Karnataka' },
    { crop: 'Potato', state: 'Maharashtra' },
  ];

  for (const c of cases) {
    const escCrop = c.crop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escState = c.state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. Count records
    const recordCount = await MarketPrice.countDocuments({
      source: 'agmarknet',
      cropName: new RegExp(`^${escCrop}$`, 'i'),
      state: new RegExp(`^${escState}$`, 'i'),
    });

    // 2. Count distinct dates
    const distinctDatesAgg = await MarketPrice.aggregate([
      {
        $match: {
          source: 'agmarknet',
          cropName: new RegExp(`^${escCrop}$`, 'i'),
          state: new RegExp(`^${escState}$`, 'i'),
          pricePerKg: { $ne: null },
        },
      },
      { $group: { _id: '$arrivalDate' } },
      { $count: 'distinctDates' },
    ]);
    const distinctDates = distinctDatesAgg[0]?.distinctDates || 0;

    step(
      `${c.crop}+${c.state}.1`,
      `AGMARKNET records present for ${c.crop} + ${c.state}`,
      recordCount > 0,
      `records=${recordCount}`
    );
    step(
      `${c.crop}+${c.state}.2`,
      `≥10 distinct historical dates available`,
      distinctDates >= 10,
      `distinctDates=${distinctDates}`
    );

    // 3. Run the actual ML service
    const result = await predictPriceML({
      crop: c.crop,
      state: c.state,
      days: 7,
      minHistoryDates: 10,
      holdoutDays: 14,
    });

    step(
      `${c.crop}+${c.state}.3`,
      'predictPriceML returns available:true (real data found)',
      result.available === true,
      `available=${result.available} distinct=${result.distinct_dates} src=${result.source_used}`
    );

    step(
      `${c.crop}+${c.state}.4`,
      'source_used is "agmarknet" (not "mixed" or "error")',
      result.source_used === 'agmarknet',
      `source_used=${result.source_used}`
    );

    step(
      `${c.crop}+${c.state}.5`,
      'history_summary carries last_avg + min + max + dates',
      result.history_summary &&
        result.history_summary.first_date &&
        result.history_summary.last_date &&
        result.history_summary.last_avg != null &&
        result.history_summary.min != null &&
        result.history_summary.max != null,
      `last_avg=${result.history_summary?.last_avg} range=${result.history_summary?.min}-${result.history_summary?.max}`
    );

    step(
      `${c.crop}+${c.state}.6`,
      'confidence is set (not "none")',
      result.confidence && result.confidence !== 'none',
      `confidence=${result.confidence}`
    );

    step(
      `${c.crop}+${c.state}.7`,
      'trend_direction is set (not "unknown")',
      result.trend_direction && result.trend_direction !== 'unknown',
      `trend=${result.trend_direction}`
    );

    step(
      `${c.crop}+${c.state}.8`,
      'projection has 7 day-points with chosen_point values',
      Array.isArray(result.projection) &&
        result.projection.length === 7 &&
        result.projection.every((p) => p.chosen_point != null),
      `projection_count=${result.projection?.length}`
    );

    step(
      `${c.crop}+${c.state}.9`,
      'disclaimer is present and is_estimate is true',
      typeof result.disclaimer === 'string' && result.is_estimate === true,
      `is_estimate=${result.is_estimate}`
    );

    // 10. Show a sample projection
    if (result.projection && result.projection[0]) {
      const p = result.projection[0];
      console.log(
        `       sample: ${c.crop}+${c.state} day1=${p.date} ₹${p.chosen_point}/kg (range ₹${p.low}-${p.high}) method=${p.chosen_method}`
      );
    }
  }

  await mongoose.disconnect();
  console.log('');
  console.log(`=== ${PASS} passed, ${FAIL} failed ===`);
  if (FAIL > 0) {
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[verify_ml_real] fatal:', err);
  process.exit(99);
});
