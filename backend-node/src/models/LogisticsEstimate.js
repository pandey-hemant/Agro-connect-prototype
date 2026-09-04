/**
 * models/LogisticsEstimate.js — a saved logistics estimate for a lot.
 *
 * The most recent estimate per (cropLotId, marketName) is the one
 * returned by the API; older ones remain in the collection for audit.
 */
'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const LogisticsEstimateSchema = new Schema(
  {
    cropLotId: { type: Schema.Types.ObjectId, ref: 'CropLot', required: true, index: true },
    marketName: { type: String, required: true, index: true },
    destinationLabel: { type: String, default: '' },
    marketLat: { type: Number, default: null },
    marketLon: { type: Number, default: null },
    distanceKm: { type: Number, required: true, min: 0 },
    transportCost: { type: Number, required: true, min: 0 },
    loadingCost: { type: Number, required: true, min: 0 },
    unloadingCost: { type: Number, required: true, min: 0 },
    otherCharges: { type: Number, required: true, min: 0 },
    totalLogisticsCost: { type: Number, required: true, min: 0 },
    grossValue: { type: Number, required: true, min: 0 },
    netRealization: { type: Number, required: true },
    netRealizationPerKg: { type: Number, required: true },
    isEstimate: { type: Boolean, default: true },
    routingProvider: { type: String, default: 'haversine' },
    // Frontend-friendly fields (Opportunities.jsx alignment)
    vehicleType: { type: String, default: '' },
    modalPricePerKg: { type: Number, default: null },
    isLivePrice: { type: Boolean, default: false },
    // Phase 3 additive — never break older docs (default 0)
    otherCostsPerKg: { type: Number, default: 0 },
    totalOtherCosts: { type: Number, default: 0 },
    // Phase 3 additive — vehicle-rate model
    numVehicles: { type: Number, default: 1 },
    vehicleRatePerKm: { type: Number, default: null },
  },
  { timestamps: true }
);

LogisticsEstimateSchema.methods.toRead = function () {
  return {
    id: this._id,
    crop_lot_id: this.cropLotId,
    market_name: this.marketName,
    destination_label: this.destinationLabel,
    market_lat: this.marketLat,
    market_lon: this.marketLon,
    distance_km: this.distanceKm,
    transport_cost: this.transportCost,
    loading_cost: this.loadingCost,
    unloading_cost: this.unloadingCost,
    other_charges: this.otherCharges,
    total_logistics_cost: this.totalLogisticsCost,
    gross_value: this.grossValue,
    net_realization: this.netRealization,
    net_realization_per_kg: this.netRealizationPerKg,
    is_estimate: this.isEstimate,
    routing_provider: this.routingProvider,
    // Phase 3 — alias for back-compat with new code that calls it distance_provider
    distance_provider: this.routingProvider,
    // Frontend-friendly fields (Opportunities.jsx reads these)
    destination_market: this.marketName,
    vehicle: this.vehicleType,
    vehicle_type: this.vehicleType,
    modal_price_per_kg: this.modalPricePerKg,
    is_live_price: this.isLivePrice,
    net_realisation: this.netRealization,
    // Phase 3 additive
    other_costs_per_kg: this.otherCostsPerKg ?? 0,
    total_other_costs: this.totalOtherCosts ?? 0,
    num_vehicles: this.numVehicles ?? 1,
    vehicle_rate_per_km: this.vehicleRatePerKm ?? null,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

module.exports = mongoose.model('LogisticsEstimate', LogisticsEstimateSchema);
