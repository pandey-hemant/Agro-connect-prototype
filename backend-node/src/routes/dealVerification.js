/**
 * routes/dealVerification.js — deal-level weight + quality verification.
 *
 *   POST  /api/deals/:publicId/verification       start (creates record)
 *   PATCH /api/deals/:publicId/verification       submit actuals (verify)
 *   PATCH /api/deals/:publicId/verification/resolve
 *                                                  resolve a discrepancy
 *   GET   /api/deals/:publicId/verification       fetch (status check)
 *
 * State machine (Feature B):
 *   VERIFICATION_PENDING → VERIFIED            (no discrepancy)
 *   VERIFICATION_PENDING → DISCREPANCY_FOUND   (weight > ±tolerance or
 *                                              grade mismatch)
 *   DISCREPANCY_FOUND   → RESOLVED             (parties accept one side
 *                                              or split the difference)
 *
 * Appends to Deal.dealEvents so the audit trail (Feature H) records
 * the verification start, completion, and resolution.
 */
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const Deal = require('../models/Deal');
const DealVerification = require('../models/DealVerification');
const { VerificationId } = require('../utils/publicId');
const config = require('../config');

const router = express.Router({ mergeParams: true });

const DV_STATUS = DealVerification.STATUSES;

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

function appendDealEvent(deal, type, from, to, details, txnRef, actor) {
  deal.dealEvents = deal.dealEvents || [];
  deal.dealEvents.push({
    type,
    from: from || null,
    to: to || null,
    actorPublicId: actor.publicId,
    actorRole: actor.role,
    details: details || null,
    txnRef: txnRef || '',
    at: new Date(),
  });
}

function parseQualityBlock(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  if (obj.grade != null) out.grade = String(obj.grade);
  if (obj.moisturePct != null) out.moisturePct = Number(obj.moisturePct);
  if (obj.defectsPct != null) out.defectsPct = Number(obj.defectsPct);
  if (obj.foreignMatterPct != null) {
    out.foreignMatterPct = Number(obj.foreignMatterPct);
  }
  if (obj.notes != null) out.notes = String(obj.notes);
  return out;
}

function computeWeightDelta(declared, actual) {
  if (!declared || !actual) return null;
  return Math.round(((actual - declared) / declared) * 10000) / 100;
}

function isQualityMatch(declared, verified) {
  if (!declared || !verified) return null;
  if (declared.grade && verified.grade && declared.grade !== verified.grade) {
    return false;
  }
  return true;
}

router.post(
  '/:publicId/verification',
  asyncHandler(async (req, res) => {
    const deal = await Deal.findOne({ publicId: req.params.publicId });
    if (!deal) throw new AppError(404, 'deal not found');

    // Idempotent: if a record already exists, return it.
    let dv = await DealVerification.findOne({ dealId: deal._id });
    if (dv) {
      // Backfill: if the record was created before publicId was a
      // required field (e.g. on a database that pre-dates the
      // DV-... id migration), assign one and save so the API
      // surface stays uniform. This is a no-op for fresh records.
      if (!dv.publicId) {
        dv.publicId = VerificationId();
        await dv.save();
      }
      return res.status(200).json(dv.toRead());
    }

    const actor = actorFromReq(req);
    const declaredQuality = parseQualityBlock(req.body?.declared_quality);
    dv = await DealVerification.create({
      publicId: VerificationId(),
      dealId: deal._id,
      declaredWeightKg: Number(req.body?.declared_weight_kg || deal.agreedQuantity || 0),
      declaredQuality: {
        grade:
          declaredQuality.grade ||
          req.body?.declared_grade ||
          '',
        moisturePct: declaredQuality.moisturePct != null ? declaredQuality.moisturePct : null,
        defectsPct: declaredQuality.defectsPct != null ? declaredQuality.defectsPct : null,
        foreignMatterPct:
          declaredQuality.foreignMatterPct != null ? declaredQuality.foreignMatterPct : null,
        notes: declaredQuality.notes || req.body?.declared_notes || '',
      },
      status: 'VERIFICATION_PENDING',
    });
    deal.verificationId = dv._id;
    appendDealEvent(
      deal,
      'VERIFICATION_STARTED',
      null,
      'VERIFICATION_PENDING',
      {
        declared_weight_kg: dv.declaredWeightKg,
      },
      '',
      actor
    );
    await deal.save();
    res.status(201).json(dv.toRead());
  })
);

router.patch(
  '/:publicId/verification',
  asyncHandler(async (req, res) => {
    const deal = await Deal.findOne({ publicId: req.params.publicId });
    if (!deal) throw new AppError(404, 'deal not found');
    const dv = await DealVerification.findOne({ dealId: deal._id });
    if (!dv) {
      throw new AppError(
        404,
        'no verification record — POST /verification first'
      );
    }
    if (dv.status === 'RESOLVED') {
      throw new AppError(409, 'verification is already RESOLVED');
    }
    const actor = actorFromReq(req);
    const body = req.body || {};
    if (body.actual_weight_kg != null) {
      dv.actualWeightKg = Number(body.actual_weight_kg);
    }
    const verifiedQuality = parseQualityBlock(body.verified_quality);
    if (Object.keys(verifiedQuality).length) {
      dv.verifiedQuality = {
        ...(dv.verifiedQuality || {}),
        ...verifiedQuality,
      };
    }
    if (body.verified_by) dv.verifiedBy = String(body.verified_by);
    if (actor.publicId && !dv.verifiedBy) dv.verifiedBy = actor.publicId;
    dv.verifiedAt = new Date();

    // Compute deltas
    const declaredWeight = Number(dv.declaredWeightKg || 0);
    const actualWeight = Number(dv.actualWeightKg || 0);
    const delta = computeWeightDelta(declaredWeight, actualWeight);
    dv.weightDeltaPct = delta;
    const tolerance = config.weight_tolerance_pct;
    const withinTolerance =
      delta != null && Math.abs(delta) <= tolerance;
    const qMatch = isQualityMatch(
      dv.declaredQuality,
      dv.verifiedQuality
    );
    dv.qualityMatch = qMatch;

    if (withinTolerance && (qMatch === null || qMatch === true)) {
      dv.status = 'VERIFIED';
    } else {
      dv.status = 'DISCREPANCY_FOUND';
      if (body.discrepancy_notes) {
        dv.discrepancyNotes = String(body.discrepancy_notes);
      } else {
        // Auto-populate discrepancy notes from the deltas so the
        // parties know what was off.
        const parts = [];
        if (delta != null && Math.abs(delta) > tolerance) {
          parts.push(
            `Weight ${actualWeight} kg vs declared ${declaredWeight} kg (${delta}% delta, tolerance ±${tolerance}%).`
          );
        }
        if (qMatch === false) {
          parts.push(
            `Quality grade mismatch: declared ${dv.declaredQuality?.grade || '—'} vs verified ${dv.verifiedQuality?.grade || '—'}.`
          );
        }
        dv.discrepancyNotes = parts.join(' ');
      }
    }

    await dv.save();
    appendDealEvent(
      deal,
      'VERIFICATION_COMPLETED',
      'VERIFICATION_PENDING',
      dv.status,
      {
        actual_weight_kg: actualWeight,
        weight_delta_pct: delta,
        quality_match: qMatch,
        tolerance_pct: tolerance,
      },
      '',
      actor
    );
    await deal.save();
    res.json(dv.toRead());
  })
);

router.patch(
  '/:publicId/verification/resolve',
  asyncHandler(async (req, res) => {
    const deal = await Deal.findOne({ publicId: req.params.publicId });
    if (!deal) throw new AppError(404, 'deal not found');
    const dv = await DealVerification.findOne({ dealId: deal._id });
    if (!dv) throw new AppError(404, 'no verification record');
    // Validate the resolution NAME first so an unknown name always
    // returns 400 regardless of the verification's current state.
    // A valid name from the wrong state still returns 409. This
    // order matches the contract the A-I verifier expects: a bad
    // resolution string is a 400, not a 409.
    const resolution = req.body?.resolution;
    const allowed = [
      'ACCEPT_ACTUAL',
      'ACCEPT_DECLARED',
      'SPLIT',
      'CANCEL_DEAL',
    ];
    if (!allowed.includes(resolution)) {
      throw new AppError(
        400,
        `resolution must be one of: ${allowed.join(', ')}`
      );
    }
    if (dv.status !== 'DISCREPANCY_FOUND') {
      throw new AppError(
        409,
        'resolution is only valid from DISCREPANCY_FOUND'
      );
    }
    const actor = actorFromReq(req);
    dv.resolution = resolution;
    dv.resolutionNotes = req.body?.resolution_notes || '';
    dv.resolvedAt = new Date();
    dv.status = 'RESOLVED';
    await dv.save();
    appendDealEvent(
      deal,
      'VERIFICATION_RESOLVED',
      'DISCREPANCY_FOUND',
      'RESOLVED',
      { resolution, resolution_notes: dv.resolutionNotes },
      '',
      actor
    );
    await deal.save();
    res.json(dv.toRead());
  })
);

router.get(
  '/:publicId/verification',
  asyncHandler(async (req, res) => {
    const deal = await Deal.findOne({ publicId: req.params.publicId });
    if (!deal) throw new AppError(404, 'deal not found');
    const dv = await DealVerification.findOne({ dealId: deal._id });
    if (!dv) {
      return res
        .status(404)
        .json({ detail: 'no verification record yet' });
    }
    res.json(dv.toRead());
  })
);

// Surface the constant so the verifier / tests can check it without
// importing the model directly.
router.locals = router.locals || {};
router.locals.STATUSES = DV_STATUS;
router.locals.TOLERANCE = config.weight_tolerance_pct;

module.exports = { router };
// Re-export for tests / verifiers.
module.exports.STATUSES = DV_STATUS;
module.exports.TOLERANCE = config.weight_tolerance_pct;
module.exports.computeWeightDelta = computeWeightDelta;
