// Targeted probe for the two round-2 failures:
//   B5a — unknown resolution string on a RESOLVED verification must 400
//   I3a — OPEN → RESOLVED must 409, no state mutation
//   I4  — UNDER_REVIEW → RESOLVED with notes must 200
//
// Run: node probe_b5a_i3a_i4.cjs
'use strict';

const http = require('http');

const BASE = 'http://localhost:5050/api';

function request(method, urlPath, body, headers = {}) {
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
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = { _raw: text }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const ts = Date.now().toString(36);
const H = { 'X-Demo-User': `probe-r2-${ts}` };

function check(label, got, expected) {
  const ok = got === expected;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}: got ${got}, expected ${expected}`);
  return ok;
}

async function makeDealWithResolvedVerification() {
  const buyer = (await request('POST', '/buyers', {
    name: 'Probe B5a Buyer', business_name: 'B5a Co',
    location: 'Delhi', state: 'Delhi', contact: '99',
  }, H)).body;

  const lot = (await request('POST', '/crop-lots', {
    crop_name: `probe-b5a-${ts}`, crop_variety: 'Hybrid',
    quantity: 1000, quantity_unit: 'kg',
    harvest_date: '2026-08-29', location: 'Patna', state: 'Bihar',
    farmer_quality_grade: 'A', expected_price_per_kg: 18,
  }, H)).body;

  const offer = (await request('POST', '/offers', {
    crop_lot_id: lot.id, buyer_id: buyer.id,
    offered_price_per_kg: 18, quantity_kg: 1000, notes: 'b5a',
  }, H)).body;

  await request('POST', `/offers/${offer.public_id}/counter`, {
    counter_price_per_kg: 18, note: 'agree', actor: 'FARMER',
  }, H);
  const acc = await request('POST', `/offers/${offer.public_id}/accept`,
    { actor: 'BUYER' }, { ...H, 'X-Demo-User-Role': 'BUYER' });
  const dealPub = acc.body?.public_id;

  await request('POST', `/deals/${dealPub}/verification`, {
    declared_weight_kg: 1000, declared_grade: 'A',
  }, H);
  await request('PATCH', `/deals/${dealPub}/verification`, {
    actual_weight_kg: 950,
    verified_quality: { grade: 'B' },
    discrepancy_notes: 'short weight and lower grade',
  }, H);
  await request('PATCH', `/deals/${dealPub}/verification/resolve`, {
    resolution: 'SPLIT', resolution_notes: 'agreed',
  }, H);
  return dealPub;
}

async function makeDealForIssues() {
  const buyer = (await request('POST', '/buyers', {
    name: 'Probe I3a Buyer', business_name: 'I3a Co',
    location: 'Delhi', state: 'Delhi', contact: '99',
  }, H)).body;
  const lot = (await request('POST', '/crop-lots', {
    crop_name: `probe-i3a-${ts}`, crop_variety: 'Hybrid',
    quantity: 1000, quantity_unit: 'kg',
    harvest_date: '2026-08-29', location: 'Darbhanga', state: 'Bihar',
    farmer_quality_grade: 'A', expected_price_per_kg: 16,
  }, H)).body;
  const offer = (await request('POST', '/offers', {
    crop_lot_id: lot.id, buyer_id: buyer.id,
    offered_price_per_kg: 16, quantity_kg: 1000, notes: 'i3a',
  }, H)).body;
  await request('POST', `/offers/${offer.public_id}/counter`, {
    counter_price_per_kg: 16, note: 'agree', actor: 'FARMER',
  }, H);
  const acc = await request('POST', `/offers/${offer.public_id}/accept`,
    { actor: 'BUYER' }, { ...H, 'X-Demo-User-Role': 'BUYER' });
  return acc.body?.public_id;
}

async function main() {
  console.log('== B5a / I3a / I4 probe ==\n');

  // ---- B5a ----
  console.log('--- B5a (unknown resolution on RESOLVED verification) ---');
  const dealB = await makeDealWithResolvedVerification();
  const b5a = await request('PATCH', `/deals/${dealB}/verification/resolve`,
    { resolution: 'BAD_NAME' }, H);
  check('B5a status', b5a.status, 400);
  const v = await request('GET', `/deals/${dealB}/verification`, null, H);
  check('B5a verification still RESOLVED', v.body?.status, 'RESOLVED');

  // ---- I3a / I4 ----
  console.log('\n--- I3a (OPEN -> RESOLVED, no notes) ---');
  const dealI = await makeDealForIssues();
  const raise = await request('POST', `/deals/${dealI}/issues`, {
    type: 'QUALITY', description: 'Sample damp',
    raised_by_role: 'BUYER',
  }, H);
  const issueId = raise.body?.public_id;
  console.log(`  Issue raised: ${issueId} status=${raise.body?.status}`);

  const i3a = await request('PATCH', `/deals/${dealI}/issues/${issueId}`, {
    status: 'RESOLVED',
  }, H);
  check('I3a status', i3a.status, 409);

  const list = await request('GET', `/deals/${dealI}/issues`, null, H);
  const same = (list.body?.results || []).find((i) => i.public_id === issueId);
  check('I3a issue NOT mutated (still OPEN)', same?.status, 'OPEN');

  console.log('\n--- I4 (UNDER_REVIEW -> RESOLVED with notes) ---');
  const i3 = await request('PATCH', `/deals/${dealI}/issues/${issueId}`, {
    status: 'UNDER_REVIEW',
  }, H);
  check('I3 (OPEN->UNDER_REVIEW) status', i3.status, 200);
  check('I3 status field', i3.body?.status, 'UNDER_REVIEW');

  const i4 = await request('PATCH', `/deals/${dealI}/issues/${issueId}`, {
    status: 'RESOLVED', resolution_notes: 'Replaced lot',
  }, H);
  check('I4 status', i4.status, 200);
  check('I4 status field', i4.body?.status, 'RESOLVED');
  const notes = i4.body?.resolution_notes || i4.body?.resolutionNotes;
  check('I4 resolution_notes persisted', notes, 'Replaced lot');

  console.log('\n== Probe complete ==');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
