#!/usr/bin/env node
/**
 * scripts/verify_pre_ids.cjs
 *
 * Read-only no-modification check: re-hashes 10 specific MarketPrice
 * documents (whose _ids were captured in pre_2y_10s_4c.json BEFORE the
 * 2y x 10s x 4c backfill) and compares the SHA-256 against the hashes
 * captured in the pre-backfill fingerprint.
 *
 * If every pre-hash equals the current post-hash, we have direct
 * evidence that the 10 sampled pre-existing records were not modified
 * by the backfill. (This is a stronger check than the post-backfill
 * fingerprint's "oldest ObjectId overlap" because it pins 10 specific
 * _ids instead of 1.)
 *
 * Usage:
 *   node scripts/verify_pre_ids.cjs \
 *     --pre  pre_2y_10s_4c.json \
 *     --post post_2y_10s_4c.json \
 *     --out  verify_pre_ids_report.json
 *
 * Exit codes:
 *   0  all 10 pre-hashes match current post-hashes (no modification)
 *   1  at least one pre-hash differs from current post-hash (modified!)
 *   2  at least one pre-_id is missing from the current collection
 *   3  invocation error
 *
 * This script NEVER writes to MongoDB. It is a pure read.
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

// Identical payload shape to scripts/pre_post_fingerprint.cjs so the
// hash is bit-comparable. If you change one, change both.
function hashDoc(doc) {
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
    raw: doc.raw,
    rawOuter: doc.rawOuter,
  };
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prePath = args.pre || 'pre_2y_10s_4c.json';
  const postPath = args.post || 'post_2y_10s_4c.json';
  const outPath = args.out || 'verify_pre_ids_report.json';

  if (!fs.existsSync(prePath)) {
    console.error(`[verify] pre fingerprint not found: ${prePath}`);
    process.exit(3);
  }

  const pre = JSON.parse(fs.readFileSync(prePath, 'utf8'));
  if (!pre.hashes || !Array.isArray(pre.hashes) || pre.hashes.length === 0) {
    console.error(`[verify] pre fingerprint has no .hashes[] array`);
    process.exit(3);
  }

  // Optional: also load the post fingerprint for cross-comparison
  // (the post-hash of the 1 overlapping _id, if any).
  let post = null;
  if (fs.existsSync(postPath)) {
    post = JSON.parse(fs.readFileSync(postPath, 'utf8'));
  }

  console.log(`[verify] loaded pre fingerprint: ${prePath}  pre.total=${pre.total}  pre.sampled=${pre.sampled}`);
  if (post) {
    console.log(`[verify] loaded post fingerprint: ${postPath}  post.total=${post.total}  post.sampled=${post.sampled}`);
  } else {
    console.log(`[verify] post fingerprint not found (that's ok; we will compare against current MongoDB state)`);
  }

  const conn = await connectMongo({ uri: process.env.MONGODB_URI || '' });
  console.log(`[verify] Mongo mode=${conn.mode}`);

  const currentTotal = await MarketPrice.countDocuments({});
  console.log(`[verify] current MarketPrice.countDocuments = ${currentTotal}`);

  const preIds = pre.hashes.map((h) => h._id);
  console.log(`[verify] will re-hash ${preIds.length} pre-existing _ids: ${preIds.join(', ')}`);

  const rows = [];
  let ok = 0;
  let modified = 0;
  let missing = 0;
  for (const id of preIds) {
    const preEntry = pre.hashes.find((h) => h._id === id);
    const preHash = preEntry ? preEntry.hash : null;
    const postEntry = post && post.hashes ? post.hashes.find((h) => h._id === id) : null;
    const postFingerprintHash = postEntry ? postEntry.hash : null;

    // Fetch the current document by _id. Read-only: findOne is a pure read.
    const doc = await MarketPrice.findById(id).lean();

    let currentHash = null;
    let currentFields = null;
    let found = false;
    if (doc) {
      found = true;
      currentHash = hashDoc(doc);
      // Surface the same fields the fingerprint covers, so a human can
      // eyeball whether any field differs from pre.
      currentFields = {
        cropName: doc.cropName,
        state: doc.state,
        market: doc.market,
        priceDate: doc.priceDate,
        variety: doc.variety,
        pricePerQuintal: doc.pricePerQuintal,
        arrivals: doc.arrivals,
        source: doc.source,
        updatedAt: doc.updatedAt,
      };
    }

    const matchesPre =
      preHash !== null && currentHash !== null && preHash === currentHash;
    const matchesPostFingerprint =
      postFingerprintHash === null || (currentHash !== null && postFingerprintHash === currentHash);

    let verdict;
    if (!found) {
      verdict = 'MISSING';
      missing += 1;
    } else if (matchesPre) {
      verdict = 'UNCHANGED';
      ok += 1;
    } else {
      verdict = 'MODIFIED';
      modified += 1;
    }

    rows.push({
      _id: id,
      cropName_pre: preEntry ? preEntry.cropName : null,
      state_pre: preEntry ? preEntry.state : null,
      market_pre: preEntry ? preEntry.market : null,
      priceDate_pre: preEntry ? preEntry.priceDate : null,
      variety_pre: preEntry ? preEntry.variety : null,
      preHash,
      postFingerprintHash,
      currentHash,
      found,
      matchesPre,
      matchesPostFingerprint,
      verdict,
      currentFields,
    });
  }

  const summary = {
    capturedAt: new Date().toISOString(),
    preFingerprint: prePath,
    postFingerprint: post ? postPath : null,
    preTotal: pre.total,
    preSampled: pre.sampled,
    preAggregateHash: pre.aggregateHash,
    postTotal: post ? post.total : null,
    postSampled: post ? post.sampled : null,
    postAggregateHash: post ? post.aggregateHash : null,
    currentTotal,
    idsChecked: rows.length,
    unchanged: ok,
    modified,
    missing,
    verdict: missing > 0 ? 'MISSING' : modified > 0 ? 'MODIFIED' : 'NO_MODIFICATION',
  };

  const report = { summary, rows };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('');
  console.log('========= PRE-_ID RE-HASH RESULT =========');
  console.log(`pre fingerprint:        ${prePath}  total=${pre.total}  sampled=${pre.sampled}`);
  if (post) {
    console.log(`post fingerprint:       ${postPath}  total=${post.total}  sampled=${post.sampled}`);
  }
  console.log(`current MongoDB total:  ${currentTotal}`);
  console.log(`ids checked:            ${rows.length}`);
  console.log(`  UNCHANGED:            ${ok}`);
  console.log(`  MODIFIED:             ${modified}`);
  console.log(`  MISSING:              ${missing}`);
  console.log('');
  console.log('per-_id:');
  for (const r of rows) {
    const flag = r.verdict === 'UNCHANGED' ? '✓' : r.verdict === 'MODIFIED' ? '✗ MOD' : '✗ MISS';
    console.log(
      `  ${flag}  ${r._id}  ${r.cropName_pre} / ${r.state_pre} / ${r.market_pre} / ${r.priceDate_pre}  pre=${(r.preHash || '').slice(0, 12)}…  cur=${(r.currentHash || '').slice(0, 12)}…`
    );
  }
  console.log('');
  console.log(`[verify] wrote ${outPath}`);
  console.log(`[verify] verdict: ${summary.verdict}`);

  await disconnectMongo();

  if (missing > 0) process.exit(2);
  if (modified > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('[verify] fatal:', err);
  process.exit(3);
});
