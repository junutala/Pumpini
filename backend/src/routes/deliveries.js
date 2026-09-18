// src/routes/deliveries.js
const router = require('express').Router();
const { hasColumn } = require('../db/hasColumn');
const { matchCard } = require('../config/lfrRates');
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requirePerm } = require('../middleware/permissions');
const { requireStationAccess, requireStationVia } = require('../middleware/stationAccess');
const Anthropic = require('@anthropic-ai/sdk');
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const { storageConfigured, uploadDocumentBase64, signedDocUrl } = require('../services/vaweStorage');

// Does fuel_deliveries carry the `paid` column yet? This INSERT is a HOT WRITE inside a
// transaction, so naming a not-yet-migrated column would 42703 and abort the whole
// delivery save. Probed (never try-and-caught), cached once TRUE so the first save after
// the owner runs 016 picks it up with no restart. (Owner-approved rule-#1 exception:
// the Deliveries form now carries a Paid/prepaid checkbox for the Accounts module.)
let _hasDeliveryPaidCol = false;
async function hasDeliveryPaidCol() {
  if (_hasDeliveryPaidCol) return true;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='fuel_deliveries'
          AND column_name='paid' LIMIT 1`);
    _hasDeliveryPaidCol = rows.length > 0;
  } catch { _hasDeliveryPaidCol = false; }
  return _hasDeliveryPaidCol;
}

// Persist a scanned delivery invoice. Preferred: upload the bytes to the private
// doc bucket and keep only the storage PATH in the DB (no base64 blob in Postgres).
// Column-tolerant + additive: this code deploys BEFORE the owner runs the DDL, so
// it must not break while `storage_path` is missing or `file_base64` is still
// NOT NULL. We try progressively more legacy INSERT shapes and only fall through on
// a missing-column (42703) / not-null (23502) error — never losing the invoice.
async function insertDeliveryInvoice({ station_id, base64, media_type, uploaded_by, kind = 'fuel' }) {
  let path = null;
  if (storageConfigured()) {
    try {
      path = await uploadDocumentBase64({
        station_id, kind: kind === 'lfr' ? 'lfr_invoice' : 'delivery_invoice',
        prefix: kind === 'lfr' ? 'lfr-invoices' : 'delivery-invoices',
        scope: station_id, base64, contentType: media_type,
        filename: media_type === 'application/pdf' ? 'invoice.pdf' : 'invoice.jpg',
      });
    } catch (e) {
      path = null;
      try { require('../utils/logger').warn('delivery-invoice upload failed, storing base64: ' + (e.message || e)); } catch { /* noop */ }
    }
  }
  // Ordered fallbacks — first that the live schema accepts wins:
  //  1. path only            (migrated: storage_path added + file_base64 NULLable)
  //  2. path + base64         (storage_path added but file_base64 still NOT NULL)
  //  3. base64 only           (pre-migration legacy shape)
  // `kind` tells a fuel invoice from an LFR invoice. Additive column, owner-migrated,
  // so it is PROBED and simply left out until the DDL lands — at which point old rows
  // read as 'fuel' by DEFAULT and nothing has to be backfilled. Never try-and-caught:
  // this helper is also called from the delivery-save path.
  const kindCol = (await hasColumn('delivery_invoices', 'kind')) ? ['kind'] : [];
  const kindVal = kindCol.length ? [kind] : [];
  const attempts = [];
  if (path) {
    attempts.push({ cols: ['storage_path'], vals: [path], base64: false });
    attempts.push({ cols: ['storage_path'], vals: [path], base64: true });
  }
  attempts.push({ cols: [], vals: [], base64: true });
  let lastErr;
  for (const a of attempts) {
    const cols = ['station_id', ...a.cols, ...(a.base64 ? ['file_base64'] : []), 'media_type', 'uploaded_by', ...kindCol];
    const vals = [station_id, ...a.vals, ...(a.base64 ? [base64] : []), media_type, uploaded_by, ...kindVal];
    const ph   = vals.map((_, i) => `$${i + 1}`).join(',');
    try {
      const { rows } = await pool.query(`INSERT INTO delivery_invoices(${cols.join(',')}) VALUES(${ph}) RETURNING id`, vals);
      return rows[0].id;
    } catch (e) {
      lastErr = e;
      if (e.code === '42703' || e.code === '23502') continue;  // column/NOT NULL not migrated → next shape
      throw e;
    }
  }
  throw lastErr;
}

// GET /api/deliveries/book-stock/:station_id  ← must be before /:id routes
router.get('/book-stock/:station_id', authenticate, requireStationAccess(), async (req, res, next) => {
  try {
    const today   = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Get open shift for today
    const { rows: shifts } = await pool.query(
      `SELECT id FROM shifts WHERE station_id=$1 AND date=$2 AND status='open' LIMIT 1`,
      [req.params.station_id, today]
    );

    // Single efficient query for all tanks
    const shiftId = shifts[0]?.id || null;

    const { rows } = await pool.query(`
      SELECT
        t.id          AS tank_id,
        t.tank_number,
        t.fuel_type,
        t.capacity_ltrs,
        t.current_stock,
        -- Opening dip (NULL when none taken yet — book_stock falls back to current_stock below)
        (
          SELECT dr.volume_ltrs FROM dipstick_readings dr
          WHERE dr.tank_id=t.id AND dr.shift_id=$2
            AND dr.reading_type='opening'
          ORDER BY dr.recorded_at LIMIT 1
        ) AS opening_dip,
        -- Deliveries this shift
        COALESCE((
          SELECT SUM(fd.net_volume_ltrs) FROM fuel_deliveries fd
          WHERE fd.tank_id=t.id AND ($2::uuid IS NULL OR fd.shift_id=$2)
          AND fd.received_at::date=$3
        ), 0) AS deliveries,
        -- Sales this shift
        COALESCE((
          SELECT SUM(de.quantity_ltrs) FROM dispense_events de
          JOIN nozzles n ON n.id=de.nozzle_id
          JOIN shifts sd ON sd.id=de.shift_id
          WHERE n.tank_id=t.id AND ($2::uuid IS NULL OR de.shift_id=$2)
          AND sd.date=$3 AND NOT COALESCE(de.is_voided,FALSE)
        ), 0) AS sales_ltrs,
        -- Closing dip
        (
          SELECT dr.volume_ltrs FROM dipstick_readings dr
          WHERE dr.tank_id=t.id AND dr.shift_id=$2
            AND dr.reading_type='closing'
          ORDER BY dr.recorded_at DESC LIMIT 1
        ) AS closing_dip
      FROM tanks t
      WHERE t.station_id=$1
      ORDER BY t.tank_number`,
      [req.params.station_id, shiftId, today]
    );

    // Calculate book_stock in app layer. Opening base = the opening dip if taken,
    // else the tank's current stock (so book stays sensible before the first dip).
    const result = rows.map(t => {
      const openingBase = t.opening_dip != null ? parseFloat(t.opening_dip) : parseFloat(t.current_stock||0);
      return {
        ...t,
        book_stock: openingBase + parseFloat(t.deliveries||0) - parseFloat(t.sales_ltrs||0),
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/deliveries
router.post('/', authenticate, requireStationAccess({ required: true }), requirePerm('deliveries.view'), async (req, res, next) => {
  try {
    const {
      station_id, tank_id, shift_id,
      dc_number, dc_date, received_at,
      fuel_type, oil_company, depot_name,
      tanker_number, compartment_no,
      gross_volume_ltrs, temperature_c, density,
      batch_number, seal_number,
      rate_per_ltr, freight, total_value, notes,
      invoice_id, invoice_base64, invoice_media_type,
      paid,          // optional: true = prepaid at lift, false/absent = on credit (Accounts module)
      tank_splits,   // optional: [{ tank_id, gross_volume_ltrs }] — one product discharged into >1 tank
    } = req.body;

    // net_volume_ltrs is a GENERATED ALWAYS column — never insert it, Postgres
    // rejects a value for a generated column.
    //
    // It now simply MIRRORS gross_volume_ltrs, i.e. the challan quantity. It used to
    // be round(gross*density*(1-0.0009*(temp-15)),2) whenever both temp and density
    // were present. That was wrong twice over: multiplying litres by density (kg/L)
    // yields KILOGRAMS, and the result was fed straight into tanks.current_stock via
    // the increase_tank_stock() trigger — so a 20,000 L load booked as 14,730 L and
    // the missing 5,270 L looked like a stock loss.
    //
    // The rule now, and don't re-derive it: the invoice volume IS the volume. Density
    // is a QUALITY control (see the density register in routes/dipstick.js) — it tells
    // us the fuel is genuine, never how many litres arrived. Thermal contraction is
    // shown as a variance EXPLANATION on the delivery form; the dip is what actually
    // measures the litres in the ground. The column is kept (rather than dropped)
    // because tank_book_stock and four backend modules read it.

    // Split discharge: one product can be discharged into several tanks. Normalise
    // to a list of lines. Without splits it's the single (tank_id, gross) as before.
    let lines;
    if (Array.isArray(tank_splits) && tank_splits.length) {
      lines = tank_splits
        .map(s => ({ tank_id: s.tank_id, gross: Number(s.gross_volume_ltrs) }))
        .filter(l => l.tank_id && Number.isFinite(l.gross) && l.gross > 0);
      if (!lines.length) return res.status(400).json({ error: 'Each tank split needs a tank and a positive quantity.' });
    } else {
      lines = [{ tank_id, gross: Number(gross_volume_ltrs) }];
    }

    // Re-scope every line's tank to the validated station — reject any from another outlet.
    for (const l of lines) {
      if (!l.tank_id) continue;
      const { rows: tk } = await pool.query('SELECT 1 FROM tanks WHERE id=$1 AND station_id=$2', [l.tank_id, station_id]);
      if (!tk.length) return res.status(400).json({ error: 'A selected tank does not belong to this station.' });
    }

    // Apportion the product's money across the split lines by litre share, so the
    // invoice value = Σ per-tank (litres × rate). The LAST line absorbs the rounding
    // remainder so Σ(line totals) equals the product total to the paise.
    const totalGross = lines.reduce((a, l) => a + l.gross, 0);
    const prodTotal  = total_value != null ? Number(total_value) : null;
    const prodFreight = Number(freight || 0);
    let allocTotal = 0, allocFreight = 0;
    lines.forEach((l, i) => {
      const last = i === lines.length - 1;
      if (prodTotal != null) {
        l.total_value = last ? +(prodTotal - allocTotal).toFixed(2) : +(prodTotal * l.gross / totalGross).toFixed(2);
        allocTotal += l.total_value;
      } else if (rate_per_ltr != null) {
        l.total_value = +(l.gross * Number(rate_per_ltr)).toFixed(2);
      } else {
        l.total_value = null;
      }
      l.freight = last ? +(prodFreight - allocFreight).toFixed(2) : +(prodFreight * l.gross / totalGross).toFixed(2);
      allocFreight += l.freight;
    });

    // Duplicate guard: the same invoice/DC + product + volume + tank is the same
    // delivery line. One invoice carries several products (different fuel) — fine;
    // a split puts the same product into different tanks (different tank/volume) —
    // also fine. Re-submitting the SAME product+volume+tank (double-click, retry,
    // two browsers) is not. App-level check + DB unique index as the race backstop.
    if (dc_number) {
      for (const l of lines) {
        const { rows: dup } = await pool.query(
          `SELECT received_at FROM fuel_deliveries
           WHERE station_id=$1 AND dc_number=$2 AND fuel_type=$3 AND gross_volume_ltrs=$4
             AND tank_id IS NOT DISTINCT FROM $5 LIMIT 1`,
          [station_id, dc_number, fuel_type, l.gross, l.tank_id || null]
        );
        if (dup.length) {
          const when = new Date(dup[0].received_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
          return res.status(409).json({ error: `Already recorded — DC ${dc_number}, ${fuel_type}, ${l.gross}L (on ${when}). Not saved again.` });
        }
      }
    }

    // Attach the scanned invoice. The first compartment of a multi-product invoice
    // stores the file; later compartments pass back the returned invoice_id so they
    // share the one record (no duplicate blobs).
    let invoiceId = invoice_id || null;
    if (!invoiceId && invoice_base64 && invoice_media_type && INVOICE_OK_TYPES.includes(invoice_media_type)) {
      invoiceId = await insertDeliveryInvoice({
        station_id, base64: invoice_base64, media_type: invoice_media_type, uploaded_by: req.user.id,
      });
    } else if (invoiceId) {
      // Re-scope a passed invoice_id to this station — never link another outlet's file.
      const { rows: iv } = await pool.query('SELECT 1 FROM delivery_invoices WHERE id=$1 AND station_id=$2', [invoiceId, station_id]);
      if (!iv.length) invoiceId = null;
    }

    // Insert one row per tank (splits share the DC/invoice/fuel/rate). All-or-nothing
    // in a transaction so a partial split can't leave a lopsided stock picture.
    const created = [];
    // Include `paid` only once the column exists (probe, not try/catch — this runs in a
    // transaction). Absent column → the delivery saves exactly as before, no payment flag.
    const withPaid = await hasDeliveryPaidCol();
    const paidCol  = withPaid ? ',paid' : '';
    const paidVal  = withPaid ? ',$23' : '';
    // NULL when the caller didn't specify — the Accounts paid-prompt sets it right after
    // the save (PATCH /mark-paid). An explicit true/false is honoured if sent inline.
    const paidBool = (paid === true || paid === 'true') ? true
                   : (paid === false || paid === 'false') ? false
                   : null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const l of lines) {
        const { rows: r } = await client.query(
          `INSERT INTO fuel_deliveries(
             station_id,tank_id,shift_id,dc_number,dc_date,received_at,
             fuel_type,oil_company,depot_name,tanker_number,compartment_no,
             gross_volume_ltrs,temperature_c,density,
             batch_number,seal_number,rate_per_ltr,freight,total_value,
             received_by,notes,invoice_id${paidCol}
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22${paidVal})
           RETURNING *`,
          [
            station_id, l.tank_id || null, shift_id||null,
            dc_number||null, dc_date||new Date().toISOString().slice(0,10),
            received_at||new Date(),
            fuel_type, oil_company||null, depot_name||null,
            tanker_number||null, compartment_no||null,
            l.gross, temperature_c||null, density||null,
            batch_number||null, seal_number||null,
            rate_per_ltr||null, l.freight, l.total_value,
            req.user.id, notes||null, invoiceId,
            ...(withPaid ? [paidBool] : []),
          ]
        );
        created.push(r[0]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      // Race backstop: the DB unique index caught a duplicate the app pre-check missed.
      if (e.code === '23505') {
        return res.status(409).json({ error: `Already recorded — DC ${dc_number}, ${fuel_type}. Not saved again.` });
      }
      throw e;
    } finally {
      client.release();
    }

    created.forEach(row => req.io.to(`station:${station_id}`).emit('delivery:new', row));
    // Back-compat: a single line returns the object (as before); a split returns the array.
    res.status(201).json(created.length === 1 ? created[0] : created);
  } catch (err) { next(err); }
});

// GET /api/deliveries
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, tank_id, date_from, date_to, limit=50 } = req.query;
    let q = `
      SELECT fd.*, t.tank_number, t.fuel_type AS tank_fuel,
        u.name AS received_by_name, v.name AS verified_by_name
      FROM fuel_deliveries fd
      LEFT JOIN tanks t ON t.id = fd.tank_id
      LEFT JOIN users u ON u.id = fd.received_by
      LEFT JOIN users v ON v.id = fd.verified_by
      WHERE 1=1`;
    const p = [];
    if (station_id){ p.push(station_id); q+=` AND fd.station_id=$${p.length}`; }
    if (tank_id)   { p.push(tank_id);    q+=` AND fd.tank_id=$${p.length}`; }
    if (date_from) { p.push(date_from);  q+=` AND fd.received_at>=$${p.length}`; }
    if (date_to)   { p.push(date_to);    q+=` AND fd.received_at<=$${p.length}`; }
    p.push(parseInt(limit));
    q += ` ORDER BY fd.received_at DESC LIMIT $${p.length}`;
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /api/deliveries/mark-paid { station_id, ids:[], paid:bool }
// Sets the fuel-purchase payment status the Accounts module reads (prepaid → bank, else
// → creditors). The Deliveries form asks once, after the invoice's products are saved.
// Owner-approved rule-#1 exception (10-Aug-2026). Station-scoped; column-tolerant so it
// no-ops cleanly before migration 016 adds the column.
router.patch('/mark-paid', authenticate, requireStationAccess({ required: true }), requirePerm('deliveries.view'), async (req, res, next) => {
  try {
    const { station_id, ids, paid } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids are required' });
    if (!(await hasDeliveryPaidCol())) return res.json({ ok: true, updated: 0, note: 'paid column not migrated yet' });
    const p = paid === true || paid === 'true';
    const { rowCount } = await pool.query(
      `UPDATE fuel_deliveries SET paid=$1 WHERE id = ANY($2::uuid[]) AND station_id=$3`,
      [p, ids, station_id]);
    res.json({ ok: true, updated: rowCount });
  } catch (err) { next(err); }
});

// Split an LFR invoice across the delivery rows it covers.
//
// 🔴 NOT BY VOLUME ALONE. The OMC charges a DIFFERENT rate per fuel — on an 'A' site
// ₹443.50/KL for MS and ₹369.58/KL for HSD — so a flat per-litre split gets the invoice
// TOTAL right and every per-fuel figure wrong. On the real BPCL invoice (4 KL MS + 8 KL
// HSD, ₹4,730.64) a flat split charges every litre ₹0.3942, when the truth is ₹0.4435
// on petrol and ₹0.3696 on diesel. That is ~1.3% of petrol margin handed to diesel, in
// the same direction every single time. A unit test caught this; by-volume was the first
// thing written here and it was wrong.
//
// The LFR invoice itself does NOT break its total down by fuel — it bills one line,
// "LFR for CC (MS/HSD)" — so the per-fuel rates have to come from the caller
// (`ratesPerKl`, the outlet's site-category card, owner-settable and correctable).
// They are never hardcoded in here, and they are always CHECKED: the caller compares
// Σ(rate × KL) against the invoice total, so a stale card or a mis-billed invoice shows
// up instead of hiding.
//
// With no rates known we fall back to a flat per-litre split and SAY SO (`method`), so
// the caller can tell the owner the attribution is approximate rather than implying a
// precision we do not have.
//
// Rounds to 2dp, and the LAST row absorbs the remainder so the parts sum to the invoice
// EXACTLY. A split that does not add up is one a manager stops trusting the moment he
// totals the column himself — and he will, because we are about to show him the working.
//
// Exported for the tests: the rule is pinned by testing THIS function, not a copy of it.
function apportionLfr(rows, total, ratesPerKl = null) {
  const kl = r => (Number(r.gross_volume_ltrs) || 0) / 1000;
  const rateOf = r => (ratesPerKl && Number(ratesPerKl[r.fuel_type]) > 0)
    ? Number(ratesPerKl[r.fuel_type]) : null;

  // Weight by rate × KL when we know every row's rate; otherwise by volume alone.
  const haveAllRates = rows.length > 0 && rows.every(r => rateOf(r) != null);
  const method = haveAllRates ? 'per_fuel_rate' : 'flat_per_litre';
  const weightOf = r => haveAllRates ? rateOf(r) * kl(r) : (Number(r.gross_volume_ltrs) || 0);

  const totalWeight = rows.reduce((s, r) => s + weightOf(r), 0);
  let running = 0;
  const split = rows.map((r, i) => {
    const share = i === rows.length - 1
      ? +(total - running).toFixed(2)
      : totalWeight > 0 ? +((total * weightOf(r)) / totalWeight).toFixed(2) : 0;
    running = +(running + share).toFixed(2);
    return { id: r.id, fuel_type: r.fuel_type, ltrs: Number(r.gross_volume_ltrs) || 0, lfr: share };
  });
  split.method = method;
  return split;
}

// PATCH /api/deliveries/apply-lfr { station_id, ids:[], lfr_total, lfr_invoice_no }
//
// The OMC bills a lift on TWO invoices: the fuel (VAT, outside GST) and a separate GST
// service invoice for Licence Fee Recovery (SAC 997212), charged PER KL LIFTED. So LFR
// is a genuine per-litre cost of that fuel, and it is apportioned across the rows this
// invoice created BY VOLUME — which is exactly how it was charged, not an allocation we
// invented.
//
// It is a PATCH and not part of the save because a multi-product invoice is recorded one
// product at a time (each chip is its own POST), so the LFR can only be split once every
// fuel line of that invoice exists. Mirrors /mark-paid, which post-sets payment status
// the same way, rather than opening a second delivery-writing path.
//
// Returns the per-row working. A total computed from parts must return the parts
// (CLAUDE.md, 29-Aug) — the manager has to be able to check it against the paper.
router.patch('/apply-lfr', authenticate, requireStationAccess({ required: true }), requirePerm('deliveries.view'), async (req, res, next) => {
  try {
    const { station_id, ids, lfr_total, lfr_invoice_no, file_base64, media_type } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids are required' });
    const total = Number(lfr_total);
    if (!Number.isFinite(total) || total < 0) return res.status(400).json({ error: 'lfr_total must be a non-negative number' });
    if (!(await hasColumn('fuel_deliveries', 'lfr_amount'))) {
      // Nothing was written. Say so — `applied:false` is what the screen reads, because
      // an ok:true that silently stored nothing is the failure mode this whole feature
      // just spent a week proving (0 of 189 rows carried an LFR figure).
      return res.json({ ok: true, applied: false, updated: 0, note: 'lfr_amount column not migrated yet' });
    }
    if (file_base64 && !INVOICE_OK_TYPES.includes(media_type)) {
      return res.status(400).json({ error: 'Upload a photo (JPG/PNG) or a PDF.' });
    }

    // Station-scoped read first: never apportion across another outlet's rows.
    const { rows } = await pool.query(
      `SELECT id, fuel_type, gross_volume_ltrs
         FROM fuel_deliveries
        WHERE id = ANY($1::uuid[]) AND station_id = $2
        ORDER BY gross_volume_ltrs DESC, id`, [ids, station_id]);
    if (!rows.length) return res.status(404).json({ error: 'No deliveries of this outlet matched those ids.' });

    const totalLtrs = rows.reduce((s, r) => s + (Number(r.gross_volume_ltrs) || 0), 0);
    if (!(totalLtrs > 0)) return res.status(400).json({ error: 'Those deliveries carry no volume to apportion across.' });

    // Which rate card explains THIS invoice? Given the volumes and the total the OMC
    // actually billed, only one reconciles — so the site category is read off the paper
    // instead of being asked of the manager or kept as a setting he could get wrong. An
    // explicit rates_per_kl from the caller still wins, for an outlet on a card we do not
    // know. Nothing matched → flat per-litre, and the response says so.
    // The outlet's OMC decides only whether a matched card is VERIFIED for it. Our cards
    // are checked against BPCL alone; four of the five real outlets are HPCL or IOC, so a
    // match there is reported as inferred, never as known.
    const { rows: omcRow } = await pool.query('SELECT oil_company FROM stations WHERE id=$1', [station_id]);
    const oilCompany = omcRow[0]?.oil_company || null;
    const card = req.body.rates_per_kl ? null : matchCard(rows, total, oilCompany);
    const rates = req.body.rates_per_kl || (card && card.rates_per_kl) || null;
    const split = apportionLfr(rows, total, rates);

    // Keep the paper. The LFR invoice is stored exactly like the fuel invoice — same
    // writer, same private bucket, same fallback to inline — so BOTH documents behind a
    // landed cost can be pulled up later (owner-set 18-Sep-2026).
    //
    // 🔴 THE IMAGE NEVER COSTS US THE FIGURE. A failed upload is logged and the money
    // write proceeds: the manager typed a number off the paper in front of him, and
    // losing it because a bucket was slow would be the worse trade. `invoice_stored`
    // tells the screen which of the two happened rather than leaving him guessing.
    // Probed BEFORE the upload so the response can tell the two apart: bytes STORED and
    // bytes LINKED to this delivery are different facts, and between the Railway deploy
    // and the owner running the DDL only the first is possible. We still store the paper
    // — losing the invoice he just photographed would be the worse outcome — but we do
    // not tell him it is attached to the delivery when nothing points at it yet.
    const haveLfrDocCol = await hasColumn('fuel_deliveries', 'lfr_invoice_id');
    let lfrInvoiceId = null;
    if (file_base64 && media_type) {
      try {
        lfrInvoiceId = await insertDeliveryInvoice({
          station_id, base64: file_base64, media_type,
          uploaded_by: req.user.id, kind: 'lfr',
        });
      } catch (e) {
        lfrInvoiceId = null;
        try { require('../utils/logger').warn('apply-lfr: LFR invoice image not stored: ' + (e.message || e)); } catch { /* noop */ }
      }
    }

    // `lfr_invoice_id` is additive and owner-migrated, so the UPDATE falls back to the
    // amount-only shape until the DDL lands. A missing column must never cost the figure
    // (CLAUDE.md, deploy ordering) — and is never try-and-caught for a 42703.
    const setDocCol = (haveLfrDocCol && lfrInvoiceId) ? ', lfr_invoice_id = $5' : '';
    const params = [split.map(s => s.id), split.map(s => s.lfr), lfr_invoice_no || null, station_id];
    if (setDocCol) params.push(lfrInvoiceId);
    const { rowCount } = await pool.query(
      `UPDATE fuel_deliveries fd
          SET lfr_amount = v.amt, lfr_invoice_no = $3${setDocCol}
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::numeric[]) AS amt) v
        WHERE fd.id = v.id AND fd.station_id = $4`,
      params);

    res.json({
      ok: true, applied: rowCount > 0, updated: rowCount,
      total_ltrs: totalLtrs, lfr_total: total,
      method: split.method,
      // Did the document itself land, and is it attached? Two separate facts, reported
      // separately, so the manager is never told an image is on file when the upload
      // dropped — nor that it is attached when only the bytes were saved.
      invoice_stored: !!lfrInvoiceId,
      invoice_linked: !!(lfrInvoiceId && haveLfrDocCol),
      lfr_invoice_id: lfrInvoiceId,
      // What we worked out about the outlet, and how well it fits the paper. Shown to the
      // manager rather than kept to ourselves — he is the one who can tell us we are wrong.
      site_category: card ? card.category : null,
      card_note:     card ? card.note : null,
      expected:      card ? card.expected : null,
      delta:         card ? card.delta : null,
      oil_company:   oilCompany,
      // FALSE when the card reconciles but has never been checked against THIS outlet's
      // oil company. The split still uses it — the arithmetic is the evidence — but the
      // screen must say inferred, not known.
      card_verified: card ? card.verified : null,
      split,
    });
  } catch (err) { next(err); }
});

// PATCH /api/deliveries/:id/verify
router.patch('/:id/verify', authenticate, requireStationVia('SELECT station_id FROM fuel_deliveries WHERE id=$1', 'id'), requirePerm('deliveries.view'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE fuel_deliveries SET verified_by=$1, verified_at=NOW()
       WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/deliveries/:id/invoice[?kind=lfr] — a stored scan attached to a delivery.
// Migrated rows live in the private doc bucket → we return { media_type, url }
// (a short-lived signed URL). Un-migrated rows still hold base64 → we return
// { media_type, file_base64 }. Column-tolerant: works before/after the DDL adds
// `storage_path`. Station-scoped.
//
// TWO documents can sit behind one delivery: the fuel invoice (`invoice_id`, the
// default) and the LFR invoice (`lfr_invoice_id`, `?kind=lfr`). One route, one
// permission, one resolver — the kind only picks which foreign key to follow, because a
// second route for the second piece of paper is exactly the drift we keep undoing.
router.get('/:id/invoice', authenticate,
  requireStationVia('SELECT station_id FROM fuel_deliveries WHERE id=$1', 'id'),
  async (req, res, next) => {
  try {
    const wantLfr = req.query.kind === 'lfr';
    // Asking for the LFR document before the DDL has added its pointer is a plain
    // "nothing attached", not a 500: the column is probed, never named blind.
    if (wantLfr && !(await hasColumn('fuel_deliveries', 'lfr_invoice_id'))) {
      return res.status(404).json({ error: 'No LFR invoice attached to this delivery.' });
    }
    const fk = wantLfr ? 'fd.lfr_invoice_id' : 'fd.invoice_id';
    let row;
    try {
      const { rows } = await pool.query(
        `SELECT di.media_type, di.file_base64, di.storage_path
         FROM fuel_deliveries fd JOIN delivery_invoices di ON di.id = ${fk}
         WHERE fd.id = $1`, [req.params.id]);
      row = rows[0];
    } catch (e) {
      if (e.code !== '42703') throw e;   // storage_path not migrated yet → legacy select
      const { rows } = await pool.query(
        `SELECT di.media_type, di.file_base64
         FROM fuel_deliveries fd JOIN delivery_invoices di ON di.id = ${fk}
         WHERE fd.id = $1`, [req.params.id]);
      row = rows[0];
    }
    if (!row) return res.status(404).json({
      error: wantLfr ? 'No LFR invoice attached to this delivery.' : 'No invoice attached to this delivery.' });
    if (row.storage_path) {
      try {
        const url = await signedDocUrl(row.storage_path);
        return res.json({ media_type: row.media_type, url });
      } catch (e) {
        try { require('../utils/logger').error('invoice signed-url failed: ' + (e.message || e)); } catch { /* noop */ }
        if (row.file_base64) return res.json({ media_type: row.media_type, file_base64: row.file_base64 });
        return res.status(503).json({ error: 'Could not load the invoice right now — try again.' });
      }
    }
    return res.json({ media_type: row.media_type, file_base64: row.file_base64 });
  } catch (err) { next(err); }
});

// POST /api/deliveries/parse-invoice — read an oil-company TT invoice/DC (photo
// OR pdf, straight from mobile) and return structured line-items to PRE-FILL the
// delivery form. Nothing is saved here; the manager verifies + confirms on the
// form. Mirrors the meter-photo OCR pattern in reconcile.js.
const INVOICE_OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const INVOICE_PROMPT = `You extract structured data from an Indian oil-company fuel tank-truck delivery invoice / DC challan (IOCL/Indian Oil, HPCL, BPCL, etc.). Input may be a clean PDF or a phone photo, and ONE invoice usually carries MULTIPLE products (one per tanker compartment).

Return ONLY a JSON object (no prose, no markdown) of this exact shape:
{
 "oil_company": "IOC|HPCL|BPCL|Essar|Shell|Reliance|Nayara|null",
 "dc_number": "delivery/invoice number string or null",
 "dc_date": "YYYY-MM-DD or null",
 "received_at": "YYYY-MM-DDTHH:MM (from the invoice date + time) or null",
 "depot_name": "terminal/depot name or null",
 "tanker_number": "vehicle / TT number or null",
 "consignee_name": "buyer / consignee station name or null",
 "consignee_code": "buyer code or null",
 "seal_number": "seal/lock number(s) or null",
 "invoice_total_value": number or null,
 "items": [{
   "fuel_type": "petrol|diesel|premium_petrol|cng",
   "product_name": "as printed (HSD-BSV, MS/EBMS, XtraPremium, ...)",
   "compartment_no": "string or null",
   "tank_code": "truck tank code (e.g. T003) or null",
   "quantity_kl": number or null,
   "gross_volume_ltrs": number (LITRES = KL*1000),
   "density": number (kg/L @15C, e.g. 0.7522),
   "rate_per_ltr": number — the ALL-INCLUSIVE cost per litre = total_value / gross_volume_ltrs (NOT the ex-depot basic rate); or null,
   "total_value": number — the product's FULL all-inclusive total in ₹ (every component added together), NOT the pre-tax basic value; or null,
   "sample_no": "string or null",
   "hsn": "string or null"
 }],
 "confidence": "high|medium|low",
 "notes": "anything unclear/unreadable"
}

Rules:
- fuel_type: MS / EBMS / Motor Spirit / Petrol -> "petrol"; HSD / Diesel -> "diesel"; XtraPremium / Speed / Power / branded premium -> "premium_petrol"; CNG -> "cng".
- gross_volume_ltrs is LITRES: convert KL x 1000.
- density is kg/L @15C. If printed as kg/m3 (e.g. 752.200 / 837.900) divide by 1000 -> 0.7522 / 0.8379.
- total_value = the product's FULL taxes-included total. Two invoice styles:
  (a) IOCL prints a single per-product "Total for material" line — use it directly.
  (b) HPCL itemises components with NO combined line — under the product (e.g. MS / HSD) there are separate amount rows: basic value, A/R VAT %, LF Recovery, Idn SSLF Recovery (and any cess/duty). ADD all of that product's amount rows together = its total_value.
  NEVER use the basic / assessable / taxable value alone (pre-tax). We only need the per-product TOTAL — do not return the individual components.
- TAX/RECOVERY ROWS ARE ALWAYS ADDED, NEVER SUBTRACTED. A/R VAT, LF Recovery, SSLF/Idn SSLF Recovery, cess and duty are charges PAYABLE — add every one to the basic value. They are never deductions or credits. If OCR shows a stray minus sign next to one (e.g. "144,471.66-"), it is noise — use the POSITIVE value. So for HPCL, total_value = basic + |VAT| + |LF| + |SSLF| + |any other tax row|.
- CROSS-CHECK IS MANDATORY: the sum of every product's total_value MUST equal the invoice grand "Total Value" to the paise (e.g. MS 1005427.11 + HSD 506479.91 = 1511907.02). If they don't reconcile, you have MISREAD a component row — re-read the amount column and recompute until Σ(items) == grand total. NEVER output a per-product total_value that contradicts your own component arithmetic, and NEVER output items whose totals don't sum to the grand total. If after re-reading you genuinely cannot make them reconcile, set confidence "low" and explain exactly which figure is unreadable in notes.
- invoice_total_value = the invoice grand "Total Value" (the printed total incl. taxes). Read this carefully — it is the anchor the per-product totals must sum to.
- rate_per_ltr = total_value ÷ gross_volume_ltrs (the all-inclusive landed cost per litre, typically ₹95-125). Do NOT read the ex-depot basic per-KL rate.
- One item per product/compartment. If a value is missing or not legible, use null and say so in notes. NEVER guess.`;

// ── Google Vision OCR pre-pass (optional) ─────────────────────────────────
// The reasoning, the timeout and the degrade-to-null contract now live in ONE
// place — services/visionOcr.js — shared with the expense-bill scanner and the
// dispenser-slip reader. This file used to carry its own identical copy.
const { visionOcr: googleVisionOcr } = require('../services/visionOcr');

// Structure OCR text into our JSON shape via a TEXT-only Claude call. Returns the
// parsed object, or null on any miss so the caller falls back to Claude vision.
// The LFR invoice is a DIFFERENT document from the fuel invoice: one GST service line,
// SAC 997212, charged per KL lifted. It carries no tanker, no tank and no density, so it
// gets its own prompt rather than being forced through the fuel-invoice shape.
//
// 🔴 WE ASK FOR WHAT IS PRINTED, AND NOTHING ELSE. The per-fuel breakdown (MS at one
// rate, HSD at another) is NOT on the paper — the OMC bills a single "LFR for CC
// (MS/HSD)" line (config/lfrRates.js). So the model is told to report the line as it
// reads and to leave a figure NULL when it cannot see it. A null the manager fills in
// beats a plausible number we inferred for him.
const LFR_INVOICE_PROMPT = `You extract structured data from an Indian oil-company LICENCE FEE RECOVERY (LFR) invoice — a GST service invoice (typically SAC 997212, item code 4395 "LFR Recovery") that the oil company raises BESIDE the fuel invoice for the same lift. Input may be a clean PDF or a phone photo.

Return ONLY a JSON object, no prose, with these keys:
{
  "invoice_number":  string or null,   // the LFR invoice number, e.g. "FIIN112710061073"
  "invoice_date":    string or null,   // ISO yyyy-mm-dd if you can read it, else null
  "fuel_invoice_number": string or null, // the fuel/tax invoice it references, if printed
  "taxable_value":   number or null,   // the TAXABLE value, BEFORE GST
  "gst_pct":         number or null,   // 18 or 28, if printed
  "gst_amount":      number or null,
  "total_value":     number or null,   // invoice grand total, INCLUDING GST
  "sac_code":        string or null,
  "description":     string or null,   // the line description exactly as printed
  "confidence":      "high" | "medium" | "low",
  "notes":           string or null    // anything unreadable or that looks off
}

RULES:
- taxable_value is the figure BEFORE GST. If the paper shows only a grand total and a GST
  rate, still report total_value and gst_pct and leave taxable_value null — do NOT
  back-calculate it.
- Never invent a figure you cannot see. null is a correct answer.
- Do NOT split the amount by product even if the description mentions MS and HSD; report
  the single printed line.
- Indian number formats: 4,730.64 is four thousand seven hundred thirty point six four.
- Dates on these invoices are DD/MM/YYYY or DD-MMM-YYYY. Never read them as MM/DD.`;

// Same OCR→text structuring as the fuel invoice, against the LFR prompt. Returns the
// parsed object or null on any miss, so the caller can fall back to Claude vision.
async function structureLfrText(ocrText) {
  let msg;
  try {
    msg = await ai.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1500,
      messages: [{ role: 'user', content: [{ type: 'text',
        text: `${LFR_INVOICE_PROMPT}\n\nBelow is OCR-extracted text from the invoice (layout may be imperfect — rely on the labels):\n\n${ocrText}` }] }],
    });
  } catch (e) {
    try { require('../utils/logger').error('parse-invoice (lfr ocr->text) Claude error: ' + (e.message || e)); } catch { /* noop */ }
    return null;
  }
  const txt = (msg.content.find(b => b.type === 'text')?.text || '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// An LFR read is USABLE when it gives us a money figure to confirm. Everything else on
// the document is nice-to-have; without a value there is nothing for the manager to
// check, so we say so and let him type it.
function lfrUsable(p) {
  return !!p && (Number(p.taxable_value) > 0 || Number(p.total_value) > 0);
}

// Derive the taxable value from the total ONLY when the paper stated the rate, and mark
// it as derived so the screen can say so. The prompt deliberately refuses to do this;
// doing it here keeps the arithmetic visible and labelled rather than hidden in a model.
function withLfrDerivation(p) {
  try {
    const taxable = Number(p.taxable_value);
    const total   = Number(p.total_value);
    const pct     = Number(p.gst_pct);
    if (!(taxable > 0) && total > 0 && pct > 0) {
      p.taxable_value = +(total / (1 + pct / 100)).toFixed(2);
      p.taxable_derived = true;
    } else {
      p.taxable_derived = false;
    }
    // Cross-check when all three are printed: taxable + GST should be the total.
    if (Number(p.taxable_value) > 0 && total > 0) {
      const gst = Number(p.gst_amount) > 0
        ? Number(p.gst_amount)
        : (pct > 0 ? Number(p.taxable_value) * pct / 100 : 0);
      p.reconciled = Math.abs((Number(p.taxable_value) + gst) - total) <= 1;
    }
  } catch { /* annotation only — never block a scan */ }
  return p;
}

async function structureInvoiceText(ocrText) {
  let msg;
  try {
    msg = await ai.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 4000,
      messages: [{ role: 'user', content: [{ type: 'text',
        text: `${INVOICE_PROMPT}\n\nBelow is OCR-extracted text from the invoice (layout may be imperfect — rely on the labels and the CROSS-CHECK that products sum to the grand Total Value):\n\n${ocrText}` }] }],
    });
  } catch (e) {
    try { require('../utils/logger').error('parse-invoice (ocr->text) Claude error: ' + (e.message || e)); } catch { /* noop */ }
    return null;
  }
  const txt = (msg.content.find(b => b.type === 'text')?.text || '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// Reconciliation guard: flag whether the per-product totals add up to the printed
// grand "Total Value". A mismatch means a money figure was misread — we surface
// `reconciled:false` so the form warns the manager to verify, instead of silently
// trusting wrong totals. Never blocks the scan; just annotates it.
function withReconciliation(parsed) {
  try {
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const sum   = items.reduce((s, it) => s + (Number(it.total_value) || 0), 0);
    const grand = Number(parsed.invoice_total_value) || 0;
    parsed.items_total = +sum.toFixed(2);
    // Tolerate sub-rupee rounding only; anything more is a genuine misread.
    parsed.reconciled  = grand > 0 && items.length > 0 && Math.abs(sum - grand) <= 1;
  } catch { /* noop */ }
  return parsed;
}

router.post('/parse-invoice', authenticate, requireStationAccess({ required: true }), requirePerm('deliveries.view'), async (req, res, next) => {
  try {
    const { file_base64, media_type } = req.body;
    if (!file_base64 || !media_type) return res.status(400).json({ error: 'file_base64 and media_type are required' });
    if (!INVOICE_OK_TYPES.includes(media_type)) return res.status(400).json({ error: 'Upload a photo (JPG/PNG) or a PDF.' });

    // Which document is this? The LFR invoice is read by the SAME endpoint under the
    // same guards — a second route for a second piece of paper is the drift this repo
    // spent months undoing (CLAUDE.md, cardinal rule). Anything but 'lfr' is the fuel
    // invoice, so every existing caller keeps its exact behaviour.
    const docType   = req.body.doc_type === 'lfr' ? 'lfr' : 'fuel';
    const prompt    = docType === 'lfr' ? LFR_INVOICE_PROMPT : INVOICE_PROMPT;
    const structure = docType === 'lfr' ? structureLfrText     : structureInvoiceText;
    const usable    = docType === 'lfr'
      ? lfrUsable
      : (pp => pp && Array.isArray(pp.items) && pp.items.length > 0);
    const shape     = docType === 'lfr' ? withLfrDerivation : withReconciliation;

    // Preferred path: Google Vision OCR → Claude text structuring (robust on
    // smudged HPCL phone photos). Any miss falls through to Claude vision below.
    try {
      const ocrText = await googleVisionOcr(file_base64);
      if (ocrText && ocrText.replace(/\s/g, '').length > 60) {
        const parsedOcr = await structure(ocrText);
        if (usable(parsedOcr)) {
          return res.json(shape(parsedOcr));
        }
      }
    } catch (e) {
      try { require('../utils/logger').warn('parse-invoice OCR pre-pass failed: ' + (e.message || e)); } catch { /* noop */ }
    }

    const fileBlock = media_type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type, data: file_base64 } }
      : { type: 'image',    source: { type: 'base64', media_type, data: file_base64 } };

    let msg;
    try {
      msg = await ai.messages.create({
        // 4000 so a multi-product invoice's JSON isn't truncated mid-object.
        model: 'claude-sonnet-4-6', max_tokens: 4000,
        messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }],
      });
    } catch (e) {
      try { require('../utils/logger').error('parse-invoice API error: ' + (e.message || e)); } catch { /* noop */ }
      return res.status(503).json({ error: 'Invoice scanning is unavailable right now — enter the details manually.' });
    }

    const txt = (msg.content.find(b => b.type === 'text')?.text || '').trim();
    // Grab the JSON object from the reply (tolerates ```json fences / stray prose).
    const m = txt.match(/\{[\s\S]*\}/);
    let parsed;
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
    if (!parsed) {
      try { require('../utils/logger').warn(`parse-invoice unparsed (stop=${msg.stop_reason}): ${txt.slice(0, 400)}`); } catch { /* noop */ }
      return res.status(422).json({ error: 'Could not read the invoice — enter the details manually.' });
    }
    if (docType === 'lfr') {
      // No money figure read → say so plainly and let him type it. Four words, then out
      // of his way (CLAUDE.md, 31-Aug): a bad photograph is not ours to engineer around.
      if (!lfrUsable(parsed)) {
        return res.status(422).json({ error: 'Could not read the LFR invoice — enter the amount manually.' });
      }
      return res.json(withLfrDerivation(parsed));
    }
    if (!Array.isArray(parsed.items)) parsed.items = [];
    res.json(withReconciliation(parsed));
  } catch (err) { next(err); }
});

module.exports = router;

// Exported for the unit tests, the same way dipstick.js exposes withGaugeChecks: the
// test pins the REAL apportionment, not a second copy of the rule that can drift.
module.exports.apportionLfr = apportionLfr;

// Same reason, for the LFR invoice READ: `lfrUsable` decides whether a scan is worth
// showing him at all, and `withLfrDerivation` is the only place a taxable value is ever
// worked back from a total. Both decide what a manager is asked to confirm as a cost, so
// they are pinned by testing THESE functions.
module.exports.lfrUsable = lfrUsable;
module.exports.withLfrDerivation = withLfrDerivation;
