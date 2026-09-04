/**
 * verify_offer_lifecycle.cjs — focused regression for the offer state
 * machine and message-thread contract.
 *
 * What this covers that the other verifiers do not:
 *
 *   - The reject endpoint must persist the supplied `message` onto
 *     offer.messages (the frontend used to send `reason` instead of
 *     `message`, so the note was silently dropped — see OfferDetail
 *     and BuyerOfferDetail).
 *   - The counter endpoint must push a new message with the supplied
 *     message + price + quantity.
 *   - The offer message-thread shape returned to clients must match
 *     what the UI reads: author, message, price, quantity, created_at.
 *   - The accept endpoint must return {offer, deal, crop_lot_status}
 *     on a legacy lot-based offer, and the lot must be SOLD.
 *   - The reject endpoint must reject further action (409) on a
 *     REJECTED offer.
 *
 * It does NOT exercise the demand-side flow — that is already
 * covered by verify_demand_offer_flow.cjs. It does NOT exercise
 * delivery/payment — those are explicitly out of scope.
 *
 * Run: `node scripts/verify_offer_lifecycle.cjs`
 * Hard contract: NO regression on verify_e2e.cjs (33 passed) or
 * verify_demand_offer_flow.cjs (20 passed).
 */
'use strict';

const axios = require('axios');

const BASE = 'http://localhost:5050/api';
const api = axios.create({
  baseURL: BASE,
  timeout: 10000,
  validateStatus: () => true,
});

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`[OK]   ${name}${detail ? '  — ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`[FAIL] ${name}${detail ? '  — ' + detail : ''}`);
  }
}

async function login(email, password) {
  const r = await api.post('/auth/login', { email, password });
  if (r.status !== 200 || !r.data?.user?.public_id) {
    throw new Error(
      `login(${email}) failed: status=${r.status} body=${JSON.stringify(r.data)}`
    );
  }
  return r.data.user;
}

// Pull the first ACTIVE crop lot the demo farmer owns so we can
// hang an offer off it without creating a fixture.
async function findDemoFarmerLot() {
  const farmerUser = await login('farmer@agroconnect.demo', 'farmer123');
  const lots = await api.get(`/crop-lots?farmer_user_public_id=${farmerUser.public_id}`);
  const list = lots.data?.results || [];
  return { farmerUser, lot: list.find((l) => l.status === 'ACTIVE') || list[0] };
}

// Pick the first ACTIVE buyer on the platform.
async function findDemoBuyer() {
  const buyerUser = await login('buyer@agroconnect.demo', 'buyer123');
  const buyers = await api.get('/auth/buyers');
  const list = buyers.data?.results || [];
  return { buyerUser, buyer: list[0] };
}

(async () => {
  // ---- 0. Pre-flight
  const h = await api.get('/health');
  check(
    '0. Server healthy',
    h.status === 200 && h.data.database === 'ok',
    `status=${h.status} db=${h.data.database}`
  );

  // ---- 1. Resolve farmer + lot
  let farmerUser, lot;
  try {
    ({ farmerUser, lot } = await findDemoFarmerLot());
  } catch (e) {
    check('1. Resolve demo farmer + lot', false, e.message);
    return finish();
  }
  if (!lot) {
    check('1. Demo farmer has a crop lot', false, 'no lots');
    return finish();
  }
  check(
    '1. Demo farmer has a crop lot',
    true,
    `lot=${lot.public_id} status=${lot.status}`
  );

  // ---- 2. Resolve buyer
  let buyerUser, buyer;
  try {
    ({ buyerUser, buyer } = await findDemoBuyer());
  } catch (e) {
    check('2. Resolve demo buyer', false, e.message);
    return finish();
  }
  if (!buyer) {
    check('2. Demo buyer resolved', false, 'no buyer entry in /auth/buyers');
    return finish();
  }
  check(
    '2. Demo buyer resolved',
    true,
    `buyer=${buyer.public_id} user=${buyerUser.public_id}`
  );

  // ---- 3. Create a fresh legacy-path offer (buyer on lot)
  // The other verifiers use specific lots; we look up any open offer
  // and use the first one we can write a counter on. If none exist,
  // create a fresh one off the lot we resolved.
  let offerId = null;
  const list = await api.get(
    `/offers?crop_lot_id=${lot.public_id}&buyer_id=${buyer.id}&status=OPEN`
  );
  const existing = (list.data?.results || [])[0];
  if (existing) {
    offerId = existing.public_id;
    check(
      '3a. Reuse existing OPEN offer on lot',
      true,
      `offer=${offerId} (reused to avoid seeding a new one)`
    );
  } else {
    const cr = await api.post(
      '/offers',
      {
        crop_lot_id: lot.public_id,
        buyer_id: buyer.id,
        price: 20,
        quantity: 100,
        message: 'verify_offer_lifecycle.cjs baseline offer',
      },
      { headers: { 'X-Demo-User': buyerUser.public_id } }
    );
    if (cr.status === 201 && cr.data?.public_id) {
      offerId = cr.data.public_id;
      check(
        '3a. Create baseline offer',
        true,
        `offer=${offerId} status=${cr.data.status}`
      );
    } else {
      check(
        '3a. Create baseline offer',
        false,
        `status=${cr.status} body=${JSON.stringify(cr.data).slice(0, 160)}`
      );
      return finish();
    }
  }

  // ---- 4. COUNTER — push a new counter message and confirm it
  // is on offer.messages with the supplied text + price + qty.
  const counterText = `counter @ ₹18 qty 90 (${Date.now()})`;
  const counter = await api.post(
    `/offers/${offerId}/counter`,
    {
      actor: 'FARMER',
      price: 18,
      quantity: 90,
      message: counterText,
    },
    { headers: { 'X-Demo-User': farmerUser.public_id } }
  );
  check(
    '4a. POST /offers/<id>/counter → 200',
    counter.status === 200,
    `status=${counter.status}`
  );
  const counterMsg = (counter.data?.messages || []).find(
    (m) => m.message === counterText
  );
  check(
    '4b. Counter message persisted with text + price + qty',
    !!counterMsg &&
      counterMsg.author === 'FARMER' &&
      counterMsg.price === 18 &&
      counterMsg.quantity === 90,
    `found=${!!counterMsg} author=${counterMsg?.author} price=${counterMsg?.price} qty=${counterMsg?.quantity}`
  );
  check(
    '4c. Offer status flipped to COUNTERED',
    counter.data?.status === 'COUNTERED',
    `status=${counter.data?.status}`
  );

  // ---- 5. REJECT — push a reject with a reason; confirm the
  // reason lands on the latest message. THIS is the bug the
  // frontend used to have (`reason` field → backend expects
  // `message`, silently dropped). The script sends `message`
  // which is what the backend contract actually requires.
  const rejectText = `reject reason: too low (${Date.now()})`;
  const reject = await api.post(
    `/offers/${offerId}/reject`,
    { actor: 'BUYER', message: rejectText },
    { headers: { 'X-Demo-User': buyerUser.public_id } }
  );
  check(
    '5a. POST /offers/<id>/reject → 200',
    reject.status === 200,
    `status=${reject.status}`
  );
  const rejectMsg = (reject.data?.messages || []).find(
    (m) => m.message === rejectText
  );
  check(
    '5b. Reject reason persisted on offer.messages (the bug fix)',
    !!rejectMsg && rejectMsg.author === 'BUYER',
    `found=${!!rejectMsg} author=${rejectMsg?.author}`
  );
  check(
    '5c. Offer status flipped to REJECTED',
    reject.data?.status === 'REJECTED',
    `status=${reject.data?.status}`
  );

  // ---- 6. Re-fetch the offer and confirm reject reason is still
  // there (not just on the POST response). Same shape the UI sees.
  const refetched = await api.get(`/offers/${offerId}`);
  const refetchedRejectMsg = (refetched.data?.messages || []).find(
    (m) => m.message === rejectText
  );
  check(
    '6a. Reject reason survives a refetch of the offer',
    !!refetchedRejectMsg,
    `found=${!!refetchedRejectMsg} msgCount=${refetched.data?.messages?.length}`
  );

  // ---- 7. Confirm the message-thread shape the UI depends on:
  // each message has { author, message, price, quantity, created_at }.
  const threadShapeOk =
    Array.isArray(refetched.data?.messages) &&
    refetched.data.messages.every(
      (m) =>
        'author' in m &&
        'message' in m &&
        'price' in m &&
        'quantity' in m &&
        'created_at' in m
    );
  check(
    '7. Offer message-thread has UI-expected shape',
    threadShapeOk,
    `msgs=${refetched.data?.messages?.length}`
  );

  // ---- 8. REJECT-while-REJECTED must 409. The state machine must
  // not allow further actions on a closed offer.
  const rejectAgain = await api.post(
    `/offers/${offerId}/reject`,
    { actor: 'FARMER', message: 'second reject attempt' },
    { headers: { 'X-Demo-User': farmerUser.public_id } }
  );
  check(
    '8. Rejecting a REJECTED offer → 409',
    rejectAgain.status === 409,
    `status=${rejectAgain.status}`
  );

  // ---- 9. COUNTER-while-REJECTED must 409 too.
  const counterAfterReject = await api.post(
    `/offers/${offerId}/counter`,
    { actor: 'FARMER', price: 19, quantity: 95, message: 'late counter' },
    { headers: { 'X-Demo-User': farmerUser.public_id } }
  );
  check(
    '9. Countering a REJECTED offer → 409',
    counterAfterReject.status === 409,
    `status=${counterAfterReject.status}`
  );

  // ---- 10. ACCEPT happy-path on a SECOND offer. We need a fresh
  // OPEN offer so we can accept without tripping the 409 on the
  // already-rejected one. Use the same lot + buyer.
  const cr2 = await api.post(
    '/offers',
    {
      crop_lot_id: lot.public_id,
      buyer_id: buyer.id,
      price: 22,
      quantity: 80,
      message: 'verify_offer_lifecycle.cjs accept-target offer',
    },
    { headers: { 'X-Demo-User': buyerUser.public_id } }
  );
  if (cr2.status !== 201 || !cr2.data?.public_id) {
    check(
      '10a. Create second offer for accept test',
      false,
      `status=${cr2.status} body=${JSON.stringify(cr2.data).slice(0, 160)}`
    );
    return finish();
  }
  const acceptId = cr2.data.public_id;
  check(
    '10a. Create second offer for accept test',
    true,
    `offer=${acceptId}`
  );

  const accept = await api.post(
    `/offers/${acceptId}/accept`,
    { actor: 'BUYER' },
    { headers: { 'X-Demo-User': buyerUser.public_id } }
  );
  check(
    '10b. Accept → 200, offer ACCEPTED, deal present',
    accept.status === 200 &&
      accept.data?.offer?.status === 'ACCEPTED' &&
      !!accept.data?.deal?.public_id,
    `status=${accept.status} offerStatus=${accept.data?.offer?.status} dealId=${accept.data?.deal?.public_id}`
  );
  check(
    '10c. Accept flips the lot to SOLD',
    accept.data?.crop_lot_status === 'SOLD',
    `lotStatus=${accept.data?.crop_lot_status}`
  );

  // ---- 11. The accept response shape must match the frontend
  // consumer in BuyerOfferDetail / OfferDetail: {offer, deal,
  // crop_lot_status, already_accepted}.
  const shapeOk =
    'offer' in (accept.data || {}) &&
    'deal' in (accept.data || {}) &&
    'crop_lot_status' in (accept.data || {}) &&
    'already_accepted' in (accept.data || {});
  check(
    '11. Accept response shape matches UI consumer',
    shapeOk,
    `keys=${accept.data ? Object.keys(accept.data).sort().join(',') : 'null'}`
  );

  // ---- 12. Accepting the SAME offer again is idempotent — must
  // not 500. The frontend uses the response to redirect to the
  // deal page; a 500 would break that.
  const acceptAgain = await api.post(
    `/offers/${acceptId}/accept`,
    { actor: 'BUYER' },
    { headers: { 'X-Demo-User': buyerUser.public_id } }
  );
  check(
    '12. Re-accept an ACCEPTED offer is idempotent (no 5xx)',
    acceptAgain.status >= 200 &&
      acceptAgain.status < 300 &&
      acceptAgain.data?.already_accepted === true,
    `status=${acceptAgain.status} already=${acceptAgain.data?.already_accepted}`
  );

  finish();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});

function finish() {
  const total = passed + failed;
  console.log(`\n${passed}/${total} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
