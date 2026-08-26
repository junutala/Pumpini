# Flow v2 screens — design source

Mockups for the three-spoke flow (`CLAUDE.md` → *FLOW v2 — the hub and three
spokes*). These are **design source, not shipped code** — nothing here is
imported by the app.

| File | Artboard |
|---|---|
| `Main.dc.html` | Spoke 1 · Tank Recon — step rail on the RIGHT |
| `TopCrumb.dc.html` | Spoke 1 · same screen — breadcrumb-stepper across the TOP |
| `NozzleEvents.dc.html` | Spoke 2 · the nozzle's chain, co-events, drift alarm |
| `Outstanding.dc.html` | Spoke 3 · attendant dues and the settle panel |
| `Nav.dc.html` | the new sidebar group, annotated |
| `canvas.json` | layout, titles and the sticky notes |

**The two Spoke 1 artboards are a CHOICE, not two screens.** Right rail keeps
four steps visible with detail under each and costs 250 px of width; the top
stepper gives full-width content and one line per step. Owner picks one; delete
the other.

## Rebuilding the canvas

The published `.html` is a ~2.5 MB seeded editor payload and is **gitignored** —
rebuild it from these sources with the `design` skill's helper, then publish:

```bash
node "<skill base>/seed-canvas.mjs" \
  --template "<skill base>/payload.template.html" \
  --out pumpini-flow-v2-screens.html --title "Pumpini Flow v2 Screens" \
  --artboard Main.dc.html --artboard TopCrumb.dc.html \
  --artboard NozzleEvents.dc.html --artboard Outstanding.dc.html \
  --artboard Nav.dc.html --canvas canvas.json
```

## What they are drawn from

Values are lifted from the real system, not approximated — sidebar `#0F1923` at
220 px with `#FF6B00` active and a 3 px left border, content on `--bg #f8f7f5`
with `--brand #e07b0c`, DM Sans and DM Mono, fuel colours `--petrol #3b82f6` /
`--diesel #f59e0b` / `--premium #8b5cf6`. Every figure is Sri Balaji's own data
from 25–26 Aug 2026: three tanks on their corrected charts, twelve nozzles named
off their pump serials, and the ₹1,25,275.25 standing against three operators.

**Two placeholders, marked on the Nav artboard:** the group name *Daily Flow*
describes the flow to us rather than to Srinivas, and the `NEW` chip is meant to
go when the last outlet moves across.
