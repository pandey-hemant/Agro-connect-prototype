/**
 * utils/geo.js — centroid coordinates for Indian states / districts,
 * market hints, and haversine distance.
 *
 * This is the JS port of backend/app/services/logistics.py:geography.
 * Only the entries actually used by the e2e tests / decision support
 * are listed; expand as needed.
 */
'use strict';

const CENTROIDS = {
  // States (capital lat, lon)
  Bihar: { lat: 25.5941, lon: 85.1376 },
  'Uttar Pradesh': { lat: 26.8467, lon: 80.9462 },
  Punjab: { lat: 30.7333, lon: 76.7794 },
  Haryana: { lat: 30.7333, lon: 76.7794 },
  Maharashtra: { lat: 19.7515, lon: 75.7139 },
  Gujarat: { lat: 23.0225, lon: 72.5714 },
  Karnataka: { lat: 12.9716, lon: 77.5946 },
  'Tamil Nadu': { lat: 13.0827, lon: 80.2707 },
  'Madhya Pradesh': { lat: 23.2599, lon: 77.4126 },
  'West Bengal': { lat: 22.5726, lon: 88.3639 },
  Rajasthan: { lat: 26.9124, lon: 75.7873 },
  Telangana: { lat: 17.385, lon: 78.4867 },
  Kerala: { lat: 8.5241, lon: 76.9366 },
  Odisha: { lat: 20.2961, lon: 85.8245 },
  Jharkhand: { lat: 23.3441, lon: 85.3096 },
  Chhattisgarh: { lat: 21.2787, lon: 81.8661 },

  // Districts (subset — extend as we add real data)
  Patna: { lat: 25.5941, lon: 85.1376, state: 'Bihar' },
  Nalanda: { lat: 25.1357, lon: 85.4435, state: 'Bihar' },
  Varanasi: { lat: 25.3176, lon: 82.9739, state: 'Uttar Pradesh' },
  Lucknow: { lat: 26.8467, lon: 80.9462, state: 'Uttar Pradesh' },
  Karnal: { lat: 29.6857, lon: 76.9905, state: 'Haryana' },
  Amritsar: { lat: 31.634, lon: 74.8723, state: 'Punjab' },
  Pune: { lat: 18.5204, lon: 73.8567, state: 'Maharashtra' },
  Nashik: { lat: 19.9975, lon: 73.7898, state: 'Maharashtra' },
  Ahmedabad: { lat: 23.0225, lon: 72.5714, state: 'Gujarat' },
  Bengaluru: { lat: 12.9716, lon: 77.5946, state: 'Karnataka' },
  Chennai: { lat: 13.0827, lon: 80.2707, state: 'Tamil Nadu' },
  Indore: { lat: 22.7196, lon: 75.8577, state: 'Madhya Pradesh' },
  Kolkata: { lat: 22.5726, lon: 88.3639, state: 'West Bengal' },
  Jaipur: { lat: 26.9124, lon: 75.7873, state: 'Rajasthan' },
  Hyderabad: { lat: 17.385, lon: 78.4867, state: 'Telangana' },
  Kochi: { lat: 9.9312, lon: 76.2673, state: 'Kerala' },
  Bhubaneswar: { lat: 20.2961, lon: 85.8245, state: 'Odisha' },
  Ranchi: { lat: 23.3441, lon: 85.3096, state: 'Jharkhand' },
  Raipur: { lat: 21.2514, lon: 81.6296, state: 'Chhattisgarh' },
};

const MARKET_HINT = {
  // district -> nearest major market (used as default destination for
  // logistics/decision support when the farmer does not specify one).
  Patna: 'Bazaar Samiti, Patna',
  Nalanda: 'Bazaar Samiti, Patna',
  Varanasi: 'Varanasi Mandi',
  Lucknow: 'Lucknow Mandi',
  Karnal: 'Karnal Mandi',
  Amritsar: 'Amritsar Mandi',
  Pune: 'Pune APMC',
  Nashik: 'Nashik APMC',
  Ahmedabad: 'Ahmedabad APMC',
  Bengaluru: 'Bengaluru APMC',
  Chennai: 'Chennai Koyambedu',
  Indore: 'Indore Mandi',
  Kolkata: 'Kolkata Posta',
  Jaipur: 'Jaipur Mandi',
  Hyderabad: 'Hyderabad Enumamula',
  Kochi: 'Kochi Market',
  Bhubaneswar: 'Bhubaneswar APMC',
  Ranchi: 'Ranchi Mandi',
  Raipur: 'Raipur Mandi',
};

// Per-mandi centroids. Used by logistics/decision-support to compute
// a real distance from the lot's origin to the destination market.
//
// The names mirror the demo MarketPrice seed (Patna Mandi, Bengaluru
// APMC, etc.) so the comparison in the DecisionSupport page is
// meaningful. New mandis can be added here without changing the
// service code.
const MANDI_CENTROIDS = {
  'Bazaar Samiti, Patna': CENTROIDS.Patna,
  'Patna Mandi': CENTROIDS.Patna,
  'Varanasi Mandi': CENTROIDS.Varanasi,
  'Lucknow Mandi': CENTROIDS.Lucknow,
  'Karnal Mandi': CENTROIDS.Karnal,
  'Amritsar Mandi': CENTROIDS.Amritsar,
  'Pune APMC': CENTROIDS.Pune,
  'Nashik APMC': CENTROIDS.Nashik,
  'Lasalgaon': CENTROIDS.Nashik,
  'Agra Mandi': { lat: 27.1767, lon: 78.0081, state: 'Uttar Pradesh' },
  'Ahmedabad APMC': CENTROIDS.Ahmedabad,
  'Azadpur Mandi': { lat: 28.7041, lon: 77.1025, state: 'Delhi' },
  'Bengaluru APMC': CENTROIDS.Bengaluru,
  'Davangere': { lat: 14.4644, lon: 75.9218, state: 'Karnataka' },
  'Chennai Koyambedu': CENTROIDS.Chennai,
  'Indore Mandi': CENTROIDS.Indore,
  'Kolkata Posta': CENTROIDS.Kolkata,
  'Jaipur Mandi': CENTROIDS.Jaipur,
  'Hyderabad Enumamula': CENTROIDS.Hyderabad,
  'Kochi Market': CENTROIDS.Kochi,
  'Bhubaneswar APMC': CENTROIDS.Bhubaneswar,
  'Ranchi Mandi': CENTROIDS.Ranchi,
  'Raipur Mandi': CENTROIDS.Raipur,
  'Mumbai APMC': { lat: 19.076, lon: 72.8777, state: 'Maharashtra' },
  'Delhi Azadpur': { lat: 28.7041, lon: 77.1025, state: 'Delhi' },
};

// Resolve a market name (e.g. "Bengaluru APMC") to a centroid. Falls
// back to the lot's state centroid if the market is unknown — that
// way the distance is still meaningful (state-level) and the
// comparison is non-zero. Returns null only when no location is
// resolvable at all.
function resolveMarketCentroid(marketName, fallback = null) {
  if (!marketName) return fallback;
  if (MANDI_CENTROIDS[marketName]) return MANDI_CENTROIDS[marketName];
  const lower = String(marketName).toLowerCase();
  for (const k of Object.keys(MANDI_CENTROIDS)) {
    if (k.toLowerCase() === lower) return MANDI_CENTROIDS[k];
  }
  for (const k of Object.keys(MANDI_CENTROIDS)) {
    if (k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())) {
      return MANDI_CENTROIDS[k];
    }
  }
  return fallback;
}

function resolveLocation(lat, lon, name) {
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon, name: name || 'Custom location' };
  }
  if (name) {
    // Try exact name first
    if (CENTROIDS[name]) {
      return { lat: CENTROIDS[name].lat, lon: CENTROIDS[name].lon, name };
    }
    // Case-insensitive
    const lower = String(name).toLowerCase();
    for (const k of Object.keys(CENTROIDS)) {
      if (k.toLowerCase() === lower) {
        return { lat: CENTROIDS[k].lat, lon: CENTROIDS[k].lon, name: k };
      }
    }
    // Try the first word ("Patna, Bihar" -> "Patna")
    const first = String(name).split(',')[0].trim();
    if (CENTROIDS[first]) {
      return { lat: CENTROIDS[first].lat, lon: CENTROIDS[first].lon, name: first };
    }
  }
  return null;
}

function haversineKm(a, b) {
  const R = 6371; // km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// -- Phase 5: Geoapify-backed async resolvers ---------------------------
//
// These mirror resolveLocation / resolveMarketCentroid but try the
// static tables first, then fall through to the Geoapify geocoding
// service when no static match exists. The result carries
// `kind: 'static' | 'geocoded'` so downstream code (logistics,
// decision support) can expose the distance provenance in the UI.
//
// Callers that already use the sync resolvers are unchanged. New
// callers in the logistics/decision chain should prefer the async
// versions so unknown markets still get a real road distance
// instead of a state-centroid estimate.

const { geocode } = require('../services/geoapify');

function _shapeStatic(resolved) {
  if (!resolved) return null;
  return {
    lat: resolved.lat,
    lon: resolved.lon,
    name: resolved.name,
    state: resolved.state || null,
    kind: 'static',
  };
}

async function geocodeLocation(lat, lon, name) {
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon, name: name || 'Custom location', state: null, kind: 'latlon' };
  }
  const staticHit = _shapeStatic(resolveLocation(lat, lon, name));
  if (staticHit) {
    // Mark latlon-style static hits (those are exact map points) as
    // 'latlon' for consistency with the logistics classifyOrigin
    // function. State/district-level centroids keep 'static' so the
    // UI can label them as "state-centroid estimate".
    if (Number.isFinite(staticHit.lat) && Number.isFinite(staticHit.lon) && !staticHit.state) {
      // Single-word state centroids in CENTROIDS have no `state`
      // property; district entries do. So a static hit with a state
      // is a district, otherwise a state. We keep both as 'static'
      // — the orchestrator only needs to distinguish geocoded vs
      // static to render the "Road distance" badge correctly.
    }
    return staticHit;
  }
  if (!name) return null;
  const apiHit = await geocode(name);
  if (!apiHit) return null;
  return {
    lat: apiHit.lat,
    lon: apiHit.lon,
    name: apiHit.formatted,
    state: null,
    kind: 'geocoded',
  };
}

async function geocodeMarketCentroid(marketName, fallback = null) {
  if (!marketName) return fallback;
  const staticHit = resolveMarketCentroid(marketName, null);
  if (staticHit) {
    return {
      lat: staticHit.lat,
      lon: staticHit.lon,
      name: marketName,
      state: staticHit.state || null,
      kind: 'static',
    };
  }
  const apiHit = await geocode(marketName);
  if (!apiHit) return fallback;
  return {
    lat: apiHit.lat,
    lon: apiHit.lon,
    name: apiHit.formatted,
    state: null,
    kind: 'geocoded',
  };
}

module.exports = {
  CENTROIDS,
  MARKET_HINT,
  MANDI_CENTROIDS,
  resolveLocation,
  resolveMarketCentroid,
  geocodeLocation,
  geocodeMarketCentroid,
  haversineKm,
};
