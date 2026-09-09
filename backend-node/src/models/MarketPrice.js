/**
 * models/MarketPrice.js — a snapshot of market price for a crop at a
 * mandi (market).
 *
 * Phase 5 — provenance-aware historical record.
 *
 * Fields preserved end-to-end so we can always re-derive the
 * displayed unit without losing the original:
 *   - pricePerQuintal / pricePerKg / minPricePerKg / maxPricePerKg
 *     are derived numerics, kept in sync on every write.
 *   - price_unit        : original unit string from the source
 *                         ('INR/quintal', 'INR/kg', …)
 *   - arrivals          : arrivals in Metric Tonnes (AGMARKNET only)
 *   - grade             : grade (AGMARKNET only; rarely emitted by
 *                         the date-wise endpoint)
 *   - source            : one of:
 *                         'data_gov_in'  — data.gov.in OGD live
 *                         'csv'          — local CSV import
 *                         'agmarknet'    — AGMARKNET 2.0 historical
 *                         'demo'         — seed/demo
 *                         'fallback'
 *   - raw               : the raw upstream payload (if any)
 *
 * Identity / dedup:
 *   A real record is uniquely identified by the 6-tuple
 *     (source, cropName, state, market, arrivalDate, variety)
 *   AGMARKNET's date-wise endpoint does NOT return a district
 *   field, so district is intentionally excluded. A partial unique
 *   index enforces dedup at the database level so backfill can be
 *   safely re-run.
 */
'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const MarketPriceSchema = new Schema(
  {
    cropName: { type: String, required: true, index: true },
    market: { type: String, default: '' },
    state: { type: String, default: '', index: true },
    district: { type: String, default: '' },
    pricePerQuintal: { type: Number, required: true, min: 0 },
    pricePerKg: { type: Number, required: true, min: 0 },
    // Optional min/max. AGMARKNET's date-wise endpoint emits
    // explicit min/max so we can store them separately.
    minPricePerKg: { type: Number, default: null },
    maxPricePerKg: { type: Number, default: null },
    // Original unit string (e.g. "Rs./Quintal" or "INR/kg"). Preserved
    // for provenance; the derived per-kg / per-quintal fields above
    // are always kept in sync.
    price_unit: { type: String, default: 'INR/quintal' },
    // ISO date string (YYYY-MM-DD) of the price report. Same value
    // as arrivalDate but separated for clarity.
    priceDate: { type: String, default: '' },
    unit: { type: String, default: 'INR/quintal' },
    arrivalDate: { type: String, default: '' },
    // AGMARKNET-specific provenance. Always present when
    // source === 'agmarknet'; optional otherwise.
    variety: { type: String, default: '' },
    grade: { type: String, default: '' },
    arrivals: { type: Number, default: null, min: 0 },
    source: {
      type: String,
      enum: ['data_gov_in', 'csv', 'agmarknet', 'demo', 'fallback'],
      default: 'demo',
      index: true,
    },
    isLive: { type: Boolean, default: false },
    raw: { type: Schema.Types.Mixed, default: null },
    // Day-total arrivals (sum across varieties). Optional, only set
    // by AGMARKNET when the upstream record wraps per-variety entries
    // inside an inner `data[]` array.
    totalArrivals: { type: Number, default: null, min: 0 },
    // The outer upstream record (date + total_arrivals), preserved
    // for provenance when the inner `raw` is one data[] entry.
    rawOuter: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// ----- Indexes -----
// Partial unique identity. `variety` is part of the key because the
// same market can quote the same crop on the same day at different
// qualities (e.g. "Onion" vs "Onion - Red"). The partial filter
// excludes rows with no arrivalDate — those are legacy/demo seeds
// that pre-date the dedup rule.
MarketPriceSchema.index(
  {
    source: 1,
    cropName: 1,
    state: 1,
    market: 1,
    arrivalDate: 1,
    variety: 1,
  },
  {
    unique: true,
    partialFilterExpression: { arrivalDate: { $type: 'string', $gt: '' } },
    name: 'uniq_identity',
  }
);

// Common historical queries.
MarketPriceSchema.index({ cropName: 1, priceDate: 1 });
MarketPriceSchema.index({ cropName: 1, state: 1, market: 1, priceDate: 1 });
MarketPriceSchema.index({ cropName: 1, state: 1, priceDate: 1 });
MarketPriceSchema.index({ source: 1, cropName: 1, priceDate: 1 });

MarketPriceSchema.methods.toRead = function () {
  // The MarketPrices.jsx page reads row.crop / row.market / row.location
  // / row.min_price / row.modal_price / row.max_price / row.price_date
  // and list.results[0].unit. We expose BOTH the legacy camelCase keys
  // (for verify_e2e.cjs) and the frontend-aligned snake_case keys.
  const min = this.minPricePerKg != null ? this.minPricePerKg : this.pricePerKg;
  const max = this.maxPricePerKg != null ? this.maxPricePerKg : this.pricePerKg;
  const location = [this.market, this.district].filter(Boolean).join(', ');
  return {
    id: this._id,
    // Legacy keys
    cropName: this.cropName,
    pricePerQuintal: this.pricePerQuintal,
    pricePerKg: this.pricePerKg,
    arrivalDate: this.arrivalDate,
    isLive: this.isLive,
    // Frontend-aligned snake_case keys
    crop_name: this.cropName,
    market: this.market,
    state: this.state,
    district: this.district,
    location,
    min_price: min,
    modal_price: this.pricePerKg,
    max_price: max,
    price_per_quintal: this.pricePerQuintal,
    price_per_kg: this.pricePerKg,
    unit: this.unit,
    price_unit: this.price_unit,
    price_date: this.priceDate || this.arrivalDate,
    arrival_date: this.arrivalDate,
    variety: this.variety || '',
    grade: this.grade || '',
    arrivals: this.arrivals == null ? null : this.arrivals,
    source: this.source,
    is_live: this.isLive,
  };
};

MarketPriceSchema.statics.syncIndexesSafe = async function syncIndexesSafe() {
  // Phase 5 — best-effort index sync. Drops any conflicting legacy
  // indexes and rebuilds from the schema. If duplicate docs would
  // block a unique index, log a warning and continue (the dev DB
  // typically starts empty; this is here for safety when the script
  // is run against an existing collection).
  try {
    await this.syncIndexes();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

module.exports = mongoose.model('MarketPrice', MarketPriceSchema);
