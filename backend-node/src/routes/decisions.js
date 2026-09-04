/**
 * routes/decisions.js — decision support endpoints.
 *
 *   GET  /api/decisions/:lotId              fetch (computes if missing)
 *   POST /api/decisions/:lotId/refresh      force recompute
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const CropLot = require('../models/CropLot');
const FarmerDecision = require('../models/FarmerDecision');
const { computeDecision } = require('../services/decisionSupport');

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
    let d = await FarmerDecision.findOne({ cropLotId: lot._id });
    if (!d) d = await computeDecision(lot);
    res.json(d.toRead());
  })
);

router.post(
  '/:lotId/refresh',
  asyncHandler(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    if (!lot) throw new AppError(404, 'crop lot not found');
    const d = await computeDecision(lot);
    res.json(d.toRead());
  })
);

module.exports = { router };
