/**
 * scripts/verify_phase5_endpoints.cjs — Phase 5 endpoint checks.
 *
 * Boots up no server of its own. Assumes a running server on
 * http://localhost:5050 (or BASE_URL). Exercises:
 *
 *   1.  GET /api/market-prices            (existing) — baseline
 *   2.  GET /api/market-prices/history    (existing) — bucket series
 *   3.  GET /api/market-prices/prediction (existing) — linear baseline
 *   4.  GET /api/market-prices/prediction-ml (new)   — ML with comparison
 *   5.  GET /api/market-prices/history/series (new)  — daily series
 *   6.  GET /api/decisions/:lotId         (existing + Phase 5)
 *
 * Existing behaviour must be unchanged. New endpoints must return
 * 200 with a useful shape. The decision doc must now carry
 * prediction_trend / prediction_method.
 */
'use strict';

const http = require('http');

const BASE = process.env.BASE_URL || 'http://localhost:5050/api';

let PASS = 0;
let FAIL = 0;
const failures = [];

function step(n, label, ok, detail = '') {
  if (ok) { PASS += 1; console.log(`[OK]   ${n}. ${label}${detail ? '  — ' + detail : ''}`); }
  else { FAIL += 1; failures.push(`${n}. ${label}${detail ? ' — ' + detail : ''}`); console.log(`[FAIL] ${n}. ${label}${detail ? '  — ' + detail : ''}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Default per-request timeout (ms). The /decisions endpoint fans out
// to N market rows × logistics routing calls, so the response can be
// slow on first hit. We still cap it so the verifier cannot hang
// forever — a 45s ceiling is long enough for any realistic compute.
const DEFAULT_REQUEST_TIMEOUT_MS = 45000;

function request(method, urlPath, body, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const data = body ? Buffer.from(JSON.stringify(body), 'utf-8') : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      headers: {
        Accept: 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
    };
    let req = null;
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (req) req.destroy(); } catch (_) {}
      fn(arg);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error(`request timed out after ${timeoutMs}ms: ${method} ${urlPath}`));
    }, timeoutMs);
    req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = { _raw: text }; }
        finish(resolve, { status: res.statusCode, body: json });
      });
      res.on('error', (e) => finish(reject, e));
    });
    req.on('error', (e) => finish(reject, e));
    if (data) req.write(data);
    req.end();
  });
}

async function waitForServer(maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await request('GET', '/health', null, 5000);
      if (r.status === 200 || r.status === 503) return r;
    } catch (_) {}
    await sleep(1000);
  }
  throw new Error('server did not respond within ' + maxMs + 'ms');
}

async function main() {
  await waitForServer();
  console.log('[verify] server is up.');

  // 1. baseline /api/market-prices
  {
    const r = await request('GET', '/market-prices?crop=Tomato');
    step(1, '/market-prices?crop=Tomato returns 200 with results[]',
      r.status === 200 && r.body && Array.isArray(r.body.results),
      `status=${r.status} count=${r.body && r.body.count}`);
  }

  // 2. /history (existing) — must still work
  {
    const r = await request('GET', '/market-prices/history?crop=Tomato&granularity=weekly');
    step(2, '/market-prices/history returns 200 with results[]',
      r.status === 200 && r.body && Array.isArray(r.body.results),
      `status=${r.status} buckets=${r.body && r.body.total_buckets}`);
  }

  // 3. /prediction (existing) — must still work
  {
    const r = await request('GET', '/market-prices/prediction?crop=Tomato&days=7');
    const has = r.status === 200 && r.body && (r.body.available === true || r.body.available === false);
    step(3, '/market-prices/prediction returns 200 with available:bool',
      has, `status=${r.status} available=${r.body && r.body.available}`);
  }

  // 4. /prediction-ml (new)
  {
    const r = await request('GET', '/market-prices/prediction-ml?crop=Tomato&days=7');
    const ok = r.status === 200 && r.body && Array.isArray(r.body.candidates) && r.body.candidates.length === 3;
    step(4, '/market-prices/prediction-ml returns 200 with 3 candidates',
      ok, `status=${r.status} chosen=${r.body && r.body.method} available=${r.body && r.body.available}`);
  }

  // 5. /history/series (new)
  {
    const r = await request('GET', '/market-prices/history/series?crop=Tomato&limit=200');
    const ok = r.status === 200 && r.body && Array.isArray(r.body.points);
    step(5, '/market-prices/history/series returns 200 with points[]',
      ok, `status=${r.status} count=${r.body && r.body.count}`);
  }

  // 5b. /history/series — missing crop → 400
  {
    const r = await request('GET', '/market-prices/history/series');
    step(5.5, '/market-prices/history/series without crop returns 400',
      r.status === 400, `status=${r.status}`);
  }

  // 6. /decisions/:lotId — find a known lot first
  // The /crop-lots endpoint returns snake_case wire format
  // (public_id, not publicId) per CropLot.toRead().
  let lots = null;
  try {
    lots = await request('GET', '/crop-lots?limit=1');
  } catch (err) {
    step(6, '/crop-lots lookup failed', false, String(err && err.message ? err.message : err));
    lots = null;
  }
  let lotId = null;
  if (lots && lots.status === 200 && lots.body && Array.isArray(lots.body.results) && lots.body.results[0]) {
    lotId = lots.body.results[0].public_id || lots.body.results[0].publicId || lots.body.results[0]._id;
  } else if (lots && lots.status === 200 && Array.isArray(lots.body) && lots.body[0]) {
    lotId = lots.body[0].public_id || lots.body[0].publicId || lots.body[0]._id;
  }
  if (lotId) {
    // Wrap in try/catch: if the /decisions call times out (slow
    // computeDecision fan-out) or otherwise throws, we want a
    // recorded FAIL — not an unhandled promise rejection that
    // aborts the verifier before the final count line is printed.
    try {
      const r = await request('GET', `/decisions/${encodeURIComponent(lotId)}`);
      const okShape = r.status === 200 && r.body && (r.body.decision || r.body.recommendation);
      const hasPredFields = r.body && (
        r.body.prediction_trend !== undefined &&
        r.body.prediction_method !== undefined
      );
      step(6, `/decisions/${lotId} returns 200 with decision + prediction fields`,
        okShape && hasPredFields,
        `status=${r.status} decision=${r.body && (r.body.decision || r.body.recommendation)} trend=${r.body && r.body.prediction_trend}`);
    } catch (err) {
      step(6, `/decisions/${lotId} returned error`,
        false, String(err && err.message ? err.message : err));
    }
  } else {
    step(6, 'no crop lot available to test /decisions', false, 'no lots');
  }

  console.log('');
  console.log(`=== ${PASS} passed, ${FAIL} failed ===`);
  if (FAIL > 0) {
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[verify] fatal:', err);
  process.exit(99);
});
