/**
 * verify_fpo_join.cjs — focused regression for the farmer FPO Join flow.
 *
 *   1. /api/fpos         — list all FPOs (must include is_demo, member_count)
 *   2. /api/crop-lots/available — pick a real ACTIVE lot to join with
 *   3. /api/fpos         — create a new FPO, it appears in the list
 *   4. /api/fpos/:id/join — join with the ACTIVE lot
 *   5. /api/fpos/:id     — re-read; member_count went 0 → 1
 *   6. /api/fpos/:id/join — re-join is idempotent (count stays 1)
 *   7. /api/fpos/:id     — the joined lot appears in the members[] array
 *   8. /api/fpos/:id/leave — member is removed; count goes back to 0
 *   9. /api/fpos/:id/leave — leave with unknown lot returns 404
 *  10. /api/fpos/:id/leave — leave twice is safe (already gone)
 *  11. /api/crop-lots/:id — lot stays ACTIVE after leave
 *  12. The Farmer Dashboard wire contract:
 *      - GET /api/fpos returns { results: [...] }
 *      - Each row has public_id, name, member_count, members[]
 *      - members[].crop_lot_id is the Mongo ObjectId of the lot
 *      - The frontend uses this to render "Joined" / "Join FPO" toggles
 *
 * Assumes the backend is already up at http://localhost:5050 with
 * the demo seed loaded.
 */
'use strict';

const http = require('http');
const BASE = 'http://localhost:5050';

let pass = 0, fail = 0;
const results = [];

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
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

function unwrapList(r) {
  if (!r || !r.data) return [];
  if (Array.isArray(r.data)) return r.data;
  if (Array.isArray(r.data.results)) return r.data.results;
  return [];
}

(async () => {
  // 0. Health
  const h = await req('GET', '/api/health');
  if (h.status === 200 && h.data && h.data.database === 'ok') {
    ok('0. Server reachable', `status=${h.status} db=${h.data.database}`);
  } else {
    bad('0. Server reachable', JSON.stringify(h));
    process.exit(1);
  }

  // 1. List FPOs
  const lr0 = await req('GET', '/api/fpos');
  const initial = unwrapList(lr0);
  if (lr0.status === 200 && initial.length > 0) {
    ok('1. List FPOs', `count=${initial.length}`);
  } else {
    bad('1. List FPOs', `status=${lr0.status} count=${initial.length}`);
  }

  // 1a. The envelope must be { results: [...] } — FarmerDashboard reads
  //     state.fpos.list, which the slice reducer unwraps from .results.
  if (lr0.data && Array.isArray(lr0.data.results)) {
    ok('1a. FPOs wire shape is { results: [...] }', 'envelope preserved');
  } else {
    bad('1a. FPOs wire shape is { results: [...] }', JSON.stringify(lr0.data).slice(0, 200));
  }

  // 1b. Every FPO has the fields the dashboard renders
  const badShape = initial.find(
    (f) =>
      !f.public_id ||
      typeof f.name !== 'string' ||
      typeof f.member_count !== 'number' ||
      !Array.isArray(f.members)
  );
  if (badShape) {
    bad('1b. FPO wire shape (public_id, name, member_count, members[])', JSON.stringify(badShape).slice(0, 200));
  } else {
    ok('1b. FPO wire shape (public_id, name, member_count, members[])', `all ${initial.length} well-shaped`);
  }

  // 2. Pick an ACTIVE lot
  const available = await req('GET', '/api/crop-lots/available');
  const availableLots = unwrapList(available);
  let lotForJoin = null;
  if (availableLots.length === 0) {
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
    const lr2 = await req('POST', '/api/crop-lots', lotBody);
    if (lr2.status === 201) {
      lotForJoin = { publicId: lr2.data.public_id, mongoId: lr2.data.id };
      ok('2-pre. Created fresh ACTIVE lot', `lot=${lotForJoin.publicId}`);
    } else {
      bad('2-pre. Create ACTIVE lot', `status=${lr2.status}`);
    }
  } else {
    lotForJoin = { publicId: availableLots[0].public_id, mongoId: availableLots[0].id };
    ok('2-pre. Picked existing ACTIVE lot', `lot=${lotForJoin.publicId}`);
  }
  if (!lotForJoin) {
    bad('2. Need an ACTIVE lot to test', 'no lot available');
    process.exit(1);
  }

  // 3. Create a fresh FPO
  const stamp = Date.now().toString(36).toUpperCase();
  const newFpoBody = {
    name: `Join Test FPO ${stamp}`,
    location: 'Patna',
    district: 'Patna',
    state: 'Bihar',
  };
  const cr = await req('POST', '/api/fpos', newFpoBody);
  if (cr.status !== 201 || !cr.data || !cr.data.public_id) {
    bad('3. Create FPO', `status=${cr.status} body=${JSON.stringify(cr.data).slice(0, 200)}`);
    process.exit(1);
  }
  const fpoPublicId = cr.data.public_id;
  ok('3. Create FPO', `fpo=${fpoPublicId} members=${cr.data.member_count}`);

  // 3a. The new FPO has is_demo=false
  if (cr.data.is_demo === false) {
    ok('3a. New FPO is_demo=false', `fpo=${fpoPublicId}`);
  } else {
    bad('3a. New FPO is_demo=false', `is_demo=${cr.data.is_demo}`);
  }

  // 3b. Appears in list
  const lr3 = await req('GET', '/api/fpos');
  const afterCreate = unwrapList(lr3);
  const found = afterCreate.find((f) => f.public_id === fpoPublicId);
  if (found && afterCreate.length === initial.length + 1) {
    ok('3b. New FPO appears in list', `list size ${initial.length} → ${afterCreate.length}`);
  } else {
    bad('3b. New FPO appears in list', `found=${!!found} size=${afterCreate.length}`);
  }

  // 4. Join with the ACTIVE lot
  const jr1 = await req('POST', `/api/fpos/${fpoPublicId}/join`, { crop_lot_id: lotForJoin.publicId });
  if (jr1.status === 200 && jr1.data.member_count === 1) {
    ok('4. Join FPO with ACTIVE lot', `members=${jr1.data.member_count}`);
  } else {
    bad('4. Join FPO with ACTIVE lot', `status=${jr1.status} body=${JSON.stringify(jr1.data).slice(0, 200)}`);
  }

  // 5. Re-read the FPO; count went 0 → 1
  const fr = await req('GET', `/api/fpos/${fpoPublicId}`);
  if (fr.status === 200 && fr.data.member_count === 1) {
    ok('5. FPO detail shows member_count=1', `members=${fr.data.member_count}`);
  } else {
    bad('5. FPO detail shows member_count=1', `status=${fr.status} members=${fr.data && fr.data.member_count}`);
  }

  // 6. Idempotent re-join
  const jr2 = await req('POST', `/api/fpos/${fpoPublicId}/join`, { crop_lot_id: lotForJoin.publicId });
  if (jr2.status === 200 && jr2.data.member_count === 1) {
    ok('6. Re-join is idempotent (count stays 1)', `members=${jr2.data.member_count}`);
  } else {
    bad('6. Re-join is idempotent (count stays 1)', `status=${jr2.status} members=${jr2.data && jr2.data.member_count}`);
  }

  // 7. The members[] array contains the joined lot
  const members = (fr.data && fr.data.members) || [];
  const contains = members.some((m) => String(m.crop_lot_id) === String(lotForJoin.mongoId));
  if (contains) {
    ok('7. members[] contains the joined lot', `lot=${lotForJoin.mongoId}`);
  } else {
    bad('7. members[] contains the joined lot', `members=${JSON.stringify(members)}`);
  }

  // 7a. members[].crop_lot_id is the Mongo ObjectId (not publicId),
  //     which is what the frontend's joinedLotPublicIdsForFpo mapper
  //     needs to reverse-lookup.
  if (members.length > 0 && typeof members[0].crop_lot_id === 'string' && members[0].crop_lot_id.length >= 12) {
    ok('7a. members[0].crop_lot_id is a Mongo ObjectId string', `id=${members[0].crop_lot_id}`);
  } else {
    bad('7a. members[0].crop_lot_id is a Mongo ObjectId string', JSON.stringify(members[0]));
  }

  // 8. Leave
  const lv = await req('POST', `/api/fpos/${fpoPublicId}/leave`, { crop_lot_id: lotForJoin.publicId });
  if (lv.status === 200 && lv.data.member_count === 0) {
    ok('8. Leave FPO removes the member', `members=${lv.data.member_count}`);
  } else {
    bad('8. Leave FPO removes the member', `status=${lv.status} members=${lv.data && lv.data.member_count}`);
  }

  // 9. Leave with unknown lot
  const lv2 = await req('POST', `/api/fpos/${fpoPublicId}/leave`, { crop_lot_id: 'CL-NEVER-EXISTED' });
  if (lv2.status === 404) {
    ok('9. Leave with unknown lot returns 404', `status=${lv2.status}`);
  } else {
    bad('9. Leave with unknown lot returns 404', `status=${lv2.status}`);
  }

  // 10. Leave twice is safe (no error, members=0)
  const lv3 = await req('POST', `/api/fpos/${fpoPublicId}/leave`, { crop_lot_id: lotForJoin.publicId });
  if (lv3.status === 200 && lv3.data.member_count === 0) {
    ok('10. Leave twice is safe', `members=${lv3.data.member_count}`);
  } else {
    bad('10. Leave twice is safe', `status=${lv3.status} members=${lv3.data && lv3.data.member_count}`);
  }

  // 11. Lot stays ACTIVE after leave
  const cr11 = await req('GET', `/api/crop-lots/${lotForJoin.publicId}`);
  if (cr11.status === 200 && cr11.data.status === 'ACTIVE') {
    ok('11. Lot stays ACTIVE after leave', `status=${cr11.data.status}`);
  } else {
    bad('11. Lot stays ACTIVE after leave', `status=${cr11.data && cr11.data.status}`);
  }

  // 12. Re-join after leave is allowed (Join available again)
  const jr3 = await req('POST', `/api/fpos/${fpoPublicId}/join`, { crop_lot_id: lotForJoin.publicId });
  if (jr3.status === 200 && jr3.data.member_count === 1) {
    ok('12. Re-join after leave is allowed', `members=${jr3.data.member_count}`);
  } else {
    bad('12. Re-join after leave is allowed', `status=${jr3.status} members=${jr3.data && jr3.data.member_count}`);
  }

  // 13. List endpoint still returns the FPO (data persists)
  const lr13 = await req('GET', '/api/fpos');
  const refreshed = unwrapList(lr13);
  const stillThere = refreshed.find((f) => f.public_id === fpoPublicId);
  if (stillThere) {
    ok('13. Data survives a refresh (GET /fpos again)', `fpo=${fpoPublicId}`);
  } else {
    bad('13. Data survives a refresh (GET /fpos again)', 'fpo missing');
  }

  // -------- Summary --------
  console.log('');
  console.log(`=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('verify_fpo_join.cjs threw:', e);
  process.exit(1);
});
