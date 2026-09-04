/**
 * services/offerService.js — offer state machine (both flows).
 *
 * Legacy (crop-lot) flow:
 *   create_offer({ cropLotId, buyerId, price, quantity, message })
 *   accept_offer  → creates Deal (cropLotId set), marks lot SOLD,
 *                   auto-rejects others on the lot.
 *
 * New (demand) flow:
 *   create_offer({ demandId, farmerUserPublicId, price, quantity,
 *                  message, cropLotId? })
 *   accept_offer  → creates Deal (demandId set, cropLotId optional),
 *                   increments demand.filledQuantityKg, auto-rejects
 *                   others on the demand, may flip demand to
 *                   FULFILLED.
 *
 * Common state transitions:
 *   (none) ──create──▶ OPEN
 *   OPEN / COUNTERED ──counter (opposite actor)──▶ COUNTERED
 *   OPEN / COUNTERED ──accept──▶ ACCEPTED (terminal)
 *   OPEN / COUNTERED ──reject──▶ REJECTED (terminal)
 *
 * Ownership / authorization is enforced by the calling route; the
 * service assumes the caller has already authorised the actor.
 */
'use strict';

const mongoose = require('mongoose');
const Offer = require('../models/Offer');
const Deal = require('../models/Deal');
const CropLot = require('../models/CropLot');
const Demand = require('../models/Demand');
const { OfferId, DealId } = require('../utils/publicId');
const { AppError } = require('../middleware/errorHandler');

/**
 * Legacy: buyer makes an offer on a crop lot.
 */
async function createOffer({ cropLotId, buyerId, price, quantity, message }) {
  if (!mongoose.isValidObjectId(cropLotId)) {
    throw new AppError(400, 'invalid crop_lot_id');
  }
  if (!mongoose.isValidObjectId(buyerId)) {
    throw new AppError(400, 'invalid buyer_id');
  }
  if (!(price > 0)) throw new AppError(400, 'price must be > 0');
  if (!(quantity > 0)) throw new AppError(400, 'quantity must be > 0');

  const lot = await CropLot.findById(cropLotId);
  if (!lot) throw new AppError(404, 'crop lot not found');
  if (lot.status !== 'ACTIVE') {
    throw new AppError(409, `crop lot is ${lot.status}, not ACTIVE`);
  }
  if (quantity > lot.quantity + 0.0001) {
    throw new AppError(400, 'quantity exceeds lot quantity');
  }

  const offer = await Offer.create({
    publicId: OfferId(),
    cropLotId: lot._id,
    buyerId,
    currentPrice: Number(price),
    currentQuantity: Number(quantity),
    status: 'OPEN',
    farmerUserPublicId: lot.sellerUserPublicId || null,
    messages: [
      {
        author: 'BUYER',
        message: message || 'Initial offer',
        price: Number(price),
        quantity: Number(quantity),
      },
    ],
  });
  return offer;
}

/**
 * New: farmer makes an offer on a buyer demand.
 */
async function createDemandOffer({ demandId, farmerUserPublicId, price, quantity, message, cropLotId }) {
  if (!mongoose.isValidObjectId(demandId)) {
    throw new AppError(400, 'invalid demand_id');
  }
  if (!farmerUserPublicId || typeof farmerUserPublicId !== 'string') {
    throw new AppError(400, 'farmer_user_public_id is required');
  }
  if (!(price > 0)) throw new AppError(400, 'price must be > 0');
  if (!(quantity > 0)) throw new AppError(400, 'quantity must be > 0');

  const demand = await Demand.findById(demandId);
  if (!demand) throw new AppError(404, 'demand not found');
  if (demand.status !== 'ACTIVE') {
    throw new AppError(409, `demand is ${demand.status}, not ACTIVE`);
  }
  if (quantity > demand.quantityKg + 0.0001) {
    throw new AppError(
      400,
      `quantity exceeds remaining demand (${Math.max(0, demand.quantityKg - demand.filledQuantityKg)} kg)`
    );
  }

  let resolvedLotId = null;
  if (cropLotId) {
    if (!mongoose.isValidObjectId(cropLotId)) {
      throw new AppError(400, 'invalid crop_lot_id');
    }
    const lot = await CropLot.findById(cropLotId);
    if (!lot) throw new AppError(404, 'crop lot not found');
    if (lot.status !== 'ACTIVE') {
      throw new AppError(409, `crop lot is ${lot.status}, not ACTIVE`);
    }
    if (
      lot.cropName &&
      demand.cropName &&
      lot.cropName.toLowerCase() !== demand.cropName.toLowerCase()
    ) {
      throw new AppError(400, `crop lot is ${lot.cropName}, demand is ${demand.cropName}`);
    }
    resolvedLotId = lot._id;
  }

  const offer = await Offer.create({
    publicId: OfferId(),
    demandId: demand._id,
    cropLotId: resolvedLotId,
    buyerId: demand.buyerId,
    farmerUserPublicId,
    currentPrice: Number(price),
    currentQuantity: Number(quantity),
    status: 'OPEN',
    messages: [
      {
        author: 'FARMER',
        message: message || 'Initial offer',
        price: Number(price),
        quantity: Number(quantity),
      },
    ],
  });

  // Maintain the denormalised offerCount on the demand (cheap reads).
  await Demand.updateOne({ _id: demand._id }, { $inc: { offerCount: 1 } });

  return offer;
}

async function counterOffer({ publicId, actor, price, quantity, message }) {
  if (!['FARMER', 'BUYER'].includes(actor)) {
    throw new AppError(400, 'actor must be FARMER or BUYER');
  }
  const offer = await Offer.findOne({ publicId });
  if (!offer) throw new AppError(404, 'offer not found');
  if (['ACCEPTED', 'REJECTED', 'CANCELLED'].includes(offer.status)) {
    throw new AppError(409, `offer is ${offer.status}, cannot counter`);
  }
  if (price != null) offer.currentPrice = Number(price);
  if (quantity != null) offer.currentQuantity = Number(quantity);
  offer.status = 'COUNTERED';
  offer.messages.push({
    author: actor,
    message: message || `${actor} counter`,
    price: offer.currentPrice,
    quantity: offer.currentQuantity,
  });
  await offer.save();
  return offer;
}

async function rejectOffer({ publicId, actor, message }) {
  const offer = await Offer.findOne({ publicId });
  if (!offer) throw new AppError(404, 'offer not found');
  if (['ACCEPTED', 'REJECTED', 'CANCELLED'].includes(offer.status)) {
    throw new AppError(409, `offer is ${offer.status}, cannot reject`);
  }
  offer.status = 'REJECTED';
  offer.decidedAt = new Date();
  offer.messages.push({
    author: actor || (offer.demandId ? 'BUYER' : 'FARMER'),
    message: message || 'Offer rejected',
  });
  await offer.save();
  return offer;
}

/**
 * acceptOffer — handles BOTH flows. For demand-based offers, the
 * demand's filledQuantityKg is incremented; if the demand is fully
 * filled, its status flips to FULFILLED. For lot-based offers, the
 * legacy path is preserved (mark SOLD, auto-reject others on lot).
 */
async function acceptOffer({ publicId, actor }) {
  const offer = await Offer.findOne({ publicId });
  if (!offer) throw new AppError(404, 'offer not found');

  if (offer.status === 'ACCEPTED') {
    // Idempotent: return the existing deal.
    const deal = await Deal.findOne({ _id: offer.dealId });
    return { offer, deal, already_accepted: true };
  }
  if (['REJECTED', 'CANCELLED'].includes(offer.status)) {
    throw new AppError(409, `offer is ${offer.status}, cannot accept`);
  }

  // Demand-based path
  if (offer.demandId) {
    const demand = await Demand.findById(offer.demandId);
    if (!demand) throw new AppError(404, 'demand not found');
    if (demand.status !== 'ACTIVE') {
      throw new AppError(409, `demand is ${demand.status}, cannot accept`);
    }
    const totalValue = Math.round(offer.currentPrice * offer.currentQuantity * 100) / 100;
    const deal = await Deal.create({
      publicId: DealId(),
      demandId: demand._id,
      cropLotId: offer.cropLotId || null,
      buyerId: offer.buyerId,
      offerId: offer._id,
      farmerUserPublicId: offer.farmerUserPublicId || null,
      agreedPricePerKg: offer.currentPrice,
      agreedQuantity: offer.currentQuantity,
      totalValue,
      deliveryStatus: 'PENDING',
      paymentStatus: 'UNPAID',
      // Feature H — seed the audit trail (mirrors the lot-based path).
      dealEvents: [
        {
          type: 'DEAL_CREATED',
          from: null,
          to: 'PENDING',
          actorPublicId: actor || offer.farmerUserPublicId || 'system',
          actorRole: 'SYSTEM',
          details: {
            offer_public_id: offer.publicId,
            demand_public_id: demand.publicId,
            agreed_price_per_kg: offer.currentPrice,
            agreed_quantity: offer.currentQuantity,
            total_value: totalValue,
          },
          txnRef: '',
          at: new Date(),
        },
      ],
    });

    demand.filledQuantityKg = (demand.filledQuantityKg || 0) + offer.currentQuantity;
    if (demand.filledQuantityKg + 0.0001 >= demand.quantityKg) {
      demand.status = 'FULFILLED';
    }
    await demand.save();

    offer.status = 'ACCEPTED';
    offer.decidedAt = new Date();
    offer.dealId = deal._id;
    offer.messages.push({
      author: actor || 'BUYER',
      message: 'Offer accepted',
    });
    await offer.save();

    // Auto-reject other OPEN/COUNTERED offers on this demand
    await Offer.updateMany(
      {
        demandId: demand._id,
        _id: { $ne: offer._id },
        status: { $in: ['OPEN', 'COUNTERED'] },
      },
      {
        $set: { status: 'REJECTED', decidedAt: new Date() },
        $push: {
          messages: {
            author: 'SYSTEM',
            message: 'Auto-rejected: demand fulfilled by another farmer',
            createdAt: new Date(),
          },
        },
      }
    );

    return { offer, deal, already_accepted: false };
  }

  // Legacy lot-based path
  if (!offer.cropLotId) {
    throw new AppError(409, 'offer has neither demandId nor cropLotId');
  }
  const lot = await CropLot.findById(offer.cropLotId);
  if (!lot) throw new AppError(404, 'crop lot not found');
  if (lot.status !== 'ACTIVE') {
    throw new AppError(409, `crop lot is ${lot.status}, cannot accept`);
  }

  // Run sequentially. mongodb-memory-server single-node does not
  // support transactions, so we use plain awaits in the same order
  // the transaction would have used. Production with a real replica
  // set / cluster can wrap this in withTransaction.
  const totalValue = Math.round(offer.currentPrice * offer.currentQuantity * 100) / 100;
  const deal = await Deal.create({
    publicId: DealId(),
    cropLotId: lot._id,
    buyerId: offer.buyerId,
    offerId: offer._id,
    farmerUserPublicId: offer.farmerUserPublicId || null,
    agreedPricePerKg: offer.currentPrice,
    agreedQuantity: offer.currentQuantity,
    totalValue,
    deliveryStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    // Feature H — seed the audit trail with a DEAL_CREATED event so
    // the GET /audit endpoint always has at least one event for a
    // freshly accepted deal. The verification/payment/issue routes
    // append their own events after this one.
    dealEvents: [
      {
        type: 'DEAL_CREATED',
        from: null,
        to: 'PENDING',
        actorPublicId: actor || offer.farmerUserPublicId || 'system',
        actorRole: 'SYSTEM',
        details: {
          offer_public_id: offer.publicId,
          crop_lot_public_id: lot.publicId,
          agreed_price_per_kg: offer.currentPrice,
          agreed_quantity: offer.currentQuantity,
          total_value: totalValue,
        },
        txnRef: '',
        at: new Date(),
      },
    ],
  });

  // Mark lot SOLD
  lot.status = 'SOLD';
  await lot.save();

  // Mark this offer ACCEPTED
  offer.status = 'ACCEPTED';
  offer.decidedAt = new Date();
  offer.dealId = deal._id;
  offer.messages.push({
    author: actor || 'BUYER',
    message: 'Offer accepted',
  });
  await offer.save();

  // Auto-reject other OPEN/COUNTERED offers on this lot
  await Offer.updateMany(
    {
      cropLotId: lot._id,
      _id: { $ne: offer._id },
      status: { $in: ['OPEN', 'COUNTERED'] },
    },
    {
      $set: { status: 'REJECTED', decidedAt: new Date() },
      $push: {
        messages: {
          author: 'SYSTEM',
          message: 'Auto-rejected: lot sold to another buyer',
          createdAt: new Date(),
        },
      },
    }
  );

  return { offer, deal, already_accepted: false };
}

module.exports = {
  createOffer,
  createDemandOffer,
  counterOffer,
  rejectOffer,
  acceptOffer,
};
