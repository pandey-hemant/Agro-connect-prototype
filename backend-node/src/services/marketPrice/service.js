/**
 * services/marketPrice/service.js — orchestrator.
 *
 * Chain (Phase 3):
 *   1. If DATA_GOV_IN_API_KEY is set, try the live data.gov.in provider.
 *   2. If the live provider returns 0 rows OR errors, try the CSV
 *      import (if MARKET_PRICE_CSV_PATH is set and readable).
 *   3. If CSV returns 0 rows, fall back to the demo dataset.
 *   4. Always label the response with `is_live` and `source`.
 *   5. Persist non-demo rows in the MarketPrice collection so the
 *      /api/market-prices list endpoint (which reads from Mongo)
 *      returns a consistent view across requests.
 *
 * `is_live` is true ONLY when the live provider returned non-empty
 * rows. CSV rows are `source: 'csv'`, never 'data_gov_in'.
 */
'use strict';

const config = require('../../config');
const MarketPrice = require('../../models/MarketPrice');
const { DataGovInProvider } = require('./dataGovProvider');
const { DemoProvider } = require('./demoProvider');
const { CsvMarketDataProvider } = require('./csvProvider');

const live = new DataGovInProvider();
const csv = new CsvMarketDataProvider({ csvPath: config.marketPriceCsvPath });
const demo = new DemoProvider();

async function listPrices(filters = {}) {
  const useLive = !!config.dataGovInApiKey;
  let primary = useLive
    ? await live.fetch({
        crop: filters.crop,
        state: filters.state,
        market: filters.market,
        district: filters.district,
        timeoutSec: config.marketPriceTimeoutSeconds,
        apiKey: config.dataGovInApiKey,
        resourceId: config.dataGovInResourceId,
      })
    : { rows: [], is_live: false, note: 'DATA_GOV_IN_API_KEY is empty; trying CSV / demo.' };

  let rows = primary.rows;
  let isLive = !!primary.is_live && rows.length > 0;
  let note = primary.note || '';
  let source = isLive ? 'data_gov_in' : null;

  // Try CSV next.
  if (rows.length === 0 && config.marketPriceCsvPath) {
    const csvResult = await csv.fetch(filters);
    if (csvResult.rows.length > 0) {
      rows = csvResult.rows;
      source = 'csv';
      note = csvResult.note || note;
    } else if (csvResult.note) {
      // Carry the CSV note forward so the caller sees the failure
      // even when the demo dataset saves the day.
      note = csvResult.note;
    }
  }

  // Last resort — demo.
  if (rows.length === 0) {
    const fallback = await demo.fetch(filters);
    rows = fallback.rows;
    isLive = false;
    source = 'demo';
    if (!note) note = fallback.note;
    else note = `${note} → demo dataset in use.`;
  }

  // Persist non-demo rows so /api/market-prices (which reads from
  // Mongo) can surface them across requests. CSV upsert key is
  // (cropName, market, priceDate, source: 'csv'); live uses
  // (cropName, market, arrivalDate, source: 'data_gov_in').
  if (source === 'data_gov_in') {
    try {
      for (const r of rows) {
        await MarketPrice.updateOne(
          {
            source: 'data_gov_in',
            cropName: r.cropName,
            state: r.state || '',
            market: r.market || '',
            arrivalDate: r.arrivalDate || '',
            variety: r.variety || '',
          },
          {
            $set: {
              cropName: r.cropName,
              market: r.market,
              state: r.state,
              district: r.district,
              pricePerQuintal: r.pricePerQuintal,
              pricePerKg: r.pricePerKg,
              minPricePerKg: r.minPricePerKg,
              maxPricePerKg: r.maxPricePerKg,
              unit: 'INR/quintal',
              price_unit: r.price_unit || 'INR/quintal',
              arrivalDate: r.arrivalDate,
              priceDate: r.priceDate || r.arrivalDate,
              variety: r.variety || '',
              grade: r.grade || '',
              arrivals: r.arrivals == null ? null : r.arrivals,
              source: 'data_gov_in',
              isLive: true,
              raw: r.raw || null,
            },
          },
          { upsert: true }
        );
      }
    } catch (_) {
      // Persistence failure is non-fatal; the in-memory rows still return.
    }
  } else if (source === 'csv') {
    try {
      for (const r of rows) {
        await MarketPrice.updateOne(
          {
            source: 'csv',
            cropName: r.cropName,
            state: r.state || '',
            market: r.market || '',
            arrivalDate: r.arrivalDate || '',
            variety: r.variety || '',
          },
          {
            $set: {
              cropName: r.cropName,
              market: r.market,
              state: r.state,
              district: r.district,
              pricePerQuintal: r.pricePerQuintal,
              pricePerKg: r.pricePerKg,
              minPricePerKg: r.minPricePerKg,
              maxPricePerKg: r.maxPricePerKg,
              unit: 'INR/quintal',
              price_unit: r.price_unit || 'INR/quintal',
              arrivalDate: r.arrivalDate,
              priceDate: r.priceDate || r.arrivalDate,
              variety: r.variety || '',
              grade: r.grade || '',
              arrivals: r.arrivals == null ? null : r.arrivals,
              source: 'csv',
              isLive: false,
              raw: r.raw || null,
            },
          },
          { upsert: true }
        );
      }
    } catch (_) {
      // Persistence failure is non-fatal.
    }
  }

  return {
    rows,
    is_live: isLive,
    source,
    note:
      note ||
      (isLive
        ? 'Live data.gov.in rows in use.'
        : 'Demo dataset in use.'),
  };
}

async function health() {
  const total = await MarketPrice.countDocuments({});
  const liveCount = await MarketPrice.countDocuments({ source: 'data_gov_in' });
  const csvCount = await MarketPrice.countDocuments({ source: 'csv' });
  const configured = !!config.dataGovInApiKey;
  const csvConfigured = !!config.marketPriceCsvPath;
  return {
    provider_configured: configured,
    provider_name: configured ? 'data_gov_in' : (csvConfigured ? 'csv' : 'demo'),
    csv_configured: csvConfigured,
    csv_count: csvCount,
    is_live: liveCount > 0,
    records: total,
    live_records: liveCount,
    csv_records: csvCount,
    demo_records: total - liveCount - csvCount,
    note: configured
      ? liveCount > 0
        ? 'Live data.gov.in rows are cached. Set DATA_GOV_IN_API_KEY to refresh.'
        : 'DATA_GOV_IN_API_KEY is set but no live rows cached yet. Trigger a fetch to populate.'
      : csvConfigured
        ? 'Using CSV import. Set DATA_GOV_IN_API_KEY for live data.gov.in/AGMARKNET data.'
        : 'DATA_GOV_IN_API_KEY is empty; using the demo dataset. This is expected for the prototype.',
  };
}

module.exports = { listPrices, health };
