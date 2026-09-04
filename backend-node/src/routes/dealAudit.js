/**
 * routes/dealAudit.js — deal-level audit trail (Feature H).
 *
 *   GET /api/deals/:publicId/audit
 *
 * Returns the full chronological list of events on a deal, drawn
 * from `Deal.dealEvents` (delivery, payment, verification, issues)
 * plus the legacy `Deal.paymentEvents` for backward compatibility.
 *
 * The events are append-only — never mutated after the fact — so
 * this endpoint is a truthful single-source for "what happened on
 * this deal".
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const Deal = require('../models/Deal');

const router = express.Router({ mergeParams: true });

router.get(
  '/:publicId/audit',
  asyncHandler(async (req, res) => {
    const deal = await Deal.findOne({ publicId: req.params.publicId });
    if (!deal) throw new AppError(404, 'deal not found');

    // Combine dealEvents + paymentEvents into a single chronological
    // list, with payment events tagged type=PAYMENT_STATUS_CHANGED so
    // the UI can filter.
    const events = [];
    for (const e of deal.dealEvents || []) {
      events.push({
        type: e.type,
        from: e.from,
        to: e.to,
        actor_public_id: e.actorPublicId,
        actor_role: e.actorRole,
        details: e.details,
        txn_ref: e.txnRef,
        at: e.at,
      });
    }
    for (const p of deal.paymentEvents || []) {
      events.push({
        type: 'PAYMENT_STATUS_CHANGED',
        from: p.from,
        to: p.to,
        actor_public_id: p.by,
        actor_role: '',
        details: { amount: p.amount, note: p.note },
        txn_ref: p.txn_id,
        at: p.at,
      });
    }
    events.sort((a, b) => new Date(a.at) - new Date(b.at));

    res.json({
      public_id: deal.publicId,
      delivery_status: deal.deliveryStatus,
      payment_status: deal.paymentStatus,
      event_count: events.length,
      events,
    });
  })
);

module.exports = { router };
