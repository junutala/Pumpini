// Match the tanks read off an ATG console screen to the tanks configured for
// this outlet. ONE writer for the rule, embedded by both shift-start and
// shift-close — they were carrying identical copies, which is exactly how the
// two drift apart.
//
// 🔴 FUEL DECIDES. TANK NUMBER ONLY VERIFIES, AND ONLY ADVISES. (Owner-set.)
//
// It used to be the other way round: the tank number picked the tank and the
// fuel was a veto, so a console numbered 1=HSD, 3=MS, 4=Power against an outlet
// numbered 1=premium, 2=petrol, 3=diesel filled almost nothing — every row was
// refused for "different fuel", which is a true statement about a mismatch the
// manager cannot fix from the forecourt at 6am. The numbering is a Settings
// detail; the fuel on the screen is a physical fact. So:
//
//   - The PRODUCT chooses the tank. A diesel reading can only ever land in a
//     diesel tank — that guard is absolute and is what actually protects the
//     stock figure.
//   - The TANK NUMBER is a second layer of verification, used first to pick
//     between two tanks of the same fuel (which fuel alone cannot separate),
//     and otherwise only to raise an advisory note. It never blocks a fill.
//   - CAPACITY is the tie-break of last resort between same-fuel tanks, and
//     advisory otherwise. An unmaintained capacity in Settings must not be
//     able to refuse a good reading.
//
// The only rows left empty are ones where there is genuinely no answer: no tank
// of that fuel at this outlet, or several of that fuel with nothing at all to
// tell them apart. Guessing between two diesel tanks is worse than asking.

const norm = v => String(v ?? '').toLowerCase().trim();
const pos  = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };
const rowLabel  = r => (r.tank_label == null || r.tank_label === '' ? '?' : String(r.tank_label));
const rowFuel   = r => (r.product_raw || r.product || '?');

// rows  — parsed console rows: { tank_label, product, product_raw, net_volume_ltrs, capacity_ltrs, ... }
// tanks — this outlet's dip tanks: { id, tank_number, fuel_type, capacity_ltrs }
//
// Returns
//   pairs      [[tank, row]]  fill these
//   dropped    [label]        the console showed no volume
//   unplaced   [label]        no tank of that fuel here
//   ambiguous  [label]        several tanks of that fuel, nothing to choose by
//   renumbered [{ console, tank, fuel }]  filled, but the tank number disagrees
//   capacityOff [{ console, tank, readCap, ourCap }]  filled, capacity disagrees
export function matchGaugeRows(rows, tanks) {
  const all     = Array.isArray(rows) ? rows : [];
  const mine    = Array.isArray(tanks) ? tanks : [];
  const usable  = all.filter(r => r.net_volume_ltrs != null);
  const dropped = all.filter(r => r.net_volume_ltrs == null).map(rowLabel);

  const claimed = new Set();   // tank ids already filled — one row per tank
  const placed  = new Set();   // indices of usable[] already dealt with
  const pairs = [], unplaced = [], ambiguous = [], renumbered = [], capacityOff = [];

  const freeSameFuel = r => mine.filter(t => norm(t.fuel_type) === norm(r.product) && !claimed.has(t.id));
  const take = (i, t, r) => { claimed.add(t.id); placed.add(i); pairs.push([t, r]); };

  // PASS 1 — fuel agrees AND the number agrees. Run it over every row before
  // pass 2 touches anything: otherwise a row that matches only on fuel could
  // claim the tank that a later, perfectly numbered row belongs in.
  usable.forEach((r, i) => {
    const t = freeSameFuel(r).find(t => String(t.tank_number) === String(r.tank_label));
    if (t) take(i, t, r);
  });

  // PASS 2 — fuel agrees, the number does not (or the console prints none).
  // This is the case the old rule threw away.
  usable.forEach((r, i) => {
    if (placed.has(i)) return;
    let cands = freeSameFuel(r);
    if (cands.length === 0) { unplaced.push(rowLabel(r)); return; }

    if (cands.length > 1) {
      // Two tanks of the same fuel. Capacity is the only signal left, so here —
      // and only here — it decides rather than advises.
      const rc = pos(r.capacity_ltrs);
      if (rc) {
        const near = cands.filter(t => { const c = pos(t.capacity_ltrs); return c && Math.abs(c - rc) <= rc * 0.01; });
        if (near.length === 1) cands = near;
      }
    }
    if (cands.length !== 1) { ambiguous.push(rowLabel(r)); return; }

    const t = cands[0];
    take(i, t, r);
    renumbered.push({ console: rowLabel(r), tank: t.tank_number, fuel: rowFuel(r) });
  });

  // Capacity as pure verification across everything we filled. It is a note, not
  // a refusal — the figure on the screen is the reading; a stale capacity in
  // Settings is a Settings problem, and blocking on it costs the manager his
  // stock entry to fix somebody else's typo.
  pairs.forEach(([t, r]) => {
    const rc = pos(r.capacity_ltrs), tc = pos(t.capacity_ltrs);
    if (rc && tc && Math.abs(tc - rc) > rc * 0.01) {
      capacityOff.push({ console: rowLabel(r), tank: t.tank_number, readCap: Math.round(rc), ourCap: Math.round(tc) });
    }
  });

  return { pairs, dropped, unplaced, ambiguous, renumbered, capacityOff };
}

export default matchGaugeRows;
