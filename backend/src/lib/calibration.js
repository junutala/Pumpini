// src/lib/calibration.js
// Horizontal-cylinder tank calibration. A tank type is just diameter x length
// (cm); dip -> volume and the per-level tolerance are computed, never stored.
// Mirror of frontend/src/lib/calibration.js — keep the two in sync.

// Dip-stick entry convention: 4 minor marks per cm (0.2 cm each). The operator
// enters the mark ordinal as a decimal, e.g. "64.2" = 64 + 2nd mark = 64.4 cm.
// NOTE: marks-per-cm is fixed at 5 (0.2 cm) for now; make configurable per
// stick/outlet if a different stick shows up. (open point)
function markToTrueDip(entered) {
  const n = Number(entered);
  if (!isFinite(n)) return null;
  const whole = Math.floor(n);
  return +(whole + (n - whole) * 2).toFixed(2);
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

// accepted ± tolerance at this dip = litres in 1 mm of dip (the sheet's DIFF)
function dipTolerance(diameterCm, lengthCm, dipCm) {
  const D = Number(diameterCm), L = Number(lengthCm), h = Number(dipCm);
  if (!(D > 0 && L > 0) || !isFinite(h)) return null;
  const r = D / 2;
  const hc = Math.max(0, Math.min(h, D));
  const chord = 2 * Math.sqrt(Math.max(0, 2 * r * hc - hc * hc));
  return +(chord * L / 1000 / 10).toFixed(2);
}

module.exports = { markToTrueDip, dipToVolume, dipTolerance };
