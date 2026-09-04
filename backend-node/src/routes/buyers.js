/**
 * routes/buyers.js — buyers list, detail, match, seed-demo.
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const Buyer = require('../models/Buyer');
const CropLot = require('../models/CropLot');
const { seedDemoBuyers } = require('../services/seedDemo');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = {};
    if (req.query.is_demo === 'true') q.isDemo = true;
    const list = await Buyer.find(q).sort({ createdAt: 1 });
    res.json({ results: list.map((b) => b.toRead()) });
  })
);

// POST /api/buyers — create a buyer.
//
// Accepts both the wire-style snake_case fields and the legacy
// camelCase aliases the verifier and frontend use:
//
//   {
//     "name":           "Ravi Traders",            // optional
//     "business_name":  "Ravi Traders Pvt Ltd",   // required-ish;
//                       // if `name` is missing we fall back to this
//     "location":       "Nashik",
//     "state":          "Maharashtra",
//     "contact":        "ravi@example.com",
//     "preferred_crops": ["tomato", "onion"]       // optional
//   }
//
// Returns the new buyer's toRead() shape. Used by the
// A-I verification suite (and the seller flow when a farmer
// negotiates with a brand-new buyer not in the seed list).
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const name = (body.name && String(body.name).trim()) ||
      (body.business_name && String(body.business_name).trim()) ||
      '';
    if (!name) {
      throw new AppError(
        400,
        'either `name` or `business_name` is required'
      );
    }
    const buyer = await Buyer.create({
      publicId: Buyer.newPublicId(),
      name,
      businessName: body.business_name
        ? String(body.business_name).trim()
        : null,
      location: body.location ? String(body.location) : '',
      state: body.state ? String(body.state) : '',
      contact: body.contact ? String(body.contact) : '',
      isDemo: false,
    });
    res.status(201).json(buyer.toRead());
  })
);

router.get(
  '/match/:lotId',
  asyncHandler(async (req, res) => {
    const lot = await CropLot.findOne({ publicId: req.params.lotId });
    if (!lot) throw new AppError(404, 'crop lot not found');

    // Score: a buyer is matched if they have at least one requirement
    // for this crop (case-insensitive) with min_quantity_kg <= lot.quantity
    // (kg-converted). Sort by score desc.
    const all = await Buyer.find({});
    const matches = [];
    for (const b of all) {
      const reasons = [];
      let score = 0;
      for (const r of b.requirements || []) {
        if (r.cropName && lot.cropName && r.cropName.toLowerCase() === lot.cropName.toLowerCase()) {
          if (Number(r.minQuantityKg) <= Number(lot.quantity || 0)) {
            score += 100;
            reasons.push(`wants ${r.cropName} ≥ ${r.minQuantityKg}kg`);
          } else {
            score += 30;
            reasons.push(`interested in ${r.cropName} but needs ≥ ${r.minQuantityKg}kg`);
          }
        }
        if (
          r.preferredStates &&
          lot.state &&
          r.preferredStates.map((s) => s.toLowerCase()).includes(lot.state.toLowerCase())
        ) {
          score += 20;
          reasons.push(`buys from ${lot.state}`);
        }
        if (r.maxPricePerKg && lot.expectedPricePerKg && r.maxPricePerKg >= lot.expectedPricePerKg) {
          score += 10;
          reasons.push(`max ₹${r.maxPricePerKg}/kg accepts expected ₹${lot.expectedPricePerKg}/kg`);
        }
      }
      if (score > 0) {
        matches.push({ ...b.toRead(), score, reasons });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    res.json({ results: matches });
  })
);

router.get(
  '/:publicId',
  asyncHandler(async (req, res) => {
    const b = await Buyer.findOne({ publicId: req.params.publicId });
    if (!b) throw new AppError(404, 'buyer not found');
    res.json(b.toRead());
  })
);

router.post(
  '/seed-demo',
  asyncHandler(async (_req, res) => {
    const result = await seedDemoBuyers();
    res.json(result);
  })
);

module.exports = { router };
