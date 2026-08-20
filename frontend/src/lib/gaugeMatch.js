// Match the tanks read off an ATG console screen to the tanks configured for
// this outlet. ONE writer for the rule, embedded by both shift-start and
// shift-close — they were carrying identical copies, which is exactly how the
// two drift apart.
//
// 🔴 THE MASTER RECORD IS THE GOLDEN DATA. BOTH FIELDS MUST AGREE, OR WE DO NOT
// 🔴 FILL. (Owner-set 2026-08-20.)
//
//   "the tank number and fuel type are stored in the master during setup. This is
//    the golden data. If either record mismatches, we should not proceed and let
//    the user enter manually rather than giving wrong data."
//
// So a console row is placed ONLY when its tank number AND its product both match
// the same tank in Settings. Any disagreement — either field — leaves that tank
// blank and names it, and the manager reads it off the console himself.
//
// THIS REPLACES AN EARLIER RULE, deliberately. It used to be "fuel decides, the
// number only advises", written when an outlet whose Settings numbering disagreed
// with its console filled almost nothing. Matching on fuel alone rescued those
// rows — but it cannot separate an outlet's TWO DIESEL TANKS (Highway has two),
// and there it was choosing between them on capacity or on nothing at all.
// Crossing two diesel tanks is not fatal to the fuel's total, but it is still a
// wrong number in a named tank, and the owner's call is that a blank box beats it.
// The right fix for a numbering disagreement is to correct Settings, not to guess
// past it.
//
// A BLANK IS NOT A FAILURE. It is the honest answer, and it is visible — a wrong
// figure filled into the right-looking box is not.

const norm = v => String(v ?? '').toLowerCase().trim();
const pos  = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };
const rowLabel = r => (r.tank_label == null || r.tank_label === '' ? '?' : String(r.tank_label));
const rowFuel  = r => (r.product_raw || r.product || '?');

// A volume above the installed capacity is not a disagreement to note, it is a
// physical impossibility — a digit was misread. The tolerance is not zero because
// nominal capacity is not a physical ceiling: a tank filled to its nameplate can
// gauge slightly over on a warm afternoon, and refusing a manager at 6am over half
// a percent would be the wrong trade. No digit error survives 2%.
const OVER_CAPACITY = 1.02;

// rows  — parsed console rows: { tank_label, product, product_raw, net_volume_ltrs, capacity_ltrs, ... }
// tanks — this outlet's dip tanks (THE MASTER): { id, tank_number, fuel_type, capacity_ltrs }
//
// Returns
//   pairs        [[tank, row]]        fill these — number AND fuel both agree
//   dropped      [label]              the console showed no volume
//   mismatched   [{ console, fuel, reason }]   left blank on purpose, with why
//   overCapacity [{ console, tank, vol, cap }] left blank — exceeds installed capacity
//   capacityOff  [{ console, tank, readCap, ourCap }]  filled, screen capacity disagrees
export function matchGaugeRows(rows, tanks) {
  const all   = Array.isArray(rows) ? rows : [];
  const mine  = Array.isArray(tanks) ? tanks : [];
  const usable  = all.filter(r => r.net_volume_ltrs != null);
  const dropped = all.filter(r => r.net_volume_ltrs == null).map(rowLabel);

  const claimed = new Set();
  const pairs = [], mismatched = [], overCapacity = [], capacityOff = [];

  usable.forEach(r => {
    const byNumber = mine.filter(t => String(t.tank_number) === String(rowLabel(r)));

    // No tank of that number here. The console is describing a tank Settings does
    // not have — nothing to place it against.
    if (byNumber.length === 0) {
      mismatched.push({ console: rowLabel(r), fuel: rowFuel(r), reason: 'no tank with that number' });
      return;
    }

    // The number exists but the product does not agree. THIS IS THE STOP. Filling
    // it would put one fuel's volume into another fuel's tank, or the right fuel
    // into the wrong one of two — either way a number nobody can trace back.
    const t = byNumber.find(t => norm(t.fuel_type) === norm(r.product));
    if (!t) {
      mismatched.push({
        console: rowLabel(r), fuel: rowFuel(r),
        reason: `console says ${rowFuel(r)}, Settings says ${byNumber.map(x => x.fuel_type).join('/')}`,
      });
      return;
    }

    // Two console rows claiming one tank — the screen was misread, not the tank.
    if (claimed.has(t.id)) {
      mismatched.push({ console: rowLabel(r), fuel: rowFuel(r), reason: 'a second row claims the same tank' });
      return;
    }

    // Physically impossible against the MASTER capacity — never the screen's.
    const vol = pos(r.net_volume_ltrs), cap = pos(t.capacity_ltrs);
    if (vol && cap && vol > cap * OVER_CAPACITY) {
      overCapacity.push({ console: rowLabel(r), tank: t.tank_number, vol: Math.round(vol), cap: Math.round(cap) });
      return;
    }

    claimed.add(t.id);
    pairs.push([t, r]);
  });

  // Capacity as pure verification on what we filled. The screen's capacity is just
  // another OCR'd number — on 20-Aug a scan read 12,650 and 4,000 for tanks the
  // master records at 16,000 and 9,000 — so a disagreement is a note about the
  // photograph, never a reason to refuse a reading that already passed both keys.
  pairs.forEach(([t, r]) => {
    const rc = pos(r.capacity_ltrs), tc = pos(t.capacity_ltrs);
    if (rc && tc && Math.abs(tc - rc) > rc * 0.01) {
      capacityOff.push({ console: rowLabel(r), tank: t.tank_number, readCap: Math.round(rc), ourCap: Math.round(tc) });
    }
  });

  return { pairs, dropped, mismatched, overCapacity, capacityOff };
}

export default matchGaugeRows;
