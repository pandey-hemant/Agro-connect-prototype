#!/usr/bin/env node
/**
 * scripts/audit_chilli_coverage.cjs
 *
 * Read-only coverage audit of AGMARKNET Chilli data across the
 * approved 10 states. NEVER persists to MongoDB. NEVER writes to
 * production code. NEVER prints the API key. Uses the on-disk
 * filters cache (no fresh /filters fetch).
 *
 * What this does:
 *   1. Reads backend-node/src/data/agmarknet_filters.json (the
 *      on-disk AGMARKNET catalogue cached by provider.js).
 *   2. Resolves the 6 Chilli commodities and the 10 state IDs.
 *   3. Probes every (Chilli-candidate, state, year, month) slice in
 *      the 2-year historical window (2024-01 → 2025-12) for the
 *      2 high-density states (Maharashtra, Uttar Pradesh), and only
 *      the December slice of each year for the other 8 states. This
 *      minimizes API calls.
 *   4. Writes the result to chilli_coverage_report.json.
 *
 * Run:
 *   node scripts/audit_chilli_coverage.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE = 'https://api.agmarknet.gov.in/v1';
const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://agmarknet.gov.in',
  Referer: 'https://agmarknet.gov.in/',
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
};
const THROTTLE_MS = 500;

const APPROVED_STATES = [
  'Uttar Pradesh',
  'Punjab',
  'West Bengal',
  'Haryana',
  'Maharashtra',
  'Odisha',
  'Madhya Pradesh',
  'Gujarat',
  'Bihar',
  'Karnataka',
];

// All Chilli variants present in the on-disk catalogue.
const CHILLI_CANDIDATES = [
  { id: '73',  name: 'Green Chilli' },
  { id: '26',  name: 'Chili Red' },
  { id: '113', name: 'Dry Chillies' },
  { id: '420', name: 'Bajji chilli' },
  { id: '480', name: 'Ghost Pepper(King Chilli)' },
  { id: '520', name: 'Round Chilli' },
];

const DEEP_STATES = ['Maharashtra', 'Uttar Pradesh']; // probe every month
const DEEP_YEARS = [2024, 2025];
const DEEP_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const SHALLOW_STATES = APPROVED_STATES.filter((s) => !DEEP_STATES.includes(s));
const SHALLOW_YEARS = [2024, 2025];
const SHALLOW_MONTHS = [12]; // December only — just to detect existence

let lastCallAt = 0;
async function throttle() {
  const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastCallAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function getJson(url) {
  await throttle();
  try {
    const r = await axios.get(url, {
      headers: HEADERS,
      timeout: 30000,
      validateStatus: (s) => s >= 200 && s < 300,
      responseType: 'json',
    });
    return { ok: true, status: r.status, data: r.data };
  } catch (err) {
    return {
      ok: false,
      status: err.response ? err.response.status : 0,
      error: err.message,
    };
  }
}

function loadFilters() {
  const fp = path.join(__dirname, '..', 'src', 'data', 'agmarknet_filters.json');
  const raw = fs.readFileSync(fp, 'utf8');
  return JSON.parse(raw);
}

function resolveStatesFromCache(catalogue) {
  // The cache has both `state_data` and `cmdt_data` (raw AGMARKNET
  // shape). Accept either.
  const list = catalogue.state_data || [];
  const out = {};
  for (const s of list) {
    const id = String(s.state_id || s.id);
    const name = String(s.state_name || s.name);
    if (APPROVED_STATES.includes(name)) out[name] = id;
  }
  return out;
}

function buildUrl(stateId, cmdtId, year, month) {
  const u = new URL(`${BASE}/prices-and-arrivals/date-wise/specific-commodity`);
  u.searchParams.set('year', String(year));
  u.searchParams.set('month', String(month));
  u.searchParams.set('stateId', stateId);
  u.searchParams.set('commodityId', cmdtId);
  u.searchParams.set('includeExcel', 'false');
  return u.toString();
}

function countRecords(data) {
  if (!data) return { records: 0, markets: 0, ok: false };
  const d = data.data || data;
  if (!d || !Array.isArray(d.markets)) return { records: 0, markets: 0, ok: true };
  let records = 0;
  const markets = new Set();
  for (const m of d.markets) {
    if (!m || typeof m !== 'object') continue;
    const name =
      m.marketName || m.market_name || m.name || m.market ||
      (m.marketId ? `market_${m.marketId}` : '');
    if (name) markets.add(String(name).trim());
    const dates = m.dates || m.dateWiseData || m.data || [];
    for (const dEntry of dates) {
      if (!dEntry || typeof dEntry !== 'object') continue;
      const inner =
        Array.isArray(dEntry.data) && dEntry.data.length > 0
          ? dEntry.data
          : [dEntry];
      records += inner.length;
    }
  }
  return { records, markets: markets.size, ok: true };
}

(async () => {
  const t0 = Date.now();
  console.log('[chilli-audit] loading cached AGMARKNET filters…');
  const cache = loadFilters();
  const stateIds = resolveStatesFromCache(cache);
  const missing = APPROVED_STATES.filter((s) => !stateIds[s]);
  if (missing.length) {
    console.error(`[chilli-audit] FATAL: missing in cache: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(
    `[chilli-audit] resolved ${Object.keys(stateIds).length}/${APPROVED_STATES.length} state IDs from cache`
  );
  for (const s of APPROVED_STATES) {
    console.log(`  ${s.padEnd(20)} → state_id=${stateIds[s]}`);
  }

  // Build the probe plan.
  const plan = [];
  for (const c of CHILLI_CANDIDATES) {
    for (const s of DEEP_STATES) {
      for (const y of DEEP_YEARS) {
        for (const m of DEEP_MONTHS) {
          plan.push({ cmdtId: c.id, cmdtName: c.name, state: s, year: y, month: m });
        }
      }
    }
    for (const s of SHALLOW_STATES) {
      for (const y of SHALLOW_YEARS) {
        for (const m of SHALLOW_MONTHS) {
          plan.push({ cmdtId: c.id, cmdtName: c.name, state: s, year: y, month: m });
        }
      }
    }
  }
  console.log(`[chilli-audit] total probes planned: ${plan.length}`);
  const estimatedSeconds = (plan.length * THROTTLE_MS) / 1000;
  console.log(
    `[chilli-audit] estimated wall time at ${THROTTLE_MS}ms throttle: ~${Math.round(estimatedSeconds)}s`
  );

  const results = [];
  for (let i = 0; i < plan.length; i += 1) {
    const p = plan[i];
    const url = buildUrl(stateIds[p.state], p.cmdtId, p.year, p.month);
    const r = await getJson(url);
    let count = { records: 0, markets: 0, ok: false };
    if (r.ok) {
      count = countRecords(r.data);
    }
    results.push({
      ...p,
      httpOk: r.ok,
      httpStatus: r.status,
      httpError: r.ok ? null : r.error,
      records: count.records,
      markets: count.markets,
    });
    if ((i + 1) % 20 === 0 || i === plan.length - 1) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `[chilli-audit] ${i + 1}/${plan.length} probes done (${elapsed}s elapsed)`
      );
    }
  }

  // Summarise per (Chilli variant, state).
  const summary = {};
  for (const r of results) {
    const key = `${r.cmdtName}__${r.state}`;
    if (!summary[key]) {
      summary[key] = {
        cmdtId: r.cmdtId,
        cmdtName: r.cmdtName,
        state: r.state,
        totalRecords: 0,
        totalMonthsProbed: 0,
        monthsWithData: 0,
        maxMarketsInMonth: 0,
        probedMonths: 0,
      };
    }
    const s = summary[key];
    s.probedMonths += 1;
    s.totalMonthsProbed = s.probedMonths;
    if (r.records > 0) {
      s.totalRecords += r.records;
      s.monthsWithData += 1;
      s.maxMarketsInMonth = Math.max(s.maxMarketsInMonth, r.markets);
    }
  }
  const summaryList = Object.values(summary).sort((a, b) => {
    if (b.totalRecords !== a.totalRecords) return b.totalRecords - a.totalRecords;
    return a.cmdtName.localeCompare(b.cmdtName);
  });

  console.log('');
  console.log('========= CHILLI COVERAGE BY VARIANT × STATE =========');
  console.log('cmdtId | Variant                 | State             | recs    | months+data | maxMkts | probed');
  console.log('-------|-------------------------|-------------------|---------|-------------|---------|-------');
  for (const s of summaryList) {
    console.log(
      `${String(s.cmdtId).padStart(6)} | ${s.cmdtName.padEnd(23)} | ${s.state.padEnd(17)} | ${String(s.totalRecords).padStart(7)} | ${String(s.monthsWithData).padStart(11)} | ${String(s.maxMarketsInMonth).padStart(7)} | ${String(s.probedMonths).padStart(6)}`
    );
  }

  // Aggregate per Chilli variant across all 10 states.
  const byVariant = {};
  for (const s of summaryList) {
    if (!byVariant[s.cmdtName]) {
      byVariant[s.cmdtName] = {
        cmdtId: s.cmdtId,
        totalRecords: 0,
        totalMonthsWithData: 0,
        totalProbedMonths: 0,
        statesWithAnyData: new Set(),
      };
    }
    const v = byVariant[s.cmdtName];
    v.totalRecords += s.totalRecords;
    v.totalMonthsWithData += s.monthsWithData;
    v.totalProbedMonths += s.probedMonths;
    if (s.monthsWithData > 0) v.statesWithAnyData.add(s.state);
  }
  console.log('');
  console.log('========= CHILLI COVERAGE BY VARIANT (across all 10 states) =========');
  console.log('cmdtId | Variant                 | totalRecs | months+/probed | states+/10');
  console.log('-------|-------------------------|-----------|----------------|----------');
  for (const [name, v] of Object.entries(byVariant)) {
    console.log(
      `${String(v.cmdtId).padStart(6)} | ${name.padEnd(23)} | ${String(v.totalRecords).padStart(9)} | ${String(v.totalMonthsWithData).padStart(7)}/${String(v.totalProbedMonths).padStart(7)} | ${String(v.statesWithAnyData.size).padStart(2)}/10`
    );
  }

  // Pick the recommended variant: highest totalRecords. If zero
  // records, the audit is conclusive — no Chilli variant has data.
  let recommended = null;
  for (const v of Object.values(byVariant)) {
    if (!recommended || v.totalRecords > recommended.totalRecords) {
      recommended = v;
      recommended.cname = Object.entries(byVariant).find(([, x]) => x === v)[0];
    }
  }

  console.log('');
  console.log('========= RECOMMENDATION =========');
  if (!recommended || recommended.totalRecords === 0) {
    console.log('Chilli has NO data on AGMARKNET for the 10 approved states in 2024-2025.');
    console.log('Recommendation: pick a different 4th crop.');
  } else {
    console.log(
      `Best-covered Chilli variant: ${recommended.cname} (cmdt_id=${recommended.cmdtId}) ` +
      `with ${recommended.totalRecords} total records across ${recommended.statesWithAnyData.size}/10 states ` +
      `(${recommended.totalMonthsWithData} of ${recommended.totalProbedMonths} probed months had data).`
    );
  }

  const out = {
    timestamp: new Date().toISOString(),
    throttleMs: THROTTLE_MS,
    durationMs: Date.now() - t0,
    probeCount: results.length,
    approvedStates: APPROVED_STATES,
    deepStates: DEEP_STATES,
    shallowStates: SHALLOW_STATES,
    candidates: CHILLI_CANDIDATES,
    byVariant: Object.fromEntries(
      Object.entries(byVariant).map(([k, v]) => [
        k,
        {
          cmdtId: v.cmdtId,
          totalRecords: v.totalRecords,
          totalMonthsWithData: v.totalMonthsWithData,
          totalProbedMonths: v.totalProbedMonths,
          statesWithAnyData: Array.from(v.statesWithAnyData),
        },
      ])
    ),
    summary: summaryList,
    raw: results,
  };

  const outPath = path.join(__dirname, 'chilli_coverage_report.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('');
  console.log(`[chilli-audit] full report written to ${outPath}`);
  console.log(`[chilli-audit] total wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch((err) => {
  console.error('[chilli-audit] FATAL:', err);
  process.exit(1);
});
