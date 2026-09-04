/**
 * scripts/autonomous_verify.cjs — master autonomous verification runner.
 *
 * Runs the complete verification suite for the AgroConnect Node backend
 * with disposable test fixtures. Designed to be the ONE command that
 * proves the system is ready for the next phase.
 *
 * Phases:
 *   0. Environment check (MongoDB reachable, .env loaded)
 *   1. AGMARKNET pipeline verifier (offline, in-memory Mongo)
 *   2. ML unit verifier (offline, in-memory Mongo)
 *   3. ML real-data integration verifier (real Mongo + real AGMARKNET)
 *   4. Start backend (if not running)
 *   5. AGMARKNET endpoint verifier (network)
 *   6. Phase 5 endpoint verifier (with disposable crop-lot fixture)
 *   7. Decision-support verifier (network, creates its own fixtures)
 *   8. Frontend production build
 *
 * Each phase runs independently. A failure in one phase does NOT
 * stop the runner — every phase is attempted and the final report
 * shows what passed and what failed.
 *
 * Usage:
 *   node scripts/autonomous_verify.cjs
 *
 * Exit code:
 *   0  — all phases passed
 *   1  — at least one phase failed
 *  99  — fatal environment error
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..');
const FRONTEND_ROOT = path.join(ROOT, '..', 'frontend', 'Agro-connect-prototype');
const PHASE_RESULTS = [];
let PHASE_NUM = 0;

function startPhase(label) {
  PHASE_NUM += 1;
  console.log('');
  console.log('='.repeat(70));
  console.log(`PHASE ${PHASE_NUM}: ${label}`);
  console.log('='.repeat(70));
}

function endPhase(passed, count, total) {
  PHASE_RESULTS.push({ phase: PHASE_NUM, label: '', passed, count, total });
}

function runScript(scriptPath, label, env = {}) {
  return new Promise((resolve) => {
    const abs = path.isAbsolute(scriptPath) ? scriptPath : path.join(ROOT, scriptPath);
    if (!fs.existsSync(abs)) {
      console.log(`[${label}] SCRIPT NOT FOUND: ${abs}`);
      resolve({ code: 1, stdout: '', stderr: 'not found' });
      return;
    }
    const child = spawn(process.execPath, [abs], {
      cwd: ROOT,
      stdio: 'pipe',
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); process.stdout.write(c); });
    child.stderr.on('data', (c) => { stderr += c.toString(); process.stderr.write(c); });
    child.on('exit', (code) => {
      resolve({ code: code || 0, stdout, stderr });
    });
  });
}

function parseTestCounts(stdout) {
  // Try to find "=== N passed, M failed ===" pattern
  const m = stdout.match(/===\s*(\d+)\s*passed,\s*(\d+)\s*failed\s*===/);
  if (m) return { pass: parseInt(m[1], 10), fail: parseInt(m[2], 10) };
  return null;
}

async function checkMongo() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agroconnect';
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    await mongoose.disconnect();
    return { ok: true, uri };
  } catch (err) {
    return { ok: false, uri, error: err.message };
  }
}

async function waitForBackend(maxMs = 30000) {
  const base = process.env.BASE_URL || 'http://localhost:5050/api';
  const healthUrl = base.replace(/\/api$/, '/api/health');
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const status = await new Promise((resolve, reject) => {
        const u = new URL(healthUrl);
        const req = require('http').request(
          { method: 'GET', hostname: u.hostname, port: u.port || 80, path: u.pathname },
          (res) => resolve(res.statusCode)
        );
        req.on('error', reject);
        req.end();
      });
      if (status === 200 || status === 503) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function startBackend() {
  console.log('[autonomous] starting backend server...');
  // Try common start scripts
  const candidates = [
    { cmd: 'npm', args: ['start'], cwd: ROOT },
    { cmd: 'npm', args: ['run', 'dev'], cwd: ROOT },
    { cmd: 'node', args: ['src/server.js'], cwd: ROOT },
    { cmd: 'node', args: ['src/index.js'], cwd: ROOT },
    { cmd: 'node', args: ['server.js'], cwd: ROOT },
  ];
  for (const c of candidates) {
    try {
      // Test if the script would work
      if (c.cmd === 'npm') {
        const pkg = require(path.join(ROOT, 'package.json'));
        const scriptName = c.args[c.args.length - 1];
        if (!pkg.scripts || !pkg.scripts[scriptName]) continue;
      } else if (c.cmd === 'node') {
        const scriptFile = path.join(c.cwd, c.args[0]);
        if (!fs.existsSync(scriptFile)) continue;
      }
    } catch (_) {
      continue;
    }
    // Spawn it in background
    const child = spawn(c.cmd, c.args, {
      cwd: c.cwd,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    console.log(`[autonomous] spawned ${c.cmd} ${c.args.join(' ')} (pid ${child.pid})`);
    return true;
  }
  return false;
}

async function main() {
  console.log('AUTONOMOUS VERIFICATION');
  console.log('=======================');
  console.log(`Backend root: ${ROOT}`);
  console.log(`Frontend root: ${FRONTEND_ROOT}`);
  console.log(`MONGODB_URI: ${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agroconnect'}`);
  console.log(`BASE_URL: ${process.env.BASE_URL || 'http://localhost:5050/api'}`);
  console.log('');

  // ---- Phase 0: Environment ----
  startPhase('Environment check');
  const mongoCheck = await checkMongo();
  console.log(`MongoDB: ${mongoCheck.ok ? 'OK' : 'FAILED'} (${mongoCheck.uri})`);
  if (!mongoCheck.ok) {
    console.log(`Error: ${mongoCheck.error}`);
    PHASE_RESULTS.push({ phase: 0, label: 'Environment', passed: false, count: 0, total: 1 });
    console.log('');
    console.log('FATAL: Cannot connect to MongoDB. Aborting.');
    console.log('--- FINAL REPORT ---');
    printFinalReport();
    process.exit(99);
  }
  endPhase(true, 1, 1);

  // ---- Phase 1: AGMARKNET pipeline verifier ----
  startPhase('AGMARKNET pipeline verifier (offline)');
  let r = await runScript('scripts/verify_agmarknet_pipeline.cjs', 'pipeline');
  let counts = parseTestCounts(r.stdout);
  endPhase(r.code === 0, counts?.pass || 0, (counts?.pass || 0) + (counts?.fail || 0));

  // ---- Phase 2: ML unit verifier ----
  startPhase('ML unit verifier (offline)');
  r = await runScript('scripts/verify_ml_prediction.cjs', 'ml_unit');
  counts = parseTestCounts(r.stdout);
  endPhase(r.code === 0, counts?.pass || 0, (counts?.pass || 0) + (counts?.fail || 0));

  // ---- Phase 3: ML real-data integration verifier ----
  startPhase('ML real AGMARKNET → MongoDB → API integration');
  r = await runScript('scripts/verify_ml_agmarknet_integration.cjs', 'ml_real');
  counts = parseTestCounts(r.stdout);
  endPhase(r.code === 0, counts?.pass || 0, (counts?.pass || 0) + (counts?.fail || 0));

  // ---- Phase 4: Backend availability ----
  startPhase('Backend server availability');
  let backendUp = await waitForBackend(5000);
  if (!backendUp) {
    console.log('[autonomous] backend not responding, attempting to start...');
    const started = await startBackend();
    if (started) {
      backendUp = await waitForBackend(30000);
    }
  }
  if (backendUp) {
    console.log('[autonomous] backend is up');
    endPhase(true, 1, 1);
  } else {
    console.log('[autonomous] backend is NOT running — skipping network-dependent phases');
    endPhase(false, 0, 1);
  }

  // ---- Phase 5: AGMARKNET endpoint verifier (network) ----
  if (backendUp) {
    startPhase('AGMARKNET endpoint verifier (live)');
    r = await runScript('scripts/verify_agmarknet_endpoint.cjs', 'endpoint');
    counts = parseTestCounts(r.stdout);
    endPhase(r.code === 0, counts?.pass || 0, (counts?.pass || 0) + (counts?.fail || 0));
  } else {
    startPhase('AGMARKNET endpoint verifier (live) — SKIPPED (no backend)');
    endPhase(null, 0, 0);
  }

  // ---- Phase 6: Phase 5 endpoint verifier (with fixture) ----
  if (backendUp) {
    startPhase('Phase 5 endpoint verifier (with disposable crop-lot fixture)');
    r = await runScript('scripts/run_phase5_with_fixture.cjs', 'phase5');
    counts = parseTestCounts(r.stdout);
    endPhase(r.code === 0, counts?.pass || 0, (counts?.pass || 0) + (counts?.fail || 0));
  } else {
    startPhase('Phase 5 endpoint verifier — SKIPPED (no backend)');
    endPhase(null, 0, 0);
  }

  // ---- Phase 7: Decision-support verifier ----
  if (backendUp) {
    startPhase('Decision support verifier');
    r = await runScript('scripts/verify_decision_support.cjs', 'decision');
    counts = parseTestCounts(r.stdout);
    endPhase(r.code === 0, counts?.pass || 0, (counts?.pass || 0) + (counts?.fail || 0));
  } else {
    startPhase('Decision support verifier — SKIPPED (no backend)');
    endPhase(null, 0, 0);
  }

  // ---- Phase 8: Frontend production build ----
  startPhase('Frontend production build');
  if (!fs.existsSync(FRONTEND_ROOT)) {
    console.log(`[autonomous] frontend directory not found: ${FRONTEND_ROOT}`);
    endPhase(false, 0, 1);
  } else {
    // On Windows, `npm` is `npm.cmd` and bare `spawn('npm', ...)`
    // fails with ENOENT. Use `shell: true` so the platform shell
    // resolves the .cmd wrapper. (The build itself is unchanged —
    // we are only fixing the spawn invocation, not the frontend.)
    const isWindows = process.platform === 'win32';
    const result = await new Promise((resolve) => {
      const child = spawn('npm', ['run', 'build'], {
        cwd: FRONTEND_ROOT,
        stdio: 'pipe',
        shell: isWindows,
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => { out += c.toString(); process.stdout.write(c); });
      child.stderr.on('data', (c) => { err += c.toString(); process.stderr.write(c); });
      child.on('exit', (code) => resolve({ code: code || 0, out, err }));
      child.on('error', (e) => resolve({ code: 127, out, err: String(e) }));
    });
    endPhase(result.code === 0, result.code === 0 ? 1 : 0, 1);
  }

  // ---- Final report ----
  printFinalReport();
  const allPassed = PHASE_RESULTS.every((p) => p.passed === true);
  process.exit(allPassed ? 0 : 1);
}

function printFinalReport() {
  console.log('');
  console.log('='.repeat(70));
  console.log('FINAL REPORT');
  console.log('='.repeat(70));
  for (const p of PHASE_RESULTS) {
    const status = p.passed === null ? 'SKIPPED' : p.passed ? 'PASS' : 'FAIL';
    const counts = p.total > 0 ? `${p.count}/${p.total}` : '—';
    console.log(`Phase ${p.phase}: ${status}  (${counts})`);
  }
  const allPassed = PHASE_RESULTS.every((p) => p.passed === true);
  console.log('');
  console.log(allPassed ? 'VERIFIED — READY FOR NEXT PHASE' : 'VERIFICATION FAILED — SEE PHASES ABOVE');
}

main().catch((err) => {
  console.error('[autonomous] fatal:', err);
  process.exit(99);
});
