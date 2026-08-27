// A CLOSED shift takes no settlement — pinned for BOTH settlement paths at once.
//
// On 27-Aug-2026 a manager settled an operator into Dilsukhnagar's 27-Aug shift
// twenty minutes AFTER that shift closed: two closing meters and a reconciliation
// row written into a closed shift, because the End Shift screen was still holding
// the closed shift's id. The screen bug is fixed separately; this is the backstop,
// because a screen is a hint and the writer is the gate.
//
// The guard could not live in a route. /self-settle carried it inline and
// /reconcile/manager never got it — the exact drift CLAUDE.md names for this pair,
// two trust boundaries over ONE settlement concept. It lives in loadOperatorLine,
// which both paths call, so neither can be settled into a closed shift and a future
// third caller inherits the rule without being told.
const test   = require('node:test');
const assert = require('node:assert');
const { loadOperatorLine, SettlementError } = require('../src/services/settlementService');

// A client whose single query answers with the row we want to test against.
const clientReturning = (rows) => ({ query: async () => ({ rows }) });

const ARGS = { shift_id: 'sh-1', attendant_id: 'att-1' };

test('an OPEN shift loads the operator line as before', async () => {
  const client = clientReturning([{ id: 'sa-1', opening_cash: 0, station_id: 'st-1', status: 'open' }]);
  const sa = await loadOperatorLine(client, ARGS);
  assert.strictEqual(sa.id, 'sa-1');
  assert.strictEqual(sa.status, 'open');
});

test('a CLOSED shift is refused with 409, not silently settled', async () => {
  const client = clientReturning([{ id: 'sa-1', opening_cash: 0, station_id: 'st-1', status: 'closed' }]);
  await assert.rejects(
    () => loadOperatorLine(client, ARGS),
    (e) => {
      assert.ok(e instanceof SettlementError, 'carries the status the route should return');
      assert.strictEqual(e.status, 409);
      // A sentence, never a machine code — this reaches a manager's screen verbatim.
      assert.match(e.message, /already closed/i);
      assert.doesNotMatch(e.message, /^[a-z_]+$/, 'must not be a snake_case code');
      return true;
    }
  );
});

test('the refusal reaches the MANAGER path too — it is one writer, not a route rule', async () => {
  // The manager path passes no notFound overrides; the operator path passes 403/its
  // own message. Neither may opt out of the closed-shift refusal.
  const client = clientReturning([{ id: 'sa-1', status: 'closed', station_id: 'st-1' }]);
  for (const extra of [{}, { notFoundStatus: 403, notFoundMessage: 'You are not assigned to this shift.' }]) {
    await assert.rejects(
      () => loadOperatorLine(client, { ...ARGS, ...extra }),
      (e) => e.status === 409
    );
  }
});

test('a missing line still 404s — the closed check must not mask "not assigned"', async () => {
  await assert.rejects(
    () => loadOperatorLine(clientReturning([]), ARGS),
    (e) => e.status === 404
  );
  // …and the operator path still gets its own 403.
  await assert.rejects(
    () => loadOperatorLine(clientReturning([]), { ...ARGS, notFoundStatus: 403 }),
    (e) => e.status === 403
  );
});
