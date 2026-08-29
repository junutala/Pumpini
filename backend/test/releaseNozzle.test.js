// RELEASING A NOZZLE THAT DID NOT MOVE.
//
// An operator holds four nozzles, two never dispensed, and somebody else needs those
// two now. Settling him is wrong — his other two are still running and his money is
// not due. Leaving them assigned is wrong too — the forecourt is short two nozzles.
//
// Zero litres times any price is zero rupees, so releasing them cannot move a figure
// on anybody's settlement. That is the ONLY reason this is allowed to exist, and
// every test here exists to keep it confined to that case.
const test = require('node:test');
const assert = require('node:assert');
const settlement = require('../src/services/settlementService');

// A stub client: one leg, and a record of what got written.
function stubClient(leg, writes = []) {
  return {
    writes,
    query: async (sql, params) => {
      if (/SELECT opening_reading/.test(sql)) {
        return { rows: leg ? [leg] : [] };
      }
      writes.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return { rows: [] };
    },
  };
}
const call = (client, over = {}) => settlement.releaseUnmovedNozzle(client, {
  shift_id: 's1', attendant_id: 'a1', nozzle_id: 'n1', reading: '100.000', ...over,
});

test('a nozzle that did not move is released, and closes at its own opening', async () => {
  const writes = [];
  const c = stubClient({ opening_reading: '100.000', closing_reading: null }, writes);
  const out = await call(c);
  assert.deepStrictEqual(out, { nozzle_id: 'n1', opening: 100, closing: 100, litres: 0 });
  assert.strictEqual(writes.length, 1, 'exactly one write — the leg, nothing else');
  assert.match(writes[0].sql, /UPDATE shift_attendant_nozzles SET closing_reading/);
  assert.strictEqual(writes[0].params[0], 100, 'closes at the OPENING, not at what was sent');
});

test('NOTHING ELSE IS WRITTEN — no settlement, no sale, no cash', async () => {
  const writes = [];
  await call(stubClient({ opening_reading: '4321.500', closing_reading: null }, writes),
             { reading: '4321.500' });
  const touched = writes.map(w => (w.sql.match(/(?:UPDATE|INSERT INTO|DELETE FROM)\s+(\w+)/) || [])[1]);
  assert.deepStrictEqual(touched, ['shift_attendant_nozzles']);
});

test('A NOZZLE THAT MOVED IS REFUSED — by a hundredth of a litre', async () => {
  const c = stubClient({ opening_reading: '100.000', closing_reading: null });
  await assert.rejects(() => call(c, { reading: '100.010' }), e => {
    assert.strictEqual(e.status, 409);
    assert.match(e.message, /has moved/);
    assert.match(e.message, /100\.000/);       // shows him both figures
    assert.match(e.message, /100\.010/);
    return true;
  });
  assert.strictEqual(c.writes.length, 0, 'a refusal must write nothing at all');
});

test('the reading is the PROOF, not the claim — a missing one is refused', async () => {
  const c = stubClient({ opening_reading: '100.000', closing_reading: null });
  await assert.rejects(() => call(c, { reading: undefined }), e => e.status === 400);
  await assert.rejects(() => call(c, { reading: 'abc' }),     e => e.status === 400);
  assert.strictEqual(c.writes.length, 0);
});

test('an already-closed leg is refused, not silently re-closed', async () => {
  const c = stubClient({ opening_reading: '100.000', closing_reading: '150.000' });
  await assert.rejects(() => call(c), e => e.status === 409 && /already closed/.test(e.message));
  assert.strictEqual(c.writes.length, 0);
});

test('a nozzle not held by that operator is refused', async () => {
  const c = stubClient(null);
  await assert.rejects(() => call(c), e => e.status === 404);
});

test('a large but unchanged meter still releases — the value does not matter', async () => {
  const c = stubClient({ opening_reading: '3291980.980', closing_reading: null });
  const out = await call(c, { reading: '3291980.980' });
  assert.strictEqual(out.litres, 0);
});
