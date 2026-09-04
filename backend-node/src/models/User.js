/**
 * models/User.js — user identity + authentication.
 *
 * Two ways the system knows who you are:
 *
 *   1. Password login (the primary path). POST /api/auth/login
 *      validates email + password, returns a JWT.
 *   2. Demo login (the legacy role-pick flow, kept for the SIH
 *      prototype's seed users). Still works; demo users have
 *      `isDemo: true` and a plain-text `password` for the seeder.
 *
 * New registrations store a bcrypt `passwordHash`; passwords are NEVER
 * stored in plain text. Existing demo users may keep a `password`
 * field (plain text) until the seeder migrates them.
 *
 * Wire shape from toRead() never includes any password material.
 */
'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    publicId: { type: String, unique: true, index: true, required: true },
    role: { type: String, enum: ['SELLER', 'BUYER', 'FPO'], required: true },
    // Phase 4 — buyer id is the Buyer's Mongo ObjectId (24-char hex)
    // or BUY-... publicId. Was historically typed as Number, which
    // caused Mongoose to throw on `Number("6a9410a7...")` -> NaN
    // (Cast to Number failed). Stored as String to match Buyer._id
    // shape and never coerced on save.
    activeBuyerId: { type: String, default: null },
    activeFpoId: { type: String, default: null },
    displayName: { type: String, default: '' },
    // Full name shown to other users. Distinct from displayName
    // (which is a friendly handle) so existing flows are unaffected.
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    // Login fields. Email is unique when present.
    email: { type: String, lowercase: true, trim: true, index: { unique: true, sparse: true } },
    // Bcrypt-hashed password for real accounts. The legacy `password`
    // field is kept (default null) for the demo seeder's plain-text
    // passwords, which the login route falls back to if passwordHash
    // is empty.
    passwordHash: { type: String, default: null },
    password: { type: String, default: null }, // demo only — never read for new accounts
    isDemo: { type: Boolean, default: false },
    // Feature F — identity verification (KYC). Separate from
    // credibility, which is computed from platform history. This
    // boolean is set true when the user completes a KYC flow
    // (PAN/Aadhaar/UPI verification). No third-party integration
    // yet; the field is a forward-looking extension point that
    // the UI already surfaces as its own badge.
    identityVerified: { type: Boolean, default: false },
    identityVerifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

UserSchema.methods.setPassword = async function (plain) {
  if (!plain) throw new Error('password is required');
  this.passwordHash = await bcrypt.hash(String(plain), 10);
  this.password = null; // never keep a plain copy on new accounts
};

UserSchema.methods.verifyPassword = async function (plain) {
  if (this.passwordHash) {
    return bcrypt.compare(String(plain || ''), this.passwordHash);
  }
  if (this.password) {
    // Legacy demo accounts. Compare strings directly — these are
    // public-knowledge demo passwords, not real credentials.
    return this.password === String(plain || '');
  }
  return false;
};

UserSchema.methods.toRead = function () {
  return {
    public_id: this.publicId,
    role: this.role,
    active_buyer_id: this.activeBuyerId,
    active_fpo_id: this.activeFpoId,
    display_name: this.displayName,
    name: this.name || this.displayName || '',
    email: this.email || null,
    phone: this.phone || null,
    is_demo: !!this.isDemo,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

module.exports = mongoose.model('User', UserSchema);
