// src/utils/schemaProbe.js
//
// Ask the catalog once whether a column or table exists, and remember the answer.
//
// WHY THIS IS NOT JUST A MEMOISED PROMISE. CLAUDE.md's deploy ordering means code
// reaches Railway BEFORE the owner runs the DDL, so a probe run at boot legitimately
// answers "no" — and then the owner runs the SQL a few minutes later. A plain
// `let cached = pool.query(...)` would hold that stale "no" until something happened
// to restart the backend, and the screen would go on insisting the table is missing
// long after it exists. That is a worse failure than the one the probe prevents,
// because nothing looks broken: it just quietly keeps degrading.
//
// So the asymmetry is deliberate:
//   • TRUE is permanent   — a column is not going to be dropped under a running app,
//                           and this is the hot path.
//   • FALSE expires       — re-asked at most every RETRY_MS, so the feature lights up
//                           on its own within half a minute of the DDL being run,
//                           without a redeploy and without a query per request.
//
// A probe must be a CATALOG SELECT, never a speculative write: inside a
// BEGIN…COMMIT a failed statement aborts the whole transaction, so "try it and
// catch 42703" takes the real work down with it.
const pool   = require('../db/pool');
const logger = require('./logger');

const DEFAULT_RETRY_MS = 30_000;

/**
 * @param {string}   name       for logs, e.g. 'leads.lat'
 * @param {string}   sql        a catalog query returning one row
 * @param {Function} test       (row) => boolean
 * @param {number}   [retryMs]  how long a NO stands before it is re-asked.
 *                              Overridable so the expiry itself is testable —
 *                              a behaviour worth proving, not assuming, since
 *                              getting it wrong latches a feature off until the
 *                              next restart.
 * @returns {() => Promise<boolean>}
 */
function schemaProbe(name, sql, test, retryMs = DEFAULT_RETRY_MS) {
  let confirmed = false;    // latched true; never re-asked
  let lastMiss  = 0;
  let inflight  = null;

  return function probe() {
    if (confirmed) return Promise.resolve(true);
    if (inflight)  return inflight;
    if (lastMiss && Date.now() - lastMiss < retryMs) return Promise.resolve(false);

    inflight = pool.query(sql)
      .then(r => {
        const ok = test(r.rows[0]);
        if (ok) {
          confirmed = true;
          logger.info(`schemaProbe: ${name} present`);
        } else {
          lastMiss = Date.now();
        }
        return ok;
      })
      .catch(err => {
        // A probe that cannot run is not evidence of absence, but we must answer
        // something — answer "no" and try again shortly, so a transient DB blip
        // degrades one request rather than latching the feature off.
        lastMiss = Date.now();
        logger.warn(`schemaProbe: ${name} probe failed — ${err.message}`);
        return false;
      })
      .finally(() => { inflight = null; });

    return inflight;
  };
}

module.exports = { schemaProbe };
