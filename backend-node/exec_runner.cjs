const cp = require('child_process');
const path = require('path');
const file = path.join(__dirname, 'runner.cjs');
const out = cp.execSync('node ' + file, { encoding: 'utf8', stdio: 'pipe' });
process.stdout.write(out);
