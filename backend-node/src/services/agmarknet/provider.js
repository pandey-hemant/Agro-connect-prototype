/**
 * services/agmarknet/provider.js — AGMARKNET 2.0 public-API client.
 *
 * Implements the historical-only path proven by the Phase-5 feasibility
 * test:
 *
 *   GET https://api.agmarknet.gov.in/v1/daily-price-arrival/filters
 *     → all states, commodities, districts, markets, varieties, grades
 *
 *   GET https://api.agmarknet.gov.in/v1/prices-and-arrivals/date-wise/specific-commodity
 *     ?year=<yyyy>&month=<m>&stateId=<id>&commodityId=<id>&includeExcel=false
 *     → historical daily prices per (state, commodity, year, month)
 *
 * 403/500/timeout = transient failure → retry up to 2 times with a
 * small backoff. 4xx other than 403 = no retry (configuration error).
 *
 * Throttling: 500 ms between calls (polite; the service is shared).
 *
 * NEVER bypasses CAPTCHA, auth, or rate limits. NEVER hammers the
 * service. NEVER echoes raw upstream payloads with secrets.
 *
 * The filter payload (~526 KB) is cached on disk for 24 h; the
 * downstream orchestrator reads it as a plain JSON file.
 */
'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Module-level in-memory cache for filter catalogues.
// Populated after the first getFilters() call; subsequent calls to
// resolveCommodity/resolveState can short‑circuit synchronously.
let _lastFilters = null;

const BASE_URL = 'https://api.agmarknet.gov.in/v1';
const HEADERS = Object.freeze({
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://agmarknet.gov.in',
  Referer: 'https://agmarknet.gov.in/',
  // Browser-like UA — required to avoid the 403 path the public site
  // serves to non-browser clients.
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
});

// Conservative throttle. 0.5s between calls keeps us well under any
// realistic rate limit; the upstream doesn't expose one anyway.
const THROTTLE_MS = Number(process.env.AGMARKNET_THROTTLE_MS || 500);

const FILTERS_PATH = (() => {
  if (process.env.AGMARKNET_FILTERS_CACHE) return process.env.AGMARKNET_FILTERS_CACHE;
  // Default: backend-node/data/agmarknet_filters.json
  return path.resolve(__dirname, '..', '..', 'data', 'agmarknet_filters.json');
})();
const FILTERS_TTL_MS = Number(process.env.AGMARKNET_FILTERS_TTL_MS || 24 * 60 * 60 * 1000);

// Per-process throttle. Serialised through a queue so concurrent
// callers can't all burst at once.
let lastCallAt = 0;
const queue = [];
let queueRunning = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, THROTTLE_MS - (now - lastCallAt));
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function enqueue(fn) {
  if (queueRunning) {
    await new Promise((resolve) => queue.push(resolve));
  }
  queueRunning = true;
  try {
    return await fn();
  } finally {
    queueRunning = false;
    const next = queue.shift();
    if (next) next();
  }
}

/**
 * Internal: HTTP GET with the standard browser-like headers and a
 * single retry on transient failures (5xx, network, 403).
 *
 * Returns:
 *   { ok: true,  status, data, contentType }
 *   { ok: false, status, error }    — never throws
 */
async function getJson(url, { maxRetries = 2, timeoutMs = 20000 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await throttle();
      const resp = await axios.get(url, {
        headers: HEADERS,
        timeout: timeoutMs,
        // Treat 2xx as success; everything else flows through our
        // own retry logic so we can decide what is transient.
        validateStatus: (s) => s >= 200 && s < 300,
        responseType: 'json',
      });
      return {
        ok: true,
        status: resp.status,
        data: resp.data,
        contentType: resp.headers && resp.headers['content-type'],
      };
    } catch (err) {
      lastErr = err;
      const status = err.response ? err.response.status : 0;
      const isTransient =
        status === 0 || // network
        status === 403 || // sometimes transient
        status === 408 || // request timeout
        status === 429 || // rate-limited
        (status >= 500 && status < 600); // server error
      if (!isTransient || attempt === maxRetries) {
        return {
          ok: false,
          status,
          error: err.message || `HTTP ${status || 'network'}`,
        };
      }
      // Exponential backoff with jitter, capped at 4s.
      const backoff = Math.min(4000, 500 * Math.pow(2, attempt));
      await sleep(backoff + Math.floor(Math.random() * 250));
    }
  }
  return { ok: false, status: 0, error: (lastErr && lastErr.message) || 'unknown' };
}

// ---------- filters ----------

function isFiltersFresh() {
  try {
    const st = fs.statSync(FILTERS_PATH);
    return Date.now() - st.mtimeMs < FILTERS_TTL_MS;
  } catch (_) {
    return false;
  }
}

function readFiltersCache() {
  try {
    const raw = fs.readFileSync(FILTERS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeFiltersCache(payload) {
  try {
    fs.mkdirSync(path.dirname(FILTERS_PATH), { recursive: true });
    fs.writeFileSync(FILTERS_PATH, JSON.stringify(payload), 'utf8');
    return true;
  } catch (err) {
    // Cache failures are non-fatal — we just refetch next time.
    return false;
  }
}

/**
 * Load the filters payload. Tries the on-disk cache first; only
 * hits the network if the cache is missing or stale.
 */
async function getFilters({ forceRefresh = false } = {}) {
  if (!forceRefresh && isFiltersFresh()) {
    const cached = readFiltersCache();
    if (cached) {
      // Normalize cached payloads in case the cache file was written
      // by an older version of this module that didn't run the
      // normalizer. Pure function — safe to call on already-normalized
      // data (it short-circuits).
      const normalized = normalizeFilterPayload(cached);
      _lastFilters = normalized;
      return { ok: true, source: 'cache', data: normalized };
    }
  }
  const result = await enqueue(() =>
    getJson(`${BASE_URL}/daily-price-arrival/filters`, { maxRetries: 2, timeoutMs: 30000 })
  );
  if (!result.ok) {
    // Fall back to stale cache if we have one — better than nothing.
    const stale = readFiltersCache();
    if (stale) {
      _lastFilters = stale;
      return { ok: true, source: 'stale_cache', data: stale, warning: result.error };
    }
    return { ok: false, source: 'network', error: result.error, status: result.status };
  }
  // Some upstreams wrap the body in `{data: [...]}`, others emit
  // the catalogue directly. Accept both shapes.
  let payload = result.data;
  if (payload && payload.data && !Array.isArray(payload)) {
    payload = payload.data;
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, source: 'network', error: 'filters payload shape unexpected' };
  }
  // Normalize the catalogue shape so existing callers (resolveCommodity,
  // agmarknet_backfill.cjs, etc.) can keep reading the historical field
  // names. AGMARKNET 2.0 currently uses:
  //   cmdt_data  (commodity catalogue, items: { cmdt_id, cmdt_name, cmdt_group_id })
  //   state_data (state catalogue, items: { state_id, state_name })
  //   market_data, variety_data, district_data, cmdt_group_data
  // We expose a normalized `commodity_data` alongside `cmdt_data` for
  // backwards compatibility with the older naming.
  const normalized = normalizeFilterPayload(payload);
  writeFiltersCache(normalized);
  // Populate the in-memory cache so the next resolveCommodity / resolveState
  // call can short-circuit synchronously (resolves the diagnostic's
  // "JSON.stringify on a Promise gives {}" trap).
  _lastFilters = normalized;
  return { ok: true, source: 'network', data: normalized };
}

/**
 * Normalize the AGMARKNET filter payload so downstream code can rely on
 * a consistent shape. Pure function — never mutates the input.
 *
 * Current upstream field mapping (confirmed live):
 *   cmdt_data        → commodity_data   (id=cmdt_id, name=cmdt_name)
 *   state_data       → state_data       (id=state_id, name=state_name)  [unchanged]
 *   market_data      → market_data      [unchanged]
 *   variety_data     → variety_data     [unchanged]
 *   district_data    → district_data    [unchanged]
 *   cmdt_group_data  → cmdt_group_data  [unchanged]
 *
 * The transformation is additive: the original `cmdt_data` key is left
 * in place so any future caller that wants the raw upstream shape can
 * still read it.
 */
function normalizeFilterPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  // Already normalized? Skip the copy.
  if (Array.isArray(payload.commodity_data) && !Array.isArray(payload.cmdt_data)) {
    return payload;
  }
  const out = Object.assign({}, payload);
  if (Array.isArray(out.cmdt_data)) {
    out.commodity_data = out.cmdt_data.map((it) => ({
      cmdt_id: it && it.cmdt_id,
      cmdt_name: it && it.cmdt_name,
      cmdt_group_id: it && it.cmdt_group_id,
      // Pre-computed legacy fields for direct use without re-parsing.
      id: it && it.cmdt_id,
      name: it && it.cmdt_name,
      commodity_id: it && it.cmdt_id,
      commodity_name: it && it.cmdt_name,
    }));
  }
  return out;
}

// ---------- name → id resolution ----------

function asNameIdList(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      if (!it || typeof it !== 'object') return null;
      // AGMARKNET 2.0 returns different field naming conventions across
      // its catalogues. We accept every known variant:
      //   state catalogue:   { state_id, state_name }
      //   commodity current: { cmdt_id, cmdt_name }
      //   commodity older:   { commodityId, commodity } (camelCase)
      //   commodity legacy:  { commodity_id, commodity_name } (snake_case)
      //   district/market:   similar variations
      const id = it.id != null
        ? it.id
        : (it.cmdt_id || it.state_id || it.commodity_id || it.district_id || it.market_id
          || it.cmdtId || it.stateId || it.commodityId || it.districtId || it.marketId);
      const name = it.name != null
        ? it.name
        : (it.cmdt_name || it.state_name || it.commodity_name || it.district_name || it.market_name
          || it.cmdtName || it.stateName || it.commodity || it.districtName || it.marketName);
      if (id == null || !name) return null;
      return { id: String(id), name: String(name) };
    })
    .filter(Boolean);
}

function resolveNameId(catalogue, key, query) {
  if (!catalogue || !catalogue[key] || !query) return null;
  const list = asNameIdList(catalogue[key]);
  const q = String(query).toLowerCase().trim();
  // Exact match wins.
  for (const it of list) if (it.name.toLowerCase() === q) return it;
  // Then case-insensitive substring.
  for (const it of list) if (it.name.toLowerCase().includes(q)) return it;
  return null;
}

async function resolveState(name) {
  const f = await getFilters();
  if (!f.ok) return { ok: false, error: f.error };
  return { ok: true, match: resolveNameId(f.data, 'state_data', name) };
}

async function resolveCommodity(name) {
  const f = await getFilters();
  if (!f.ok) return { ok: false, error: f.error };
  return { ok: true, match: resolveNameId(f.data, 'commodity_data', name) };
}

/**
 * Synchronous variant: resolve a commodity name against the catalogue
 * that is already in memory. Returns `null` if no catalogue is loaded
 * yet (caller should `await getFilters()` first and retry). Useful
 * for diagnostics and for backfill scripts that want to avoid the
 * Promise trap (`JSON.stringify(p.resolveCommodity('Onion'))` yields
 * `{}` because Promises have no own enumerable properties).
 */
function resolveCommoditySync(name) {
  if (!_lastFilters) return null;
  return resolveNameId(_lastFilters, 'commodity_data', name);
}

function resolveStateSync(name) {
  if (!_lastFilters) return null;
  return resolveNameId(_lastFilters, 'state_data', name);
}

// ---------- date-wise historical endpoint ----------

/**
 * Fetch one (state, commodity, year, month) slice.
 *
 *   { year, month, stateId, commodityId, includeExcel = false }
 *
 * Returns:
 *   { ok, status, records: [{marketName, marketState, marketDistrict,
 *                             variety, grade, arrivalDate,
 *                             arrivals, minPricePerQuintal,
 *                             modalPricePerQuintal, maxPricePerQuintal,
 *                             priceUnit, raw}], source, error? }
 */
async function fetchDateWise({
  year,
  month,
  stateId,
  commodityId,
  includeExcel = false,
} = {}) {
  if (!year || !month || !stateId || !commodityId) {
    return { ok: false, error: 'year, month, stateId, commodityId are all required' };
  }
  const url = `${BASE_URL}/prices-and-arrivals/date-wise/specific-commodity`;
  // Params MUST be camelCase — verified by the feasibility test.
  // Snake_case (state_id / commodity_id / include_excel) → 500.
  const params = {
    year: Number(year),
    month: Number(month),
    stateId: String(stateId),
    commodityId: String(commodityId),
    includeExcel: String(includeExcel).toLowerCase(),
  };
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const fullUrl = `${url}?${qs}`;

  const result = await enqueue(() => getJson(fullUrl, { maxRetries: 2, timeoutMs: 30000 }));
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
    };
  }
  const data = result.data;
  if (!data || data.success === false) {
    return {
      ok: false,
      status: result.status,
      error: (data && data.message) || 'upstream success=false',
      data,
    };
  }
  // Normalize the per-market, per-date records into a flat array.
  const records = [];
  const markets = (data && data.markets) || [];
  // Fallback units — look for "Quintal" in the columns header so the
  // persisted price_unit is always meaningful even if the upstream
  // omits the columns array on some endpoints.
  const columns = (data && data.columns) || [];
  const unitLabel =
    columns.map((c) => (c && c.title) || '').find((t) => /quintal/i.test(t)) || 'Rs./Quintal';
  for (const m of markets) {
    if (!m || typeof m !== 'object') continue;
    // Market name — multiple upstream naming conventions across
    // AGMARKNET 2.0 versions. We pick the first non-empty.
    const marketName =
      m.marketName ||
      m.market_name ||
      m.name ||
      m.market ||
      (m.marketId ? `market_${m.marketId}` : '') ||
      '';
    const marketState =
      m.state || m.state_name || m.stateName || m.stateName || '';
    const marketDistrict =
      m.district || m.district_name || m.districtName || m.district_name || '';
    const dates = m.dates || m.dateWiseData || m.data || [];
    if (!Array.isArray(dates)) continue;
    for (const d of dates) {
      if (!d || typeof d !== 'object') continue;
      // Upstream sometimes wraps the per-variety observations inside
      // an inner `data[]` array on the date record. Example live
      // response (2023-01 Onion in Maharashtra):
      //   {
      //     "arrivalDate": "02/01/2023",
      //     "total_arrivals": 980,
      //     "data": [
      //       { "arrivals": 490, "variety": "Red",
      //         "minimumPrice": 551, "maximumPrice": 1671, "modalPrice": 1300 },
      //       { "arrivals": 490, "variety": "Other",
      //         "minimumPrice": 1050, "maximumPrice": 1351, "modalPrice": 1200 }
      //     ]
      //   }
      // When `d.data` is a non-empty array, each inner object is a
      // SEPARATE observation (one per variety) and must be persisted
      // as its own record — collapsing to data[0] would silently
      // drop the other varieties. The outer `d` carries the
      // arrivalDate and total_arrivals that apply to every inner
      // observation.
      const innerArr = Array.isArray(d.data) && d.data.length > 0
        ? d.data
        : [d];  // back-compat: single observation with no inner array
      const outerArrivalDate = normalizeDate(
        pickFirstNonEmpty(d, [
          'arrivalDate', 'arrival_date', 'date', 'priceDate', 'price_date',
          'Arrival Date', 'Price Date',
        ]) || ''
      );
      const totalArrivals = toNumberOrNull(
        pickFirstNonEmpty(d, [
          'total_arrivals', 'totalArrivals', 'total',
        ])
      );
      for (const inner of innerArr) {
        if (!inner || typeof inner !== 'object') continue;
        // Each datum — accept multiple upstream field names. The
        // pickFirstNonEmpty helper also matches space-separated title
        // forms (e.g. "Modal Price") and case-insensitive variants,
        // which the 2x2x3 validation showed were leaking through to a
        // null price.
        const arrivalDate = outerArrivalDate || normalizeDate(
          pickFirstNonEmpty(inner, [
            'arrivalDate', 'arrival_date', 'date', 'priceDate', 'price_date',
            'Arrival Date', 'Price Date',
          ]) || ''
        );
        const variety = pickFirstNonEmpty(inner, [
          'variety', 'variety_name', 'varietyName', 'Variety',
        ]) || '';
        const grade = pickFirstNonEmpty(inner, [
          'grade', 'grade_name', 'gradeName', 'Grade',
        ]) || '';
        const arrivals = toNumberOrNull(
          pickFirstNonEmpty(inner, [
            'arrivals', 'arrival', 'arrival_qty', 'arrivalQty', 'quantity',
            'Arrivals', 'Arrival',
          ])
        );
        const minPricePerQuintal = toNumberOrNull(
          pickFirstNonEmpty(inner, [
            'minimumPrice', 'min_price', 'minPrice', 'min', 'min_price_per_quintal',
            'Minimum Price', 'Min Price', 'min_price_per_quintal', 'MIN_PRICE',
          ])
        );
        const modalPricePerQuintal = toNumberOrNull(
          pickFirstNonEmpty(inner, [
            'modalPrice', 'modal_price', 'modalPricePerQuintal',
            'modal_price_per_quintal', 'price', 'modal', 'ModalPrice',
            'Modal Price', 'MODAL_PRICE', 'Mode Price',
          ])
        );
        const maxPricePerQuintal = toNumberOrNull(
          pickFirstNonEmpty(inner, [
            'maximumPrice', 'max_price', 'maxPrice', 'max', 'max_price_per_quintal',
            'Maximum Price', 'Max Price', 'MAX_PRICE',
          ])
        );
        records.push({
          marketName,
          marketState,
          marketDistrict,
          variety: String(variety).trim(),
          grade: String(grade).trim(),
          arrivalDate,
          arrivals,
          totalArrivals,
          minPricePerQuintal,
          modalPricePerQuintal,
          maxPricePerQuintal,
          priceUnit: unitLabel,
          raw: inner,
          rawOuter: d,  // preserve the outer record (date + total_arrivals) for provenance
        });
      }
    }
  }
  return {
    ok: true,
    status: result.status,
    records,
    source: 'agmarknet',
    title: (data && data.title) || null,
  };
}

// DD/MM/YYYY → YYYY-MM-DD.  Returns '' on any mismatch — the
// orchestrator drops empty arrivalDate rows.
function normalizeDate(s) {
  if (s == null) return '';
  // Accept numbers (Excel-style serial dates) and Date objects too.
  if (s instanceof Date) {
    return s.toISOString().slice(0, 10);
  }
  if (typeof s !== 'string') {
    s = String(s);
  }
  s = s.trim();
  if (!s) return '';
  // ISO YYYY-MM-DD (with optional time component)
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) {
    return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`;
  }
  // DD/MM/YYYY  OR  MM/DD/YYYY — AGMARKNET has historically used both
  // depending on the consumer's locale. Try DD/MM first (matches the
  // public agmarknet.gov.in UI), then MM/DD.
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    // Heuristic: if either part > 12, the >12 part MUST be the day
    // and the other must be the month. Otherwise default to DD/MM
    // (AGMARKNET's primary convention).
    const a = Number(m2[1]);
    const b = Number(m2[2]);
    const y = m2[3];
    if (a > 12 && b <= 12) {
      // DD/MM/YYYY
      return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
    if (b > 12 && a <= 12) {
      // MM/DD/YYYY
      return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    }
    // Ambiguous — assume DD/MM/YYYY (AGMARKNET's primary).
    return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }
  // DD-MM-YYYY  OR  DD.MM.YYYY  (some embedded consumers)
  const m3 = s.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/);
  if (m3) {
    return `${m3[3]}-${m3[2].padStart(2, '0')}-${m3[1].padStart(2, '0')}`;
  }
  // YYYY/MM/DD
  const m4 = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m4) {
    return `${m4[1]}-${m4[2].padStart(2, '0')}-${m4[3].padStart(2, '0')}`;
  }
  // DD-Mon-YYYY  (e.g. "01-Jan-2025")
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const m5 = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/);
  if (m5 && months[m5[2].slice(0, 3).toLowerCase()]) {
    return `${m5[3]}-${months[m5[2].slice(0, 3).toLowerCase()]}-${m5[1].padStart(2, '0')}`;
  }
  return '';
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') v = String(v);
  // Strip Indian-style currency markers, thousands separators, and
  // any non-numeric decoration. We DO NOT strip decimal points.
  const cleaned = v
    .replace(/[₹$€£¥]/g, '')  // currency symbols
    .replace(/Rs\.?/gi, '')    // "Rs." or "Rs"
    .replace(/INR/gi, '')      // "INR"
    .replace(/per\s*kg/gi, '') // units
    .replace(/per\s*quintal/gi, '')
    .replace(/,/g, '')         // Indian thousands sep (1,50,000)
    .replace(/\s+/g, '')       // whitespace
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pick the first non-empty value from a record under any of the given
 * candidate keys. Unlike `obj.k1 || obj.k2`, this:
 *   - skips `null`, `undefined`, and the empty string
 *   - also tries **case-insensitive** and **space-collapsed** forms of
 *     each key (so e.g. "Modal Price" matches "modalPrice", "modal_price",
 *     "Modal Price", "MODAL_PRICE", "modal price", etc.)
 *   - returns the original value untouched — caller still passes the
 *     result through `toNumberOrNull` if a number is needed.
 *
 * This is what the 2x2x3 validation showed was missing: AGMARKNET
 * 2.0 has historically used BOTH the camelCase `key` form and the
 * space-separated `title` form in its date-wise rows, sometimes
 * within the same response depending on the (year, month) slice. A
 * simple `||` chain cannot see through the space-vs-no-space gap.
 */
function pickFirstNonEmpty(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  // Pre-build a lookup table of the *normalised* form of every key
  // present on the object so the search is O(n) over the candidate
  // list rather than O(n*m) over (candidates x object keys).
  const norm = (k) =>
    String(k)
      .toLowerCase()
      .replace(/[\s_\-]+/g, '');  // strip spaces, underscores, dashes
  const table = Object.create(null);
  for (const k of Object.keys(obj)) {
    table[norm(k)] = obj[k];
  }
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
    const nv = table[norm(k)];
    if (nv !== undefined && nv !== null && nv !== '') return nv;
  }
  return undefined;
}

module.exports = {
  HEADERS,
  BASE_URL,
  FILTERS_PATH,
  getFilters,
  resolveState,
  resolveCommodity,
  resolveStateSync,
  resolveCommoditySync,
  fetchDateWise,
  // exposed for tests
  _internal: {
    normalizeDate,
    toNumberOrNull,
    pickFirstNonEmpty,
    asNameIdList,
    resolveNameId,
    normalizeFilterPayload,
  },
};
