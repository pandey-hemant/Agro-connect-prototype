/**
 * routes/marketPrices.js — market price endpoints.
 *
 *   GET  /api/market-prices                  list (filters: crop, state, market, district)
 *   GET  /api/market-prices/health           provider health
 *
 * The service in services/marketPrice decides whether to call the
 * live data.gov.in/AGMARKNET provider or fall back to the demo
 * dataset. The route's wire shape is frontend-aligned: each row has
 * snake_case keys the React MarketPrices.jsx page already reads
 * (crop_name, market, location, min_price, modal_price, max_price,
 * price_date, unit, source, is_live) and the envelope carries
 * `fetched_at`.
 *
 * No API key is ever echoed in the response.
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const MarketPrice = require('../models/MarketPrice');
const { listPrices, health: providerHealth } = require('../services/marketPrice/service');
const { listHistorical } = require('../services/marketPrice/historyAggregator');
const { predictPrice } = require('../services/marketPrice/predictionService');
const { predictPriceML } = require('../services/marketPrice/mlPrediction');
const { annotate: annotateCoords, lookup: lookupCoord } = require('../services/mandiCoords');

const router = express.Router();

/**
 * Map a single row (camelCase orchestrator row OR snake_case toRead
 * doc) into the canonical frontend-aligned shape.
 */
function toWireRow(r) {
  // Support both camelCase orchestrator rows and snake_case toRead().
  const cropName = r.cropName || r.crop_name || '';
  const market = r.market || '';
  const state = r.state || '';
  const district = r.district || '';
  // Phase 3 — missing numerics are surfaced as `null`, never undefined
  // and never the dreaded NaN. Consumers can render "—" safely.
  const numOrNull = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const perKg = numOrNull(r.pricePerKg != null ? r.pricePerKg : r.price_per_kg);
  const perQuintal = numOrNull(
    r.pricePerQuintal != null ? r.pricePerQuintal : r.price_per_quintal
  );
  const minPerKg = numOrNull(
    r.minPricePerKg != null
      ? r.minPricePerKg
      : r.min_price != null
      ? r.min_price
      : perKg
  );
  const maxPerKg = numOrNull(
    r.maxPricePerKg != null
      ? r.maxPricePerKg
      : r.max_price != null
      ? r.max_price
      : perKg
  );
  const priceDate = r.priceDate || r.arrivalDate || r.arrival_date || r.price_date || '';
  const location = [market, district].filter(Boolean).join(', ');
  return {
    crop_name: cropName,
    market,
    state,
    district,
    location,
    // Defensive: always null when unknown. React renders "—" cleanly.
    min_price: minPerKg,
    modal_price: perKg,
    max_price: maxPerKg,
    price_per_quintal: perQuintal,
    price_per_kg: perKg,
    unit: r.unit || 'INR/kg',
    price_date: priceDate,
    arrival_date: priceDate,
    source: r.source || 'demo',
    is_live: !!r.isLive || !!r.is_live,
    // Lat/lon are filled by annotateCoords() AFTER toWireRow. We
    // forward any pre-existing numeric lat/lon verbatim (so live
    // data with real coordinates is never overwritten) and leave
    // them as null otherwise — the route will fill the rest.
    lat: Number.isFinite(Number(r.lat)) ? Number(r.lat) : null,
    lon: Number.isFinite(Number(r.lon)) ? Number(r.lon) : null,
    coord_source: r._coord_source || null,
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = {
      crop: req.query.crop,
      state: req.query.state,
      market: req.query.market,
      district: req.query.district,
    };
    // Trigger the orchestrator (live → demo fallback) so the user
    // immediately sees the freshest available data.
    const { rows, is_live, source, note } = await listPrices(filters);

    // Also include any cached rows from Mongo that match the same
    // filter, so callers can see the full picture.
    const q = {};
    if (filters.crop) q.cropName = new RegExp(`^${String(filters.crop)}$`, 'i');
    if (filters.state) q.state = new RegExp(`^${String(filters.state)}$`, 'i');
    if (filters.market) q.market = new RegExp(String(filters.market), 'i');
    if (filters.district) q.district = new RegExp(`^${String(filters.district)}$`, 'i');
    const cached = await MarketPrice.find(q).sort({ createdAt: -1 });

    // Merge: prefer the orchestrator's `rows` first; add cached entries
    // not already present. Compare in the same canonical shape.
    const seen = new Set(
      rows.map((r) => `${r.cropName}|${r.market}|${r.state}|${r.arrivalDate || ''}`)
    );
    const merged = rows.map(toWireRow);
    for (const c of cached) {
      const doc = c.toRead();
      const k = `${doc.crop_name}|${doc.market}|${doc.state}|${doc.arrival_date || ''}`;
      if (!seen.has(k)) {
        merged.push(toWireRow(doc));
        seen.add(k);
      }
    }

    // All rows from the orchestrator share the same unit; the cached
    // docs may be in INR/quintal. We surface the unit on the FIRST
    // row to drive the page's "Prices reported in X" header.
    const unit =
      merged[0] && merged[0].unit ? merged[0].unit : 'INR/kg';

    // Attach mandi centroids (well-known, public-reference, NOT live
    // GPS — see services/mandiCoords.js). Mandis that don't match a
    // centroid are left with null lat/lon so the map simply doesn't
    // draw them.
    const withCoords = annotateCoords(merged);

    res.json({
      source,
      is_live,
      count: withCoords.length,
      note,
      unit,
      fetched_at: new Date().toISOString(),
      results: withCoords,
    });
  })
);

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const h = await providerHealth();
    res.json(h);
  })
);

// Phase 3 — historical aggregation (NOT a forecast).
router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const {
      crop,
      state,
      market,
      from,
      to,
      granularity = 'weekly',
    } = req.query;
    const result = await listHistorical({
      crop,
      state,
      market,
      from,
      to,
      granularity: ['daily', 'weekly', 'monthly'].includes(String(granularity))
        ? granularity
        : 'weekly',
    });
    res.json(result);
  })
);

// Phase 3 — placeholder prediction. Default returns available:false
// unless there are >= 5 distinct dates in the collection.
router.get(
  '/prediction',
  asyncHandler(async (req, res) => {
    const { crop, state, market, days, min_history_dates } = req.query;
    const daysNum = days ? Math.max(1, Math.min(30, Number(days) || 7)) : 7;
    const minHist = min_history_dates
      ? Math.max(2, Math.min(20, Number(min_history_dates) || 5))
      : 5;
    const result = await predictPrice({
      crop,
      state,
      market,
      days: daysNum,
      minHistoryDates: minHist,
    });
    res.json(result);
  })
);

// Phase 5 — ML prediction with baseline comparison. The response
// includes the chosen model + all candidate in-sample MAEs so the
// frontend can show "our pick" + the spread. Returns {available:false}
// when there isn't enough history; the front-end falls back to the
// simple /prediction endpoint.
router.get(
  '/prediction-ml',
  asyncHandler(async (req, res) => {
    const { crop, state, market, days, min_history_dates, holdout_days } = req.query;
    const daysNum = days ? Math.max(1, Math.min(30, Number(days) || 7)) : 7;
    const minHist = min_history_dates
      ? Math.max(2, Math.min(60, Number(min_history_dates) || 10))
      : 10;
    const holdout = holdout_days
      ? Math.max(2, Math.min(60, Number(holdout_days) || 14))
      : 14;
    const result = await predictPriceML({
      crop,
      state,
      market,
      days: daysNum,
      minHistoryDates: minHist,
      holdoutDays: holdout,
    });
    res.json(result);
  })
);

// Phase 5 — daily series for a chart. Returns one point per
// (date, market) for the given (crop, state, market?) window. The
// marketPrices page renders this as a line chart in the History tab.
router.get(
  '/history/series',
  asyncHandler(async (req, res) => {
    const { crop, state, market, from, to, limit } = req.query;
    if (!crop) {
      res.status(400).json({ error: 'crop is required' });
      return;
    }
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
      cropName: new RegExp(`^${esc(crop)}$`, 'i'),
    };
    if (state) filter.state = new RegExp(`^${esc(state)}$`, 'i');
    if (market) filter.market = new RegExp(esc(market), 'i');
    if (from || to) {
      filter.priceDate = {};
      if (from) filter.priceDate.$gte = String(from);
      if (to) filter.priceDate.$lte = String(to);
    }
    const cap = Math.max(50, Math.min(5000, Number(limit) || 1500));
    const docs = await MarketPrice.find(filter)
      .sort({ priceDate: 1 })
      .limit(cap)
      .lean();
    const points = docs
      .filter((d) => d.priceDate && d.pricePerKg != null)
      .map((d) => ({
        date: d.priceDate,
        crop: d.cropName,
        market: d.market,
        state: d.state,
        price_per_kg: d.pricePerKg,
        price_per_quintal: d.pricePerQuintal,
        source: d.source,
      }));
    res.json({
      crop,
      state: state || null,
      market: market || null,
      from: from || null,
      to: to || null,
      count: points.length,
      points,
    });
  })
);

module.exports = { router };
