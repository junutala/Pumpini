# Tank calibration — formula, not stored charts

An underground fuel tank is a **horizontal cylinder**, so the dip → volume
relationship is fully determined by two numbers: **diameter (D)** and
**length (L)** in cm. We compute volume and tolerance from these instead of
storing (and OCR-ing) the manufacturer's per-cm chart.

## The formula
For dip (liquid height) `h`, radius `r = D/2`, length `L` (all cm):

```
segment area  A(h) = r²·acos((r−h)/r) − (r−h)·√(2rh − h²)
volume (L)    V(h) = A(h) · L / 1000
tolerance     DIFF(h) = 2·√(2rh − h²) · L / 1000 / 10     (litres per mm of dip)
```

`DIFF` is the litres in 1 mm of dip — i.e. the liquid-surface area — and is
the **accepted ± variance band** at that fill level (matches the sheet's DIFF
column). Implemented in `backend/src/db/migrations/001_tank_calibration.sql`
as `calib_volume()` / `calib_tolerance()`.

## Dip entry
The stick has 4 minor marks per cm (0.2 cm each). The manager enters the mark
ordinal as a decimal (e.g. `64.2` = 64 + 2nd mark). The dipstick form converts
to TRUE dip — `64.2 → 64.4 cm` — before calling `calib_volume()`.

## Verification
The formula was validated against the two IOCL Warangal sheets we have:

| Tank | D × L (cm) | Full vol | Fit vs printed chart |
|------|-----------|----------|----------------------|
| 15KL | 194 × 525 | 15,519 L | mean err 14.8 L, anchors ~0.1% |
| 20KL | 210 × 625 | 21,648 L | mean err 11.6 L, max 0.35% |

Residual (~0.1–0.3%) is the dished end-caps and is well inside the DIFF
tolerance band — so the formula is as good as the chart for reconciliation,
and it self-corrects scan/OCR slips (e.g. the 15KL dip-192 photo misread).

`tank15kl.csv` is the digitized 15KL sheet, kept only as a **verification
fixture** for the formula — it is **not** loaded into the database.

## Adding the remaining ~9 tank types
No scanning. Just record each type's **diameter × length** (from the tank
nameplate or the chart header, e.g. "194-525") as a row in
`tank_calibration_charts`. Outlets then pick the type from a dropdown at tank
setup.
