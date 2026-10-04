#!/usr/bin/env node
// The MRP arithmetic is written ONCE, in backend/src/services/productPricing.js — the
// server prices every product invoice with it. The two sale screens (Products POS and
// the bay Lube Sale) must show the customer the same figure BEFORE it is charged, so
// they need the same function, and a hand-kept copy is a second price waiting to
// disagree with the first.
//
// So the frontend copy is a DERIVED FILE: this script generates it from the backend
// source and fails CI if what is committed differs. Run with --write after editing
// the service. (Same shape as ci-gauge-match-sync.js, the other way round: there the
// frontend is the source, here the server is, because the server charges.)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC  = path.join(ROOT, 'backend/src/services/productPricing.js');
const OUT  = path.join(ROOT, 'frontend/src/lib/productPricing.js');
const HEAD = '// GENERATED from backend/src/services/productPricing.js by\n'
           + '// backend/scripts/ci-product-pricing-sync.js. Do not edit — edit the service and\n'
           + '// run that script with --write. CI fails if the two differ.\n';

function build() {
  const s = fs.readFileSync(SRC, 'utf8');
  const m = s.match(/\nmodule\.exports = \{([^}]*)\};\s*$/);
  if (!m) {
    console.error('✗ product-pricing sync: expected a single trailing `module.exports = { … };` in ' + SRC);
    process.exit(1);
  }
  if (/\brequire\(/.test(s)) {
    console.error('✗ product-pricing sync: the service must stay dependency-free to be mirrored');
    process.exit(1);
  }
  return HEAD + s.slice(0, m.index) + '\nexport {' + m[1] + '};\n';
}

const built = build();
if (process.argv.includes('--write')) {
  fs.writeFileSync(OUT, built);
  console.log('✓ product-pricing mirror rewritten');
  process.exit(0);
}
const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
if (have !== built) {
  console.error('✗ product-pricing mirror is stale — the service changed but frontend/src/lib/productPricing.js did not.');
  console.error('  Run: node backend/scripts/ci-product-pricing-sync.js --write');
  process.exit(1);
}
console.log('✓ product-pricing mirror matches the service');
