/**
 * models/Issue.js — buyer/seller-raised issues against a deal.
 *
 * State machine (Feature I):
 *   OPEN ──acknowledge──▶ UNDER_REVIEW ──resolve──▶ RESOLVED
 *
 * Issues are distinct from DealVerification discrepancies: a
 * verification is the standard weight/quality handoff step. An
 * issue is a complaint — late delivery, payment dispute,
 * suspected fraud, anything that needs human attention. Both can
 * exist on the same deal.
 */
'use strict';

const mongoose = require('mongoose');
const { IssueId } = require('../utils/publicId');

const { Schema } = mongoose;

const ISSUE_STATUS = ['OPEN', 'UNDER_REVIEW', 'RESOLVED'];
const ISSUE_TYPE = ['QUALITY', 'WEIGHT', 'PAYMENT', 'DELIVERY', 'OTHER'];

const IssueSchema = new Schema(
  {
    publicId: { type: String, unique: true, index: true, required: true },
    dealId: { type: Schema.Types.ObjectId, ref: 'Deal', required: true, index: true },
    // Both sides can raise. We capture the publicId of the raiser.
    raisedBy: { type: String, required: true, index: true },
    raisedByRole: { type: String, enum: ['SELLER', 'BUYER'], required: true },
    type: { type: String, enum: ISSUE_TYPE, required: true },
    description: { type: String, required: true },
    evidenceUrls: { type: [String], default: [] },
    // Optional linkage back to the deal verification record if the
    // issue was raised during the verify step.
    verificationId: {
      type: Schema.Types.ObjectId,
      ref: 'DealVerification',
      default: null,
    },
    status: { type: String, enum: ISSUE_STATUS, default: 'OPEN' },
    assignedTo: { type: String, default: '' },
    resolutionNotes: { type: String, default: '' },
    resolvedAt: { type: Date, default: null },
    // Append-only trail of status changes for the audit log.
    statusHistory: {
      type: [
        new Schema(
          {
            from: { type: String, default: null },
            to: { type: String, required: true },
            at: { type: Date, default: Date.now },
            by: { type: String, default: '' },
            note: { type: String, default: '' },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

IssueSchema.statics.newPublicId = IssueId;
IssueSchema.statics.STATUSES = ISSUE_STATUS;
IssueSchema.statics.TYPES = ISSUE_TYPE;

IssueSchema.methods.toRead = function () {
  return {
    id: this._id,
    public_id: this.publicId,
    deal_id: this.dealId,
    raised_by: this.raisedBy,
    raised_by_role: this.raisedByRole,
    type: this.type,
    description: this.description,
    evidence_urls: this.evidenceUrls,
    verification_id: this.verificationId,
    status: this.status,
    assigned_to: this.assignedTo,
    resolution_notes: this.resolutionNotes,
    resolved_at: this.resolvedAt,
    status_history: (this.statusHistory || []).map((h) => ({
      from: h.from,
      to: h.to,
      at: h.at,
      by: h.by,
    })),
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

module.exports = mongoose.model('Issue', IssueSchema);
