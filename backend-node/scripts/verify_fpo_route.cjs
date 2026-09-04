/**
 * verify_fpo_route.cjs — regression for the "No routes matched
 * location '/fpo'" console error.
 *
 * Two pieces of evidence here, both static (no live server needed):
 *
 *  1. App.jsx must register the FPO page at /fpos (the canonical
 *     route). The bundle is the source of truth — anyone reading it
 *     should see exactly one <Route path="..." element={...} />
 *     for the FPOs page, and it must be /fpos.
 *
 *  2. Every navigate() / to= / href= / window.location that points at
 *     the FPO page must use the canonical /fpos. Any literal '/fpo'
 *     (singular, no trailing s) in the frontend src is a regression —
 *     the broken route is what surfaced the "No routes matched" error
 *     in the first place.
 *
 * If anyone in the future renames the route, this test reminds them to
 * fix every link in lockstep.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const SRC = path.join(FRONTEND, 'src');
const APP_PATH = path.join(SRC, 'App.jsx');

let pass = 0, fail = 0;
function ok(name, detail) {
  pass++;
  console.log(`[OK]   ${name}` + (detail ? '  — ' + detail : ''));
}
function bad(name, detail) {
  fail++;
  console.log(`[FAIL] ${name}` + (detail ? '  — ' + detail : ''));
}

function listJsx(dir) {
  // Recursively list .js / .jsx under dir, skipping node_modules.
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsx(p));
    else if (entry.isFile() && /\.(js|jsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const CANONICAL = '/fpos';
const BROKEN = /'['"`]\/fpo['"`]/; // matches '/fpo', "/fpo", `/fpo`

// ---------- 1. App.jsx route ----------
const appSrc = fs.readFileSync(APP_PATH, 'utf8');

// Match `<Route path="/fpos" element={<FPOs />} />` or similar
const routeMatches = appSrc.match(/<Route\s+[^>]*path="([^"]+)"[^>]*element=\{<([^/>\s]+)[^>]*>\s*\}/g) || [];
const fpoRoutes = routeMatches
  .map((m) => {
    const pathM = m.match(/path="([^"]+)"/);
    const elemM = m.match(/element=\{<([^/>\s]+)/);
    return pathM && elemM ? { path: pathM[1], element: elemM[1].trim() } : null;
  })
  .filter(Boolean)
  .filter((r) => r.element === 'FPOs' || r.element.endsWith('.FPOs'));

if (fpoRoutes.length === 1 && fpoRoutes[0].path === CANONICAL) {
  ok('App.jsx defines the FPO page at /fpos (canonical route)',
     `path="${fpoRoutes[0].path}" element={${fpoRoutes[0].element}}`);
} else if (fpoRoutes.length === 0) {
  bad('App.jsx defines the FPO page at /fpos (canonical route)', 'no FPOs route found');
} else {
  bad('App.jsx defines exactly one FPO route', `found ${fpoRoutes.length}: ${JSON.stringify(fpoRoutes)}`);
}

// And there must NOT be a /fpo (singular) route
const brokenRoute = fpoRoutes.find((r) => r.path === '/fpo');
if (!brokenRoute) {
  ok('App.jsx does NOT register a /fpo (singular) route', 'no duplicate path');
} else {
  bad('App.jsx does NOT register a /fpo (singular) route', `found ${brokenRoute}`);
}

// ---------- 2. No literal /fpo paths in source ----------
const files = listJsx(SRC);
const violations = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  // find every literal match
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // Skip import paths like `fpoSlice.js` (not route strings)
    if (BROKEN.test(line) && !/fpoSlice|fpoReducer|fpoService/i.test(line)) {
      // Skip lines that mention /fpos (which is the canonical route) — those are fine
      if (line.includes('/fpos') || line.includes('/fpo/')) {
        // The literal /fpos is fine, but /fpo alone (not /fpos or /fpo/) is a bug
        return;
      }
      // Skip JSX prop names that happen to contain fpo (e.g. fpoService: …)
      // The regex above already enforces string quotes, so this is safe.
      violations.push({ file: f, line: i + 1, text: line.trim() });
    }
  });
}

if (violations.length === 0) {
  ok(`No literal /fpo (singular) route strings under frontend/src`, `scanned ${files.length} files`);
} else {
  for (const v of violations) {
    bad(`Literal /fpo in ${path.relative(FRONTEND, v.file)}:${v.line}`, v.text);
  }
}

// ---------- 3. The two known-broken sites are fixed ----------
const roleSelect = fs.readFileSync(path.join(SRC, 'pages', 'RoleSelect.jsx'), 'utf8');
if (roleSelect.includes("navigate('/fpos', { replace: true })")) {
  ok('RoleSelect.jsx navigates to /fpos on FPO role pick', 'first-time / no-role entry');
} else {
  bad('RoleSelect.jsx navigates to /fpos on FPO role pick', 'still has /fpo?');
}
if (roleSelect.match(/demoLogin\([^)]*role:\s*'FPO'[\s\S]{0,200}navigate\('\/fpos'/)) {
  ok('RoleSelect.jsx navigates to /fpos after demoLogin(FPO)', 'fulfilled branch');
} else {
  bad('RoleSelect.jsx navigates to /fpos after demoLogin(FPO)', 'still has /fpo?');
}

console.log('');
console.log(`=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
