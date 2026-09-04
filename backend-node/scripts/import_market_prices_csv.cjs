#!/usr/bin/env node
/**
 * scripts/import_market_prices_csv.cjs — one-shot CSV import.
 *
 * Reads MARKET_PRICE_CSV_PATH (default: backend-node/data/market_prices.csv),
 * upserts every row into the MarketPrice collection with
 * `source: 'csv'`, and prints a summary.
 *
 * Usage:
 *   node scripts/import_market_prices_csv.cjs
 *   MARKET_PRICE_CSV_PATH=/path/to/other.csv node scripts/import_market_prices_csv.cjs
 *
 * Exit code:
 *   0 — file missing is non-fatal; nothing to do.
 *   1 — file present but had parse errors that yielded 0 rows.
 *
 * This script is idempotent. Re-running it updates existing rows by
 * (cropName, market, priceDate, source: 'csv'). It does NOT delete
 * demo or live rows.
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { connectMongo, disconnectMongo } = require('../src/db/connect');
const MarketPrice = require('../src/models/MarketPrice');

const csvPath =
  process.env.MARKET_PRICE_CSV_PATH ||
  path.join(__dirname, '..', 'data', 'market_prices.csv');

function parseLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = parseLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseLine(lines[i]);
    if (cells.length === 0) continue;
    const row = {};
    for (let j = 0; j < header.length; j += 1) {
      row[header[j]] = cells[j] != null ? cells[j] : '';
    }
    rows.push(row);
  }
  return rows;
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

async function main() {
  console.log(`[import] csvPath=${csvPath}`);
  if (!fs.existsSync(csvPath)) {
    console.log(`[import] No CSV file at ${csvPath} — nothing to import.`);
    await disconnectMongo().catch(() => {});
    process.exit(0);
  }

  let text;
  try {
    text = fs.readFileSync(csvPath, 'utf8');
  } catch (err) {
    console.error(`[import] Failed to read CSV: ${err.message}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = parseCsv(text);
  } catch (err) {
    console.error(`[import] CSV parse failed: ${err.message}`);
    process.exit(1);
  }

  const coerced = raw
    .map((r) => {
      const cropName = (r.cropName || r.crop || '').trim();
      const market = (r.market || '').trim();
      const state = (r.state || '').trim();
      const district = (r.district || '').trim();
      const pricePerKg = toNum(r.pricePerKg);
      const pricePerQuintal = toNum(r.pricePerQuintal);
      const minPerKg = toNum(r.minPricePerKg);
      const maxPerKg = toNum(r.maxPricePerKg);
      const priceDate = (r.priceDate || '').trim();
      return {
        cropName,
        market,
        state,
        district,
        pricePerQuintal,
        pricePerKg,
        minPricePerKg: minPerKg != null ? minPerKg : pricePerKg,
        maxPricePerKg: maxPerKg != null ? maxPerKg : pricePerKg,
        priceDate,
        arrivalDate: priceDate,
        source: 'csv',
        isLive: false,
      };
    })
    .filter((r) => r.cropName && r.pricePerKg != null);

  if (coerced.length === 0) {
    console.error(`[import] 0 valid rows in ${csvPath} (after coercion).`);
    process.exit(1);
  }

  try {
    await connectMongo({ uri: process.env.MONGODB_URI || '' });
  } catch (err) {
    console.error(`[import] Mongo connect failed: ${err.message}`);
    process.exit(1);
  }

  let inserted = 0;
  let updated = 0;
  for (const r of coerced) {
    const res = await MarketPrice.updateOne(
      {
        cropName: r.cropName,
        market: r.market,
        priceDate: r.priceDate,
        source: 'csv',
      },
      {
        $set: {
          cropName: r.cropName,
          market: r.market,
          state: r.state,
          district: r.district,
          pricePerQuintal: r.pricePerQuintal,
          pricePerKg: r.pricePerKg,
          minPricePerKg: r.minPricePerKg,
          maxPricePerKg: r.maxPricePerKg,
          unit: 'INR/quintal',
          arrivalDate: r.arrivalDate,
          priceDate: r.priceDate,
          source: 'csv',
          isLive: false,
        },
      },
      { upsert: true }
    );
    if (res.upsertedCount && res.upsertedCount > 0) inserted += 1;
    else if (res.modifiedCount && res.modifiedCount > 0) updated += 1;
    else if (res.matchedCount > 0) updated += 1;
  }
  console.log(`[import] Imported ${coerced.length} rows (${inserted} inserted, ${updated} updated) from ${path.basename(csvPath)}`);
  await disconnectMongo().catch(() => {});
  process.exit(0);
}

main().catch(async (err) => {
  console.error(`[import] crashed: ${err.message}`);
  await disconnectMongo().catch(() => {});
  process.exit(1);
});
