/**
 * services/marketPrice/pythonMlClient.js — thin HTTP client for the
 * Python XGBoost service.
 *
 * The Node backend already has a JS-only prediction engine
 * (mlPrediction.js). This client is the gateway to the Python
 * service so the rest of the Node code can call ONE function
 * (`callPythonPredict`) and get back the same envelope the JS
 * engine would have produced — or null on any failure.
 *
 * Failure modes (each one returns null so the caller falls back
 * to the JS engine; the user never sees a regression):
 *   - ML_SERVICE_URL is unset
 *   - service is down / refused
 *   - request times out (default 2.5s)
 *   - service returns a non-200 status
 *   - service returns an unexpected shape
 *
 * The Python service is read-only against MongoDB and never writes
 * back to the database. The Node service is the source of truth.
 */
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 2500;
const MAX_DAYS = 30;
const MIN_HISTORY_FLOOR = 2;
const MIN_HISTORY_CEIL = 60;

function _readEnv() {
  const raw = process.env.ML_SERVICE_URL || '';
  return raw.trim();
}

function _clamp(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function _post(urlObj, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const lib = urlObj.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method: 'POST',
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + (urlObj.search || ''),
        headers: {
          'content-type': 'application/json',
          'content-length': data.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (e) {
            reject(new Error(`invalid JSON: ${e.message}`));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.write(data);
    req.end();
  });
}

/**
 * Call the Python XGBoost service.
 *
 * @param {Object} params
 * @param {string} params.crop           required
 * @param {string|null} [params.state]   optional
 * @param {string|null} [params.market]  optional
 * @param {number} [params.days=7]       1..30
 * @param {number} [params.minHistoryDates=10]  2..60
 * @param {number} [params.timeoutMs=2500]      request timeout
 * @returns {Promise<Object|null>}  the prediction envelope, or null on failure
 */
async function callPythonPredict(params = {}) {
  const base = _readEnv();
  if (!base) return null;
  const { crop, state = null, market = null } = params;
  if (!crop) return null;

  const urlObj = (() => {
    try {
      return new URL('/predict', base);
    } catch (_) {
      return null;
    }
  })();
  if (!urlObj) return null;

  const days = _clamp(params.days, 1, MAX_DAYS, 7);
  const minHistory = _clamp(
    params.minHistoryDates,
    MIN_HISTORY_FLOOR,
    MIN_HISTORY_CEIL,
    10
  );
  const timeoutMs = _clamp(params.timeoutMs, 100, 10_000, DEFAULT_TIMEOUT_MS);

  const body = {
    crop: String(crop),
    state: state || null,
    market: market || null,
    days,
    min_history_dates: minHistory,
  };

  try {
    const env = await _post(urlObj, body, timeoutMs);
    if (!env || typeof env !== 'object') return null;
    if (typeof env.available !== 'boolean') return null;
    return env;
  } catch (_) {
    return null;
  }
}

async function callPythonHealth() {
  const base = _readEnv();
  if (!base) return null;
  const urlObj = (() => {
    try {
      return new URL('/health', base);
    } catch (_) {
      return null;
    }
  })();
  if (!urlObj) return null;
  try {
    return await _post(urlObj, {}, DEFAULT_TIMEOUT_MS);
  } catch (_) {
    return null;
  }
}

module.exports = { callPythonPredict, callPythonHealth };
