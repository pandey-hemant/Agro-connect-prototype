/**
 * models/QualityAssessment.js — quality declaration / verification.
 *
 * State machine:
 *   PENDING (none yet) ──declare──▶ FARMER_DECLARED
 *   FARMER_DECLARED ──verify──▶ VERIFIED_ACCEPTED
 *                          ╰─verify(dispute)──▶ DISPUTED
 */
'use strict';

const mongoose = require('mongoose');
const { QualityId } = require('../utils/publicId');

const { Schema } = mongoose;

const QA_STATUS = ['FARMER_DECLARED', 'BUYER_VERIFIED', 'VERIFIED_ACCEPTED', 'DISPUTED'];

const QualityAssessmentSchema = new Schema(
  {
    publicId: { type: String, unique: true, index: true, required: true },
    cropLotId: { type: Schema.Types.ObjectId, ref: 'CropLot', required: true, index: true },
    declaredGrade: { type: String, default: '' }, // A / B / C
    declaredNotes: { type: String, default: '' },
    verifiedGrade: { type: String, default: '' },
    verifiedNotes: { type: String, default: '' },
    // Optional declared attributes (preserved on the wire so the
    // Quality.jsx page can show them; the declare endpoint also
    // accepts them. They are not part of the verification state
    // machine — only the grade and the status drive transitions.
    declaredSize: { type: String, default: '' },
    declaredAppearance: { type: String, default: '' },
    declaredMoisturePct: { type: Number, default: null },
    declaredDefectsPct: { type: Number, default: null },
    status: { type: String, enum: QA_STATUS, default: 'FARMER_DECLARED' },
    declaredBy: { type: String, default: '' }, // user publicId
    verifiedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

QualityAssessmentSchema.statics.newPublicId = QualityId;
QualityAssessmentSchema.statics.STATUSES = QA_STATUS;

QualityAssessmentSchema.methods.toRead = function () {
  return {
    id: this._id,
    public_id: this.publicId,
    crop_lot_id: this.cropLotId,
    declared_grade: this.declaredGrade,
    declared_notes: this.declaredNotes,
    // Optional attributes surfaced for the Quality.jsx page.
    size: this.declaredSize,
    appearance: this.declaredAppearance,
    moisture_pct: this.declaredMoisturePct,
    defects_pct: this.declaredDefectsPct,
    verified_grade: this.verifiedGrade,
    verified_notes: this.verifiedNotes,
    // Frontend uses `quality_status`; keep `status` for back-compat.
    status: this.status,
    quality_status: this.status,
    declared_by: this.declaredBy,
    verified_by: this.verifiedBy,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

module.exports = mongoose.model('QualityAssessment', QualityAssessmentSchema);
