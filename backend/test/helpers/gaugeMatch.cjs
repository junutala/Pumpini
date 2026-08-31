// GENERATED from frontend/src/lib/gaugeMatch.js by scripts/ci-gauge-match-sync.js.
// Do not edit. Run that script after changing the matcher; CI checks they agree.
// Match the tanks read off an ATG console screen to the tanks configured for
// this outlet. ONE writer for the rule, embedded by both shift-start and
// shift-close — they were carrying identical copies, which is exactly how the
// two drift apart.
//
// 🔴 FUEL DECIDES. THE TANK NUMBER ONLY VERIFIES. (Owner-set 2026-08-23.)
//
//   "I recommend to match the tanks to fuel types. A shift within fuel is not a
//    cause for worry and anyway, we can correct later."
//
// A diesel reading can only ever land in a diesel tank — that guard is absolute
// and is what actually protects the stock figure. The tank NUMBER then separates
// two tanks of the same fuel where it agrees; where it does not, the rows are
// still placed, in order, and flagged. A shift between two diesel tanks moves a
// figure between two tanks of the same product: correctable later, and cheaper
// than a blank box at 6am.
//
// WHY THIS REVERSES THE 20-AUG RULE. For three days this file required BOTH the
// number and the fuel to agree, or it left the tank blank. Kamala's IOCL console
// then arrived and settled it: the console numbers its tanks 1=Motor Spirit,
// 2=HSD, 3=HSD while Settings has 1=diesel, 2=diesel, 3=petrol. Under both-keys
// that fills ONE tank of three and blanks the rest — at an outlet whose manager
// had just started scanning. The numbering disagreement is a Settings detail
// somebody will fix; the fuel on the screen is a physical fact. Fuel is the guard
// that matters.
//
// The arithmetic bears it out: on that console net + ullage lands exactly on each
// tank's installed capacity — 10,318+4,682 = 15,000 (our petrol tank), and both
// diesel cards sum to 20,000. The fuels are unambiguous; only the numbering is.
//
// 🔴 BUT FUEL-ALONE IS SAFE ONLY WHERE FUEL IS THE RELIABLE READ, AND ON A CONSOLE
// THAT PRINTS A SUMMARY TABLE IT IS NOT. (31-Aug-2026.)
//
// A gauge scan on 31-Aug returned tank_label "1" as MS/petrol and tank_label "3" as
// HSD/diesel. The console prints the exact opposite. Volumes, labels and capacities
// all stayed correctly paired — only the two product WORDS traded places. Fuel then
// decided, faithfully, and put 7877.26 (the petrol tank) into a diesel tank and
// 4629.06 (the diesel tank) into a petrol one.
//
// The same photograph read CORRECTLY 52 minutes earlier. It is not a bad frame: the
// reader is Google Vision followed by a text model that never sees the image, and
// its own notes on the bad read say "Tank labels INFERRED from capacity bands and
// OCR layout". An inferred label is a guess, and a guess is different every time.
//
// So: where the console prints a summary table, the tank NUMBER comes off the same
// printed line as the product — it is exactly as good a read, and the two together
// are a cross-check neither is alone. Require BOTH, and where they disagree fill
// NOTHING and say so. A blank box a manager fills from the paper in his hand costs
// ten seconds; a wrong litre in the right-looking box costs a stock reconciliation
// nobody can unpick.
//
// Card-only consoles (IOCL, table_state 'absent') keep fuel-alone exactly as the
// 23-Aug rule set it — there is no second key to check against, and tightening
// there would blank the outlets it was written to protect.

const norm = v => String(v ?? '').toLowerCase().trim();
const pos  = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };
const rowLabel = r => (r.tank_label == null || r.tank_label === '' ? '?' : String(r.tank_label));
const rowFuel  = r => (r.product_raw || r.product || '?');

// A volume above the INSTALLED capacity is not a disagreement to note, it is a
// physical impossibility — a digit was misread. This is the one test that still
// refuses. The tolerance is not zero because nominal capacity is not a physical
// ceiling: a tank filled to its nameplate can gauge slightly over on a warm
// afternoon. No digit error survives 2%.
const OVER_CAPACITY = 1.02;

// rows  — parsed console rows: { tank_label, product, product_raw, net_volume_ltrs, capacity_ltrs, ... }
// tanks — this outlet's dip tanks (THE MASTER): { id, tank_number, fuel_type, capacity_ltrs }
//
// Returns
//   pairs        [[tank, row]]                     fill these
//   dropped      [label]                           the console showed no volume
//   unplaced     [label]                           no tank of that fuel at this outlet
//   renumbered   [{ console, tank, fuel }]         filled; the tank number disagrees
//   assumed      [{ console, tank, fuel }]         filled; same-fuel, nothing to choose by
//   overCapacity [{ console, tank, vol, cap }]     NOT filled — exceeds installed capacity
//   capacityOff  [{ console, tank, readCap, ourCap }]  filled; screen capacity disagrees
//   mismatched   [{ console, fuel }]                  NOT filled — table read, but the
//                                                     number and the fuel disagree
//
// opts.table_state — 'used' when the console printed a summary table and the reader
// read from it. That is the only mode in which the tank number is trustworthy enough
// to be a required key; see the 31-Aug note above.
function matchGaugeRows(rows, tanks, opts = {}) {
  const strict = opts.table_state === 'used';
  const all    = Array.isArray(rows) ? rows : [];
  const mine   = Array.isArray(tanks) ? tanks : [];
  const usable  = all.filter(r => r.net_volume_ltrs != null);
  const dropped = all.filter(r => r.net_volume_ltrs == null).map(rowLabel);

  const claimed = new Set();
  const placed  = new Set();
  const pairs = [], unplaced = [], renumbered = [], assumed = [], overCapacity = [], capacityOff = [];
  const mismatched = [];

  const freeSameFuel = r => mine.filter(t => norm(t.fuel_type) === norm(r.product) && !claimed.has(t.id));

  // The one refusal: physically impossible against the MASTER capacity, never the
  // screen's. Checked before anything is claimed, so a bad row cannot take a tank
  // that a good row belongs in.
  const overCap = (t, r) => {
    const vol = pos(r.net_volume_ltrs), cap = pos(t.capacity_ltrs);
    return !!(vol && cap && vol > cap * OVER_CAPACITY);
  };
  const take = (i, t, r) => { claimed.add(t.id); placed.add(i); pairs.push([t, r]); };

  // PASS 1 — fuel agrees AND the number agrees. Run over every row before pass 2
  // touches anything, or a fuel-only match could claim the tank a perfectly
  // numbered row belongs in.
  usable.forEach((r, i) => {
    const t = freeSameFuel(r).find(t => String(t.tank_number) === String(rowLabel(r)));
    if (!t) return;
    if (overCap(t, r)) {
      overCapacity.push({ console: rowLabel(r), tank: t.tank_number,
                          vol: Math.round(pos(r.net_volume_ltrs)), cap: Math.round(pos(t.capacity_ltrs)) });
      placed.add(i); return;
    }
    take(i, t, r);
  });

  // PASS 2 — fuel agrees, the number does not. Capacity separates two tanks of the
  // same fuel where it can; where it cannot, the row is still placed and flagged
  // as assumed. A shift within one fuel is correctable; a blank is a retype.
  usable.forEach((r, i) => {
    if (placed.has(i)) return;
    let cands = freeSameFuel(r);
    if (cands.length === 0) { unplaced.push(rowLabel(r)); return; }
    // THE TABLE WAS READ, AND ITS OWN TWO KEYS DISAGREE. One of them is wrong and
    // nothing here can say which, so this row does not get placed on the strength
    // of the half we chose to believe.
    if (strict) { mismatched.push({ console: rowLabel(r), fuel: rowFuel(r) }); return; }

    let byCapacity = false;
    if (cands.length > 1) {
      const rc = pos(r.capacity_ltrs);
      if (rc) {
        const near = cands.filter(t => { const c = pos(t.capacity_ltrs); return c && Math.abs(c - rc) <= rc * 0.01; });
        if (near.length === 1) { cands = near; byCapacity = true; }
      }
    }

    const t = cands[0];
    if (overCap(t, r)) {
      overCapacity.push({ console: rowLabel(r), tank: t.tank_number,
                          vol: Math.round(pos(r.net_volume_ltrs)), cap: Math.round(pos(t.capacity_ltrs)) });
      placed.add(i); return;
    }
    take(i, t, r);
    (cands.length === 1 || byCapacity ? renumbered : assumed)
      .push({ console: rowLabel(r), tank: t.tank_number, fuel: rowFuel(r) });
  });

  // Capacity as pure verification on what we filled. The screen's capacity is just
  // another OCR'd number — on 20-Aug a scan read 12,650 and 4,000 for tanks the
  // master records at 16,000 and 9,000 — so a disagreement is a note about the
  // photograph, never a reason to refuse a reading. An IOCL console prints no
  // capacity at all, and then there is simply nothing to compare.
  pairs.forEach(([t, r]) => {
    const rc = pos(r.capacity_ltrs), tc = pos(t.capacity_ltrs);
    if (rc && tc && Math.abs(tc - rc) > rc * 0.01) {
      capacityOff.push({ console: rowLabel(r), tank: t.tank_number, readCap: Math.round(rc), ourCap: Math.round(tc) });
    }
  });

  return { pairs, dropped, unplaced, renumbered, assumed, overCapacity, capacityOff, mismatched };
}

module.exports = { matchGaugeRows };
