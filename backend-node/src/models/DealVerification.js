/**
 * models/DealVerification.js — deal-level quality + weight verification.
 *
 * Created when a deal reaches the verification stage (typically when
 * the buyer/receiver is ready to acknowledge the shipment). It records
 * what the seller DECLARED at offer time, what the buyer MEASURED on
 * receipt, and the resolution state.
 *
 * State machine (Feature B):
 *   VERIFICATION_PENDING  — initial state, awaiting receiver input
 *     ├─ actual ≈ declared (±2% weight, grade match) → VERIFIED
 *     └─ actual differs (weight or grade)           → DISCREPANCY_FOUND
 *   DISCREPANCY_FOUND  ──resolve (accept actual / accept declared / split)──▶ RESOLVED
 *
 * Why a separate model: the lot-level QualityAssessment covers the
 * seller's promise and a generic "verified" stamp on the lot. This
 * model captures the actual transaction: declared weight vs. actual
 * weight, with explicit discrepancy handling. It is the auditable
 * record the deal audit trail (H) and the issue flow (I) link to.
 */
'use strict';

const mongoose = require('mongoose');
const { VerificationId } = require('../utils/publicId');

const { Schema } = mongoose;

const QUALITY_FIELDS = {
  grade: { type: String, default: '' },                 // A / B / C
  moisturePct: { type: Number, default: null, min: 0, max: 100 },
  defectsPct: { type: Number, default: null, min: 0, max: 100 },
  foreignMatterPct: { type: Number, default: null, min: 0, max: 100 },
  notes: { type: String, default: '' },
};

// State enum — explicit so route code can be strict.
const DV_STATUS = [
  'VERIFICATION_PENDING',
  'VERIFIED',
  'DISCREPANCY_FOUND',
  'RESOLVED',
];

// 2% weight tolerance is the default threshold for auto-VERIFIED.
// Tunable in config (see routes/dealVerification.js).
const DEFAULT_WEIGHT_TOLERANCE_PCT = 2.0;

const DealVerificationSchema = new Schema(
  {
    // Human-readable publicId (`DV-...`). Surfaced in toRead() as
    // `public_id` so the API and the audit trail (Feature H) can
    // reference a verification record by a stable, log-friendly
    // string. The Mongo _id is still the canonical foreign key
    // for joins; the publicId is for humans and the verifier.
    publicId: {
      type: String,
      unique: true,
      index: true,
      required: true,
    },
    dealId: {
      type: Schema.Types.ObjectId,
      ref: 'Deal',
      required: true,
      unique: true,
      index: true,
    },
    // What the seller put on the table when the offer was accepted.
    declaredWeightKg: { type: Number, required: true, min: 0 },
    declaredQuality: { type: QUALITY_FIELDS, default: () => ({}) },
    // What the receiver actually measured / observed.
    actualWeightKg: { type: Number, default: null, min: 0 },
    verifiedQuality: { type: QUALITY_FIELDS, default: () => ({}) },
    // Who and when for the receiver side. publicId strings keep
    // the audit chain uniform with the rest of the API.
    verifiedBy: { type: String, default: '' },
    verifiedAt: { type: Date, default: null },
    // If a discrepancy was found, these describe what was off and
    // how the parties resolved it.
    discrepancyNotes: { type: String, default: '' },
    resolutionNotes: { type: String, default: '' },
    resolvedAt: { type: Date, default: null },
    resolution: {
      type: String,
      enum: [
        '',
        'ACCEPT_ACTUAL',
        'ACCEPT_DECLARED',
        'SPLIT',
        'CANCEL_DEAL',
      ],
      default: '',
    },
    // Computed at submit-time for the UI to render without doing
    // its own arithmetic.
    weightDeltaPct: { type: Number, default: null },
    qualityMatch: { type: Boolean, default: null },
    status: { type: String, enum: DV_STATUS, default: 'VERIFICATION_PENDING' },
  },
  { timestamps: true }
);

DealVerificationSchema.statics.STATUSES = DV_STATUS;
DealVerificationSchema.statics.DEFAULT_WEIGHT_TOLERANCE_PCT = DEFAULT_WEIGHT_TOLERANCE_PCT;

DealVerificationSchema.methods.toRead = function () {
  return {
    id: this._id,
    public_id: this.publicId,
    deal_id: this.dealId,
    declared_weight_kg: this.declaredWeightKg,
    declared_quality: this.declaredQuality,
    actual_weight_kg: this.actualWeightKg,
    verified_quality: this.verifiedQuality,
    verified_by: this.verifiedBy,
    verified_at: this.verifiedAt,
    discrepancy_notes: this.discrepancyNotes,
    resolution_notes: this.resolutionNotes,
    resolved_at: this.resolvedAt,
    resolution: this.resolution,
    weight_delta_pct: this.weightDeltaPct,
    quality_match: this.qualityMatch,
    status: this.status,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

module.exports = mongoose.model('DealVerification', DealVerificationSchema);
