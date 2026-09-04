/**
 * middleware/asyncHandler.js — wrap async route handlers so thrown
 * errors reach the global error handler.
 */
'use strict';

module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
