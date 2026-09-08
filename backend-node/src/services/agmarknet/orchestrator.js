/**
 * services/agmarknet/orchestrator.js — turns raw AGMARKNET records
 * into upserts on the MarketPrice collection.
 *
 * Design:
 *   - Identity is the 6-tuple
 *       (source, cropName, state, market, arrivalDate, variety)
 *     which the partial unique index in MarketPrice.js enforces.
 *   - A raw record is hard-flagged (NOT persisted) only if it is
 *     missing `cropName` or `arrivalDate`. A missing market name
 *     falls back to the state name; a missing/zero price is persisted
 *     as a "no-trading-day" entry and surfaces a `softFlag`.
 *   - Per-call throttling is the provider's job; the orchestrator
 *     only handles dedup and the database round-trip.
 *
 * Public surface:
 *   - normalizeAndUpsert({ stateName, commodityName, records })
 *       → { inserted, updated, skipped, flagged[],
 *           softFlagCount, hardFlagReasons }
 *   - rawToDoc(raw, ctx)
 *       → { doc } or { flagged, reason }
 */
'use strict';

const MarketPrice = require('../../models/MarketPrice');

const PER_KG_FROM_QUINTAL = 0.01; // 1 quintal = 100 kg

function isFiniteNonNeg(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Convert a raw AGMARKNET record into a MarketPrice-shaped document.
 * Returns `{ doc }` for a usable record or `{ flagged: rec, reason }`
 * for a record that should NOT be written.
 *
 * Leniency rules (added after the 2×2×3 validation showed 100% of
 * records being flagged in the real upstream response):
 *   - An empty `marketName` is substituted with the state name
 *     (so the document still gets persisted under a meaningful
 *     identity). The soft flag in that case is `missing_market_soft`.
 *   - A `modalPricePerQuintal` of 0 is persisted as-is (the model
 *     allows 0; we previously never saw 0 in real data but it's a
 *     legitimate entry for non-trading days).
 *   - A missing or non-finite `modalPricePerQuintal` is persisted as
 *     `null` (a "no-trading-day" row) and surfaced as the soft flag
 *     `missing_or_invalid_modal_price`.
 *
 * The hard requirements (must have all of these or flag) are now
 * narrowed to: `cropName` and `arrivalDate`. Everything else is
 * recoverable.
 */
function rawToDoc(raw, ctx) {
  if (!raw || typeof raw !== 'object') {
    return { flagged: raw, reason: 'not_an_object' };
  }
  const cropName = (ctx.commodityName || '').trim();
  const state = (raw.marketState || ctx.stateName || '').trim();
  let market = (raw.marketName || '').trim();
  const arrivalDate = raw.arrivalDate || '';
  const variety = (raw.variety || '').trim();
  const modal = raw.modalPricePerQuintal;

  // Hard rejections — only cropName and arrivalDate are mandatory
  // for a row to be meaningful. Market can fall back; price can be
  // absent (we'd just record the row as a "no-trading-day" entry).
  if (!cropName) return { flagged: raw, reason: 'missing_cropName' };
  if (!arrivalDate) return { flagged: raw, reason: 'missing_arrivalDate' };

  // Soft fallback: if market is empty, use the state name (e.g.
  // "Maharashtra"). The flagging reason is recorded in the doc so
  // the quality pipeline can see "this row was missing market".
  let softFlag = null;
  if (!market) {
    market = state || 'UNKNOWN';
    softFlag = 'missing_market_soft';
  }
  if (!isFiniteNonNeg(modal)) {
    // The row has no price. We still write it (so the historical
    // record of "we checked this market on this day and found no
    // price" is preserved), but flag it.
    softFlag = softFlag ? `${softFlag}+missing_or_invalid_modal_price`
                        : 'missing_or_invalid_modal_price';
  }

  // Outlier guard: a 0 modal price is plausible for ceremonial /
  // non-trading entries, but a negative price is never valid. Treat
  // negatives and NaN as flagged; persist 0 as-is.
  // A negative price is always invalid → hard reject (do not persist).
  // A missing/NaN price is recoverable → soft flag (persist as null).
  if (typeof modal === 'number' && Number.isFinite(modal) && modal < 0) {
    return { flagged: raw, reason: 'negative_modal_price' };
  }
  const minP = isFiniteNonNeg(raw.minPricePerQuintal) ? raw.minPricePerQuintal : null;
  const maxP = isFiniteNonNeg(raw.maxPricePerQuintal) ? raw.maxPricePerQuintal : null;
  const arrivals = isFiniteNonNeg(raw.arrivals) ? raw.arrivals : null;
  const safeModal = isFiniteNonNeg(modal) ? modal : null;
  // Build the doc. `source` is hardcoded 'agmarknet' for everything
  // that flows through this orchestrator today, but we leave the
  // door open for a future caller to override it.
  const docSource = 'agmarknet';
  const doc = {
    source: docSource,
    cropName,
    state,
    market,
    district: (raw.marketDistrict || '').trim(),
    pricePerQuintal: safeModal,
    pricePerKg: safeModal == null ? null : Math.round(safeModal * PER_KG_FROM_QUINTAL * 100) / 100,
    minPricePerKg: minP == null ? null : Math.round(minP * PER_KG_FROM_QUINTAL * 100) / 100,
    maxPricePerKg: maxP == null ? null : Math.round(maxP * PER_KG_FROM_QUINTAL * 100) / 100,
    unit: 'INR/quintal',
    price_unit: raw.priceUnit || 'Rs./Quintal',
    arrivalDate,
    priceDate: arrivalDate,
    variety,
    grade: (raw.grade || '').trim(),
    arrivals,
    isLive: false, // historical, not "live"
    // Preserve total_arrivals (the day-total) from the outer
    // record when present, alongside the per-variety `arrivals`.
    totalArrivals: isFiniteNonNeg(raw.totalArrivals) ? raw.totalArrivals : null,
    _softFlag: softFlag, // internal; stripped before persisting
  };

  // Change 2: for NEW historical agmarknet records, omit the upstream
  // `raw` and `rawOuter` blobs to keep Mongo document size down. The
  // schema still has both fields (default null), so existing rows
  // are unaffected and a future migration can backfill the values
  // if ML ever needs them. Other sources are unchanged.
  if (docSource !== 'agmarknet') {
    doc.raw = raw.raw || null;
    doc.rawOuter = raw.rawOuter || null;
  }

  return { doc };
}

/**
 * Idempotent upsert of a list of raw AGMARKNET records.
 * `ctx` provides the human crop + state names so the persisted
 * documents are searchable by name (the upstream endpoint only
 * filters by ID).
 *
 * Returns { inserted, updated, skipped, flagged[] }.
 */
async function normalizeAndUpsert({ stateName, commodityName, records } = {}) {
  const flagged = [];
  const ops = [];
  const softFlagCount = {};
  const hardFlagReasons = {};
  for (const raw of records || []) {
    const r = rawToDoc(raw, { stateName, commodityName });
    if (r.flagged) {
      flagged.push(r);
      hardFlagReasons[r.reason] = (hardFlagReasons[r.reason] || 0) + 1;
      continue;
    }
    const d = r.doc;
    // _softFlag is internal-only — strip before persisting.
    const { _softFlag, ...persistDoc } = d;
    ops.push({
      updateOne: {
        filter: {
          source: persistDoc.source,
          cropName: persistDoc.cropName,
          state: persistDoc.state,
          market: persistDoc.market,
          arrivalDate: persistDoc.arrivalDate,
          variety: persistDoc.variety,
        },
        update: { $set: persistDoc },
        upsert: true,
      },
    });
    // Surface a soft-flagged count without blocking the write.
    if (_softFlag) {
      softFlagCount[_softFlag] = (softFlagCount[_softFlag] || 0) + 1;
    }
  }
  if (ops.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, flagged, softFlagCount, hardFlagReasons };
  }
  let result;
  try {
    result = await MarketPrice.bulkWrite(ops, { ordered: false });
  } catch (err) {
    // A duplicate-key on the partial unique index means a row from a
    // parallel run is already there — treat as a no-op and continue.
    // Other errors bubble up.
    if (err && err.code === 11000) {
      // Mongoose surfaces the result alongside the error in
      // writeErrors; if we got the partial result, count those.
      const partial =
        (err.result && err.result.result) ||
        (err.result && err.result.nUpserted) ||
        { nUpserted: 0, nModified: 0, nMatched: 0 };
      return {
        inserted: partial.nUpserted || 0,
        updated: partial.nModified || 0,
        skipped: (partial.nMatched || 0) + (err.writeErrors || []).length,
        flagged,
        softFlagCount,
        hardFlagReasons,
      };
    }
    throw err;
  }
  return {
    inserted: result.upsertedCount || 0,
    updated: result.modifiedCount || 0,
    skipped: result.matchedCount || 0,
    flagged,
    softFlagCount,
    hardFlagReasons,
  };
}

module.exports = {
  normalizeAndUpsert,
  rawToDoc,
  // exposed for tests
  _internal: { isFiniteNonNeg, PER_KG_FROM_QUINTAL },
};
