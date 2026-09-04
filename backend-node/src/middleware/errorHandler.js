/**
 * middleware/errorHandler.js — single point of error -> JSON conversion.
 *
 * Throwing `new AppError(status, message)` from anywhere produces
 * a clean `{ "detail": message }` JSON response. Mongoose errors
 * are mapped to 400/404. Anything else is 500.
 */
'use strict';

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.isAppError = true;
  }
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err && err.isAppError) {
    return res.status(err.status).json({ detail: err.message });
  }

  // Mongoose validation
  if (err && err.name === 'ValidationError') {
    const first = Object.values(err.errors || {})[0];
    return res
      .status(400)
      .json({ detail: first ? first.message : 'Validation error' });
  }

  // Mongoose cast (bad ObjectId / publicId)
  if (err && err.name === 'CastError') {
    return res.status(404).json({ detail: 'Not found' });
  }

  // Duplicate key (unique constraint)
  if (err && err.code === 11000) {
    return res.status(409).json({ detail: 'Duplicate value', keyValue: err.keyValue });
  }

  console.error('[error]', err && err.stack ? err.stack : err);
  return res.status(500).json({ detail: 'Internal server error' });
}

module.exports = { AppError, errorHandler };
