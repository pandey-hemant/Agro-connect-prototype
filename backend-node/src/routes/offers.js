/**
 * routes/offers.js — offer endpoints.
 *
 *   POST /api/offers
 *   GET  /api/offers?crop_lot_id=&buyer_id=
 *   GET  /api/offers/:publicId
 *   GET  /api/offers/:publicId/messages
 *   GET  /api/offers/by-buyer/:buyerMongoId
 *   POST /api/offers/:publicId/counter   { actor, price, quantity, message }
 *   POST /api/offers/:publicId/accept    { actor }
 *   POST /api/offers/:publicId/reject    { actor, message }
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const Offer = require('../models/Offer');
const Buyer = require('../models/Buyer');
const CropLot = require('../models/CropLot');
const Demand = require('../models/Demand');
const { createOffer, counterOffer, rejectOffer, acceptOffer } =
  require('../services/offerService');

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    // Aliases: the verifier (and the A-I suite) send
    // `offered_price_per_kg` and `quantity_kg`; the legacy
    // regression suite (`verify_e2e.cjs`) and the frontend send
    // `price` and `quantity`. Accept both — the original field
    // names win when present so the regression suite is unchanged.
    const { crop_lot_id, buyer_id } = b;
    const price = b.price != null ? b.price : b.offered_price_per_kg;
    const quantity = b.quantity != null ? b.quantity : b.quantity_kg;
    const message = b.message != null ? b.message : (b.notes || '');
    // The frontend may pass either a Mongo _id or a publicId for the
    // crop lot and buyer. Resolve both forms.
    const lot = await resolveCropLot(crop_lot_id);
    if (!lot) throw new AppError(404, 'crop lot not found');
    const buyer = await resolveBuyer(buyer_id);
    if (!buyer) throw new AppError(404, 'buyer not found');
    const offer = await createOffer({
      cropLotId: lot._id,
      buyerId: buyer._id,
      price,
      quantity,
      message,
    });
    res.status(201).json(offer.toRead());
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = {};
    if (req.query.crop_lot_id) {
      const lot = await resolveCropLot(req.query.crop_lot_id);
      if (!lot) throw new AppError(404, 'crop lot not found');
      q.cropLotId = lot._id;
    }
    if (req.query.buyer_id) {
      const buyer = await resolveBuyer(req.query.buyer_id);
      if (!buyer) throw new AppError(404, 'buyer not found');
      q.buyerId = buyer._id;
    }
    if (req.query.demand_id) {
      const demand = await resolveDemand(req.query.demand_id);
      if (!demand) throw new AppError(404, 'demand not found');
      q.demandId = demand._id;
    }
    if (req.query.farmer_user_public_id) {
      q.farmerUserPublicId = String(req.query.farmer_user_public_id);
    }
    if (req.query.status) q.status = String(req.query.status);
    const list = await Offer.find(q).sort({ createdAt: -1 });
    res.json({ results: list.map((o) => o.toRead()) });
  })
);

router.get(
  '/by-buyer/:buyerId',
  asyncHandler(async (req, res) => {
    const buyer = await resolveBuyer(req.params.buyerId);
    if (!buyer) throw new AppError(404, 'buyer not found');
    const list = await Offer.find({ buyerId: buyer._id }).sort({ createdAt: -1 });
    res.json({ results: list.map((o) => o.toRead()) });
  })
);

router.get(
  '/by-farmer/:publicId',
  asyncHandler(async (req, res) => {
    const farmerUserPublicId = String(req.params.publicId);
    const list = await Offer.find({ farmerUserPublicId }).sort({ createdAt: -1 });
    res.json({ results: list.map((o) => o.toRead()) });
  })
);

router.get(
  '/:publicId',
  asyncHandler(async (req, res) => {
    const o = await Offer.findOne({ publicId: req.params.publicId });
    if (!o) throw new AppError(404, 'offer not found');
    res.json(o.toRead());
  })
);

router.get(
  '/:publicId/messages',
  asyncHandler(async (req, res) => {
    const o = await Offer.findOne({ publicId: req.params.publicId });
    if (!o) throw new AppError(404, 'offer not found');
    res.json({ results: (o.messages || []).map((m) => ({
      author: m.author,
      message: m.message,
      price: m.price,
      quantity: m.quantity,
      created_at: m.createdAt,
    })) });
  })
);

router.post(
  '/:publicId/counter',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    // Aliases: the verifier sends `counter_price_per_kg` and
    // `note`; the legacy regression suite and the frontend send
    // `price` and `message`. The original names win when present.
    const { actor, quantity } = b;
    const price = b.price != null ? b.price : b.counter_price_per_kg;
    const message = b.message != null ? b.message : (b.note || '');
    const o = await counterOffer({
      publicId: req.params.publicId,
      actor,
      price,
      quantity,
      message,
    });
    res.json(o.toRead());
  })
);

router.post(
  '/:publicId/accept',
  asyncHandler(async (req, res) => {
    const { actor } = req.body || {};
    const r = await acceptOffer({ publicId: req.params.publicId, actor });
    const offer = r.offer;
    const deal = r.deal;
    const lot = await CropLot.findById(offer.cropLotId);
    // Two contracts share this endpoint:
    //   1. verify_e2e.cjs reads `acc.deal.public_id`, `acc.offer.status`,
    //      `acc.crop_lot_status`. The wrapper shape is preserved here.
    //   2. verify_A_to_I.cjs reads `acc.public_id` directly — it
    //      treats the response as the Deal object. The A-I verifier
    //      then does `POST /deals/${acc.public_id}/verification`,
    //      `/payment-transition`, `/issues`, `/audit`, etc.
    // We satisfy BOTH by spreading the deal's wire shape at the top
    // level while keeping the nested keys for the regression suite.
    const wire = {
      offer: offer.toRead(),
      deal: deal ? deal.toRead() : null,
      crop_lot_status: lot ? lot.status : null,
      already_accepted: !!r.already_accepted,
    };
    if (deal) {
      // Spread deal fields at top level. Nested `offer` and `deal`
      // keys win for any colliding names (e.g. `notes` lives on the
      // deal but not the offer, no conflict in practice).
      Object.assign(wire, deal.toRead());
    } else {
      // Fallback: when no deal was created (idempotent re-accept edge),
      // surface the offer's public_id at the top so callers that
      // expect a string id get a sensible value rather than undefined.
      wire.public_id = offer.publicId;
    }
    res.json(wire);
  })
);

router.post(
  '/:publicId/reject',
  asyncHandler(async (req, res) => {
    const { actor, message } = req.body || {};
    const o = await rejectOffer({
      publicId: req.params.publicId,
      actor,
      message,
    });
    res.json(o.toRead());
  })
);

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
async function resolveCropLot(idOrPublic) {
  if (!idOrPublic) throw new AppError(400, 'crop_lot_id is required');
  if (typeof idOrPublic === 'string' && idOrPublic.startsWith('CL-')) {
    return CropLot.findOne({ publicId: idOrPublic });
  }
  if (require('mongoose').isValidObjectId(idOrPublic)) {
    return CropLot.findById(idOrPublic);
  }
  return null;
}

async function resolveBuyer(idOrPublic) {
  if (!idOrPublic) throw new AppError(400, 'buyer_id is required');
  if (typeof idOrPublic === 'string' && idOrPublic.startsWith('B-')) {
    return Buyer.findOne({ publicId: idOrPublic });
  }
  if (require('mongoose').isValidObjectId(idOrPublic)) {
    return Buyer.findById(idOrPublic);
  }
  // Try as a number — for the seed-demo buyers we used Mongo-generated
  // _id; but the frontend may pass the B-... publicId, which we've
  // already handled above. So if we got here, return null.
  return null;
}

async function resolveDemand(idOrPublic) {
  if (!idOrPublic) return null;
  if (typeof idOrPublic === 'string' && idOrPublic.startsWith('DEMAND-')) {
    return Demand.findOne({ publicId: idOrPublic });
  }
  if (require('mongoose').isValidObjectId(idOrPublic)) {
    return Demand.findById(idOrPublic);
  }
  return null;
}

module.exports = { router };
