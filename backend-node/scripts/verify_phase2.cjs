/**
 * verify_phase2.cjs — focused regression for the Phase 2 buyer↔farmer
 * marketplace workflow.  Assumes the backend is already up at
 * http://localhost:5050 (with the demo seed loaded — RUN_SEED_ON_STARTUP).
 *
 * Covers the new endpoints added in the Phase 2 push:
 *   - /api/buyers/demands              list all demands
 *   - /api/buyers/demands-for-lot/:id  rule-based scoring
 *   - /api/buyers/:id/requirements     add / list / remove
 *   - /api/deals/:id/enriched          deal + joined crop_lot + buyer + offer
 *   - /api/deals/list-enriched         list with joins (role=BUYER/FARMER)
 *
 * And the existing end-to-end flow:
 *   demo-login (SELLER, BUYER) → crop-lots → offers → counter → accept → deal
 *
 * Run:
 *   node scripts/verify_phase2.cjs
 */

const http = require('http');
const BASE = 'http://localhost:5050';
const API = BASE + '/api';

let pass = 0, fail = 0;
const results = [];

function req(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
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
  results.push(`[OK]   ${name}${detail ? '  — ' + detail : ''}`);
  console.log(`[OK]   ${name}` + (detail ? '  — ' + detail : ''));
}
function bad(name, detail) {
  fail++;
  results.push(`[FAIL] ${name}${detail ? '  — ' + detail : ''}`);
  console.log(`[FAIL] ${name}` + (detail ? '  — ' + detail : ''));
}

function idToDemoBuyerId(mongoId) {
  const hex = String(mongoId).replace(/[^0-9a-f]/gi, '').slice(-12);
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : 1;
}

function unwrapList(r) {
  if (!r || !r.data) return [];
  if (Array.isArray(r.data)) return r.data;
  if (Array.isArray(r.data.results)) return r.data.results;
  return [];
}

(async () => {
  // 0. Health
  let h = await req('GET', '/api/health');
  if (h.status === 200 && h.data && h.data.database === 'ok') {
    ok('0. Server reachable', `status=${h.status} db=${h.data.database}`);
  } else {
    bad('0. Server reachable', JSON.stringify(h));
    process.exit(1);
  }

  // -------- Phase 2: Demands & Requirements --------
  // 1. List all demands — should be ≥ 6 (seed) for our 6 demo buyers
  let dr = await req('GET', '/api/buyers/demands');
  let demands = unwrapList(dr);
  if (dr.status === 200 && demands.length >= 6) {
    ok('1. List all demands', `count=${demands.length}`);
  } else {
    bad('1. List all demands', `status=${dr.status} count=${demands.length}`);
  }

  // 2. Filter by crop
  let dr2 = await req('GET', '/api/buyers/demands?crop=tomato');
  let filtered = unwrapList(dr2);
  if (dr2.status === 200 && filtered.every((d) => (d.crop_name || '').toLowerCase() === 'tomato')) {
    ok('2. Filter demands by crop', `tomato count=${filtered.length}`);
  } else {
    bad('2. Filter demands by crop', `status=${dr2.status}`);
  }

  // 3. Add a new requirement to a buyer
  // First get the list of buyers (use the original /api/buyers endpoint)
  let br = await req('GET', '/api/buyers');
  let buyers = unwrapList(br);
  const buyer = buyers[0];
  if (!buyer) {
    bad('3. Add requirement', 'no buyers to attach to');
  } else {
    const addBody = {
      crop_name: 'Wheat',
      crop_variety: 'Sharbati',
      min_quantity_kg: 500,
      max_price_per_kg: 28,
      preferred_states: ['Punjab', 'Haryana'],
      location: 'Delhi',
      required_date: '2026-12-31',
      notes: 'Phase 2 regression — should appear in list below',
    };
    let r = await req('POST', `/api/buyers/${buyer.public_id}/requirements`, addBody);
    if (r.status === 200 || r.status === 201) {
      const newReqs = (r.data && r.data.requirements) || [];
      const added = newReqs.find((x) => x.crop_name === 'Wheat');
      if (added && added.required_date === '2026-12-31') {
        ok('3. Add a new requirement', `buyer=${buyer.public_id} reqs now=${newReqs.length}`);
      } else {
        bad('3. Add a new requirement', `added not present, reqs=${newReqs.length}`);
      }
    } else {
      bad('3. Add a new requirement', `status=${r.status}`);
    }
  }

  // 4. List a buyer's requirements
  let lr = await req('GET', `/api/buyers/${buyer.public_id}/requirements`);
  let list = unwrapList(lr);
  if (lr.status === 200 && list.length > 0) {
    ok('4. List buyer requirements', `count=${list.length}`);
  } else {
    bad('4. List buyer requirements', `status=${lr.status}`);
  }

  // 5. demands-for-lot — need a lot first
  // Log in as a seller first so the lot has sellerUserPublicId stamped
  const sellerLogin = await req('POST', '/api/auth/demo-login', { role: 'SELLER' });
  const sellerPublicId = sellerLogin.data && sellerLogin.data.user && sellerLogin.data.user.public_id;
  const sellerHeaders = sellerPublicId ? { 'X-Demo-User': sellerPublicId } : {};
  // Create a Tomato lot so we can match against Tomato demands
  const lotBody = {
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
  let lr0 = await req('POST', '/api/crop-lots', lotBody, sellerHeaders);
  if (lr0.status !== 201) {
    bad('5. demands-for-lot setup', 'could not create Tomato lot');
  } else {
    const lotPublicId = lr0.data.public_id;
    let fr = await req('GET', `/api/buyers/demands-for-lot/${lotPublicId}`);
    let scored = unwrapList(fr);
    if (fr.status === 200 && scored.length > 0 && scored[0].score > 0) {
      ok('5. demands-for-lot scoring', `top score=${scored[0].score} top buyer=${scored[0].buyer_name}`);
    } else {
      bad('5. demands-for-lot scoring', `status=${fr.status} count=${scored.length}`);
    }

    // 6. Filter demands-for-lot: every returned demand must be the same crop
    const wrong = scored.find((d) => (d.crop_name || '').toLowerCase() !== 'tomato');
    if (!wrong && scored.length > 0) {
      ok('6. demands-for-lot filter by crop', `all ${scored.length} are Tomato`);
    } else {
      bad('6. demands-for-lot filter by crop', wrong ? `found non-tomato: ${wrong.crop_name}` : 'no demands');
    }

    // -------- Existing flow: offer → counter → accept → deal --------
    // 7. Buyer makes an offer on the Tomato lot
    // First log in as buyer with activeBuyerId
    const loginBuyer = await req('POST', '/api/auth/demo-login', { role: 'BUYER', buyerId: idToDemoBuyerId(buyer.id) });
    if (loginBuyer.status !== 200) {
      bad('7. Buyer login', `status=${loginBuyer.status} body=${JSON.stringify(loginBuyer.data).slice(0,200)}`);
    } else {
      ok('7. Buyer login', `user=${loginBuyer.data.user.public_id}`);
    }
    const offerBody = {
      crop_lot_id: lr0.data.id,
      buyer_id: buyer.id,
      price: 15,
      quantity: 500,
      message: 'Phase 2 verify',
    };
    let or1 = await req('POST', '/api/offers', offerBody);
    if (or1.status === 201 || or1.status === 200) {
      ok('8. Buyer creates offer', `offer=${or1.data.offer ? or1.data.offer.public_id : (or1.data.public_id || '?')} status=${or1.data.offer ? or1.data.offer.status : or1.data.status}`);
    } else {
      bad('8. Buyer creates offer', `status=${or1.status}`);
    }
    const offerId = (or1.data.offer && or1.data.offer.public_id) || or1.data.public_id;

    // 9. Counter (seller)
    const loginSeller = await req('POST', '/api/auth/demo-login', { role: 'SELLER' });
    const sellerHdr = { 'X-Demo-User': (loginSeller.data && loginSeller.data.user && loginSeller.data.user.public_id) || '' };
    let cr = await req('POST', `/api/offers/${offerId}/counter`, { actor: 'FARMER', price: 17, quantity: 500, message: 'counter' }, sellerHdr);
    if (cr.status === 200 && (cr.data.offer || cr.data).status === 'COUNTERED') {
      ok('9. Counter offer', `status=${(cr.data.offer || cr.data).status}`);
    } else {
      bad('9. Counter offer', `status=${cr.status} body=${JSON.stringify(cr.data).slice(0,200)}`);
    }

    // 10. Accept
    let ar = await req('POST', `/api/offers/${offerId}/accept`, { actor: 'BUYER' });
    const offerFinal = ar.data.offer || ar.data;
    const dealFromAccept = ar.data.deal;
    if (ar.status === 200 && offerFinal.status === 'ACCEPTED') {
      ok('10. Accept offer', `offer=ACCEPTED deal=${dealFromAccept ? dealFromAccept.public_id : '?'}`);
    } else {
      bad('10. Accept offer', `status=${ar.status} body=${JSON.stringify(ar.data).slice(0,200)}`);
    }
    const dealPublicId = dealFromAccept && dealFromAccept.public_id;

    // 11. Lot is SOLD
    let cr2 = await req('GET', `/api/crop-lots/${lotPublicId}`);
    if (cr2.status === 200 && cr2.data.status === 'SOLD') {
      ok('11. Crop lot SOLD', `status=${cr2.data.status}`);
    } else {
      bad('11. Crop lot SOLD', `status=${cr2.data && cr2.data.status}`);
    }

    // -------- Enriched deal endpoints --------
    // 12. GET /api/deals/:publicId/enriched
    if (dealPublicId) {
      let er = await req('GET', `/api/deals/${dealPublicId}/enriched`);
      if (er.status === 200 && er.data.crop_lot && er.data.buyer && er.data.agreed_price_per_kg) {
        ok('12. Enriched deal single',
           `crop=${er.data.crop_lot.crop_name} buyer=${er.data.buyer.name} price=${er.data.agreed_price_per_kg}`);
      } else {
        bad('12. Enriched deal single', `status=${er.status} body=${JSON.stringify(er.data).slice(0,200)}`);
      }
    } else {
      bad('12. Enriched deal single', 'no deal public id');
    }

    // 13. GET /api/deals/list-enriched?role=BUYER&buyer_id=...
    if (buyer) {
      let lr3 = await req('GET', `/api/deals/list-enriched?role=BUYER&buyer_id=${buyer.id}`);
      let list = unwrapList(lr3);
      if (lr3.status === 200 && list.length >= 1 && list[0].crop_lot && list[0].buyer) {
        ok('13. Enriched deals for buyer', `count=${list.length} first=${list[0].crop_lot.crop_name}`);
      } else {
        bad('13. Enriched deals for buyer', `status=${lr3.status} count=${list.length}`);
      }
    }

    // 14. GET /api/deals/list-enriched?role=FARMER&seller_user_public_id=...
    // Use the SAME seller public_id that stamped the crop lot, not the
    // re-login (each demo-login returns a new ephemeral user).
    if (sellerPublicId) {
      const sp = sellerPublicId;
      let lr4 = await req('GET', `/api/deals/list-enriched?role=FARMER&seller_user_public_id=${sp}`);
      let list = unwrapList(lr4);
      if (lr4.status === 200 && list.length >= 1) {
        ok('14. Enriched deals for seller', `count=${list.length}`);
      } else {
        bad('14. Enriched deals for seller', `status=${lr4.status} count=${list.length}`);
      }
    }
  }

  // 15. Remove a requirement
  // We added a Wheat requirement to buyer 0 above; find its index and remove
  if (buyer) {
    let lr5 = await req('GET', `/api/buyers/${buyer.public_id}/requirements`);
    let reqs = unwrapList(lr5);
    const wheatIdx = reqs.findIndex((r) => r.crop_name === 'Wheat');
    if (wheatIdx >= 0) {
      let dr3 = await req('DELETE', `/api/buyers/${buyer.public_id}/requirements/${wheatIdx}`);
      if (dr3.status === 200) {
        const newReqs = (dr3.data && dr3.data.requirements) || [];
        if (!newReqs.find((x) => x.crop_name === 'Wheat')) {
          ok('15. Remove a requirement', `reqs now=${newReqs.length}`);
        } else {
          bad('15. Remove a requirement', 'wheat still present');
        }
      } else {
        bad('15. Remove a requirement', `status=${dr3.status}`);
      }
    } else {
      bad('15. Remove a requirement', 'no wheat requirement to remove');
    }
  }

  // 16. Demand filter by state
  let dr4 = await req('GET', '/api/buyers/demands?state=bihar');
  let stateFiltered = unwrapList(dr4);
  if (dr4.status === 200) {
    ok('16. Filter demands by state', `bihar count=${stateFiltered.length}`);
  } else {
    bad('16. Filter demands by state', `status=${dr4.status}`);
  }

  // 17. Demand filter by location substring
  let dr5 = await req('GET', '/api/buyers/demands?location=patna');
  let locFiltered = unwrapList(dr5);
  if (dr5.status === 200) {
    ok('17. Filter demands by location', `count=${locFiltered.length}`);
  } else {
    bad('17. Filter demands by location', `status=${dr5.status}`);
  }

  // -------- Summary --------
  console.log('');
  console.log(`=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('verify_phase2.cjs threw:', e);
  process.exit(1);
});
