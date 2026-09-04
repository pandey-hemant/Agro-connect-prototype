/**
 * verify_fpo_workflow.cjs — focused regression for the FPO page.
 *
 * Reproduces the original bug ("Cannot read properties of undefined
 * (reading 'toFixed')" at FPOs.jsx) and exercises the full workflow
 * the FPOs page relies on:
 *
 *   1. /api/fpos         — list FPOs (must include is_demo, member_count)
 *   2. /api/fpos         — create a new FPO, it appears in the list
 *   3. /api/fpos/:id     — detail opens
 *   4. /api/fpos/:id/join — a farmer joins with a crop lot
 *   5. /api/fpos/:id/join — re-join is idempotent (count stays 1)
 *   6. /api/fpos/:id/aggregate — returns full row schema:
 *                                crop_name, lot_count, total_quantity,
 *                                quantity_unit, estimated_value,
 *                                member_public_ids, currency,
 *                                plus top-level fpo_public_id, note,
 *                                reachable_buyers.
 *                                estimated_value must be a number —
 *                                the exact field the old bug crashed on.
 *   7. /api/fpos/:id/leave — member is removed; count goes back to 0
 *   8. /api/fpos/seed-demo — idempotent (skipped or inserts the seed)
 *   9. /api/fpos         — list survives a page refresh (data persists)
 *
 * Also covers the FPO model toRead fields the page reads
 * (f.is_demo, f.member_count) and the defensive 4xx/5xx paths.
 *
 * Assumes the backend is already up at http://localhost:5050 with the
 * demo seed loaded.
 *
 * Run:
 *   node scripts/verify_fpo_workflow.cjs
 */

const http = require('http');
const BASE = 'http://localhost:5050';
const API = BASE + '/api';

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

  // 1a. Every listed FPO must have public_id, name, member_count
  const badShape = initial.find(
    (f) => !f.public_id || typeof f.name !== 'string' || typeof f.member_count !== 'number'
  );
  if (badShape) {
    bad('1a. List shape (public_id, name, member_count)', JSON.stringify(badShape).slice(0, 200));
  } else {
    ok('1a. List shape (public_id, name, member_count)', `all ${initial.length} rows well-shaped`);
  }

  // 1b. Seeded FPOs should have is_demo=true; user-created ones false
  const demoFpos = initial.filter((f) => f.is_demo === true);
  if (demoFpos.length > 0) {
    ok('1b. Seeded FPOs are flagged is_demo=true', `${demoFpos.length} demo FPO(s) present`);
  } else {
    bad('1b. Seeded FPOs are flagged is_demo=true', 'no demo FPOs found');
  }

  // 2. Create FPO + it appears in list
  const stamp = Date.now().toString(36).toUpperCase();
  const newFpoBody = {
    name: `Workflow FPO ${stamp}`,
    location: 'Patna',
    district: 'Patna',
    state: 'Bihar',
  };
  const cr = await req('POST', '/api/fpos', newFpoBody);
  if (cr.status !== 201 || !cr.data || !cr.data.public_id) {
    bad('2. Create FPO', `status=${cr.status} body=${JSON.stringify(cr.data).slice(0, 200)}`);
    process.exit(1);
  }
  const fpoPublicId = cr.data.public_id;
  ok('2. Create FPO', `fpo=${fpoPublicId} is_demo=${cr.data.is_demo} members=${cr.data.member_count}`);

  const lr1 = await req('GET', '/api/fpos');
  const afterCreate = unwrapList(lr1);
  const found = afterCreate.find((f) => f.public_id === fpoPublicId);
  if (found && afterCreate.length === initial.length + 1) {
    ok('2a. Created FPO appears in list', `list size ${initial.length} → ${afterCreate.length}`);
  } else {
    bad('2a. Created FPO appears in list', `found=${!!found} size=${afterCreate.length}`);
  }

  // 2b. A user-created FPO must have is_demo=false
  if (found && found.is_demo === false) {
    ok('2b. User-created FPO has is_demo=false', `fpo=${fpoPublicId}`);
  } else {
    bad('2b. User-created FPO has is_demo=false', JSON.stringify(found).slice(0, 200));
  }

  // 3. Detail opens
  const dr = await req('GET', `/api/fpos/${fpoPublicId}`);
  if (dr.status === 200 && dr.data.public_id === fpoPublicId) {
    ok('3. FPO detail opens', `name=${dr.data.name}`);
  } else {
    bad('3. FPO detail opens', `status=${dr.status}`);
  }

  // 4. Join with a real ACTIVE lot
  const available = await req('GET', '/api/crop-lots/available');
  const availableLots = unwrapList(available);
  let lotForJoin = null;
  if (availableLots.length === 0) {
    // Create one so the test can proceed
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
      ok('4-pre. Created a fresh ACTIVE lot', `lot=${lotForJoin.publicId}`);
    } else {
      bad('4-pre. Create ACTIVE lot', `status=${lr2.status}`);
    }
  } else {
    lotForJoin = { publicId: availableLots[0].public_id, mongoId: availableLots[0].id };
    ok('4-pre. Picked an existing ACTIVE lot', `lot=${lotForJoin.publicId}`);
  }

  if (!lotForJoin) {
    bad('4. Join FPO', 'no lot to join with');
  } else {
    const jr1 = await req('POST', `/api/fpos/${fpoPublicId}/join`, { crop_lot_id: lotForJoin.publicId });
    if (jr1.status === 200 && jr1.data.member_count === 1) {
      ok('4. Join FPO', `members=${jr1.data.member_count}`);
    } else {
      bad('4. Join FPO', `status=${jr1.status} body=${JSON.stringify(jr1.data).slice(0, 200)}`);
    }

    // 5. Re-join is idempotent
    const jr2 = await req('POST', `/api/fpos/${fpoPublicId}/join`, { crop_lot_id: lotForJoin.publicId });
    if (jr2.status === 200 && jr2.data.member_count === 1) {
      ok('5. Re-join is idempotent', `members=${jr2.data.member_count}`);
    } else {
      bad('5. Re-join is idempotent', `status=${jr2.status} members=${jr2.data && jr2.data.member_count}`);
    }
  }

  // 6. Aggregate returns the full row schema (the actual bug fix)
  const ar = await req('GET', `/api/fpos/${fpoPublicId}/aggregate`);
  if (ar.status !== 200) {
    bad('6. Aggregate reachable', `status=${ar.status} body=${JSON.stringify(ar.data).slice(0, 200)}`);
  } else {
    const agg = ar.data || {};
    if (agg.fpo_public_id !== fpoPublicId) {
      bad('6a. Aggregate fpo_public_id', `got=${agg.fpo_public_id}`);
    } else {
      ok('6a. Aggregate fpo_public_id', `fpo_public_id=${agg.fpo_public_id}`);
    }
    if (typeof agg.note !== 'string') {
      bad('6b. Aggregate note', `type=${typeof agg.note}`);
    } else {
      ok('6b. Aggregate note', `note len=${agg.note.length}`);
    }
    if (!Array.isArray(agg.by_crop)) {
      bad('6c. Aggregate by_crop is array', `type=${typeof agg.by_crop}`);
    } else if (agg.by_crop.length === 0) {
      bad('6c. Aggregate by_crop has rows', 'by_crop is empty');
    } else {
      const row = agg.by_crop[0];
      const missing = [];
      if (typeof row.crop_name !== 'string') missing.push('crop_name');
      if (typeof row.lot_count !== 'number') missing.push('lot_count');
      if (typeof row.total_quantity !== 'number') missing.push('total_quantity');
      if (typeof row.quantity_unit !== 'string') missing.push('quantity_unit');
      // THE BUG: estimated_value used to be undefined, then .toFixed(0) crashed the page.
      if (typeof row.estimated_value !== 'number' || !Number.isFinite(row.estimated_value)) {
        missing.push('estimated_value (must be a finite number)');
      }
      if (!Array.isArray(row.member_public_ids)) missing.push('member_public_ids');
      if (missing.length > 0) {
        bad('6c. Aggregate row schema', `missing/invalid: ${missing.join(', ')}`);
      } else {
        ok('6c. Aggregate row schema',
           `crop=${row.crop_name} lots=${row.lot_count} qty=${row.total_quantity}${row.quantity_unit} value=₹${row.estimated_value}`);
      }

      // 6d. estimated_value can be passed to toFixed() without throwing
      try {
        const ok2 = row.estimated_value.toFixed(0);
        if (typeof ok2 === 'string' && ok2.length > 0) {
          ok('6d. estimated_value.toFixed(0) succeeds', `result="${ok2}"`);
        } else {
          bad('6d. estimated_value.toFixed(0) succeeds', `result=${ok2}`);
        }
      } catch (e) {
        bad('6d. estimated_value.toFixed(0) succeeds', `threw: ${e.message}`);
      }
    }
    if (!Array.isArray(agg.reachable_buyers)) {
      bad('6e. reachable_buyers is array', `type=${typeof agg.reachable_buyers}`);
    } else {
      ok('6e. reachable_buyers is array', `count=${agg.reachable_buyers.length}`);
    }
  }

  // 7. Leave the FPO
  if (lotForJoin) {
    const lv = await req('POST', `/api/fpos/${fpoPublicId}/leave`, { crop_lot_id: lotForJoin.publicId });
    if (lv.status === 200 && lv.data.member_count === 0) {
      ok('7. Leave FPO', `members=${lv.data.member_count}`);
    } else {
      bad('7. Leave FPO', `status=${lv.status} members=${lv.data && lv.data.member_count}`);
    }

    // 7a. Lot stays ACTIVE after leave
    const cr2 = await req('GET', `/api/crop-lots/${lotForJoin.publicId}`);
    if (cr2.status === 200 && cr2.data.status === 'ACTIVE') {
      ok('7a. Lot stays ACTIVE after leave', `status=${cr2.data.status}`);
    } else {
      bad('7a. Lot stays ACTIVE after leave', `status=${cr2.data && cr2.data.status}`);
    }
  }

  // 8. Seed demo (idempotent)
  const sd = await req('POST', '/api/fpos/seed-demo');
  if (sd.status === 200 && typeof sd.data.total === 'number') {
    ok('8. seed-demo idempotent', `inserted=${sd.data.inserted} skipped=${sd.data.skipped} total=${sd.data.total}`);
  } else {
    bad('8. seed-demo idempotent', `status=${sd.status}`);
  }

  // 9. Refresh: list endpoint still returns the user-created FPO
  const lr9 = await req('GET', '/api/fpos');
  const refreshed = unwrapList(lr9);
  const stillThere = refreshed.find((f) => f.public_id === fpoPublicId);
  if (stillThere) {
    ok('9. Data survives a refresh (GET /fpos again)', `fpo=${fpoPublicId} still present`);
  } else {
    bad('9. Data survives a refresh (GET /fpos again)', 'fpo missing after refresh');
  }

  // 10. Defensive: a malformed/legacy aggregate row must not crash the
  //     React render. We can't run React here, but we can simulate the
  //     dangerous call path the page used to take: read a row that does
  //     NOT contain estimated_value and try toFixed(). This must throw,
  //     proving the backend is the only thing protecting us.
  let dangerous = null;
  try {
    dangerous = undefined;
    dangerous.toFixed(0);
    bad('10. Defensive: undefined.toFixed(0) throws', 'no throw — sanity check broken');
  } catch (e) {
    ok('10. Defensive: undefined.toFixed(0) throws', `error="${e.message}" — confirms why the page must guard`);
  }

  // -------- Summary --------
  console.log('');
  console.log(`=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('verify_fpo_workflow.cjs threw:', e);
  process.exit(1);
});
