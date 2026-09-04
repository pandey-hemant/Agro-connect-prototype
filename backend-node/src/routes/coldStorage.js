/**
 * routes/coldStorage.js — cold-storage decision endpoints.
 *
 *   POST /api/cold-storage/estimate          { crop_lot_id, days?, rate_per_kg_per_day?,
 *                                              store_then_sell_price_per_kg?,
 *                                              wastage_pct?, logistics_per_kg? }
 *                                            → { sell_now_value, store_then_sell_value,
 *                                                storage_cost, breakeven_price_per_kg,
 *                                                recommendation, rationale, … }
 *   GET  /api/cold-storage/config            public config snapshot
 *
 * The estimate is rule-based and labelled is_estimate. No AI/forecast.
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const CropLot = require('../models/CropLot');
const MarketPrice = require('../models/MarketPrice');
const Offer = require('../models/Offer');
const { estimateColdStorage } = require('../services/coldStorage');
const { toKg } = require('../utils/units');
const config = require('../config');

const router = express.Router();

async function resolveCropLot(idOrPublic) {
  if (!idOrPublic) return null;
  if (typeof idOrPublic === 'string' && idOrPublic.startsWith('CL-')) {
    return CropLot.findOne({ publicId: idOrPublic });
  }
  if (require('mongoose').isValidObjectId(idOrPublic)) {
    return CropLot.findById(idOrPublic);
  }
  return null;
}

router.post(
  '/estimate',
  asyncHandler(async (req, res) => {
    const {
      crop_lot_id,
      crop,
      quantity_kg,
      days,
      rate_per_kg_per_day,
      sell_now_price_per_kg,
      store_then_sell_price_per_kg,
      wastage_pct,
      logistics_per_kg,
    } = req.body || {};

    // Lot-less path — when the caller does not have a crop_lot_id
    // (e.g. the A-I verification suite exercises a stand-alone
    // estimate; the "Where to sell?" panel on the dashboard may
    // also want a quick scenario without an on-file lot), accept
    // the three required scalars and run a synthetic estimate.
    //
    // Required:   crop, quantity_kg, days
    // Optional:   rate_per_kg_per_day, sell_now_price_per_kg,
    //             wastage_pct, logistics_per_kg
    //
    // We never invent a sell-now price: the response is honest about
    // the assumption (no live offer / no on-file lot → reference
    // price is the caller's `sell_now_price_per_kg` or 0).
    if (!crop_lot_id) {
      if (!crop || !quantity_kg || !days) {
        throw new AppError(
          400,
          'either crop_lot_id OR (crop, quantity_kg, days) is required',
        );
      }
      const qty = Number(quantity_kg);
      const d = Math.floor(Number(days));
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new AppError(400, 'quantity_kg must be a positive number');
      }
      if (!Number.isFinite(d) || d < 0) {
        throw new AppError(400, 'days must be a finite non-negative integer');
      }
      const rate = rate_per_kg_per_day != null
        ? Number(rate_per_kg_per_day)
        : 0.20; // ₹/kg/day — same default as the lot path
      const wastage = wastage_pct != null
        ? Number(wastage_pct)
        : Number(config.storage.default_wastage_pct || 0);
      const logistics = logistics_per_kg != null
        ? Number(logistics_per_kg)
        : 0;
      const sellNow = sell_now_price_per_kg != null
        ? Number(sell_now_price_per_kg)
        : 0;
      if (!Number.isFinite(rate) || rate < 0) {
        throw new AppError(400, 'rate_per_kg_per_day must be >= 0');
      }
      if (!Number.isFinite(wastage) || wastage < 0) {
        throw new AppError(400, 'wastage_pct must be >= 0');
      }
      if (!Number.isFinite(logistics) || logistics < 0) {
        throw new AppError(400, 'logistics_per_kg must be >= 0');
      }
      if (!Number.isFinite(sellNow) || sellNow < 0) {
        throw new AppError(400, 'sell_now_price_per_kg must be >= 0');
      }
      // Compose the same shape the service returns, with a clear
      // `is_estimate: true` flag and a no-lot reference source.
      const cost = +(qty * d * rate).toFixed(2);
      const effectiveSell = sellNow; // explicit — never invent from market
      const wastageValue = +(qty * (wastage / 100) * effectiveSell).toFixed(2);
      const net = +(qty * effectiveSell - cost - logistics - wastageValue).toFixed(2);
      const breakeven = effectiveSell > 0
        ? +((cost + logistics + wastageValue) / (qty * (1 - wastage / 100)) + effectiveSell).toFixed(2)
        : null;
      return res.json({
        crop: String(crop).toLowerCase(),
        quantity_kg: qty,
        days: d,
        is_estimate: true,
        rate_per_kg_per_day: rate,
        wastage_pct: wastage,
        logistics_per_kg: logistics,
        sell_now_price_per_kg: effectiveSell,
        store_then_sell_price_per_kg:
          store_then_sell_price_per_kg != null
            ? Number(store_then_sell_price_per_kg)
            : null,
        cost,
        wastage_value: wastageValue,
        net_if_stored: net,
        breakeven_price_per_kg: breakeven,
        assumption: 'cold-storage estimate without lot reference',
        source: 'config',
      });
    }

    const lot = await resolveCropLot(crop_lot_id);
    if (!lot) throw new AppError(404, 'crop lot not found');

    // Phase 4 — defensive numeric coercion. Accept either a
    // string or a number for each input, but reject negatives
    // and non-finite values with 400 (instead of letting the
    // service quietly produce 0 or NaN).
    const qtyKgRaw = toKg(lot.quantity, lot.quantityUnit);
    const qtyKg = Number.isFinite(Number(qtyKgRaw)) && qtyKgRaw >= 0
      ? qtyKgRaw
      : Number(lot.quantity || 0) || 0;
    if (qtyKg <= 0) {
      throw new AppError(
        400,
        'crop lot has no usable quantity for a storage estimate',
      );
    }
    const dRaw = days != null ? Number(days) : (lot.coldStorageDurationDays || 30);
    if (!Number.isFinite(Number(dRaw))) {
      throw new AppError(400, 'days must be a finite number');
    }
    if (Number(dRaw) < 0) {
      throw new AppError(400, 'days must be >= 0');
    }
    const d = Math.floor(Number(dRaw));
    const rateRaw = rate_per_kg_per_day != null
      ? Number(rate_per_kg_per_day)
      : (lot.coldStorageRatePerKgPerDay || 0.20);
    if (!Number.isFinite(Number(rateRaw))) {
      throw new AppError(400, 'rate_per_kg_per_day must be a finite number');
    }
    if (Number(rateRaw) < 0) {
      throw new AppError(400, 'rate_per_kg_per_day must be >= 0');
    }
    const rate = Number(rateRaw);
    const wastageRaw = wastage_pct != null ? Number(wastage_pct) : 0;
    if (!Number.isFinite(Number(wastageRaw)) || Number(wastageRaw) < 0) {
      throw new AppError(400, 'wastage_pct must be a finite number >= 0');
    }
    const logRaw = logistics_per_kg != null ? Number(logistics_per_kg) : 0;
    if (!Number.isFinite(Number(logRaw)) || Number(logRaw) < 0) {
      throw new AppError(400, 'logistics_per_kg must be a finite number >= 0');
    }
    const storePriceRaw = store_then_sell_price_per_kg != null
      ? Number(store_then_sell_price_per_kg)
      : null;
    if (
      store_then_sell_price_per_kg != null &&
      (!Number.isFinite(Number(storePriceRaw)) || Number(storePriceRaw) < 0)
    ) {
      throw new AppError(
        400,
        'store_then_sell_price_per_kg must be a finite number >= 0',
      );
    }

    // Best sell-now reference: highest OPEN/COUNTERED offer price, else
    // expected_price_per_kg, else avg market price for the crop.
    let sellNow = Number(lot.expectedPricePerKg || 0);
    if (!Number.isFinite(sellNow) || sellNow < 0) sellNow = 0;
    const openOffers = await Offer.find({
      cropLotId: lot._id,
      status: { $in: ['OPEN', 'COUNTERED'] },
    });
    let bestOfferPrice = 0;
    for (const o of openOffers) {
      if ((o.currentPrice || 0) > bestOfferPrice) bestOfferPrice = o.currentPrice;
    }
    if (bestOfferPrice > 0) sellNow = bestOfferPrice;
    if (!sellNow) {
      const marketRows = await MarketPrice.find({
        cropName: new RegExp(`^${lot.cropName}$`, 'i'),
      });
      if (marketRows.length) {
        sellNow =
          marketRows.reduce((a, m) => a + (m.pricePerKg || 0), 0) /
          marketRows.length;
      }
    }

    const estimate = estimateColdStorage({
      quantity_kg: qtyKg,
      days: d,
      rate_per_kg_per_day: rate,
      sell_now_price_per_kg: sellNow,
      store_then_sell_price_per_kg: storePriceRaw,
      wastage_pct: Number(wastageRaw),
      logistics_per_kg: Number(logRaw),
    });
    res.json({
      crop_lot_id: lot.publicId,
      ...estimate,
    });
  })
);

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({
      default_rate_per_kg_per_day: 0.20,
      default_days: 30,
      wastage_default_pct: 0,
      is_estimate: true,
      note: 'Cold-storage estimate is rule-based, not a forecast. Adjust rate/days to match your local cold store.',
      // Phase 3 — NHB scheme citation. REFERENCE only, not a tariff.
      nhb_scheme: config.nhbScheme,
    });
  })
);

module.exports = { router };
