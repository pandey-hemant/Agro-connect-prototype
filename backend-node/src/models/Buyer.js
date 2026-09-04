/**
 * models/Buyer.js — a buyer (trader) identity.
 *
 * `requirements` is embedded as a subdocument array (was a separate
 * SQL table in the Python version). One buyer can have many crop
 * requirements.
 */
'use strict';

const mongoose = require('mongoose');
const { BuyerId } = require('../utils/publicId');

const { Schema } = mongoose;

const BuyerRequirementSchema = new Schema(
  {
    cropName: { type: String, required: true },
    cropVariety: { type: String, default: '' },
    minQuantityKg: { type: Number, required: true, min: 0 },
    maxPricePerKg: { type: Number, default: null },
    preferredStates: { type: [String], default: [] },
    location: { type: String, default: '' },
    requiredDate: { type: String, default: '' }, // ISO date string, optional
    notes: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const BuyerSchema = new Schema(
  {
    publicId: { type: String, unique: true, index: true, required: true },
    name: { type: String, required: true },
    location: { type: String, default: '' },
    state: { type: String, default: '' },
    contact: { type: String, default: '' },
    // businessName — display/registered name of the buying entity
    // (often different from the colloquial `name`). Optional. The
    // POST /api/buyers endpoint accepts `business_name` on the wire
    // and persists it here; toRead() exposes it as `business_name`
    // so the rest of the API can render either field without an
    // extra lookup.
    businessName: { type: String, default: null },
    isDemo: { type: Boolean, default: false },
    requirements: { type: [BuyerRequirementSchema], default: [] },
  },
  { timestamps: true }
);

BuyerSchema.statics.newPublicId = BuyerId;

BuyerSchema.methods.toRead = function () {
  return {
    id: this._id,
    public_id: this.publicId,
    name: this.name,
    location: this.location,
    state: this.state,
    contact: this.contact,
    business_name: this.businessName ?? null,
    is_demo: this.isDemo,
    requirements: (this.requirements || []).map((r) => ({
      crop_name: r.cropName,
      crop_variety: r.cropVariety || '',
      min_quantity_kg: r.minQuantityKg,
      max_price_per_kg: r.maxPricePerKg,
      preferred_states: r.preferredStates,
      location: r.location || '',
      required_date: r.requiredDate || '',
      notes: r.notes,
      created_at: r.createdAt,
    })),
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

module.exports = mongoose.model('Buyer', BuyerSchema);
