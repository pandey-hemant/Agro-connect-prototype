/**
 * models/Demand.js — first-class buyer demand (a.k.a. RFQ).
 *
 * The pre-existing Buyer.requirements[] subdoc array is a thin
 * description of what a buyer wants. It is addressable only by the
 * tuple (buyerPublicId, index). The user-flow requires that a farmer
 * can open a specific demand by ID, see its full details, and submit
 * an offer against it.
 *
 * This model is the new, addressable, own-state-machine surface for
 * demands. It coexists with the legacy subdoc — existing endpoints
 * under /api/buyers/:publicId/requirements keep working for backward
 * compatibility, but new flows (Farmer Dashboard → Buyer Demands,
 * Demand Details, Make Offer) use this model.
 *
 *   publicId                — `DEMAND-XXXXXXXXXXXX` (hex uppercase)
 *   buyerId                 — ObjectId ref to Buyer (the buyer who
 *                             owns the demand)
 *   buyerPublicId           — denormalised for convenience / display
 *   createdByUserPublicId   — User.publicId of the user who created it
 *                             (used for ownership checks)
 *   cropName, cropVariety   — what they want to buy
 *   quantityKg              — total kg requested
 *   maxPricePerKg           — optional ceiling (null = open)
 *   location, state         — delivery / preferred location
 *   requiredDate            — ISO date string
 *   notes                   — free text
 *   status                  — ACTIVE / CLOSED / FULFILLED
 *   filledQuantityKg        — running sum of accepted offer quantities
 *   offerCount              — denormalised count of offers (cheaper
 *                             reads)
 *
 * The state machine is:
 *   ACTIVE ──close(buyer)──▶ CLOSED     (terminal for new offers)
 *   ACTIVE ──fulfill──▶     FULFILLED  (when filledQuantityKg ≥
 *                                        quantityKg)
 *   *       ──no-op──▶     ACTIVE      (re-open? no, stays as-is)
 */
'use strict';

const mongoose = require('mongoose');
const { DemandId } = require('../utils/publicId');

const { Schema } = mongoose;

const DemandSchema = new Schema(
  {
    publicId: { type: String, unique: true, index: true, required: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'Buyer', required: true, index: true },
    buyerPublicId: { type: String, required: true, index: true },
    createdByUserPublicId: { type: String, default: null, index: true },
    cropName: { type: String, required: true, index: true },
    cropVariety: { type: String, default: '' },
    quantityKg: { type: Number, required: true, min: 0 },
    maxPricePerKg: { type: Number, default: null },
    location: { type: String, default: '' },
    state: { type: String, default: '' },
    requiredDate: { type: String, default: '' },
    notes: { type: String, default: '' },
    status: {
      type: String,
      enum: ['ACTIVE', 'CLOSED', 'FULFILLED'],
      default: 'ACTIVE',
      index: true,
    },
    filledQuantityKg: { type: Number, default: 0, min: 0 },
    offerCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

DemandSchema.statics.newPublicId = DemandId;

DemandSchema.methods.toRead = function () {
  return {
    id: this._id,
    public_id: this.publicId,
    buyer_id: this.buyerId,
    buyer_public_id: this.buyerPublicId,
    created_by_user_public_id: this.createdByUserPublicId,
    crop_name: this.cropName,
    crop_variety: this.cropVariety || '',
    quantity_kg: this.quantityKg,
    max_price_per_kg: this.maxPricePerKg,
    location: this.location || '',
    state: this.state || '',
    required_date: this.requiredDate || '',
    notes: this.notes || '',
    status: this.status,
    filled_quantity_kg: this.filledQuantityKg,
    offer_count: this.offerCount,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

module.exports = mongoose.model('Demand', DemandSchema);
