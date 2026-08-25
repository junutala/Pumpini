// frontend/src/lib/tankVolume.js
//
// 🔴 ONE RULE for "how many litres is this tank holding", embedded by Shift Start
// and Shift End. They carried identical copies, which is exactly how the two drift.
//
// ─── NET FIRST. Owner-set 2026-08-25 ───────────────────────────────────────────
//
//   "I prefer that we correctly point to the net quantity to start with. If net
//    quantity is, for some reason, not readable, then check for dip readings and
//    use our chart for conversion and print the result."
//
// WATER IS NOT STOCK. It sits at the bottom of the tank, it is never sold, and the
// console has already taken it out of its NET figure. A dip, by contrast, measures
// the whole liquid column — fuel AND water — so a dip through the chart is a GROSS
// figure. Sri Balaji's petrol carries 11.52 L of water, so the two bases differ by
// that much on every reading.
//
// While the water is constant that difference cancels in the reconciliation
// (opening − closing), which is why nobody saw it. It bites in two places:
//
//   1. THE DAY THE WATER IS PUMPED OUT, a gross basis shows an 11.52 L loss with
//      no fuel sold. Water ingress after rain shows the same as a phantom gain.
//   2. MIXING THE TWO INSIDE ONE SHIFT — opening off a dip, closing off a photo —
//      puts the whole water figure into that shift's variance.
//
// So the console's net wins whenever we have it, and the chart is the fallback for
// when it is missing or unreadable. The basis comes back with the figure so the
// screen can say which one it used rather than leaving the operator to wonder.
//
// GROSS AND NET ARE BOTH EXPLAINABLE. Owner-set 25-Aug-2026: the water is now
// RECORDED, not merely excluded —
//
//     volume_ltrs = NET (the stock)   water_ltrs = the water   gross = net + water
//
// From the console both come off the screen. From a stick, the water dip goes
// through the SAME chart as the fuel dip, so gross − water = net without needing a
// second instrument. No water reading → net = gross, exactly as before.
//
// PROSPECTIVE ONLY. Rows written before this hold a gross figure with no water
// recorded, and are not restated — there is nothing to restate them with.
import { dipToVolume, markToTrueDip } from './calibration';

const asNum = v => {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Returns { volume, basis } where basis is one of:
//   'net'     — the console's own net volume, water already excluded  (PREFERRED)
//   'chart'   — a dip run through this tank's calibration             (fallback)
//   'entered' — litres typed by hand, no chart to check them against
//   null      — nothing to go on
//
// `source` is where the litres value came from: 'gauge' when a console photograph
// filled it, anything else when a person typed it. A typed litres figure is NOT
// treated as a net reading — we have no idea what the person meant by it, and
// guessing is how a wrong basis gets in silently.
export function tankVolume({ dip, litres, source, waterDip, waterLtrs, diameter_cm, length_cm }) {
  const l  = asNum(litres);
  const d  = asNum(dip);
  const wd = asNum(waterDip);
  const hasChart = asNum(diameter_cm) > 0 && asNum(length_cm) > 0;

  // 1. The console's NET. Wins even when a dip is also present: the dip is gross,
  //    and preferring it would silently put the water back into stock. The console
  //    reports its own water, so gross stays derivable.
  if (source === 'gauge' && l != null) {
    const w = asNum(waterLtrs);
    return { volume: l, basis: 'net', waterLtrs: w, fromDip: false,
             gross: w != null ? +(l + w).toFixed(2) : null };
  }

  // 2. No usable net — the dip through this tank's chart. A dip measures fuel AND
  //    water, so that is GROSS; a water dip through the SAME chart makes it net.
  if (d != null && hasChart) {
    const gross = dipToVolume(diameter_cm, length_cm, markToTrueDip(d));
    if (gross == null) return { volume: null, basis: null, waterLtrs: null, gross: null };
    const w = wd != null ? dipToVolume(diameter_cm, length_cm, markToTrueDip(wd)) : null;
    if (w != null) return { volume: +(gross - w).toFixed(2), basis: 'net', waterLtrs: w, gross, fromDip: true };
    return { volume: gross, basis: 'chart', waterLtrs: null, gross, fromDip: true };
  }

  // 3. Neither — whatever litres are in the box.
  if (l != null) return { volume: l, basis: 'entered', waterLtrs: null, gross: null, fromDip: false };

  return { volume: null, basis: null, waterLtrs: null, gross: null, fromDip: false };
}

// The dip to STORE alongside that volume.
//
// Only when the volume was actually derived from it. A dip recorded next to a
// console-net figure it did not produce is a fiction, and `dip_cm IS NULL` is how
// the rest of the system tells a system reading from a physical one — the same
// distinction the dipstick route already relies on.
export function tankDipCm({ dip, basis, fromDip, diameter_cm, length_cm }) {
  const d = asNum(dip);
  if (d == null) return null;
  // Keyed on WHERE THE FIGURE CAME FROM, not on the basis. A stick dip with a water
  // dip beside it is 'net' too, and keying on basis threw that physical reading
  // away — the dip is real and it DID produce the volume, via gross − water.
  if (!fromDip && basis !== 'entered') return null;
  const hasChart = asNum(diameter_cm) > 0 && asNum(length_cm) > 0;
  return hasChart ? markToTrueDip(d) : d;
}

export function hasTankReading({ dip, litres }) {
  return asNum(dip) != null || asNum(litres) != null;
}
