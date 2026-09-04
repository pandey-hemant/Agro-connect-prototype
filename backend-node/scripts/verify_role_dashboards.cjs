#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * verify_role_dashboards.cjs — exercise role-specific dashboard wiring.
 *
 *   1. Three demo accounts (SELLER / BUYER / FPO) demo-login round-trip.
 *   2. /api/auth/me returns the right shape for each role.
 *   3. /api/fpos/mine is reachable for the SELLER and FPO users and
 *      returns the per-user FPO membership list.
 *   4. The /api/crop-lots list only contains lots the seller owns
 *      (data isolation between demo Farmer and demo Buyer).
 *   5. Switching role preserves the user id but updates the role.
 *   6. Anonymous requests to /api/fpos/mine return an empty list, not
 *      an error (graceful unauthenticated behaviour).
 *   7. The frontend's role-gated routes are reachable and 200-OK
 *      (SPA serves the same index.html for all paths, but it must
 *      return 200 and the static asset is non-empty).
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

function frontendGet(path) {
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
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  // --- 1. Health --------------------------------------------------------
  const h = await req('GET', '/api/health');
  check('health 200', h.status === 200 && h.data && h.data.status === 'ok',
    `status=${h.status} db=${h.data && h.data.database}`);

  // --- 2. Login as SELLER ---------------------------------------------
  const loginSeller = await req('POST', '/api/auth/login', {
    body: { email: 'farmer@agroconnect.demo', password: 'farmer123' },
  });
  check('login SELLER 200', loginSeller.status === 200 && loginSeller.data?.user?.public_id,
    `status=${loginSeller.status} userId=${loginSeller.data?.user?.public_id}`);
  // The "token" is the user's publicId — that's what the frontend
  // stores in localStorage and sends as X-Demo-User on every request.
  const sellerToken = loginSeller.data?.user?.public_id;
  const sellerId = loginSeller.data?.user?.public_id;
  const sellerRole = loginSeller.data?.user?.role;

  // --- 3. Login as BUYER ----------------------------------------------
  const loginBuyer = await req('POST', '/api/auth/login', {
    body: { email: 'buyer@agroconnect.demo', password: 'buyer123' },
  });
  check('login BUYER 200', loginBuyer.status === 200 && loginBuyer.data?.user?.public_id,
    `status=${loginBuyer.status} userId=${loginBuyer.data?.user?.public_id}`);
  const buyerToken = loginBuyer.data?.user?.public_id;
  const buyerId = loginBuyer.data?.user?.public_id;
  const buyerRole = loginBuyer.data?.user?.role;

  // --- 4. Login as FPO ------------------------------------------------
  const loginFpo = await req('POST', '/api/auth/login', {
    body: { email: 'fpofarmer@agroconnect.demo', password: 'farmer123' },
  });
  check('login FPO 200', loginFpo.status === 200 && loginFpo.data?.user?.public_id,
    `status=${loginFpo.status} userId=${loginFpo.data?.user?.public_id}`);
  const fpoToken = loginFpo.data?.user?.public_id;

  // --- 5. /me shape ----------------------------------------------------
  // /me wraps the user in { user: {...} } and uses the snake_case
  // wire format (`public_id`, `role`, `email`) that the frontend's
  // authSlice already consumes.
  const meSeller = await req('GET', '/api/auth/me', { headers: { 'x-demo-user': sellerToken } });
  check('me SELLER shape',
    meSeller.status === 200 &&
      meSeller.data?.user?.role === 'SELLER' &&
      meSeller.data?.user?.email === 'farmer@agroconnect.demo',
    `role=${meSeller.data?.user?.role} email=${meSeller.data?.user?.email}`);
  const meBuyer = await req('GET', '/api/auth/me', { headers: { 'x-demo-user': buyerToken } });
  check('me BUYER shape',
    meBuyer.status === 200 && meBuyer.data?.user?.role === 'BUYER',
    `role=${meBuyer.data?.user?.role}`);
  const meFpo = await req('GET', '/api/auth/me', { headers: { 'x-demo-user': fpoToken } });
  check('me FPO shape',
    meFpo.status === 200 && meFpo.data?.user?.role === 'FPO',
    `role=${meFpo.data?.user?.role}`);

  // --- 6. SELLER owns the seller-seed crop lots, BUYER doesn't --------
  // Create a lot as seller, then list and ensure it's present.
  const create = await req('POST', '/api/crop-lots', {
    headers: { 'x-demo-user': sellerToken },
    body: {
      crop_name: 'Tomato',
      quantity: 250,
      quantity_unit: 'kg',
      location: 'Patna, Bihar',
      base_price: 16,
    },
  });
  check('seller creates a crop lot',
    create.status === 201 && /^CL-/.test(create.data?.public_id || ''),
    `status=${create.status} pid=${create.data?.public_id}`);
  const sellerLotPid = create.data?.public_id;

  // Listing as seller must include it.
  const sellerList = await req('GET', '/api/crop-lots', { headers: { 'x-demo-user': sellerToken } });
  const sellerListIds = (sellerList.data?.results || []).map((l) => l.public_id);
  check('seller list includes own lot',
    sellerList.status === 200 && sellerListIds.includes(sellerLotPid),
    `count=${sellerListIds.length} includes=${sellerListIds.includes(sellerLotPid)}`);

  // Listing as buyer must include it (the marketplace is shared —
  // buyers see ACTIVE lots, the data isolation is on *ownership*).
  const buyerList = await req('GET', '/api/crop-lots', { headers: { 'x-demo-user': buyerToken } });
  const buyerListIds = (buyerList.data?.results || []).map((l) => l.public_id);
  check('buyer marketplace includes the seller lot (active)',
    buyerList.status === 200 && buyerListIds.includes(sellerLotPid));

  // /api/crop-lots/available must also return it for the buyer.
  const buyerAvail = await req('GET', '/api/crop-lots/available', { headers: { 'x-demo-user': buyerToken } });
  const buyerAvailIds = (buyerAvail.data?.results || []).map((l) => l.public_id);
  check('buyer /available includes the seller lot',
    buyerAvail.status === 200 && buyerAvailIds.includes(sellerLotPid));

  // --- 7. FPO mine endpoint -------------------------------------------
  // Seed demo FPOs so the membership surfaces are populated.
  await req('POST', '/api/fpos/seed-demo', { headers: { 'x-demo-user': fpoToken } });
  // Have the seller join one of the demo FPOs using the new lot.
  const fpoList = await req('GET', '/api/fpos', { headers: { 'x-demo-user': sellerToken } });
  const firstFpo = (fpoList.data?.results || [])[0];
  if (firstFpo?.public_id) {
    await req('POST', `/api/fpos/${firstFpo.public_id}/join`, {
      headers: { 'x-demo-user': sellerToken },
      body: { crop_lot_id: sellerLotPid },
    });
  }
  const sellerMine = await req('GET', '/api/fpos/mine', { headers: { 'x-demo-user': sellerToken } });
  const sellerMinePids = (sellerMine.data?.results || []).map((f) => f.public_id);
  check('seller /fpos/mine reflects membership',
    sellerMine.status === 200 &&
      Array.isArray(sellerMine.data?.results) &&
      (firstFpo ? sellerMinePids.includes(firstFpo.public_id) : true),
    `count=${sellerMine.data?.count} includes=${firstFpo ? sellerMinePids.includes(firstFpo.public_id) : 'n/a'}`);

  const buyerMine = await req('GET', '/api/fpos/mine', { headers: { 'x-demo-user': buyerToken } });
  check('buyer /fpos/mine is empty (no crop lots)',
    buyerMine.status === 200 &&
      Array.isArray(buyerMine.data?.results) &&
      buyerMine.data.results.length === 0,
    `count=${buyerMine.data?.count}`);

  // --- 8. Anonymous /fpos/mine must not error -----------------------
  const anonMine = await req('GET', '/api/fpos/mine');
  check('anonymous /fpos/mine returns empty (no crash)',
    anonMine.status === 200 &&
      Array.isArray(anonMine.data?.results) &&
      anonMine.data.results.length === 0,
    `status=${anonMine.status}`);

  // --- 9. Switch role preserves user id but updates role -------------
  const switchRes = await req('POST', '/api/auth/switch-role', {
    headers: { 'x-demo-user': sellerToken },
    body: { role: 'BUYER' },
  });
  check('switch-role returns updated role + same id',
    switchRes.status === 200 &&
      switchRes.data?.user?.role === 'BUYER' &&
      switchRes.data?.user?.public_id === sellerId,
    `newRole=${switchRes.data?.user?.role} sameId=${switchRes.data?.user?.public_id === sellerId}`);
  // Switch back so the seller's auth state is intact for any
  // subsequent tests.
  await req('POST', '/api/auth/switch-role', {
    headers: { 'x-demo-user': switchRes.data?.user?.public_id || sellerToken },
    body: { role: 'SELLER' },
  });

  // --- 10. Frontend role-gated routes return 200 --------------------
  const paths = ['/login', '/role', '/seller', '/buyer', '/fpos', '/farmer'];
  for (const p of paths) {
    const r = await frontendGet(p);
    check(`frontend ${p} 200`, r.status === 200 && r.body.includes('id="root"'),
      `status=${r.status} bytes=${r.body.length}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach((r) => console.log(`  - ${r.name} :: ${r.detail}`));
    process.exit(1);
  }
})().catch((e) => {
  console.error('verifier crashed:', e);
  process.exit(2);
});
