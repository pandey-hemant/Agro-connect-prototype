/**
 * routes/quality.js — quality endpoints.
 *
 *   GET  /api/quality/:lotId                 fetch (computes if missing)
 *   POST /api/quality/:lotId                 declare (FARMER_DECLARED)
 *   POST /api/quality/:lotId/verify          verify (BUYER_VERIFIED → VERIFIED_ACCEPTED or DISPUTED)
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const CropLot = require('../models/CropLot');
const QualityAssessment = require('../models/QualityAssessment');
const { QualityId } = require('../utils/publicId');

const router = express.Router();

async function getLot(lotId) {
  if (typeof lotId === 'string' && lotId.startsWith('CL-')) {
    return CropLot.findOne({ publicId: lotId });
  }
  if (require('mongoose').isValidObjectId(lotId)) {
    return CropLot.findById(lotId);
  }
  return null;
}

router.get(
  '/:lotId',
  asyncHandler(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    if (!lot) throw new AppError(404, 'crop lot not found');
    let qa = await QualityAssessment.findOne({ cropLotId: lot._id });
    if (!qa) {
      // create a default PENDING record (so the page has something)
      qa = await QualityAssessment.create({
        publicId: QualityId(),
        cropLotId: lot._id,
        status: 'FARMER_DECLARED',
        declaredGrade: lot.farmerQualityGrade || 'B',
        declaredBy: lot.sellerUserPublicId || '',
      });
    }
    res.json(qa.toRead());
  })
);

router.post(
  '/:lotId',
  asyncHandler(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    if (!lot) throw new AppError(404, 'crop lot not found');
    const {
      declared_grade,
      declared_notes,
      declared_by,
      grade,
      notes,
      size,
      appearance,
      moisture_pct,
      defects_pct,
    } = req.body || {};
    // Accept either the new flat shape (grade / notes / size / …) or
    // the original declared_* shape; the flat shape is what the
    // Quality.jsx page sends.
    const resolvedGrade = grade || declared_grade || lot.farmerQualityGrade || 'B';
    const resolvedNotes = notes ?? declared_notes ?? '';
    const qa = await QualityAssessment.findOneAndUpdate(
      { cropLotId: lot._id },
      {
        publicId: QualityId(),
        cropLotId: lot._id,
        declaredGrade: resolvedGrade,
        declaredNotes: resolvedNotes,
        declaredSize: size || '',
        declaredAppearance: appearance || '',
        declaredMoisturePct:
          moisture_pct === undefined || moisture_pct === null || moisture_pct === ''
            ? null
            : Number(moisture_pct),
        declaredDefectsPct:
          defects_pct === undefined || defects_pct === null || defects_pct === ''
            ? null
            : Number(defects_pct),
        status: 'FARMER_DECLARED',
        declaredBy: declared_by || lot.sellerUserPublicId || '',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(qa.toRead());
  })
);

router.post(
  '/:lotId/verify',
  asyncHandler(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    if (!lot) throw new AppError(404, 'crop lot not found');
    const {
      verified_grade,
      verified_notes,
      status,
      verified_by,
      grade,
      notes,
      defects_pct,
      actor,
    } = req.body || {};
    // Compute the resulting status when the caller hasn't set it
    // explicitly: matching (or no) override → VERIFIED_ACCEPTED,
    // different grade → DISPUTED. BUYER_VERIFIED is a transient
    // state we don't currently surface separately; we keep the
    // enum available for back-compat but write through to
    // VERIFIED_ACCEPTED.
    const resolvedGrade = grade || verified_grade || '';
    const resolvedNotes = notes ?? verified_notes ?? '';
    const current = await QualityAssessment.findOne({ cropLotId: lot._id });
    const declaredGrade = current?.declaredGrade || lot.farmerQualityGrade || 'B';
    let next;
    if (status && QualityAssessment.STATUSES.includes(status)) {
      next = status;
    } else if (resolvedGrade && resolvedGrade !== declaredGrade) {
      next = 'DISPUTED';
    } else {
      next = 'VERIFIED_ACCEPTED';
    }
    const qa = await QualityAssessment.findOneAndUpdate(
      { cropLotId: lot._id },
      {
        verifiedGrade: resolvedGrade,
        verifiedNotes: resolvedNotes,
        // Persist the buyer-side defects% onto the model too, but
        // only when the caller passed one explicitly.
        declaredDefectsPct:
          defects_pct === undefined || defects_pct === null || defects_pct === ''
            ? current?.declaredDefectsPct ?? null
            : Number(defects_pct),
        status: next,
        verifiedBy: verified_by || actor || '',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(qa.toRead());
  })
);

module.exports = { router };
