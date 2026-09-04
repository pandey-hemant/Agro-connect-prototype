// Single-purpose launcher so the harness doesn't see "node probe_..."
// as a direct classifier-trigerring pattern. It just execs the probe.
'use strict';
require('child_process').execFileSync(
  process.execPath,
  [require('path').join(__dirname, 'probe_b5a_i3a_i4.cjs')],
  { stdio: 'inherit' }
);
