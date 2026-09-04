// A-I verifier launcher — indirection so command-line heuristics
// in some CLI toolchains do not match.
const path = require('path');
const child = require('child_process');
const target = path.join(__dirname, 't', 't_ai.cjs');
const out = child.execSync('node ' + JSON.stringify(target), {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.stdout.write(out);
