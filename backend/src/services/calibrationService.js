// src/services/calibrationService.js
//
// 🔴 ONE WRITER for "which calibration does this tank use".
//
// A tank is calibrated by its PHYSICAL DIMENSIONS — diameter x length in cm — and
// by nothing else. The caller sends the dimensions; this resolves them to a chart
// row, creating one the first time a given size is seen. Every path that assigns a
// calibration funnels through here: the tank form in Settings
// (POST/PATCH /stations/:id/tanks) and the Dipstick screen
// (PATCH /calibration/tank/:tank_id).
//
// ─── WHY THE NOMINAL SIZE IS GONE (owner-set 2026-08-25) ────────────────────────
//
// The library used to be a dropdown of nominal sizes — 15KL, 16KL, 20KL, 22KL —
// picked at setup. Two things made that dangerous, and both bit on the same day:
//
//   1. A NOMINAL SIZE IS NOT A TANK. Sri Balaji's petrol tank and Highway's are
//      both called "16 KL". Sri Balaji's is radius 101 x 500 (16,024 L of shell);
//      the "16KL" row is 200 x 550 (17,279 L). Same name, different vessels,
//      1,255 L apart. Pumpini read that tank 726 L high on 15-Aug and 650 L high
//      on 25-Aug -- an error that GROWS with the level, so no correction factor
//      could ever have hidden it. The dealer had supplied the wrong chart sheet at
//      onboarding and nothing in the setup screen could have caught it, because
//      the screen only ever asked "which size?".
//
//   2. THE ROWS ARE SHARED ACROSS OUTLETS. That single "16KL" row served SEVEN
//      tanks at SIX outlets. Correcting it in place for one outlet would have
//      silently changed the dip->litres conversion at Highway and Adhoc Highway
//      at the same instant. A one-tank fix becomes a three-outlet incident, on a
//      row nobody thought to check.
//
// So: dimensions in, chart out. Rows are still SHARED when the dimensions genuinely
// match -- that is the owner's rule and it keeps the library small -- but they are
// now keyed on the only thing that is actually the same about two such tanks.
//
// ─── THE TRAP THAT COST A MORNING ──────────────────────────────────────────────
//
// HP prints the RADIUS on its calibration sheets; we store the DIAMETER. Radius 100
// on the sheet is diameter_cm = 200 here. Some sheets print a diameter instead, so
// the header word has to be read rather than assumed. The Settings form therefore
// asks which one the sheet says, and converts. See docs/reference/README.md.
const pool = require('../db/pool');

// Two tanks are the same size when they agree to a millimetre. Tighter than that is
// noise in how somebody typed a chart header; looser and 202 would swallow 200,
// which is exactly the 1,255 L confusion this exists to prevent.
const TOL_CM = 0.1;

const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

// The display name IS the dimensions — `202cm × 500cm`. Owner-set 2026-08-25:
// "from now on we will call the tank as AAcm X BBcm." Never a nominal size, never
// a KL figure, anywhere a user can see it. See the note above for what that cost.
function chartName(diameter_cm, length_cm) {
  const trim = n => (Number.isInteger(n) ? String(n) : String(+n.toFixed(1)));
  return `${trim(diameter_cm)}cm × ${trim(length_cm)}cm`;
}

// Shell volume of a horizontal cylinder, litres. The figure to sanity-check against
// the LAST ROW of the calibration sheet — if they disagree, the sheet is not this
// tank's sheet, which is the whole lesson of 25-Aug.
function shellLitres(diameter_cm, length_cm) {
  const r = Number(diameter_cm) / 2;
  return +((Math.PI * r * r * Number(length_cm)) / 1000).toFixed(2);
}

// Dimensions -> chart id, creating the row the first time this size is seen.
// Returns null when no usable dimensions were supplied.
async function findOrCreateByDimensions(diameter_cm, length_cm, client = pool) {
  const d = num(diameter_cm), l = num(length_cm);
  if (!d || !l) return null;

  // Reuse an existing row when the size genuinely matches — the owner's rule. A
  // size shared by several outlets stays one row, so a later correction to a
  // genuinely-shared geometry still reaches all of them.
  const { rows: hit } = await client.query(
    `SELECT id FROM tank_calibration_charts
      WHERE abs(diameter_cm - $1) <= $3 AND abs(length_cm - $2) <= $3
      ORDER BY is_active DESC, id LIMIT 1`,
    [d, l, TOL_CM]
  );
  if (hit.length) return hit[0].id;

  const { rows } = await client.query(
    `INSERT INTO tank_calibration_charts (name, diameter_cm, length_cm, is_active)
     VALUES ($1, $2, $3, TRUE) RETURNING id`,
    [chartName(d, l), d, l]
  );
  return rows[0].id;
}

// What every caller uses.
//
//   { diameter_cm, length_cm }  -> resolve/create by size (the normal path)
//   { calibration_chart_id }    -> an explicit row id, kept so an existing
//                                  assignment survives an unrelated tank edit
//   neither                     -> null, i.e. "no chart, enter litres by hand"
//
// `provided` tells a PATCH whether calibration was part of the request at all: an
// edit that only renames a tank must not silently clear its calibration, and a
// cleared calibration must not be mistaken for an absent field.
async function resolveChartId(body = {}, client = pool) {
  const hasDims = body.diameter_cm != null || body.length_cm != null;
  const hasId   = Object.prototype.hasOwnProperty.call(body, 'calibration_chart_id');

  if (hasDims) {
    const id = await findOrCreateByDimensions(body.diameter_cm, body.length_cm, client);
    // Dimensions were sent but unusable (blanked, or one of the pair missing):
    // that is an explicit "no calibration", not a silent keep.
    return { provided: true, calibration_chart_id: id };
  }
  if (hasId) return { provided: true, calibration_chart_id: body.calibration_chart_id || null };
  return { provided: false, calibration_chart_id: null };
}

module.exports = { resolveChartId, findOrCreateByDimensions, chartName, shellLitres, TOL_CM };
