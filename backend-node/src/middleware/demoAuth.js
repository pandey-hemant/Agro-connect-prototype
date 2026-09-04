/**
 * middleware/demoAuth.js — resolve the current user from either a JWT
 * (Authorization: Bearer ...) or the legacy X-Demo-User header.
 *
 * The JWT path is the new primary auth — the frontend stores the
 * token in localStorage as `agroconnect.auth.token.v1` and the axios
 * interceptor sends it on every request. The X-Demo-User header is
 * kept as a fallback so existing flows and verifier scripts work
 * unchanged.
 *
 * On success, attaches the full User document to `req.user`. On any
 * failure (no token, invalid token, user not found), sets
 * `req.user = null` and continues. Routes that require auth check
 * `req.user` themselves and return 401.
 */
'use strict';

const User = require('../models/User');
const { verifyToken } = require('../services/authService');

async function demoAuth(req, _res, next) {
  // 1. Try JWT first.
  const auth = req.header('Authorization') || req.header('authorization');
  let publicId = null;
  if (auth && /^Bearer\s+/.test(auth)) {
    const token = auth.replace(/^Bearer\s+/, '').trim();
    const payload = verifyToken(token);
    if (payload && payload.sub) {
      publicId = payload.sub;
    }
  }
  // 2. Fall back to the legacy X-Demo-User header.
  if (!publicId) {
    publicId = req.header('X-Demo-User');
  }
  if (!publicId) {
    req.user = null;
    return next();
  }
  try {
    const u = await User.findOne({ publicId });
    req.user = u || null;
  } catch (err) {
    req.user = null;
  }
  return next();
}

/**
 * requireAuth — guards a route, returning 401 when there's no user.
 * Use as `router.get('/foo', requireAuth, handler)` so unauthenticated
 * callers get a clear error.
 */
function requireAuth(req, _res, next) {
  if (!req.user) {
    const err = new Error('authentication required');
    err.statusCode = 401;
    err.status = 401;
    return next(err);
  }
  return next();
}

module.exports = demoAuth;
module.exports.requireAuth = requireAuth;
