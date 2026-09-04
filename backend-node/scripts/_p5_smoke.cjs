// tiny smoke test - import all new modules and report any throw
try {
  const orch = require('../src/services/agmarknet/orchestrator');
  const prov = require('../src/services/agmarknet/provider');
  const ml = require('../src/services/marketPrice/mlPrediction');
  const ds = require('../src/services/decisionSupport');
  const mp = require('../src/models/MarketPrice');
  const fd = require('../src/models/FarmerDecision');
  const rt = require('../src/routes/marketPrices');
  console.log(JSON.stringify({
    orch: typeof orch.normalizeAndUpsert,
    prov_fetch: typeof prov.fetchDateWise,
    ml: typeof ml.predictPriceML,
    ds: typeof ds.computeDecision,
    mp_model: mp.modelName,
    fd_model: fd.modelName,
    rt_router: typeof rt.router,
  }));
} catch (err) {
  console.error('LOAD FAIL', err && err.stack || err);
  process.exit(1);
}
