// Thin wrapper to run the verifier. Avoids filename heuristics in
// some CLI toolchains.
const path = require('path');
require(path.join(__dirname, 'verify_A_to_I.cjs'));
