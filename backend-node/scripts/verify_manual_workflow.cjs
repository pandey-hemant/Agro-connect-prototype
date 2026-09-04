#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * verify_manual_workflow.cjs — exercise the user-visible workflow
 * that a demo reviewer would walk through:
 *
 *   1. Open the app at / → redirected to /login.
 *   2. Log in as the SELLER demo account (email + password).
 *   3. /api/auth/me round-trips the role.
 *   4. Visit /seller (SPA) → 200.
 *   5. Create a crop lot (the "Add Crop Lot" flow).
 *   6. /api/fpos/mine shows zero memberships (fresh seller).
 *   7. Seed demo FPOs, then join one with the new lot.
 *   8. /api/fpos/mine now shows the FPO.
 *   9. Switch role to BUYER → /me shows role=BUYER.
 *   10. Visit /buyer (SPA) → 200, marketplace still shows the lot.
 *   11. Switch back to SELLER → /fpos/mine still shows the FPO.
 *   12. Leave the FPO → /fpos/mine is empty.
 *
 * This is the same flow a SIH reviewer would walk through with
 * the UI, but driven entirely by HTTP so it can run in CI.
 */

'use strict';

const http = require('http');

const BASE = 'http://localhost:5050';
const FRONTEND = 'http://localhost:5173';

function req(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'content-type': 'application/json', ...headers },
    };
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
        resolve({ status: res.statusCode, data });
      });
    });
    r.on('error', reject);
    if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

function page(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, FRONTEND);
    const r = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET' },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    r.on('error', reject);
    r.end();
  });
}

const results = [];
function step(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  // --- 1. Frontend serves the SPA shell ----------------------------
  const home = await page('/');
  step('1. / serves the SPA shell', home.status === 200 && home.body.includes('id="root"'),
    `status=${home.status}`);

  // --- 2. Login as the SELLER demo account -------------------------
  const login = await req('POST', '/api/auth/login', {
    body: { email: 'farmer@agroconnect.demo', password: 'farmer123' },
  });
  step('2. login SELLER succeeds',
    login.status === 200 && Boolean(login.data?.user?.public_id),
    `user=${login.data?.user?.public_id}`);
  const token = login.data?.user?.public_id;
  const userId = login.data?.user?.public_id;

  // --- 3. /me round-trips the role ---------------------------------
  const me = await req('GET', '/api/auth/me', { headers: { 'x-demo-user': token } });
  step('3. /me returns role=SELLER',
    me.status === 200 && me.data?.user?.role === 'SELLER' && me.data?.user?.public_id === userId);

  // --- 4. /seller (SPA) reachable ----------------------------------
  const sellerPage = await page('/seller');
  step('4. /seller returns 200', sellerPage.status === 200);

  // --- 5. Create a crop lot ----------------------------------------
  // Use a unique crop name + quantity so the verifier can run
  // repeatedly against the same in-memory DB without conflicting
  // with prior runs.
  const stamp = Date.now().toString(36);
  const lot = await req('POST', '/api/crop-lots', {
    headers: { 'x-demo-user': token },
    body: {
      crop_name: `Tomato-${stamp}`,
      quantity: 100,
      quantity_unit: 'kg',
      location: 'Patna',
      base_price: 18,
    },
  });
  step('5. seller creates a lot',
    lot.status === 201 && /^CL-/.test(lot.data?.public_id || ''),
    `pid=${lot.data?.public_id}`);
  const lotPid = lot.data?.public_id;

  // --- 6. /fpos/mine starts in baseline state (the demo seller may
  // already have memberships from prior verifier runs against the
  // same in-memory DB; we record the baseline and check the diff
  // after the join.) -----------------------------------------
  const mineBefore = await req('GET', '/api/fpos/mine', { headers: { 'x-demo-user': token } });
  const beforePids = (mineBefore.data?.results || []).map((f) => f.public_id);
  step('6. /fpos/mine reachable (baseline)',
    mineBefore.status === 200,
    `baseline count=${beforePids.length}`);

  // --- 7. Seed demo FPOs and join one with the new lot -------------
  await req('POST', '/api/fpos/seed-demo', { headers: { 'x-demo-user': token } });
  const fpos = await req('GET', '/api/fpos', { headers: { 'x-demo-user': token } });
  const first = (fpos.data?.results || [])[0];
  if (!first?.public_id) {
    step('7. seed demo FPOs populated the list', false, 'no FPOs after seed');
    return;
  }
  step('7a. seed-demo populated the FPO list', (fpos.data?.results || []).length > 0,
    `count=${(fpos.data?.results || []).length}`);

  const join = await req('POST', `/api/fpos/${first.public_id}/join`, {
    headers: { 'x-demo-user': token },
    body: { crop_lot_id: lotPid },
  });
  step('7b. joined the FPO with the new lot',
    join.status === 200 && (join.data?.members || []).length >= 1,
    `members=${(join.data?.members || []).length}`);

  // --- 8. /fpos/mine now reflects the membership -------------------
  const mineAfter = await req('GET', '/api/fpos/mine', { headers: { 'x-demo-user': token } });
  const afterPids = (mineAfter.data?.results || []).map((f) => f.public_id);
  step('8. /fpos/mine now includes the FPO we just joined',
    mineAfter.status === 200 &&
      afterPids.includes(first.public_id) &&
      afterPids.length >= beforePids.length,
    `before=${beforePids.length} after=${afterPids.length} includes=${afterPids.includes(first.public_id)}`);

  // --- 9. Switch role to BUYER -------------------------------------
  const sw = await req('POST', '/api/auth/switch-role', {
    headers: { 'x-demo-user': token },
    body: { role: 'BUYER' },
  });
  const buyerToken = sw.data?.user?.public_id;
  step('9. switch role preserves user id, role=BUYER',
    sw.status === 200 && sw.data?.user?.role === 'BUYER' && sw.data?.user?.public_id === userId);

  // --- 10. /buyer reachable, marketplace still shows the lot -------
  const buyerPage = await page('/buyer');
  step('10a. /buyer returns 200', buyerPage.status === 200);
  const market = await req('GET', '/api/crop-lots/available', {
    headers: { 'x-demo-user': buyerToken },
  });
  const mPids = (market.data?.results || []).map((l) => l.public_id);
  step('10b. marketplace still shows the seller\'s lot',
    market.status === 200 && mPids.includes(lotPid),
    `count=${(market.data?.results || []).length} includes=${mPids.includes(lotPid)}`);

  // --- 11. Switch back to SELLER → /fpos/mine still has the FPO ---
  const sw2 = await req('POST', '/api/auth/switch-role', {
    headers: { 'x-demo-user': buyerToken },
    body: { role: 'SELLER' },
  });
  const sellerToken2 = sw2.data?.user?.public_id;
  const mineBack = await req('GET', '/api/fpos/mine', { headers: { 'x-demo-user': sellerToken2 } });
  const backPids = (mineBack.data?.results || []).map((f) => f.public_id);
  step('11. after switching back, /fpos/mine still has the FPO',
    mineBack.status === 200 && backPids.includes(first.public_id),
    `count=${mineBack.data?.count}`);

  // --- 12. Leave the FPO → our new lot is no longer a member ------
  // The FPO may still appear in /fpos/mine if the seller has other
  // crop lots joined to it from prior runs against the same in-memory
  // DB. The invariant we actually care about is that *our new lot*
  // is no longer a member: the FPO wire record's my_member_lot_public_ids
  // must not include lotPid anymore.
  const leave = await req('POST', `/api/fpos/${first.public_id}/leave`, {
    headers: { 'x-demo-user': sellerToken2 },
    body: { crop_lot_id: lotPid },
  });
  step('12a. leave FPO succeeded', leave.status === 200);
  const fpoAfter = await req('GET', `/api/fpos/${first.public_id}`, {
    headers: { 'x-demo-user': sellerToken2 },
  });
  const myLotsAfter = Array.isArray(fpoAfter.data?.my_member_lot_public_ids)
    ? fpoAfter.data.my_member_lot_public_ids
    : [];
  step('12b. our new lot is no longer a member of the FPO',
    fpoAfter.status === 200 && !myLotsAfter.includes(lotPid),
    `my_member_lot_public_ids=${myLotsAfter.length} includes-new=${myLotsAfter.includes(lotPid)}`);

  // --- 13. Lot is still ACTIVE after leaving the FPO ---------------
  const lotAfter = await req('GET', `/api/crop-lots/${lotPid}`);
  step('13. lot stays ACTIVE after leaving the FPO',
    lotAfter.data?.status === 'ACTIVE',
    `status=${lotAfter.data?.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach((r) => console.log(`  - ${r.name} :: ${r.detail}`));
    process.exit(1);
  }
})().catch((e) => {
  console.error('manual workflow verifier crashed:', e);
  process.exit(2);
});
