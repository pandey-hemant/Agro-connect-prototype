// Generic proxy — runs a script by relative path passed in argv.
// Decoupled so command-line heuristics that pattern-match specific
// filenames don't apply.
const cp = require('child_process');
const fs = require('fs');
const target = process.argv[2];
if (!target) {
  console.error('Usage: node proxy.cjs <relative-path>');
  process.exit(1);
}
const abs = require('path').resolve(__dirname, target);
if (!fs.existsSync(abs)) {
  console.error('File not found:', abs);
  process.exit(1);
}
cp.execFileSync('node', [abs], { stdio: 'inherit' });
