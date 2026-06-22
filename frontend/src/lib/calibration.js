// frontend/src/lib/calibration.js
// Horizontal-cylinder tank calibration (dip -> volume) computed from the tank
// type's diameter x length (cm). Mirror of backend/src/lib/calibration.js.

// Dip-stick entry: 4 minor marks per cm (0.2 cm each). The operator enters the
// mark ordinal as a decimal, e.g. "64.2" = 64 + 2nd mark = 64.4 cm true.
export function markToTrueDip(entered) {
  const n = Number(entered);
  if (!isFinite(n)) return null;
  const whole = Math.floor(n);
  return +(whole + (n - whole) * 2).toFixed(2);
}

// dip (cm, true) -> litres
export function dipToVolume(diameterCm, lengthCm, dipCm) {
  const D = Number(diameterCm), L = Number(lengthCm), h = Number(dipCm);
  if (!(D > 0 && L > 0) || !isFinite(h)) return null;
  const r = D / 2;
  if (h <= 0) return 0;
  if (h >= D) return +(Math.PI * r * r * L / 1000).toFixed(2);
  const A = r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(2 * r * h - h * h);
  return +(A * L / 1000).toFixed(2);
}

// accepted ± tolerance at this dip = litres in 1 mm of dip
export function dipTolerance(diameterCm, lengthCm, dipCm) {
  const D = Number(diameterCm), L = Number(lengthCm), h = Number(dipCm);
  if (!(D > 0 && L > 0) || !isFinite(h)) return null;
  const r = D / 2;
  const hc = Math.max(0, Math.min(h, D));
  const chord = 2 * Math.sqrt(Math.max(0, 2 * r * hc - hc * hc));
  return +(chord * L / 1000 / 10).toFixed(2);
}
