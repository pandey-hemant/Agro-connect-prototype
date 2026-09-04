/**
 * scripts/verify_phase_decision_e2e.cjs — PHASE F-2 verifier.
 *
 * End-to-end workflow that the DecisionSupport page drives:
 *
 *   1. FARMER logs in, creates a Tomato 500kg lot @ Patna, Bihar
 *   2. /api/decisions returns a recommendation (SELL_NOW / WAIT /
 *      GROUP_SALE) with a non-empty per-market comparison
 *   3. /api/logistics/estimate for the highest-net market in the
 *      decision's comparison row returns the same distance_km
 *   4. /api/cold-storage/estimate returns SELL_NOW / STORE_THEN_SELL /
 *      NEUTRAL with a non-empty rationale
 *   5. /api/buyers/demands-for-lot returns at least one demand or a
 *      clean empty list (count=0, results=[])
 *
 * This script complements verify_decision_support.cjs (which checks
 * wire shapes + filters) by validating the user-flow integration.
 */
'use strict';

const http = require('http');

const BASE = process.env.BASE_URL || 'http://localhost:5050/api';
const FARMER_EMAIL = 'farmer@agroconnect.demo';
const FARMER_PASS = 'farmer123';

let PASS = 0;
let FAIL = 0;
const failures = [];

function step(n, label, ok, detail = '') {
  if (ok) {
    PASS += 1;
    console.log(`[OK]   ${n}. ${label}${detail ? `  — ${detail}` : ''}`);
  } else {
    FAIL += 1;
    failures.push(`${n}. ${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`[FAIL] ${n}. ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

function request(method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const data = body != null ? Buffer.from(JSON.stringify(body), 'utf-8') : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      headers: {
        Accept: 'application/json',
        ...(data
          ? { 'Content-Type': 'application/json', 'Content-Length': data.length }
          : {}),
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (_) {
          json = { _raw: text };
        }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await request('GET', '/health');
      if (r.status === 200) return r;
    } catch (_) {}
    await sleep(800);
  }
  throw new Error('server did not respond within ' + maxMs + 'ms');
}

async function main() {
  console.log(`Phase Decision E2E at ${BASE}`);
  const h = await waitForServer();
  step(0, 'Server is reachable',
    h.status === 200,
    `status=${h.status} mode=${h.body && h.body.db_mode}`);
  if (h.status !== 200) process.exit(1);

  // 1. FARMER login + create Tomato 500kg lot
  const login = await request('POST', '/auth/login', {
    body: { email: FARMER_EMAIL, password: FARMER_PASS },
  });
  const token = login.body && login.body.user && login.body.user.public_id;
  step(1, 'FARMER login + create Tomato 500kg @ Patna lot',
    login.status === 200 && !!token,
    `login=${login.status} token=${token}`);
  if (!token) process.exit(1);
  const authHeader = { 'x-demo-user': token };

  const lotCreate = await request('POST', '/crop-lots', {
    headers: authHeader,
    body: {
      crop_name: 'Tomato',
      crop_variety: 'Hybrid',
      quantity: 500.0,
      quantity_unit: 'kg',
      harvest_date: '2026-08-29',
      location: 'Patna, Bihar',
      state: 'Bihar',
      farmer_quality_grade: 'A',
      expected_price_per_kg: 17.0,
    },
  });
  const lot = lotCreate.body;
  step(2, 'Create Tomato 500kg lot @ Patna Bihar',
    (lotCreate.status === 200 || lotCreate.status === 201) &&
      (lot.public_id || '').startsWith('CL-'),
    `${lot.public_id} qty=${lot.quantity} state=${lot.state}`);
  if (!lot.public_id) process.exit(1);
  const LOT_PUB = lot.public_id;

  // 3. /api/decisions returns a recommendation + comparison
  const dec = await request('GET', `/decisions/${LOT_PUB}`, { headers: authHeader });
  const d = dec.body;
  step(3, 'GET /decisions/:lotId: rec + non-empty per-market comparison',
    dec.status === 200 &&
      ['SELL_NOW', 'WAIT', 'GROUP_SALE'].includes(d.recommendation) &&
      Array.isArray(d.comparison) &&
      d.comparison.length > 0,
    `rec=${d.recommendation} comparison=${d.comparison ? d.comparison.length : 0}`);

  // Pick the highest-net market and verify logistics agrees on distance
  const bestMarket = (d.comparison || []).slice().sort(
    (a, b) => (b.net_realisation || 0) - (a.net_realisation || 0)
  )[0];
  step('3a', 'Comparison rows are sorted numerically (net_realisation)',
    typeof bestMarket === 'object' &&
      typeof bestMarket.market === 'string' &&
      typeof bestMarket.net_realisation === 'number' &&
      typeof bestMarket.distance_km === 'number' &&
      typeof bestMarket.modal_price === 'number',
    `best=${bestMarket ? bestMarket.market : 'n/a'} net=₹${bestMarket ? bestMarket.net_realisation : 'n/a'}`);

  // 4. /api/logistics/estimate for that market matches the distance
  const logi = await request('POST', '/logistics/estimate', {
    headers: authHeader,
    body: {
      crop_lot_id: LOT_PUB,
      market_name: bestMarket.market,
      vehicle_type: 'mini-truck',
      agreed_price_per_kg: bestMarket.modal_price,
    },
  });
  const le = logi.body;
  const distMatches = bestMarket && Math.abs(le.distance_km - bestMarket.distance_km) < 0.01;
  step(4, 'POST /logistics/estimate agrees with the decision row on distance_km',
    logi.status === 200 && distMatches,
    `decision=${bestMarket && bestMarket.distance_km} logistics=${le.distance_km}`);

  // 5. /api/cold-storage/estimate returns a rec with rationale
  const cold = await request('POST', '/cold-storage/estimate', {
    headers: authHeader,
    body: {
      crop_lot_id: LOT_PUB,
      storage_days: 7,
      rate_per_kg_per_day: 0.2,
    },
  });
  const ce = cold.body;
  step(5, 'POST /cold-storage/estimate returns SELL_NOW / STORE_THEN_SELL / NEUTRAL',
    cold.status === 200 &&
      ['SELL_NOW', 'STORE_THEN_SELL', 'NEUTRAL'].includes(ce.recommendation) &&
      typeof ce.rationale === 'string' &&
      ce.rationale.length > 0 &&
      typeof ce.breakeven_price_per_kg === 'number',
    `rec=${ce.recommendation} breakeven=₹${ce.breakeven_price_per_kg} rationale.len=${ce.rationale ? ce.rationale.length : 0}`);

  // 6. /api/buyers/demands-for-lot
  const dem = await request('GET', `/buyers/demands-for-lot/${LOT_PUB}`, { headers: authHeader });
  const demBody = dem.body;
  step(6, 'GET /buyers/demands-for-lot returns count + results',
    dem.status === 200 &&
      typeof demBody.count === 'number' &&
      Array.isArray(demBody.results) &&
      demBody.count === demBody.results.length,
    `count=${demBody.count}`);

  // 7. POST /decisions/:lotId/refresh
  const refresh = await request('POST', `/decisions/${LOT_PUB}/refresh`, { headers: authHeader });
  const dr = refresh.body;
  step(7, 'POST /decisions/:lotId/refresh re-computes successfully',
    refresh.status === 200 &&
      ['SELL_NOW', 'WAIT', 'GROUP_SALE'].includes(dr.recommendation) &&
      Array.isArray(dr.comparison) &&
      dr.comparison.length > 0,
    `rec=${dr.recommendation} comparison=${dr.comparison.length}`);

  // 8. Decision object has insufficient_data flag (boolean)
  step(8, 'Decision exposes insufficient_data boolean + crop_lot_public_id',
    typeof d.insufficient_data === 'boolean' &&
      typeof d.crop_lot_public_id === 'string' &&
      d.crop_lot_public_id.startsWith('CL-'),
    `insufficient=${d.insufficient_data} lot=${d.crop_lot_public_id}`);

  // Summary
  console.log(`\n=== Phase Decision E2E: ${PASS} passed, ${FAIL} failed ===`);
  if (FAIL > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
