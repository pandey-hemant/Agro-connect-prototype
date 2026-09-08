#!/usr/bin/env node
/**
 * audit_datareadiness.cjs — read-only audit of the AGMARKNET data sources
 * and existing MongoDB collection, for the XGBoost readiness report.
 *
 * NEVER prints the API key (DATA_GOV_IN_API_KEY) or any of its prefix/suffix.
 * The key is loaded from .env via the same dotenv path the server uses, and
 * passed to axios directly.
 *
 * The script only reads; it does not modify the working app, frontend, ML,
 * DB schema, or production routes.
 */
'use strict';

const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const API_KEY = process.env.DATA_GOV_IN_API_KEY || '';
const RESOURCE_ID = process.env.DATA_GOV_IN_RESOURCE_ID || '9ef84268-d588-465a-a308-a864a43d0070';

// Cheap mask for logs — never reveals the key.
function mask(v) {
  if (!v) return '(empty)';
  if (v.length <= 8) return `(${v.length} chars)`;
  return `${v.slice(0, 3)}***(${v.length} chars)***${v.slice(-2)}`;
}

const SECTION = (label) => console.log(`\n========= ${label} =========`);

function summarizeRecord(r) {
  return {
    state: r.state,
    district: r.district,
    market: r.market,
    commodity: r.commodity,
    variety: r.variety,
    arrival_date: r.arrival_date,
    min_price: r.min_price,
    modal_price: r.modal_price,
    max_price: r.max_price,
  };
}

async function probeDataGovIn() {
  SECTION('A. data.gov.in (current mandi API)');
  console.log('  Resource ID:', RESOURCE_ID);
  console.log('  API key (masked):', mask(API_KEY));

  if (!API_KEY) {
    console.log('  [FAIL] DATA_GOV_IN_API_KEY is empty in .env');
    return null;
  }

  // 1. base list call
  const baseUrl = `https://api.data.gov.in/resource/${RESOURCE_ID}`;
  let base;
  try {
    base = await axios.get(baseUrl, {
      params: { 'api-key': API_KEY, format: 'json', limit: 10 },
      timeout: 12000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
  } catch (err) {
    const status = err.response ? err.response.status : 0;
    const body = err.response ? err.response.data : null;
    console.log(`  [FAIL] HTTP error — status=${status} err=${err.message}`);
    if (body) console.log('  body:', JSON.stringify(body).slice(0, 400));
    return null;
  }

  const recs = (base.data && base.data.records) || [];
  const fields = recs.length ? Object.keys(recs[0]) : [];
  console.log('  [OK] HTTP status:', base.status);
  console.log('  [OK] Content-Type:', base.headers['content-type']);
  console.log('  [OK] Records in this call:', recs.length);
  console.log('  [OK] Total available (top-level count if present):',
    base.data && (base.data.total != null ? base.data.total : '(not returned)'));
  console.log('  [OK] Available fields:', fields);

  const dates = recs.map((r) => r.arrival_date).filter(Boolean);
  const latest = dates.sort().slice(-1)[0];
  console.log('  [OK] Latest arrival_date in this call:', latest || '(none)');

  // 2. Filter test — commodity=Tomato, state=Maharashtra (if present)
  let filterTest = null;
  try {
    const f = await axios.get(baseUrl, {
      params: {
        'api-key': API_KEY,
        format: 'json',
        limit: 5,
        'filters[commodity]': 'Tomato',
        'filters[state]': 'Maharashtra',
      },
      timeout: 12000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const fr = (f.data && f.data.records) || [];
    filterTest = { ok: true, status: f.status, count: fr.length, sample: fr.slice(0, 2) };
    console.log(`  [OK] filter (Tomato + Maharashtra) → status=${f.status}, records=${fr.length}`);
  } catch (err) {
    filterTest = { ok: false, error: err.message };
    console.log('  [FAIL] filter test:', err.message);
  }

  // 3. Pagination test — offset 0 vs offset 100
  let pagination = null;
  try {
    const p1 = await axios.get(baseUrl, {
      params: { 'api-key': API_KEY, format: 'json', limit: 5, offset: 0 },
      timeout: 12000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const p2 = await axios.get(baseUrl, {
      params: { 'api-key': API_KEY, format: 'json', limit: 5, offset: 100 },
      timeout: 12000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const a1 = (p1.data && p1.data.records) || [];
    const a2 = (p2.data && p2.data.records) || [];
    pagination = {
      ok: true,
      offset0: a1.length,
      offset100: a2.length,
      different: JSON.stringify(a1) !== JSON.stringify(a2),
    };
    console.log(`  [OK] pagination: offset=0 -> ${a1.length}, offset=100 -> ${a2.length}, different=${pagination.different}`);
  } catch (err) {
    pagination = { ok: false, error: err.message };
    console.log('  [FAIL] pagination:', err.message);
  }

  return {
    base: {
      status: base.status,
      contentType: base.headers['content-type'],
      recordCount: recs.length,
      total: base.data && base.data.total,
      fields,
      latestArrivalDate: latest,
      sample: recs.slice(0, 3).map(summarizeRecord),
    },
    filterTest,
    pagination,
  };
}

const AGMARKNET_BASE = 'https://api.agmarknet.gov.in/v1';
const AGMARKNET_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://agmarknet.gov.in',
  Referer: 'https://agmarknet.gov.in/',
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
};

async function agmarknetGetJson(url) {
  try {
    const r = await axios.get(url, {
      headers: AGMARKNET_HEADERS,
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
      data: err.response ? err.response.data : null,
    };
  }
}

async function probeHistoricalAGMARKNET() {
  SECTION('B. AGMARKNET 2.0 historical (date-wise) endpoint');

  // 1. filters
  const fRes = await agmarknetGetJson(`${AGMARKNET_BASE}/daily-price-arrival/filters`);
  if (!fRes.ok) {
    console.log('  [FAIL] filters endpoint unreachable:', fRes.status, fRes.error);
    return { ok: false };
  }
  console.log('  [OK] filters HTTP status:', fRes.status);
  const fdata = fRes.data && (fRes.data.data || fRes.data);
  const states = fdata && (fdata.state_data || []);
  const commodities = fdata && (fdata.commodity_data || fdata.cmdt_data || []);
  const markets = fdata && (fdata.market_data || []);
  console.log(`  [OK] states=${states.length}, commodities=${commodities.length}, markets=${markets.length}`);

  // Try to find a small set of (state, commodity) tuples that should always
  // have historical data — pick 3 commodity candidates that typically
  // have many years of coverage.
  const targetCommodities = ['Onion', 'Tomato', 'Potato', 'Wheat', 'Rice', 'Soybean'];
  const targetStates = ['Maharashtra', 'Madhya Pradesh', 'Uttar Pradesh', 'Karnataka'];
  const found = [];
  for (const s of targetStates) {
    const st = states.find((x) => (x.state_name || x.name || '').toLowerCase() === s.toLowerCase());
    if (!st) continue;
    for (const cname of targetCommodities) {
      const cd = commodities.find((x) => (x.cmdt_name || x.commodity_name || x.name || '').toLowerCase() === cname.toLowerCase());
      if (!cd) continue;
      found.push({
        state: s,
        stateId: st.state_id || st.id,
        commodity: cname,
        commodityId: cd.cmdt_id || cd.id,
      });
      if (found.length >= 2) break;
    }
    if (found.length >= 2) break;
  }
  console.log('  [INFO] sample (state, commodity) tuples to test:', found);

  // 2. Probe a small set of (year, month) slices to gauge coverage.
  const yearMonths = [
    { year: 2024, month: 6 },
    { year: 2023, month: 1 },
    { year: 2022, month: 8 },
    { year: 2025, month: 3 },
    { year: 2021, month: 11 },
    { year: 2020, month: 2 },
  ];
  const probe = [];
  for (const t of found) {
    for (const ym of yearMonths) {
      const url = `${AGMARKNET_BASE}/prices-and-arrivals/date-wise/specific-commodity`
        + `?year=${ym.year}&month=${ym.month}`
        + `&stateId=${encodeURIComponent(t.stateId)}`
        + `&commodityId=${encodeURIComponent(t.commodityId)}`
        + `&includeExcel=false`;
      const r = await agmarknetGetJson(url);
      const data = r.data && (r.data.data || r.data);
      let recordCount = 0;
      if (data && Array.isArray(data.markets)) {
        for (const m of data.markets) {
          const dates = m.dates || m.dateWiseData || m.data || [];
          for (const d of dates) {
            const inner = Array.isArray(d.data) && d.data.length > 0 ? d.data : [d];
            recordCount += inner.length;
          }
        }
      }
      probe.push({
        state: t.state, commodity: t.commodity,
        year: ym.year, month: ym.month,
        status: r.status, ok: r.ok, records: recordCount,
        error: r.error,
      });
      console.log(`  ${r.ok ? '[OK] ' : '[ERR]'} ${t.state}/${t.commodity} ${ym.year}-${String(ym.month).padStart(2, '0')} → status=${r.status} records=${recordCount}${r.error ? ' err=' + r.error : ''}`);
    }
  }

  // 3. Determine latest year currently exposed by the date-wise endpoint.
  // Try a broader year sweep on the first tuple.
  const yearSweep = [];
  if (found.length) {
    const t = found[0];
    for (let y = 2018; y <= 2025; y += 1) {
      for (const m of [1, 6, 12]) {
        const url = `${AGMARKNET_BASE}/prices-and-arrivals/date-wise/specific-commodity`
          + `?year=${y}&month=${m}`
          + `&stateId=${encodeURIComponent(t.stateId)}`
          + `&commodityId=${encodeURIComponent(t.commodityId)}`
          + `&includeExcel=false`;
        const r = await agmarknetGetJson(url);
        const data = r.data && (r.data.data || r.data);
        let recordCount = 0;
        if (data && Array.isArray(data.markets)) {
          for (const mkt of data.markets) {
            const dates = mkt.dates || mkt.dateWiseData || mkt.data || [];
            for (const d of dates) {
              const inner = Array.isArray(d.data) && d.data.length > 0 ? d.data : [d];
              recordCount += inner.length;
            }
          }
        }
        yearSweep.push({ year: y, month: m, status: r.status, records: recordCount, ok: r.ok });
      }
    }
    const withData = yearSweep.filter((x) => x.records > 0);
    const noData = yearSweep.filter((x) => x.records === 0 && x.ok);
    const fail = yearSweep.filter((x) => !x.ok);
    console.log(`  [INFO] year sweep ${t.state}/${t.commodity}: withData=${withData.length} noData=${noData.length} err=${fail.length}`);
    if (withData.length) {
      const yrs = [...new Set(withData.map((x) => x.year))].sort();
      console.log(`  [INFO] years with data: ${yrs.join(', ')}`);
    }
    if (fail.length) {
      console.log(`  [WARN] ${fail.length} slices errored; example: ${fail[0].year}-${fail[0].month} status=${fail[0].status}`);
    }
  }

  // 4. Without auth — confirm whether authentication is required.
  console.log('  [INFO] no API key/Authorization sent — public, browser-like headers only.');
  const needsAuth = !fRes.ok;
  console.log('  [OK] authentication required? ' + (needsAuth ? 'YES (could not reach)' : 'NO (public, browser-headers only)'));

  return {
    ok: true,
    filters: {
      states: states.length,
      commodities: commodities.length,
      markets: markets.length,
      sampleState: states.slice(0, 3).map((s) => s.state_name || s.name),
      sampleCommodity: commodities.slice(0, 5).map((c) => c.cmdt_name || c.commodity_name || c.name),
    },
    probe,
    yearSweep,
  };
}

async function inspectMongo() {
  SECTION('C. Existing MongoDB AGMARKNET collection (MarketPrice)');

  let mongoose;
  try {
    mongoose = require('mongoose');
  } catch (err) {
    console.log('  [FAIL] mongoose not installed; cannot inspect DB from this script.');
    return { ok: false };
  }

  const MONGODB_URI = process.env.MONGODB_URI || '';
  if (!MONGODB_URI) {
    console.log('  [FAIL] MONGODB_URI is empty; cannot connect.');
    return { ok: false };
  }
  console.log('  [INFO] connecting to', MONGODB_URI.replace(/\/\/.*@/, '//***@'));

  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  } catch (err) {
    console.log('  [FAIL] mongo connect:', err.message);
    return { ok: false };
  }
  console.log('  [OK] connected');

  const MarketPrice = mongoose.model('MarketPrice', new mongoose.Schema({}, { strict: false, collection: 'marketprices' }));

  // 1. Total count
  const total = await MarketPrice.estimatedDocumentCount();
  console.log('  [OK] total docs (estimated):', total);

  // 2. Earliest and latest arrivalDate
  const earliestDoc = await MarketPrice.findOne({ arrivalDate: { $exists: true, $ne: '' } })
    .sort({ arrivalDate: 1 })
    .lean();
  const latestDoc = await MarketPrice.findOne({ arrivalDate: { $exists: true, $ne: '' } })
    .sort({ arrivalDate: -1 })
    .lean();
  const earliest = earliestDoc ? earliestDoc.arrivalDate : null;
  const latest = latestDoc ? latestDoc.arrivalDate : null;
  console.log('  [OK] earliest arrivalDate:', earliest);
  console.log('  [OK] latest arrivalDate:', latest);

  // 3. Distinct commodities
  const commodities = await MarketPrice.distinct('cropName');
  console.log('  [OK] distinct cropName count:', commodities.length);
  console.log('  [OK] sample commodities:', commodities.slice(0, 15));

  // 4. Distinct states
  const states = await MarketPrice.distinct('state');
  console.log('  [OK] distinct state count:', states.length);
  console.log('  [OK] states:', states);

  // 5. Distinct markets
  const markets = await MarketPrice.distinct('market');
  console.log('  [OK] distinct market count:', markets.length);
  console.log('  [OK] sample markets:', markets.slice(0, 15));

  // 6. Missing values
  const missing = {
    missing_arrivalDate: await MarketPrice.countDocuments({ $or: [{ arrivalDate: '' }, { arrivalDate: null }, { arrivalDate: { $exists: false } }] }),
    missing_market: await MarketPrice.countDocuments({ $or: [{ market: '' }, { market: null }] }),
    missing_state: await MarketPrice.countDocuments({ $or: [{ state: '' }, { state: null }] }),
    missing_pricePerKg: await MarketPrice.countDocuments({ $or: [{ pricePerKg: null }, { pricePerKg: { $lte: 0 } }] }),
    missing_pricePerQuintal: await MarketPrice.countDocuments({ $or: [{ pricePerQuintal: null }, { pricePerQuintal: { $lte: 0 } }] }),
    missing_district: await MarketPrice.countDocuments({ $or: [{ district: '' }, { district: null }] }),
    missing_variety: await MarketPrice.countDocuments({ $or: [{ variety: '' }, { variety: null }] }),
  };
  console.log('  [OK] missing-value counts:', missing);

  // 7. Duplicate rate (rough): the 6-tuple (source, cropName, state, market, arrivalDate, variety)
  //    should be unique. Count docs beyond first occurrence.
  const dupAgg = await MarketPrice.aggregate([
    {
      $group: {
        _id: { source: '$source', cropName: '$cropName', state: '$state', market: '$market', arrivalDate: '$arrivalDate', variety: '$variety' },
        n: { $sum: 1 },
      },
    },
    { $match: { n: { $gt: 1 } } },
    { $count: 'dups' },
  ]);
  const distinctKeys = await MarketPrice.aggregate([
    {
      $group: {
        _id: { source: '$source', cropName: '$cropName', state: '$state', market: '$market', arrivalDate: '$arrivalDate', variety: '$variety' },
      },
    },
    { $count: 'd' },
  ]);
  const dups = dupAgg[0] ? dupAgg[0].dups : 0;
  const uniq = distinctKeys[0] ? distinctKeys[0].d : total;
  const dupRate = uniq > 0 ? (total - uniq) / uniq : 0;
  console.log(`  [OK] exact-key dup groups (>1 doc): ${dups}`);
  console.log(`  [OK] distinct 6-tuples: ${uniq} of ${total} (dup rate ~ ${(dupRate * 100).toFixed(2)}%)`);

  // 8. By-source breakdown
  const bySource = await MarketPrice.aggregate([
    { $group: { _id: '$source', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  console.log('  [OK] by source:', bySource);

  await mongoose.disconnect();
  console.log('  [OK] mongo disconnected');
  return {
    total,
    earliest,
    latest,
    commodities,
    states,
    markets,
    missing,
    duplicateGroups: dups,
    distinctTuples: uniq,
    duplicateRate: dupRate,
    bySource,
  };
}

(async () => {
  const a = await probeDataGovIn();
  const b = await probeHistoricalAGMARKNET();
  const c = await inspectMongo();

  SECTION('FINAL JSON SUMMARY (safe to capture)');
  // Never include the API key in any output.
  const out = {
    a_currentMandi: a,
    b_historicalAGMARKNET: b,
    c_existingMongo: c,
  };
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(1);
});
