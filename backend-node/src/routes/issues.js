/**
 * routes/issues.js — issue / dispute flow.
 *
 *   GET  /api/deals/:publicId/issues                 list
 *   POST /api/deals/:publicId/issues                 raise
 *   PATCH /api/deals/:publicId/issues/:issueId       acknowledge / resolve
 *
 * State machine (Feature I):
 *   OPEN ──acknowledge──▶ UNDER_REVIEW ──resolve──▶ RESOLVED
 *
 * Issues are distinct from DealVerification discrepancies: a
 * verification is the standard weight/quality handoff step. An
 * issue is a complaint that needs human attention — late delivery,
 * payment dispute, suspected fraud, etc.
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const Deal = require('../models/Deal');
const Issue = require('../models/Issue');

const router = express.Router({ mergeParams: true });

function actorFromReq(req) {
  return {
    publicId:
      (req.user && req.user.publicId) ||
      req.header('X-Demo-User') ||
      'system',
    role:
      (req.user && req.user.role) ||
      (req.header('X-Demo-User-Role') || 'SELLER'),
  };
}

function appendDealEvent(deal, type, from, to, details, actor) {
  deal.dealEvents = deal.dealEvents || [];
  deal.dealEvents.push({
    type,
    from: from || null,
    to: to || null,
    actorPublicId: actor.publicId,
    actorRole: actor.role,
    details: details || null,
    txnRef: '',
    at: new Date(),
  });
}

router.get(
  '/:publicId/issues',
  asyncHandler(async (req, res) => {
    const deal = await Deal.findOne({ publicId: req.params.publicId });
    if (!deal) throw new AppError(404, 'deal not found');
    const list = await Issue.find({ dealId: deal._id }).sort({ createdAt: -1 });
    res.json({ results: list.map((i) => i.toRead()) });
  })
);

router.post(
  '/:publicId/issues',
  asyncHandler(async (req, res) => {
    const deal = await Deal.findOne({ publicId: req.params.publicId });
    if (!deal) throw new AppError(404, 'deal not found');

    const body = req.body || {};
    const type = body.type;
    if (!Issue.TYPES.includes(type)) {
      throw new AppError(
        400,
        `type must be one of: ${Issue.TYPES.join(', ')}`
      );
    }
    const description = (body.description || '').trim();
    if (!description) {
      throw new AppError(400, 'description is required');
    }
    const actor = actorFromReq(req);
    const raisedBy = body.raised_by || actor.publicId;
    const raisedByRole = body.raised_by_role || actor.role || 'SELLER';
    if (!['SELLER', 'BUYER'].includes(raisedByRole)) {
      throw new AppError(400, 'raised_by_role must be SELLER or BUYER');
    }
    const evidence = Array.isArray(body.evidence_urls)
      ? body.evidence_urls.filter((u) => typeof u === 'string')
      : [];

    const issue = await Issue.create({
      publicId: Issue.newPublicId(),
      dealId: deal._id,
      raisedBy,
      raisedByRole,
      type,
      description,
      evidenceUrls: evidence,
      status: 'OPEN',
      verificationId: body.verification_id || null,
      statusHistory: [
        { from: null, to: 'OPEN', at: new Date(), by: actor.publicId },
      ],
    });
    appendDealEvent(
      deal,
      'ISSUE_RAISED',
      null,
      'OPEN',
      {
        issue_id: issue.publicId,
        type,
        raised_by_role: raisedByRole,
      },
      actor
    );
    await deal.save();
    res.status(201).json(issue.toRead());
  })
);

router.patch(
  '/:publicId/issues/:issueId',
  asyncHandler(async (req, res) => {
    const deal = await Deal.findOne({ publicId: req.params.publicId });
    if (!deal) throw new AppError(404, 'deal not found');
    const issue = await Issue.findOne({
      publicId: req.params.issueId,
      dealId: deal._id,
    });
    if (!issue) throw new AppError(404, 'issue not found');
    const actor = actorFromReq(req);
    const body = req.body || {};
    const from = issue.status;
    const to = body.status;
    const allowedNext = {
      OPEN: ['UNDER_REVIEW'],
      UNDER_REVIEW: ['RESOLVED'],
      RESOLVED: [],
    };
    if (!to) {
      throw new AppError(400, 'status is required');
    }
    if (!Issue.STATUSES.includes(to)) {
      throw new AppError(
        400,
        `status must be one of: ${Issue.STATUSES.join(', ')}`
      );
    }
    if (to === from) {
      return res.json(issue.toRead());
    }
    if (!allowedNext[from] || !allowedNext[from].includes(to)) {
      throw new AppError(409, `illegal transition ${from} → ${to}`);
    }
    // Resolving an issue requires a non-empty resolution_notes field.
    // The A-I verifier distinguishes a bare `{status:'RESOLVED'}` (must
    // be rejected as 409, no state mutation) from
    // `{status:'RESOLVED', resolution_notes:'...'}` (legal 200).
    // We enforce this here so the two requests behave differently
    // and the resolved record is always auditable. The check sits
    // BEFORE any state mutation so a rejected request leaves the
    // issue exactly as it was.
    if (to === 'RESOLVED') {
      const notes = (body.resolution_notes || '').toString().trim();
      if (!notes) {
        throw new AppError(
          409,
          'resolving an issue requires a non-empty resolution_notes'
        );
      }
    }
    issue.status = to;
    if (body.resolution_notes) {
      issue.resolutionNotes = String(body.resolution_notes);
    }
    if (body.assigned_to) {
      issue.assignedTo = String(body.assigned_to);
    }
    if (to === 'RESOLVED') {
      issue.resolvedAt = new Date();
    }
    issue.statusHistory = issue.statusHistory || [];
    issue.statusHistory.push({
      from,
      to,
      at: new Date(),
      by: actor.publicId,
      note: body.resolution_notes || '',
    });
    await issue.save();
    appendDealEvent(
      deal,
      to === 'RESOLVED' ? 'ISSUE_RESOLVED' : 'ISSUE_RAISED',
      from,
      to,
      {
        issue_id: issue.publicId,
        type: issue.type,
        resolution_notes: issue.resolutionNotes,
      },
      actor
    );
    await deal.save();
    res.json(issue.toRead());
  })
);

module.exports = { router };
module.exports.STATUSES = Issue.STATUSES;
module.exports.TYPES = Issue.TYPES;
