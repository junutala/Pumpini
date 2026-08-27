# design — Flow v2 artboards

Mockups. **Nothing here is imported by the app**; the directory exists so a build has
something concrete to work against instead of a paragraph of prose. Delete it and
nothing breaks.

## Page 1 — Tank Recon, the phone flow

The manager doing this is standing at the console, not sitting at a desk, so every
screen is drawn at 390×844.

| Artboard | Screen |
|---|---|
| `Main` | 1 · Landing — the last recon, a date jump, one big CTA |
| `AtgCapture` | 2 · Photograph the console — landscape prompt, and SKIP |
| `AtgReading` | 3 · Reading — the bar that fills to 90% and holds |
| `AtgResult` | 3b · What we read — every figure editable, source badged |
| `Nozzles` | 4 · Nozzles — one shot for all, or one at a time |
| `Variance` | 5 · The variance — testing on its own line, confirm or start again |
| `Deliveries` | Exception · A tanker may be missing — the variance leads here when a tank's gain is about a tanker load |
| `FlowSwitch` | 6 · Settings — the switch that turns the flow on, 1240×880 |

Two rules run through all of them:

1. **Typing is not a fallback.** Camera and keyboard are the same size, the same
   height, the same border, side by side — and every figure carries a badge saying
   which one produced it.
2. **Nothing dead-ends.** Every screen has a way forward, including the ones where
   the camera failed.
3. **The CTA is earned, not offered** (owner, 27-Aug). A step's button sits grey until
   this screen's job is fully captured, and while grey it says what is missing
   ("Waiting on 1 nozzle"). Escape hatches — skip, provisional, add-later — are quiet
   secondary buttons. The spokes gate separately; no spoke waits on another.

### Decisions already taken, so they are not re-litigated

- **Top stepper, not a right rail** (owner, 27-Aug). The rail broke on a phone, and
  the phone is where the work happens.
- **Screens 4 and 4a are ONE screen.** Partial is the normal state, not an error.
- **The old "3a · one tank at a time" screen is deleted.** The ATG is a controller
  app showing every tank on one display — that photograph does not exist.
- **The landing shows the LAST RECON, never current stock.** Owner: *"we will not
  have data on Current Stock. That's a trap."*
- **The recon is THREE steps — ATG, nozzles, variance — and deliveries is an
  EXCEPTION, not a step** (owner, 27-Aug). A decant can be once a week; a daily
  screen for a weekly event teaches the manager to tap through it. When a tank's
  gain is about a tanker load, the variance leads to the deliveries screen so the
  forgotten invoice gets scanned now — through the everyday Deliveries form.
- **The landing holds one card, one line, one button.** The past lives behind
  "Jump to date"; no history list padding the screen.
- **No mockup carries a readable invented figure where a photograph would be** — the
  viewfinder and thumbnails glow with abstract bars. A mockup number gets taken for
  a real one.
- **Save before he decides, as a DRAFT.** His to resume, but not in the ledger and
  not on the owner's dashboard until he confirms. "Start again" marks it abandoned;
  it never deletes it.

## Page 2 — the other spokes, desktop

`NozzleEvents` (the chain, co-events, the drift alarm), `Outstanding` (attendant
dues; its settle panel deliberately has **no field for the outstanding**, only for
what the man brought), and `Nav` (the sidebar group).

## Real system, not approximated

Sidebar `#0F1923` at 220 px, `#FF6B00` active with the 3 px left border; content on
`--bg #f8f7f5`, `--brand #e07b0c`; DM Sans and DM Mono; fuel colours off
`globals.css`. Nozzles are named `<pump serial>.<nozzle number>` — the one
convention, as the slips print it.

## Editing

`*.dc.html` are the sources and `canvas.json` is the layout. The seeded canvas
`.html` is a ~2.5 MB editor payload and is **gitignored** — it rebuilds from these
on demand. This repo has already been bitten once by Actions storage.
