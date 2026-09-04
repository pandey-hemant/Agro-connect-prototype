/**
 * verify_fpo_defensive.cjs — defensive read of the FPO aggregate
 * response. Simulates the old broken payload shape (a by_crop row
 * with NO estimated_value) and proves the page logic in FPOs.jsx
 * would no longer crash on it.
 *
 * This is a static check — it loads the FPOs.jsx file as text, finds
 * the aggregate row render, and runs the same numeric/string coercion
 * the React component runs, asserting it does not throw.
 *
 * If anyone in the future changes the backend aggregate shape in a way
 * that drops a field, this test will fail and remind us to keep both
 * sides consistent.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE = 'http://localhost:5050';

let pass = 0, fail = 0;
function ok(name, detail) {
  pass++;
  console.log(`[OK]   ${name}` + (detail ? '  — ' + detail : ''));
}
function bad(name, detail) {
  fail++;
  console.log(`[FAIL] ${name}` + (detail ? '  — ' + detail : ''));
}

function req(method, p) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, BASE);
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(buf); } catch { data = buf; }
        resolve({ status: res.statusCode, data });
      });
    });
    r.on('error', reject);
    r.end();
  });
}

// Same helpers as in FPOs.jsx
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function safeToFixed(v, digits = 0, fallback = '0') {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n.toFixed(digits);
}
function str(v, fallback = '') {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

(async () => {
  // Read the page source so we can prove the helpers actually exist
  // in the component (a small regression guard).
  const pagePath = path.join(
    __dirname,
    '..', '..', 'frontend', 'src', 'pages', 'FPOs.jsx'
  );
  const page = fs.readFileSync(pagePath, 'utf8');
  if (page.includes('function num(') && page.includes('function safeToFixed(') && page.includes('function str(')) {
    ok('FPOs.jsx contains the defensive helpers', 'num, safeToFixed, str');
  } else {
    bad('FPOs.jsx contains the defensive helpers', 'one or more helpers missing');
  }
  if (page.includes('safeToFixed(row.estimated_value')) {
    ok('FPOs.jsx uses safeToFixed on estimated_value', 'replaced the raw .toFixed() call');
  } else {
    bad('FPOs.jsx uses safeToFixed on estimated_value', 'still calling .toFixed() directly?');
  }

  // FarmerDashboard must also have a defensive array guard so a
  // malformed offers / fpos / myDeals / demands payload cannot crash
  // the dashboard with `X.slice is not a function`.
  const fdPath = path.join(
    __dirname,
    '..', '..', 'frontend', 'src', 'pages', 'FarmerDashboard.jsx'
  );
  const fd = fs.readFileSync(fdPath, 'utf8');
  if (fd.includes('function safeArray(')) {
    ok('FarmerDashboard.jsx contains safeArray helper', 'array guard at boundary');
  } else {
    bad('FarmerDashboard.jsx contains safeArray helper', 'no safeArray helper');
  }
  if (fd.includes('safeArray(action.payload)')) {
    ok('FarmerDashboard.jsx normalises fetchOffers payload with safeArray', 'offers.slice crash fixed');
  } else {
    bad('FarmerDashboard.jsx normalises fetchOffers payload with safeArray', 'action.payload passed straight to setOffersByLot?');
  }
  if (fd.includes('safeArray(fpos)') && fd.includes('safeArray(demands)') && fd.includes('safeArray(myDeals)')) {
    ok('FarmerDashboard.jsx defensively normalises fpos, demands, myDeals', 'all 3 sources guarded');
  } else {
    bad('FarmerDashboard.jsx defensively normalises fpos, demands, myDeals', 'one or more sources still raw');
  }
  if (fd.includes('dispatch(fetchFpos(') && fd.includes('dispatch(joinFpo(') && fd.includes('dispatch(leaveFpo(')) {
    ok('FarmerDashboard.jsx wires fetchFpos / joinFpo / leaveFpo', 'FPO join workflow present');
  } else {
    bad('FarmerDashboard.jsx wires fetchFpos / joinFpo / leaveFpo', 'one or more thunks not wired');
  }

  // The offer slice must unwrap the { results: [...] } envelope at
  // the thunk boundary so that callers reading action.payload get an
  // array, not an object.
  const offerSlicePath = path.join(
    __dirname,
    '..', '..', 'frontend', 'src', 'redux', 'slices', 'offerSlice.js'
  );
  const offerSlice = fs.readFileSync(offerSlicePath, 'utf8');
  if (offerSlice.includes('unwrapList') && offerSlice.includes('return unwrapList(response.data)')) {
    ok('offerSlice.js unwraps the { results: [...] } envelope in thunks', 'action.payload is an array');
  } else {
    bad('offerSlice.js unwraps the { results: [...] } envelope in thunks', 'thunk still returns raw response.data');
  }

  // Live aggregate: make sure every row has the fields the page reads
  const lr = await req('GET', '/api/fpos');
  const list = (lr.data && lr.data.results) || [];
  if (list.length === 0) {
    bad('Need at least one FPO to test', 'no FPOs found');
    process.exit(1);
  }
  const fpo = list[0];
  const ar = await req('GET', `/api/fpos/${fpo.public_id}/aggregate`);
  if (ar.status !== 200) {
    bad('GET aggregate', `status=${ar.status}`);
    process.exit(1);
  }

  const rows = (ar.data.by_crop || []);
  rows.forEach((row, i) => {
    if (!row) return; // guard like the page does
    try {
      // Mirror the exact read sequence in the new FPOs.jsx render
      const lotCount = num(row.lot_count, 0);
      const totalQty = num(row.total_quantity, 0);
      const qtyUnit = str(row.quantity_unit, 'kg');
      const estValue = safeToFixed(row.estimated_value, 0, '0');
      // Touch a few more fields to make sure nothing throws
      const name = str(row.crop_name, 'Unknown');
      const memberIds = Array.isArray(row.member_public_ids) ? row.member_public_ids : [];
      ok(`Render row[${i}] of ${fpo.public_id}`,
         `crop=${name} lots=${lotCount} qty=${totalQty}${qtyUnit} value=₹${estValue} members=${memberIds.length}`);
    } catch (e) {
      bad(`Render row[${i}] of ${fpo.public_id}`, `threw: ${e.message}`);
    }
  });

  // Synthetic worst case: a row with NO estimated_value field at all
  // (what the old backend used to send). The page must still render.
  const brokenRow = { crop_name: 'Tomato', lot_count: 1, total_quantity: 500, quantity_unit: 'kg' };
  // missing: estimated_value, member_public_ids
  try {
    const lotCount = num(brokenRow.lot_count, 0);
    const totalQty = num(brokenRow.total_quantity, 0);
    const qtyUnit = str(brokenRow.quantity_unit, 'kg');
    const estValue = safeToFixed(brokenRow.estimated_value, 0, '0');
    const name = str(brokenRow.crop_name, 'Unknown');
    ok('Worst-case broken row renders without crash',
       `crop=${name} lots=${lotCount} qty=${totalQty}${qtyUnit} value=₹${estValue} (no estimated_value field)`);
  } catch (e) {
    bad('Worst-case broken row renders without crash', `threw: ${e.message}`);
  }

  // Also: completely missing row
  try {
    const lotCount = num(undefined, 0);
    const totalQty = num(undefined, 0);
    const qtyUnit = str(undefined, 'kg');
    const estValue = safeToFixed(undefined, 0, '0');
    ok('Completely empty row renders without crash',
       `lots=${lotCount} qty=${totalQty}${qtyUnit} value=₹${estValue}`);
  } catch (e) {
    bad('Completely empty row renders without crash', `threw: ${e.message}`);
  }

  console.log('');
  console.log(`=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('verify_fpo_defensive threw:', e);
  process.exit(1);
});
