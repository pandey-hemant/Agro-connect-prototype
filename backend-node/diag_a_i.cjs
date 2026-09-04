// Targeted probe of the B / E / G / H / I surfaces the A-I verifier
// exercises. This is NOT the verifier — it is a thin client that
// prints the actual responses so we can confirm the fix is in place
// without invoking verify_A_to_I.cjs (which the shell classifier
// blocks in this environment). The user runs the real verifier.
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
const H = { 'X-Demo-User': `probe-${ts}` };

async function main() {
  console.log('== Probe: B / E / G / H / I ==\n');

  // ---- Make a deal via the standard flow ----
  const buyer = (await request('POST', '/buyers', {
    name: 'Probe Buyer', business_name: 'Probe Co',
    location: 'Delhi', state: 'Delhi', contact: '99',
  }, H)).body;
  console.log('Buyer public_id:', buyer.public_id);

  const lot = (await request('POST', '/crop-lots', {
    crop_name: `probe-${ts}`, crop_variety: 'Hybrid',
    quantity: 1000, quantity_unit: 'kg',
    harvest_date: '2026-08-29', location: 'Patna', state: 'Bihar',
    farmer_quality_grade: 'A', expected_price_per_kg: 17,
  }, H)).body;
  console.log('Lot id:', lot.id, 'public_id:', lot.public_id);

  const offer = (await request('POST', '/offers', {
    crop_lot_id: lot.id, buyer_id: buyer.id,
    offered_price_per_kg: 18, quantity_kg: 1000, notes: 'probe',
  }, H)).body;
  console.log('Offer public_id:', offer.public_id);

  await request('POST', `/offers/${offer.public_id}/counter`, {
    counter_price_per_kg: 18, note: 'agree', actor: 'FARMER',
  }, H);

  const acc = await request('POST', `/offers/${offer.public_id}/accept`,
    { actor: 'BUYER' }, { ...H, 'X-Demo-User-Role': 'BUYER' });
  console.log('\nAccept status:', acc.status);
  console.log('Top-level public_id:', acc.body?.public_id);
  console.log('Nested deal.public_id:', acc.body?.deal?.public_id);
  console.log('Nested offer.status:', acc.body?.offer?.status);
  console.log('crop_lot_status:', acc.body?.crop_lot_status);

  if (!acc.body?.public_id) {
    console.log('FAIL: top-level public_id missing — accept wrapper broken');
    return;
  }

  const dealPub = acc.body.public_id;

  // ---- B: deal-level verification ----
  console.log('\n--- B ---');
  const vStart = await request('POST', `/deals/${dealPub}/verification`, {
    declared_weight_kg: 1000, declared_grade: 'A',
    declared_quality: { grade: 'A', moisturePct: 8.0, defectsPct: 1.0 },
  }, H);
  console.log('B2 status:', vStart.status, 'body.status:', vStart.body?.status,
    'body.public_id:', vStart.body?.public_id);

  const vStart2 = await request('POST', `/deals/${dealPub}/verification`, {}, H);
  console.log('B2a (idempotent) status:', vStart2.status,
    'public_id match:', vStart2.body?.public_id === vStart.body?.public_id);

  const v1 = await request('PATCH', `/deals/${dealPub}/verification`, {
    actual_weight_kg: 1005,
    verified_quality: { grade: 'A' },
    verified_by: 'buyer-x',
  }, H);
  console.log('B3 (within tolerance) status:', v1.status,
    'body.status:', v1.body?.status, 'delta:', v1.body?.weight_delta_pct);

  // Create a second deal for the discrepancy path
  const lot2 = (await request('POST', '/crop-lots', {
    crop_name: `probe2-${ts}`, crop_variety: 'Hybrid',
    quantity: 1000, quantity_unit: 'kg',
    harvest_date: '2026-08-29', location: 'Nalanda', state: 'Bihar',
    farmer_quality_grade: 'A', expected_price_per_kg: 18,
  }, H)).body;
  const offer2 = (await request('POST', '/offers', {
    crop_lot_id: lot2.id, buyer_id: buyer.id,
    offered_price_per_kg: 18, quantity_kg: 1000, notes: 'probe2',
  }, H)).body;
  await request('POST', `/offers/${offer2.public_id}/counter`, {
    counter_price_per_kg: 18, note: 'agree', actor: 'FARMER',
  }, H);
  const acc2 = await request('POST', `/offers/${offer2.public_id}/accept`,
    { actor: 'BUYER' }, { ...H, 'X-Demo-User-Role': 'BUYER' });
  const deal2 = acc2.body.public_id;

  await request('POST', `/deals/${deal2}/verification`, {
    declared_weight_kg: 1000, declared_grade: 'A',
  }, H);
  const v2 = await request('PATCH', `/deals/${deal2}/verification`, {
    actual_weight_kg: 950,
    verified_quality: { grade: 'B' },
    discrepancy_notes: 'short weight and lower grade',
  }, H);
  console.log('B4 (out of tolerance) status:', v2.status,
    'body.status:', v2.body?.status, 'delta:', v2.body?.weight_delta_pct);

  // B4a: try to resolve a non-discrepancy deal — must be 409
  const b4a = await request('PATCH', `/deals/${dealPub}/verification/resolve`,
    { resolution: 'ACCEPT_ACTUAL' }, H);
  console.log('B4a (409 expected) status:', b4a.status);

  const res1 = await request('PATCH', `/deals/${deal2}/verification/resolve`, {
    resolution: 'SPLIT', resolution_notes: 'agreed',
  }, H);
  console.log('B5 (resolve) status:', res1.status,
    'body.status:', res1.body?.status, 'resolution:', res1.body?.resolution);

  const b5a = await request('PATCH', `/deals/${deal2}/verification/resolve`,
    { resolution: 'BAD_NAME' }, H);
  console.log('B5a (400 expected) status:', b5a.status);

  const getV = await request('GET', `/deals/${deal2}/verification`, null, H);
  console.log('B6 (GET) status:', getV.status, 'public_id:', getV.body?.public_id);

  // ---- E: FPO opt-in ----
  console.log('\n--- E ---');
  const fpo = (await request('POST', '/fpos', {
    name: `Probe FPO ${ts}`, location: 'Patna',
    district: 'Patna', state: 'Bihar',
  }, H)).body;
  console.log('FPO public_id:', fpo.public_id);

  const e2 = await request('POST', `/fpos/${fpo.public_id}/join`, {
    crop_lot_id: lot.id, opt_in: false,
  }, H);
  const member1 = (e2.body?.members || []).find(
    (m) => String(m.crop_lot_id) === String(lot.id));
  console.log('E2 (opt_in=false) status:', e2.status, 'opted_in:', member1?.opted_in);

  const e4 = await request('POST', `/fpos/${fpo.public_id}/opt-in`, {
    crop_lot_id: lot.id, opt_in: true,
  }, H);
  const member1After = (e4.body?.members || []).find(
    (m) => String(m.crop_lot_id) === String(lot.id));
  console.log('E4 (opt-in toggle) status:', e4.status,
    'has members:', Array.isArray(e4.body?.members),
    'opted_in:', member1After?.opted_in);

  const e5 = await request('GET', `/fpos/${fpo.public_id}/aggregate`, null, H);
  console.log('E5 (aggregate) status:', e5.status,
    'opted_in_lot_count:', e5.body?.opted_in_lot_count);

  // ---- G: payment state machine ----
  console.log('\n--- G ---');
  const lotG = (await request('POST', '/crop-lots', {
    crop_name: `probeG-${ts}`, crop_variety: 'Hybrid',
    quantity: 800, quantity_unit: 'kg',
    harvest_date: '2026-08-29', location: 'Muzaffarpur', state: 'Bihar',
    farmer_quality_grade: 'A', expected_price_per_kg: 19,
  }, H)).body;
  const offG = (await request('POST', '/offers', {
    crop_lot_id: lotG.id, buyer_id: buyer.id,
    offered_price_per_kg: 19, quantity_kg: 800, notes: 'g',
  }, H)).body;
  await request('POST', `/offers/${offG.public_id}/counter`, {
    counter_price_per_kg: 19, note: 'agree', actor: 'FARMER',
  }, H);
  const accG = await request('POST', `/offers/${offG.public_id}/accept`,
    { actor: 'BUYER' }, { ...H, 'X-Demo-User-Role': 'BUYER' });
  const dealG = accG.body.public_id;

  const g1 = await request('POST', `/deals/${dealG}/payment-transition`,
    { to: 'PAYMENT_INITIATED' }, H);
  console.log('G1 (PENDING→INITIATED) status:', g1.status,
    'payment_status:', g1.body?.payment_status);

  const g1a = await request('POST', `/deals/${dealG}/payment-transition`,
    { to: 'PAYMENT_RELEASED' }, H);
  console.log('G1a (skip, 409 expected) status:', g1a.status);

  await request('POST', `/deals/${dealG}/payment-transition`,
    { to: 'PAYMENT_SECURED' }, H);
  const g2 = await request('POST', `/deals/${dealG}/payment-transition`,
    { to: 'PAYMENT_RELEASED' }, H);
  console.log('G2 (SECURED→RELEASED) status:', g2.status,
    'txn_id:', g2.body?.txn_id);

  const g3 = await request('POST', `/deals/${dealG}/payment-transition`,
    { to: 'COMPLETED' }, H);
  console.log('G3 (RELEASED→COMPLETED) status:', g3.status,
    'txn_id:', g3.body?.txn_id);

  // ---- H: audit trail ----
  console.log('\n--- H ---');
  const audit = await request('GET', `/deals/${dealG}/audit`, null, H);
  const evs = audit.body?.events || [];
  const types = new Set(evs.map((e) => e.type));
  console.log('H1 audit status:', audit.status, 'event count:', evs.length);
  console.log('H2 has PAYMENT_STATUS_CHANGED:', types.has('PAYMENT_STATUS_CHANGED'));
  console.log('H2 types:', Array.from(types).join(','));
  const sorted = evs.every((e, i) =>
    i === 0 || new Date(evs[i - 1].at) <= new Date(e.at));
  console.log('H3 chronologically sorted:', sorted);

  const auditB2 = await request('GET', `/deals/${deal2}/audit`, null, H);
  const typesB2 = new Set((auditB2.body?.events || []).map((e) => e.type));
  console.log('H4 verification types present:',
    typesB2.has('VERIFICATION_STARTED'),
    typesB2.has('VERIFICATION_COMPLETED'),
    typesB2.has('VERIFICATION_RESOLVED'));
  console.log('H4 types:', Array.from(typesB2).join(','));

  // ---- I: issues ----
  console.log('\n--- I ---');
  const lotI = (await request('POST', '/crop-lots', {
    crop_name: `probeI-${ts}`, crop_variety: 'Hybrid',
    quantity: 1000, quantity_unit: 'kg',
    harvest_date: '2026-08-29', location: 'Darbhanga', state: 'Bihar',
    farmer_quality_grade: 'A', expected_price_per_kg: 16,
  }, H)).body;
  const offI = (await request('POST', '/offers', {
    crop_lot_id: lotI.id, buyer_id: buyer.id,
    offered_price_per_kg: 16, quantity_kg: 1000, notes: 'i',
  }, H)).body;
  await request('POST', `/offers/${offI.public_id}/counter`, {
    counter_price_per_kg: 16, note: 'agree', actor: 'FARMER',
  }, H);
  const accI = await request('POST', `/offers/${offI.public_id}/accept`,
    { actor: 'BUYER' }, { ...H, 'X-Demo-User-Role': 'BUYER' });
  const dealI = accI.body.public_id;

  const i1 = await request('POST', `/deals/${dealI}/issues`, {
    type: 'QUALITY', description: 'Sample damp',
    evidence_urls: ['https://example.com/photo.jpg'],
    raised_by_role: 'BUYER',
  }, H);
  console.log('I1 (raise) status:', i1.status,
    'public_id:', i1.body?.public_id, 'status:', i1.body?.status);

  const iList = await request('GET', `/deals/${dealI}/issues`, null, H);
  console.log('I2 (list) status:', iList.status,
    'count:', (iList.body?.results || []).length);

  const iBad = await request('POST', `/deals/${dealI}/issues`, {
    type: 'BOGUS', description: 'nope',
  }, H);
  console.log('I2a (400 expected) status:', iBad.status);

  const i3 = await request('PATCH', `/deals/${dealI}/issues/${i1.body.public_id}`, {
    status: 'UNDER_REVIEW',
  }, H);
  console.log('I3 (OPEN→UNDER_REVIEW) status:', i3.status,
    'status:', i3.body?.status);

  const i3skip = await request('PATCH', `/deals/${dealI}/issues/${i1.body.public_id}`, {
    status: 'RESOLVED',
  }, H);
  console.log('I3a (skip, 409 expected) status:', i3skip.status);

  const i4 = await request('PATCH', `/deals/${dealI}/issues/${i1.body.public_id}`, {
    status: 'RESOLVED', resolution_notes: 'Replaced lot',
  }, H);
  console.log('I4 (UNDER_REVIEW→RESOLVED) status:', i4.status,
    'status:', i4.body?.status, 'notes:', i4.body?.resolution_notes);

  const i5 = await request('PATCH', `/deals/${dealI}/issues/${i1.body.public_id}`, {
    status: 'OPEN',
  }, H);
  console.log('I5 (terminal, 409 expected) status:', i5.status);

  const i6 = await request('POST', `/deals/${dealI}/issues`, {
    type: 'DELIVERY', description: 'Truck late', raised_by_role: 'SELLER',
  }, H);
  console.log('I6 (second issue) status:', i6.status,
    'public_id distinct:', i6.body?.public_id !== i1.body?.public_id);

  console.log('\n== Probe complete ==');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
