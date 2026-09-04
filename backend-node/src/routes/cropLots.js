/**
 * routes/cropLots.js — seller creates a lot, buyer browses.
 *
 *   POST /api/crop-lots                       create
 *   GET  /api/crop-lots                       list (filters: status, crop, state, owner)
 *   GET  /api/crop-lots/available             ACTIVE lots for marketplace
 *   GET  /api/crop-lots/:public_id            detail
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const CropLot = require('../models/CropLot');
const { farmerCardForLot } = require('../services/credibility');

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.crop_name) throw new AppError(400, 'crop_name is required');
    if (b.quantity == null) throw new AppError(400, 'quantity is required');
    if (!b.quantity_unit) b.quantity_unit = 'kg';

    const lot = await CropLot.create({
      publicId: CropLot.newPublicId(),
      cropName: b.crop_name,
      cropVariety: b.crop_variety || '',
      quantity: Number(b.quantity),
      quantityUnit: b.quantity_unit,
      harvestDate: b.harvest_date || '',
      location: b.location || '',
      lat: b.lat != null ? Number(b.lat) : null,
      lon: b.lon != null ? Number(b.lon) : null,
      state: b.state || '',
      farmerQualityGrade: b.farmer_quality_grade || '',
      expectedPricePerKg:
        b.expected_price_per_kg != null ? Number(b.expected_price_per_kg) : null,
      minimumAcceptablePrice:
        b.minimum_acceptable_price != null ? Number(b.minimum_acceptable_price) : null,
      status: 'ACTIVE',
      sellerUserPublicId: b.seller_user_public_id || (req.user && req.user.publicId) || '',
      notes: b.notes || '',
      coldStorageRequired: !!b.cold_storage_required,
      coldStorageDurationDays:
        b.cold_storage_duration_days != null ? Number(b.cold_storage_duration_days) : 0,
      coldStorageRatePerKgPerDay:
        b.cold_storage_rate_per_kg_per_day != null
          ? Number(b.cold_storage_rate_per_kg_per_day)
          : 0.20,
    });
    res.status(201).json(lot.toRead());
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = {};
    if (req.query.status) q.status = String(req.query.status);
    if (req.query.crop) q.cropName = new RegExp(`^${String(req.query.crop)}$`, 'i');
    if (req.query.state) q.state = new RegExp(`^${String(req.query.state)}$`, 'i');
    if (req.query.owner) q.sellerUserPublicId = String(req.query.owner);
    const list = await CropLot.find(q).sort({ createdAt: -1 });
    res.json({ results: list.map((l) => l.toRead()) });
  })
);

router.get(
  '/available',
  asyncHandler(async (req, res) => {
    const q = { status: 'ACTIVE' };
    if (req.query.crop) q.cropName = new RegExp(`^${String(req.query.crop)}$`, 'i');
    if (req.query.state) q.state = new RegExp(`^${String(req.query.state)}$`, 'i');
    const list = await CropLot.find(q).sort({ createdAt: -1 });
    res.json({ results: list.map((l) => l.toRead()) });
  })
);

router.get(
  '/:public_id',
  asyncHandler(async (req, res) => {
    const lot = await CropLot.findOne({ publicId: req.params.public_id });
    if (!lot) throw new AppError(404, 'crop lot not found');
    res.json(lot.toRead());
  })
);

// GET /api/crop-lots/:public_id/farmer-card
//   Public-facing farmer info (name, location, state, credibility)
//   for the marketplace. Excludes phone, email, and any other
//   sensitive contact data.
router.get(
  '/:public_id/farmer-card',
  asyncHandler(async (req, res) => {
    const lot = await CropLot.findOne({ publicId: req.params.public_id });
    if (!lot) throw new AppError(404, 'crop lot not found');
    const card = await farmerCardForLot(lot);
    if (!card.available) {
      // The lot exists but we have no farmer info. Return 200 with
      // available:false so the UI can render a graceful empty state
      // instead of a hard error.
      res.json({ available: false, reason: card.reason });
      return;
    }
    res.json(card);
  })
);

// PATCH /api/crop-lots/:public_id — update cold-storage settings (and other
// mutable fields like minimum_acceptable_price, notes). Status is NOT
// editable here; transitions go through the offer accept flow.
router.patch(
  '/:public_id',
  asyncHandler(async (req, res) => {
    const lot = await CropLot.findOne({ publicId: req.params.public_id });
    if (!lot) throw new AppError(404, 'crop lot not found');
    const b = req.body || {};
    if (b.cold_storage_required != null) lot.coldStorageRequired = !!b.cold_storage_required;
    if (b.cold_storage_duration_days != null) {
      lot.coldStorageDurationDays = Number(b.cold_storage_duration_days);
    }
    if (b.cold_storage_rate_per_kg_per_day != null) {
      lot.coldStorageRatePerKgPerDay = Number(b.cold_storage_rate_per_kg_per_day);
    }
    if (b.minimum_acceptable_price != null) {
      lot.minimumAcceptablePrice = Number(b.minimum_acceptable_price);
    }
    if (b.expected_price_per_kg != null) {
      lot.expectedPricePerKg = Number(b.expected_price_per_kg);
    }
    if (b.notes != null) lot.notes = String(b.notes);
    await lot.save();
    res.json(lot.toRead());
  })
);

module.exports = { router };
