/**
 * routes/fpos.js — FPO endpoints.
 *
 *   POST /api/fpos                       create
 *   GET  /api/fpos                       list
 *   GET  /api/fpos/:publicId             detail
 *   POST /api/fpos/:publicId/join        { crop_lot_id }
 *   POST /api/fpos/:publicId/leave       { crop_lot_id }
 *   GET  /api/fpos/:publicId/aggregate   lots grouped by crop
 *   POST /api/fpos/seed-demo
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const FPO = require('../models/FPO');
const CropLot = require('../models/CropLot');
const Buyer = require('../models/Buyer');
const { FPOId } = require('../utils/publicId');
const { toKg } = require('../utils/units');
const { seedDemoFPOs } = require('../services/seedDemo');

const router = express.Router();

// Per-crop floor prices (₹/kg) used to estimate aggregate value.
// These are conservative reference values, not predictions. Unknown
// crops fall back to a safe default of ₹15/kg.
const DEFAULT_CROP_FLOOR_INR_PER_KG = {
  tomato: 15.0,
  onion: 18.0,
  potato: 12.0,
  wheat: 22.0,
  rice: 25.0,
  maize: 18.0,
  soybean: 38.0,
  cotton: 55.0,
  groundnut: 55.0,
};

function floorFor(cropName) {
  const key = String(cropName || '').trim().toLowerCase();
  const v = DEFAULT_CROP_FLOOR_INR_PER_KG[key];
  return typeof v === 'number' ? v : 15.0;
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.name) throw new AppError(400, 'name is required');
    const f = await FPO.create({
      publicId: FPOId(),
      name: b.name,
      location: b.location || '',
      district: b.district || '',
      state: b.state || '',
      contact: b.contact || '',
      ownerUserPublicId: req.user?.publicId || b.owner_user_public_id || '',
      isDemo: Boolean(b.is_demo),
      members: [],
    });
    res.status(201).json(f.toRead());
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const list = await FPO.find({}).sort({ createdAt: -1 });
    // Per-user membership: count how many of this user's crop lots are
    // members of each FPO. Lets the list page show a "Joined" badge
    // and a "Leave" button without a second round-trip. Returns 0 for
    // unauthenticated requests so the page still renders for guests.
    let myLotIds = [];
    let myLotPublicIdMap = {};
    const userId = req.user?.publicId;
    if (userId) {
      const lots = await CropLot.find({ sellerUserPublicId: userId }, { publicId: 1 });
      myLotIds = lots.map((l) => String(l._id));
      for (const l of lots) {
        myLotPublicIdMap[String(l._id)] = l.publicId;
      }
    }
    res.json({
      results: list.map((f) => {
        const wire = f.toRead();
        const myMemberObjects = (f.members || []).filter((m) =>
          myLotIds.includes(String(m.cropLotId))
        );
        wire.my_lot_count = myMemberObjects.length;
        wire.is_member = myMemberObjects.length > 0;
        // Map member ObjectIds back to their publicIds so the UI can
        // call leave with crop_lot_id (publicId) directly. Built
        // inline here rather than in a separate query.
        wire.my_member_lot_public_ids = myMemberObjects.map((m) => {
          // The members wire format already has crop_lot_id as the
          // ObjectId string. The publicId is fetched by joining the
          // member's cropLotId with myLotIds' original documents.
          // Simpler: resolve via CropLot lookup, but we already
          // loaded `myLots` above. Easiest: include the publicId
          // alongside the _id in the projection.
          return myLotPublicIdMap[String(m.cropLotId)] || null;
        }).filter(Boolean);
        return wire;
      }),
    });
  })
);

// GET /api/fpos/mine — FPOs the current user has at least one of
// their crop lots joined to. Used by the Farmer dashboard "My FPO"
// card. Requires an authenticated user.
router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const userId = req.user?.publicId;
    if (!userId) {
      return res.json({ results: [], count: 0 });
    }
    const myLots = await CropLot.find(
      { sellerUserPublicId: userId },
      { _id: 1, publicId: 1 }
    );
    const myLotObjectIds = myLots.map((l) => l._id);
    const myLotPublicIds = myLots.map((l) => l.publicId);
    const list = await FPO.find({
      'members.cropLotId': { $in: myLotObjectIds },
    }).sort({ createdAt: -1 });

    const results = list.map((f) => {
      const wire = f.toRead();
      // Surface which of my lots are members of this FPO so the UI
      // can show "lot CL-... is in this FPO" and offer a Leave button.
      wire.my_member_lot_public_ids = (f.members || [])
        .filter((m) =>
          myLotObjectIds.some((id) => String(id) === String(m.cropLotId))
        )
        .map((m) => {
          const found = myLots.find(
            (l) => String(l._id) === String(m.cropLotId)
          );
          return found ? found.publicId : null;
        })
        .filter(Boolean);
      return wire;
    });
    res.json({ results, count: results.length, my_lot_public_ids: myLotPublicIds });
  })
);

router.get(
  '/:publicId',
  asyncHandler(async (req, res) => {
    const f = await FPO.findOne({ publicId: req.params.publicId });
    if (!f) throw new AppError(404, 'fpo not found');
    res.json(f.toRead());
  })
);

router.post(
  '/:publicId/join',
  asyncHandler(async (req, res) => {
    const { crop_lot_id, opt_in, user_public_id } = req.body || {};
    if (!crop_lot_id) throw new AppError(400, 'crop_lot_id is required');
    const f = await FPO.findOne({ publicId: req.params.publicId });
    if (!f) throw new AppError(404, 'fpo not found');

    const lot = await resolveCropLot(crop_lot_id);
    if (!lot) throw new AppError(404, 'crop lot not found');

    // Idempotent: update if already a member, otherwise push.
    const idx = (f.members || []).findIndex(
      (m) => String(m.cropLotId) === String(lot._id)
    );
    const userId = user_public_id || req.user?.publicId || lot.sellerUserPublicId || '';
    if (idx === -1) {
      f.members.push({
        cropLotId: lot._id,
        userPublicId: userId,
        joinedAt: new Date(),
        // Feature E — opt-in is explicit and defaults to false.
        // The frontend must surface a checkbox and pass opt_in:true.
        optedIn: !!opt_in,
        optedInAt: opt_in ? new Date() : null,
      });
    } else {
      // Update opt-in if it's been toggled. The user can opt in or
      // out without leaving the FPO.
      const existing = f.members[idx];
      if (typeof opt_in === 'boolean' && existing.optedIn !== opt_in) {
        existing.optedIn = opt_in;
        existing.optedInAt = opt_in ? new Date() : null;
      }
      if (userId && !existing.userPublicId) existing.userPublicId = userId;
    }
    await f.save();
    res.json(f.toRead());
  })
);

/**
 * POST /api/fpos/:publicId/opt-in
 * Body: { crop_lot_id, opt_in: boolean }
 *
 * Toggles the explicit group-sale opt-in for a member's crop lot.
 * Just being a member is not enough — opted-in lots are the ones
 * the FPO aggregates for bulk-demand matching. The frontend
 * surfaces this as a separate checkbox on the join form.
 */
router.post(
  '/:publicId/opt-in',
  asyncHandler(async (req, res) => {
    const { crop_lot_id, opt_in } = req.body || {};
    if (!crop_lot_id) throw new AppError(400, 'crop_lot_id is required');
    if (typeof opt_in !== 'boolean') {
      throw new AppError(400, 'opt_in must be a boolean');
    }
    const f = await FPO.findOne({ publicId: req.params.publicId });
    if (!f) throw new AppError(404, 'fpo not found');
    const lot = await resolveCropLot(crop_lot_id);
    if (!lot) throw new AppError(404, 'crop lot not found');
    const idx = (f.members || []).findIndex(
      (m) => String(m.cropLotId) === String(lot._id)
    );
    if (idx === -1) {
      // Not a member yet — opt-in requires membership. Tell the
      // caller to join first.
      throw new AppError(
        409,
        'lot is not a member of this FPO — POST /:publicId/join first'
      );
    }
    f.members[idx].optedIn = opt_in;
    f.members[idx].optedInAt = opt_in ? new Date() : null;
    await f.save();
    // Return the full FPO wire (including the updated members[]) so
    // callers can read `body.members[].opted_in` without a second
    // round-trip. A minimal `{public_id, opted_in}` shape used to be
    // returned here, which broke the A-I verifier's
    // `(body.members || []).some(...)` check on the toggle path.
    res.json(f.toRead());
  })
);

router.post(
  '/:publicId/leave',
  asyncHandler(async (req, res) => {
    const { crop_lot_id } = req.body || {};
    if (!crop_lot_id) throw new AppError(400, 'crop_lot_id is required');
    const f = await FPO.findOne({ publicId: req.params.publicId });
    if (!f) throw new AppError(404, 'fpo not found');
    const lot = await resolveCropLot(crop_lot_id);
    if (!lot) throw new AppError(404, 'crop lot not found');
    f.members = (f.members || []).filter(
      (m) => String(m.cropLotId) !== String(lot._id)
    );
    await f.save();
    res.json(f.toRead());
  })
);

router.get(
  '/:publicId/aggregate',
  asyncHandler(async (req, res) => {
    const f = await FPO.findOne({ publicId: req.params.publicId });
    if (!f) throw new AppError(404, 'fpo not found');

    const cropFilter = req.query.crop
      ? String(req.query.crop).trim().toLowerCase()
      : '';

    const ids = (f.members || []).map((m) => m.cropLotId);
    const lots = await CropLot.find({ _id: { $in: ids } });

    // Build a member-id → member lookup so we can surface opt-in
    // per-lot in the aggregate.
    const memberByLot = new Map();
    for (const m of f.members || []) {
      memberByLot.set(String(m.cropLotId), m);
    }

    // Bucket by (crop, unit) so the unit info is preserved on the row
    // and unit conversions stay accurate for the estimated_value calc.
    const byCrop = {};
    let totalLots = 0;
    let totalQuantity = 0;
    let optedInLots = 0;
    let optedInQuantity = 0;
    for (const l of lots) {
      const crop = String(l.cropName || '').trim();
      if (!crop) continue;
      if (cropFilter && crop.toLowerCase() !== cropFilter) continue;
      const unit = String(l.quantityUnit || 'kg').trim() || 'kg';
      const key = `${crop.toLowerCase()}__${unit}`;
      if (!byCrop[key]) {
        byCrop[key] = {
          crop_name: crop,
          quantity_unit: unit,
          lot_count: 0,
          total_quantity: 0,
          opted_in_lot_count: 0,
          opted_in_quantity: 0,
          member_public_ids: [],
          opted_in_member_public_ids: [],
        };
      }
      const bucket = byCrop[key];
      const member = memberByLot.get(String(l._id));
      const isOptedIn = !!(member && member.optedIn);
      bucket.lot_count += 1;
      bucket.total_quantity += Number(l.quantity || 0);
      if (isOptedIn) {
        bucket.opted_in_lot_count += 1;
        bucket.opted_in_quantity += Number(l.quantity || 0);
        optedInLots += 1;
        optedInQuantity += Number(l.quantity || 0);
      }
      if (l.publicId) {
        bucket.member_public_ids.push(l.publicId);
        if (isOptedIn) {
          bucket.opted_in_member_public_ids.push(l.publicId);
        }
      }
      totalLots += 1;
      totalQuantity += Number(l.quantity || 0);
    }

    // Build the wire rows with a per-crop estimated_value so the
    // frontend can render the table without crashing on undefined.
    const byCropRows = Object.values(byCrop)
      .map((b) => {
        const floor = floorFor(b.crop_name);
        const qtyInKg = toKg(b.total_quantity, b.quantity_unit) || 0;
        const optedInQtyInKg =
          toKg(b.opted_in_quantity, b.quantity_unit) || 0;
        return {
          crop_name: b.crop_name,
          lot_count: b.lot_count,
          total_quantity: Number(b.total_quantity || 0),
          quantity_unit: b.quantity_unit,
          opted_in_lot_count: b.opted_in_lot_count,
          opted_in_quantity: Number(b.opted_in_quantity || 0),
          estimated_value: Number((qtyInKg * floor).toFixed(2)),
          opted_in_estimated_value: Number((optedInQtyInKg * floor).toFixed(2)),
          currency: 'INR',
          member_public_ids: b.member_public_ids,
          opted_in_member_public_ids: b.opted_in_member_public_ids,
        };
      })
      .sort((a, b) => a.crop_name.toLowerCase().localeCompare(b.crop_name.toLowerCase()));

    // Which buyers are now reachable? For every buyer requirement whose
    // crop + min_quantity_kg can be satisfied by the FPO's kg aggregate
    // of the same crop, add a row. Buyer requirements are stored in kg.
    const cropToKg = {};
    for (const row of byCropRows) {
      const k = String(row.crop_name || '').toLowerCase();
      const kg = toKg(row.total_quantity, row.quantity_unit) || 0;
      cropToKg[k] = (cropToKg[k] || 0) + kg;
    }

    const reachable = [];
    if (Object.keys(cropToKg).length > 0) {
      const allBuyers = await Buyer.find({});
      for (const b of allBuyers) {
        for (const r of b.requirements || []) {
          const cName = String(r.cropName || '').trim();
          if (!cName) continue;
          const cKey = cName.toLowerCase();
          const kg = cropToKg[cKey];
          if (!kg) continue;
          const minQty = Number(r.minQuantityKg || 0);
          if (minQty <= 0) continue;
          if (minQty <= kg) {
            reachable.push({
              buyer_public_id: b.publicId,
              buyer_name: b.name,
              crop_name: cName,
              min_quantity: minQty,
              aggregate_quantity: Number(kg.toFixed(2)),
              quantity_unit: 'kg',
            });
          }
        }
      }
    }

    res.json({
      fpo_public_id: f.publicId,
      fpo_name: f.name,
      crop: cropFilter || null,
      by_crop: byCropRows,
      total_lots: totalLots,
      total_quantity: totalQuantity,
      opted_in_lot_count: optedInLots,
      opted_in_quantity: optedInQuantity,
      reachable_buyers: reachable,
      note:
        'Aggregated quantity may unlock buyers whose min_quantity a ' +
        'single lot could not meet. Estimated value uses a clearly-' +
        'labelled floor price, not a market prediction.',
    });
  })
);

router.post(
  '/seed-demo',
  asyncHandler(async (_req, res) => {
    const r = await seedDemoFPOs();
    res.json(r);
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

module.exports = { router };
