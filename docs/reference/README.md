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

## `bpcl-tank-calibration-charts.xlsx` — BPCL's own dip-chart CALCULATOR

Supplied by the SBR Energies dealer, 15-Sep-2026. BPCL Calicut Territory.

**This one is not a chart — it is the generator.** Pick a tankage from the dropdown on
`SO Helper Main`, a VLOOKUP into `M12:O28` pulls that tank's length and diameter, and a
circular-segment formula turns a dip into litres. Plain `.xlsx`, **no macros** (verified:
no `vbaProject.bin`, content type is `spreadsheetml.sheet.main+xml`, no external links).

### Their formula is ours

    BPCL   V = L · R² · (α − sin α · cos α) · 1000,   cos α = 1 − H/R
    ours   A = r² · acos((r−h)/r) − (r−h) · √(2rh − h²)

The same expression rearranged, since `(r−h) = r cos α` and `√(2rh−h²) = r sin α`.

### Verified 15-Sep-2026 — all 367 points, empty to full

`dipToVolume()` against the workbook's own calculation sheet for 10KL(1.84D)
(L 3.99 m, D 1.84 m):

| | |
|---|---|
| points compared | **367** (dip 1 → 184 cm) |
| mean deviation | **0.00256 L** |
| max deviation | **0.00500 L** at dip 91.5 cm (BPCL 5268.085, ours 5268.090) |

That maximum **is** our 2-decimal rounding. Pinned by
`backend/test/calibration-bpcl.test.js`, which also holds two readings the owner took
live from the workbook — 45 KL and 70 KL at a 64.8 cm dip, matched exactly.

**So a BPCL tank needs TWO NUMBERS from us, not a document.** `diameter_cm` and
`length_cm` are already the columns `tank_calibration_charts` stores.

### 🔴 The printed chart has a stale cell — use the CALCULATION sheet

`Tank Chart for Print` shows **11 L at a 1 cm dip**. It is a stale cached value: its own
increment cell reads `12` where the calculation sheet says `0`, and the live formula
behind it computes **7.2046** — our figure. **An official document is not automatically a
correct one.** Read `Calculation Sheet`, column K.

---

## `bpcl-standard-tankages.json` — BPCL's standard tank catalogue, extracted

The `M12:O28` lookup as machine-readable JSON, with shell volumes computed and the
nameplate gap stated. Fifteen geometries.

### 🔴 EVERY BPCL STANDARD TANK HOLDS MORE THAN ITS NAME

| Tankage | L × D (m) | Shell | Nameplate | Over |
|---|---|---|---|---|
| 10 KL | 3.368 × 2.000 | 10,581 L | 10,000 | **+5.8%** |
| 15 KL (NEW) | 4.968 × 2.000 | 15,607 L | 15,000 | **+4.0%** |
| 15KL (1.84D) | 5.980 × 1.840 | 15,901 L | 15,000 | **+6.0%** |
| 45 KL | 8.250 × 2.738 | 48,575 L | 45,000 | **+7.9%** |
| 70 KL | 13.000 × 2.738 | 76,542 L | 70,000 | **+9.3%** |

Same trap as the HP charts above, on a bigger scale: Sri Balaji's mis-configured petrol
tank cost **661 L**; a "45 KL" configured from its nameplate is out by **3,575 L**.

**Three rows are flagged `suspect`** — `9KL(2.88D)`, `10KL(1.93D)` and `40KL` — whose
geometry cannot produce their nameplate (+165%, +20%, +19% against a +4-9% norm).
Almost certainly typos in BPCL's own sheet. **Do not seed those as calibration charts
without a drawing to confirm them.**

---

## `bpcl-tank-drawings.pdf` — BPCL fabrication drawings, 5 pages

Approved drawings for the 10 KL, 15 KL, 20 KL and 45 KL/70 KL underground horizontal
tanks (`RE.DRG.004`). They confirm the workbook independently:

- **45 KL / 70 KL** — `2750 mm OUTER DIA`, **`2738 mm INTERNAL DIA`**, sectional
  elevation `8250` (45 KL) and `13000` (70 KL). Exactly the workbook's
  `8.25 × 2.738` and `13.0 × 2.738`.
- **10 / 15 / 20 KL** — end-plate cutting details marked **`R1000`**, i.e. 2.0 m
  diameter. This is what settles which 15 KL a site has: **`15 KL (NEW)` (D 2.0 m)**,
  not `15KL(1.84D)`.

Pages 2–5 are raster images with no text layer — render them
(`pdfplumber ... .to_image(resolution=150)`) rather than trying to extract text.

---

## Reading these files in a session

No parser is installed by default. Both need one pip install:

```bash
pip install pypdf      # then: pypdf.PdfReader(...).pages[i].extract_text()
pip install xlrd       # .xls is the old OLE2 format — openpyxl will NOT open it
pip install openpyxl   # the BPCL .xlsx — and it never executes VBA, so it is safe
pip install pdfplumber # the BPCL drawings; .to_image() for the raster pages
```
