#!/usr/bin/env node
// The gauge matcher lives in the frontend as an ES module; the test suite that CI
// runs is CommonJS in the backend. So the rules are mirrored into
// test/helpers/gaugeMatch.cjs — and a mirror is drift waiting to happen, which is
// the one thing this repo has spent months undoing.
//
// This makes the copy a DERIVED FILE. It regenerates it from the source and fails if
// what is committed differs, so the test can never quietly assert yesterday's rules.
// Run with --write to refresh it after editing the matcher.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC  = path.join(ROOT, 'frontend/src/lib/gaugeMatch.js');
const OUT  = path.join(ROOT, 'backend/test/helpers/gaugeMatch.cjs');
const HEAD = '// GENERATED from frontend/src/lib/gaugeMatch.js by scripts/ci-gauge-match-sync.js.\n'
           + '// Do not edit. Run that script after changing the matcher; CI checks they agree.\n';

function build() {
  const s = fs.readFileSync(SRC, 'utf8');
  if (!s.includes('export function matchGaugeRows')) {
    console.error('✗ gauge-match sync: matchGaugeRows is no longer exported from ' + SRC);
    process.exit(1);
  }
  return HEAD + s
    .replace('export function matchGaugeRows', 'function matchGaugeRows')
    .replace(/export default matchGaugeRows;?/, 'module.exports = { matchGaugeRows };');
}

const built = build();
if (process.argv.includes('--write')) {
  fs.writeFileSync(OUT, built);
  console.log('✓ gauge-match mirror rewritten');
  process.exit(0);
}
const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
if (have !== built) {
  console.error('✗ gauge-match mirror is stale — the matcher changed but test/helpers/gaugeMatch.cjs did not.');
  console.error('  Run: node backend/scripts/ci-gauge-match-sync.js --write');
  process.exit(1);
}
console.log('✓ gauge-match mirror matches the matcher');
