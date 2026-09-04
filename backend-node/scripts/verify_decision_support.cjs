/**
 * scripts/verify_decision_support.cjs — PHASE F-1 verifier.
 *
 * 12 checks covering the Decision Support wire-shape and end-to-end
 * flow added in PHASES A/B/D. Asserts the new snake_case keys the
 * React pages already consume.
 *
 *   1.  /api/market-prices/health: provider_configured, is_live flag
 *   2.  /api/market-prices: list returns rows with crop_name, market,
 *       modal_price, min_price, max_price, price_date, unit, source
 *   3.  /api/market-prices?crop=Tomato: only Tomato rows
 *   4.  /api/market-prices?state=Karnataka: only Karnataka rows
 *   5.  /api/market-prices?market=Azadpur: empty + fetched_at present
 *   6.  SELLER login + create a Tomato 100kg lot
 *   7.  POST /api/logistics/estimate: returns breakdown including
 *       destination_label, modal_price_per_kg
 *   8.  POST /api/cold-storage/estimate: returns recommendation +
 *       rationale + breakeven_price_per_kg
 *   9.  GET /api/decisions/:lotId: returns recommendation (SELL_NOW /
 *       WAIT / GROUP_SALE) and non-empty comparison[]
 *   10. POST /api/decisions/:lotId/refresh: re-computes successfully
 *   11. GET /api/buyers/demands-for-lot/:lotId: returns scored demands
 *       (results[].score, results[].reasons)
 *   12. /api/market-prices response never contains an API key (defensive
 *       security assertion)
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
        resolve({ status: res.statusCode, body: json, raw: text });
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
  console.log(`Verifying Decision Support at ${BASE}`);
  const h = await waitForServer();
  step(0, 'Server is reachable',
    h.status === 200,
    `status=${h.status} mode=${h.body && h.body.db_mode}`);
  if (h.status !== 200) process.exit(1);

  // ---------------- PHASE A: market prices ----------------
  const health = await request('GET', '/market-prices/health');
  step(1, '/market-prices/health: provider_configured + is_live present',
    health.status === 200 &&
      typeof health.body.provider_configured === 'boolean' &&
      typeof health.body.is_live === 'boolean',
    `configured=${health.body.provider_configured} is_live=${health.body.is_live} records=${health.body.records}`);

  const listAll = await request('GET', '/market-prices');
  const r0 = (listAll.body && listAll.body.results) || [];
  const rowShapeOk = r0.length > 0 && r0.every((r) =>
    typeof r.crop_name === 'string' &&
    typeof r.market === 'string' &&
    typeof r.modal_price === 'number' &&
    typeof r.min_price === 'number' &&
    typeof r.max_price === 'number' &&
    typeof r.price_date !== 'undefined' &&
    typeof r.unit === 'string' &&
    typeof r.source === 'string' &&
    typeof r.is_live === 'boolean'
  );
  step(2, '/market-prices: list rows have crop_name/market/min/modal/max/price_date/unit',
    listAll.status === 200 && r0.length >= 1 && rowShapeOk,
    `count=${listAll.body && listAll.body.count} first=${r0[0] ? r0[0].crop_name + '@' + r0[0].market : 'none'}`);

  // Check envelope extras
  step('2a', '/market-prices envelope has source/is_live/count/note/unit/fetched_at',
    listAll.status === 200 &&
      typeof listAll.body.source === 'string' &&
      typeof listAll.body.is_live === 'boolean' &&
      typeof listAll.body.count === 'number' &&
      typeof listAll.body.unit === 'string' &&
      typeof listAll.body.fetched_at === 'string' &&
      !Number.isNaN(Date.parse(listAll.body.fetched_at)),
    `source=${listAll.body.source} unit=${listAll.body.unit} fetched_at=${listAll.body.fetched_at}`);

  const listTomato = await request('GET', '/market-prices?crop=Tomato');
  const tRows = (listTomato.body && listTomato.body.results) || [];
  step(3, '?crop=Tomato: only Tomato rows',
    listTomato.status === 200 &&
      tRows.length > 0 &&
      tRows.every((r) => r.crop_name.toLowerCase() === 'tomato'),
    `${tRows.length} rows`);

  const listKar = await request('GET', '/market-prices?state=Karnataka');
  const kRows = (listKar.body && listKar.body.results) || [];
  step(4, '?state=Karnataka: only Karnataka rows',
    listKar.status === 200 &&
      kRows.length > 0 &&
      kRows.every((r) => r.state.toLowerCase() === 'karnataka'),
    `${kRows.length} rows`);

  const listEmpty = await request('GET', '/market-prices?market=Azadpur');
  step(5, '?market=Azadpur: empty + fetched_at + note',
    listEmpty.status === 200 &&
      Array.isArray(listEmpty.body.results) &&
      listEmpty.body.results.length === 0 &&
      typeof listEmpty.body.fetched_at === 'string' &&
      typeof listEmpty.body.note === 'string',
    `count=${listEmpty.body.count} fetched_at=${listEmpty.body.fetched_at}`);

  // ---------------- Login + lot creation ----------------
  const login = await request('POST', '/auth/login', {
    body: { email: FARMER_EMAIL, password: FARMER_PASS },
  });
  const token = login.body && login.body.user && login.body.user.public_id;
  step(6, 'FARMER login + create Tomato 100kg lot',
    login.status === 200 && !!token,
    `login=${login.status} token=${token}`);
  if (!token) {
    console.log('FATAL: cannot log in; aborting');
    process.exit(1);
  }
  const authHeader = { 'x-demo-user': token };
  const lotCreate = await request('POST', '/crop-lots', {
    headers: authHeader,
    body: {
      crop_name: 'Tomato',
      crop_variety: 'Hybrid',
      quantity: 100.0,
      quantity_unit: 'kg',
      harvest_date: '2026-08-29',
      location: 'Patna, Bihar',
      state: 'Bihar',
      farmer_quality_grade: 'A',
      expected_price_per_kg: 17.0,
    },
  });
  const lot = lotCreate.body;
  step('6a', 'Create Tomato 100kg lot (Tomato/100kg @ Patna)',
    (lotCreate.status === 200 || lotCreate.status === 201) &&
      (lot.public_id || '').startsWith('CL-'),
    `${lot.public_id} qty=${lot.quantity}`);
  if (!lot.public_id) {
    console.log('FATAL: no lot public_id; aborting');
    process.exit(1);
  }
  const LOT_PUB = lot.public_id;
  const LOT_ID = lot.id;

  // ---------------- PHASE B: logistics ----------------
  const logi = await request('POST', '/logistics/estimate', {
    headers: authHeader,
    body: {
      crop_lot_id: LOT_PUB,
      market_name: 'Bengaluru APMC',
      destination_label: 'Bengaluru APMC',
      vehicle_type: 'mini-truck',
      agreed_price_per_kg: 15,
    },
  });
  const le = logi.body;
  step(7, 'POST /logistics/estimate returns breakdown w/ destination_label',
    logi.status === 200 &&
      typeof le.distance_km === 'number' &&
      typeof le.transport_cost === 'number' &&
      typeof le.total_logistics_cost === 'number' &&
      typeof le.net_realization === 'number' &&
      typeof le.destination_label === 'string' &&
      (le.destination_market === 'Bengaluru APMC' || le.market_name === 'Bengaluru APMC'),
    `dist=${le.distance_km} total=${le.total_logistics_cost} dest=${le.destination_label}`);

  // ---------------- PHASE C: cold storage ----------------
  const cold = await request('POST', '/cold-storage/estimate', {
    headers: authHeader,
    body: {
      crop_lot_id: LOT_PUB,
      storage_days: 5,
      rate_per_kg_per_day: 0.2,
    },
  });
  const ce = cold.body;
  step(8, 'POST /cold-storage/estimate returns rec + rationale + breakeven',
    cold.status === 200 &&
      ['SELL_NOW', 'STORE_THEN_SELL', 'NEUTRAL'].includes(ce.recommendation) &&
      typeof ce.rationale === 'string' &&
      typeof ce.breakeven_price_per_kg === 'number',
    `rec=${ce.recommendation} breakeven=₹${ce.breakeven_price_per_kg}`);

  // ---------------- PHASE D: decision support ----------------
  const dec = await request('GET', `/decisions/${LOT_PUB}`, { headers: authHeader });
  const d = dec.body;
  step(9, 'GET /decisions/:lotId returns rec + non-empty comparison',
    dec.status === 200 &&
      ['SELL_NOW', 'WAIT', 'GROUP_SALE'].includes(d.recommendation) &&
      Array.isArray(d.comparison) &&
      d.comparison.length > 0 &&
      typeof d.crop_lot_public_id === 'string' &&
      d.crop_lot_public_id.startsWith('CL-'),
    `rec=${d.recommendation} comparison=${d.comparison.length} crop_lot_public_id=${d.crop_lot_public_id}`);
  step('9a', 'Decision row wire shape: market/state/modal_price/distance_km/total_logistics_cost/net_realisation',
    d.comparison && d.comparison.every((r) =>
      typeof r.market === 'string' &&
      typeof r.modal_price === 'number' &&
      typeof r.distance_km === 'number' &&
      typeof r.total_logistics_cost === 'number' &&
      typeof r.net_realisation === 'number'
    ),
    `first=${d.comparison && d.comparison[0] ? d.comparison[0].market : 'n/a'}`);

  const refresh = await request('POST', `/decisions/${LOT_PUB}/refresh`, { headers: authHeader });
  const dr = refresh.body;
  step(10, 'POST /decisions/:lotId/refresh re-computes and returns rec + comparison',
    refresh.status === 200 &&
      ['SELL_NOW', 'WAIT', 'GROUP_SALE'].includes(dr.recommendation) &&
      Array.isArray(dr.comparison) &&
      dr.comparison.length > 0,
    `rec=${dr.recommendation} comparison=${dr.comparison.length}`);

  // ---------------- PHASE E: buyer demands ----------------
  const dem = await request('GET', `/buyers/demands-for-lot/${LOT_PUB}`, { headers: authHeader });
  const demBody = dem.body;
  step(11, 'GET /buyers/demands-for-lot/:publicId returns scored results',
    dem.status === 200 &&
      Array.isArray(demBody.results) &&
      (demBody.count === demBody.results.length) &&
      (demBody.results.length === 0 ||
        demBody.results.every((d2) => typeof d2.score === 'number' && Array.isArray(d2.reasons))),
    `count=${demBody.count} keys=${demBody.results[0] ? Object.keys(demBody.results[0]).sort().slice(0, 8).join(',') : 'n/a'}`);

  // ---------------- Security: no API key leak ----------------
  const apiKey = process.env.DATA_GOV_IN_API_KEY || '';
  const anyKeyLeak = (s) => apiKey && s.includes(apiKey);
  const leakList = anyKeyLeak(JSON.stringify(listAll.body || {})) ||
                   anyKeyLeak(JSON.stringify(listTomato.body || {})) ||
                   anyKeyLeak(JSON.stringify(listKar.body || {})) ||
                   anyKeyLeak(JSON.stringify(listEmpty.body || {})) ||
                   anyKeyLeak(JSON.stringify(health.body || {}));
  step(12, '/market-prices never echoes the DATA_GOV_IN_API_KEY',
    !leakList,
    apiKey
      ? `key length=${apiKey.length}; checked 5 responses`
      : 'no key configured (trivially true)');

  // ---------------- Summary ----------------
  console.log(`\n=== Decision Support verifier: ${PASS} passed, ${FAIL} failed ===`);
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
