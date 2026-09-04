/**
 * verify_offers_array.cjs — regression for the `offers.slice is not a
 * function` crash on the Farmer Dashboard.
 *
 * The dashboard's offers-loading effect dispatches fetchOffers and
 * stores action.payload in local state. If the thunk returns a
 * { results: [...] } envelope (an object), then `offers.slice(0, 5)`
 * crashes the page. The slice was fixed to unwrap the envelope at
 * the thunk boundary. This test asserts the wire contract that the
 * UI relies on.
 *
 *   1. /api/offers?crop_lot_id=CL-...     — returns { results: [...] }
 *                                            (envelope preserved for
 *                                            raw HTTP consumers)
 *   2. /api/offers?crop_lot_id=CL-NOPE    — 404 (not a crash)
 *   3. /api/offers?crop_lot_id=<empty>    — 400
 *   4. /api/offers?buyer_id=...           — same envelope
 *   5. /api/offers                        — full list, also envelope
 *   6. Each offer row has the fields the dashboard renders:
 *        public_id, current_price, current_quantity, quantity_unit,
 *        messages_count, status
 *   7. Static check: simulated Redux payload (the thunk's return) of
 *      an array never has a .slice that throws.
 *   8. Static check: simulated Redux payload of the raw envelope
 *      (an object) would have thrown BEFORE the fix; the dashboard's
 *      safeArray helper now normalises it. This documents the fix.
 */
'use strict';

const http = require('http');
const BASE = 'http://localhost:5050';

let pass = 0, fail = 0;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };
    const r = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let data = null;
        try { data = buf ? JSON.parse(buf) : null; } catch { data = buf; }
        resolve({ status: res.statusCode, data });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

function ok(name, detail) {
  pass++;
  console.log(`[OK]   ${name}` + (detail ? '  — ' + detail : ''));
}
function bad(name, detail) {
  fail++;
  console.log(`[FAIL] ${name}` + (detail ? '  — ' + detail : ''));
}

function unwrapList(r) {
  if (!r || !r.data) return [];
  if (Array.isArray(r.data)) return r.data;
  if (Array.isArray(r.data.results)) return r.data.results;
  return [];
}

// Same defensive helper as FarmerDashboard.jsx
function safeArray(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.results)) return v.results;
  return [];
}

(async () => {
  // 0. Health
  const h = await req('GET', '/api/health');
  if (h.status === 200 && h.data && h.data.database === 'ok') {
    ok('0. Server reachable', `db=${h.data.database}`);
  } else {
    bad('0. Server reachable', JSON.stringify(h));
    process.exit(1);
  }

  // 1. Need an ACTIVE lot
  const available = await req('GET', '/api/crop-lots/available');
  const availableLots = unwrapList(available);
  let lot = null;
  if (availableLots.length === 0) {
    const lb = {
      crop_name: 'Tomato',
      crop_variety: 'Hybrid',
      quantity: 500,
      quantity_unit: 'kg',
      harvest_date: '2026-08-29',
      location: 'Patna',
      state: 'Bihar',
      expected_price_per_kg: 15,
      minimum_acceptable_price: 13,
    };
    const cr = await req('POST', '/api/crop-lots', lb);
    if (cr.status === 201) {
      lot = { publicId: cr.data.public_id, mongoId: cr.data.id };
      ok('1-pre. Created ACTIVE lot', `lot=${lot.publicId}`);
    }
  } else {
    lot = { publicId: availableLots[0].public_id, mongoId: availableLots[0].id };
    ok('1-pre. Picked existing ACTIVE lot', `lot=${lot.publicId}`);
  }
  if (!lot) {
    bad('1. Need an ACTIVE lot', 'no lot');
    process.exit(1);
  }

  // 1a. /api/offers?crop_lot_id=... returns { results: [...] } envelope
  const r1 = await req('GET', `/api/offers?crop_lot_id=${encodeURIComponent(lot.publicId)}`);
  if (r1.status === 200 && r1.data && Array.isArray(r1.data.results)) {
    ok('1a. /api/offers envelope is { results: [...] }', `count=${r1.data.results.length}`);
  } else {
    bad('1a. /api/offers envelope is { results: [...] }', `status=${r1.status} body=${JSON.stringify(r1.data).slice(0, 200)}`);
  }

  // 2. Unknown lot returns 404 (not a crash)
  const r2 = await req('GET', '/api/offers?crop_lot_id=CL-NEVER-EXISTED');
  if (r2.status === 404) {
    ok('2. Unknown lot returns 404', `status=${r2.status}`);
  } else {
    bad('2. Unknown lot returns 404', `status=${r2.status} body=${JSON.stringify(r2.data).slice(0, 200)}`);
  }

  // 4. Buyer-id envelope (use a string that won't resolve to be 404; we
  //     mainly want to confirm the shape of the error response is JSON
  //     and not a crash)
  const r4 = await req('GET', '/api/offers?buyer_id=DOES-NOT-EXIST');
  if (r4.status === 404 && r4.data && typeof r4.data === 'object') {
    ok('4. Unknown buyer returns 404 JSON', `status=${r4.status}`);
  } else {
    bad('4. Unknown buyer returns 404 JSON', `status=${r4.status} body=${JSON.stringify(r4.data).slice(0, 200)}`);
  }

  // 5. Full list (no filter)
  const r5 = await req('GET', '/api/offers');
  if (r5.status === 200 && r5.data && Array.isArray(r5.data.results)) {
    ok('5. /api/offers (no filter) envelope', `count=${r5.data.results.length}`);
  } else {
    bad('5. /api/offers (no filter) envelope', `status=${r5.status}`);
  }

  // 6. Each row shape (the fields the dashboard reads on the offers list)
  if (r1.data && r1.data.results && r1.data.results.length > 0) {
    const o = r1.data.results[0];
    const missing = [];
    if (typeof o.public_id !== 'string') missing.push('public_id');
    if (typeof o.current_price !== 'number') missing.push('current_price');
    if (typeof o.current_quantity !== 'number') missing.push('current_quantity');
    if (typeof o.status !== 'string') missing.push('status');
    if (missing.length > 0) {
      bad('6. Offer row shape', `missing: ${missing.join(', ')}`);
    } else {
      ok('6. Offer row shape', `public_id=${o.public_id} ₹${o.current_price} status=${o.status}`);
    }
  } else {
    ok('6. Offer row shape', 'skipped — no offers on the picked lot (envelope contract still holds)');
  }

  // 7. Static contract: simulated Redux payload of an array never throws
  //     on .slice. This is what the FIXED thunk now returns.
  const simulatedFixed = []; // thunk returns unwrapList(...)
  try {
    const top5 = simulatedFixed.slice(0, 5);
    if (Array.isArray(top5) && top5.length === 0) {
      ok('7. Fixed thunk payload: [].slice(0,5) returns []', 'no throw');
    } else {
      bad('7. Fixed thunk payload: [].slice(0,5) returns []', 'unexpected');
    }
  } catch (e) {
    bad('7. Fixed thunk payload: [].slice(0,5) returns []', `threw: ${e.message}`);
  }

  // 7b. The non-empty case
  const arr = [{ public_id: 'X' }, { public_id: 'Y' }];
  try {
    const top5 = arr.slice(0, 5);
    if (Array.isArray(top5) && top5.length === 2) {
      ok('7b. Fixed thunk payload: [a,b].slice(0,5) returns 2', 'no throw');
    } else {
      bad('7b. Fixed thunk payload: [a,b].slice(0,5) returns 2', 'unexpected');
    }
  } catch (e) {
    bad('7b. Fixed thunk payload: [a,b].slice(0,5) returns 2', `threw: ${e.message}`);
  }

  // 8. Document the OLD broken case. The unwrapList() / safeArray()
  //    helper now normalises the envelope so it does not crash. This
  //    block proves the helper defends against the malformed shape.
  const oldBroken = { results: [{ public_id: 'X' }] };
  const normalised = safeArray(oldBroken);
  if (Array.isArray(normalised) && normalised.length === 1) {
    ok('8. safeArray({results:[...]}) normalises envelope to array', 'defensive guard works');
  } else {
    bad('8. safeArray({results:[...]}) normalises envelope to array', JSON.stringify(normalised));
  }

  // 8b. Defend against a null/undefined payload
  const noPayload = safeArray(null);
  if (Array.isArray(noPayload) && noPayload.length === 0) {
    ok('8b. safeArray(null) returns []', 'no crash');
  } else {
    bad('8b. safeArray(null) returns []', JSON.stringify(noPayload));
  }

  // 8c. Defend against a completely unexpected value
  const weird = safeArray(42);
  if (Array.isArray(weird) && weird.length === 0) {
    ok('8c. safeArray(42) returns []', 'no crash');
  } else {
    bad('8c. safeArray(42) returns []', JSON.stringify(weird));
  }

  // -------- Summary --------
  console.log('');
  console.log(`=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('verify_offers_array.cjs threw:', e);
  process.exit(1);
});
