#!/usr/bin/env node
/**
 * audit_state_coverage.cjs — read-only coverage analysis of AGMARKNET
 * historical data across ALL states for Onion, Tomato, Potato (2021-2025).
 *
 * NEVER prints API keys. Uses public AGMARKNET endpoints with browser-like headers.
 * Only reads; does not modify app, frontend, ML, DB schema, or production routes.
 */
'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE = 'https://api.agmarknet.gov.in/v1';
const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://agmarknet.gov.in',
  Referer: 'https://agmarknet.gov.in/',
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
};
const THROTTLE_MS = 500; // matches provider.js

let lastCallAt = 0;
async function throttle() {
  const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastCallAt));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function getJson(url) {
  await throttle();
  try {
    const r = await axios.get(url, { headers: HEADERS, timeout: 30000, validateStatus: s => s >= 200 && s < 300, responseType: 'json' });
    return { ok: true, status: r.status, data: r.data };
  } catch (err) {
    return { ok: false, status: err.response?.status || 0, error: err.message, data: err.response?.data || null };
  }
}

function normalizeFilters(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload.commodity_data) && !Array.isArray(payload.cmdt_data)) return payload;
  const out = Object.assign({}, payload);
  if (Array.isArray(out.cmdt_data)) {
    out.commodity_data = out.cmdt_data.map(it => ({
      cmdt_id: it.cmdt_id, cmdt_name: it.cmdt_name, cmdt_group_id: it.cmdt_group_id,
      id: it.cmdt_id, name: it.cmdt_name, commodity_id: it.cmdt_id, commodity_name: it.cmdt_name,
    }));
  }
  return out;
}

async function getAllStatesAndCommodities() {
  const r = await getJson(`${BASE}/daily-price-arrival/filters`);
  if (!r.ok) throw new Error(`filters failed: ${r.error} (status ${r.status})`);
  const f = normalizeFilters(r.data && (r.data.data || r.data));
  const states = (f.state_data || []).map(s => ({
    id: String(s.state_id || s.id),
    name: String(s.state_name || s.name),
  })).filter(s => s.id && s.name && !/all|union/i.test(s.name));
  const commodities = (f.commodity_data || []).map(c => ({
    id: String(c.cmdt_id || c.commodity_id || c.id),
    name: String(c.cmdt_name || c.commodity_name || c.name),
  })).filter(c => c.id && c.name);
  return { states, commodities };
}

async function fetchSlice(stateId, commodityId, year, month) {
  const url = `${BASE}/prices-and-arrivals/date-wise/specific-commodity`
    + `?year=${year}&month=${month}`
    + `&stateId=${encodeURIComponent(stateId)}`
    + `&commodityId=${encodeURIComponent(commodityId)}`
    + `&includeExcel=false`;
  const r = await getJson(url);
  if (!r.ok) return { ok: false, status: r.status, error: r.error, records: 0, markets: [] };
  const data = r.data && (r.data.data || r.data);
  let recordCount = 0;
  const markets = new Set();
  if (data && Array.isArray(data.markets)) {
    for (const m of data.markets) {
      const marketName = m.marketName || m.market_name || m.name || m.market || (m.marketId ? `market_${m.marketId}` : '');
      if (marketName) markets.add(marketName);
      const dates = m.dates || m.dateWiseData || m.data || [];
      for (const d of dates) {
        const inner = Array.isArray(d.data) && d.data.length > 0 ? d.data : [d];
        recordCount += inner.length;
      }
    }
  }
  return { ok: true, status: r.status, records: recordCount, markets: Array.from(markets) };
}

async function probeState(state, commodityMap) {
  const cropIds = {
    Onion: commodityMap['Onion'],
    Tomato: commodityMap['Tomato'],
    Potato: commodityMap['Potato'],
  };
  // Some commodities may have slight name variations; try case-insensitive match
  for (const [cname, cid] of Object.entries(cropIds)) {
    if (!cid) {
      const match = Object.entries(commodityMap).find(([n]) => n.toLowerCase() === cname.toLowerCase());
      if (match) cropIds[cname] = match[1];
    }
  }
  const missing = Object.entries(cropIds).filter(([,v]) => !v).map(([k]) => k);
  if (missing.length) {
    return { state: state.name, stateId: state.id, ok: false, error: `Missing commodity IDs: ${missing.join(', ')}` };
  }

  const years = [2021, 2022, 2023, 2024, 2025];
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const results = { Onion: {}, Tomato: {}, Potato: {} };
  const allMarkets = new Set();
  let totalRecords = 0;
  let monthsWithData = 0;
  let yearsWithData = new Set();

  for (const crop of ['Onion', 'Tomato', 'Potato']) {
    const cid = cropIds[crop];
    for (const year of years) {
      for (const month of months) {
        const r = await fetchSlice(state.id, cid, year, month);
        const key = `${year}-${String(month).padStart(2, '0')}`;
        results[crop][key] = { records: r.records, markets: r.markets.length, ok: r.ok };
        if (r.ok && r.records > 0) {
          totalRecords += r.records;
          monthsWithData += 1;
          yearsWithData.add(year);
          for (const m of r.markets) allMarkets.add(m);
        }
      }
    }
  }

  // Compute density score: records * sqrt(markets) * yearSpan / 1000
  const yearSpan = yearsWithData.size;
  const marketCount = allMarkets.size;
  const densityScore = Math.round((totalRecords * Math.sqrt(Math.max(1, marketCount)) * yearSpan) / 1000);

  return {
    state: state.name,
    stateId: state.id,
    ok: true,
    totalRecords,
    marketCount,
    monthsWithData,
    yearsWithData: Array.from(yearsWithData).sort(),
    yearSpan,
    densityScore,
    byCrop: {
      Onion: summarizeCrop(results.Onion),
      Tomato: summarizeCrop(results.Tomato),
      Potato: summarizeCrop(results.Potato),
    },
  };
}

function summarizeCrop(months) {
  let total = 0, monthsWithData = 0, maxMarkets = 0;
  for (const [, v] of Object.entries(months)) {
    if (v.ok && v.records > 0) {
      total += v.records;
      monthsWithData += 1;
      maxMarkets = Math.max(maxMarkets, v.markets);
    }
  }
  return { totalRecords: total, monthsWithData, maxMarkets };
}

function scoreState(s) {
  if (!s.ok) return -1;
  // Weight: records (40%), markets (25%), year span (20%), crop balance (15%)
  const cropScores = Object.values(s.byCrop).map(c => c.totalRecords);
  const cropBalance = cropScores.every(x => x > 0) ? 1 : 0.5; // penalty if any crop missing
  const recordScore = Math.min(s.totalRecords / 5000, 1); // cap at 5k
  const marketScore = Math.min(s.marketCount / 50, 1); // cap at 50 markets
  const yearScore = s.yearSpan / 5; // 5 years max
  return Math.round((recordScore * 0.4 + marketScore * 0.25 + yearScore * 0.2 + cropBalance * 0.15) * 100);
}

function regionOf(state) {
  const north = ['Punjab', 'Haryana', 'Himachal Pradesh', 'Uttarakhand', 'Jammu and Kashmir', 'Ladakh', 'Delhi', 'Chandigarh'];
  const central = ['Madhya Pradesh', 'Chhattisgarh', 'Uttar Pradesh'];
  const west = ['Maharashtra', 'Gujarat', 'Rajasthan', 'Goa', 'Dadra and Nagar Haveli and Daman and Diu'];
  const south = ['Karnataka', 'Andhra Pradesh', 'Telangana', 'Tamil Nadu', 'Kerala', 'Puducherry', 'Lakshadweep'];
  const east = ['Bihar', 'Jharkhand', 'Odisha', 'West Bengal', 'Sikkim'];
  const northeast = ['Assam', 'Arunachal Pradesh', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Tripura'];
  if (north.includes(state)) return 'North';
  if (central.includes(state)) return 'Central';
  if (west.includes(state)) return 'West';
  if (south.includes(state)) return 'South';
  if (east.includes(state)) return 'East';
  if (northeast.includes(state)) return 'Northeast';
  return 'Other';
}

(async () => {
  console.log('Fetching AGMARKNET catalogue...');
  const { states, commodities } = await getAllStatesAndCommodities();
  console.log(`Found ${states.length} states, ${commodities.length} commodities`);

  const commodityMap = Object.fromEntries(commodities.map(c => [c.name, c.id]));

  // Priority states for Onion/Tomato/Potato based on agricultural significance
  const priorityStates = [
    'Maharashtra', 'Madhya Pradesh', 'Karnataka', 'Uttar Pradesh', 'Gujarat',
    'Andhra Pradesh', 'Telangana', 'Tamil Nadu', 'Rajasthan', 'Bihar',
    'Haryana', 'Punjab', 'West Bengal', 'Odisha', 'Chhattisgarh',
    'Kerala', 'Jharkhand', 'Assam', 'Himachal Pradesh', 'Uttarakhand',
  ];

  const stateObjects = states.filter(s => priorityStates.includes(s.name));
  console.log(`Testing ${stateObjects.length} priority states...`);

  const results = [];
  for (let i = 0; i < stateObjects.length; i++) {
    const s = stateObjects[i];
    console.log(`[${i+1}/${stateObjects.length}] Probing ${s.name}...`);
    const r = await probeState(s, commodityMap);
    r.region = regionOf(s.name);
    r.score = scoreState(r);
    results.push(r);
    console.log(`  score=${r.score} records=${r.totalRecords} markets=${r.marketCount} years=${r.yearSpan} crops=${Object.keys(r.byCrop).filter(k => r.byCrop[k].totalRecords > 0).join(',')}`);
  }

  // Sort by score desc
  results.sort((a, b) => b.score - a.score);

  // Output table
  console.log('\n========= STATE COVERAGE TABLE =========');
  console.log('Rank | State                | Region    | Score | TotalRec | Markets | Years | Onion   | Tomato  | Potato');
  console.log('-----|----------------------|-----------|-------|----------|---------|-------|---------|---------|--------');
  results.forEach((r, i) => {
    const o = r.byCrop.Onion.totalRecords.toLocaleString().padStart(7);
    const t = r.byCrop.Tomato.totalRecords.toLocaleString().padStart(7);
    const p = r.byCrop.Potato.totalRecords.toLocaleString().padStart(7);
    console.log(`${String(i+1).padStart(4)} | ${r.state.padEnd(20)} | ${r.region.padEnd(9)} | ${String(r.score).padStart(5)} | ${String(r.totalRecords).padStart(8)} | ${String(r.marketCount).padStart(7)} | ${String(r.yearSpan).padStart(5)} | ${o} | ${t} | ${p}`);
  });

  // Top 15-20 with geographic balance
  const selected = [];
  const regionCounts = {};
  for (const r of results) {
    if (!r.ok) continue;
    const reg = r.region;
    const count = regionCounts[reg] || 0;
    // Allow up to 4 per region to ensure geographic diversity
    if (count < 4 || selected.length < 15) {
      selected.push(r);
      regionCounts[reg] = count + 1;
    }
    if (selected.length >= 20) break;
  }

  console.log('\n========= RECOMMENDED STATES (15-20) =========');
  selected.forEach((r, i) => {
    console.log(`${i+1}. ${r.state} (${r.region}) — score ${r.score}, ${r.totalRecords.toLocaleString()} recs, ${r.marketCount} markets, ${r.yearSpan}y`);
  });

  // Estimates
  const selectedStates = selected.map(s => s.state);
  const years = 5; // 2021-2025
  const months = 12;
  const crops = 3;
  const apiCalls = selectedStates.length * years * months * crops;
  const avgRecPerSlice = selected.reduce((sum, s) => sum + s.totalRecords / (years * months * crops), 0) / selected.length;
  const estimatedRecords = Math.round(apiCalls * avgRecPerSlice);
  const estimatedMB = Math.round(estimatedRecords * 250 / 1024 / 1024);
  const estimatedHours = Math.round(apiCalls * THROTTLE_MS / 1000 / 60 / 60 * 10) / 10;

  console.log('\n========= ESTIMATES =========');
  console.log(`States selected: ${selectedStates.length}`);
  console.log(`Crops: ${crops} (Onion, Tomato, Potato)`);
  console.log(`Years: ${years} (2021-2025)`);
  console.log(`Months/year: ${months}`);
  console.log(`API calls: ${apiCalls.toLocaleString()} (${selectedStates.length} × ${years} × ${months} × ${crops})`);
  console.log(`Avg records/slice: ~${Math.round(avgRecPerSlice).toLocaleString()}`);
  console.log(`Estimated total records: ${estimatedRecords.toLocaleString()}`);
  console.log(`Estimated MongoDB storage: ~${estimatedMB} MB`);
  console.log(`Backfill duration @ ${THROTTLE_MS}ms throttle: ~${estimatedHours} hours`);

  // Save full results
  const out = {
    timestamp: new Date().toISOString(),
    statesTested: stateObjects.length,
    selectedStates,
    fullResults: results,
    estimates: {
      apiCalls,
      estimatedRecords,
      estimatedMB,
      estimatedHours,
      throttleMs: THROTTLE_MS,
    },
  };
  fs.writeFileSync(path.join(__dirname, 'state_coverage_report.json'), JSON.stringify(out, null, 2));
  console.log('\nFull report saved to state_coverage_report.json');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });