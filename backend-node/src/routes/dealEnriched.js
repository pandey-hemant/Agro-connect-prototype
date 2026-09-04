/**
 * routes/dealEnriched.js — deal endpoints enriched with the joined
 * crop_lot, buyer, and farmer information. The base /api/deals/:id
 * endpoint returns raw ObjectIds; this layer joins them into the
 * shape the dashboard needs so the frontend doesn't have to chain
 * 4 separate fetches.
 *
 *   GET /api/deals/:publicId/enriched
 *   GET /api/deals/list-enriched       ?role=BUYER&buyer_id=&seller_user_public_id=
 *                                      ?role=FARMER&seller_user_public_id=
 *
 * The list-enriched endpoint is the one the dashboards call when they
 * need "my deals" with names + crops attached.
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const Deal = require('../models/Deal');
const CropLot = require('../models/CropLot');
const Buyer = require('../models/Buyer');
const User = require('../models/User');

const router = express.Router();

async function buildEnriched(d) {
  const [lot, buyer, offer] = await Promise.all([
    CropLot.findById(d.cropLotId),
    Buyer.findById(d.buyerId),
    d.offerId ? require('../models/Offer').findById(d.offerId) : null,
  ]);
  return {
    ...d.toRead(),
    crop_lot: lot
      ? {
          public_id: lot.publicId,
          crop_name: lot.cropName,
          crop_variety: lot.cropVariety,
          quantity: lot.quantity,
          quantity_unit: lot.quantityUnit,
          harvest_date: lot.harvestDate,
          location: lot.location,
          state: lot.state,
          status: lot.status,
          expected_price_per_kg: lot.expectedPricePerKg,
          minimum_acceptable_price: lot.minimumAcceptablePrice,
          seller_user_public_id: lot.sellerUserPublicId,
        }
      : null,
    buyer: buyer
      ? {
          public_id: buyer.publicId,
          name: buyer.name,
          location: buyer.location,
          state: buyer.state,
          contact: buyer.contact,
        }
      : null,
    offer: offer
      ? {
          public_id: offer.publicId,
          status: offer.status,
          current_price: offer.currentPrice,
          current_quantity: offer.currentQuantity,
        }
      : null,
  };
}

router.get(
  '/list-enriched',
  asyncHandler(async (req, res) => {
    const q = {};
    if (req.query.buyer_id) {
      const b = await resolveBuyer(req.query.buyer_id);
      if (!b) throw new AppError(404, 'buyer not found');
      q.buyerId = b._id;
    }
    if (req.query.crop_lot_id) {
      const lot = await resolveCropLot(req.query.crop_lot_id);
      if (!lot) throw new AppError(404, 'crop lot not found');
      q.cropLotId = lot._id;
    }
    if (req.query.seller_user_public_id) {
      const lots = await CropLot.find({
        sellerUserPublicId: String(req.query.seller_user_public_id),
      }).select('_id');
      const ids = lots.map((l) => l._id);
      if (ids.length === 0) {
        return res.json({ results: [] });
      }
      q.cropLotId = { $in: ids };
    }
    const list = await Deal.find(q).sort({ createdAt: -1 });
    const enriched = await Promise.all(list.map(buildEnriched));
    res.json({ results: enriched, count: enriched.length });
  })
);

router.get(
  '/:publicId/enriched',
  asyncHandler(async (req, res) => {
    const d = await Deal.findOne({ publicId: req.params.publicId });
    if (!d) throw new AppError(404, 'deal not found');
    const enriched = await buildEnriched(d);
    res.json(enriched);
  })
);

async function resolveCropLot(idOrPublic) {
  if (!idOrPublic) return null;
  if (typeof idOrPublic === 'string' && idOrPublic.startsWith('CL-')) {
    return CropLot.findOne({ publicId: idOrPublic });
  }
  if (require('mongoose').isValidObjectId(idOrPublic)) {
    return CropLot.findById(idOrPublic);
  }
  return null;
}

async function resolveBuyer(idOrPublic) {
  if (!idOrPublic) return null;
  if (typeof idOrPublic === 'string' && idOrPublic.startsWith('B-')) {
    return Buyer.findOne({ publicId: idOrPublic });
  }
  if (require('mongoose').isValidObjectId(idOrPublic)) {
    return Buyer.findById(idOrPublic);
  }
  return null;
}

module.exports = { router };
