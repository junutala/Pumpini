// src/services/settlementService.js
//
// THE one place a settlement's money is computed.
//
// WHY THIS EXISTS. Pumpini settles an operator two ways, and BOTH are permanent
// (CLAUDE.md, owner-set 04-Aug-2026): the manager closes his line from Shift Close,
// or the operator closes it himself from /settlement. Those are two TRUST
// BOUNDARIES — `reconcile.manage` versus `settlement.enter`, and neither role holds
// the other's permission — so two guarded routes are correct.
//
// What was NOT correct is that each route carried its own copy of the maths. Ninety
// lines were identical line for line: load the operator's nozzles, pair each with
// its closing, price it, check the meter never went backwards, total the sale,
// synthesise the dispense events, write the closings. The self-settle route even
// says so in its own header — "Mirrors POST /manager". A fix to one never reached
// the other, on the one path in Pumpini that turns meters into money.
//
// So the maths moves here and the routes keep only what genuinely differs:
//   manager     — blind-drop cash_actual, a credit LUMP into suspense, shortage
//                 resolution with operator acknowledgement, owner alerts.
//   self-settle — cash + the operator's own adjustment, ITEMISED credit lines that
//                 become one invoice per customer, the geofence, and the shift-still-
//                 open check.
//
// Everything here takes the caller's transaction `client` and never commits: the
// settlement, its dispense events and its closings must land together or not at all.

// A refusal the caller can turn straight into a response. Carrying the status here
// keeps the two routes from inventing different codes for the same refusal.
class SettlementError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// The operator's line on this shift. 404/403 is the caller's to choose — the manager
// is looking someone up, the operator is being told he is not on this shift — so the
// status comes in rather than being decided here.
async function loadOperatorLine(client, { shift_id, attendant_id, notFoundStatus = 404, notFoundMessage = 'Attendant not assigned to this shift' }) {
  const { rows } = await client.query(`
    SELECT sa.id, sa.opening_cash, s.station_id, s.status, s.date AS trade_date
      FROM shift_attendants sa
      JOIN shifts s ON s.id = sa.shift_id
     WHERE sa.shift_id=$1 AND sa.attendant_id=$2`, [shift_id, attendant_id]);
  if (!rows.length) throw new SettlementError(notFoundStatus, notFoundMessage);
  return rows[0];
}

// The nozzles he actually worked. ONE source — shift_attendant_nozzles. The legacy
// single-nozzle pair on shift_attendants was retired 01-Aug-2026 and dropped from
// production 04-Aug-2026; nothing here may reach for it again.
async function loadOperatorNozzles(client, { shift_id, attendant_id, noneMessage }) {
  const { rows } = await client.query(`
    SELECT san.nozzle_id, san.opening_reading, n.fuel_type
      FROM shift_attendant_nozzles san
      JOIN nozzles n ON n.id = san.nozzle_id
     WHERE san.shift_id=$1 AND san.attendant_id=$2`, [shift_id, attendant_id]);
  if (!rows.length) throw new SettlementError(400, noneMessage);
  return rows;
}

// Board price per fuel. `suppliedPrice` is honoured ONLY for a single-nozzle
// operator: with two fuels one typed number cannot name which it belongs to, and
// silently applying it to both would misprice half the shift.
function priceLookup(client, station_id, suppliedPrice, nozzleCount) {
  const cache = {};
  return async (fuel) => {
    if (cache[fuel] != null) return cache[fuel];
    let p = (suppliedPrice && nozzleCount === 1) ? parseFloat(suppliedPrice) : 0;
    if (!p) {
      const { rows } = await client.query(
        `SELECT price FROM fuel_prices WHERE station_id=$1 AND fuel_type=$2
          ORDER BY effective_from DESC LIMIT 1`, [station_id, fuel]);
      p = parseFloat(rows[0]?.price || 0);
    }
    cache[fuel] = p;
    return p;
  };
}

// Pair each nozzle with its closing and turn the pair into money.
//
// Sales = Σ over his nozzles of (closing − opening − test) × price(fuel).
//
// Two refusals are load-bearing and must never be softened into a warning:
//   * a nozzle with no closing — a missing leg silently understates the shift;
//   * closing BELOW opening — a meter cannot run backwards, so the figure is wrong,
//     and accepting it would post a negative sale.
async function computeLegs(client, {
  station_id, opNozzles, closings, closing_reading, test_ltrs = 0, price_per_ltr,
  missingClosingMessage,
}) {
  // The single form names the operator's own nozzle, and only when he has exactly
  // one. With two, a bare closing_reading names nothing and the caller must send
  // `closings` — guessing which nozzle it meant is how a reading lands on the wrong
  // meter.
  const closeArr = (Array.isArray(closings) && closings.length)
    ? closings
    : (closing_reading != null && opNozzles.length === 1
        ? [{ nozzle_id: opNozzles[0].nozzle_id, closing_reading, test_ltrs }] : []);
  const closeMap = {};
  for (const c of closeArr) if (c && c.nozzle_id) closeMap[c.nozzle_id] = c;

  const priceFor = priceLookup(client, station_id, price_per_ltr, opNozzles.length);

  let salesValue = 0, totalTest = 0;
  const legs = [];
  for (const nz of opNozzles) {
    const c = closeMap[nz.nozzle_id];
    if (!c || c.closing_reading == null || c.closing_reading === '') {
      throw new SettlementError(400, missingClosingMessage);
    }
    const opening = parseFloat(nz.opening_reading || 0);
    const closing = parseFloat(c.closing_reading);
    const test    = parseFloat(c.test_ltrs || 0);
    const meterLtrs = closing - opening;
    if (!(meterLtrs >= 0)) {
      throw new SettlementError(400, 'Closing reading must be ≥ opening reading for every nozzle.');
    }
    const litres = Math.max(0, meterLtrs - test);
    const price  = await priceFor(nz.fuel_type);
    if (!price) throw new SettlementError(400, `No current price found for ${nz.fuel_type}.`);
    salesValue += litres * price;
    totalTest  += test;
    legs.push({
      nozzle_id: nz.nozzle_id, fuel_type: nz.fuel_type, price, litres,
      value: +(litres * price).toFixed(2), opening, closing,
    });
  }
  return { legs, salesValue: +salesValue.toFixed(2), totalTest };
}

// The cash arithmetic, in one place so the two paths cannot drift on what "expected"
// means. Card, UPI and credit come out of the sale; petty cash leaves the drawer.
function cashPosition({ salesValue, openingCash = 0, cardVal = 0, upiVal = 0, creditVal = 0, pettyVal = 0, cashActual = 0 }) {
  const cashValue    = +(salesValue - cardVal - upiVal - creditVal).toFixed(2);
  const expectedCash = +(parseFloat(openingCash || 0) + cashValue - pettyVal).toFixed(2);
  const variance     = +(parseFloat(cashActual || 0) - expectedCash).toFixed(2);
  return { cashValue, expectedCash, variance };
}

// Re-create the operator's synthesised sales: spread each payment bucket across his
// nozzles by value share, so per-fuel litres AND payment-mode totals both stay exact.
//
// NOTE ON source='manager'. It marks a row as SYNTHESISED AT SETTLEMENT, not as
// "a manager did it" — the operator's own settle writes the same marker, and both
// delete on that marker before re-inserting, which is what makes re-settling
// idempotent. The name is a poor one, kept because changing it would re-interpret
// every historical row.
async function writeSynthesisedSales(client, { station_id, shift_id, attendant_id, legs, salesValue, buckets }) {
  await client.query(
    `DELETE FROM dispense_events WHERE shift_id=$1 AND attendant_id=$2 AND source='manager'`,
    [shift_id, attendant_id]);
  for (const leg of legs) {
    const share = salesValue > 0 ? leg.value / salesValue : (1 / legs.length);
    for (const [mode, total] of buckets) {
      const val = +(total * share).toFixed(2);
      if (val > 0) {
        await client.query(
          `INSERT INTO dispense_events
             (station_id, shift_id, attendant_id, nozzle_id, fuel_type,
              quantity_ltrs, rate_per_ltr, payment_mode, source, occurred_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manager',
             (((SELECT date FROM shifts WHERE id=$2)::date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata'))`,
          [station_id, shift_id, attendant_id, leg.nozzle_id, leg.fuel_type,
           +(val / leg.price).toFixed(3), leg.price, mode]);
      }
    }
  }
}

// Each nozzle's closing, onto the ONE meter store. There is deliberately no mirror
// onto a single column of shift_attendants: writing "the last leg's closing" there
// is where the impossible figures came from, and that pair is now dropped.
async function persistClosings(client, { shift_id, attendant_id, legs }) {
  for (const leg of legs) {
    await client.query(
      `UPDATE shift_attendant_nozzles SET closing_reading=$1
        WHERE shift_id=$2 AND attendant_id=$3 AND nozzle_id=$4`,
      [leg.closing, shift_id, attendant_id, leg.nozzle_id]);
  }
}

// Cash taken out of the drawer at close → one top-up into the station petty-cash
// fund per operator. Idempotent on his settlement row, so a re-settle replaces
// rather than stacks.
async function writePettyCash(client, { station_id, attendant_id, settlementRowId, pettyVal, tradeDate, created_by }) {
  await client.query(
    `DELETE FROM petty_cash_entries WHERE reference_type='shift_close' AND reference_id=$1`,
    [settlementRowId]);
  if (!(pettyVal > 0)) return;
  const { rows: who } = await client.query('SELECT name FROM users WHERE id=$1', [attendant_id]);
  const dt = tradeDate ? String(tradeDate).slice(0, 10) : '';
  await client.query(
    `INSERT INTO petty_cash_entries(station_id, direction, amount, entry_type, description,
       reference_type, reference_id, created_by)
     VALUES($1,'in',$2,'topup',$3,'shift_close',$4,$5)`,
    [station_id, pettyVal, `Petty cash @ shift close — ${who[0]?.name || 'operator'}_${dt}`,
     settlementRowId, created_by]);
}

module.exports = {
  SettlementError,
  loadOperatorLine,
  loadOperatorNozzles,
  computeLegs,
  cashPosition,
  writeSynthesisedSales,
  persistClosings,
  writePettyCash,
};
