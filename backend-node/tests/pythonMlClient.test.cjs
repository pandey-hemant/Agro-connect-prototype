/**
 * tests/pythonMlClient.test.cjs — unit test for the Python ML client.
 *
 * Verifies that the Node client behaves correctly across the
 * failure modes that matter at runtime:
 *
 *   - ML_SERVICE_URL unset → returns null (no throw)
 *   - ML_SERVICE_URL invalid → returns null (no throw)
 *   - service down / refused → returns null within the timeout
 *   - service returns non-200 → returns null
 *   - service returns malformed body → returns null
 *   - service returns a valid envelope → returns the envelope
 *
 * The test uses Node's built-in http module to spin up a tiny
 * stub server on 127.0.0.1:0 so it does not depend on the real
 * Python service.
 */
'use strict';

const assert = require('assert');
const http = require('http');
const { callPythonPredict, callPythonHealth } = require('../src/services/marketPrice/pythonMlClient');

function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          handler(req, res, parsed);
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ srv, url: `http://127.0.0.1:${port}` });
    });
  });
}

function stop(srv) {
  return new Promise((r) => srv.close(r));
}

async function withUrl(url, fn) {
  const prev = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = url;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.ML_SERVICE_URL;
    else process.env.ML_SERVICE_URL = prev;
  }
}

async function test_unset_url_returns_null() {
  const prev = process.env.ML_SERVICE_URL;
  delete process.env.ML_SERVICE_URL;
  try {
    const r = await callPythonPredict({ crop: 'Onion' });
    assert.strictEqual(r, null);
  } finally {
    if (prev !== undefined) process.env.ML_SERVICE_URL = prev;
  }
}

async function test_invalid_url_returns_null() {
  await withUrl('not-a-url', async () => {
    const r = await callPythonPredict({ crop: 'Onion' });
    assert.strictEqual(r, null);
  });
}

async function test_refused_connection_returns_null() {
  // Use a port we know is closed.
  await withUrl('http://127.0.0.1:1', async () => {
    const r = await callPythonPredict({ crop: 'Onion', timeoutMs: 500 });
    assert.strictEqual(r, null);
  });
}

async function test_non_200_returns_null() {
  const { srv, url } = await startServer((_req, res) => {
    res.statusCode = 503;
    res.end('{"error":"down"}');
  });
  try {
    await withUrl(url, async () => {
      const r = await callPythonPredict({ crop: 'Onion' });
      assert.strictEqual(r, null);
    });
  } finally {
    await stop(srv);
  }
}

async function test_malformed_body_returns_null() {
  const { srv, url } = await startServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end('not json');
  });
  try {
    await withUrl(url, async () => {
      const r = await callPythonPredict({ crop: 'Onion' });
      assert.strictEqual(r, null);
    });
  } finally {
    await stop(srv);
  }
}

async function test_valid_envelope_returned() {
  const envelope = {
    available: true,
    is_estimate: true,
    disclaimer: 'test',
    method: 'xgboost',
    crop: 'Onion',
    state: 'Maharashtra',
    market: null,
    distinct_dates: 200,
    holdout_days: 0,
    source_used: 'agmarknet',
    confidence: 'high',
    trend_direction: 'up',
    historical_min: 12.0,
    historical_max: 38.0,
    current_price: 22.5,
    history_summary: {
      first_date: '2025-01-01',
      last_date: '2026-09-07',
      last_avg: 22.5,
      min: 12.0,
      max: 38.0,
    },
    candidates: [],
    chosen: { method: 'xgboost', in_sample_mae: 0.3 },
    projection: [
      { day: 1, date: '2026-09-08', chosen_method: 'xgboost', chosen_point: 22.7, low: 22.2, high: 23.2, candidates: { xgboost: 22.7 } },
    ],
  };
  const { srv, url } = await startServer((_req, res, body) => {
    // Echo back what we got, embedded in the canonical envelope.
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ...envelope, _echo: body }));
  });
  try {
    await withUrl(url, async () => {
      const r = await callPythonPredict({
        crop: 'Onion',
        state: 'Maharashtra',
        days: 7,
        minHistoryDates: 10,
      });
      assert.ok(r, 'expected non-null result');
      assert.strictEqual(r.available, true);
      assert.strictEqual(r.method, 'xgboost');
      assert.strictEqual(r.crop, 'Onion');
      assert.strictEqual(r.projection.length, 1);
      assert.strictEqual(r._echo.crop, 'Onion');
      assert.strictEqual(r._echo.days, 7);
    });
  } finally {
    await stop(srv);
  }
}

async function test_unavailable_envelope_returned() {
  const { srv, url } = await startServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        available: false,
        method: null,
        is_estimate: true,
        disclaimer: 'x',
        message: 'no model',
        crop: 'Onion',
        state: 'Maharashtra',
        market: null,
        distinct_dates: 0,
        min_history_dates_required: 10,
        source_used: 'none',
        confidence: 'none',
        trend_direction: 'unknown',
        historical_min: null,
        historical_max: null,
        current_price: null,
        history_summary: null,
        candidates: [],
        chosen: null,
        projection: [],
      })
    );
  });
  try {
    await withUrl(url, async () => {
      const r = await callPythonPredict({ crop: 'Onion' });
      assert.ok(r);
      assert.strictEqual(r.available, false);
    });
  } finally {
    await stop(srv);
  }
}

async function test_health_endpoint_round_trip() {
  const { srv, url } = await startServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, models_loaded: 4, n_models: 4, disclaimer: 'x', mongo_ok: true }));
  });
  try {
    await withUrl(url, async () => {
      const r = await callPythonHealth();
      assert.ok(r);
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.n_models, 4);
    });
  } finally {
    await stop(srv);
  }
}

async function test_missing_crop_returns_null() {
  await withUrl('http://127.0.0.1:1', async () => {
    const r = await callPythonPredict({ crop: '' });
    assert.strictEqual(r, null);
  });
}

async function main() {
  const tests = [
    ['unset URL returns null', test_unset_url_returns_null],
    ['invalid URL returns null', test_invalid_url_returns_null],
    ['refused connection returns null', test_refused_connection_returns_null],
    ['non-200 returns null', test_non_200_returns_null],
    ['malformed body returns null', test_malformed_body_returns_null],
    ['valid envelope returned', test_valid_envelope_returned],
    ['unavailable envelope returned', test_unavailable_envelope_returned],
    ['health endpoint round trip', test_health_endpoint_round_trip],
    ['missing crop returns null', test_missing_crop_returns_null],
  ];
  let pass = 0;
  let fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      pass += 1;
      console.log(`  PASS  ${name}`);
    } catch (e) {
      fail += 1;
      console.error(`  FAIL  ${name}`);
      console.error(e && e.stack ? e.stack : e);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main();
