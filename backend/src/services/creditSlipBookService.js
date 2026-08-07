// src/services/creditSlipBookService.js
//
// THE one writer for credit slip books (requisition-coupon books issued to credit
// customers). Design + reasoning: docs/credit-slip-invoicing.md.
//
// A book is the outlet's control record over a range of coupon numbers handed to a
// credit customer — the cheque-book model. Books are per OUTLET because the units
// print their own, so within one outlet a coupon number identifies exactly one book
// and therefore exactly one customer. Coupon capture (a later slice) resolves
// (station, coupon no) -> book -> customer through `findBookForLeaf` below, and
// treats the name written on the coupon as a CHECK rather than the key.
//
// Every path funnels through here per the anti-drift rule; callers may pass a
// transaction `client` to compose.
const pool = require('../db/pool');
const artifacts = require('./artifactService');

const STATUSES = ['active', 'exhausted', 'cancelled', 'lost'];

// The sample-coupon column (credit_slip_books.sample_artifact_id) arrives via
// owner-run DDL AFTER this code, exactly like the artifact table itself. So we
// PROBE information_schema before ever naming the column — a catalog SELECT that
// succeeds either way and cannot poison a transaction — rather than writing it
// blindly and catching 42703, which inside a BEGIN…COMMIT would abort the whole
// thing. (Same discipline as artifactService; see CLAUDE.md.) Cached only once
// TRUE, so the first issue after the migration starts linking without a restart.
let _hasSampleCol = false;
async function hasSampleColumn(client = pool) {
  if (_hasSampleCol) return true;
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='credit_slip_books'
          AND column_name='sample_artifact_id' LIMIT 1`
    );
    _hasSampleCol = rows.length > 0;
  } catch { _hasSampleCol = false; }
  return _hasSampleCol;
}

// Store a sample coupon photographed from THIS booklet and hand back its artifact
// id. It is the slip format the coupon parser reads AND the dispute backup — the
// paper a bill is checked against months later. Best-effort, like every artifact:
// a book must still be issuable when the camera or the store fails, and a customer
// whose book was recorded without a photo is a small loss, not a blocked issue.
async function storeSlipSample({ station_id, book_id, image_base64, media_type, ocr, uploaded_by }, client = pool) {
  if (!image_base64) return null;
  const a = await artifacts.save({
    station_id,
    entity_type: 'credit_slip_book',
    entity_id: book_id,
    kind: 'coupon',
    file_base64: image_base64,
    media_type: media_type || 'image/jpeg',
    ocr: ocr || null,
    meta: { purpose: 'slip_format_sample' },
    uploaded_by: uploaded_by || null,
  }, client);
  return a ? a.id : null;
}

// Attach a sample coupon to a freshly written/updated book: store the photo (if one
// was supplied and not already stored) against the book, then link it back. The
// artifact hangs off the book's id, so it can only be written once the book exists —
// hence store-then-link rather than link-on-insert, mirroring pumpService. Every
// step is guarded: no image → no-op; column not migrated → keep the book unchanged.
async function attachSlipSample(book, { sample_artifact_id, image_base64, media_type, ocr, uploaded_by }, client = pool) {
  if (!book) return book;
  let artId = sample_artifact_id || null;
  if (!artId && image_base64) {
    artId = await storeSlipSample(
      { station_id: book.station_id, book_id: book.id, image_base64, media_type, ocr, uploaded_by }, client);
  }
  if (!artId) return book;
  if (!(await hasSampleColumn(client))) return book;   // column not migrated yet
  try {
    const { rows } = await client.query(
      'UPDATE credit_slip_books SET sample_artifact_id=$2, updated_at=now() WHERE id=$1 RETURNING *',
      [book.id, artId]
    );
    return rows[0] || book;
  } catch { return book; }
}

function asPositiveInt(v, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${label} must be a whole number greater than zero.`);
  return n;
}

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

// List the register for an outlet, newest issue first, with the customer's name and
// how many leaves the book holds. Read-only.
async function listBooks({ station_id, corporate_id, status }, client = pool) {
  const p = [station_id];
  let q = `
    SELECT b.*, ca.company_name,
           (b.series_end - COALESCE(b.opening_leaf, b.series_start) + 1) AS leaves_expected,
           u.name AS issued_by_name
    FROM credit_slip_books b
    JOIN corporate_accounts ca ON ca.id = b.corporate_id
    LEFT JOIN users u ON u.id = b.issued_by
    WHERE b.station_id = $1`;
  if (corporate_id) { p.push(corporate_id); q += ` AND b.corporate_id = $${p.length}`; }
  if (status)       { p.push(status);       q += ` AND b.status = $${p.length}`; }
  q += ' ORDER BY b.issued_on DESC, b.series_start DESC';
  const { rows } = await client.query(q, p);
  return rows;
}

// Resolve which book a coupon number belongs to at this outlet. Returns the book
// (with the customer) or null. Range containment is written as an int8range so it
// uses the gist index behind the no-overlap constraint.
//
// The no-overlap rule guarantees AT MOST ONE book per (station, leaf), so this is
// unambiguous by construction — that is the whole point of scoping the constraint
// to the station rather than to the customer.
async function findBookForLeaf({ station_id, leaf }, client = pool) {
  const n = Number(leaf);
  if (!Number.isInteger(n)) return null;
  const { rows } = await client.query(
    `SELECT b.*, ca.company_name, ca.is_active AS customer_active
     FROM credit_slip_books b
     JOIN corporate_accounts ca ON ca.id = b.corporate_id
     WHERE b.station_id = $1
       AND int8range(b.series_start, b.series_end, '[]') @> $2::bigint
     LIMIT 1`,
    [station_id, n]
  );
  return rows[0] || null;
}

// Issue a book to a credit customer. The overlap guard is a DB exclusion
// constraint, not an app check, so two managers issuing at once cannot race — we
// translate 23P01 (exclusion violation) into a message naming the clash.
async function issueBook(input, client = pool) {
  const {
    station_id, corporate_id, book_label,
    series_start, series_end, opening_leaf,
    issued_on, notes, issued_by,
    // Sample coupon photo (slip format / dispute backup) — optional, best-effort.
    sample_artifact_id, image_base64, media_type, ocr, uploaded_by,
  } = input;

  if (!station_id)   throw badRequest('station_id is required.');
  if (!corporate_id) throw badRequest('Choose the credit customer this book is issued to.');

  const start = asPositiveInt(series_start, 'The starting coupon number');
  const end   = asPositiveInt(series_end,   'The ending coupon number');
  if (end < start) throw badRequest('The ending coupon number cannot be lower than the starting number.');

  // A part-used book starts above its printed first leaf.
  let opening = null;
  if (opening_leaf != null && String(opening_leaf) !== '') {
    opening = asPositiveInt(opening_leaf, 'The first unused coupon number');
    if (opening < start || opening > end) {
      throw badRequest(`The first unused coupon number must be between ${start} and ${end}.`);
    }
  }

  // Re-scope the customer to this outlet — a corporate_id from another owner's
  // account must not become issuable here just because station_id passed the guard.
  const { rows: cust } = await client.query(
    `SELECT ca.id, ca.company_name, ca.is_active
     FROM corporate_accounts ca
     LEFT JOIN corporate_station_links csl
       ON csl.corporate_id = ca.id AND csl.station_id = $2
     WHERE ca.id = $1 AND (csl.corporate_id IS NOT NULL OR ca.created_by_station = $2)`,
    [corporate_id, station_id]
  );
  if (!cust.length) throw badRequest('That credit customer is not linked to this outlet.');
  if (cust[0].is_active === false) throw badRequest(`${cust[0].company_name} is not an active credit customer.`);

  try {
    const { rows } = await client.query(
      `INSERT INTO credit_slip_books(
         station_id, corporate_id, book_label, series_start, series_end,
         opening_leaf, issued_on, notes, issued_by
       ) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,$9)
       RETURNING *`,
      [station_id, corporate_id, book_label || null, start, end,
       opening, issued_on || null, notes || null, issued_by || null]
    );
    return await attachSlipSample(
      rows[0], { sample_artifact_id, image_base64, media_type, ocr, uploaded_by }, client);
  } catch (e) {
    if (e.code === '23P01') throw await overlapError({ station_id, start, end }, client);
    throw e;
  }
}

// Name the book that already holds part of the requested range, so the manager can
// see what they collided with instead of a bare "already exists".
async function overlapError({ station_id, start, end }, client = pool) {
  let clash = null;
  try {
    const { rows } = await client.query(
      `SELECT b.series_start, b.series_end, b.status, ca.company_name
       FROM credit_slip_books b
       JOIN corporate_accounts ca ON ca.id = b.corporate_id
       WHERE b.station_id = $1
         AND int8range(b.series_start, b.series_end, '[]')
             && int8range($2::bigint, $3::bigint, '[]')
       ORDER BY b.series_start LIMIT 1`,
      [station_id, start, end]
    );
    clash = rows[0] || null;
  } catch { /* fall through to the generic message */ }

  const msg = clash
    ? `Coupon numbers ${start}–${end} overlap the book ${clash.series_start}–${clash.series_end} `
      + `already issued to ${clash.company_name}${clash.status !== 'active' ? ` (${clash.status})` : ''}. `
      + 'Coupon numbers are unique per outlet and are never reissued.'
    : `Coupon numbers ${start}–${end} overlap a book already issued at this outlet.`;
  return badRequest(msg);
}

// Change a book's status, or correct its label / notes / opening leaf. The RANGE is
// deliberately NOT editable: it is the outlet's record of paper physically handed
// over, and editing it would silently move which coupons are authorised. To fix a
// wrongly entered range, cancel the book and issue the correct one.
async function updateBook({ id, station_id, status, book_label, notes, opening_leaf,
                            sample_artifact_id, image_base64, media_type, ocr, uploaded_by }, client = pool) {
  const { rows: existing } = await client.query(
    'SELECT * FROM credit_slip_books WHERE id=$1 AND station_id=$2',
    [id, station_id]
  );
  if (!existing.length) throw badRequest('That book does not belong to this outlet.');
  const book = existing[0];

  if (status != null && !STATUSES.includes(status)) {
    throw badRequest(`Status must be one of: ${STATUSES.join(', ')}.`);
  }

  let opening = book.opening_leaf;
  if (opening_leaf !== undefined) {
    if (opening_leaf === null || String(opening_leaf) === '') opening = null;
    else {
      opening = asPositiveInt(opening_leaf, 'The first unused coupon number');
      if (opening < Number(book.series_start) || opening > Number(book.series_end)) {
        throw badRequest(`The first unused coupon number must be between ${book.series_start} and ${book.series_end}.`);
      }
    }
  }

  const { rows } = await client.query(
    `UPDATE credit_slip_books
        SET status       = COALESCE($3, status),
            book_label   = COALESCE($4, book_label),
            notes        = COALESCE($5, notes),
            opening_leaf = $6,
            updated_at   = now()
      WHERE id=$1 AND station_id=$2
      RETURNING *`,
    [id, station_id, status || null, book_label || null, notes || null, opening]
  );
  // Re-photographing a booklet (a first shot that was unreadable, or a clearer one
  // for the record) stores the new sample and repoints the book. The old artifact is
  // left in place — it is evidence of what was on file at the time.
  return await attachSlipSample(
    rows[0], { sample_artifact_id, image_base64, media_type, ocr, uploaded_by }, client);
}

module.exports = { listBooks, findBookForLeaf, issueBook, updateBook, STATUSES };
