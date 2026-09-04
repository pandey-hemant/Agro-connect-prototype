/**
 * models/Deal.js — a created deal when an offer is accepted.
 *
 * Two creation paths:
 *   - Legacy: buyer makes offer on a crop lot, accepted → Deal with
 *     cropLotId set, demandId null.
 *   - New: farmer makes offer on a buyer's demand, accepted by the
 *     buyer → Deal with demandId set, cropLotId optional.
 *
 * Delivery state machine (no backwards transitions):
 *   PENDING → PREPARING → IN_TRANSIT → DELIVERED → COMPLETED
 *   (any) → DISPUTED
 *
 * Payment status follows an explicit rail enforced by
 * routes/deals.js#/payment-transition:
 *   PAYMENT_PENDING → PAYMENT_INITIATED → PAYMENT_SECURED
 *     → PAYMENT_RELEASED → COMPLETED
 *   (any non-terminal) → DISPUTED → REFUNDED | PAYMENT_SECURED
 *
 * `paymentEvents` is the immutable demo audit trail: every transition
 * appends a row with a deterministic `txn_id` (DEMO-TXN-...) so the
 * UI can show the user exactly what was recorded. No real money is
 * moved.
 */
'use strict';

const mongoose = require('mongoose');
const { DealId } = require('../utils/publicId');

const { Schema } = mongoose;

const DEAL_DELIVERY = ['PENDING', 'PREPARING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'DISPUTED'];
// New rail plus the legacy aliases so old records still read back
// without losing data. Routes layer normalizes to the rail.
const DEAL_PAYMENT = [
  // legacy aliases
  'UNPAID', 'PARTIAL', 'PAID', 'REFUNDED',
  // new explicit rail
  'PAYMENT_PENDING', 'PAYMENT_INITIATED', 'PAYMENT_SECURED',
  'PAYMENT_RELEASED', 'COMPLETED', 'DISPUTED',
  'CREATED',
];

const PaymentEventSchema = new Schema(
  {
    from: { type: String, default: null },
    to: { type: String, required: true },
    amount: { type: Number, default: null },
    txn_id: { type: String, required: true, index: true },
    at: { type: Date, default: Date.now },
    by: { type: String, default: 'system' },
    note: { type: String, default: '' },
  },
  { _id: false }
);

// Full deal-level audit trail (Feature H). Append-only — never mutate
// after the fact. Captures delivery, payment, verification, and
// issue events in one chronological log so a single endpoint can
// render "what happened on this deal".
const DEAL_EVENT_TYPES = [
  'DEAL_CREATED',
  'DELIVERY_STATUS_CHANGED',
  'PAYMENT_STATUS_CHANGED',
  'VERIFICATION_STARTED',
  'VERIFICATION_COMPLETED',
  'VERIFICATION_RESOLVED',
  'ISSUE_RAISED',
  'ISSUE_RESOLVED',
  'GROUP_SALE_OPTED_IN',
];

const DealEventSchema = new Schema(
  {
    type: { type: String, enum: DEAL_EVENT_TYPES, required: true },
    from: { type: String, default: null },
    to: { type: String, default: null },
    actorPublicId: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    details: { type: Schema.Types.Mixed, default: null },
    txnRef: { type: String, default: '' },
    at: { type: Date, default: Date.now, index: true },
  },
  { _id: false }
);

const DealSchema = new Schema(
  {
    publicId: { type: String, unique: true, index: true, required: true },
    // One of cropLotId / demandId is set; both may be set if a
    // demand-based offer also references a specific lot.
    cropLotId: {
      type: Schema.Types.ObjectId,
      ref: 'CropLot',
      required: false,
      default: null,
      index: true,
    },
    buyerId: { type: Schema.Types.ObjectId, ref: 'Buyer', required: true, index: true },
    demandId: {
      type: Schema.Types.ObjectId,
      ref: 'Demand',
      required: false,
      default: null,
      index: true,
    },
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer', default: null },
    // Who is on the other side of the deal.
    farmerUserPublicId: { type: String, default: null, index: true },
    agreedPricePerKg: { type: Number, required: true, min: 0 },
    agreedQuantity: { type: Number, required: true, min: 0 },
    totalValue: { type: Number, required: true, min: 0 },
    deliveryStatus: { type: String, enum: DEAL_DELIVERY, default: 'PENDING' },
    paymentStatus: { type: String, enum: DEAL_PAYMENT, default: 'UNPAID' },
    notes: { type: String, default: '' },
    // Total deal value, computed when the deal is created. UI uses
    // this for "Deal value: ₹X" in the lifecycle panel.
    amount: { type: Number, default: null },
    // Append-only audit log of payment transitions.
    paymentEvents: { type: [PaymentEventSchema], default: [] },
    // Full deal audit trail (delivery + payment + verification + issue).
    dealEvents: { type: [DealEventSchema], default: [] },
    // Feature B — link to the deal verification record, if any.
    verificationId: {
      type: Schema.Types.ObjectId,
      ref: 'DealVerification',
      default: null,
    },
    // Feature E — explicit farmer opt-in to group sale through an FPO.
    groupSaleOptedIn: { type: Boolean, default: false },
    groupSaleOptedInAt: { type: Date, default: null },
    groupSaleFpoId: {
      type: Schema.Types.ObjectId,
      ref: 'FPO',
      default: null,
    },
  },
  { timestamps: true }
);

DealSchema.statics.newPublicId = DealId;
DealSchema.statics.DELIVERY_STATES = DEAL_DELIVERY;
DealSchema.statics.PAYMENT_STATES = DEAL_PAYMENT;
DealSchema.statics.EVENT_TYPES = DEAL_EVENT_TYPES;

DealSchema.methods.toRead = function () {
  return {
    id: this._id,
    public_id: this.publicId,
    crop_lot_id: this.cropLotId,
    buyer_id: this.buyerId,
    demand_id: this.demandId,
    offer_id: this.offerId,
    farmer_user_public_id: this.farmerUserPublicId,
    agreed_price_per_kg: this.agreedPricePerKg,
    agreed_quantity: this.agreedQuantity,
    total_value: this.totalValue,
    delivery_status: this.deliveryStatus,
    payment_status: this.paymentStatus,
    notes: this.notes,
    amount: this.amount,
    payment_events: (this.paymentEvents || []).map((e) => ({
      from: e.from,
      to: e.to,
      amount: e.amount,
      txn_id: e.txn_id,
      at: e.at,
      by: e.by,
    })),
    last_txn_id:
      this.paymentEvents && this.paymentEvents.length
        ? this.paymentEvents[this.paymentEvents.length - 1].txn_id
        : null,
    deal_events: (this.dealEvents || []).map((e) => ({
      type: e.type,
      from: e.from,
      to: e.to,
      actor_public_id: e.actorPublicId,
      actor_role: e.actorRole,
      details: e.details,
      txn_ref: e.txnRef,
      at: e.at,
    })),
    verification_id: this.verificationId,
    group_sale_opted_in: Boolean(this.groupSaleOptedIn),
    group_sale_opted_in_at: this.groupSaleOptedInAt,
    group_sale_fpo_id: this.groupSaleFpoId,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

module.exports = mongoose.model('Deal', DealSchema);
