/**
 * server.js — process entry point.
 *
 *   1. Load config
 *   2. Connect MongoDB (real URI or in-memory)
 *   3. Run idempotent demo seed (if RUN_SEED_ON_STARTUP=true and Mongo is up)
 *   4. Build the express app
 *   5. Start listening on PORT
 *
 * If step 2 fails the server *still* starts — /api/health will
 * surface the error. The frontend can render an error state and the
 * developer can read the failure in one place.
 */
'use strict';

const config = require('./config');
const { buildApp } = require('./app');
const { connectMongo, disconnectMongo } = require('./db/connect');
const routes = require('./routes');
const { seedAllIfEmpty } = require('./services/seedDemo');
const MarketPrice = require('./models/MarketPrice');

async function main() {
  console.log(`[boot] AgroConnect Node backend starting…`);
  console.log(`[boot] PORT=${config.port}`);

  let mode = 'unknown';
  try {
    const result = await connectMongo({ uri: config.mongodbUri });
    mode = result.mode;
    routes.setHealthMode(mode);
    console.log(`[boot] MongoDB connected (mode=${mode})`);

    // Phase 5 — make sure the historical-aggregation indexes exist.
    // Idempotent on every boot. If the collection has duplicates
    // that would block the partial-unique index, we log a warning
    // and continue (the dev DB is fresh on every restart).
    try {
      const r = await MarketPrice.syncIndexesSafe();
      if (r.ok) console.log(`[boot] MarketPrice indexes synced.`);
      else console.warn(`[boot] MarketPrice index sync warning: ${r.error}`);
    } catch (err) {
      console.warn(`[boot] MarketPrice index sync failed: ${err.message}`);
    }

    if (config.runSeedOnStartup) {
      try {
        const r = await seedAllIfEmpty();
        console.log(
          `[boot] seed: buyers=${r.buyers.inserted}, fpos=${r.fpos.inserted}, prices=${r.market_prices.inserted}, users inserted=${r.users.inserted} updated=${r.users.updated}`
        );
      } catch (err) {
        console.warn(`[boot] seed failed (non-fatal): ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[boot] MongoDB connect failed: ${err.message}`);
    console.error(
      `[boot] Continuing WITHOUT database — /api/health will report degraded.`
    );
  }

  const app = buildApp();

  const server = app.listen(config.port, () => {
    console.log(`[boot] AgroConnect listening on http://localhost:${config.port}`);
    console.log(`[boot] Health: http://localhost:${config.port}/api/health`);
  });

  const shutdown = async (sig) => {
    console.log(`[boot] ${sig} received, shutting down…`);
    server.close();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
