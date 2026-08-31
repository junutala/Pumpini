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
// 🔴 BUT FUEL ALONE IS NOT ENOUGH, AND THE TANK NUMBER IS NOT THE SECOND KEY.
// CAPACITY IS. (31-Aug-2026, from three consecutive scans of one console.)
//
// The reader is Google Vision followed by a TEXT model that never sees the image.
// Across three scans of the SAME Sri Balaji console it got a different thing wrong
// each time — and one thing right every time:
//
//   13:53  products SWAPPED   labels 1/3 correct   capacities 22000/16000 correct
//   15:59  "Power" landed on the petrol row, and the real Power row lost its product
//          entirely — Vision had read only TWO product words for THREE tanks, and the
//          model dealt them out in order. Labels came back 1/2/3.
//   16:11  products all correct — labels came back 1/2/3 for tanks numbered 1/3/4
//
// So neither the product nor the number survives on its own. The CAPACITY did, in
// every scan including the bad ones, because it is a printed number rather than a
// label the model reconstructs — and we hold the same number in Settings.
//
// FUEL AND CAPACITY TOGETHER DECIDE. Checked against all three scans: the two bad
// reads place nothing, and the good read places all three tanks correctly even
// though its tank numbers were wrong.
//
// The tank NUMBER drops to what it always should have been — a tiebreaker between two
// tanks of the same fuel AND the same size (Highway and Hayat Nagar each run two
// 22,000 L diesel tanks), and a note when it disagrees.
//
// A row carrying NO capacity keeps the 23-Aug rule exactly: fuel decides. That is the
// IOCL console, which prints no capacity at all, and it is the outlet that rule was
// written to protect.
//
// WHY NOT GATE ON table_state. A first attempt required the number and fuel to agree
// whenever the reader said it had read the summary table. The 15:59 scan then declared
// table_state 'absent' for a console that plainly has a table, and walked straight
// past the gate. A guard the reader can switch off by describing itself differently is
// not a guard. Capacity needs no such declaration.

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

// How close the screen's capacity must sit to ours to count as the same tank. Both
// are nameplate figures typed from the same OMC paperwork, so they should be equal;
// 2% is room for an OCR wobble, not for a different tank. The sizes we actually run
// are 9,000 / 15,000 / 16,000 / 20,000 / 22,000 — the nearest pair is 6% apart, so
// this cannot confuse two real tanks.
const CAPACITY_TOL = 0.02;

// rows  — parsed console rows: { tank_label, product, product_raw, net_volume_ltrs, capacity_ltrs, ... }
// tanks — this outlet's dip tanks (THE MASTER): { id, tank_number, fuel_type, capacity_ltrs }
//
// Returns
//   pairs        [[tank, row]]                     fill these
//   dropped      [label]                           the console showed no volume
//   unplaced     [label]                           no tank of that fuel at this outlet
//   renumbered   [{ console, tank, fuel, confirmed }]
//                  filled; the console's tank NUMBER disagrees with ours.
//                  confirmed:true  — fuel AND capacity both agreed, so two independent
//                                    keys placed it and the number is the odd one out.
//                                    A NOTE, not a warning.
//                  confirmed:false — no capacity was printed (IOCL), so fuel alone
//                                    picked the only candidate. One key. Worth a look.
//   assumed      [{ console, tank, fuel }]         filled; same-fuel, nothing to choose by
//   overCapacity [{ console, tank, vol, cap }]     NOT filled — exceeds installed capacity
//   capacityOff  [{ console, tank, readCap, ourCap }]  filled; screen capacity disagrees
//   mismatched   [{ console, fuel }]                  NOT filled — table read, but the
//                                                     number and the fuel disagree
//
// opts.table_state — 'used' when the console printed a summary table and the reader
// read from it. That is the only mode in which the tank number is trustworthy enough
// to be a required key; see the 31-Aug note above.
export function matchGaugeRows(rows, tanks) {
  const all    = Array.isArray(rows) ? rows : [];
  const mine   = Array.isArray(tanks) ? tanks : [];
  const usable  = all.filter(r => r.net_volume_ltrs != null);
  const dropped = all.filter(r => r.net_volume_ltrs == null).map(rowLabel);

  const claimed = new Set();
  const placed  = new Set();
  const pairs = [], unplaced = [], renumbered = [], assumed = [], overCapacity = [],
        capacityOff = [], mismatched = [];

  const freeSameFuel = r => mine.filter(t => norm(t.fuel_type) === norm(r.product) && !claimed.has(t.id));

  // true / false / null. Null means the row carries no capacity — an IOCL console
  // prints none — and then there is simply nothing to check against.
  const capAgrees = (t, r) => {
    const rc = pos(r.capacity_ltrs), tc = pos(t.capacity_ltrs);
    if (rc == null || tc == null) return null;
    return Math.abs(tc - rc) <= rc * CAPACITY_TOL;
  };
  const numAgrees = (t, r) => String(t.tank_number) === String(rowLabel(r));

  // The one refusal that outranks everything: physically impossible against the
  // MASTER capacity, never the screen's. Checked before anything is claimed, so a bad
  // row cannot take a tank that a good row belongs in.
  const overCap = (t, r) => {
    const vol = pos(r.net_volume_ltrs), cap = pos(t.capacity_ltrs);
    return !!(vol && cap && vol > cap * OVER_CAPACITY);
  };
  const take = (i, t, r) => { claimed.add(t.id); placed.add(i); pairs.push([t, r]); };
  const refuseOverCap = (i, t, r) => {
    overCapacity.push({ console: rowLabel(r), tank: t.tank_number,
                        vol: Math.round(pos(r.net_volume_ltrs)), cap: Math.round(pos(t.capacity_ltrs)) });
    placed.add(i);
  };

  // PASS 1 — fuel, capacity AND number all agree. Run over every row before pass 2
  // touches anything, or a weaker match could claim the tank a perfect row belongs in.
  usable.forEach((r, i) => {
    const t = freeSameFuel(r).find(t => capAgrees(t, r) !== false && numAgrees(t, r));
    if (!t) return;
    if (overCap(t, r)) return refuseOverCap(i, t, r);
    take(i, t, r);
  });

  // PASS 2 — fuel and CAPACITY agree; the number does not. This is the normal case on
  // this reader, which renumbers tanks positionally. Placed, and noted.
  usable.forEach((r, i) => {
    if (placed.has(i)) return;
    const cands = freeSameFuel(r).filter(t => capAgrees(t, r) === true);
    if (cands.length !== 1) return;
    const t = cands[0];
    if (overCap(t, r)) return refuseOverCap(i, t, r);
    take(i, t, r);
    // TWO KEYS AGREED. The console renumbering its own tanks is a reader artifact we
    // now expect — it returned 1/2/3 for tanks numbered 1/3/4 on three scans out of
    // four on 31-Aug — so flagging it every time trains the manager to click through
    // an amber banner over figures that are right. Recorded, not shouted.
    renumbered.push({ console: rowLabel(r), tank: t.tank_number, fuel: rowFuel(r), confirmed: true });
  });

  // PASS 3 — the row carries NO capacity to check against: the IOCL console, and the
  // 23-Aug rule verbatim. Fuel decides; where two tanks share a fuel the row is still
  // placed, in order, and flagged as assumed. A shift within one fuel is correctable;
  // a blank at 6am is a retype.
  usable.forEach((r, i) => {
    if (placed.has(i)) return;
    const cands = freeSameFuel(r);
    if (cands.length === 0) { unplaced.push(rowLabel(r)); return; }
    // A capacity WAS printed and it matches no tank of this fuel. One of the two reads
    // is wrong and nothing here can say which, so the row is not placed on the strength
    // of the half we happened to prefer. This is the 13:53 swap and the 15:59 "Power".
    if (pos(r.capacity_ltrs) != null) {
      mismatched.push({ console: rowLabel(r), fuel: rowFuel(r), cap: Math.round(pos(r.capacity_ltrs)) });
      return;
    }
    const t = cands[0];
    if (overCap(t, r)) return refuseOverCap(i, t, r);
    take(i, t, r);
    // No capacity to confirm against, so this rests on the fuel alone.
    (cands.length === 1 ? renumbered : assumed)
      .push({ console: rowLabel(r), tank: t.tank_number, fuel: rowFuel(r), confirmed: false });
  });

  // Capacity as a NOTE on what we filled. Only reachable now for rows that carried no
  // capacity to match on, or that matched within tolerance — a disagreement here is a
  // remark about the photograph, never a reason to refuse a reading.
  pairs.forEach(([t, r]) => {
    const rc = pos(r.capacity_ltrs), tc = pos(t.capacity_ltrs);
    if (rc && tc && Math.abs(tc - rc) > rc * CAPACITY_TOL) {
      capacityOff.push({ console: rowLabel(r), tank: t.tank_number, readCap: Math.round(rc), ourCap: Math.round(tc) });
    }
  });

  return { pairs, dropped, unplaced, renumbered, assumed, overCapacity, capacityOff, mismatched };
}

export default matchGaugeRows;
