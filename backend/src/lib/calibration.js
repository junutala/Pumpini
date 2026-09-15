// src/lib/calibration.js
// Horizontal-cylinder tank calibration. A tank type is just diameter x length
// (cm); dip -> volume and the per-level tolerance are computed, never stored.
// Mirror of frontend/src/lib/calibration.js — keep the two in sync.

// The dip is recorded directly in CENTIMETRES (the decimal is literal cm), e.g.
// 72.5 = 72.5 cm. Sticks differ by outlet — HPCL has 9 marks/cm (0.1 cm each, a
// proper mm stick) so the reading is already literal; Kamala's coarse 4-mark/cm
// stick (0.2 cm each) is recorded as the real cm too (2nd mark = .4, not .2).
// So no conversion — earlier builds doubled the decimal, which over-read every
// fractional dip. Kept as a pass-through hook in case a future stick needs one.
function markToTrueDip(entered) {
  const n = Number(entered);
  if (!isFinite(n)) return null;
  return +n.toFixed(2);
}

// dip (cm, true) -> litres, via the circular-segment volume of a horizontal cylinder
function dipToVolume(diameterCm, lengthCm, dipCm) {
  const D = Number(diameterCm), L = Number(lengthCm), h = Number(dipCm);
  if (!(D > 0 && L > 0) || !isFinite(h)) return null;
  const r = D / 2;
  if (h <= 0) return 0;
  if (h >= D) return +(Math.PI * r * r * L / 1000).toFixed(2);
  const A = r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(2 * r * h - h * h);
  return +(A * L / 1000).toFixed(2);
}

// THE PHYSICAL CEILING of a tank, in litres — its shell volume, from the geometry.
//
// 🔴 THIS IS NOT tanks.capacity_ltrs. That column holds the NAMEPLATE — the trade
// designation, "45 KL" — and it has to stay the nameplate because it is what a console
// prints and what gaugeMatch compares against to decide WHICH tank a scanned row is.
// The nameplate is a name; this is the tank.
//
// Every standard tank holds MORE than its name: BPCL's own catalogue runs +4% to +9%,
// and their "45 KL" is 48,574.77 L (docs/reference/bpcl-standard-tankages.json). Using
// the nameplate as a ceiling refuses readings that are perfectly true — a full 45 KL
// gauges at ~48,500 and the old check rejected anything over 45,900, telling the manager
// to re-read a gauge that was right. Owner, 15-Sep: "keep the name as it stands 45KL,
// but let's use the actual capacity for ALL our calculations."
//
// Returns null without a chart, and callers must fall back rather than assume.
function shellVolume(diameterCm, lengthCm) {
  const D = Number(diameterCm), L = Number(lengthCm);
  if (!(D > 0 && L > 0)) return null;
  return dipToVolume(D, L, D);
}

// accepted ± tolerance at this dip = litres in 1 mm of dip (the sheet's DIFF)
function dipTolerance(diameterCm, lengthCm, dipCm) {
  const D = Number(diameterCm), L = Number(lengthCm), h = Number(dipCm);
  if (!(D > 0 && L > 0) || !isFinite(h)) return null;
  const r = D / 2;
  const hc = Math.max(0, Math.min(h, D));
  const chord = 2 * Math.sqrt(Math.max(0, 2 * r * hc - hc * hc));
  return +(chord * L / 1000 / 10).toFixed(2);
}

module.exports = { markToTrueDip, dipToVolume, shellVolume, dipTolerance };
