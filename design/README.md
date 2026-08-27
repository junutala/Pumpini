# Flow v2 screens — design source

Mockups for the three-spoke flow (`CLAUDE.md` → *FLOW v2 — the hub and three
spokes*). These are **design source, not shipped code** — nothing here is
imported by the app.

### Page 1 — the Tank Recon flow (phone, 390x844)

The manager doing this is standing at the console, so the flow is phone-first.

| File | Artboard |
|---|---|
| `Main.dc.html` | Landing — last recon, stock now, one big *Start a recon* |
| `AtgCapture.dc.html` | Step 1 · photograph the console, framing guides |
| `AtgReview.dc.html` | Step 1 · check what was read, per tank, correct in place |
| `AtgFallback.dc.html` | **ATG unreadable — four ways on, nothing saved** |
| `SlipsCapture.dc.html` | Step 3 · all twelve slips in one frame |
| `SlipsPartial.dc.html` | **9 of 12 read — retake, type, or reconcile provisionally** |
| `Variance.dc.html` | Step 4 · the result, tank by tank, with the working |

**Nothing in the flow can dead-end.** Every failure screen offers a way forward,
and every figure records where it came from — photo, typed, or dip.

### Page 2 — the other spokes, desktop (1440x900)

| File | Artboard |
|---|---|
| `TopCrumb.dc.html` | Spoke 1 on desktop, with the **chosen** top stepper |
| `NozzleEvents.dc.html` | Spoke 2 · the nozzle's chain, co-events, drift alarm |
| `Outstanding.dc.html` | Spoke 3 · attendant dues and the settle panel |
| `Nav.dc.html` | the new sidebar group, annotated |
| `canvas.json` | pages, layout, titles and the sticky notes |

**Breadcrumb settled (owner, 27-Aug): top stepper.** The right-hand rail was
drawn, rejected and deleted — it broke on a phone, and the phone is where this
work happens.

## Rebuilding the canvas

The published `.html` is a ~2.5 MB seeded editor payload and is **gitignored** —
rebuild it from these sources with the `design` skill's helper, then publish:

```bash
node "<skill base>/seed-canvas.mjs" \
  --template "<skill base>/payload.template.html" \
  --out pumpini-flow-v2-screens.html --title "Pumpini Flow v2 Screens" \
  --artboard Main.dc.html --artboard AtgCapture.dc.html --artboard AtgReview.dc.html \
  --artboard AtgFallback.dc.html --artboard SlipsCapture.dc.html \
  --artboard SlipsPartial.dc.html --artboard Variance.dc.html \
  --artboard TopCrumb.dc.html --artboard NozzleEvents.dc.html \
  --artboard Outstanding.dc.html --artboard Nav.dc.html --canvas canvas.json
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
