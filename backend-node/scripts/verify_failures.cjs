/**
 * scripts/verify_failures.cjs — backend failure scenarios.
 *
 * These tests confirm the backend is robust to common external-failure
 * modes and does NOT crash:
 *
 *   F1. Health responds when DB is up.
 *   F2. /api/market-prices/health works even when no API key is set.
 *   F3. /api/crop-lots/available returns 200 even with zero data.
 *   F4. GET on a missing crop lot returns 404 (not 500).
 *   F5. POST an offer on a non-existent lot returns 4xx (not 500).
 *   F6. Double-accept of an offer is idempotent (returns 200 with
 *       already_accepted=true), not a crash.
 *   F7. Creating an FPO with the same name twice succeeds (no crash).
 *
 * The backend must be running on http://localhost:5050.
 */
'use strict';

const http = require('http');

const BASE = process.env.BASE_URL || 'http://localhost:5050/api';
let PASS = 0;
let FAIL = 0;

function step(n, label, ok, detail = '') {
  if (ok) {
    PASS += 1;
    console.log(`[OK]   ${n}. ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    FAIL += 1;
    console.log(`[FAIL] ${n}. ${label}${detail ? ' — ' + detail : ''}`);
  }
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const data = body ? Buffer.from(JSON.stringify(body), 'utf-8') : null;
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        headers: {
          Accept: 'application/json',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        },
      },
      (res) => {
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch (_) { json = { _raw: text }; }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // F1
  const h = await request('GET', '/health');
  step('F1', 'Health responds (200/503, no crash)', h.status === 200 || h.status === 503,
    `status=${h.status} db=${h.body && h.body.database}`);

  // F2
  const mh = await request('GET', '/market-prices/health');
  step('F2', 'Market prices health works without API key',
    mh.status === 200 && mh.body && mh.body.provider_name,
    `provider=${mh.body && mh.body.provider_name}`);

  // F3
  const av = await request('GET', '/crop-lots/available');
  step('F3', 'Marketplace returns 200 even with any data state',
    av.status === 200,
    `count=${(av.body && av.body.results || []).length}`);

  // F4
  const nf = await request('GET', '/crop-lots/CL-DOESNOTEXIST123');
  step('F4', 'Missing crop lot returns 404 (not 500)', nf.status === 404,
    `status=${nf.status}`);

  // F5
  const inv = await request('POST', '/offers', {
    crop_lot_id: '507f1f77bcf86cd799439011', // valid ObjectId but no such lot
    buyer_id: '507f1f77bcf86cd799439012',
    price: 10, quantity: 10,
  });
  step('F5', 'Offer on missing lot returns 4xx (not 500)', inv.status >= 400 && inv.status < 500,
    `status=${inv.status} detail=${inv.body && inv.body.detail}`);

  // F6: create+accept+accept-again (idempotent)
  const cl = await request('POST', '/crop-lots', {
    crop_name: 'Potato', quantity: 100, quantity_unit: 'kg', location: 'Agra, Uttar Pradesh', state: 'Uttar Pradesh', expected_price_per_kg: 12,
  });
  const lot = cl.body;
  const sb = await request('POST', '/buyers/seed-demo', {});
  const lb = await request('GET', '/buyers');
  const buyer = ((lb.body && lb.body.results) || [])[0];
  const oo = await request('POST', '/offers', {
    crop_lot_id: lot.id, buyer_id: buyer.id, price: 10, quantity: 100, message: 'failtest',
  });
  const off = oo.body;
  const a1 = await request('POST', `/offers/${off.public_id}/accept`, { actor: 'BUYER' });
  const a2 = await request('POST', `/offers/${off.public_id}/accept`, { actor: 'BUYER' });
  step('F6', 'Double-accept is idempotent (no crash)',
    a1.status === 200 && a2.status === 200 && a2.body && a2.body.already_accepted === true,
    `a1=${a1.status} a2=${a2.status} already=${a2.body && a2.body.already_accepted}`);

  // F7
  const f1 = await request('POST', '/fpos', { name: 'Duplicate Test FPO' });
  const f2 = await request('POST', '/fpos', { name: 'Duplicate Test FPO' });
  step('F7', 'Creating duplicate FPO succeeds (no unique-name constraint crash)',
    f1.status === 201 && f2.status === 201,
    `f1=${f1.status} f2=${f2.status}`);

  console.log('');
  console.log(`=== ${PASS} passed, ${FAIL} failed ===`);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
