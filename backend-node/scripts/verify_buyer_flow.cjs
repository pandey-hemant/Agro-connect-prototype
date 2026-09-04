/**
 * verify_buyer_flow.cjs — focused regression test for the two
 * previously-500 endpoints after the resolver-null fix.
 *
 * Confirms:
 *   1. /api/offers/by-buyer/<valid buyer id>   → 200 + results array
 *   2. /api/offers/by-buyer/<unknown id>      → 404 (was 500)
 *   3. /api/deals?buyer_id=<valid buyer id>   → 200 + results array
 *   4. /api/deals?buyer_id=<unknown id>       → 404 (was 500)
 *   5. /api/offers?buyer_id=<unknown id>      → 404 (was 500)
 *   6. /api/offers?crop_lot_id=<unknown id>   → 404 (was 500)
 *   7. The existing e2e flow (create lot, make offer, accept) still works.
 */
'use strict';

const axios = require('axios');

const BASE = 'http://localhost:5050/api';
const api = axios.create({ baseURL: BASE, timeout: 8000, validateStatus: () => true });

function check(name, ok, detail) {
  if (ok) {
    console.log(`[OK]   ${name}${detail ? '  — ' + detail : ''}`);
    return 0;
  }
  console.log(`[FAIL] ${name}${detail ? '  — ' + detail : ''}`);
  return 1;
}

// Demo-login expects a numeric buyerId (User.activeBuyerId is Number).
// The Buyer's Mongo _id is a hex string; coerce deterministically to
// a number in the safe-integer range.
function idToDemoBuyerId(mongoId) {
  const hex = String(mongoId).replace(/[^0-9a-f]/gi, '').slice(-12);
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : 1;
}

(async () => {
  let failed = 0;

  // --- Pre-flight
  const h = await api.get('/health');
  failed += check(
    '0. Server reachable',
    h.status === 200 && h.data.database === 'ok',
    `status=${h.status} db=${h.data.database}`,
  );

  // --- Find a real buyer id
  const buyers = await api.get('/auth/buyers');
  const realBuyer = (buyers.data.results || [])[0];
  failed += check(
    '1. A demo buyer exists',
    !!realBuyer && realBuyer.id,
    `buyer=${realBuyer?.public_id} id=${realBuyer?.id}`,
  );

  // --- 2. /api/offers/by-buyer/<valid id>
  const r2 = await api.get(`/offers/by-buyer/${realBuyer.id}`);
  failed += check(
    '2. /api/offers/by-buyer/<valid id> → 200',
    r2.status === 200 && Array.isArray(r2.data.results),
    `status=${r2.status} results=${r2.data.results?.length}`,
  );

  // --- 3. /api/offers/by-buyer/<unknown id>
  const r3 = await api.get('/offers/by-buyer/6');
  failed += check(
    '3. /api/offers/by-buyer/6 → 404 (was 500)',
    r3.status === 404 && r3.data.detail,
    `status=${r3.status} detail=${r3.data.detail}`,
  );

  // --- 4. /api/deals?buyer_id=<valid id>
  const r4 = await api.get('/deals', { params: { buyer_id: realBuyer.id } });
  failed += check(
    '4. /api/deals?buyer_id=<valid id> → 200',
    r4.status === 200 && Array.isArray(r4.data.results),
    `status=${r4.status} results=${r4.data.results?.length}`,
  );

  // --- 5. /api/deals?buyer_id=6
  const r5 = await api.get('/deals', { params: { buyer_id: '6' } });
  failed += check(
    '5. /api/deals?buyer_id=6 → 404 (was 500)',
    r5.status === 404 && r5.data.detail,
    `status=${r5.status} detail=${r5.data.detail}`,
  );

  // --- 6. /api/offers?buyer_id=6
  const r6 = await api.get('/offers', { params: { buyer_id: '6' } });
  failed += check(
    '6. /api/offers?buyer_id=6 → 404 (was 500)',
    r6.status === 404 && r6.data.detail,
    `status=${r6.status} detail=${r6.data.detail}`,
  );

  // --- 7. /api/offers?crop_lot_id=CL-NOPE
  const r7 = await api.get('/offers', { params: { crop_lot_id: 'CL-NOPE' } });
  failed += check(
    '7. /api/offers?crop_lot_id=CL-NOPE → 404 (was 500)',
    r7.status === 404 && r7.data.detail,
    `status=${r7.status} detail=${r7.data.detail}`,
  );

  // --- 8. End-to-end flow: seller creates a lot, buyer makes an offer,
  //        buyer accepts, deal appears in the buyer's /deals?buyer_id=…
  const seller = await api.post('/auth/demo-login', { role: 'SELLER' });
  const sellerId = seller.data.user.public_id;

  const lot = await api.post(
    '/crop-lots',
    {
      crop_name: 'Tomato',
      crop_variety: 'Hybrid',
      quantity: 250,
      quantity_unit: 'kg',
      harvest_date: '2026-09-10',
      location: 'Patna',
      state: 'Bihar',
      expected_price_per_kg: 18,
      minimum_acceptable_price: 15,
    },
    { headers: { 'X-Demo-User': sellerId } },
  );
  failed += check(
    '8a. Seller creates crop lot',
    lot.status === 201 && /^CL-/.test(lot.data.public_id),
    `lot=${lot.data.public_id} status=${lot.data.status}`,
  );

  const market = await api.get('/crop-lots/available');
  const marketList = market.data?.results || [];
  const onMarket = marketList.find((l) => l.public_id === lot.data.public_id);
  failed += check(
    '8b. Lot is on the marketplace',
    !!onMarket,
    `marketplace size=${marketList.length} found=${!!onMarket}`,
  );

  const buyer = await api.post('/auth/demo-login', { role: 'BUYER', buyerId: idToDemoBuyerId(realBuyer.id) });
  const buyerUserId = buyer.data.user.public_id;

  const offer = await api.post(
    '/offers',
    {
      crop_lot_id: lot.data.public_id,
      buyer_id: realBuyer.id,
      price: 16,
      quantity: 250,
      message: 'Will pick up tomorrow',
    },
    { headers: { 'X-Demo-User': buyerUserId } },
  );
  failed += check(
    '8c. Buyer creates offer',
    offer.status === 201 && offer.data?.status === 'OPEN',
    `status=${offer.status} body=${JSON.stringify(offer.data).slice(0, 120)}`,
  );

  const accept = await api.post(
    `/offers/${offer.data.public_id}/accept`,
    { actor: 'BUYER' },
    { headers: { 'X-Demo-User': buyerUserId } },
  );
  failed += check(
    '8d. Buyer accepts the offer',
    accept.status === 200 && accept.data.offer?.status === 'ACCEPTED' && accept.data.deal,
    `status=${accept.status} body=${JSON.stringify(accept.data).slice(0, 200)}`,
  );

  const finalDeals = await api.get('/deals', { params: { buyer_id: realBuyer.id } });
  const found = (finalDeals.data.results || []).find(
    (d) => d.public_id === accept.data.deal?.public_id,
  );
  failed += check(
    '8e. Deal appears in /deals?buyer_id=<valid id>',
    !!found,
    `deals count=${finalDeals.data.results?.length} found=${!!found}`,
  );

  // Final: confirm the server is still up and not crashed
  const finalHealth = await api.get('/health');
  failed += check(
    '9. Server still healthy after all tests',
    finalHealth.status === 200,
    `status=${finalHealth.status}`,
  );

  console.log('');
  console.log(
    failed === 0
      ? '=== ALL CHECKS PASSED ==='
      : `=== ${failed} CHECKS FAILED ===`,
  );
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
