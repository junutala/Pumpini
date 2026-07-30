// src/services/invoiceNumberService.js
//
// THE one allocator for invoice numbers. docs/credit-slip-invoicing.md §6.
//
// An invoice number is a STATUTORY artifact, which makes this heavier than any other
// number Pumpini mints. Three rules follow, and they are why this is a service and not
// a line of code in two routes:
//
//  1. ALLOCATE AT COMMIT, NEVER BEFORE. Pass the caller's transaction `client` so the
//     number is consumed in the SAME transaction that writes the invoice row. The
//     classic failure is: reserve number -> render fails -> number burned -> an
//     unexplainable gap in a statutory series.
//  2. CONCURRENCY MUST BE DB-ENFORCED. `SELECT ... FOR UPDATE` serialises two managers
//     running month-end at the same instant. The old frontend built the number from a
//     stale `invoice_seq` read, so both would have computed the SAME number and one
//     would have hit the unique constraint at the busiest moment of the month.
//  3. NEVER REUSE. A wrong invoice is cancelled by credit note, never by freeing its
//     number.
//
// Format is PREFIX/FY/SEQ (e.g. BS/2026-2027/32) and all three are per OUTLET — each
// unit prints and numbers its own documents, so there is no group-wide series.
//
// Previously there were TWO shapes off ONE counter: `INV-<generation date>-<seq>` built
// in the browser by the credit-invoice screen, and `INV-<seq>` built server-side by
// reconcile's self-settle. Both now come through here. Note the old embedded date was
// the GENERATION date, not the invoice date (INV-20260730-0146 was dated 28 Jul), so it
// was actively misleading and is gone.
const pool = require('../db/pool');

// Indian financial year: 1 April – 31 March, evaluated in IST.
function financialYear(d = new Date()) {
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = ist.getFullYear();
  const startYear = ist.getMonth() >= 3 ? y : y - 1;   // getMonth() 3 = April
  return `${startYear}-${startYear + 1}`;
}

// Allocate the next invoice number for an outlet. Returns { invoice_number, seq, fy }.
//
// THE FY SERIES IS OPT-IN PER OUTLET (owner call, 30-Jul). An outlet uses
// PREFIX/FY/SEQ only when its `invoice_fy` is SET on the settings screen. Blank means
// keep producing exactly what it produces today — because an outlet already sending
// customers INV-20260730-0146 should not suddenly change the shape of a live series
// and leave the owner explaining it to their credit customers.
//
// `style` therefore only matters when invoice_fy is blank, and preserves the caller's
// EXISTING legacy shape:
//   'dated' -> PREFIX-YYYYMMDD-NNNN  (the credit-invoice screen's long-standing format)
//   'plain' -> PREFIX-SEQ            (reconcile.js self-settle's long-standing format)
//
// MUST be called with the caller's transaction client so the allocation and the invoice
// insert commit or roll back together.
async function allocate({ station_id, style = 'dated' }, client = pool) {
  if (!station_id) throw new Error('station_id is required to allocate an invoice number');

  const fy = financialYear();

  await client.query(
    `INSERT INTO station_settings(station_id, invoice_seq) VALUES($1, 1)
     ON CONFLICT(station_id) DO NOTHING`,
    [station_id]
  );

  // Legacy path, used when invoice_fy has not been set (or the column does not exist
  // yet). Bumps the same counter and formats it the way that caller always has.
  const legacy = async () => {
    const { rows } = await client.query(
      `UPDATE station_settings SET invoice_seq = COALESCE(invoice_seq,1)+1
       WHERE station_id=$1
       RETURNING COALESCE(invoice_prefix,'INV') AS prefix, invoice_seq`,
      [station_id]
    );
    const seq = Number(rows[0].invoice_seq) - 1;
    const prefix = rows[0].prefix;
    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '');
    const invoice_number = style === 'plain'
      ? `${prefix}-${seq}`
      : `${prefix}-${stamp}-${String(seq).padStart(4, '0')}`;
    return { invoice_number, seq, fy: null, legacy: true };
  };

  let row;
  try {
    const { rows } = await client.query(
      `SELECT COALESCE(invoice_prefix,'INV') AS prefix,
              COALESCE(invoice_seq,1)        AS seq,
              invoice_fy
       FROM station_settings WHERE station_id=$1 FOR UPDATE`,
      [station_id]
    );
    row = rows[0];
  } catch (e) {
    // Pre-migration: invoice_fy does not exist. Behave exactly as before the change.
    if (e.code !== '42703') throw e;
    return legacy();
  }

  // Not opted in -> unchanged behaviour for that outlet.
  if (!row.invoice_fy) return legacy();

  // Opted in. A new financial year restarts at 1; the OPENING number for the current
  // year is whatever the owner typed (e.g. 32 to continue a series Tally was running).
  const rolled = row.invoice_fy !== fy;
  const seq = rolled ? 1 : Number(row.seq);

  await client.query(
    `UPDATE station_settings SET invoice_seq=$2, invoice_fy=$3 WHERE station_id=$1`,
    [station_id, seq + 1, fy]
  );

  return { invoice_number: `${row.prefix}/${fy}/${seq}`, seq, fy };
}

// What WOULD be allocated next, without consuming it. For showing the manager the
// number before they generate. Never use this to build a number that gets saved —
// between the peek and the save someone else may have taken it.
async function peek({ station_id, style = 'dated' }, client = pool) {
  const fy = financialYear();
  const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '');
  const legacyOf = (prefix, seq) => style === 'plain'
    ? `${prefix}-${seq}`
    : `${prefix}-${stamp}-${String(seq).padStart(4, '0')}`;
  try {
    const { rows } = await client.query(
      `SELECT COALESCE(invoice_prefix,'INV') AS prefix,
              COALESCE(invoice_seq,1)        AS seq,
              invoice_fy
       FROM station_settings WHERE station_id=$1`,
      [station_id]
    );
    if (!rows.length) return { invoice_number: legacyOf('INV', 1), seq: 1, fy: null, legacy: true };
    const r = rows[0];
    if (!r.invoice_fy) return { invoice_number: legacyOf(r.prefix, Number(r.seq)), seq: Number(r.seq), fy: null, legacy: true };
    const seq = r.invoice_fy !== fy ? 1 : Number(r.seq);
    return { invoice_number: `${r.prefix}/${fy}/${seq}`, seq, fy };
  } catch (e) {
    if (e.code !== '42703') throw e;
    return { invoice_number: null, seq: null, fy: null, legacy: true, unmigrated: true };
  }
}

module.exports = { allocate, peek, financialYear };
