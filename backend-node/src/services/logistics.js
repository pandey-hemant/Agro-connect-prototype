/**
 * services/logistics.js — estimate per-lot logistics cost and net
 * realization. Mirrors the Python implementation.
 *
 *   estimate_for_lot(lot, opts) →
 *     { distance_km, transport_cost, loading_cost, unloading_cost,
 *       other_charges, total_logistics_cost, gross_value,
 *       net_realization, net_realization_per_kg, is_estimate, … }
 *
 * Distance (Phase 3 — chain extended):
 *   1. If ROUTING_API_KEY is set, hit the configured OSRM-style URL
 *      with bearer auth. Provider = 'osrm'.
 *   2. Else if GEOAPIFY_API_KEY is set, hit the Geoapify Routing
 *      API. Provider = 'geoapify'.
 *   3. Else haversine. Provider = 'haversine'.
 *
 * Cost model (Phase 3 — vehicle-rate table):
 *   vehicle_type        ← opts.vehicle_type || config.logistics.defaultVehicle
 *   rate_per_km         ← config.vehicleRates[vehicle_type] ?? 36.79 (20FT default)
 *   num_vehicles        ← max(1, ceil(qty_kg / vehicleCapacityKg))
 *   transport           ← max(min_transport, rate_per_km * km * num_vehicles)
 *   loading             ← qty_kg * loading_per_kg
 *   unloading           ← qty_kg * unloading_per_kg
 *   other_charges       ← gross * other_charges_pct
 *   other_costs         ← qty_kg * OTHER_COSTS_PER_KG
 *   total               ← transport + loading + unloading + other_charges + other_costs
 *   gross               ← agreed_price_per_kg * qty_kg
 *   net                 ← gross - total
 *
 * Every numeric is rounded to 2dp. None are NaN — missing inputs
 * become 0 (or null on a known-missing field).
 */
'use strict';

const axios = require('axios');
const config = require('../config');
const {
  resolveLocation,
  haversineKm,
  MARKET_HINT,
  MANDI_CENTROIDS,
  resolveMarketCentroid,
  geocodeLocation,
  geocodeMarketCentroid,
  CENTROIDS,
} = require('../utils/geo');
const { toKg } = require('../utils/units');

const RATE = config.logistics;

// Phase 3 — known vehicle keys. Anything else falls back to 20FT.
const FALLBACK_VEHICLE_RATE = config.vehicleRates['20FT'] || 36.79;

// In-process distance cache. Keyed on (origin, dest) rounded to 3
// decimal places (~110 m) so trivial floating-point drift doesn't
// bust the cache. Bounded to DISTANCE_CACHE_MAX entries with FIFO
// eviction. The first /decisions call populates it; subsequent
// calls (multi-lot dashboards, repeated lookups, retries) are
// served from cache and skip the network round-trip.
const DISTANCE_CACHE_MAX = Math.max(
  16,
  Number(process.env.LOGISTICS_DISTANCE_CACHE_MAX || 4096)
);
const distanceCache = new Map(); // key -> { km, provider }

function distanceKey(a, b) {
  // round to 3 dp ≈ 110 m at the equator — plenty of resolution
  // for "do these two coords mean the same place" while absorbing
  // float jitter from the geocoder.
  const round = (n) => Math.round(Number(n) * 1000) / 1000;
  return `${round(a.lat)},${round(a.lon)}->${round(b.lat)},${round(b.lon)}`;
}

function distanceCacheGet(key) {
  return distanceCache.get(key);
}

function distanceCacheSet(key, value) {
  if (distanceCache.size >= DISTANCE_CACHE_MAX) {
    // FIFO eviction: drop the oldest key. Map iteration is
    // insertion-order, so the first key is the oldest.
    const firstKey = distanceCache.keys().next().value;
    if (firstKey !== undefined) distanceCache.delete(firstKey);
  }
  distanceCache.set(key, value);
}

function getVehicleRate(vehicleType) {
  if (vehicleType && config.vehicleRates[vehicleType] != null) {
    return { rate: config.vehicleRates[vehicleType], vehicle: vehicleType };
  }
  return { rate: FALLBACK_VEHICLE_RATE, vehicle: '20FT' };
}

async function getDistanceKm(origin, dest) {
  // 0) In-process cache. The same (origin, dest) pair is requested
  // many times across /decisions, multi-lot dashboards, and the
  // route-rerun path. The geocoder and routing API both take ~1s
  // per call; the cache collapses repeat lookups to < 1ms.
  const cacheKey = distanceKey(origin, dest);
  const cached = distanceCacheGet(cacheKey);
  if (cached) return cached;

  // Helper: remember a successful result so the next call with the
  // same (origin, dest) skips the network. We only cache positive
  // results so transient network errors can be retried naturally.
  const remember = (value) => {
    distanceCacheSet(cacheKey, value);
    return value;
  };

  // 1) OSRM-style with bearer auth.
  if (config.routingApiKey) {
    try {
      const url = config.routingUrl;
      const coords = `${origin.lon},${origin.lat};${dest.lon},${dest.lat}`;
      const full = `${url}${coords}?overview=false`;
      const resp = await axios.get(full, {
        timeout: Math.max(2000, config.marketPriceTimeoutSeconds * 1000),
        headers: { Authorization: `Bearer ${config.routingApiKey}` },
        validateStatus: (s) => s >= 200 && s < 300,
      });
      if (resp.data && resp.data.routes && resp.data.routes[0]) {
        const meters = resp.data.routes[0].distance;
        if (typeof meters === 'number' && meters > 0) {
          return remember({ km: meters / 1000, provider: 'osrm' });
        }
      }
    } catch (err) {
      // fall through to next provider
    }
  }
  // 2) Geoapify.
  if (config.geoapifyApiKey) {
    try {
      const url = 'https://api.geoapify.com/v1/routing';
      const waypoints = `${origin.lat},${origin.lon}|${dest.lat},${dest.lon}`;
      const resp = await axios.get(url, {
        timeout: Math.max(2000, config.marketPriceTimeoutSeconds * 1000),
        params: { waypoints, mode: 'drive', apiKey: config.geoapifyApiKey },
        validateStatus: (s) => s >= 200 && s < 300,
      });
      const features = resp.data && resp.data.features;
      if (Array.isArray(features) && features.length > 0) {
        const meters = features[0].properties && features[0].properties.distance;
        if (typeof meters === 'number' && meters > 0) {
          return remember({ km: meters / 1000, provider: 'geoapify' });
        }
      }
    } catch (err) {
      // fall through to haversine
    }
  }
  // 3) Haversine fallback.
  return remember({ km: haversineKm(origin, dest), provider: 'haversine' });
}

async function estimateForLot(lot, opts = {}) {
  // Phase 5 — try the async geocoder first (static centroids +
  // Geoapify). Only fall back to the sync resolver if the lot
  // doesn't have lat/lon AND the geocoder couldn't resolve a name,
  // in which case the legacy behaviour (state-centroid estimate)
  // kicks in.
  let origin = await geocodeLocation(lot.lat, lot.lon, lot.location);
  let originKindFromResolve = null;
  if (!origin) {
    origin = resolveLocation(lot.lat, lot.lon, lot.location);
    originKindFromResolve = 'legacy_static';
  }
  if (!origin) {
    throw new Error(
      `Cannot resolve origin location for lot ${lot.publicId || lot._id}: ${lot.location}`
    );
  }
  const marketName = opts.market_name || opts.destination_market || MARKET_HINT[origin.name];
  if (!marketName) {
    throw new Error(`No market_name provided and no market hint for ${origin.name}`);
  }
  // Phase 5 — same fall-through for the destination. Static mandi
  // centroids win, then Geoapify, then the lot's state centroid
  // (so a truly unknown market still produces a meaningful,
  // labelled "estimated" distance rather than a 4xx).
  let mandi = await geocodeMarketCentroid(marketName, null);
  if (!mandi) mandi = resolveMarketCentroid(marketName, null);
  const fallback =
    (lot.state && CENTROIDS[lot.state]) ||
    CENTROIDS[origin.name] ||
    origin;
  const dest = mandi || fallback;
  const destinationLabel = mandi
    ? (opts.destination_label || marketName)
    : (opts.destination_label || (lot.state || origin.name));

  const { km, provider } = await getDistanceKm(origin, dest);
  // Phase 4 — origin-kind tag. The UI must show "Estimated
  // (state-centroid)" when the lot's location only resolved to a
  // state capital, not an actual lat/lon. Without this, the same
  // great-circle number reads like a routed distance and looks
  // misleading (e.g. 1318 km Patna->Nashik shown as "Distance").
  const originKind = classifyOrigin(lot, origin, originKindFromResolve);
  const destinationKind = mandi ? (mandi.kind === 'geocoded' ? 'geocoded' : 'mandi') : 'state';
  // is_routed: true for OSRM/Geoapify, false for haversine. Lets
  // the UI label the row as "Routed" vs "Estimated (straight-line)".
  const isRouted = provider === 'osrm' || provider === 'geoapify';
  const qtyKgRaw = toKg(lot.quantity, lot.quantity_unit);
  const qtyKg = Number.isFinite(qtyKgRaw) && qtyKgRaw >= 0
    ? qtyKgRaw
    : Number(lot.quantity || 0) || 0;
  const pricePerKg = Number(opts.agreed_price_per_kg || lot.expectedPricePerKg || 0);
  const gross = pricePerKg * qtyKg;

  // Phase 3 — vehicle rate model.
  const requested = opts.vehicle_type || RATE.defaultVehicle;
  const { rate: ratePerKm, vehicle } = getVehicleRate(requested);
  const numVehicles = Math.max(1, Math.ceil(qtyKg / Math.max(1, RATE.vehicleCapacityKg)));
  const rawTransport = ratePerKm * km * numVehicles;
  const transport = Math.max(RATE.minTransport, rawTransport);

  const loading = qtyKg * RATE.loadingPerKg;
  const unloading = qtyKg * RATE.unloadingPerKg;
  const otherCharges = gross * RATE.otherChargesPct;
  // Phase 3 — farmer-supplied "other costs" line (mandi cess,
  // weighing, commission). 0 by default. Never NaN.
  const otherCostsPerKg = Number(config.otherCostsPerKg || 0);
  const totalOtherCosts = qtyKg * otherCostsPerKg;

  const total = transport + loading + unloading + otherCharges + totalOtherCosts;
  const net = gross - total;
  const netPerKg = qtyKg > 0 ? net / qtyKg : 0;

  return {
    market_name: marketName,
    destination_label: destinationLabel,
    market_lat: dest.lat,
    market_lon: dest.lon,
    distance_km: round2(km),
    transport_cost: round2(transport),
    loading_cost: round2(loading),
    unloading_cost: round2(unloading),
    other_charges: round2(otherCharges),
    other_costs_per_kg: round2(otherCostsPerKg),
    total_other_costs: round2(totalOtherCosts),
    total_logistics_cost: round2(total),
    gross_value: round2(gross),
    net_realization: round2(net),
    net_realization_per_kg: round2(netPerKg),
    is_estimate: true,
    routing_provider: provider,
    distance_provider: provider, // Phase 3 — alias
    // Phase 4 — distance provenance. Lets the UI distinguish
    // "Routed" (OSRM/Geoapify) from "Estimated (haversine)" and
    // also surface the origin kind so a 1318 km Patna->Nashik row
    // is clearly labelled "Estimated (state-centroid)" instead of
    // reading like a road distance.
    is_routed: isRouted,
    origin_kind: originKind,           // 'latlon' | 'district' | 'state' | 'unknown'
    destination_kind: destinationKind, // 'mandi' | 'state'
    origin_label: origin.name || lot.location || null,
    destination_label_full: destinationLabel,
    vehicle: vehicle,
    vehicle_type: vehicle,
    vehicle_rate_per_km: round2(ratePerKm),
    num_vehicles: numVehicles,
    avg_speed_kmph: RATE.avgSpeedKmph,
    estimated_transit_hours:
      km > 0 && RATE.avgSpeedKmph > 0 ? round2(km / RATE.avgSpeedKmph) : 0,
  };
}

/**
 * Phase 4 — classify the origin's resolution. The UI uses this to
 * label the row source:
 *   - 'latlon'    : the lot has both lat + lon; the dot is the
 *                   actual point on the map. Also returned for
 *                   Phase 5 geocoded origins — the Geoapify-returned
 *                   lat/lon IS the actual point on the map.
 *   - 'district'  : the lot only has a name that resolved to a
 *                   district centroid (e.g. "Nashik" -> Nashik
 *                   district centroid). This is the typical case
 *                   for fresh lots and a reasonable approximation.
 *   - 'state'     : the lot only has a state name (e.g. "Bihar").
 *                   The distance is great-circle from the state
 *                   capital — large error bars, must be labelled.
 *   - 'unknown'   : shouldn't happen because resolveLocation
 *                   returns null in that case (estimateForLot
 *                   throws before getting here).
 */
function classifyOrigin(lot, origin, originKindFromResolve) {
  // Phase 5 — origin came from the async geocoder. The shape
  // includes a `kind` field ('latlon', 'static', or 'geocoded').
  if (originKindFromResolve !== 'legacy_static' && origin && origin.kind) {
    if (origin.kind === 'latlon' || origin.kind === 'geocoded') return 'latlon';
    if (origin.kind === 'static' && origin.state) return 'district';
    if (origin.kind === 'static') return 'state';
  }
  if (
    lot != null &&
    Number.isFinite(Number(lot.lat)) &&
    Number.isFinite(Number(lot.lon))
  ) {
    return 'latlon';
  }
  if (origin && origin.name) {
    // District centroids are entries with a `.state` field (those
    // are district rows, see utils/geo.js). State capitals are
    // top-level CENTROIDS entries without a `.state` field.
    const c = CENTROIDS[origin.name];
    if (c && c.state) return 'district';
    if (c) return 'state';
  }
  return 'unknown';
}

function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

module.exports = { estimateForLot, getDistanceKm, getVehicleRate };
