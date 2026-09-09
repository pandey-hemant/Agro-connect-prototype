/**
 * services/marketPrice/dataGovProvider.js — live data.gov.in/AGMARKNET
 * provider. Uses the standard data.gov.in API endpoint:
 * https://api.data.gov.in/resource/<resource_id>?api-key=<key>&format=json
 *
 * Never throws. On any error, returns:
 * { rows: [], is_live: false, note }
 *
 * The dataset has a known shape:
 * commodity, market, state, district,
 * modal_price, price_unit, arrival_date.
 *
 * modal_price is in INR per quintal (1 quintal = 100 kg)
 * according to the AGMARKNET convention.
 */
'use strict';

const axios = require('axios');
const { MarketDataProvider } = require('./provider');

class DataGovInProvider extends MarketDataProvider {
  async fetch({
    crop,
    state,
    market,
    district,
    timeoutSec = 8,
    apiKey,
    resourceId,
  } = {}) {
    if (!apiKey) {
      return {
        rows: [],
        is_live: false,
        note:
          'DATA_GOV_IN_API_KEY is empty; live fetch skipped.',
      };
    }

    if (!resourceId) {
      return {
        rows: [],
        is_live: false,
        note:
          'DATA_GOV_IN_RESOURCE_ID is empty; live fetch skipped.',
      };
    }

    const url =
      `https://api.data.gov.in/resource/${resourceId}`;

    const params = {
      'api-key': apiKey,
      format: 'json',
      limit: 100,
    };

    if (crop) {
      params['filters[commodity]'] = crop;
    }

    if (state) {
      params['filters[state]'] = state;
    }

    if (market) {
      params['filters[market]'] = market;
    }

    if (district) {
      params['filters[district]'] = district;
    }

    try {
      const resp = await axios.get(url, {
        params,
        timeout: Math.max(
          2000,
          (timeoutSec || 8) * 1000
        ),
        validateStatus: (status) =>
          status >= 200 && status < 300,
      });

      const records =
        (resp.data && resp.data.records) || [];

      const rows = records
        .map((r) => {
          /*
           * AGMARKNET shape:
           *   commodity
           *   market
           *   state
           *   district
           *   modal_price
           *   price_unit
           *   arrival_date
           *   variety
           */
          const cropName =
            r.commodity ||
            r.Commodity ||
            r.crop ||
            '';

          const marketName =
            r.market ||
            r.Market ||
            '';

          const st =
            r.state ||
            r.State ||
            '';

          const dist =
            r.district ||
            r.District ||
            '';

          const raw =
            r.modal_price ||
            r.modalPrice ||
            r.price ||
            null;

          /*
           * If a future feed provides explicit min/max
           * prices, preserve them.
           */
          const rawMin =
            r.min_price ||
            r.minPrice ||
            null;

          const rawMax =
            r.max_price ||
            r.maxPrice ||
            null;

          const unit =
            r.price_unit ||
            r.unit ||
            'INR/quintal';

          const variety =
            r.variety ||
            r.Variety ||
            '';

          const grade =
            r.grade ||
            r.Grade ||
            '';

          const unitLower =
            String(unit).toLowerCase();

          const isQuintal =
            unitLower.includes('quintal') ||
            unitLower.includes('100kg');

          const isKg =
            unitLower.includes('/kg') ||
            unitLower === 'kg';

          /*
           * Convert modal price to both INR/quintal
           * and INR/kg.
           */
          let perQuintal = null;
          let perKg = null;

          const num = Number(raw);

          if (Number.isFinite(num) && num > 0) {
            if (isQuintal) {
              perQuintal = num;
              perKg = num / 100;
            } else if (isKg) {
              perKg = num;
              perQuintal = num * 100;
            } else {
              // AGMARKNET default convention.
              perQuintal = num;
              perKg = num / 100;
            }
          }

          /*
           * Convert min/max using the same unit as modal.
           * If the source doesn't provide them, use modal.
           */
          let minPerKg = perKg;
          let maxPerKg = perKg;

          const minNum = Number(rawMin);
          const maxNum = Number(rawMax);

          if (
            Number.isFinite(minNum) &&
            minNum > 0
          ) {
            if (isQuintal) {
              minPerKg = minNum / 100;
            } else if (isKg) {
              minPerKg = minNum;
            } else {
              minPerKg = minNum / 100;
            }
          }

          if (
            Number.isFinite(maxNum) &&
            maxNum > 0
          ) {
            if (isQuintal) {
              maxPerKg = maxNum / 100;
            } else if (isKg) {
              maxPerKg = maxNum;
            } else {
              maxPerKg = maxNum / 100;
            }
          }

          const arrivalDate =
            r.arrival_date ||
            r.arrivalDate ||
            '';

          return {
            cropName: String(cropName).trim(),

            market: String(marketName).trim(),

            state: String(st).trim(),

            district: String(dist).trim(),

            pricePerQuintal: perQuintal,

            pricePerKg: perKg,

            minPricePerKg: minPerKg,

            maxPricePerKg: maxPerKg,

            arrivalDate,

            priceDate: arrivalDate,

            // Provenance fields.
            price_unit:
              String(unit).trim() ||
              'INR/quintal',

            variety:
              String(variety).trim(),

            grade:
              String(grade).trim(),

            arrivals: null,

            source: 'data_gov_in',

            isLive: true,

            raw: r,
          };
        })
        .filter(
          (r) =>
            r.cropName &&
            r.pricePerKg
        );

      return {
        rows,

        is_live: rows.length > 0,

        note:
          rows.length === 0
            ? 'Live data.gov.in returned no rows for the filter; demo dataset will be used as fallback.'
            : undefined,
      };
    } catch (err) {
      return {
        rows: [],
        is_live: false,
        note:
          `Live data.gov.in fetch failed: ${
            err.message || 'network error'
          }. Falling back to demo dataset.`,
      };
    }
  }
}

module.exports = {
  DataGovInProvider,
};