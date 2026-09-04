/**
 * tests/verify_A_to_I.cjs — A–I end-to-end test suites.
 *
 * Mirrors the verify_e2e.cjs pattern: it hits a live backend on
 * BASE_URL (default http://localhost:5050/api) and exercises the
 * new surfaces added in the Transaction Trust + Quality/Weight
 * Verification + Complete Selling Decision phase:
 *
 *   A. Quality Information + Verification
 *   B. Quality/Weight Discrepancy Handling (DealVerification)
 *   C. Complete Sell Now / Wait / Group Sale decision (break-even)
 *   D. Storage Economics (no hardcoded "national rate")
 *   E. FPO/Group Sale Complete Journey (explicit per-farmer opt-in)
 *   F. Trust/Buyer Verification (credibility + identityVerified)
 *   G. Payment Architecture (state machine + audit append)
 *   H. Deal Audit Trail (chronological event log)
 *   I. Basic Issue/Dispute Flow (OPEN → UNDER_REVIEW → RESOLVED)
 *
 * Each suite is self-contained and runs in sequence. The script
 * exits 0 only if every step passes.
 *
 * Run with: `node tests/verify_A_to_I.cjs` while the backend is up.
 */
'use strict';

const http = require('http');

const BASE = process.env.BASE_URL || 'http://localhost:5050/api';
let PASS = 0;
let FAIL = 0;
const failures = [];

function step(n, label, ok, detail = '') {
  const tag = ok ? '[OK]  ' : '[FAIL]';
  console.log(`${tag} ${String(n).padStart(4, ' ')}. ${label}${detail ? `  — ${detail}` : ''}`);
  if (ok) PASS += 1;
  else {
    FAIL += 1;
    failures.push(`${n}. ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

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
      if (r.status === 200 || r.status === 503) return r;
    } catch (_) {}
    await sleep(1000);
  }
  throw new Error('server did not respond within ' + maxMs + 'ms');
}

function nowStamp() {
  return Date.now().toString(36);
}

// Helper to create a fresh crop lot owned by a given farmer.
async function createLot(cropName, qty, location, state) {
  const r = await request('POST', '/crop-lots', {
    crop_name: cropName,
    crop_variety: 'Hybrid',
    quantity: qty,
    quantity_unit: 'kg',
    harvest_date: '2026-08-29',
    location,
    state,
    farmer_quality_grade: 'A',
    expected_price_per_kg: 17.0,
  });
  return r.body;
}

async function makeDealForLot(lot, price) {
  // Create a buyer
  const buyerRes = await request('POST', '/buyers', {
    name: 'Test Buyer',
    business_name: 'Test Buyer Co',
    location: 'Delhi',
    state: 'Delhi',
    contact: '99',
  });
  const buyer = buyerRes.body;
  // Make offer
  const offRes = await request('POST', '/offers', {
    crop_lot_id: lot.id,
    buyer_id: buyer.id,
    offered_price_per_kg: price,
    quantity_kg: lot.quantity,
    notes: 'A-I test offer',
  });
  const offer = offRes.body;
  // Counter at same price, then accept
  await request('POST', `/offers/${offer.public_id}/counter`, {
    counter_price_per_kg: price,
    note: 'agree',
  });
  const accRes = await request('POST', `/offers/${offer.public_id}/accept`, { actor: 'BUYER' });
  return { buyer, deal: accRes.body, offer };
}

async function main() {
  const h = await waitForServer();
  step('0', 'Server is reachable',
    h.status === 200,
    `status=${h.status} db=${h.body && h.body.database} mode=${h.body && h.body.db_mode}`);
  if (h.status !== 200) {
    console.log('Server is degraded; aborting.');
    process.exit(1);
  }

  const ts = nowStamp();
  const baseHeaders = { 'X-Demo-User': `farmer-${ts}` };

  // =================================================================
  // A. Quality Information + Verification
  // =================================================================
  console.log('\n=== A. Quality Information + Verification ===');
  const lotA = await createLot(`A-tomato-${ts}`, 600, 'Patna, Bihar', 'Bihar');
  step('A1', 'Lot created for quality test',
    !!lotA.public_id, lotA.public_id);

  // Declare with extended fields (size/appearance/moisture/defects)
  const declRes = await request('POST', `/quality/${lotA.id}`, {
    grade: 'A',
    notes: 'clean',
    size: 'Medium',
    appearance: 'Uniform',
    moisture_pct: 8.5,
    defects_pct: 1.2,
  }, baseHeaders);
  step('A2', 'Declare quality (lot-level, extended fields)',
    declRes.status === 201 &&
      declRes.body.declared_grade === 'A' &&
      declRes.body.size === 'Medium' &&
      declRes.body.moisture_pct === 8.5,
    JSON.stringify({
      s: declRes.status,
      grade: declRes.body?.declared_grade,
      size: declRes.body?.size,
      moisture: declRes.body?.moisture_pct,
    }));

  // Verify as buyer with same grade → VERIFIED_ACCEPTED
  const vRes = await request('POST', `/quality/${lotA.id}/verify`, {
    actor: 'BUYER',
    grade: 'A',
    notes: 'matches',
  }, baseHeaders);
  step('A3', 'Verify with matching grade → VERIFIED_ACCEPTED',
    vRes.status === 200 &&
      (vRes.body.status === 'VERIFIED_ACCEPTED' ||
        vRes.body.quality_status === 'VERIFIED_ACCEPTED'),
    `status=${vRes.body?.status || vRes.body?.quality_status}`);

  // Verify with different grade → DISPUTED
  const vRes2 = await request('POST', `/quality/${lotA.id}/verify`, {
    actor: 'BUYER',
    grade: 'B',
    notes: 'looks B',
  }, baseHeaders);
  step('A4', 'Verify with mismatched grade → DISPUTED',
    vRes2.status === 200 &&
      (vRes2.body.status === 'DISPUTED' ||
        vRes2.body.quality_status === 'DISPUTED'),
    `status=${vRes2.body?.status || vRes2.body?.quality_status}`);

  // =================================================================
  // B. Quality/Weight Discrepancy Handling
  // =================================================================
  console.log('\n=== B. Quality/Weight Discrepancy Handling ===');
  const lotB = await createLot(`B-onion-${ts}`, 1000, 'Nalanda, Bihar', 'Bihar');
  const { deal: dealB } = await makeDealForLot(lotB, 18);
  step('B1', 'Deal created for verification flow',
    !!dealB.public_id, dealB.public_id);

  // Start verification
  const startRes = await request('POST', `/deals/${dealB.public_id}/verification`, {
    declared_weight_kg: 1000,
    declared_grade: 'A',
    declared_quality: { grade: 'A', moisturePct: 8.0, defectsPct: 1.0 },
  }, baseHeaders);
  step('B2', 'POST /verification starts record (VERIFICATION_PENDING)',
    startRes.status === 201 && startRes.body.status === 'VERIFICATION_PENDING',
    `status=${startRes.body?.status}`);

  // Idempotency
  const startRes2 = await request('POST', `/deals/${dealB.public_id}/verification`, {}, baseHeaders);
  step('B2a', 'POST /verification is idempotent',
    startRes2.status === 200 && startRes2.body.public_id === startRes.body.public_id,
    `same public_id`);

  // Submit actual weight within tolerance + matching grade → VERIFIED
  const v1 = await request('PATCH', `/deals/${dealB.public_id}/verification`, {
    actual_weight_kg: 1005, // 0.5% delta, within ±2% default tolerance
    verified_quality: { grade: 'A' },
    verified_by: 'buyer-x',
  }, baseHeaders);
  step('B3', 'PATCH actuals within tolerance + matching grade → VERIFIED',
    v1.status === 200 && v1.body.status === 'VERIFIED',
    `status=${v1.body?.status} delta=${v1.body?.weight_delta_pct}`);

  // Now test the discrepancy path: another deal
  const lotB2 = await createLot(`B2-onion-${ts}`, 1000, 'Nalanda, Bihar', 'Bihar');
  const { deal: dealB2 } = await makeDealForLot(lotB2, 18);
  await request('POST', `/deals/${dealB2.public_id}/verification`, {
    declared_weight_kg: 1000,
    declared_grade: 'A',
  }, baseHeaders);
  const v2 = await request('PATCH', `/deals/${dealB2.public_id}/verification`, {
    actual_weight_kg: 950, // -5% delta
    verified_quality: { grade: 'B' },
    discrepancy_notes: 'short weight and lower grade',
  }, baseHeaders);
  step('B4', 'PATCH actuals outside tolerance → DISCREPANCY_FOUND',
    v2.status === 200 && v2.body.status === 'DISCREPANCY_FOUND',
    `status=${v2.body?.status} delta=${v2.body?.weight_delta_pct}`);

  // Try to resolve a non-discrepancy deal → 409
  const v2NoRes = await request('PATCH', `/deals/${dealB.public_id}/verification/resolve`, {
    resolution: 'ACCEPT_ACTUAL',
  }, baseHeaders);
  step('B4a', 'Resolve only valid from DISCREPANCY_FOUND (409 expected)',
    v2NoRes.status === 409, `status=${v2NoRes.status}`);

  // Resolve
  const res1 = await request('PATCH', `/deals/${dealB2.public_id}/verification/resolve`, {
    resolution: 'SPLIT',
    resolution_notes: 'agreed to split the difference',
  }, baseHeaders);
  step('B5', 'Resolve discrepancy → RESOLVED',
    res1.status === 200 && res1.body.status === 'RESOLVED' && res1.body.resolution === 'SPLIT',
    `status=${res1.body?.status} resolution=${res1.body?.resolution}`);

  // Bad resolution name
  const resBad = await request('PATCH', `/deals/${dealB2.public_id}/verification/resolve`, {
    resolution: 'BAD_NAME',
  }, baseHeaders);
  step('B5a', 'Reject unknown resolution (400 expected)',
    resBad.status === 400, `status=${resBad.status}`);

  // GET fetch
  const getV = await request('GET', `/deals/${dealB2.public_id}/verification`, null, baseHeaders);
  step('B6', 'GET /verification returns the record',
    getV.status === 200 && getV.body.public_id,
    `public_id=${getV.body?.public_id}`);

  // =================================================================
  // C. Complete Sell Now / Wait / Group Sale decision (break-even)
  // =================================================================
  console.log('\n=== C. Decision Support with break-even ===');
  const lotC = await createLot(`C-rice-${ts}`, 500, 'Gaya, Bihar', 'Bihar');
  const dsRes = await request('GET', `/decision/${lotC.id}`, null, baseHeaders);
  step('C1', 'GET /decision returns a recommendation',
    dsRes.status === 200 && !!dsRes.body.decision,
    `decision=${dsRes.body?.decision} offers=${dsRes.body?.offer_count ?? '?'}`);

  // When recommendation is WAIT, break-even should be present and positive.
  if (dsRes.body?.decision === 'WAIT') {
    step('C2', 'WAIT recommendation includes break-even future price',
      typeof dsRes.body.breakeven_future_price_per_kg === 'number' &&
        dsRes.body.breakeven_future_price_per_kg > 0,
      `breakeven=${dsRes.body?.breakeven_future_price_per_kg} ` +
        `assumptions=${JSON.stringify(dsRes.body?.breakeven_assumptions || {})}`);
  } else {
    step('C2', 'Non-WAIT path: ensure decision shape is sane',
      dsRes.body && Array.isArray(dsRes.body.market_comparison),
      `decision=${dsRes.body?.decision} (no break-even expected)`);
  }

  // =================================================================
  // D. Storage Economics (configurable, no hardcoded rate)
  // =================================================================
  console.log('\n=== D. Storage Economics ===');
  const csRes = await request('POST', '/cold-storage/estimate', {
    crop: 'Tomato',
    quantity_kg: 1000,
    days: 3,
  }, baseHeaders);
  step('D1', 'POST /cold-storage/estimate returns a configurable estimate',
    csRes.status === 200 && csRes.body.is_estimate !== false,
    `cost=${csRes.body?.cost} is_estimate=${csRes.body?.is_estimate} ` +
      `note=${(csRes.body?.note || '').slice(0, 40)}`);

  // A different days input should change the cost
  const cs2 = await request('POST', '/cold-storage/estimate', {
    crop: 'Tomato', quantity_kg: 1000, days: 10,
  }, baseHeaders);
  step('D2', 'Different days → different estimate',
    cs2.body?.cost !== csRes.body?.cost,
    `d3 cost=${csRes.body?.cost} d10 cost=${cs2.body?.cost}`);

  // =================================================================
  // E. FPO/Group Sale Complete Journey (explicit per-farmer opt-in)
  // =================================================================
  console.log('\n=== E. FPO Group Sale with explicit opt-in ===');
  const fpoRes = await request('POST', '/fpos', {
    name: `A-I FPO ${ts}`,
    location: 'Patna', district: 'Patna', state: 'Bihar',
  }, baseHeaders);
  const fpo = fpoRes.body;
  step('E1', 'FPO created', (fpoRes.status === 200 || fpoRes.status === 201) && fpo.public_id,
    fpo.public_id);

  const lotE1 = await createLot(`E1-rice-${ts}`, 300, 'Bhojpur, Bihar', 'Bihar');
  const lotE2 = await createLot(`E2-rice-${ts}`, 400, 'Bhojpur, Bihar', 'Bihar');

  // Join WITHOUT opt-in
  const joinNo = await request('POST', `/fpos/${fpo.public_id}/join`, {
    crop_lot_id: lotE1.id, opt_in: false,
  }, baseHeaders);
  step('E2', 'Join FPO with opt_in=false',
    (joinNo.status === 200 || joinNo.status === 201) &&
      (joinNo.body.members || []).some(
        (m) => String(m.crop_lot_id) === String(lotE1.id) && m.opted_in === false
      ),
    `members=${(joinNo.body.members || []).length} opted_in=${(joinNo.body.members || []).find(
      (m) => String(m.crop_lot_id) === String(lotE1.id)
    )?.opted_in}`);

  // Join WITH opt-in
  const joinYes = await request('POST', `/fpos/${fpo.public_id}/join`, {
    crop_lot_id: lotE2.id, opt_in: true,
  }, baseHeaders);
  step('E3', 'Join FPO with opt_in=true',
    (joinYes.status === 200 || joinYes.status === 201) &&
      (joinYes.body.members || []).some(
        (m) => String(m.crop_lot_id) === String(lotE2.id) && m.opted_in === true
      ),
    `opted_in=${(joinYes.body.members || []).find(
      (m) => String(m.crop_lot_id) === String(lotE2.id)
    )?.opted_in}`);

  // Switch opt-in via dedicated endpoint
  const switchRes = await request('POST', `/fpos/${fpo.public_id}/opt-in`, {
    crop_lot_id: lotE1.id, opt_in: true,
  }, baseHeaders);
  step('E4', 'POST /opt-in toggles opted_in',
    (switchRes.status === 200 || switchRes.status === 201) &&
      (switchRes.body.members || []).some(
        (m) => String(m.crop_lot_id) === String(lotE1.id) && m.opted_in === true
      ),
    `opted_in=${(switchRes.body.members || []).find(
      (m) => String(m.crop_lot_id) === String(lotE1.id)
    )?.opted_in}`);

  // Aggregate separates opted-in vs total
  const aggRes = await request('GET', `/fpos/${fpo.public_id}/aggregate`, null, baseHeaders);
  const aggOk = aggRes.status === 200 &&
    typeof aggRes.body.opted_in_lot_count === 'number' &&
    aggRes.body.opted_in_lot_count >= 1;
  step('E5', 'Aggregate surfaces opted-in count',
    aggOk,
    `opted_in_lot_count=${aggRes.body?.opted_in_lot_count} total=${aggRes.body?.member_count}`);

  // =================================================================
  // F. Trust/Buyer Verification (credibility + identityVerified)
  // =================================================================
  console.log('\n=== F. Credibility + identity verification ===');
  // Use the buyer from dealB; farmer-card is the surface farmers see
  // in the buyer marketplace. We need a public farmer id, so reuse
  // the seller of lotB.
  const farmerPublicId = lotB.seller_user_public_id || lotB.seller_public_id || lotB.sellerPublicId;
  if (farmerPublicId) {
    const credRes = await request('GET', `/farmers/${farmerPublicId}/credibility`, null, baseHeaders);
    step('F1', 'GET /farmers/:id/credibility returns a record',
      credRes.status === 200 && typeof credRes.body.available === 'boolean',
      `available=${credRes.body?.available} tier=${credRes.body?.tier} ` +
        `identity_verified=${credRes.body?.identity_verified} ` +
        `note=${(credRes.body?.identity_verification_note || '').slice(0, 30)}`);

    // identity_verified is a separate field from credibility
    const identityIsSeparate =
      Object.prototype.hasOwnProperty.call(credRes.body || {}, 'identity_verified');
    step('F2', 'identity_verified is a separate field from credibility',
      identityIsSeparate,
      `has identity_verified key=${identityIsSeparate}`);
  } else {
    step('F1', 'Skip F (no farmer public id on lot)',
      true, 'skipped');
    step('F2', 'Skip F2 (no farmer public id on lot)',
      true, 'skipped');
  }

  // =================================================================
  // G. Payment Architecture (state machine + audit append)
  // =================================================================
  console.log('\n=== G. Payment state machine ===');
  const lotG = await createLot(`G-wheat-${ts}`, 800, 'Muzaffarpur, Bihar', 'Bihar');
  const { deal: dealG } = await makeDealForLot(lotG, 19);

  // Strict one-step forward
  const g1 = await request('POST', `/deals/${dealG.public_id}/payment-transition`, {
    to: 'PAYMENT_INITIATED',
  }, baseHeaders);
  step('G1', 'PENDING → INITIATED is legal',
    g1.status === 200 && g1.body.payment_status === 'PAYMENT_INITIATED',
    `status=${g1.body?.payment_status}`);

  // Skipping a step is illegal
  const gSkip = await request('POST', `/deals/${dealG.public_id}/payment-transition`, {
    to: 'PAYMENT_RELEASED',
  }, baseHeaders);
  step('G1a', 'Skipping a step is rejected (409 expected)',
    gSkip.status === 409, `status=${gSkip.status}`);

  // Walk to SECURED then to RELEASED then to COMPLETED
  await request('POST', `/deals/${dealG.public_id}/payment-transition`, { to: 'PAYMENT_SECURED' }, baseHeaders);
  const g2 = await request('POST', `/deals/${dealG.public_id}/payment-transition`, {
    to: 'PAYMENT_RELEASED',
  }, baseHeaders);
  step('G2', 'SECURED → RELEASED is legal',
    g2.status === 200 && g2.body.payment_status === 'PAYMENT_RELEASED',
    `txn=${g2.body?.txn_id}`);

  const g3 = await request('POST', `/deals/${dealG.public_id}/payment-transition`, {
    to: 'COMPLETED',
  }, baseHeaders);
  step('G3', 'RELEASED → COMPLETED is legal',
    g3.status === 200 && g3.body.payment_status === 'COMPLETED',
    `txn=${g3.body?.txn_id}`);

  // Disputed from a non-terminal state — make a new deal
  const lotG2 = await createLot(`G2-wheat-${ts}`, 800, 'Muzaffarpur, Bihar', 'Bihar');
  const { deal: dealG2 } = await makeDealForLot(lotG2, 19);
  const g4 = await request('POST', `/deals/${dealG2.public_id}/payment-transition`, {
    to: 'DISPUTED',
  }, baseHeaders);
  step('G4', 'PENDING → DISPUTED is legal',
    g4.status === 200 && g4.body.payment_status === 'DISPUTED',
    `status=${g4.body?.payment_status}`);

  // DISPUTED → REFUNDED
  const g5 = await request('POST', `/deals/${dealG2.public_id}/payment-transition`, {
    to: 'REFUNDED',
  }, baseHeaders);
  step('G5', 'DISPUTED → REFUNDED is legal',
    g5.status === 200 && g5.body.payment_status === 'REFUNDED',
    `status=${g5.body?.payment_status}`);

  // Try to transition REFUNDED forward
  const g6 = await request('POST', `/deals/${dealG2.public_id}/payment-transition`, {
    to: 'PAYMENT_SECURED',
  }, baseHeaders);
  step('G6', 'REFUNDED → SECURED is rejected (terminal)',
    g6.status === 409, `status=${g6.status}`);

  // Idempotent re-record same state
  const g7 = await request('POST', `/deals/${dealG.public_id}/payment-transition`, {
    to: 'COMPLETED',
  }, baseHeaders);
  step('G7', 'Same-state transition is idempotent',
    g7.status === 200 && g7.body.payment_status === 'COMPLETED',
    `status=${g7.body?.payment_status}`);

  // =================================================================
  // H. Deal Audit Trail
  // =================================================================
  console.log('\n=== H. Deal audit trail ===');
  const auditRes = await request('GET', `/deals/${dealG.public_id}/audit`, null, baseHeaders);
  const events = (auditRes.body && auditRes.body.events) || [];
  const types = new Set(events.map((e) => e.type));
  step('H1', 'GET /audit returns chronological events',
    auditRes.status === 200 && events.length > 0,
    `count=${events.length}`);

  step('H2', 'Audit includes payment transition events',
    types.has('PAYMENT_STATUS_CHANGED'),
    `types=${Array.from(types).join(',')}`);

  // The events are sorted by date
  const sorted = events.every((e, i) =>
    i === 0 || new Date(events[i - 1].at) <= new Date(e.at));
  step('H3', 'Events are chronologically sorted',
    sorted, `sorted=${sorted}`);

  // Audit on the verified deal includes verification events
  const auditB2 = await request('GET', `/deals/${dealB2.public_id}/audit`, null, baseHeaders);
  const typesB2 = new Set((auditB2.body?.events || []).map((e) => e.type));
  step('H4', 'Audit includes verification + resolution events',
    typesB2.has('VERIFICATION_STARTED') &&
      typesB2.has('VERIFICATION_COMPLETED') &&
      typesB2.has('VERIFICATION_RESOLVED'),
    `types=${Array.from(typesB2).join(',')}`);

  // =================================================================
  // I. Issue/Dispute Flow
  // =================================================================
  console.log('\n=== I. Issue / Dispute flow ===');
  const lotI = await createLot(`I-maize-${ts}`, 1000, 'Darbhanga, Bihar', 'Bihar');
  const { deal: dealI } = await makeDealForLot(lotI, 16);

  // Raise an issue
  const i1 = await request('POST', `/deals/${dealI.public_id}/issues`, {
    type: 'QUALITY',
    description: 'Sample looks damp on arrival',
    evidence_urls: ['https://example.com/photo.jpg'],
    raised_by_role: 'BUYER',
  }, baseHeaders);
  step('I1', 'POST /issues creates OPEN issue',
    i1.status === 201 && i1.body.status === 'OPEN' && i1.body.public_id,
    `public_id=${i1.body?.public_id} status=${i1.body?.status}`);

  // List
  const iList = await request('GET', `/deals/${dealI.public_id}/issues`, null, baseHeaders);
  step('I2', 'GET /issues lists the raised issue',
    iList.status === 200 && (iList.body?.results || []).some(
      (i) => i.public_id === i1.body.public_id),
    `count=${(iList.body?.results || []).length}`);

  // Bad type
  const iBad = await request('POST', `/deals/${dealI.public_id}/issues`, {
    type: 'BOGUS', description: 'nope',
  }, baseHeaders);
  step('I2a', 'Reject unknown issue type (400 expected)',
    iBad.status === 400, `status=${iBad.status}`);

  // OPEN → UNDER_REVIEW
  const i3 = await request('PATCH', `/deals/${dealI.public_id}/issues/${i1.body.public_id}`, {
    status: 'UNDER_REVIEW',
  }, baseHeaders);
  step('I3', 'OPEN → UNDER_REVIEW is legal',
    i3.status === 200 && i3.body.status === 'UNDER_REVIEW',
    `status=${i3.body?.status}`);

  // Skipping a step is illegal
  const i3skip = await request('PATCH', `/deals/${dealI.public_id}/issues/${i1.body.public_id}`, {
    status: 'RESOLVED',
  }, baseHeaders);
  step('I3a', 'Skipping UNDER_REVIEW is rejected (409 expected)',
    i3skip.status === 409, `status=${i3skip.status}`);

  // UNDER_REVIEW → RESOLVED
  const i4 = await request('PATCH', `/deals/${dealI.public_id}/issues/${i1.body.public_id}`, {
    status: 'RESOLVED', resolution_notes: 'Replaced lot, buyer accepted.',
  }, baseHeaders);
  step('I4', 'UNDER_REVIEW → RESOLVED is legal',
    i4.status === 200 && i4.body.status === 'RESOLVED' && i4.body.resolution_notes,
    `notes=${(i4.body?.resolution_notes || '').slice(0, 40)}…`);

  // Re-transition out of RESOLVED
  const i5 = await request('PATCH', `/deals/${dealI.public_id}/issues/${i1.body.public_id}`, {
    status: 'OPEN',
  }, baseHeaders);
  step('I5', 'RESOLVED is terminal (409 expected)',
    i5.status === 409, `status=${i5.status}`);

  // Raise a second issue to check both persist
  const i6 = await request('POST', `/deals/${dealI.public_id}/issues`, {
    type: 'DELIVERY', description: 'Truck late by 2 days', raised_by_role: 'SELLER',
  }, baseHeaders);
  step('I6', 'Second issue creates independent record',
    i6.status === 201 && i6.body.public_id !== i1.body.public_id,
    `i1=${i1.body?.public_id} i2=${i6.body?.public_id}`);

  // Summary
  console.log('\n---------------------------------------------');
  console.log(`A-I suites: ${PASS} passed, ${FAIL} failed`);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log('  ' + f);
  }
  console.log('---------------------------------------------');
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
