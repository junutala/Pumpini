#!/usr/bin/env node
/*
 * CI route-export guard.
 *
 * Why this exists: on 2026-07-22 prod went fully down because
 * `src/routes/stations.js` was truncated during a hand-merge and lost its
 * `module.exports = router`. `require('./routes/stations')` then returned `{}`,
 * and `app.use('/api/stations', {})` threw at app-load:
 *   TypeError: Router.use() requires a middleware function but got a Object
 * That crashes EVERY route for EVERY outlet, not just stations.
 *
 * This script require()s every backend route module and asserts each one
 * exposes a usable Express router/middleware. It needs no database and never
 * calls listen(), so it is a cheap, DB-free gate that catches exactly that
 * class of failure before it can reach main.
 *
 * A route module is considered valid if a usable router is reachable EITHER as:
 *   - the module export itself (most routes: `module.exports = router`), OR
 *   - a property of the export object (e.g. superadmin.js: `{ router, authAdmin }`).
 * A "usable router" is an Express router/middleware: a function (Express
 * routers ARE functions) that also carries `.use`/`.handle`, OR — to stay
 * tolerant of plain middleware — any function value at all.
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes');

// Is `v` a usable Express router / middleware function?
function isRouter(v) {
  if (typeof v === 'function') {
    // Express Router instances are functions with .use/.handle. Plain
    // middleware is also a function; accept both — index.js mounts either.
    return true;
  }
  return false;
}

// Does this module export expose a usable router, directly or via a property
// (covers `module.exports = router` and `module.exports = { router, ... }`)?
function exportHasRouter(mod) {
  if (isRouter(mod)) return true;
  if (mod && typeof mod === 'object') {
    // Prefer a conventional `.router`, but accept any router-shaped property.
    if (isRouter(mod.router)) return true;
    for (const key of Object.keys(mod)) {
      if (isRouter(mod[key])) return true;
    }
  }
  return false;
}

function main() {
  if (!fs.existsSync(ROUTES_DIR)) {
    console.error(`FATAL: routes directory not found at ${ROUTES_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();

  if (files.length === 0) {
    console.error(`FATAL: no route files found in ${ROUTES_DIR}`);
    process.exit(1);
  }

  const failures = [];
  let ok = 0;

  for (const file of files) {
    const full = path.join(ROUTES_DIR, file);
    let mod;
    try {
      mod = require(full);
    } catch (err) {
      failures.push(`${file}: failed to require() — ${err.message}`);
      continue;
    }
    if (!exportHasRouter(mod)) {
      const shape = mod === null ? 'null' : Array.isArray(mod) ? 'array' : typeof mod;
      const keys =
        mod && typeof mod === 'object' ? ` keys=[${Object.keys(mod).join(', ')}]` : '';
      failures.push(
        `${file}: export does not expose an Express router/middleware ` +
          `(got ${shape}${keys}). Expected \`module.exports = router\` or ` +
          `an object with a router property.`
      );
      continue;
    }
    ok++;
  }

  if (failures.length > 0) {
    console.error('\n✗ Route export check FAILED:\n');
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      `\n${failures.length} of ${files.length} route module(s) are broken. ` +
        `Mounting these would crash the backend at boot (Router.use() TypeError).\n`
    );
    process.exit(1);
  }

  console.log(`✓ Route export check passed: ${ok}/${files.length} route modules export a valid router.`);
  process.exit(0);
}

main();
