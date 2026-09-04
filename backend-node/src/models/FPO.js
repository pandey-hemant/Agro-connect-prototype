/**
 * models/FPO.js — a Farmer Producer Organisation.
 *
 * Members are stored as embedded subdocuments referencing a CropLot.
 * The (fpo, cropLot) pair is unique, enforced by validator below.
 *
 * Feature E — explicit per-farmer opt-in:
 *   Each membership record carries `optedIn` and `optedInAt`. A
 *   farmer must explicitly opt in for their lot to count toward
 *   group-sale aggregation. This is a hard requirement: just being
 *   a member of an FPO does not mean a farmer's lot is part of
 *   group sales. The UI must surface a checkbox.
 */
'use strict';

const mongoose = require('mongoose');
const { FPOId } = require('../utils/publicId');

const { Schema } = mongoose;

const MemberSchema = new Schema(
  {
    userPublicId: { type: String, default: '' },
    cropLotId: { type: Schema.Types.ObjectId, ref: 'CropLot', required: true },
    joinedAt: { type: Date, default: Date.now },
    optedIn: { type: Boolean, default: false },
    optedInAt: { type: Date, default: null },
  },
  { _id: false }
);

const FPOSchema = new Schema(
  {
    publicId: { type: String, unique: true, index: true, required: true },
    name: { type: String, required: true },
    location: { type: String, default: '' },
    district: { type: String, default: '' },
    state: { type: String, default: '' },
    contact: { type: String, default: '' },
    ownerUserPublicId: { type: String, default: '' }, // demo-user publicId for FPO owner
    isDemo: { type: Boolean, default: false },
    members: { type: [MemberSchema], default: [] },
  },
  { timestamps: true }
);

// Enforce uniqueness of (fpo, cropLot) in the embedded array.
FPOSchema.pre('save', function (next) {
  const seen = new Set();
  for (const m of this.members || []) {
    const key = String(m.cropLotId);
    if (seen.has(key)) {
      return next(new Error('Duplicate crop_lot in FPO members'));
    }
    seen.add(key);
  }
  next();
});

FPOSchema.statics.newPublicId = FPOId;

FPOSchema.methods.toRead = function () {
  return {
    id: this._id,
    public_id: this.publicId,
    name: this.name,
    location: this.location,
    district: this.district,
    state: this.state,
    contact: this.contact,
    owner_user_public_id: this.ownerUserPublicId,
    is_demo: Boolean(this.isDemo),
    members: (this.members || []).map((m) => ({
      user_public_id: m.userPublicId,
      crop_lot_id: m.cropLotId,
      joined_at: m.joinedAt,
      opted_in: Boolean(m.optedIn),
      opted_in_at: m.optedInAt,
    })),
    member_count: (this.members || []).length,
    opted_in_count: (this.members || []).filter((m) => m.optedIn).length,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

module.exports = mongoose.model('FPO', FPOSchema);
