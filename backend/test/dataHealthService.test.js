// Unit tests for the data-health tripwire service (pure parts — no DB).
// computeDataHealth([]) short-circuits before any query, so this exercises the
// contract without a database connection.
const test = require('node:test');
const assert = require('node:assert');
const { computeDataHealth, THRESHOLDS } = require('../src/services/dataHealthService');

test('THRESHOLDS carries the documented defaults', () => {
  assert.strictEqual(THRESHOLDS.dip_stale_days, 2);
  assert.strictEqual(THRESHOLDS.physical_dip_days, 7);
  assert.strictEqual(THRESHOLDS.open_shift_days, 1);
  assert.ok(THRESHOLDS.handover_tolerance_ltrs > 0);
  assert.ok(THRESHOLDS.lookback_days > 0);
});

test('computeDataHealth returns an empty map for no stations (no DB call)', async () => {
  assert.deepStrictEqual(await computeDataHealth([]), {});
  assert.deepStrictEqual(await computeDataHealth(null), {});
  assert.deepStrictEqual(await computeDataHealth([null, undefined, '']), {});
});
