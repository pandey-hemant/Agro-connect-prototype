/**
 * services/marketPrice/demoProvider.js — always returns the seed dataset.
 *
 * Used when no API key is configured, or as a fallback when the live
 * provider fails. Always sets is_live: false and source: 'demo'.
 */
'use strict';

const { MarketDataProvider } = require('./provider');
const { DEMO_MARKET_PRICES } = require('../seedDemo');

class DemoProvider extends MarketDataProvider {
  async fetch({ crop, state, market, district } = {}) {
    let rows = [...DEMO_MARKET_PRICES];
    if (crop) rows = rows.filter((r) => r.cropName.toLowerCase() === String(crop).toLowerCase());
    if (state) rows = rows.filter((r) => r.state.toLowerCase() === String(state).toLowerCase());
    if (market) rows = rows.filter((r) => r.market.toLowerCase().includes(String(market).toLowerCase()));
    if (district) rows = rows.filter((r) => r.district.toLowerCase() === String(district).toLowerCase());
    return {
      rows: rows.map((r) => ({
        cropName: r.cropName,
        market: r.market,
        state: r.state,
        district: r.district,
        pricePerQuintal: r.pricePerQuintal,
        pricePerKg: r.pricePerKg,
        // AGMARKNET's standard dataset only emits modal_price; we
        // default min/max to the same value so the wire shape matches.
        minPricePerKg: r.pricePerKg,
        maxPricePerKg: r.pricePerKg,
        // Phase 3 — every demo row needs a priceDate/arrivalDate for
        // the history aggregator to be useful out of the box.
        arrivalDate: r.arrivalDate || '2026-08-29',
        priceDate: r.priceDate || r.arrivalDate || '2026-08-29',
        // Phase 5 — provenance fields.
        price_unit: 'INR/quintal',
        variety: '',
        grade: '',
        arrivals: null,
        source: 'demo',
        isLive: false,
        raw: null,
      })),
      is_live: false,
      note: 'Demo dataset (12 commodity/region rows). Set DATA_GOV_IN_API_KEY for live data.gov.in/AGMARKNET data.',
    };
  }
}

module.exports = { DemoProvider };
