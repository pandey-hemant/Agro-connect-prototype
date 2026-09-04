/**
 * services/marketPrice/csvProvider.js — CSV import provider.
 *
 * Reads a CSV file from disk (path from config.marketPriceCsvPath)
 * and returns its rows in the orchestrator's standard envelope:
 *
 *   { rows: [{cropName, market, state, district, pricePerQuintal,
 *              pricePerKg, minPricePerKg, maxPricePerKg, priceDate,
 *              arrivalDate, source: 'csv', isLive: false, raw}],
 *     is_live: false,
 *     note: '...' }
 *
 * Contract guarantees:
 *   • NEVER throws. Any read/parse error returns { rows: [], note: '...' }.
 *   • Filters by crop/state/market/district (case-insensitive).
 *   • Drops rows missing cropName OR pricePerKg.
 *   • Does NOT re-read the file on every fetch — the orchestrator is
 *     expected to call this once per request; the I/O cost is small
 *     (a few hundred rows) and keeps the implementation honest.
 *   • source is always 'csv' (never 'live').
 *
 * CSV format (header row required, comma-separated):
 *   cropName,market,state,district,pricePerQuintal,pricePerKg,
 *   minPricePerKg,maxPricePerKg,priceDate,source
 *
 *   Example:
 *     Tomato,Bengaluru APMC,Karnataka,Bengaluru,1500,15,14,16,2026-08-27,csv
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { MarketDataProvider } = require('./provider');

class CsvMarketDataProvider extends MarketDataProvider {
  constructor({ csvPath = '' } = {}) {
    super();
    this.csvPath = csvPath || '';
  }

  // Minimal RFC-4180-ish CSV parser. Handles double-quoted fields and
  // escaped quotes. Does NOT handle embedded newlines inside quotes —
  // a real CSV importer would, but our seed file doesn't need that.
  _parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return [];
    const header = this._parseLine(lines[0]).map((h) => h.trim());
    const out = [];
    for (let i = 1; i < lines.length; i += 1) {
      const cells = this._parseLine(lines[i]);
      if (cells.length === 0) continue;
      const row = {};
      for (let j = 0; j < header.length; j += 1) {
        row[header[j]] = cells[j] != null ? cells[j] : '';
      }
      out.push(row);
    }
    return out;
  }

  _parseLine(line) {
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

  _toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  }

  async fetch({ crop, state, market, district } = {}) {
    if (!this.csvPath) {
      return { rows: [], is_live: false, note: 'CSV provider not configured (MARKET_PRICE_CSV_PATH is empty).' };
    }
    let text;
    try {
      text = fs.readFileSync(this.csvPath, 'utf8');
    } catch (err) {
      return {
        rows: [],
        is_live: false,
        note: `CSV unreadable: ${err.message} (path: ${this.csvPath})`,
      };
    }
    let raw;
    try {
      raw = this._parseCsv(text);
    } catch (err) {
      return {
        rows: [],
        is_live: false,
        note: `CSV parse failed: ${err.message}`,
      };
    }

    let coerced = raw.map((r) => {
      const cropName = (r.cropName || r.crop || '').trim();
      const marketName = (r.market || '').trim();
      const stateName = (r.state || '').trim();
      const districtName = (r.district || '').trim();
      const pricePerKg = this._toNum(r.pricePerKg);
      const pricePerQuintal = this._toNum(r.pricePerQuintal);
      const minPerKg = this._toNum(r.minPricePerKg);
      const maxPerKg = this._toNum(r.maxPricePerKg);
      const priceDate = (r.priceDate || '').trim();
      const variety = (r.variety || '').trim();
      const grade = (r.grade || '').trim();
      const arrivals = this._toNum(r.arrivals);
      return {
        cropName,
        market: marketName,
        state: stateName,
        district: districtName,
        pricePerQuintal: pricePerQuintal != null ? pricePerQuintal : null,
        pricePerKg,
        minPricePerKg: minPerKg != null ? minPerKg : pricePerKg,
        maxPricePerKg: maxPerKg != null ? maxPerKg : pricePerKg,
        priceDate,
        arrivalDate: priceDate,
        // Phase 5 — provenance fields.
        price_unit: (r.price_unit || r.unit || 'INR/quintal').trim(),
        variety,
        grade,
        arrivals,
        source: 'csv',
        isLive: false,
        raw: null,
      };
    });

    // Drop rows missing the required anchors (cropName + pricePerKg).
    coerced = coerced.filter(
      (r) => r.cropName && r.pricePerKg != null
    );

    // Apply filters.
    if (crop) {
      const want = String(crop).toLowerCase();
      coerced = coerced.filter((r) => r.cropName.toLowerCase() === want);
    }
    if (state) {
      const want = String(state).toLowerCase();
      coerced = coerced.filter((r) => r.state.toLowerCase() === want);
    }
    if (market) {
      const want = String(market).toLowerCase();
      coerced = coerced.filter((r) => r.market.toLowerCase().includes(want));
    }
    if (district) {
      const want = String(district).toLowerCase();
      coerced = coerced.filter((r) => r.district.toLowerCase() === want);
    }

    return {
      rows: coerced,
      is_live: false,
      note:
        coerced.length > 0
          ? `CSV import: ${coerced.length} rows from ${path.basename(this.csvPath)}`
          : `CSV file found at ${path.basename(this.csvPath)} but no rows match the filter.`,
    };
  }
}

module.exports = { CsvMarketDataProvider };
