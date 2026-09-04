/**
 * models/Offer.js — an offer on either a crop lot (buyer→seller) OR
 * a buyer demand (seller→buyer). One Offer document, two creation
 * paths.
 *
 *   Legacy / crop-lot path (default):
 *     POST /api/offers
 *       body: { crop_lot_id, buyer_id, price, quantity, message }
 *     Offer.cropLotId    required (ref CropLot)
 *     Offer.buyerId      required (ref Buyer)
 *     Offer.demandId     null
 *     Offer.farmerUserPublicId = lot.sellerUserPublicId
 *
 *   New / demand path:
 *     POST /api/demands/:id/offers
 *       body: { price, quantity, message, crop_lot_id? }
 *     Offer.demandId     required (ref Demand)
 *     Offer.buyerId      = demand.buyerId
 *     Offer.farmerUserPublicId required
 *     Offer.cropLotId    optional (ref to the lot the farmer is
 *                          fulfilling from; if absent, the demand
 *                          itself is the only context)
 *
 * State machine (both paths):
 *   (none) ──create──▶ OPEN
 *   OPEN / COUNTERED ──counter──▶ COUNTERED
 *   OPEN / COUNTERED ──accept──▶ ACCEPTED  (creates a Deal)
 *   OPEN / COUNTERED ──reject──▶ REJECTED
 *   *       ──cancel──▶ CANCELLED  (only if not ACCEPTED)
 *
 *   * Note that messages are authored by FARMER, BUYER, or SYSTEM
 *   depending on the flow. The demand path starts with a FARMER
 *   author; the legacy path starts with a BUYER author.
 *
 * When an offer is accepted:
 *   - legacy path: a Deal is created referencing the CropLot; the
 *     CropLot is marked SOLD; other open offers on that lot are
 *     auto-rejected.
 *   - demand path: a Deal is created referencing the Demand; the
 *     Demand.filledQuantityKg is incremented; other open offers on
 *     the demand are auto-rejected.
 */
'use strict';

const mongoose = require('mongoose');
const { OfferId } = require('../utils/publicId');

const { Schema } = mongoose;

const OfferMessageSchema = new Schema(
  {
    author: { type: String, enum: ['FARMER', 'BUYER', 'SYSTEM'], required: true },
    message: { type: String, default: '' },
    price: { type: Number, default: null },
    quantity: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const OfferSchema = new Schema(
  {
    publicId: { type: String, unique: true, index: true, required: true },
    // Legacy path requires a crop lot; demand path leaves it null.
    cropLotId: {
      type: Schema.Types.ObjectId,
      ref: 'CropLot',
      required: false,
      index: true,
      default: null,
    },
    buyerId: { type: Schema.Types.ObjectId, ref: 'Buyer', required: true, index: true },
    // New: demand path. Mutually inclusive with cropLotId in the
    // sense that exactly one is set (validated in the service layer).
    demandId: {
      type: Schema.Types.ObjectId,
      ref: 'Demand',
      required: false,
      index: true,
      default: null,
    },
    // New: who is making the offer. For the legacy path, this is
    // derived from cropLot.sellerUserPublicId at create-time. For
    // the demand path, the calling user's publicId is required.
    farmerUserPublicId: { type: String, default: null, index: true },
    currentPrice: { type: Number, required: true, min: 0 },
    currentQuantity: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['OPEN', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'CANCELLED'],
      default: 'OPEN',
      index: true,
    },
    messages: { type: [OfferMessageSchema], default: [] },
    decidedAt: { type: Date, default: null },
    dealId: { type: Schema.Types.ObjectId, ref: 'Deal', default: null },
  },
  { timestamps: true }
);

OfferSchema.statics.newPublicId = OfferId;

OfferSchema.methods.toRead = function () {
  return {
    id: this._id,
    public_id: this.publicId,
    crop_lot_id: this.cropLotId,
    buyer_id: this.buyerId,
    demand_id: this.demandId,
    farmer_user_public_id: this.farmerUserPublicId,
    current_price: this.currentPrice,
    current_quantity: this.currentQuantity,
    status: this.status,
    messages: (this.messages || []).map((m) => ({
      author: m.author,
      message: m.message,
      price: m.price,
      quantity: m.quantity,
      created_at: m.createdAt,
    })),
    decided_at: this.decidedAt,
    deal_id: this.dealId,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

/**
 * Async toRead() that resolves the related publicIds (Demand, CropLot,
 * Deal) by looking up the documents. Use this on read-paths where
 * the caller wants the publicId in the wire payload rather than the
 * Mongo _id. Skips lookups that would be no-ops (null refs).
 *
 * The plain toRead() is kept for hot paths (list, count) where a
 * second round-trip is undesirable.
 */
OfferSchema.methods.toReadWithRefs = async function () {
  const out = this.toRead();
  if (this.demandId) {
    const d = await mongoose.model('Demand').findById(this.demandId).select('publicId').lean();
    if (d) out.demand_public_id = d.publicId;
  }
  if (this.cropLotId) {
    const c = await mongoose.model('CropLot').findById(this.cropLotId).select('publicId').lean();
    if (c) out.crop_lot_public_id = c.publicId;
  }
  if (this.dealId) {
    const d = await mongoose.model('Deal').findById(this.dealId).select('publicId').lean();
    if (d) out.deal_public_id = d.publicId;
  }
  return out;
};

module.exports = mongoose.model('Offer', OfferSchema);
