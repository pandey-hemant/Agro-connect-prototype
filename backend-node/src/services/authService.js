/**
 * services/authService.js — JWT signing + verification.
 *
 * For the prototype we sign a small token containing only the user's
 * publicId. The role is read from the database on every request, so
 * the role cannot be tampered with on the client.
 *
 * In production we'd want a rotating refresh token, an explicit
 * revocation list, and secret rotation; the prototype just keeps it
 * simple.
 */
'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Get a secret from the env, or fall back to a stable dev-only one
// (so a server restart doesn't invalidate outstanding tokens during
// development). The fallback is hard-coded; it's NOT a secret in
// production. Set AUTH_JWT_SECRET in your .env for real deployments.
const SECRET =
  process.env.AUTH_JWT_SECRET ||
  'agroconnect-dev-only-secret-do-not-use-in-prod';

const TOKEN_TTL = process.env.AUTH_JWT_TTL || '30d';

function signToken(user) {
  if (!user || !user.publicId) {
    throw new Error('user.publicId is required to sign a token');
  }
  return jwt.sign(
    { sub: user.publicId, role: user.role },
    SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, SECRET);
    return decoded && decoded.sub ? decoded : null;
  } catch {
    return null;
  }
}

function hashToken(token) {
  // Useful if we ever want to invalidate a token by storing its hash.
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = { signToken, verifyToken, hashToken, SECRET };
