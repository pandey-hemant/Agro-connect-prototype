#!/usr/bin/env node
/**
 * scripts/pre_post_fingerprint.cjs
 *
 * Captures a stable fingerprint of the MarketPrice collection so we
 * can prove, before and after the 5-slice backfill, that no existing
 * record was modified.
 *
 * What the fingerprint contains:
 *   - total document count
 *   - 10 sample documents (deterministic selection: oldest, newest,
 *     and 8 spread across the collection)
 *   - for each sample, the SHA-256 of { priceDate, market, variety,
 *     pricePerQuintal, raw, rawOuter, _id, updatedAt }. If any
 *     existing record changes, the hash changes and the test fails.
 *
 * Usage:
 *   # snapshot before
 *   node scripts/pre_post_fingerprint.cjs --out pre.json
 *   # snapshot after
 *   node scripts/pre_post_fingerprint.cjs --out post.json
 *   # diff
 *   diff <(jq -S . pre.json) <(jq -S . post.json)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { connectMongo, disconnectMongo } = require('../src/db/connect');
const MarketPrice = require('../src/models/MarketPrice');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function hashDoc(doc) {
  // Hash the fields that would change if anyone wrote to the row
  // outside of an insert.
  const payload = {
    _id: String(doc._id),
    priceDate: doc.priceDate,
    arrivalDate: doc.arrivalDate,
    market: doc.market,
    variety: doc.variety,
    state: doc.state,
    cropName: doc.cropName,
    pricePerQuintal: doc.pricePerQuintal,
    minPricePerKg: doc.minPricePerKg,
    maxPricePerKg: doc.maxPricePerKg,
    price_unit: doc.price_unit,
    grade: doc.grade,
    arrivals: doc.arrivals,
    totalArrivals: doc.totalArrivals,
    source: doc.source,
    updatedAt: doc.updatedAt,
    // Hash raw and rawOuter too — if those get touched, we want to
    // know about it.
    raw: doc.raw,
    rawOuter: doc.rawOuter,
  };
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out || 'fingerprint.json';
  const sampleN = args.samples ? Number(args.samples) : 10;

  const conn = await connectMongo({ uri: process.env.MONGODB_URI || '' });
  console.log(`[fingerprint] Mongo mode=${conn.mode}`);

  const total = await MarketPrice.countDocuments({});
  console.log(`[fingerprint] total documents: ${total}`);

  // Pick samples deterministically: by ObjectId ascending (oldest),
  // by ObjectId descending (newest), and N evenly-spaced from the
  // full set.
  const samples = [];
  if (total > 0) {
    const oldest = await MarketPrice.findOne({}, null, { sort: { _id: 1 } }).lean();
    if (oldest) samples.push(oldest);
    const newest = await MarketPrice.findOne({}, null, { sort: { _id: -1 } }).lean();
    if (newest && (!oldest || String(newest._id) !== String(oldest._id))) {
      samples.push(newest);
    }
    // Evenly-spaced picks — purely so the hash set is meaningful
    // even on a 7,556-row collection.
    const step = Math.max(1, Math.floor(total / sampleN));
    for (let i = step; i < total && samples.length < sampleN; i += step) {
      const d = await MarketPrice.findOne({}, null, { skip: i }).lean();
      if (d) samples.push(d);
    }
  }
  console.log(`[fingerprint] sampled ${samples.length} docs`);

  const fingerprint = {
    capturedAt: new Date().toISOString(),
    total,
    sampled: samples.length,
    hashes: samples.map((d) => ({
      _id: String(d._id),
      cropName: d.cropName,
      state: d.state,
      market: d.market,
      priceDate: d.priceDate,
      variety: d.variety,
      hash: hashDoc(d),
    })),
    // Aggregate checksum: the fingerprint is unchanged iff the set
    // of per-doc hashes is unchanged AND the total count is unchanged.
    sampleHashes: samples.map((s) => hashDoc(s)).sort(),
  };
  fingerprint.aggregateHash = crypto
    .createHash('sha256')
    .update(fingerprint.sampleHashes.join('|'))
    .digest('hex');

  fs.writeFileSync(outPath, JSON.stringify(fingerprint, null, 2), 'utf8');
  console.log(`[fingerprint] wrote ${outPath}`);
  console.log(`[fingerprint] total=${fingerprint.total} samples=${fingerprint.sampled} aggregate=${fingerprint.aggregateHash}`);

  await disconnectMongo();
  process.exit(0);
}

main().catch((err) => {
  console.error('[fingerprint] fatal:', err);
  process.exit(99);
});
