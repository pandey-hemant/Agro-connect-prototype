/**
 * models/CropLot.js — a farmer's lot of one crop.
 *
 * Mirrors the Python CropLot SQLAlchemy model. All wire field names
 * (public_id, crop_name, ...) are snake_case; the model uses camelCase
 * internally and toRead() converts.
 */
'use strict';

const mongoose = require('mongoose');
const { CropLotId } = require('../utils/publicId');

const { Schema } = mongoose;

const CropLotSchema = new Schema(
  {
    publicId: { type: String, unique: true, index: true, required: true },
    cropName: { type: String, required: true, index: true },
    cropVariety: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    quantityUnit: { type: String, default: 'kg' },
    harvestDate: { type: String, default: '' }, // ISO date string
    location: { type: String, default: '' },
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    state: { type: String, default: '', index: true },
    farmerQualityGrade: { type: String, default: '' }, // A / B / C
    expectedPricePerKg: { type: Number, default: null },
    minimumAcceptablePrice: { type: Number, default: null },
    status: {
      type: String,
      enum: ['ACTIVE', 'SOLD', 'EXPIRED', 'WITHDRAWN'],
      default: 'ACTIVE',
      index: true,
    },
    sellerUserPublicId: { type: String, default: '' },
    notes: { type: String, default: '' },
    // Cold storage — used by the decision-support comparison
    // SELL_NOW vs STORE_THEN_SELL. Defaults reflect typical Indian
    // cold-chain rates (INR 0.20/kg/day, capacity 30 days).
    coldStorageRequired: { type: Boolean, default: false },
    coldStorageDurationDays: { type: Number, default: 0, min: 0 },
    coldStorageRatePerKgPerDay: { type: Number, default: 0.20, min: 0 },
  },
  { timestamps: true }
);

CropLotSchema.statics.newPublicId = CropLotId;

CropLotSchema.methods.toRead = function () {
  return {
    id: this._id,
    public_id: this.publicId,
    crop_name: this.cropName,
    crop_variety: this.cropVariety,
    quantity: this.quantity,
    quantity_unit: this.quantityUnit,
    harvest_date: this.harvestDate,
    location: this.location,
    lat: this.lat,
    lon: this.lon,
    state: this.state,
    farmer_quality_grade: this.farmerQualityGrade,
    expected_price_per_kg: this.expectedPricePerKg,
    minimum_acceptable_price: this.minimumAcceptablePrice,
    status: this.status,
    seller_user_public_id: this.sellerUserPublicId,
    notes: this.notes,
    cold_storage_required: this.coldStorageRequired,
    cold_storage_duration_days: this.coldStorageDurationDays,
    cold_storage_rate_per_kg_per_day: this.coldStorageRatePerKgPerDay,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

module.exports = mongoose.model('CropLot', CropLotSchema);
