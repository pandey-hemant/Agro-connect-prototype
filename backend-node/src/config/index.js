/**
 * config/index.js — env-driven configuration.
 *
 * Reads from process.env (with .env loading) and exposes a frozen
 * `config` object. Numeric fields are coerced; booleans parsed.
 *
 * Anything missing falls back to safe defaults so the server always
 * starts, even on a bare machine with no .env at all.
 */
'use strict';

require('dotenv').config();

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
};
const list = (v, fallback) => {
  if (!v) return fallback;
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const config = Object.freeze({
  port: num(process.env.PORT, 5050),
  mongodbUri: process.env.MONGODB_URI || '',

  // Market prices
  dataGovInApiKey: process.env.DATA_GOV_IN_API_KEY || '',
  dataGovInResourceId:
    process.env.DATA_GOV_IN_RESOURCE_ID ||
    '9ef84268-d588-465a-a308-a864a43d0070',
  marketPriceDemoFallback: bool(process.env.MARKET_PRICE_DEMO_FALLBACK, true),
  marketPriceTimeoutSeconds: num(process.env.MARKET_PRICE_TIMEOUT_SECONDS, 8),
  marketPriceCsvPath: process.env.MARKET_PRICE_CSV_PATH || '',

  // Maps / routing
  mapsApiKey: process.env.MAPS_API_KEY || '',
  routingApiKey: process.env.ROUTING_API_KEY || '',
  routingUrl:
    process.env.ROUTING_URL || 'https://router.project-osrm.org/route/v1/driving/',
  geoapifyApiKey: process.env.GEOAPIFY_API_KEY || '',

  // Phase 3 — fixed vehicle-rate table (₹/km, Indian small-truck classes).
  // Frozen so no caller can mutate at runtime. Reference values; not
  // fuel-indexed. Caller can override per call by sending `vehicle_type`
  // in the estimate body.
  vehicleRates: Object.freeze({
    '32FT_MXL': 71.69,
    '32FT_SXL': 54.71,
    '24FT': 39.62,
    '22FT': 41.50,
    '20FT': 36.79,
    '19FT_OPEN': 54.71,
  }),

  // Phase 3 — other costs per kg (mandi cess, weighing, commission).
  // 0 by default. Operator-overridable. NEVER fabricated market data.
  otherCostsPerKg: num(process.env.OTHER_COSTS_PER_KG, 0),

  // Phase 3 — NHB scheme citation. Reference only, not a tariff.
  nhbScheme: Object.freeze({
    name: 'NHB — Capital Investment Subsidy Scheme for Cold Storage',
    citation_url: 'https://nhb.gov.in/',
    note: 'Scheme reference for cold-storage eligibility; not a current tariff.',
  }),

  // Logistics
  logistics: {
    transportRatePerKmPerKg: num(process.env.LOGISTICS_TRANSPORT_RATE_PER_KM_PER_KG, 0.0015),
    minTransport: num(process.env.LOGISTICS_MIN_TRANSPORT, 300),
    loadingPerKg: num(process.env.LOGISTICS_LOADING_PER_KG, 0.05),
    unloadingPerKg: num(process.env.LOGISTICS_UNLOADING_PER_KG, 0.05),
    otherChargesPct: num(process.env.LOGISTICS_OTHER_CHARGES_PCT, 0.02),
    avgSpeedKmph: num(process.env.LOGISTICS_AVG_SPEED_KMPH, 40),
    // Phase 3 — 20FT is the new default (was 'mini-truck').
    // Operators can still override via LOGISTICS_DEFAULT_VEHICLE env.
    defaultVehicle: process.env.LOGISTICS_DEFAULT_VEHICLE || '20FT',
    // 5-tonne-per-vehicle floor for num_vehicles math.
    vehicleCapacityKg: num(process.env.LOGISTICS_VEHICLE_CAPACITY_KG, 5000),
  },

  // Feature B — deal verification weight tolerance (%).
  // 2% by default; a buyer-measured weight within ±2% of the
  // declared weight auto-resolves to VERIFIED. Outside that band,
  // a discrepancy is recorded and the parties must resolve.
  weight_tolerance_pct: num(process.env.WEIGHT_TOLERANCE_PCT, 2.0),

  // Feature C/D — storage economics for the WAIT panel.
  // Default wastage + storage uplift used to compute the break-even
  // future price. Tunable; not "national rate" — purely the
  // configurable per-kg assumption.
  storage: {
    default_wastage_pct: num(process.env.STORAGE_DEFAULT_WASTAGE_PCT, 3.0),
    default_uplift_pct: num(process.env.STORAGE_DEFAULT_UPLIFT_PCT, 5.0),
    default_daily_uplift_pct: num(process.env.STORAGE_DEFAULT_DAILY_UPLIFT_PCT, 0.1),
  },

  // CORS
  corsOrigins: list(process.env.CORS_ORIGINS, [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
  ]),

  // Seed
  runSeedOnStartup: bool(process.env.RUN_SEED_ON_STARTUP, true),
});

module.exports = config;
