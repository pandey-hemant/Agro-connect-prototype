/**
 * routes/auth.js — authentication endpoints.
 *
 *   POST /api/auth/register      { name, email, phone, password, role }
 *   POST /api/auth/login         { email, password }
 *   GET  /api/auth/me                                  → current user (200 + user:null if anon)
 *   POST /api/auth/logout                              → 200, stateless (frontend drops token)
 *   POST /api/auth/demo-login   { role, buyerId?, fpoId? }   → seed-user login
 *   POST /api/auth/switch-role  { role, buyerId?, fpoId? }   → change role/identity
 *   GET  /api/auth/demo-accounts                        → public list of demo accounts
 *   GET  /api/auth/buyers                               → convenience list of buyers
 *   GET  /api/auth/fpos                                 → convenience list of FPOs
 *
 * Real passwords are bcrypt-hashed on /register. The login response
 * carries a JWT (Bearer token) the client stores in localStorage. The
 * role is read from the database on every request, so a client cannot
 * elevate its role by tampering with the token.
 */
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const User = require('../models/User');
const Buyer = require('../models/Buyer');
const FPO = require('../models/FPO');
const { UserId } = require('../utils/randomUserId');
const { DEMO_USERS } = require('../services/seedDemo');
const { signToken } = require('../services/authService');

const router = express.Router();

const VALID_ROLES = ['SELLER', 'BUYER', 'FPO'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Phase 4 — defensively normalise a buyer identifier supplied by
 * the client. The Buyer model uses Mongo ObjectId, so any hex
 * ObjectId is accepted as-is. Legacy numeric IDs (the original
 * prototype) are still accepted, but anything that is not a clean
 * finite number, a valid ObjectId, or a BUY-... publicId is
 * rejected with 400 (instead of letting Mongoose throw 500 on
 * `Number("NaN")`). Returns the canonical String form ready to
 * be assigned to User.activeBuyerId.
 *
 * The function never returns NaN; it either returns a String
 * (truthy) or null. Callers can then short-circuit on null.
 */
function normaliseBuyerId(raw) {
  if (raw == null) return null;
  if (raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return undefined; // signal: bad
    return String(raw);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Numeric string ("1234") -> still acceptable as a legacy id.
    if (/^\d+$/.test(trimmed)) return trimmed;
    // Mongo ObjectId (24 hex chars) -> acceptable.
    if (mongoose.isValidObjectId(trimmed)) return trimmed;
    // BUY- or B- publicId -> acceptable. The seed has been
    // creating "B-XXXXXX" publicIds historically, and "BUY-XXXXXX"
    // is also accepted for forward-compat.
    if (/^(BUY|B)-/i.test(trimmed)) return trimmed;
    return undefined; // signal: bad
  }
  return undefined;
}

/** Normalise an FPO identifier. Same rules as buyer, but allows
 *  FPO-... publicId. ObjectId is acceptable too because the FPO
 *  list endpoint may return either form. */
function normaliseFpoId(raw) {
  if (raw == null) return null;
  if (raw === '') return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) return trimmed;
    if (mongoose.isValidObjectId(trimmed)) return trimmed;
    if (/^FPO-/i.test(trimmed)) return trimmed;
    return undefined;
  }
  return undefined;
}

function defaultDisplayName(role, name) {
  if (name) return name;
  if (role === 'SELLER') return `Farmer ${Math.floor(Math.random() * 1000)}`;
  if (role === 'BUYER') return 'New buyer';
  if (role === 'FPO') return 'New FPO';
  return 'AgroConnect user';
}

/**
 * Build the standard auth response: the user payload + a JWT.
 * Used by every "you are now logged in" path.
 */
function authResponse(user) {
  return {
    user: user.toRead(),
    token: signToken(user),
    token_type: 'Bearer',
  };
}

/**
 * POST /api/auth/register
 *
 * Create a new account. Body:
 *   { name, email, phone, password, confirm_password, role }
 *
 * Returns 201 with `{ user, token }` on success. The frontend can
 * then call this once and is automatically logged in.
 */
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const email = String(body.email || '').toLowerCase().trim();
    const phone = String(body.phone || '').trim();
    const password = body.password;
    const confirm = body.confirm_password;
    const role = String(body.role || '').toUpperCase();

    // Validation: required fields
    if (!name) throw new AppError(400, 'Full name is required');
    if (!email || !EMAIL_RE.test(email)) {
      throw new AppError(400, 'A valid email is required');
    }
    if (!password || String(password).length < 6) {
      throw new AppError(400, 'Password must be at least 6 characters');
    }
    if (password !== confirm) {
      throw new AppError(400, 'Passwords do not match');
    }
    if (!VALID_ROLES.includes(role)) {
      throw new AppError(400, `Role must be one of ${VALID_ROLES.join(', ')}`);
    }

    // Duplicate-email check
    const existing = await User.findOne({ email });
    if (existing) {
      throw new AppError(409, 'An account with this email already exists');
    }

    // Create the user with a hashed password.
    const u = new User({
      publicId: UserId(),
      role,
      displayName: defaultDisplayName(role, name),
      name,
      phone,
      email,
      isDemo: false,
    });
    await u.setPassword(password);
    await u.save();

    res.status(201).json(authResponse(u));
  })
);

/**
 * POST /api/auth/login
 *
 * Email + password. Returns `{ user, token }` on success.
 * 401 on bad credentials (no enumeration of which half was wrong).
 */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new AppError(400, 'email and password are required');
    }
    const normalized = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalized });
    if (!user) {
      throw new AppError(401, 'Invalid email or password');
    }
    const ok = await user.verifyPassword(password);
    if (!ok) {
      throw new AppError(401, 'Invalid email or password');
    }
    res.json(authResponse(user));
  })
);

/**
 * POST /api/auth/logout
 *
 * Stateless. The frontend deletes the token from localStorage; the
 * server just returns 200. We don't keep a token denylist in the
 * prototype.
 */
router.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true });
  })
);

/**
 * GET /api/auth/demo-accounts
 *
 * Public list of demo accounts (email, role, display name). Never
 * includes any password material — but the Login page renders the
 * passwords itself since they are the documented demo creds.
 */
router.get(
  '/demo-accounts',
  asyncHandler(async (_req, res) => {
    const accounts = DEMO_USERS.map((d) => ({
      email: d.email,
      role: d.role,
      display_name: d.displayName,
    }));
    res.json({ results: accounts });
  })
);

/**
 * POST /api/auth/demo-login
 *
 * For the demo seeder identities (and the legacy role-pick flow).
 * Reuses the stored publicId if we already have one.
 */
router.post(
  '/demo-login',
  asyncHandler(async (req, res) => {
    const { role, buyerId, fpoId, publicId } = req.body || {};
    if (!role || !VALID_ROLES.includes(role)) {
      throw new AppError(400, `role must be one of ${VALID_ROLES.join(', ')}`);
    }
    // Phase 4 — defensive normalisation. Reject malformed buyer/fpo
    // ids with 400 (was previously letting `Number("NaN")` -> NaN
    // reach Mongoose and surface as 500).
    const normalisedBuyerId = normaliseBuyerId(buyerId);
    if (normalisedBuyerId === undefined) {
      throw new AppError(
        400,
        'buyerId must be empty, a numeric id, a 24-char Mongo ObjectId, or a BUY-/B- publicId',
      );
    }
    const normalisedFpoId = normaliseFpoId(fpoId);
    if (normalisedFpoId === undefined) {
      throw new AppError(
        400,
        'fpoId must be empty, a numeric id, a 24-char Mongo ObjectId, or an FPO- publicId',
      );
    }

    let user = null;
    if (publicId) {
      user = await User.findOne({ publicId });
    }
    if (!user) {
      user = await User.create({
        publicId: UserId(),
        role,
        activeBuyerId: role === 'BUYER' ? normalisedBuyerId : null,
        activeFpoId: role === 'FPO' ? normalisedFpoId : null,
        displayName: defaultDisplayName(role, ''),
      });
    } else {
      user.role = role;
      if (role === 'BUYER') user.activeBuyerId = normalisedBuyerId;
      if (role === 'FPO') user.activeFpoId = normalisedFpoId;
      if (role === 'SELLER') {
        user.activeBuyerId = null;
        user.activeFpoId = null;
      }
      await user.save();
    }
    res.status(200).json(authResponse(user));
  })
);

/**
 * GET /api/auth/me — current user. 200 with `user:null` if anon.
 * Used by the frontend to re-hydrate auth on refresh.
 */
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    return res.json({ user: req.user.toRead() });
  })
);

router.post(
  '/switch-role',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError(401, 'login first');
    const { role, buyerId, fpoId } = req.body || {};
    if (!role || !VALID_ROLES.includes(role)) {
      throw new AppError(400, `role must be one of ${VALID_ROLES.join(', ')}`);
    }
    // Phase 4 — defensive validation. Was previously
    // `Number(buyerId)` which silently produced NaN for Mongo
    // ObjectId hex strings; Mongoose then threw a 500 "Cast to
    // Number failed" error.
    const normalisedBuyerId = normaliseBuyerId(buyerId);
    if (normalisedBuyerId === undefined) {
      throw new AppError(
        400,
        'buyerId must be empty, a numeric id, a 24-char Mongo ObjectId, or a BUY-/B- publicId',
      );
    }
    const normalisedFpoId = normaliseFpoId(fpoId);
    if (normalisedFpoId === undefined) {
      throw new AppError(
        400,
        'fpoId must be empty, a numeric id, a 24-char Mongo ObjectId, or an FPO- publicId',
      );
    }
    req.user.role = role;
    req.user.activeBuyerId = role === 'BUYER' ? normalisedBuyerId : null;
    req.user.activeFpoId = role === 'FPO' ? normalisedFpoId : null;
    if (role === 'SELLER') {
      req.user.activeBuyerId = null;
      req.user.activeFpoId = null;
    }
    await req.user.save();
    res.json({ user: req.user.toRead() });
  })
);

router.get(
  '/buyers',
  asyncHandler(async (_req, res) => {
    const list = await Buyer.find({}).sort({ createdAt: 1 });
    res.json({ results: list.map((b) => b.toRead()) });
  })
);

router.get(
  '/fpos',
  asyncHandler(async (_req, res) => {
    const list = await FPO.find({}).sort({ createdAt: 1 });
    res.json({ results: list.map((f) => f.toRead()) });
  })
);

module.exports = { router };
