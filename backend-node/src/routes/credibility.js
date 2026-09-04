/**
 * routes/credibility.js — read-only deterministic credibility score.
 *
 *   GET /api/credibility/users/:publicId?role=SELLER|BUYER|FPO
 *
 * The response shape is documented in services/credibility.js. The
 * endpoint is idempotent and read-only; it never mutates any
 * document. No authentication beyond demoAuth is required — the
 * score is computed from public platform data (completed deals,
 * active listings, profile fields) and the publicId is sufficient
 * to address the subject.
 *
 * Why a separate route? The score needs to be addressable by user
 * publicId without a deal context. The farmer-card endpoint on
 * crop-lots is for the marketplace view; this is for general
 * profile pages and dashboards.
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const User = require('../models/User');
const { computeForUser } = require('../services/credibility');

const router = express.Router();

router.get(
  '/users/:publicId',
  asyncHandler(async (req, res) => {
    const { publicId } = req.params;
    const role = String(req.query.role || '').toUpperCase();
    if (!publicId) throw new AppError(400, 'publicId is required');
    if (!['SELLER', 'BUYER', 'FPO', ''].includes(role)) {
      throw new AppError(400, `unknown role: ${role}`);
    }
    const user = await User.findOne({ publicId });
    if (!user) {
      // 404 lets the frontend distinguish "no such user" from
      // "user exists but no history". The /users route on auth
      // is the canonical lookup; this is just a sanity check.
      throw new AppError(404, 'user not found');
    }
    const roleToUse = role || user.role || 'SELLER';
    const result = await computeForUser(publicId, roleToUse);
    res.json({
      public_id: publicId,
      role: roleToUse,
      ...result,
    });
  })
);

module.exports = { router };
