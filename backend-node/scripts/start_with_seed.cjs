/**
 * scripts/start_with_seed.cjs — boot wrapper that always re-runs
 * idempotent seed, useful for fresh demos.
 */
'use strict';

require('dotenv').config();
process.env.RUN_SEED_ON_STARTUP = 'true';
require('../src/server.js');
