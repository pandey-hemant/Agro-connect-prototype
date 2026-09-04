/**
 * services/marketPrice/provider.js — abstract interface.
 *
 * A provider is a function:
 *   async function fetchPrices({crop, state, market, district, timeoutSec, apiKey, resourceId})
 *     → { rows: [{cropName, market, state, district, pricePerQuintal, pricePerKg, arrivalDate, source, isLive, raw}],
 *         note?: string,
 *         is_live: boolean }
 *
 * The service decides which provider to use and handles the fallback
 * policy. Providers must NEVER throw on a network error — return
 * { rows: [], note: '...', is_live: false } instead.
 */
'use strict';

class MarketDataProvider {
  // eslint-disable-next-line no-unused-vars
  async fetch(_opts) {
    throw new Error('MarketDataProvider.fetch must be implemented');
  }
}

module.exports = { MarketDataProvider };
