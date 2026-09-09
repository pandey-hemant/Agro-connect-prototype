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

const {
  listPrices,
  health: providerHealth,
} = require('../services/marketPrice/service');

const {
  listHistorical,
} = require('../services/marketPrice/historyAggregator');

const {
  predictPrice,
} = require('../services/marketPrice/predictionService');

const {
  predictPriceML,
} = require('../services/marketPrice/mlPrediction');

const {
  annotate: annotateCoords,
  lookup: lookupCoord,
} = require('../services/mandiCoords');

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

  const perKg = numOrNull(
    r.pricePerKg != null
      ? r.pricePerKg
      : r.price_per_kg
  );

  const perQuintal = numOrNull(
    r.pricePerQuintal != null
      ? r.pricePerQuintal
      : r.price_per_quintal
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

  const priceDate =
    r.priceDate ||
    r.arrivalDate ||
    r.arrival_date ||
    r.price_date ||
    '';

  const location = [market, district]
    .filter(Boolean)
    .join(', ');

  return {
    crop_name: cropName,
    market,
    state,
    district,
    location,

    // Defensive: always null when unknown.
    min_price: minPerKg,
    modal_price: perKg,
    max_price: maxPerKg,

    price_per_quintal: perQuintal,
    price_per_kg: perKg,

    unit: r.unit || 'INR/kg',

    price_date: priceDate,
    arrival_date: priceDate,

    source: r.source || 'demo',

    is_live:
      !!r.isLive ||
      !!r.is_live,

    // Lat/lon are filled by annotateCoords() after toWireRow().
    lat: Number.isFinite(Number(r.lat))
      ? Number(r.lat)
      : null,

    lon: Number.isFinite(Number(r.lon))
      ? Number(r.lon)
      : null,

    coord_source:
      r._coord_source || null,
  };
}

/**
 * GET /api/market-prices
 *
 * Returns current market prices.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = {
      crop: req.query.crop,
      state: req.query.state,
      market: req.query.market,
      district: req.query.district,
    };

    // Trigger the orchestrator (live → CSV → demo) so the caller
    // receives the freshest available data.
    const {
      rows,
      is_live,
      source,
      note,
    } = await listPrices(filters);

    /*
     * Also include cached MongoDB rows.
     *
     * PERFORMANCE FIX:
     *
     * Previously this query used case-insensitive regex filters and
     * sorted the entire matching result set by createdAt.
     *
     * With ~1.6M+ MarketPrice documents, that created a significant
     * amount of unnecessary MongoDB work.
     *
     * Crop and state are controlled/canonical values from the
     * application, so exact equality is sufficient here.
     *
     * We intentionally do NOT sort by createdAt. The frontend does
     * not require cached rows to be ordered by creation time, and
     * removing this sort allows MongoDB to use the existing
     * crop/state indexes efficiently.
     */
    const q = {};

    if (filters.crop) {
      q.cropName = String(filters.crop);
    }

    if (filters.state) {
      q.state = String(filters.state);
    }

    /*
     * Market and district remain regex-based because these fields
     * can be searched using partial/case-insensitive values.
     */
    if (filters.market) {
      q.market = new RegExp(
        String(filters.market),
        'i'
      );
    }

    if (filters.district) {
      q.district = new RegExp(
        `^${escapeRegex(String(filters.district))}$`,
        'i'
      );
    }

    /*
     * No createdAt sort here.
     *
     * lean() avoids creating full Mongoose document instances for
     * thousands of cached market-price rows.
     */
    const cached = await MarketPrice
      .find(q)
      .lean();

    /*
     * Merge: prefer the orchestrator's rows first; add cached entries
     * not already present.
     */
    const seen = new Set(
      rows.map(
        (r) =>
          `${r.cropName}|${r.market}|${r.state}|${
            r.arrivalDate || ''
          }`
      )
    );

    const merged = rows.map(toWireRow);

    for (const c of cached) {
      /*
       * The previous implementation used c.toRead().
       *
       * Because this query now uses lean(), convert the Mongo document
       * directly while preserving the same wire shape.
       */
      const doc = {
        crop_name: c.cropName || '',
        market: c.market || '',
        state: c.state || '',
        district: c.district || '',

        price_per_kg: c.pricePerKg,
        price_per_quintal: c.pricePerQuintal,

        min_price: c.minPricePerKg,
        max_price: c.maxPricePerKg,

        price_date:
          c.priceDate ||
          c.arrivalDate ||
          '',

        arrival_date:
          c.arrivalDate ||
          c.priceDate ||
          '',

        unit:
          c.unit ||
          'INR/kg',

        source:
          c.source ||
          'demo',

        is_live:
          !!c.isLive,

        lat: c.lat,
        lon: c.lon,

        _coord_source:
          c._coord_source,
      };

      const k =
        `${doc.crop_name}|${doc.market}|${doc.state}|${
          doc.arrival_date || ''
        }`;

      if (!seen.has(k)) {
        merged.push(toWireRow(doc));
        seen.add(k);
      }
    }

    // All rows from the orchestrator share the same unit.
    const unit =
      merged[0] && merged[0].unit
        ? merged[0].unit
        : 'INR/kg';

    /*
     * Attach mandi centroids.
     *
     * These are well-known public-reference coordinates, not live GPS.
     */
    const withCoords =
      annotateCoords(merged);

    res.json({
      source,
      is_live,
      count: withCoords.length,
      note,
      unit,
      fetched_at:
        new Date().toISOString(),
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

    const result =
      await listHistorical({
        crop,
        state,
        market,
        from,
        to,
        granularity:
          ['daily', 'weekly', 'monthly'].includes(
            String(granularity)
          )
            ? granularity
            : 'weekly',
      });

    res.json(result);
  })
);

// Phase 3 — placeholder prediction.
router.get(
  '/prediction',
  asyncHandler(async (req, res) => {
    const {
      crop,
      state,
      market,
      days,
      min_history_dates,
    } = req.query;

    const daysNum = days
      ? Math.max(
          1,
          Math.min(
            30,
            Number(days) || 7
          )
        )
      : 7;

    const minHist = min_history_dates
      ? Math.max(
          2,
          Math.min(
            20,
            Number(min_history_dates) || 5
          )
        )
      : 5;

    const result =
      await predictPrice({
        crop,
        state,
        market,
        days: daysNum,
        minHistoryDates: minHist,
      });

    res.json(result);
  })
);

// Phase 5 — ML prediction with baseline comparison.
router.get(
  '/prediction-ml',
  asyncHandler(async (req, res) => {
    const {
      crop,
      state,
      market,
      days,
      min_history_dates,
      holdout_days,
    } = req.query;

    const daysNum = days
      ? Math.max(
          1,
          Math.min(
            30,
            Number(days) || 7
          )
        )
      : 7;

    const minHist = min_history_dates
      ? Math.max(
          2,
          Math.min(
            60,
            Number(min_history_dates) || 10
          )
        )
      : 10;

    const holdout = holdout_days
      ? Math.max(
          2,
          Math.min(
            60,
            Number(holdout_days) || 14
          )
        )
      : 14;

    const result =
      await predictPriceML({
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

// Phase 5 — daily series for a chart.
router.get(
  '/history/series',
  asyncHandler(async (req, res) => {
    const {
      crop,
      state,
      market,
      from,
      to,
      limit,
    } = req.query;

    if (!crop) {
      res.status(400).json({
        error: 'crop is required',
      });
      return;
    }

    /*
     * PERFORMANCE FIX:
     *
     * Use exact equality for crop/state/market instead of
     * case-insensitive regex.
     *
     * This allows MongoDB to use:
     *
     *   { cropName: 1, state: 1, priceDate: 1 }
     *
     * for filtering and sorting.
     */
    const filter = {
      cropName: String(crop),
    };

    if (state) {
      filter.state = String(state);
    }

    if (market) {
      filter.market = String(market);
    }

    if (from || to) {
      filter.priceDate = {};

      if (from) {
        filter.priceDate.$gte =
          String(from);
      }

      if (to) {
        filter.priceDate.$lte =
          String(to);
      }
    }

    const cap = Math.max(
      50,
      Math.min(
        5000,
        Number(limit) || 1500
      )
    );

    const docs =
      await MarketPrice
        .find(filter)
        .sort({ priceDate: 1 })
        .limit(cap)
        .lean();

    const points = docs
      .filter(
        (d) =>
          d.priceDate &&
          d.pricePerKg != null
      )
      .map((d) => ({
        date: d.priceDate,
        crop: d.cropName,
        market: d.market,
        state: d.state,
        price_per_kg:
          d.pricePerKg,
        price_per_quintal:
          d.pricePerQuintal,
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

/**
 * Escape special regex characters.
 */
function escapeRegex(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
}

module.exports = {
  router,
};