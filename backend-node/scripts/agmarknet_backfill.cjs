#!/usr/bin/env node
/**
 * scripts/agmarknet_backfill.cjs — Phase 5 historical backfill.
 *
 * Pulls one month of (state, commodity) data from the public AGMARKNET
 * 2.0 endpoint and upserts into the MarketPrice collection. Resumable:
 * if a (state, commodity, year, month) tuple already has at least one
 * record, we skip it (idempotent backfill).
 *
 * Usage examples:
 *
 *   # Dry-run estimate for one crop across major states, 2025:
 *   node scripts/agmarknet_backfill.cjs \
 *       --commodities "Onion,Potato" --states "Maharashtra,Karnataka" \
 *       --from 2025-01 --to 2025-12 --dry-run
 *
 *   # Real backfill, writing to Mongo:
 *   node scripts/agmarknet_backfill.cjs \
 *       --commodities "Onion" --states "Maharashtra" \
 *       --from 2023-01 --to 2026-08
 *
 *   # Resume an interrupted run:
 *   node scripts/agmarknet_backfill.cjs \
 *       --commodities "Tomato" --states "Karnataka" \
 *       --from 2024-01 --to 2026-08 --only-missing
 *
 * Flags:
 *   --commodities <csv>     crop names to ingest
 *   --states <csv>          state names to ingest
 *   --from <yyyy-mm>        first month (inclusive)
 *   --to <yyyy-mm>          last month (inclusive)
 *   --only-missing          skip months that already have rows
 *   --dry-run               count expected rows; do not write
 *   --throttle <ms>         override THROTTLE_MS (default 500)
 *   --limit <n>             stop after N successful months (debug)
 *   --report <path>         write JSON report to <path>
 *   --diagnose              print the first raw upstream record's
 *                           keys + the post-fetchDateWise mapping for
 *                           each (state, commodity, month) tuple, then
 *                           exit (no DB writes).
 *
 * No env, no API key, no bypass of any access control.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Load .env BEFORE requiring anything that reads process.env. Without
// this line, `process.env.MONGODB_URI` is always empty when the script
// runs and `connectMongo` falls through to the in-memory fallback.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { connectMongo, disconnectMongo } = require('../src/db/connect');
const MarketPrice = require('../src/models/MarketPrice');
const provider = require('../src/services/agmarknet/provider');
const { normalizeAndUpsert } = require('../src/services/agmarknet/orchestrator');

// ----- argv parsing -----
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function asList(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseYearMonth(s) {
  if (!/^\d{4}-\d{2}$/.test(s)) {
    throw new Error(`bad --from/--to value: ${s}; expected YYYY-MM`);
  }
  const [y, m] = s.split('-').map((x) => Number(x));
  return { year: y, month: m };
}

function ymStr(y, m) {
  return `${y}-${String(m).padStart(2, '0')}`;
}

function expandYearMonths(from, to) {
  const months = [];
  let y = from.year;
  let m = from.month;
  // inclusive both ends
  // eslint-disable-next-line no-constant-condition
  while (true) {
    months.push({ year: y, month: m });
    if (y === to.year && m === to.month) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

async function hasAnyRowsForMonth(stateName, commodityName, year, month) {
  // AGMARKNET arrivalDate is stored as YYYY-MM-DD. The 1st of the
  // month is a safe lower bound; the last day of the month is a safe
  // upper bound. We deliberately use a *narrow* window to avoid
  // accidentally matching adjacent months.
  const start = `${ymStr(year, month)}-01`;
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  // Day 0 of (nextY, nextM) is the last day of the requested month.
  const lastDay = new Date(nextY, nextM - 1, 0).getDate();
  const end = `${ymStr(year, month)}-${String(lastDay).padStart(2, '0')}`;
  const n = await MarketPrice.countDocuments({
    source: 'agmarknet',
    cropName: commodityName,
    state: stateName,
    priceDate: { $gte: start, $lte: end },
  });
  return n > 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const commodities = asList(args.commodities);
  const states = asList(args.states);
  if (commodities.length === 0 || states.length === 0) {
    console.error(
      '[backfill] both --commodities and --states are required (CSV of names).'
    );
    process.exit(2);
  }
  const from = parseYearMonth(args.from || '2023-01');
  const to = parseYearMonth(args.to || ymStr(new Date().getFullYear(), new Date().getMonth() + 1));
  const onlyMissing = !!args['only-missing'];
  const dryRun = !!args['dry-run'];
  const limit = args.limit ? Number(args.limit) : 0;
  const reportPath = args.report || '';
  const diagnose = !!args.diagnose;

  if (args.throttle) {
    process.env.AGMARKNET_THROTTLE_MS = String(Number(args.throttle) || 500);
  }

  const months = expandYearMonths(from, to);
  const totalJobs = commodities.length * states.length * months.length;
  console.log(
    `[backfill] starting: ${commodities.length} commodities × ${states.length} states × ${months.length} months = ${totalJobs} (state,commodity,month) tuples`
  );
  console.log(`[backfill] commodities: ${commodities.join(', ')}`);
  console.log(`[backfill] states:      ${states.join(', ')}`);
  console.log(`[backfill] window:      ${ymStr(from.year, from.month)} → ${ymStr(to.year, to.month)}`);
  console.log(`[backfill] mode:        ${dryRun ? 'DRY-RUN (no writes)' : diagnose ? 'DIAGNOSE (print raw records, no writes)' : onlyMissing ? 'RESUME (only-missing)' : 'FULL'}`);
  if (limit) console.log(`[backfill] limit:       stop after ${limit} successful months`);

  // Connect DB unless dry-run or diagnose (both are read/offline).
  let conn = null;
  if (!dryRun && !diagnose) {
    conn = await connectMongo({ uri: process.env.MONGODB_URI || '' });
    console.log(`[backfill] MongoDB mode=${conn.mode}`);
    const ix = await MarketPrice.syncIndexesSafe();
    if (!ix.ok) console.warn(`[backfill] index sync warning: ${ix.error}`);
  }

  // Resolve all names up front. Cached after the first call.
  console.log(`[backfill] loading AGMARKNET filter catalogue…`);
  const filtersRes = await provider.getFilters();
  if (!filtersRes.ok) {
    console.error(`[backfill] cannot load filters: ${filtersRes.error}`);
    if (conn) await disconnectMongo();
    process.exit(3);
  }
  console.log(`[backfill] filters loaded (source=${filtersRes.source})`);

  const stateMap = new Map(); // name → {id, name}
  const commodityMap = new Map();
  for (const s of states) {
    const r = provider._internal.resolveNameId(filtersRes.data, 'state_data', s);
    if (!r) console.warn(`[backfill] WARNING: state not found in catalogue: ${s}`);
    else stateMap.set(s, r);
  }
  for (const c of commodities) {
    const r = provider._internal.resolveNameId(filtersRes.data, 'commodity_data', c);
    if (!r) console.warn(`[backfill] WARNING: commodity not found in catalogue: ${c}`);
    else commodityMap.set(c, r);
  }

  if (stateMap.size === 0 || commodityMap.size === 0) {
    console.error(`[backfill] no resolvable state/commodity pairs; aborting.`);
    if (conn) await disconnectMongo();
    process.exit(3);
  }

  // Walk the cartesian product.
  const perJob = [];
  let jobsDone = 0;
  let jobsOk = 0;
  let jobsSkipped = 0;
  let jobsFailed = 0;
  const t0 = Date.now();
  let throttleMs = Number(process.env.AGMARKNET_THROTTLE_MS || 500);

  // Outer loop: states, then commodities, then months. Iterate so
  // that the throttle is naturally distributed.
  for (const sName of states) {
    const sMatch = stateMap.get(sName);
    if (!sMatch) continue;
    for (const cName of commodities) {
      const cMatch = commodityMap.get(cName);
      if (!cMatch) continue;
      for (const { year, month } of months) {
        const jobKey = `${sName}|${cName}|${ymStr(year, month)}`;
        jobsDone += 1;
        if (limit && jobsOk >= limit) {
          console.log(`[backfill] hit --limit (${limit}); stopping.`);
          break;
        }
        const tJob = Date.now();
        let entry = {
          state: sName,
          stateId: sMatch.id,
          commodity: cName,
          commodityId: cMatch.id,
          year,
          month,
          status: 'pending',
          records: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          flagged: 0,
          durationMs: 0,
          error: null,
        };
        try {
          if (onlyMissing && !dryRun) {
            const has = await hasAnyRowsForMonth(sName, cName, year, month);
            if (has) {
              entry.status = 'skipped_existing';
              perJob.push(entry);
              jobsSkipped += 1;
              console.log(`[${jobsDone}/${totalJobs}] ${jobKey}  skip (already has rows)`);
              continue;
            }
          }
          // Fetch.
          const r = await provider.fetchDateWise({
            year,
            month,
            stateId: sMatch.id,
            commodityId: cMatch.id,
            includeExcel: false,
          });
          if (!r.ok) {
            entry.status = 'fetch_failed';
            entry.error = r.error || `status ${r.status}`;
            perJob.push(entry);
            jobsFailed += 1;
            console.log(
              `[${jobsDone}/${totalJobs}] ${jobKey}  FETCH FAIL  ${entry.error}`
            );
            // Back off a little on persistent failure so we don't
            // pound the upstream. Provider already retried twice.
            await new Promise((r2) => setTimeout(r2, throttleMs * 2));
            continue;
          }
          entry.records = r.records.length;
          if (diagnose) {
            // Print the raw upstream record + the post-fetchDateWise
            // mapping so we can SEE the actual field naming on the
            // first run, then exit. This is the canonical way to find
            // out why a price field is mapping to null. Now also
            // prints EVERY distinct data[] observation (one per
            // variety) when the upstream wraps prices in
            // {arrivalDate, total_arrivals, data: [...]}.
            const r0 = r.records[0];
            const sample = r.records.find(
              (x) => x && x.modalPricePerQuintal != null
            ) || r0;
            console.log(`[${jobKey}] DIAGNOSE  records=${r.records.length}`);
            // Print the FIRST 3 outer raw records (each may have
            // multiple data[] entries → multiple observations).
            const outerFirst3 = [];
            const seen = new Set();
            for (const rec of r.records) {
              const k = rec.rawOuter || rec.raw;
              if (!k) continue;
              const id = r.records.indexOf(rec);
              if (seen.has(id)) continue;
              seen.add(id);
              outerFirst3.push(rec);
              if (outerFirst3.length >= 3) break;
            }
            for (let i = 0; i < outerFirst3.length; i += 1) {
              const ex = outerFirst3[i];
              const outer = ex.rawOuter || ex.raw;
              console.log(`\n  --- outer raw[${i}] (arrivalDate=${ex.arrivalDate}) ---`);
              console.log('  raw outer keys:',
                outer ? Object.keys(outer).join(',') : '<no raw>');
              console.log('  raw outer JSON:',
                JSON.stringify(outer, null, 2));
              // Show EVERY observation produced from this outer
              // (i.e. every entry in data[] flattened into one obs).
              const siblings = r.records.filter(
                (x) => (x.rawOuter || x.raw) === outer
              );
              console.log(`  observations produced from this outer: ${siblings.length}`);
              for (let j = 0; j < siblings.length; j += 1) {
                const s = siblings[j];
                console.log(`    obs[${j}]:`,
                  JSON.stringify(
                    { variety: s.variety, grade: s.grade,
                      arrivalDate: s.arrivalDate, arrivals: s.arrivals,
                      totalArrivals: s.totalArrivals,
                      minPricePerQuintal: s.minPricePerQuintal,
                      modalPricePerQuintal: s.modalPricePerQuintal,
                      maxPricePerQuintal: s.maxPricePerQuintal,
                      priceUnit: s.priceUnit,
                      marketName: s.marketName,
                      marketState: s.marketState,
                      marketDistrict: s.marketDistrict },
                    null, 2
                  ));
              }
            }
            // Also show a high-level summary: distinct varieties, count
            // of obs with non-null modal, count of obs with all-null
            // prices, etc.
            const distinctVarieties = new Set(
              r.records.map((x) => x.variety || '<empty>')
            );
            const withModal = r.records.filter(
              (x) => x.modalPricePerQuintal != null
            ).length;
            const allNull = r.records.filter(
              (x) => x.modalPricePerQuintal == null &&
                     x.minPricePerQuintal == null &&
                     x.maxPricePerQuintal == null
            ).length;
            console.log(`\n  summary across all ${r.records.length} records:`);
            console.log(`    distinct varieties:    ${distinctVarieties.size} (${Array.from(distinctVarieties).join(', ')})`);
            console.log(`    with non-null modal:   ${withModal}`);
            console.log(`    with all-null prices:  ${allNull}`);
            perJob.push(entry);
            jobsOk += 1;
            continue;
          }
          if (dryRun) {
            entry.status = 'dry_run';
            perJob.push(entry);
            jobsOk += 1;
            console.log(
              `[${jobsDone}/${totalJobs}] ${jobKey}  dry-run    ${r.records.length} records`
            );
            continue;
          }
          // Persist.
          const u = await normalizeAndUpsert({
            stateName: sName,
            commodityName: cName,
            records: r.records,
          });
          entry.inserted = u.inserted;
          entry.updated = u.updated;
          entry.skipped = u.skipped;
          entry.flagged = u.flagged.length;
          entry.softFlagCount = u.softFlagCount || {};
          entry.hardFlagReasons = u.hardFlagReasons || {};
          entry.status = 'ok';
          perJob.push(entry);
          jobsOk += 1;
          console.log(
            `[${jobsDone}/${totalJobs}] ${jobKey}  OK         recs=${entry.records} ins=${entry.inserted} upd=${entry.updated} skip=${entry.skipped} flag=${entry.flagged}` +
            (Object.keys(entry.softFlagCount).length
              ? `  soft=${JSON.stringify(entry.softFlagCount)}`
              : '') +
            (Object.keys(entry.hardFlagReasons).length
              ? `  hard=${JSON.stringify(entry.hardFlagReasons)}`
              : '')
          );
        } catch (err) {
          entry.status = 'exception';
          entry.error = err.message;
          perJob.push(entry);
          jobsFailed += 1;
          console.log(`[${jobsDone}/${totalJobs}] ${jobKey}  EXC        ${err.message}`);
        } finally {
          entry.durationMs = Date.now() - tJob;
        }
      }
      if (limit && jobsOk >= limit) break;
    }
    if (limit && jobsOk >= limit) break;
  }

  const totalDurationMs = Date.now() - t0;
  // Aggregate the per-reason flagging breakdowns across all jobs.
  const softFlagTotals = {};
  const hardFlagTotals = {};
  for (const j of perJob) {
    for (const [reason, n] of Object.entries(j.softFlagCount || {})) {
      softFlagTotals[reason] = (softFlagTotals[reason] || 0) + n;
    }
    for (const [reason, n] of Object.entries(j.hardFlagReasons || {})) {
      hardFlagTotals[reason] = (hardFlagTotals[reason] || 0) + n;
    }
  }
  const totals = {
    total_jobs: totalJobs,
    jobs_done: jobsDone,
    ok: jobsOk,
    skipped: jobsSkipped,
    failed: jobsFailed,
    total_records: perJob.reduce((a, j) => a + j.records, 0),
    total_inserted: perJob.reduce((a, j) => a + j.inserted, 0),
    total_updated: perJob.reduce((a, j) => a + j.updated, 0),
    total_flagged: perJob.reduce((a, j) => a + j.flagged, 0),
    soft_flag_total: softFlagTotals,
    hard_flag_total: hardFlagTotals,
    mongodb_mode: conn ? conn.mode : 'dry-run',
    mongodb_uri_host: conn && conn.uri ? (() => { try { return new URL(conn.uri).host; } catch { return 'n/a'; } })() : 'n/a',
    durationMs: totalDurationMs,
    dryRun,
    onlyMissing,
    diagnose,
    window: `${ymStr(from.year, from.month)} → ${ymStr(to.year, to.month)}`,
    commodities,
    states,
  };

  console.log('');
  console.log('[backfill] === summary ===');
  console.log(`[backfill] jobs:   ${jobsOk} ok, ${jobsSkipped} skipped, ${jobsFailed} failed, ${jobsDone}/${totalJobs} total`);
  console.log(`[backfill] rows:   ${totals.total_records} fetched, ${totals.total_inserted} inserted, ${totals.total_updated} updated, ${totals.total_flagged} flagged`);
  console.log(`[backfill] soft:   ${JSON.stringify(softFlagTotals)}`);
  console.log(`[backfill] hard:   ${JSON.stringify(hardFlagTotals)}`);
  console.log(`[backfill] mongo:  mode=${totals.mongodb_mode} host=${totals.mongodb_uri_host}`);
  console.log(`[backfill] time:   ${(totalDurationMs / 1000).toFixed(1)}s`);

  if (reportPath) {
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({ totals, perJob }, null, 2), 'utf8');
      console.log(`[backfill] report: ${reportPath}`);
    } catch (err) {
      console.warn(`[backfill] failed to write report: ${err.message}`);
    }
  }

  if (conn) await disconnectMongo();
  process.exit(jobsFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(99);
});
