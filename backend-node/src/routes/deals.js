/**
 * routes/deals.js — deal endpoints.
 *
 *   GET  /api/deals                              list (filters: crop_lot_id, buyer_id)
 *   GET  /api/deals/:publicId                    detail
 *   POST /api/deals/:publicId/status             { delivery_status, payment_status, notes? }
 *   POST /api/deals/:publicId/payment-transition { to, amount? }
 *
 * The /payment-transition endpoint drives the explicit payment state
 * flow (PAYMENT_PENDING → INITIATED → SECURED → RELEASED → COMPLETED,
 * with DISPUTED / REFUNDED branches) and records a deterministic
 * demo transaction reference per transition. No real money is moved;
 * the reference is for auditable traceability only.
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const Deal = require('../models/Deal');
const CropLot = require('../models/CropLot');
const Buyer = require('../models/Buyer');
const crypto = require('crypto');

const router = express.Router();

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
    const list = await Deal.find(q).sort({ createdAt: -1 });
    res.json({ results: list.map((d) => d.toRead()) });
  })
);

router.get(
  '/:publicId',
  asyncHandler(async (req, res) => {
    const d = await Deal.findOne({ publicId: req.params.publicId });
    if (!d) throw new AppError(404, 'deal not found');
    res.json(d.toRead());
  })
);

const DEAL_ORDER = {
  PENDING: 0,
  PREPARING: 1,
  IN_TRANSIT: 2,
  DELIVERED: 3,
  COMPLETED: 4,
};

function actorFromReq(req) {
  return {
    publicId:
      (req.user && req.user.publicId) ||
      req.header('X-Demo-User') ||
      'system',
    role:
      (req.user && req.user.role) ||
      (req.header('X-Demo-User-Role') || 'SELLER'),
  };
}

function appendDealEvent(deal, type, from, to, details, txnRef, actor) {
  deal.dealEvents = deal.dealEvents || [];
  deal.dealEvents.push({
    type,
    from: from || null,
    to: to || null,
    actorPublicId: actor.publicId,
    actorRole: actor.role,
    details: details || null,
    txnRef: txnRef || '',
    at: new Date(),
  });
}

router.post(
  '/:publicId/status',
  asyncHandler(async (req, res) => {
    const d = await Deal.findOne({ publicId: req.params.publicId });
    if (!d) throw new AppError(404, 'deal not found');

    const { delivery_status, payment_status, notes } = req.body || {};
    const actor = actorFromReq(req);
    if (delivery_status) {
      if (!Deal.DELIVERY_STATES.includes(delivery_status)) {
        throw new AppError(400, `unknown delivery_status: ${delivery_status}`);
      }
      // No backwards: current must be <= new (allow DISPUTED from any)
      const prevDelivery = d.deliveryStatus;
      if (delivery_status === 'DISPUTED') {
        d.deliveryStatus = 'DISPUTED';
      } else {
        const cur = DEAL_ORDER[d.deliveryStatus] ?? 0;
        const nxt = DEAL_ORDER[delivery_status] ?? 0;
        if (nxt < cur) {
          throw new AppError(409, `cannot move ${d.deliveryStatus} → ${delivery_status}`);
        }
        d.deliveryStatus = delivery_status;
      }
      if (prevDelivery !== d.deliveryStatus) {
        appendDealEvent(
          d,
          'DELIVERY_STATUS_CHANGED',
          prevDelivery,
          d.deliveryStatus,
          null,
          '',
          actor
        );
      }
    }
    if (payment_status) {
      if (!Deal.PAYMENT_STATES.includes(payment_status)) {
        throw new AppError(400, `unknown payment_status: ${payment_status}`);
      }
      const prevPayment = d.paymentStatus;
      d.paymentStatus = payment_status;
      if (prevPayment !== d.paymentStatus) {
        appendDealEvent(
          d,
          'PAYMENT_STATUS_CHANGED',
          prevPayment,
          d.paymentStatus,
          null,
          '',
          actor
        );
      }
    }
    if (notes != null) d.notes = notes;
    await d.save();
    res.json(d.toRead());
  })
);

/* -------------------------------------------------------------------- *
 *  Payment state-flow transitions                                      *
 * -------------------------------------------------------------------- */

const PAYMENT_RAIL = [
  'PAYMENT_PENDING',
  'PAYMENT_INITIATED',
  'PAYMENT_SECURED',
  'PAYMENT_RELEASED',
  'COMPLETED',
];

const PAYMENT_RAIL_IDX = Object.fromEntries(PAYMENT_RAIL.map((s, i) => [s, i]));

// Map legacy / delivery-style states onto the rail.
const PAYMENT_ALIAS = {
  CREATED: 'PAYMENT_PENDING',
  UNPAID: 'PAYMENT_PENDING',
  PARTIAL: 'PAYMENT_INITIATED',
  PAID: 'PAYMENT_SECURED',
  DELIVERED: 'COMPLETED',
};

function normalizePayment(state) {
  if (!state) return 'PAYMENT_PENDING';
  const u = String(state).toUpperCase();
  return PAYMENT_ALIAS[u] || u;
}

function isLegalTransition(fromRaw, toRaw) {
  const from = normalizePayment(fromRaw);
  const to = normalizePayment(toRaw);
  if (from === to) return true; // idempotent re-record
  if (to === 'DISPUTED' && from !== 'COMPLETED' && from !== 'REFUNDED') return true;
  if (from === 'DISPUTED' && (to === 'REFUNDED' || to === 'PAYMENT_SECURED')) return true;
  if (to === 'REFUNDED' && from === 'DISPUTED') return true;
  const a = PAYMENT_RAIL_IDX[from];
  const b = PAYMENT_RAIL_IDX[to];
  if (a == null || b == null) return false;
  // strict one-step forward along the rail — no skipping
  return b === a + 1;
}

function newDemoTxnId() {
  // Deterministic-ish, readable DEMO reference. Not a bank receipt.
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `DEMO-TXN-${stamp}-${rand}`;
}

router.post(
  '/:publicId/payment-transition',
  asyncHandler(async (req, res) => {
    const d = await Deal.findOne({ publicId: req.params.publicId });
    if (!d) throw new AppError(404, 'deal not found');

    const { to, amount, note } = req.body || {};
    if (!to) throw new AppError(400, 'target state `to` is required');

    const current = normalizePayment(d.paymentStatus);
    const target = normalizePayment(to);

    if (!isLegalTransition(current, target)) {
      throw new AppError(
        409,
        `illegal transition ${current} → ${target}`
      );
    }

    d.paymentStatus = target;
    if (amount != null) {
      d.amount = Number(amount);
    }
    if (note != null) d.notes = note;

    // Append an entry to the demo ledger so the audit trail is visible
    // even after a page refresh.
    d.paymentEvents = d.paymentEvents || [];
    const txnRef = newDemoTxnId();
    const actor = actorFromReq(req);
    d.paymentEvents.push({
      from: current,
      to: target,
      amount: amount != null ? Number(amount) : (d.amount || null),
      txn_id: txnRef,
      at: new Date(),
      by: actor.publicId,
    });
    // Feature H — mirror to the unified deal audit trail.
    appendDealEvent(
      d,
      'PAYMENT_STATUS_CHANGED',
      current,
      target,
      { amount: amount != null ? Number(amount) : (d.amount || null), note: note || '' },
      txnRef,
      actor
    );

    // Mirror to the deal-level status for the COMPLETED branch.
    if (target === 'COMPLETED' && d.deliveryStatus !== 'COMPLETED') {
      d.deliveryStatus = 'COMPLETED';
      appendDealEvent(
        d,
        'DELIVERY_STATUS_CHANGED',
        null,
        'COMPLETED',
        { reason: 'payment_completed' },
        '',
        actor
      );
    }
    if (target === 'DISPUTED' && d.deliveryStatus !== 'DISPUTED') {
      d.deliveryStatus = 'DISPUTED';
      appendDealEvent(
        d,
        'DELIVERY_STATUS_CHANGED',
        null,
        'DISPUTED',
        { reason: 'payment_disputed' },
        '',
        actor
      );
    }

    await d.save();

    const last = d.paymentEvents[d.paymentEvents.length - 1];
    res.json({
      public_id: d.publicId,
      payment_status: d.paymentStatus,
      delivery_status: d.deliveryStatus,
      txn_id: last.txn_id,
      events: d.paymentEvents,
    });
  })
);

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
  return null;
}

module.exports = { router };
