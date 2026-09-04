/**
 * routes/demandsRfq.js — first-class Demand (RFQ) endpoints, mounted
 * at /api/demands. This is the addressable demand surface the new
 * farmer→offer flow uses.
 *
 *   GET    /api/demands                        list demands (filters)
 *   GET    /api/demands/:publicId              one demand
 *   POST   /api/demands                        create demand (BUYER)
 *   PATCH  /api/demands/:publicId              update demand (status)
 *   GET    /api/demands/:publicId/offers       list offers on demand
 *   POST   /api/demands/:publicId/offers       farmer creates offer
 *   GET    /api/demands/by-buyer/:publicId     list demands for buyer
 *
 * The new endpoints are co-located in their own router to keep the
 * legacy /api/buyers/* requirements subdoc endpoints untouched. The
 * mount order in routes/index.js is:
 *   app.use('/buyers',  demandsLegacyRouter)  // subdoc-array path
 *   app.use('/demands', demandsRfqRouter)     // first-class path
 *
 * Authorization: middleware in routes/index.js (demoAuth) populates
 * req.user from the X-Demo-User header. Routes that mutate read
 * req.user.role and req.user.publicId to enforce ownership.
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const mongoose = require('mongoose');
const Buyer = require('../models/Buyer');
const Demand = require('../models/Demand');
const Offer = require('../models/Offer');
const CropLot = require('../models/CropLot');
const { createDemandOffer } = require('../services/offerService');

const router = express.Router();

/**
 * Resolve a buyer from either a `B-...` publicId or a Mongo ObjectId.
 */
async function resolveBuyer(idOrPublic) {
  if (!idOrPublic) return null;
  if (typeof idOrPublic === 'string' && idOrPublic.startsWith('B-')) {
    return Buyer.findOne({ publicId: idOrPublic });
  }
  if (mongoose.isValidObjectId(idOrPublic)) {
    return Buyer.findById(idOrPublic);
  }
  return null;
}

/**
 * For the current user, find the buyer to use. Order of preference:
 *   1) body.buyer_public_id (explicit)
 *   2) req.user.activeBuyerId (seeded link from auth)
 *   3) the user's role==='BUYER' and the matching B-... publicId
 *      is inferable from the email prefix (last resort)
 */
async function resolveBuyerForRequest(req, body) {
  if (body && body.buyer_public_id) {
    const b = await Buyer.findOne({ publicId: body.buyer_public_id });
    if (b) return b;
  }
  if (req.user && req.user.activeBuyerId != null) {
    if (mongoose.isValidObjectId(req.user.activeBuyerId)) {
      const b = await Buyer.findById(req.user.activeBuyerId);
      if (b) return b;
    }
  }
  return null;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = {};
    if (req.query.status) q.status = String(req.query.status);
    if (req.query.crop) {
      q.cropName = new RegExp(`^${String(req.query.crop).trim()}$`, 'i');
    }
    if (req.query.state) {
      q.state = new RegExp(`^${String(req.query.state).trim()}$`, 'i');
    }
    if (req.query.location) {
      const loc = String(req.query.location).trim();
      q.$or = [
        { location: new RegExp(loc, 'i') },
        { state: new RegExp(loc, 'i') },
      ];
    }
    if (req.query.buyer_public_id) {
      q.buyerPublicId = String(req.query.buyer_public_id);
    }
    if (req.query.buyer_id) {
      const buyer = await resolveBuyer(req.query.buyer_id);
      if (buyer) q.buyerId = buyer._id;
    }
    const list = await Demand.find(q).sort({ createdAt: -1 });
    res.json({ results: list.map((d) => d.toRead()), count: list.length });
  })
);

router.get(
  '/by-buyer/:publicId',
  asyncHandler(async (req, res) => {
    const buyer = await resolveBuyer(req.params.publicId);
    if (!buyer) throw new AppError(404, 'buyer not found');
    const list = await Demand.find({ buyerId: buyer._id }).sort({ createdAt: -1 });
    res.json({
      results: list.map((d) => d.toRead()),
      count: list.length,
      buyer_public_id: buyer.publicId,
    });
  })
);

router.get(
  '/:publicId',
  asyncHandler(async (req, res) => {
    const d = await Demand.findOne({ publicId: req.params.publicId });
    if (!d) throw new AppError(404, 'demand not found');
    res.json(d.toRead());
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    // Only a BUYER (the demand creator) or an ADMIN may create a demand.
    if (req.user && req.user.role && !['BUYER', 'ADMIN'].includes(req.user.role)) {
      throw new AppError(403, 'only BUYER (or ADMIN) may create a demand');
    }
    const body = req.body || {};
    if (!body.crop_name) throw new AppError(400, 'crop_name is required');
    if (body.quantity_kg == null) {
      throw new AppError(400, 'quantity_kg is required');
    }
    const qty = Number(body.quantity_kg);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new AppError(400, 'quantity_kg must be > 0');
    }
    let maxPrice = null;
    if (body.max_price_per_kg != null && body.max_price_per_kg !== '') {
      maxPrice = Number(body.max_price_per_kg);
      if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
        throw new AppError(400, 'max_price_per_kg must be > 0');
      }
    }

    const buyer = await resolveBuyerForRequest(req, body);
    if (!buyer) {
      throw new AppError(
        400,
        'buyer_public_id is required (or the current user must have an activeBuyerId)'
      );
    }

    const createdByUserPublicId =
      req.user && req.user.publicId ? req.user.publicId : null;

    const demand = await Demand.create({
      publicId: Demand.newPublicId(),
      buyerId: buyer._id,
      buyerPublicId: buyer.publicId,
      createdByUserPublicId,
      cropName: String(body.crop_name).trim(),
      cropVariety: body.crop_variety ? String(body.crop_variety).trim() : '',
      quantityKg: qty,
      maxPricePerKg: maxPrice,
      location: body.location
        ? String(body.location).trim()
        : buyer.location || '',
      state: body.state ? String(body.state).trim() : buyer.state || '',
      requiredDate: body.required_date || '',
      notes: body.notes ? String(body.notes) : '',
      status: 'ACTIVE',
    });
    res.status(201).json(demand.toRead());
  })
);

router.patch(
  '/:publicId',
  asyncHandler(async (req, res) => {
    const d = await Demand.findOne({ publicId: req.params.publicId });
    if (!d) throw new AppError(404, 'demand not found');

    // Authorization
    if (req.user && req.user.role && !['BUYER', 'ADMIN'].includes(req.user.role)) {
      throw new AppError(403, 'only the buyer (or admin) may update a demand');
    }
    if (
      req.user &&
      req.user.role === 'BUYER' &&
      d.createdByUserPublicId &&
      req.user.publicId &&
      d.createdByUserPublicId !== req.user.publicId
    ) {
      throw new AppError(403, 'only the demand creator may update it');
    }

    const body = req.body || {};
    if (body.status) {
      if (!['ACTIVE', 'CLOSED', 'FULFILLED'].includes(body.status)) {
        throw new AppError(400, 'invalid status');
      }
      d.status = body.status;
    }
    if (body.notes != null) d.notes = String(body.notes);
    if (body.location != null) d.location = String(body.location);
    if (body.state != null) d.state = String(body.state);
    if (body.required_date != null) d.requiredDate = String(body.required_date);
    if (body.max_price_per_kg != null && body.max_price_per_kg !== '') {
      const mp = Number(body.max_price_per_kg);
      if (Number.isFinite(mp) && mp > 0) d.maxPricePerKg = mp;
    }
    await d.save();
    res.json(d.toRead());
  })
);

router.get(
  '/:publicId/offers',
  asyncHandler(async (req, res) => {
    const d = await Demand.findOne({ publicId: req.params.publicId });
    if (!d) throw new AppError(404, 'demand not found');
    const offers = await Offer.find({ demandId: d._id }).sort({ createdAt: -1 });
    const results = await Promise.all(offers.map((o) => o.toReadWithRefs()));
    res.json({
      results,
      count: offers.length,
      demand_id: d.publicId,
    });
  })
);

router.post(
  '/:publicId/offers',
  asyncHandler(async (req, res) => {
    const d = await Demand.findOne({ publicId: req.params.publicId });
    if (!d) throw new AppError(404, 'demand not found');
    if (d.status !== 'ACTIVE') {
      throw new AppError(409, `demand is ${d.status}, not ACTIVE`);
    }
    const body = req.body || {};
    if (!(Number(body.price) > 0)) throw new AppError(400, 'price must be > 0');
    if (!(Number(body.quantity) > 0)) throw new AppError(400, 'quantity must be > 0');

    // Block the buyer who owns the demand from offering on it.
    if (
      req.user &&
      req.user.role === 'BUYER' &&
      d.createdByUserPublicId &&
      req.user.publicId === d.createdByUserPublicId
    ) {
      throw new AppError(403, 'cannot offer on your own demand');
    }

    const farmerUserPublicId =
      body.farmer_user_public_id ||
      (req.user && req.user.publicId ? req.user.publicId : null);
    if (!farmerUserPublicId) {
      throw new AppError(400, 'farmer_user_public_id is required');
    }
    const offer = await createDemandOffer({
      demandId: d._id,
      farmerUserPublicId,
      price: body.price,
      quantity: body.quantity,
      message: body.message,
      cropLotId: body.crop_lot_id,
    });
    const payload = await offer.toReadWithRefs();
    res.status(201).json(payload);
  })
);

module.exports = { router };
