// DIP → LITRES. The one conversion the money depends on.
//
// CLAUDE.md records that dipToVolume reproduces all three installed HP charts
// exactly — 645 points checked 25-Aug-2026, max deviation 0.00 L — which is why
// "when Pumpini and a gauge console disagree, the console is the suspect until
// someone shows our figure departing from a chart page." That claim is only worth
// anything if something keeps checking it.
//
// The frontend carries a MIRROR of the backend's implementation (a dip is
// converted as the manager types, before any round trip). Two copies of one
// formula is exactly the drift the cardinal rule warns about, so the most
// important test here is that they still agree.
import { describe, it, expect } from 'vitest';
import { dipToVolume, markToTrueDip } from '../src/lib/calibration';
import { createRequire } from 'node:module';
const backend = createRequire(import.meta.url)('../../backend/src/lib/calibration.js');

// The three Sri Balaji tanks, as installed. Diameter, not radius — HP prints the
// RADIUS on pages 1-3 and the DIAMETER on page 4, and reading the wrong one is
// how tank 3 came to be configured at 200cm when it is 202cm.
const TANKS = [
  { name: 'Sri Balaji tank 3 (petrol, 202×500)', d: 202, l: 500 },
  { name: 'Sri Balaji tank 1 (diesel, 200×500)', d: 200, l: 500 },
  { name: 'a 160×500 shell',                     d: 160, l: 500 },
  { name: 'a small 90×300 shell',                d: 90,  l: 300 },
];

describe('the frontend mirror still agrees with the backend, to the litre', () => {
  for (const t of TANKS) {
    it(t.name, () => {
      let worst = 0, at = null;
      for (let dip = 0; dip <= t.d; dip += 0.25) {
        const diff = Math.abs(dipToVolume(t.d, t.l, dip) - backend.dipToVolume(t.d, t.l, dip));
        if (diff > worst) { worst = diff; at = dip; }
      }
      expect(worst, `worst deviation ${worst} L at dip ${at}cm`).toBe(0);
    });
  }
});

describe('the shape of the answer', () => {
  it('an empty tank is 0 L and a full one is the whole cylinder', () => {
    expect(dipToVolume(202, 500, 0)).toBe(0);
    // π r² L, in litres: cm³ / 1000
    const full = Math.PI * (202 / 2) ** 2 * 500 / 1000;
    expect(dipToVolume(202, 500, 202)).toBeCloseTo(full, 2);
  });

  it('half-full is half the shell — the one point a horizontal cylinder is exactly linear', () => {
    const full = Math.PI * (202 / 2) ** 2 * 500 / 1000;
    expect(dipToVolume(202, 500, 101)).toBeCloseTo(full / 2, 2);
  });

  it('rises monotonically — a deeper dip can never hold less', () => {
    let prev = -1;
    for (let dip = 0; dip <= 202; dip += 0.5) {
      const v = dipToVolume(202, 500, dip);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('THE NAMEPLATE IS NOT THE SHELL. A "16 KL" tank at 202x500 holds far more', () => {
    // Sri Balaji's ATG was configured from the nameplate (16,023 L) and under-read
    // petrol by 661 L at a 91.23 cm dip — an error that GROWS with the level.
    const shell = dipToVolume(202, 500, 202);
    expect(shell).toBeGreaterThan(16000);
  });

  it('A DIP GIVES GROSS, NOT NET — the 25-Aug petrol reading, pinned', () => {
    // Sri Balaji, 25-Aug-2026. The console read 912.3 mm and 7014.71 L. Those are
    // NOT the same quantity and must never be compared directly:
    //
    //   a DIP measures the whole liquid column   -> GROSS
    //   the console reports stock                -> NET = gross - water
    //
    // Our chart returns 7026.62 L for that dip. The 11.91 L between them IS the
    // water. This assertion was first written as `toBeCloseTo(7014.71)` — gross
    // against net — and failed, which is the entire reason this test exists.
    const gross = dipToVolume(202, 500, 91.23);
    expect(gross).toBeCloseTo(7026.62, 2);
    expect(gross - 7014.71).toBeCloseTo(11.91, 2);   // the water column
  });

  it('is not fooled by a dip deeper than the tank', () => {
    expect(dipToVolume(202, 500, 500)).toBe(dipToVolume(202, 500, 202));
  });
});

describe('markToTrueDip', () => {
  it('is a pure number in, number out — never NaN on junk', () => {
    expect(Number.isFinite(markToTrueDip(100))).toBe(true);
  });
});
