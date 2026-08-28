// SPOKE 1 — THE RECON RECORD. One writer for the concept.
//
// A recon is ONE ACT AT ONE MOMENT: the ATG read and every nozzle read, captured
// together. That shared instant is the tank window's boundary, and it is the whole
// point — the tank window and the nozzle totals cannot disagree about when they
// start and stop, because they were taken at the same moment.
//
// WHY THE WINDOW IS NOT A DAY. tankReco reconciles over a SHIFT or a DATE RANGE.
// A recon reconciles between two of its own ATG readings, which are instants. The
// windows differ; the ARITHMETIC does not, and it lives once in lib/varianceMath so
// neither flow can hold its own version of the sum.
//
// PROBED, NEVER TRY-AND-CAUGHT. The three tables are owner-run DDL, so this code
// deploys first. A catalog SELECT succeeds either way and cannot poison a
// transaction; a failing statement inside BEGIN..COMMIT aborts the whole thing and
// the fallback query dies with it. Cached only once TRUE, so the first call after
// the owner runs the DDL picks it up with no restart.
const pool = require('../db/pool');
const { reconcileTank, toleranceFor } = require('../lib/varianceMath');

let _hasTables = false;
async function hasReconTables() {
  if (_hasTables) return true;
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='public'
          AND table_name IN ('tank_recons','tank_recon_tanks','tank_recon_nozzles')`);
    _hasTables = rows[0]?.n === 3;
  } catch { _hasTables = false; }
  return _hasTables;
}

// CNG is sold by weight and never dipped — it is not part of a tank recon, exactly as
// the dip-staleness flags already exclude it.
const DIPPABLE = `LOWER(COALESCE(t.fuel_type,'')) <> 'cng'`;

// The most recent CONFIRMED recon. A draft is not a boundary: it is a man's unfinished
// work, and the next window must not start from a figure he has not stood behind.
async function lastConfirmed(station_id, client = pool) {
  if (!(await hasReconTables())) return null;
  const { rows } = await client.query(
    `SELECT r.*, u.name AS confirmed_by_name
       FROM tank_recons r LEFT JOIN users u ON u.id = r.confirmed_by
      WHERE r.station_id=$1 AND r.status='confirmed'
      ORDER BY r.taken_at DESC LIMIT 1`, [station_id]);
  if (!rows.length) return null;
  const recon = rows[0];
  const { rows: tanks } = await client.query(
    `SELECT rt.*, t.tank_number, t.fuel_type
       FROM tank_recon_tanks rt JOIN tanks t ON t.id = rt.tank_id
      WHERE rt.recon_id=$1 ORDER BY t.tank_number`, [recon.id]);
  return { ...recon, tanks };
}

// The open draft, if he has one. At most one per outlet: a second draft would be two
// men reconciling the same tanks over overlapping windows, and the later confirm would
// silently win.
async function openDraft(station_id, client = pool) {
  if (!(await hasReconTables())) return null;
  const { rows } = await client.query(
    `SELECT * FROM tank_recons
      WHERE station_id=$1 AND status='draft'
      ORDER BY taken_at DESC LIMIT 1`, [station_id]);
  return rows[0] || null;
}

async function withFigures(recon, client = pool) {
  if (!recon) return null;
  const [{ rows: tanks }, { rows: nozzles }] = await Promise.all([
    client.query(
      `SELECT rt.*, t.tank_number, t.fuel_type, t.capacity_ltrs
         FROM tank_recon_tanks rt JOIN tanks t ON t.id = rt.tank_id
        WHERE rt.recon_id=$1 ORDER BY t.tank_number`, [recon.id]),
    client.query(
      `SELECT rn.* FROM tank_recon_nozzles rn WHERE rn.recon_id=$1`, [recon.id]),
  ]);
  return { ...recon, tanks, nozzles };
}

// CREATE-OR-GET, never a second draft. Returns the draft with whatever figures it
// already carries, so a manager who closed the tab resumes rather than restarts.
async function startDraft(station_id, user_id) {
  if (!(await hasReconTables())) return null;
  const existing = await openDraft(station_id);
  if (existing) return withFigures(existing);
  const { rows } = await pool.query(
    `INSERT INTO tank_recons(station_id, created_by) VALUES($1,$2) RETURNING *`,
    [station_id, user_id]);
  return withFigures(rows[0]);
}

// SAVED BEFORE HE DECIDES. Every figure he touches lands on the draft immediately, so
// a recon survives a dropped connection, a locked phone or a closed tab. Upserts, so
// the screen may send the whole set every time without minding what changed.
async function saveFigures(recon_id, { tanks = [], nozzles = [] } = {}) {
  if (!(await hasReconTables())) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query(
      `SELECT * FROM tank_recons WHERE id=$1 FOR UPDATE`, [recon_id]);
    const recon = cur[0];
    if (!recon) { await client.query('ROLLBACK'); return null; }
    // A CONFIRMED RECON IS FROZEN. It is the boundary the next window starts from, and
    // a figure edited after the fact would move a window somebody already stood behind.
    if (recon.status !== 'draft') { await client.query('ROLLBACK'); return { locked: true, recon }; }

    for (const t of tanks) {
      if (!t?.tank_id) continue;
      await client.query(
        `INSERT INTO tank_recon_tanks(recon_id, tank_id, volume_ltrs, dip_mm, source)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (recon_id, tank_id) DO UPDATE
           SET volume_ltrs=EXCLUDED.volume_ltrs, dip_mm=EXCLUDED.dip_mm, source=EXCLUDED.source`,
        [recon_id, t.tank_id, num(t.volume_ltrs), num(t.dip_mm), src(t.source)]);
    }
    for (const n of nozzles) {
      if (!n?.nozzle_id) continue;
      await client.query(
        `INSERT INTO tank_recon_nozzles(recon_id, nozzle_id, cumulative_volume,
            cumulative_amount, source, read_pump_serial, read_nozzle_no)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (recon_id, nozzle_id) DO UPDATE
           SET cumulative_volume=EXCLUDED.cumulative_volume,
               cumulative_amount=EXCLUDED.cumulative_amount,
               source=EXCLUDED.source,
               read_pump_serial=EXCLUDED.read_pump_serial,
               read_nozzle_no=EXCLUDED.read_nozzle_no`,
        [recon_id, n.nozzle_id, num(n.cumulative_volume), num(n.cumulative_amount),
         src(n.source), n.read_pump_serial || null, n.read_nozzle_no || null]);
    }
    await client.query(`UPDATE tank_recons SET updated_at=now() WHERE id=$1`, [recon_id]);
    await client.query('COMMIT');
    return withFigures((await pool.query(`SELECT * FROM tank_recons WHERE id=$1`, [recon_id])).rows[0]);
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}

// THE VARIANCE, over this recon's own window.
//
//   opening    the previous CONFIRMED recon's figure for that tank
//   deliveries what landed between the two moments
//   sales      each nozzle's movement between the two moments — the same instants,
//              which is the entire reason this flow exists
//   testMove   only draws that CROSSED tanks; a same-tank draw left and came back
//
// Returned rather than written, so the screen can show the manager what he is about to
// confirm before anything is frozen.
async function computeVariance(recon_id, client = pool) {
  if (!(await hasReconTables())) return null;
  const { rows: rr } = await client.query(`SELECT * FROM tank_recons WHERE id=$1`, [recon_id]);
  const recon = rr[0];
  if (!recon) return null;

  const prev = await lastConfirmed(recon.station_id, client);
  const from = prev ? prev.taken_at : null;

  const { rows } = await client.query(
    `SELECT t.id AS tank_id, t.tank_number, t.fuel_type, t.capacity_ltrs,
            rt.volume_ltrs AS actual,
            prev.volume_ltrs AS opening,
            COALESCE((
              SELECT SUM(fd.net_volume_ltrs) FROM fuel_deliveries fd
               WHERE fd.tank_id = t.id
                 AND ($3::timestamptz IS NULL OR fd.received_at > $3)
                 AND fd.received_at <= $4
            ), 0) AS deliveries_ltrs,
            -- SALES BETWEEN THE SAME TWO MOMENTS the tank was read at. A totaliser only
            -- counts up, so a negative movement is a reset or a misread and is dropped
            -- to zero rather than credited as fuel returning to the tank.
            COALESCE((
              SELECT SUM(GREATEST(rn.cumulative_volume - COALESCE(pn.cumulative_volume, rn.cumulative_volume), 0))
                FROM tank_recon_nozzles rn
                JOIN nozzles nz ON nz.id = rn.nozzle_id
                LEFT JOIN tank_recon_nozzles pn
                       ON pn.nozzle_id = rn.nozzle_id AND pn.recon_id = $5
               WHERE rn.recon_id = $1 AND nz.tank_id = t.id
            ), 0) AS sales_ltrs,
            -- Only a CROSS-tank draw moves stock: the source is genuinely down and the
            -- destination genuinely up. A same-tank draw cancels itself.
            COALESCE((
              SELECT SUM(CASE WHEN ftd.to_tank_id = t.id THEN ftd.litres ELSE -ftd.litres END)
                FROM fuel_test_draws ftd
               WHERE ftd.from_tank_id <> ftd.to_tank_id
                 AND (ftd.to_tank_id = t.id OR ftd.from_tank_id = t.id)
                 AND ($3::timestamptz IS NULL OR ftd.drawn_at > $3)
                 AND ftd.drawn_at <= $4
            ), 0) AS test_move_ltrs
       FROM tanks t
       LEFT JOIN tank_recon_tanks rt ON rt.tank_id = t.id AND rt.recon_id = $1
       LEFT JOIN tank_recon_tanks prev ON prev.tank_id = t.id AND prev.recon_id = $5
      WHERE t.station_id = $2 AND ${DIPPABLE}
      ORDER BY t.tank_number`,
    [recon_id, recon.station_id, from, recon.taken_at, prev ? prev.id : null]);

  const { rows: st } = await client.query(
    `SELECT COALESCE(stock_tol_pct_petrol, 0.75) AS pct_petrol,
            COALESCE(stock_tol_pct_diesel, 0.50) AS pct_diesel,
            COALESCE(stock_tol_floor_ltrs, 20)   AS floor
       FROM station_settings WHERE station_id=$1`, [recon.station_id]);
  const s = st[0] || { pct_petrol: 0.75, pct_diesel: 0.5, floor: 20 };
  const pctFor = fuel => String(fuel || '').toLowerCase().includes('diesel')
    ? Number(s.pct_diesel) : Number(s.pct_petrol);

  const tanks = rows.map(r => {
    const m = reconcileTank({
      opening: r.opening, deliveries: r.deliveries_ltrs,
      sales: r.sales_ltrs, testMove: r.test_move_ltrs, actual: r.actual,
    });
    const tolerance = toleranceFor({ base: m.base, pct: pctFor(r.fuel_type), floor: Number(s.floor) });
    return {
      tank_id: r.tank_id, tank_number: r.tank_number, fuel_type: r.fuel_type,
      opening_ltrs: numOrNull(r.opening),
      delivered_ltrs: Number(r.deliveries_ltrs) || 0,
      sales_ltrs: Number(r.sales_ltrs) || 0,
      testing_ltrs: Number(r.test_move_ltrs) || 0,
      actual_ltrs: numOrNull(r.actual),
      book_ltrs: m.book, variance_ltrs: m.variance,
      tolerance_ltrs: tolerance,
      beyond_tolerance: m.variance != null ? Math.abs(m.variance) > tolerance : false,
    };
  });

  return {
    recon_id, station_id: recon.station_id,
    window_from: from, window_to: recon.taken_at,
    // NO BASELINE IS A STATE, NOT AN ERROR. The first recon at an outlet has nothing
    // behind it, and saying so is honest; inventing an opening is how a phantom loss
    // gets its first airing.
    first_recon: !prev,
    tanks,
  };
}

// FREEZE IT. The arithmetic is written onto the row so a confirmed recon explains
// itself from its own record rather than by recomputation against data that has since
// moved. From here it is the boundary the next window starts from.
async function confirm(recon_id, user_id) {
  if (!(await hasReconTables())) return null;
  const v = await computeVariance(recon_id);
  if (!v) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query(
      `SELECT * FROM tank_recons WHERE id=$1 FOR UPDATE`, [recon_id]);
    if (!cur.length) { await client.query('ROLLBACK'); return null; }
    if (cur[0].status !== 'draft') { await client.query('ROLLBACK'); return { locked: true, recon: cur[0] }; }

    for (const t of v.tanks) {
      await client.query(
        `UPDATE tank_recon_tanks
            SET opening_ltrs=$3, delivered_ltrs=$4, sales_ltrs=$5,
                testing_ltrs=$6, book_ltrs=$7, variance_ltrs=$8
          WHERE recon_id=$1 AND tank_id=$2`,
        [recon_id, t.tank_id, t.opening_ltrs, t.delivered_ltrs, t.sales_ltrs,
         t.testing_ltrs, t.book_ltrs, t.variance_ltrs]);
    }
    const { rows } = await client.query(
      `UPDATE tank_recons SET status='confirmed', confirmed_at=now(), confirmed_by=$2,
              updated_at=now()
        WHERE id=$1 AND status='draft' RETURNING *`, [recon_id, user_id]);
    await client.query('COMMIT');
    return withFigures(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}

// START AGAIN MARKS IT ABANDONED AND KEEPS IT. A recon that vanishes when a man
// changes his mind is a recon he will not start twice.
async function abandon(recon_id) {
  if (!(await hasReconTables())) return null;
  const { rows } = await pool.query(
    `UPDATE tank_recons SET status='abandoned', updated_at=now()
      WHERE id=$1 AND status='draft' RETURNING *`, [recon_id]);
  return rows[0] || null;
}

const num = v => (v === '' || v === null || v === undefined) ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
const numOrNull = v => v == null ? null : Number(v);
const src = v => (v === 'photo' || v === 'typed') ? v : null;

module.exports = {
  hasReconTables, lastConfirmed, openDraft, startDraft,
  saveFigures, computeVariance, confirm, abandon,
};
