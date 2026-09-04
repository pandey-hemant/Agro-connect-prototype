#!/usr/bin/env node
/**
 * scripts/quality_report.cjs — Phase 5 data-quality report.
 *
 * Scans the MarketPrice collection and emits:
 *   - per-source row counts
 *   - per-(crop, state) coverage: min/max date, distinct market count,
 *     distinct date count
 *   - "suspicious" rows: 0 modal price, arrivals > 1e5 (implausible),
 *     modal per kg outside [1, 500] (commodity-agnostic sanity)
 *   - duplicate identity report (should be 0; the unique index catches
 *     duplicates at insert, but we surface any pre-existing ones)
 *
 * Writes a JSON report to the path given by --report (default:
 * backend-node/data/quality_report.json) and a human summary to stdout.
 *
 * No env, no API key.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Load .env BEFORE requiring anything that reads process.env. Without
// this line, `process.env.MONGODB_URI` is always empty and the report
// would always run against the in-memory fallback.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { connectMongo, disconnectMongo } = require('../src/db/connect');
const MarketPrice = require('../src/models/MarketPrice');

const SUSPICIOUS_MAX_PRICE_PER_KG = 500;
const SUSPICIOUS_MIN_PRICE_PER_KG = 1;
const SUSPICIOUS_MAX_ARRIVALS = 100000;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

async function perSourceCounts() {
  return MarketPrice.aggregate([
    { $group: { _id: '$source', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
}

async function perCropStateCoverage() {
  // One row per (crop, state, source) with date range + distinct counts.
  return MarketPrice.aggregate([
    {
      $group: {
        _id: { crop: '$cropName', state: '$state', source: '$source' },
        n: { $sum: 1 },
        firstDate: { $min: '$priceDate' },
        lastDate: { $max: '$priceDate' },
        markets: { $addToSet: '$market' },
      },
    },
    {
      $project: {
        _id: 0,
        crop: '$_id.crop',
        state: '$_id.state',
        source: '$_id.source',
        n: 1,
        firstDate: 1,
        lastDate: 1,
        distinctMarkets: { $size: '$markets' },
      },
    },
    { $sort: { crop: 1, state: 1, source: 1 } },
  ]);
}

async function suspiciousRows({ limit = 200 } = {}) {
  // We use aggregation expressions because plain find() with $or on
  // multiple fields is awkward and we want to expose the *reason*.
  return MarketPrice.aggregate([
    {
      $addFields: {
        _reasons: {
          $setUnion: [
            {
              $cond: [
                { $eq: ['$pricePerKg', 0] },
                ['zero_modal_price'],
                [],
              ],
            },
            {
              $cond: [
                {
                  $and: [
                    { $ne: ['$arrivals', null] },
                    { $gt: ['$arrivals', SUSPICIOUS_MAX_ARRIVALS] },
                  ],
                },
                ['arrivals_implausibly_large'],
                [],
              ],
            },
            {
              $cond: [
                { $gt: ['$pricePerKg', SUSPICIOUS_MAX_PRICE_PER_KG] },
                ['price_per_kg_too_high'],
                [],
              ],
            },
            {
              $cond: [
                { $lt: ['$pricePerKg', SUSPICIOUS_MIN_PRICE_PER_KG] },
                ['price_per_kg_too_low'],
                [],
              ],
            },
          ],
        },
      },
    },
    { $match: { _reasons: { $ne: [] } } },
    {
      $project: {
        _id: 1,
        source: 1,
        cropName: 1,
        state: 1,
        market: 1,
        priceDate: 1,
        pricePerKg: 1,
        pricePerQuintal: 1,
        arrivals: 1,
        reasons: '$_reasons',
      },
    },
    { $limit: limit },
  ]);
}

async function duplicateIdentity() {
  // Should be empty if the partial unique index did its job. We use
  // $facet to count groups whose size is > 1.
  const groups = await MarketPrice.aggregate([
    {
      $group: {
        _id: {
          source: '$source',
          cropName: '$cropName',
          state: '$state',
          market: '$market',
          arrivalDate: '$arrivalDate',
          variety: '$variety',
        },
        ids: { $push: '$_id' },
        n: { $sum: 1 },
      },
    },
    { $match: { n: { $gt: 1 } } },
    { $project: { _id: 0, key: '$_id', n: 1, ids: 1 } },
    { $limit: 50 },
  ]);
  return groups;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = args.report || path.resolve(__dirname, '..', 'data', 'quality_report.json');

  const conn = await connectMongo({ uri: process.env.MONGODB_URI || '' });
  console.log(`[quality] connected (mode=${conn.mode})`);

  const ix = await MarketPrice.syncIndexesSafe();
  if (!ix.ok) console.warn(`[quality] index sync warning: ${ix.error}`);

  const sources = await perSourceCounts();
  const coverage = await perCropStateCoverage();
  const suspicious = await suspiciousRows();
  const duplicates = await duplicateIdentity();

  const totals = {
    totalRows: sources.reduce((a, r) => a + r.n, 0),
    bySource: Object.fromEntries(sources.map((r) => [r._id || '(none)', r.n])),
    distinctCrops: new Set(coverage.map((c) => c.crop)).size,
    distinctStates: new Set(coverage.map((c) => c.state)).size,
    coverageGroups: coverage.length,
    suspiciousRows: suspicious.length,
    duplicateGroups: duplicates.length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    totals,
    perSource: sources,
    coverage,
    suspiciousSample: suspicious,
    duplicateGroups: duplicates,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  console.log('=== quality report ===');
  console.log(`[quality] total rows:           ${totals.totalRows}`);
  console.log(`[quality] by source:            ${JSON.stringify(totals.bySource)}`);
  console.log(`[quality] distinct crops:       ${totals.distinctCrops}`);
  console.log(`[quality] distinct states:      ${totals.distinctStates}`);
  console.log(`[quality] coverage groups:      ${totals.coverageGroups}`);
  console.log(`[quality] suspicious rows:      ${totals.suspiciousRows}  (sample in report)`);
  console.log(`[quality] duplicate groups:     ${totals.duplicateGroups}  (should be 0)`);
  console.log(`[quality] report:               ${reportPath}`);

  if (duplicates.length > 0) {
    console.warn(`[quality] WARN: duplicate identity groups present`);
  }

  await disconnectMongo();
  process.exit(0);
}

main().catch((err) => {
  console.error('[quality] fatal:', err);
  process.exit(99);
});
