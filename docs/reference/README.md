# Reference documents — the authorities we check our own numbers against

These are OMC-issued documents, kept in the repo so a session never has to ask the
owner to upload them again. **They are the authority. Our code is only correct to the
extent it reproduces them.**

---

## `hp-tank-dip-charts.pdf` — HP calibration charts, 4 pages

One page per tank geometry. A chart is identified by its **radius (or diameter) and
length**, never by its nameplate — see the trap below.

| Page | Header | Shell volume | Sri Balaji tank |
|---|---|---|---|
| 1 | RADIUS 100.00, LENGTH 300.00 | 9,425 L | tank 4 — premium, nameplate 9 KL |
| 2 | RADIUS 100, LENGTH 550 | 17,279 L | tank 3 — petrol, nameplate 16 KL |
| 3 | RADIUS 113.5, LENGTH 600 | 24,282 L | tank 1 — diesel, nameplate 22 KL |
| 4 | DIA 226, LENGTH 661 | 26,518 L | not installed at Sri Balaji |

**HP prints the RADIUS; `tank_calibration_charts.diameter_cm` stores the DIAMETER.**
Radius 100 on the sheet is `diameter_cm = 200` in the database. Pages 1–3 print a
radius, page 4 prints a diameter. Read the header word, do not assume.

### Verified 25-Aug-2026

`backend/src/lib/calibration.js → dipToVolume()` reproduces all three installed charts
**exactly** — 645 dip/volume points checked, **maximum deviation 0.00 L**:

| Tank | Stored chart | HP page | Points | Max deviation |
|---|---|---|---|---|
| 4 premium | D=200, L=300 | 1 | 231 | **0.00 L** |
| 3 petrol | D=200, L=550 | 2 | 198 | **0.00 L** |
| 1 diesel | D=227, L=600 | 3 | 216 | **0.00 L** |

So a disagreement between Pumpini and a gauge console is **not** ours to fix until
someone shows our figure departing from one of these pages.

### 🔴 THE NAMEPLATE IS NOT THE SHELL VOLUME

A tank *called* 16 KL holds **17,279 L** of shell. The nameplate is a trade
designation; the chart's radius × length is the physical tank. Confusing the two is
what broke Sri Balaji's petrol reading on 25-Aug:

- Sri Balaji's **ATG console** was configured with a **16,023 L** tank profile —
  the nameplate, near enough — against HP's real **17,279 L**. Effectively a tank
  **51 cm shorter** than the one in the ground.
- It under-read petrol by **661 L at a 91.23 cm dip**, and the error **grows with
  the level**: ~215 L at 40 cm, ~1,086 L at 140 cm. **No constant correction factor
  exists.** Do not offer one.
- **The test that works: dip → chart, compared against the console's GROSS volume.**
  The dip measures all the liquid; `net = gross − water`, and the console prints both.
  Comparing against net leaves the water reading in the difference.
- **Do NOT infer shell volume from `net + ullage`.** It looks convincing and it is
  wrong: on the 15-Aug console it implies 9,414 L for premium (HP: 9,425) and
  23,662 L for diesel (HP: 24,282) — yet *both* tanks are perfectly calibrated.
  Ullage is measured to something other than the crown.
- Verified on the clean 15-Aug-2026 19:16 console photograph, all three tanks:

  | Tank | Dip | HP chart | ATG gross | Diff |
  |---|---|---|---|---|
  | 1 HSD diesel | 55.78 cm | 4,633.16 | 4,633.26 | **0.10 L** ✅ |
  | 4 Power premium | 143.38 cm | 7,231.08 | 7,231.52 | **0.44 L** ✅ |
  | 3 MS petrol | 99.78 cm | 8,615.18 | 7,888.78 | **726.40 L** ❌ |

  Diesel and premium are exact. **Only petrol is mis-configured** — and it was already
  wrong on 15-Aug, ten days before anyone noticed.

The operator "fixed" it by entering a dip that back-solved to the console's litres —
852.00 mm instead of the 912.30 mm actually on screen. **The volume looked right and
the dip became fiction.** Watch for that shape: it is what a careful man does when two
screens disagree and nobody has told him which to trust.

---

## `hp-density-table-astm-53b.xls` — ASTM 1980 Table 53B

Observed density + observed temperature → **density at 15°C**. Single sheet
`ASTM_1980_53B_D15`, ~2,400 rows. Authored by HPCL.

Needed wherever a dip is converted to a temperature-corrected quantity —
`dipstick_readings.density` / `.temperature_c`, and delivery net-volume checks against
the challan.

---

## Reading these files in a session

No parser is installed by default. Both need one pip install:

```bash
pip install pypdf   # then: pypdf.PdfReader(...).pages[i].extract_text()
pip install xlrd    # .xls is the old OLE2 format — openpyxl will NOT open it
```
