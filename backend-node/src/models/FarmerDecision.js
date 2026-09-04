/**
 * models/FarmerDecision.js — cached decision-support recommendation
 * for a crop lot.
 *
 * The decision service is recomputed on demand and stored here for
 * retrieval. Re-running POST /decisions/:lotId/refresh overwrites the
 * current entry.
 */
'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const DECISION_TYPES = ['SELL_NOW', 'WAIT', 'GROUP_SALE'];

const FarmerDecisionSchema = new Schema(
  {
    cropLotId: { type: Schema.Types.ObjectId, ref: 'CropLot', required: true, unique: true, index: true },
    decision: { type: String, enum: DECISION_TYPES, required: true },
    rationale: { type: String, default: '' },
    marketComparison: { type: Schema.Types.Mixed, default: [] }, // array of comparisons
    offerCount: { type: Number, default: 0 },
    bestOfferPrice: { type: Number, default: null },
    // True when the recommendation is based on partial inputs (no
    // market prices found AND no expected price AND no offers).
    insufficientData: { type: Boolean, default: false },
    // The crop lot's publicId (CL-...). Stored explicitly so the
    // wire response always surfaces it without an extra populate.
    cropLotPublicId: { type: String, default: '', index: true },
    // Phase 5 — ML prediction summary.
    predictionAvailable: { type: Boolean, default: false },
    predictionTrend: { type: String, default: 'unknown' }, // up / down / flat / unknown
    predictionMethod: { type: String, default: null },
    predictionDisclaimed: { type: Boolean, default: false },
    // Phase 6 — explicit break-even future price for the WAIT
    // panel. Number|null; null when the inputs (expected price,
    // quantity) are missing. Assumptions stored separately so
    // the UI can show "30 days, 3% wastage, ₹0.20/kg/day" without
    // a second round-trip.
    breakevenFuturePricePerKg: { type: Number, default: null },
    breakevenAssumptions: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

FarmerDecisionSchema.statics.TYPES = DECISION_TYPES;

// toRead() — wire shape for the /api/decisions/:lotId response.
//
// The existing verifiers (e.g. scripts/verify_e2e.cjs) read
// `decision`, `market_comparison`, and `rationale`. The DecisionSupport
// React page (frontend/src/pages/DecisionSupport.jsx) reads
// `recommendation`, `reason`, `comparison`, `insufficient_data`, and
// `crop_lot_id` (the publicId, CL-...). We expose BOTH the old and
// new keys so the page and the old tests both work without changes.
//
// `crop_lot_id` is the publicId (CL-...) so the React "Recompute"
// button can POST /decisions/${current.crop_lot_id}/refresh without
// the frontend having to resolve an ObjectId. The Mongo ObjectId is
// surfaced separately as `crop_lot_internal_id` for completeness.
FarmerDecisionSchema.methods.toRead = function () {
  const lotPublicId =
    (this.cropLotPublicId && String(this.cropLotPublicId)) ||
    (this.cropLotId && this.cropLotId.publicId) ||
    (this.cropLotId && typeof this.cropLotId === 'object' && this.cropLotId._id
      ? String(this.cropLotId._id)
      : String(this.cropLotId || ''));
  const lotInternalId = this.cropLotId && this.cropLotId._id
    ? String(this.cropLotId._id)
    : String(this.cropLotId || '');
  const comparison = Array.isArray(this.marketComparison) ? this.marketComparison : [];
  return {
    // Old keys (kept for backward compat with existing verifiers)
    id: this._id,
    crop_lot_id: lotPublicId,
    decision: this.decision,
    rationale: this.rationale,
    market_comparison: comparison,
    offer_count: this.offerCount,
    best_offer_price: this.bestOfferPrice,
    // New keys (frontend DecisionSupport.jsx alignment)
    recommendation: this.decision,
    reason: this.rationale,
    comparison,
    insufficient_data: !!this.insufficientData,
    crop_lot_public_id: lotPublicId,
    crop_lot_internal_id: lotInternalId,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
    // Phase 5 — prediction fields
    prediction_available: !!this.predictionAvailable,
    prediction_trend: this.predictionTrend || 'unknown',
    prediction_method: this.predictionMethod || null,
    prediction_disclaimer:
      this.predictionDisclaimed
        ? 'ML-based heuristic forecast; not financial advice. Compare to a real model before acting.'
        : null,
    // Phase 6 — break-even future price (WAIT panel).
    breakeven_future_price_per_kg:
      this.breakevenFuturePricePerKg == null ? null : Number(this.breakevenFuturePricePerKg),
    breakeven_assumptions: this.breakevenAssumptions || null,
  };
};

module.exports = mongoose.model('FarmerDecision', FarmerDecisionSchema);
