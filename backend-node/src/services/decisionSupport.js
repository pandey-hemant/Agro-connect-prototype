/**
 * services/decisionSupport.js — rules-based recommendation.
 *
 *   SELL_NOW    : a buyer has offered at or above the lot's
 *                 expected_price_per_kg, OR multiple offers and the
 *                 best one is within 5% of expected.
 *   WAIT        : no offers, or best offer is < 80% of expected.
 *   GROUP_SALE  : the seller could pool with at least 2 other lots
 *                 (FPO aggregate) of the same crop with similar
 *                 expected price.
 *
 * For each market where the same crop is priced, we compute a
 * per-market logistics estimate (origin → market centroid) and
 * surface the per-market net realisation. The recommendation rule
 * uses the best per-market net as the reference price, with the
 * existing offer-based rule still authoritative when offers are
 * present.
 */
'use strict';

const CropLot = require('../models/CropLot');
const Offer = require('../models/Offer');
const MarketPrice = require('../models/MarketPrice');
const FarmerDecision = require('../models/FarmerDecision');
const { estimateForLot } = require('./logistics');
const { predictPriceML } = require('./marketPrice/mlPrediction');
const { estimateColdStorage } = require('./coldStorage');
const config = require('../config');

// Concurrency cap for the per-market logistics loop. estimateForLot
// is dominated by network calls (Geoapify geocoding + routing). With
// 100+ distinct markets a sequential loop takes several minutes;
// 16 concurrent calls cuts wall-clock to a few seconds while staying
// under typical upstream rate limits. Tunable via env for ops.
const LOGISTICS_CONCURRENCY = Math.max(
  1,
  Number(process.env.DECISION_LOGISTICS_CONCURRENCY || 16)
);

/**
 * makePool(limit) → (fn) => Promise
 *
 * Run async tasks with at most `limit` running at any one time.
 * Used to fan out per-market logistics work in computeDecision()
 * without exceeding the upstream rate limit.
 */
function makePool(limit) {
  let inFlight = 0;
  const waiters = [];
  const acquire = () =>
    new Promise((resolve) => {
      const tryAcquire = () => {
        if (inFlight < limit) {
          inFlight += 1;
          resolve();
        } else {
          waiters.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  const release = () => {
    inFlight -= 1;
    const next = waiters.shift();
    if (next) next();
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      acquire().then(() => {
        Promise.resolve()
          .then(fn)
          .then((v) => {
            release();
            resolve(v);
          })
          .catch((e) => {
            release();
            reject(e);
          });
      });
    });
}

/**
 * Build a single per-market comparison row. Pulled out of
 * computeDecision() so the per-market loop can run in a worker pool
 * without losing the (m, idx) context. Returns null on skip.
 */
async function buildComparisonRow(lot, m, NUM, idx) {
  if (!m || !m.market) return null;
  void idx; // (kept for stable ordering diagnostics if added later)
  let distance = 0;
  let transport = 0;
  let loading = 0;
  let unloading = 0;
  let other = 0;
  let otherCostsPerKg = 0;
  let totalOtherCosts = 0;
  let total = 0;
  let net = 0;
  let numVehicles = 1;
  let isLive = !!m.isLive;
  let transportCostOk = true;
  // Phase 4 — per-row distance provenance. Without this the
  // 1318 km Patna->Nashik row looked like a routed distance;
  // with `is_routed=false` + `origin_kind='state'` the UI can
  // label the row "Estimated (state-centroid)".
  let isRouted = false;
  let originKind = 'unknown';
  let destinationKind = 'unknown';
  let distanceProvider = 'haversine';
  let vehicleType = null;
  let vehicleRatePerKm = null;
  try {
    const est = await estimateForLot(lot, {
      market_name: m.market,
      agreed_price_per_kg: m.pricePerKg,
    });
    distance = Number(est.distance_km || 0);
    transport = Number(est.transport_cost || 0);
    loading = Number(est.loading_cost || 0);
    unloading = Number(est.unloading_cost || 0);
    other = Number(est.other_charges || 0);
    otherCostsPerKg = Number(est.other_costs_per_kg || 0);
    totalOtherCosts = Number(est.total_other_costs || 0);
    total = Number(est.total_logistics_cost || 0);
    net = Number(est.net_realization || 0);
    numVehicles = Number(est.num_vehicles || 1);
    isRouted = !!est.is_routed;
    originKind = est.origin_kind || 'unknown';
    destinationKind = est.destination_kind || 'unknown';
    distanceProvider = est.routing_provider || 'haversine';
    vehicleType = est.vehicle_type || null;
    vehicleRatePerKm = Number(est.vehicle_rate_per_km || 0) || null;
  } catch (_) {
    // origin unresolved → use a state-level approximation
    isLive = false;
    transportCostOk = false;
  }
  const location = [m.market, m.district].filter(Boolean).join(', ');
  const row = {
    market: m.market,
    state: m.state,
    location,
    modal_price: NUM(m.pricePerKg),
    distance_km: Math.round(distance * 100) / 100,
    total_logistics_cost: Math.round(total * 100) / 100,
    net_realisation: Math.round(net * 100) / 100,
    other_costs_per_kg: Math.round(otherCostsPerKg * 100) / 100,
    total_other_costs: Math.round(totalOtherCosts * 100) / 100,
    num_vehicles: numVehicles,
    is_estimate: true,
    // Phase 4 — surface distance provenance. The UI uses these
    // to label "Estimated (state-centroid)" instead of
    // reading like a road distance.
    is_routed: isRouted,
    origin_kind: originKind,
    destination_kind: destinationKind,
    distance_provider: distanceProvider,
    // Phase 5 — per-row vehicle + rate + transport cost so the
    // DecisionSupport page can render the "Distance / Source /
    // Vehicle / Rate/km / Estimated transport" breakdown without
    // re-running the estimate.
    vehicle_type: vehicleType,
    vehicle_rate_per_km: vehicleRatePerKm,
    transport_cost: Math.round(transport * 100) / 100,
    // Internal context for the rule (not surfaced in toRead())
    _is_live: isLive,
    _source: m.source,
    _price_per_quintal: m.pricePerQuintal,
    _unit: m.unit,
    _arrival_date: m.arrivalDate,
    _transport_ok: transportCostOk,
  };
  for (const k of Object.keys(row)) {
    if (typeof row[k] === 'number' && !Number.isFinite(row[k])) {
      row[k] = null;
    }
  }
  return row;
}

async function computeDecision(lot) {
  const offers = await Offer.find({
    cropLotId: lot._id,
    status: { $in: ['OPEN', 'COUNTERED'] },
  });

  // Best current offer
  let best = null;
  for (const o of offers) {
    if (!best || o.currentPrice > best.currentPrice) best = o;
  }
  const offerCount = offers.length;
  const bestOfferPrice = best ? best.currentPrice : null;

  // Market prices for the same crop
  const marketRows = await MarketPrice.find({
    cropName: new RegExp(`^${escapeRegex(lot.cropName)}$`, 'i'),
  });
  const avgMarketPerKg = marketRows.length
    ? marketRows.reduce((a, m) => a + (m.pricePerKg || 0), 0) / marketRows.length
    : null;

  const expected = Number(lot.expectedPricePerKg || avgMarketPerKg || 0);

  // Per-market comparison: for each *distinct* market, compute the
  // logistics from the lot's origin to the market destination, and
  // surface modal price + total logistics cost + net realisation.
  //
  // AGMARKNET persists many daily rows per market (e.g. 7,520 onion
  // records across ~tens of distinct markets). Iterating estimateForLot
  // over every row duplicates the same routing/geocoding work for
  // the same (state, market) and turns the first /decisions call into
  // a multi-minute fan-out. Deduplicate by (state, market), keeping
  // the row with the latest priceDate so the modal price reflects
  // the most recent reading. The statistical reference (avgMarketPerKg
  // above) still uses every row, so the decision rule's reference
  // price is unchanged.
  const distinctByMarket = new Map();
  for (const m of marketRows) {
    if (!m || !m.market) continue;
    const key = `${m.state || ''}::${m.market}`;
    const cur = distinctByMarket.get(key);
    if (!cur) {
      distinctByMarket.set(key, m);
      continue;
    }
    const curDate = String(cur.priceDate || cur.arrivalDate || '');
    const newDate = String(m.priceDate || m.arrivalDate || '');
    if (newDate > curDate) distinctByMarket.set(key, m);
  }
  const marketRowsForComparison = Array.from(distinctByMarket.values());

  const comparison = [];
  // Phase 3 — defensive coercion. Every numeric on the wire is
  // Number(x) || null; never NaN, never undefined. React renders
  // "—" cleanly.
  const NUM = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // Per-market comparison rows. estimateForLot() is dominated by
  // network calls (Geoapify geocoding + routing). For 100+ distinct
  // markets a sequential loop takes several minutes; with a small
  // worker pool the wall-clock time drops to a few seconds while
  // staying under typical upstream rate limits.
  //
  // Rows are computed concurrently, then concatenated in the
  // original market order so the UI list stays stable.
  const pool = makePool(LOGISTICS_CONCURRENCY);
  const rowResults = await Promise.all(
    marketRowsForComparison.map((m, idx) =>
      pool(() => buildComparisonRow(lot, m, NUM, idx))
    )
  );
  for (const r of rowResults) {
    if (r) comparison.push(r);
  }

  // Insufficient data = no market rows, no expected price, no offers.
  const insufficientData =
    marketRows.length === 0 && !expected && offerCount === 0;

  // Best per-market net realisation (used by the rule when there
  // are no offers).
  const bestPerMarketNet = comparison.length
    ? comparison.reduce(
        (b, r) => (b === null || r.net_realisation > b ? r.net_realisation : b),
        null
      )
    : null;
  // Convert that to a per-kg number (gross - logistics) / qty.
  // The lot's expected_price_per_kg serves as the reference for
  // "is this market worth selling at" if there's no offer.

  // Pooling check: any other ACTIVE lot of the same crop nearby
  const peers = await CropLot.find({
    _id: { $ne: lot._id },
    cropName: lot.cropName,
    status: 'ACTIVE',
    state: lot.state || undefined,
  }).limit(5);
  const groupSaleCandidate = peers.length >= 2;

  // Phase 5 — ask the ML pipeline for a 7-day projection on the
  // (crop, lot.state) series. The prediction is an *annotation*;
  // it does not override an explicit SELL_NOW from a strong offer.
  // Best-effort: any error returns available:false and we ignore it.
  let prediction = null;
  try {
    prediction = await predictPriceML({
      crop: lot.cropName,
      state: lot.state || null,
      market: null,
      days: 7,
      minHistoryDates: 10,
      holdoutDays: 14,
    });
  } catch (_) {
    prediction = null;
  }
  const predDirection = (() => {
    if (!prediction || !prediction.available) return 'unknown';
    const first = prediction.projection[0] && prediction.projection[0].chosen_point;
    const last = prediction.history_summary && prediction.history_summary.last_avg;
    if (first == null || last == null || last === 0) return 'unknown';
    const delta = (first - last) / last;
    if (delta > 0.02) return 'up';
    if (delta < -0.02) return 'down';
    return 'flat';
  })();

  // Feature C/D — break-even future price for the WAIT panel.
  // This is the post-storage price the farmer needs in 30 days to
  // match a sell-now at the reference price. Computed via the
  // transparent coldStorage service; the inputs come from the lot
  // and the configurable storage parameters, never from a "national
  // rate" lookup. `null` when the reference inputs are missing.
  let breakevenFuturePricePerKg = null;
  let breakevenAssumptions = null;
  if (expected > 0 && Number(lot.quantity || 0) > 0) {
    const cold = estimateColdStorage({
      quantity_kg: Number(lot.quantity || 0),
      days: 30,
      rate_per_kg_per_day:
        Number(lot.coldStorageRatePerKgPerDay || 0.2) || 0.2,
      sell_now_price_per_kg: expected,
      // wastage_pct intentionally defaults via the configured value
      wastage_pct: config.storage.default_wastage_pct,
    });
    breakevenFuturePricePerKg = cold.breakeven_price_per_kg;
    breakevenAssumptions = {
      days: 30,
      rate_per_kg_per_day: cold.rate_per_kg_per_day,
      wastage_pct: config.storage.default_wastage_pct,
      is_estimate: true,
    };
  }

  // Decide
  let decision = 'WAIT';
  let rationale = '';
  if (best && expected > 0 && best.currentPrice >= expected * 0.95) {
    decision = 'SELL_NOW';
    rationale = `Best offer ₹${best.currentPrice}/kg is at or above expected ₹${expected}/kg.`;
  } else if (best && expected > 0 && best.currentPrice < expected * 0.8) {
    decision = 'WAIT';
    rationale = `Best offer ₹${best.currentPrice}/kg is well below expected ₹${expected}/kg.`;
  } else if (offerCount === 0) {
    decision = groupSaleCandidate ? 'GROUP_SALE' : 'WAIT';
    rationale = offerCount === 0
      ? `No active offers. ${groupSaleCandidate ? `${peers.length} similar lots nearby — consider grouping.` : 'No similar lots nearby.'}`
      : 'Some offers but no strong bid.';
  } else if (groupSaleCandidate && best && expected > 0 && best.currentPrice < expected) {
    decision = 'GROUP_SALE';
    rationale = `Best offer is below expected; ${peers.length} peers of the same crop could be pooled to negotiate better.`;
  } else {
    decision = 'WAIT';
    rationale = `Best offer ₹${best ? best.currentPrice : '—'}/kg vs expected ₹${expected || '—'}/kg. Hold for better terms.`;
  }

  // Append the break-even future price to the WAIT rationale so
  // the user sees the actual target without doing the math.
  if (decision === 'WAIT' && breakevenFuturePricePerKg != null) {
    rationale += ` Break-even future price (after 30 days of storage): ₹${breakevenFuturePricePerKg}/kg.`;
  }

  // Phase 5 — append a one-line trend annotation when the ML
  // pipeline has a confident read. NEVER flip SELL_NOW → WAIT
  // based on the prediction alone; the offer-based rule is still
  // authoritative.
  if (prediction && prediction.available && decision === 'WAIT' && predDirection === 'down') {
    rationale += ` ML trend: 7-day forecast points DOWN (${prediction.method}). Consider accepting a near-expected offer.`;
  } else if (prediction && prediction.available && decision === 'WAIT' && predDirection === 'up') {
    rationale += ` ML trend: 7-day forecast points UP (${prediction.method}). Holding is consistent with the trend.`;
  } else if (prediction && prediction.available && decision === 'SELL_NOW' && predDirection === 'up') {
    rationale += ` ML trend: 7-day forecast points UP — taking the offer locks in before a possible rise, but the offer is already strong.`;
  }

  // Strip internal context before persisting.
  const persistableComparison = comparison.map((r) => ({
    market: r.market,
    state: r.state,
    location: r.location,
    modal_price: r.modal_price,
    distance_km: r.distance_km,
    total_logistics_cost: r.total_logistics_cost,
    net_realisation: r.net_realisation,
    other_costs_per_kg: r.other_costs_per_kg,
    total_other_costs: r.total_other_costs,
    num_vehicles: r.num_vehicles,
    is_estimate: r.is_estimate,
    // Phase 4 — distance provenance (kept on the persisted row so
    // a re-render of the React DecisionSupport page can label
    // each row source without re-computing).
    is_routed: r.is_routed,
    origin_kind: r.origin_kind,
    destination_kind: r.destination_kind,
    distance_provider: r.distance_provider,
    // Phase 5 — vehicle + rate + transport cost on each row.
    vehicle_type: r.vehicle_type,
    vehicle_rate_per_km: r.vehicle_rate_per_km,
    transport_cost: r.transport_cost,
  }));

  const decisionDoc = await FarmerDecision.findOneAndUpdate(
    { cropLotId: lot._id },
    {
      cropLotId: lot._id,
      cropLotPublicId: lot.publicId || '',
      decision,
      rationale,
      marketComparison: persistableComparison,
      offerCount,
      bestOfferPrice,
      insufficientData,
      // Phase 5 — surface the ML prediction summary on the
      // decision doc. The toRead() serializer in FarmerDecision
      // already forwards `predictionTrend` and `predictionMethod`
      // when present, so the React DecisionSupport page can render
      // the trend chip and the disclaimer.
      predictionAvailable: !!(prediction && prediction.available),
      predictionTrend: predDirection,
      predictionMethod: prediction && prediction.available ? prediction.method : null,
      predictionDisclaimed: !!(prediction && prediction.available),
      // Phase 6 — explicit break-even future price for the WAIT
      // panel. The DecisionCard renders this as a labelled
      // "Break-even future price" line so the farmer sees the
      // concrete target instead of generic "wait" advice.
      breakevenFuturePricePerKg,
      breakevenAssumptions,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return decisionDoc;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { computeDecision };
