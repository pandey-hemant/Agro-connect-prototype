/**
 * routes/health.js — GET /api/health.
 *
 * Used by the frontend on boot to confirm the backend is up and to
 * detect which DB mode is active. Also doubles as a load-balancer
 * ping.
 */
'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { pingMongo, lastErrorMessage } = require('../db/connect');

const router = express.Router();

let mode = 'unknown';
function setMode(m) {
  mode = m;
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const dbUp = await pingMongo();
    res.status(dbUp ? 200 : 503).json({
      status: dbUp ? 'ok' : 'degraded',
      service: 'agroconnect-backend-node',
      version: '1.0.0',
      database: dbUp ? 'ok' : 'error',
      db_mode: mode,
      db_error: dbUp ? null : lastErrorMessage(),
      timestamp: new Date().toISOString(),
    });
  })
);

module.exports = { router, setMode };
