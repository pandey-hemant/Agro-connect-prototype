/**
 * app.js — express application factory.
 *
 * Wires up middlewares, mounts the /api router, and applies the global
 * error handler. Returns the app so server.js can .listen() it.
 */
'use strict';

const express = require('express');
const cors = require('cors');
const config = require('./config');
const { errorHandler } = require('./middleware/errorHandler');
const apiRouter = require('./routes');

function buildApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (config.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, true); // permissive for prototype; tighten in prod
      },
      credentials: false,
    })
  );

  // Lightweight request log — only first 5 chars of method+path to
  // keep noise down. Replace with morgan for prod.
  app.use((req, _res, next) => {
    if (process.env.LOG_REQUESTS === '1') {
      console.log(`[req] ${req.method} ${req.path}`);
    }
    next();
  });

  app.use('/api', apiRouter);

  // 404 for anything not under /api
  app.use((_req, res) => res.status(404).json({ detail: 'Not found' }));

  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
