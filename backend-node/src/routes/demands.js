/**
 * routes/demands.js — buyer demand (requirement) management +
 * rule-based lookup of demands relevant to a farmer's lots.
 *
 * These are ADDITIVE endpoints — the existing /api/buyers/* routes
 * are untouched. We re-use the Buyer model and its embedded
 * requirements array; no schema migration is required.
 *
 *   GET    /api/buyers/:publicId/requirements   list a buyer's demands
 *   POST   /api/buyers/:publicId/requirements   add a new demand
 *   DELETE /api/buyers/:publicId/requirements/:index  remove by index
 *   GET    /api/buyers/demands                  list all demands,
 *                                              optionally filtered by
 *                                              crop / state / location
 *   GET    /api/buyers/demands-for-lot/:publicId
 *                                              demands relevant to a
 *                                              specific crop lot
 *                                              (used by the Farmer
 *                                              dashboard)
 *
 * The new first-class Demand (RFQ) endpoints — used by the
 * farmer→offer flow — live in routes/demandsRfq.js and are mounted
 * at /api/demands.
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const Buyer = require('../models/Buyer');
const CropLot = require('../models/CropLot');

const router = express.Router();

// Helper: pull every requirement from every buyer and turn each into
// a flat "demand" object with the buyer publicId/name attached.
function flattenDemands(buyers) {
  const out = [];
  for (const b of buyers) {
    for (let i = 0; i < (b.requirements || []).length; i++) {
      const r = b.requirements[i];
      out.push({
        buyer_public_id: b.publicId,
        buyer_name: b.name,
        buyer_location: b.location || '',
        buyer_state: b.state || '',
        buyer_contact: b.contact || '',
        requirement_index: i,
        crop_name: r.cropName,
        crop_variety: r.cropVariety || '',
        min_quantity_kg: r.minQuantityKg,
        max_price_per_kg: r.maxPricePerKg,
        preferred_states: r.preferredStates || [],
        location: r.location || '',
        required_date: r.requiredDate || '',
        notes: r.notes || '',
        created_at: r.createdAt,
      });
    }
  }
  return out;
}

// GET /api/buyers/demands  — list demands, optional ?crop=&state=&location=
router.get(
  '/demands',
  asyncHandler(async (req, res) => {
    const buyers = await Buyer.find({}).sort({ createdAt: 1 });
    let demands = flattenDemands(buyers);
    if (req.query.crop) {
      const c = String(req.query.crop).toLowerCase();
      demands = demands.filter((d) => (d.crop_name || '').toLowerCase() === c);
    }
    if (req.query.state) {
      const s = String(req.query.state).toLowerCase();
      demands = demands.filter(
        (d) =>
          (d.buyer_state || '').toLowerCase() === s ||
          (d.preferred_states || []).some((ps) => (ps || '').toLowerCase() === s)
      );
    }
    if (req.query.location) {
      const loc = String(req.query.location).toLowerCase();
      demands = demands.filter(
        (d) =>
          (d.location || '').toLowerCase().includes(loc) ||
          (d.buyer_location || '').toLowerCase().includes(loc)
      );
    }
    res.json({ results: demands, count: demands.length });
  })
);

// GET /api/buyers/demands-for-lot/:publicId  — rule-based relevant
// demands for a specific crop lot. Same rule as /match but exposed at
// the "demands" level so the farmer dashboard can show "what buyers
// want from this lot" without needing a buyer match per-lot.
router.get(
  '/demands-for-lot/:publicId',
  asyncHandler(async (req, res) => {
    const lot = await CropLot.findOne({ publicId: req.params.publicId });
    if (!lot) throw new AppError(404, 'crop lot not found');

    const buyers = await Buyer.find({});
    const all = flattenDemands(buyers);
    const scored = [];
    for (const d of all) {
      let score = 0;
      const reasons = [];
      // crop match (case-insensitive)
      if (d.crop_name && lot.cropName && d.crop_name.toLowerCase() === lot.cropName.toLowerCase()) {
        score += 100;
        reasons.push(`wants ${d.crop_name}`);
        // variety bonus
        if (
          d.crop_variety &&
          lot.cropVariety &&
          d.crop_variety.toLowerCase() === lot.cropVariety.toLowerCase()
        ) {
          score += 20;
          reasons.push(`variety ${d.crop_variety} matches`);
        }
        // quantity compatibility — same rule as /match
        if (Number(d.min_quantity_kg) <= Number(lot.quantity || 0)) {
          score += 30;
          reasons.push(`needs ≥${d.min_quantity_kg}kg, you have ${lot.quantity}${lot.quantityUnit || 'kg'}`);
        } else {
          score += 10;
          reasons.push(`needs ≥${d.min_quantity_kg}kg (you have ${lot.quantity}${lot.quantityUnit || 'kg'})`);
        }
      } else {
        continue; // skip demands for a different crop
      }
      // state match
      if (
        (d.preferred_states || []).length > 0 &&
        lot.state &&
        d.preferred_states.map((s) => s.toLowerCase()).includes(lot.state.toLowerCase())
      ) {
        score += 20;
        reasons.push(`buys from ${lot.state}`);
      }
      if (d.buyer_state && lot.state && d.buyer_state.toLowerCase() === lot.state.toLowerCase()) {
        score += 10;
        reasons.push(`buyer is in ${lot.state}`);
      }
      // price compatibility
      if (
        d.max_price_per_kg &&
        lot.expectedPricePerKg &&
        d.max_price_per_kg >= lot.expectedPricePerKg
      ) {
        score += 10;
        reasons.push(`max ₹${d.max_price_per_kg}/kg ≥ expected ₹${lot.expectedPricePerKg}/kg`);
      }
      scored.push({ ...d, score, reasons });
    }
    scored.sort((a, b) => b.score - a.score);
    res.json({ results: scored, count: scored.length, crop_lot_id: lot.publicId });
  })
);

// List a specific buyer's requirements
router.get(
  '/:publicId/requirements',
  asyncHandler(async (req, res) => {
    const b = await Buyer.findOne({ publicId: req.params.publicId });
    if (!b) throw new AppError(404, 'buyer not found');
    res.json({ results: b.toRead().requirements });
  })
);

// Add a new requirement to a buyer
router.post(
  '/:publicId/requirements',
  asyncHandler(async (req, res) => {
    const b = await Buyer.findOne({ publicId: req.params.publicId });
    if (!b) throw new AppError(404, 'buyer not found');
    const body = req.body || {};
    if (!body.crop_name) throw new AppError(400, 'crop_name is required');
    if (body.min_quantity_kg == null) {
      throw new AppError(400, 'min_quantity_kg is required');
    }
    const minQty = Number(body.min_quantity_kg);
    if (!Number.isFinite(minQty) || minQty <= 0) {
      throw new AppError(400, 'min_quantity_kg must be > 0');
    }
    b.requirements.push({
      cropName: String(body.crop_name).trim(),
      cropVariety: body.crop_variety ? String(body.crop_variety).trim() : '',
      minQuantityKg: minQty,
      maxPricePerKg: body.max_price_per_kg != null ? Number(body.max_price_per_kg) : null,
      preferredStates: Array.isArray(body.preferred_states)
        ? body.preferred_states.map(String)
        : [],
      location: body.location ? String(body.location).trim() : '',
      requiredDate: body.required_date || '',
      notes: body.notes ? String(body.notes) : '',
      createdAt: new Date(),
    });
    await b.save();
    res.status(201).json(b.toRead());
  })
);

// Remove a requirement by index (best-effort; no soft-delete for prototype)
router.delete(
  '/:publicId/requirements/:index',
  asyncHandler(async (req, res) => {
    const b = await Buyer.findOne({ publicId: req.params.publicId });
    if (!b) throw new AppError(404, 'buyer not found');
    const idx = parseInt(req.params.index, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= b.requirements.length) {
      throw new AppError(404, 'requirement not found');
    }
    b.requirements.splice(idx, 1);
    await b.save();
    res.json(b.toRead());
  })
);

module.exports = { router };
