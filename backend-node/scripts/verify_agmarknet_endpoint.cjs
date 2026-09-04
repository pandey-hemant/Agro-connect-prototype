#!/usr/bin/env node
/**
 * scripts/verify_agmarknet_endpoint.cjs — Phase 5 live endpoint check.
 *
 * Hits the public AGMARKNET 2.0 endpoints with the exact browser-like
 * headers the feasibility report documented. Verifies:
 *
 *   1. /daily-price-arrival/filters returns 200 + non-empty body.
 *   2. The body contains state_data[] and commodity_data[] arrays.
 *   3. The price-and-arrivals/date-wise/specific-commodity endpoint
 *      returns 200 for a known (state, commodity) tuple in 2025.
 *
 * The script is rate-limited to one fetch per second and prints
 * "agmarknet_endpoints_ok" with the body sizes on success. On
 * failure, it prints the error and exits with code 1.
 *
 * No env, no API key.
 */
'use strict';

const https = require('https');

const BASE = 'https://api.agmarknet.gov.in/v1';

const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://agmarknet.gov.in',
  Referer: 'https://agmarknet.gov.in/',
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
};

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* leave null */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  let PASS = 0;
  let FAIL = 0;
  const fails = [];
  function step(n, label, ok, detail = '') {
    if (ok) { PASS += 1; console.log(`[OK]   ${n}. ${label}${detail ? '  — ' + detail : ''}`); }
    else { FAIL += 1; fails.push(`${n}. ${label}${detail ? ' — ' + detail : ''}`); console.log(`[FAIL] ${n}. ${label}${detail ? '  — ' + detail : ''}`); }
  }

  // 1. filters
  let fjson = null;
  let fStatus = 0;
  try {
    const r = await getJson(`${BASE}/daily-price-arrival/filters`);
    fStatus = r.status;
    fjson = r.json;
  } catch (err) {
    fjson = null;
    fStatus = 0;
    console.log(`[err] filters: ${err.message}`);
  }
  step(
    1,
    '/daily-price-arrival/filters returns 200 + non-empty JSON',
    fStatus === 200 && fjson != null,
    `status=${fStatus}`
  );

  // 2. body shape
  // AGMARKNET 2.0 uses cmdt_data (not commodity_data) for commodities.
  // Accept either name so the verifier is robust to upstream renames.
  const stateData = fjson && (fjson.state_data || (fjson.data && fjson.data.state_data));
  const commodityData = fjson && (
    fjson.commodity_data || fjson.cmdt_data ||
    (fjson.data && (fjson.data.commodity_data || fjson.data.cmdt_data))
  );
  step(
    2,
    'filters body has state_data[] and commodity_data[]',
    Array.isArray(stateData) && Array.isArray(commodityData) &&
      stateData.length > 0 && commodityData.length > 0,
    `states=${stateData ? stateData.length : 0}, commodities=${commodityData ? commodityData.length : 0}`
  );

  if (!fjson) {
    console.log('Cannot continue without filters.');
    process.exit(1);
  }

  // 3. date-wise for a known tuple. We use the first state and the
  // first commodity whose name is a common crop (Onion / Potato /
  // Tomato / Wheat). If none, we fall back to the first commodity.
  const findName = (list, candidates) => {
    for (const c of candidates) {
      const m = list.find((x) => {
        const n = (x.commodity_name || x.name || x.state_name || x.cmdt_name || '').toLowerCase();
        return n === c.toLowerCase();
      });
      if (m) return m;
    }
    return list[0];
  };
  const state = findName(stateData, ['Maharashtra', 'Karnataka', 'Punjab']);
  const commodity = findName(commodityData, ['Onion', 'Potato', 'Tomato', 'Wheat']);
  const stateId = state.state_id || state.id;
  const commodityId = commodity.commodity_id || commodity.id || commodity.cmdt_id;
  await sleep(800); // be polite
  const dwUrl = `${BASE}/prices-and-arrivals/date-wise/specific-commodity?year=2025&month=1&stateId=${stateId}&commodityId=${commodityId}&includeExcel=false`;
  let dwStatus = 0;
  let dwJson = null;
  try {
    const r = await getJson(dwUrl);
    dwStatus = r.status;
    dwJson = r.json;
  } catch (err) {
    console.log(`[err] date-wise: ${err.message}`);
  }
  const markets = dwJson && dwJson.markets;
  const totalDates = Array.isArray(markets)
    ? markets.reduce((a, m) => a + (Array.isArray(m.dates) ? m.dates.length : 0), 0)
    : 0;
  step(
    3,
    'date-wise returns markets[] for a known (state, commodity, 2025-01)',
    dwStatus === 200 && Array.isArray(markets) && totalDates > 0,
    `status=${dwStatus} markets=${markets ? markets.length : 0} dates=${totalDates}`
  );

  console.log('');
  console.log(`=== ${PASS} passed, ${FAIL} failed ===`);
  console.log(`agmarknet_endpoints_ok=${FAIL === 0 ? 'true' : 'false'}`);
  if (FAIL > 0) {
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})();
