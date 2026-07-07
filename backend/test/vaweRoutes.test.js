// Unit tests for the SO-Instructions write guard (Part B — owner-when-unlocked).
// Pure req/res/next logic; no DB or network.
const test = require('node:test');
const assert = require('node:assert');
const { requireCanAct } = require('../src/routes/vawe');

function mkRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test('requireCanAct: the manager may always act', () => {
  let nexted = false;
  requireCanAct({ user: { role: 'manager' } }, mkRes(), () => { nexted = true; });
  assert.strictEqual(nexted, true);
});

test('requireCanAct: the owner is blocked until VAWE unlocks him', () => {
  const res = mkRes();
  let nexted = false;
  requireCanAct(
    { user: { role: 'owner' }, interactionOwnerCanAct: false },
    res,
    () => { nexted = true; },
  );
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 403);
});

test('requireCanAct: the owner may act once unlocked (owner_can_act=true)', () => {
  let nexted = false;
  requireCanAct(
    { user: { role: 'owner' }, interactionOwnerCanAct: true },
    mkRes(),
    () => { nexted = true; },
  );
  assert.strictEqual(nexted, true);
});

test('requireCanAct: other roles (CCO) stay read-only even if unlocked', () => {
  const res = mkRes();
  let nexted = false;
  requireCanAct(
    { user: { role: 'cco' }, interactionOwnerCanAct: true },
    res,
    () => { nexted = true; },
  );
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 403);
});
