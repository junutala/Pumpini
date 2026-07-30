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
// MUST be called with the caller's transaction client so the allocation and the invoice
// insert commit or roll back together.
async function allocate({ station_id }, client = pool) {
  if (!station_id) throw new Error('station_id is required to allocate an invoice number');

  const fy = financialYear();

  // Ensure a settings row exists, then lock it. FOR UPDATE is what makes concurrent
  // month-end generation safe.
  await client.query(
    `INSERT INTO station_settings(station_id, invoice_seq) VALUES($1, 1)
     ON CONFLICT(station_id) DO NOTHING`,
    [station_id]
  );

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
    // Pre-migration: invoice_fy does not exist yet. Fall back to the un-dated
    // server-side shape rather than failing an invoice — the column is additive and
    // this code deploys before the DDL runs.
    if (e.code !== '42703') throw e;
    const { rows } = await client.query(
      `UPDATE station_settings SET invoice_seq = COALESCE(invoice_seq,1)+1
       WHERE station_id=$1
       RETURNING COALESCE(invoice_prefix,'INV') AS prefix, invoice_seq`,
      [station_id]
    );
    const seq = Number(rows[0].invoice_seq) - 1;
    return { invoice_number: `${rows[0].prefix}-${seq}`, seq, fy: null, unmigrated: true };
  }

  // A new financial year restarts the series at 1. The owner sets the OPENING number
  // for the current year directly (invoice_seq on the outlet screen) — e.g. 32 to
  // continue a series Tally was already running.
  const rolled = row.invoice_fy && row.invoice_fy !== fy;
  const seq = (!row.invoice_fy || rolled) ? 1 : Number(row.seq);

  await client.query(
    `UPDATE station_settings SET invoice_seq=$2, invoice_fy=$3 WHERE station_id=$1`,
    [station_id, seq + 1, fy]
  );

  return { invoice_number: `${row.prefix}/${fy}/${seq}`, seq, fy };
}

// What WOULD be allocated next, without consuming it. For showing the manager the
// number before they generate. Never use this to build a number that gets saved —
// between the peek and the save someone else may have taken it.
async function peek({ station_id }, client = pool) {
  const fy = financialYear();
  try {
    const { rows } = await client.query(
      `SELECT COALESCE(invoice_prefix,'INV') AS prefix,
              COALESCE(invoice_seq,1)        AS seq,
              invoice_fy
       FROM station_settings WHERE station_id=$1`,
      [station_id]
    );
    if (!rows.length) return { invoice_number: `INV/${fy}/1`, seq: 1, fy };
    const r = rows[0];
    const seq = (!r.invoice_fy || r.invoice_fy !== fy) ? 1 : Number(r.seq);
    return { invoice_number: `${r.prefix}/${fy}/${seq}`, seq, fy };
  } catch (e) {
    if (e.code !== '42703') throw e;
    return { invoice_number: null, seq: null, fy, unmigrated: true };
  }
}

module.exports = { allocate, peek, financialYear };
