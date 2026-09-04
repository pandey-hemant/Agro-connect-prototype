/**
 * routes/logistics.js — logistics endpoints.
 *
 *   POST /api/logistics/estimate          { crop_lot_id, market_name | destination_market, destination_label?, vehicle_type?, agreed_price_per_kg? }
 *   GET  /api/logistics/estimates/:lotId  list estimates for a lot
 *   GET  /api/logistics/config            public config snapshot
 *
 * The body accepts `market_name` (legacy) and `destination_market`
 * (used by the React Opportunities.jsx page) as aliases. The response
 * surface includes `destination_label`, `destination_market`,
 * `vehicle_type`, `modal_price_per_kg`, and `is_live_price` so the
 * Opportunities page renders without any frontend changes.
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const CropLot = require('../models/CropLot');
const MarketPrice = require('../models/MarketPrice');
const LogisticsEstimate = require('../models/LogisticsEstimate');
const { estimateForLot } = require('../services/logistics');
const config = require('../config');

const router = express.Router();

router.post(
  '/estimate',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const crop_lot_id = body.crop_lot_id;
    if (!crop_lot_id) throw new AppError(400, 'crop_lot_id is required');
    const lot = await resolveCropLot(crop_lot_id);
    if (!lot) throw new AppError(404, 'crop lot not found');
    // market_name (legacy) === destination_market (frontend)
    const market_name = body.market_name || body.destination_market;
    const destination_label = body.destination_label;
    const vehicle_type = body.vehicle_type;
    const agreed_price_per_kg = body.agreed_price_per_kg;

    const estimate = await estimateForLot(lot, {
      market_name,
      destination_label,
      vehicle_type,
      agreed_price_per_kg,
    });

    // Look up the modal price for this market so the Opportunities
    // page can show it next to the gross value. Substring match on
    // the market name.
    let modalPricePerKg = null;
    let isLivePrice = false;
    if (market_name) {
      const m = await MarketPrice.findOne({
        market: new RegExp(escapeRegex(String(market_name)), 'i'),
        cropName: new RegExp(`^${escapeRegex(String(lot.cropName))}$`, 'i'),
      }).sort({ createdAt: -1 });
      if (m) {
        modalPricePerKg = m.pricePerKg;
        isLivePrice = !!m.isLive;
      }
    }

    const saved = await LogisticsEstimate.create({
      cropLotId: lot._id,
      marketName: estimate.market_name,
      destinationLabel: estimate.destination_label,
      marketLat: estimate.market_lat,
      marketLon: estimate.market_lon,
      distanceKm: estimate.distance_km,
      transportCost: estimate.transport_cost,
      loadingCost: estimate.loading_cost,
      unloadingCost: estimate.unloading_cost,
      otherCharges: estimate.other_charges,
      totalLogisticsCost: estimate.total_logistics_cost,
      grossValue: estimate.gross_value,
      netRealization: estimate.net_realization,
      netRealizationPerKg: estimate.net_realization_per_kg,
      isEstimate: estimate.is_estimate,
      routingProvider: estimate.routing_provider,
      vehicleType: vehicle_type || estimate.vehicle,
      modalPricePerKg,
      isLivePrice,
      // Phase 3 additive — other-costs line + vehicle-rate model.
      otherCostsPerKg: estimate.other_costs_per_kg || 0,
      totalOtherCosts: estimate.total_other_costs || 0,
      numVehicles: estimate.num_vehicles || 1,
      vehicleRatePerKm: estimate.vehicle_rate_per_km || null,
    });
    // Surface the freshly-computed values directly in the response too,
    // so the React Opportunities page can render without re-reading.
    const read = saved.toRead();
    res.json({
      ...read,
      other_costs_per_kg: estimate.other_costs_per_kg,
      total_other_costs: estimate.total_other_costs,
      num_vehicles: estimate.num_vehicles,
      vehicle_rate_per_km: estimate.vehicle_rate_per_km,
      distance_provider: estimate.routing_provider,
      // Phase 4 — distance provenance. Lets the UI label
      // "Routed" vs "Estimated (haversine)" and "district
      // centroid" vs "state centroid" without guessing.
      is_routed: estimate.is_routed,
      origin_kind: estimate.origin_kind,
      destination_kind: estimate.destination_kind,
      origin_label: estimate.origin_label,
    });
  })
);

router.get(
  '/estimates/:lotId',
  asyncHandler(async (req, res) => {
    const lot = await resolveCropLot(req.params.lotId);
    if (!lot) throw new AppError(404, 'crop lot not found');
    const list = await LogisticsEstimate.find({ cropLotId: lot._id }).sort({
      createdAt: -1,
    });
    res.json({ results: list.map((e) => e.toRead()) });
  })
);

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({
      logistics: {
        ...config.logistics,
        other_costs_per_kg: config.otherCostsPerKg,
      },
      maps_api_configured: !!config.mapsApiKey,
      routing_api_configured: !!config.routingApiKey,
      geoapify_api_configured: !!config.geoapifyApiKey,
      vehicle_rates: config.vehicleRates,
      nhb_scheme: config.nhbScheme,
    });
  })
);

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

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { router };
