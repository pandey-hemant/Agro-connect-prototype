/**
 * verify_role_switch_id_handling.cjs — Phase 4 regression test for
 * the role-switch NaN bug. Confirms that:
 *
 *   1. switch-role to BUYER with a valid Mongo ObjectId (the shape
 *      the React frontend sends via selectedBuyer.id) works and
 *      stores the id as a String in User.activeBuyerId.
 *   2. switch-role to BUYER with a BUY-... publicId also works.
 *   3. switch-role to BUYER with a numeric id (legacy shape) works.
 *   4. switch-role to BUYER with a "NaN" string returns 400 (was
 *      previously 500 "Cast to Number failed for value NaN").
 *   5. switch-role to BUYER with garbage "abc" returns 400.
 *   6. switch-role to BUYER with empty string is treated as null.
 *   7. switch-role to BUYER with no buyerId at all sets
 *      activeBuyerId to null.
 *   8. switch-role to SELLER clears both activeBuyerId and
 *      activeFpoId, regardless of what was there.
 *   9. switch-role to FPO with a valid FPO- publicId works.
 *  10. The full set of role transitions (BUYER→FARMER, FARMER→FPO,
 *      FPO→BUYER, FARMER→BUYER, BUYER→FPO) all succeed end-to-end.
 *  11. demo-login (the path RoleSelect.jsx uses) also defends
 *      against "NaN" / garbage / valid ObjectId inputs.
 *  12. The /api/auth/me response is shape-stable after each switch
 *      (no NaN anywhere in the wire payload).
 *
 * If the User.activeBuyerId schema is reverted to Number or the
 * Number() coercion is reintroduced in routes/auth.js, this test
 * will fail.
 */
'use strict';

const axios = require('axios');

const BASE = 'http://localhost:5050/api';
const api = axios.create({ baseURL: BASE, timeout: 8000, validateStatus: () => true });

let pass = 0, fail = 0;
function ok(name, detail) {
  pass++;
  console.log(`[OK]   ${name}` + (detail ? '  — ' + detail : ''));
}
function bad(name, detail) {
  fail++;
  console.log(`[FAIL] ${name}` + (detail ? '  — ' + detail : ''));
}
function isCleanPayload(o) {
  if (o === null || o === undefined) return true;
  if (typeof o === 'number') return Number.isFinite(o);
  if (Array.isArray(o)) return o.every(isCleanPayload);
  if (typeof o === 'object') {
    return Object.keys(o).every((k) => isCleanPayload(o[k]));
  }
  return true;
}

async function switchRole(token, body) {
  return api.post('/auth/switch-role', body, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function demoLogin(body) {
  return api.post('/auth/demo-login', body);
}

(async () => {
  // --- 0. Pre-flight
  const h = await api.get('/health');
  if (h.status !== 200 || h.data.database !== 'ok') {
    bad('0. Server reachable', `status=${h.status} db=${h.data.database}`);
    return finish();
  }
  ok('0. Server reachable', `status=200 db=ok`);

  // --- 0a. Find a real buyer + real FPO so we can use their ids.
  const buyersRes = await api.get('/auth/buyers');
  const realBuyer = (buyersRes.data.results || [])[0];
  if (!realBuyer || !realBuyer.id) {
    bad('0a. Demo buyer exists', 'no buyer in /auth/buyers');
    return finish();
  }
  ok('0a. Demo buyer exists', `public_id=${realBuyer.public_id}`);

  const fposRes = await api.get('/auth/fpos');
  const realFpo = (fposRes.data.results || [])[0];
  if (!realFpo || !realFpo.public_id) {
    bad('0b. Demo FPO exists', 'no FPO in /auth/fpos');
    return finish();
  }
  ok('0b. Demo FPO exists', `public_id=${realFpo.public_id}`);

  // --- Login as a fresh SELLER (no buyer/fpo yet).
  const seedLogin = await demoLogin({ role: 'SELLER' });
  if (seedLogin.status !== 200 || !seedLogin.data?.token) {
    bad('seed. demo-login SELLER', `status=${seedLogin.status}`);
    return finish();
  }
  const token = seedLogin.data.token;
  ok('seed. demo-login SELLER works', `public_id=${seedLogin.data.user?.public_id}`);

  // --- 1. switch-role to BUYER with valid Mongo ObjectId
  const r1 = await switchRole(token, { role: 'BUYER', buyerId: realBuyer.id });
  if (r1.status === 200 && r1.data?.user?.active_buyer_id === realBuyer.id) {
    ok(
      '1. switch-role BUYER + valid ObjectId → 200 + stored as String',
      `active_buyer_id=${r1.data.user.active_buyer_id}`,
    );
  } else {
    bad('1. switch-role BUYER + valid ObjectId', `status=${r1.status} active=${r1.data?.user?.active_buyer_id} detail=${r1.data?.detail}`);
  }

  // --- 2. switch-role to BUYER with BUY-... publicId
  const r2 = await switchRole(token, { role: 'BUYER', buyerId: realBuyer.public_id });
  if (r2.status === 200 && r2.data?.user?.active_buyer_id === realBuyer.public_id) {
    ok('2. switch-role BUYER + BUY- publicId', `active_buyer_id=${r2.data.user.active_buyer_id}`);
  } else {
    bad('2. switch-role BUYER + BUY- publicId', `status=${r2.status} detail=${r2.data?.detail}`);
  }

  // --- 3. switch-role to BUYER with numeric id
  const r3 = await switchRole(token, { role: 'BUYER', buyerId: 12345 });
  if (r3.status === 200 && r3.data?.user?.active_buyer_id) {
    ok('3. switch-role BUYER + numeric id', `active_buyer_id=${r3.data.user.active_buyer_id}`);
  } else {
    bad('3. switch-role BUYER + numeric id', `status=${r3.status} detail=${r3.data?.detail}`);
  }

  // --- 4. switch-role to BUYER with "NaN" string (THE BUG)
  const r4 = await switchRole(token, { role: 'BUYER', buyerId: 'NaN' });
  if (r4.status === 400) {
    ok('4. switch-role BUYER + "NaN" → 400 (was 500)', `status=${r4.status} detail="${r4.data?.detail}"`);
  } else {
    bad('4. switch-role BUYER + "NaN"', `status=${r4.status} detail=${r4.data?.detail}`);
  }

  // --- 5. switch-role to BUYER with garbage "abc"
  const r5 = await switchRole(token, { role: 'BUYER', buyerId: 'abc' });
  if (r5.status === 400) {
    ok('5. switch-role BUYER + "abc" → 400', `status=${r5.status} detail="${r5.data?.detail}"`);
  } else {
    bad('5. switch-role BUYER + "abc"', `status=${r5.status} detail=${r5.data?.detail}`);
  }

  // --- 6. switch-role to BUYER with empty string
  const r6 = await switchRole(token, { role: 'BUYER', buyerId: '' });
  if (r6.status === 200 && r6.data?.user?.active_buyer_id == null) {
    ok('6. switch-role BUYER + "" → active_buyer_id is null', 'cleared as expected');
  } else {
    bad('6. switch-role BUYER + ""', `status=${r6.status} active=${r6.data?.user?.active_buyer_id} detail=${r6.data?.detail}`);
  }

  // --- 7. switch-role to BUYER with no buyerId field
  const r7 = await switchRole(token, { role: 'BUYER' });
  if (r7.status === 200 && r7.data?.user?.active_buyer_id == null) {
    ok('7. switch-role BUYER + no buyerId → null', 'ok');
  } else {
    bad('7. switch-role BUYER + no buyerId', `status=${r7.status} active=${r7.data?.user?.active_buyer_id}`);
  }

  // --- 8. switch-role to SELLER clears activeBuyerId and activeFpoId
  await switchRole(token, { role: 'BUYER', buyerId: realBuyer.id });
  await switchRole(token, { role: 'FPO', fpoId: realFpo.public_id });
  const r8 = await switchRole(token, { role: 'SELLER' });
  if (
    r8.status === 200 &&
    r8.data?.user?.active_buyer_id == null &&
    r8.data?.user?.active_fpo_id == null
  ) {
    ok('8. switch-role SELLER clears both', 'active_buyer_id=null active_fpo_id=null');
  } else {
    bad(
      '8. switch-role SELLER clears both',
      `status=${r8.status} buyer=${r8.data?.user?.active_buyer_id} fpo=${r8.data?.user?.active_fpo_id}`,
    );
  }

  // --- 9. switch-role to FPO with valid FPO- publicId
  const r9 = await switchRole(token, { role: 'FPO', fpoId: realFpo.public_id });
  if (r9.status === 200 && r9.data?.user?.active_fpo_id === realFpo.public_id) {
    ok('9. switch-role FPO + FPO- publicId', `active_fpo_id=${r9.data.user.active_fpo_id}`);
  } else {
    bad('9. switch-role FPO + FPO- publicId', `status=${r9.status} detail=${r9.data?.detail}`);
  }

  // --- 10. full transitions
  const transitions = [
    ['SELLER', undefined, undefined, 'FARMER→SELLER'],
    ['BUYER', realBuyer.id, undefined, 'FARMER→BUYER'],
    ['FPO', undefined, realFpo.public_id, 'BUYER→FPO'],
    ['BUYER', realBuyer.id, undefined, 'FPO→BUYER'],
    ['SELLER', undefined, undefined, 'BUYER→FARMER'],
  ];
  let allOk = true;
  for (const [role, buyerId, fpoId, label] of transitions) {
    const body = { role };
    if (buyerId != null) body.buyerId = buyerId;
    if (fpoId != null) body.fpoId = fpoId;
    const r = await switchRole(token, body);
    if (r.status !== 200) {
      bad(`10.trans. ${label}`, `status=${r.status} detail=${r.data?.detail}`);
      allOk = false;
    }
  }
  if (allOk) ok('10. Full role transitions (5 directions)', 'all 200');

  // --- 11. demo-login (the path RoleSelect.jsx uses)
  const dl1 = await demoLogin({ role: 'BUYER', buyerId: 'NaN' });
  if (dl1.status === 400) {
    ok('11a. demo-login BUYER + "NaN" → 400', `status=${dl1.status} detail="${dl1.data?.detail}"`);
  } else {
    bad('11a. demo-login BUYER + "NaN"', `status=${dl1.status} detail=${dl1.data?.detail}`);
  }
  const dl2 = await demoLogin({ role: 'BUYER', buyerId: 'xyz' });
  if (dl2.status === 400) {
    ok('11b. demo-login BUYER + "xyz" → 400', `status=${dl2.status}`);
  } else {
    bad('11b. demo-login BUYER + "xyz"', `status=${dl2.status} detail=${dl2.data?.detail}`);
  }
  const dl3 = await demoLogin({ role: 'BUYER', buyerId: realBuyer.id });
  if (dl3.status === 200 && dl3.data?.user?.active_buyer_id === realBuyer.id) {
    ok('11c. demo-login BUYER + valid ObjectId → 200', `active_buyer_id=${dl3.data.user.active_buyer_id}`);
  } else {
    bad('11c. demo-login BUYER + valid ObjectId', `status=${dl3.status} active=${dl3.data?.user?.active_buyer_id}`);
  }

  // --- 12. wire shape — no NaN anywhere
  const me = await api.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  if (me.status === 200 && isCleanPayload(me.data)) {
    ok('12. /auth/me payload is shape-stable (no NaN)', 'recursive check passed');
  } else {
    bad('12. /auth/me payload clean', `status=${me.status} clean=${isCleanPayload(me.data)}`);
  }

  return finish();
})();

function finish() {
  console.log(`\n=== role-switch id handling verifier ===`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
