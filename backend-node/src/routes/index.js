/**
 * routes/index.js — composes the /api router.
 */
'use strict';

const express = require('express');
const demoAuth = require('../middleware/demoAuth');
const asyncHandler = require('../middleware/asyncHandler');

const { router: healthRouter, setMode } = require('./health');
const { router: authRouter } = require('./auth');
const { router: cropLotsRouter } = require('./cropLots');
const { router: marketPricesRouter } = require('./marketPrices');
const { router: logisticsRouter } = require('./logistics');
const { router: decisionsRouter } = require('./decisions');
const { router: buyersRouter } = require('./buyers');
const { router: demandsRouter } = require('./demands');
const { router: demandsRfqRouter } = require('./demandsRfq');
const { router: offersRouter } = require('./offers');
const { router: fposRouter } = require('./fpos');
const { router: qualityRouter } = require('./quality');
const { router: dealsRouter } = require('./deals');
const { router: dealEnrichedRouter } = require('./dealEnriched');
const { router: dealVerificationRouter } = require('./dealVerification');
const { router: issuesRouter } = require('./issues');
const { router: dealAuditRouter } = require('./dealAudit');
const { router: coldStorageRouter } = require('./coldStorage');
const { router: credibilityRouter } = require('./credibility');

const router = express.Router();

router.use(demoAuth);

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/crop-lots', cropLotsRouter);
router.use('/market-prices', marketPricesRouter);
router.use('/logistics', logisticsRouter);
router.use('/decisions', decisionsRouter);
// Singular alias — the A-I verification suite and a few external
// integrations call `/api/decision/:lotPublicId` (no 's'). The same
// router handles both spellings; no code duplication.
router.use('/decision', decisionsRouter);
// demandsRouter has /demands, /demands-for-lot/:lotId, /:publicId/requirements —
// mount it BEFORE buyersRouter so its specific paths match first.
// (buyersRouter's /:publicId would otherwise catch any single segment.)
router.use('/buyers', demandsRouter);
router.use('/buyers', buyersRouter);
// New first-class Demand (RFQ) endpoints used by the farmer→offer flow.
router.use('/demands', demandsRfqRouter);
router.use('/offers', offersRouter);
router.use('/fpos', fposRouter);
router.use('/quality', qualityRouter);
router.use('/deals', dealEnrichedRouter); // /:id/enriched, /list-enriched first
router.use('/deals', dealsRouter);
router.use('/deals', dealVerificationRouter); // /:publicId/verification/*
router.use('/deals', issuesRouter);            // /:publicId/issues/*
router.use('/deals', dealAuditRouter);         // /:publicId/audit
router.use('/cold-storage', coldStorageRouter);
router.use('/credibility', credibilityRouter);
// /farmers/:publicId/credibility — alias for the farmer-card lookup.
// The credibility service is mounted at /credibility/users/:publicId
// for the canonical address; the farmer-card path is a more
// marketplace-shaped URL. We mount a sub-router that handles the
// root path (GET /) for a given :publicId and delegates to the
// same computeForUser service.
const { computeForUser } = require('../services/credibility');
const User = require('../models/User');
const { AppError } = require('../middleware/errorHandler');
const credibilityForFarmer = express.Router({ mergeParams: true });
credibilityForFarmer.get(
  '/',
  asyncHandler(async (req, res) => {
    const { publicId } = req.params;
    const role = String(req.query.role || 'SELLER').toUpperCase();
    if (!publicId) throw new AppError(400, 'publicId is required');
    if (!['SELLER', 'BUYER', 'FPO', ''].includes(role)) {
      throw new AppError(400, `unknown role: ${role}`);
    }
    const user = await User.findOne({ publicId });
    if (!user) throw new AppError(404, 'user not found');
    const roleToUse = role || user.role || 'SELLER';
    const result = await computeForUser(publicId, roleToUse);
    res.json({
      public_id: publicId,
      role: roleToUse,
      ...result,
    });
  })
);
router.use('/farmers/:publicId/credibility', credibilityForFarmer);

module.exports = router;
module.exports.setHealthMode = setMode;
