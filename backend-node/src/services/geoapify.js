/**
 * geoapify — thin client for the Geoapify Geocoding API.
 *
 * Used as a *fallback* when the static CENTROIDS / MANDI_CENTROIDS
 * tables don't have an exact match for a free-text place name
 * (e.g. "Patna, Bihar" or "Nashik APMC" already exist in the
 * static table, but a less common mandi or a neighbourhood does
 * not). When the API key is missing this module is a no-op and
 * always returns null — the rest of the system falls back to
 * straight-line (haversine) distance and never throws.
 *
 * Hard rules:
 *   - The API key is read from config.geoapifyApiKey (loaded from
 *     process.env.GEOAPIFY_API_KEY at boot). It is NEVER logged,
 *     echoed, or returned in any function's return value.
 *   - geocode() returns null on any failure path. It never throws.
 *   - Results are cached in-process so the same string is only
 *     geocoded once per process. Cache is bounded (256 entries,
 *     24h TTL) to keep memory usage flat.
 */
const axios = require('axios')
const config = require('../config')

const ENDPOINT = 'https://api.geoapify.com/v1/geocode/search'
const CACHE_MAX = 256
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// Map<text, { ts, value }>. value is the resolved record or null
// (we cache misses too so a typo doesn't keep hammering the API).
const cache = new Map()

// Lightweight shared HTTP client. 6s timeout is tighter than the
// main axios default so a slow Geoapify doesn't hold a logistics
// estimate hostage. We pass our own headers so axios doesn't
// auto-add anything that could leak the key (the key is in the
// query string, not a header — but explicit headers make the
// intent obvious in logs).
const http = axios.create({
  timeout: 6000,
  headers: { Accept: 'application/json' },
})

function trimCache() {
  if (cache.size <= CACHE_MAX) return
  // Map preserves insertion order; the oldest entries are at the
  // front. Delete until we're under the cap.
  const overflow = cache.size - CACHE_MAX
  let removed = 0
  for (const key of cache.keys()) {
    if (removed >= overflow) break
    cache.delete(key)
    removed += 1
  }
}

function cacheGet(text) {
  const hit = cache.get(text)
  if (!hit) return undefined
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(text)
    return undefined
  }
  return hit.value
}

function cacheSet(text, value) {
  cache.set(text, { ts: Date.now(), value })
  if (cache.size > CACHE_MAX) trimCache()
}

/**
 * geocode(placeName) → { lat, lon, formatted, source } | null
 *
 * `source` is always 'geoapify' on a successful hit, so callers
 * can distinguish a fresh API result from a static CENTROIDS row.
 *
 * Returns null if:
 *   - the API key is not configured
 *   - the input is empty / not a string
 *   - the HTTP call fails or times out
 *   - the response has no features
 *   - the first feature has non-finite lat/lon (defensive)
 */
async function geocode(placeName) {
  if (typeof placeName !== 'string') return null
  const text = placeName.trim()
  if (!text) return null

  const cached = cacheGet(text)
  if (cached !== undefined) return cached

  const key = config.geoapifyApiKey
  if (!key) {
    cacheSet(text, null)
    return null
  }

  let response
  try {
    response = await http.get(ENDPOINT, {
      params: { text, apiKey: key, limit: 1 },
    })
  } catch (_err) {
    // Network error, timeout, 4xx, 5xx — all collapse to null.
    // The orchestrator falls back to haversine; we don't surface
    // the error to the user.
    cacheSet(text, null)
    return null
  }

  const features = response && response.data && response.data.features
  if (!Array.isArray(features) || features.length === 0) {
    cacheSet(text, null)
    return null
  }

  const props = features[0] && features[0].properties
  const lat = Number(props && props.lat)
  const lon = Number(props && props.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    cacheSet(text, null)
    return null
  }

  const result = {
    lat,
    lon,
    formatted: (props && (props.formatted || props.name)) || text,
    source: 'geoapify',
  }
  cacheSet(text, result)
  return result
}

/**
 * Test-only helper. Clears the in-memory cache so verifier scripts
 * can prove that two calls for the same string do not re-hit the
 * network (they should resolve from cache and return in < 5ms).
 * Not used by production code.
 */
function _resetCacheForTests() {
  cache.clear()
}

module.exports = { geocode, _resetCacheForTests }
