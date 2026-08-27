# Flow v2 — what is agreed, what exists, what to build

**Written 27-Aug-2026, at the owner's request, to hand this work to a fresh session.**

The *design* is frozen and lives in `CLAUDE.md` under **"FLOW v2 — the hub and three
spokes"**. Read that first; it is the authority on *why*. This file is the authority on
*where things stand and what to do next*, and it does not repeat the design.

> **Status on the day this was written: NOTHING OF FLOW v2 IS BUILT.** The screens are
> mockups, the switch is a drawing, and no spoke exists as code. That is stated plainly
> because the owner asked, mid-session, *"then where is the switch to push to the new
> process?"* and the honest answer was that there isn't one.

---

## 1. Where the design lives

| | |
|---|---|
| The model — hub, three spokes, the rules | `CLAUDE.md`, section **FLOW v2** |
| The screens | `design/*.dc.html` + `design/canvas.json` |
| The canvas, rendered | https://claude.ai/code/artifact/bfaefa0e-34b6-4c2e-a535-4e2933dd4343 |

`design/` is mockups. **Nothing imports it**; delete it and the app is unaffected. The
seeded canvas `.html` is a ~2.5 MB editor payload and is gitignored — it rebuilds from
the `.dc.html` sources.

---

## 2. The screens, and the decisions inside them

Seven artboards for Spoke 1, drawn at 390×844 because the manager doing this is standing
at the console, not sitting at a desk. Each decision below was taken by the owner on
27-Aug; they are settled, not open for redesign.

| Artboard | Screen | The decision it carries |
|---|---|---|
| `Main` | 1 · Landing | Shows the **last recon**, never current stock — *"we will not have data on Current Stock. That's a trap."* Date picker is a *jump to*, not the primary control. Needs an empty state for a first-ever recon |
| `AtgCapture` | 2 · Photograph the console | Asks for **landscape** (the console is a wide screen, and it reads better). A **SKIP** button goes straight to manual entry |
| `AtgReading` | 3 · Reading | The bar fills to **~90% and holds** until the answer is actually back. Three real stages. **It never claims to be finished before it is** |
| `AtgResult` | 3b · What we read | Every figure editable; each carries a badge saying whether a photo or a person produced it |
| `Nozzles` | 4 · Nozzle readings | **4 and 4a are ONE screen.** Partial is the normal state, not an error |
| `Variance` | 5 · The variance | **Testing gets its own line**, never folded into sales. Confirm or Start again. **Saved as a draft either way** |
| `FlowSwitch` | 6 · Settings | The migration switch (1240×880 — owner work, at a desk) |

### Two rules run through every screen

1. **Typing is not a fallback.** Camera and keyboard are the same size, the same height,
   the same border, side by side — and every figure carries a badge saying which one
   produced it.
2. **Nothing dead-ends.** Every screen has a way forward, including the ones where the
   camera failed.

### Deleted, and why — do not re-propose

- **"3a · one tank at a time"** — the ATG is a controller app showing every tank on one
  display. That photograph does not exist.
- **The right-hand step rail** — it broke on a phone, and the phone is where the work
  happens. Top stepper only.
- **"Lay the slips on a matt sheet, in shade"** — written on a glare theory the data
  killed. The 23-Jun Kamala slips were perfectly legible; they failed because the OCR
  returned the rupee line (fixed, see §6).

### The draft rule, stated exactly

The variance is saved **before** the manager decides. It is his to resume, but it is
**not in the ledger and not on the owner's dashboard until he confirms**. "Start again"
does **not** delete it — the draft is marked abandoned and kept. *A recon that vanishes
when a man changes his mind is a recon he will not start twice.*

---

## 3. What already exists — verified 27-Aug-2026, do not rebuild

**This is the most important section in the file.** Spoke 1 is largely *assembly of
existing parts behind a new screen*, not a build from nothing. Every row below was
checked against the repo or the production database on the day of writing.

| Spoke 1 needs | Already built | Where |
|---|---|---|
| ATG console photo → per-tank readings | ✅ | `POST /api/dipstick/parse-gauge` |
| A dip reading, written | ✅ | `POST /api/dipstick/` |
| dip → litres on the real OMC charts | ✅ | `backend/src/lib/calibration.js` — reproduces all three installed HP charts, 645 points, max deviation **0.00 L** |
| NET vs GROSS handling | ✅ | `frontend/src/lib/tankVolume.js` |
| All nozzle slips in ONE photo | ✅ | `POST /api/reconcile/parse-slips` → `slipParser.parseCompositeSlips` |
| One nozzle slip | ✅ | `POST /api/reconcile/pos-meter` |
| The rupee/litre (A vs V) cross-check | ✅ | `slipParser` — `legible` on a line *means* it passed |
| Nozzle naming, one writer | ✅ | `pumpService.nozzleNameExpr` / `nozzleName`; screen side `lib/nozzle.js → nozName()` |
| Photograph storage | ✅ | `artifactService.save()` → Supabase Storage bucket `pumpini-docs` |
| **The variance arithmetic itself** | ✅ | `frontend/src/app/stock-reco/page.js` — `book = opening dip + deliveries − sales(L); variance = actual dip − book` |
| Deliveries belonging to a TANK, not a shift | ✅ | `fuel_deliveries`: **175 of 175** rows carry `tank_id`, **0** carry `shift_id` |
| Per-outlet behaviour switches | ✅ | `station_settings` — five booleans today (§5) |

### What does NOT exist

- **The capture act.** The manager standing at the console taking the ATG reading *and*
  every nozzle slip **at one moment**, and that moment becoming the tank window. This is
  the whole point of Spoke 1 — it is what makes the tank window and the nozzle totals
  share a boundary *by construction*, and it is what kills the straddle problem.
- **The recon record.** A row per tank window: its two ATG boundaries, its deliveries,
  its nozzle totals, its testing, its variance, and its draft/confirmed state.
- **The switch.** No column, no toggle, no code.
- **Spokes 2 and 3.** Nozzle Events and Attendant Dues exist only as desktop artboards.

---

## 4. The agreed build order

Small, testable steps. The owner tests each on a **test outlet** before the next.

### Step 1 — make the switch real (owner-gated SQL)

```sql
ALTER TABLE station_settings
  ADD COLUMN IF NOT EXISTS hub_spokes_flow_enabled boolean NOT NULL DEFAULT false;
```

**Running this is NOT a milestone and nobody should be told the flow is ready.** The
column on its own does nothing — no toggle renders it, no code reads it, no spoke exists.
It is run first only because Supabase schema does not deploy with the code (see
`CLAUDE.md`, deploy ordering), so the column must be present before anything selects it.
Every outlet gets `false`; nothing changes anywhere.

The first thing that can honestly be **shown** to an outlet owner is the end of Step 3 —
the switch flipped on a test outlet and the sidebar visibly changing.

**It is a MIGRATION FLAG, not a feature — name it so, and set a date for its removal.**
Off by default and it stays off. Kamala, Highway and Adhoc are working outlets and
nothing about this reaches them.

### Step 2 — the Settings toggle

**Extend the existing switches block** in `frontend/src/app/settings/page.js`. Not a new
screen, not a new endpoint — the cardinal rule. `FlowSwitch.dc.html` shows the intended
presentation, including what it does and does not touch.

**It must refuse to flip while a shift is open at that outlet.** Half a shift under one
model and half under another leaves an opening reading nobody can defend.

### Step 3 — the sidebar swaps behind the flag

Shift Open / Shift Close leave; the three spokes appear. `Nav.dc.html` is the reference.

**Stop here and let the owner flip it on a test outlet.** That alone proves the plumbing
and proves nothing leaks to the three real outlets — before a single spoke screen is
built.

### Step 4 — Spoke 1, Tank Recon

The five screens above, wired to the readers in §3. This is the substance.

### Step 5 and beyond — Spokes 2 and 3

Not started. Design is frozen in `CLAUDE.md`; screens are drawn.

---

## 5. The switches that exist today

Verified in production 27-Aug-2026:

| column | default |
|---|---|
| `geo_fence_enabled` | `false` |
| `products_enabled` | `false` |
| `self_settlement_enabled` | `true` |
| `accounts_enabled` | `false` |
| `attendant_led_autoclose` | `false` |

Flow v2 becomes the sixth.

---

## 6. What changed on 27-Aug that this build must inherit

A day of bug fixing preceded this plan, and three of those fixes bear directly on the
new screens:

- **The slip reader returned the RUPEE line as the meter.** `/pos-meter` carried its own
  OCR prompt describing "a cumulative totalizer" — a mechanical dial — so the model
  returned the largest run of digits on a printed slip, which is `A`. Kamala 23-Jun:
  three attempts, three times `A`. Sri Balaji 25-Aug: `17558851.620` on a nozzle whose
  real movement that shift was `5.78 L`. **All flagged `ocr_legible = true`.** Both
  managers typed their readings by hand and stopped scanning — the correct response to a
  lying instrument, and the real reason the slip-scan push did not take. Fixed by routing
  `/pos-meter` through `slipParser`, which has had the A/V cross-check since #306 and was
  simply never in that path. **The new screens must use `slipParser`, never their own
  prompt.**
- **A success was painted as an error.** Both scan screens had one `err` state in a
  hard-coded red box, so a clean scan looked identical to a failure. Now
  `components/shared/Banner.js`, three tones, one short line each:
  *Success — proceed* / *Check the figures before saving* / *Failed — enter manually*.
  **The new screens use that Banner.** Owner: *"dont give all these stories to the
  user... he will not read nor understand."*
- **Server error sentences were being thrown away.** `lib/api.js` already unwraps the
  axios error, but 49 catch blocks read `e.response?.data` — always `undefined` — and
  fell through to the machine code. A manager was shown `missing_closing_dip` while the
  backend had sent a plain English sentence in the same response. **Use
  `lib/apiError.js → errText()`** for anything a human reads and `errCode()` for anything
  a screen branches on.

---

## 7. The rules that bind this build

**ONLY THE FLOW BRANCHES. NOT THE FOUNDATIONS.** If any of these is copied, there are no
longer two flows — there are two products:

- nozzle naming — `pumpService.nozzleNameExpr` (a CI check fails the build on an inline label)
- calibration and dip→litres — `lib/calibration`, `lib/tankVolume`
- artifact storage — `artifactService.save()`
- prices, users, stations

And, from `CLAUDE.md`:

- **Rule zero** — no DB changes to production outlets unless the owner clearly asks. This
  survives any other request.
- **The cardinal rule** — reuse the field, reuse the form, do not open a new route. A PR
  that adds a route must say which route it closes.
- **Two tables for the slip readings is deliberate** — Spoke 1's recon readings and Spoke
  2's events live apart and are written by the same code. Money flows from Spoke 2 only.
  There is **no third table**.
- **`git diff A B` never tells you what a merge will do.** Only a dry-run merge does.
  (Learned the hard way on 27-Aug: a two-way diff was read as a merge preview and a PR
  was closed on a false conclusion.)

---

## 8. Still open — decide before or during the build

1. **Recon cadence — daily or per shift.** Daily is 12 slip prints and cheap; per shift
   is 24 a day and somebody starts skipping, which quietly puts the straddle back.
2. **Who may clear an outstanding.** Manager is weak control — he is often the one who
   took the cash. Owner-only is slow. Middle path: manager records, owner confirms.
3. **The owner dashboard is reworked AFTER the flow is frozen**, not alongside it.
4. **The empty state** for a first-ever recon on the landing screen is specified but not
   drawn.

---

## 9. Sri Balaji — the outlet this is for

First adopter. One week of history, least to disturb, and the outlet with the problem.
**Kamala, Adhoc Highway and Highway stay exactly as they are** until the new flow is
proven and its bugs are out — the two experienced managers become the LAST adopters, not
the test subjects.

Two things were open at the time of writing and are **the owner's to resolve with
Srinivas, not ours to fix in data**:

- ₹1,25,275.25 across three 25-Aug settlements recorded with `cash_actual = 0`.
- The 26-Aug shift has **zero opening dips** and three **closing** dips timestamped 12:57
  that duplicate the previous shift's close.

**Do not touch either.** They are the evidence for why Spoke 3 calculates the outstanding
instead of letting anyone type it.

---

## 10. Why nobody scans slips — the post-mortem that reshapes Step 4
### added 27-Aug-2026, from production evidence, after the owner rejected the first review's assumptions

The rethink exists because the users do not scan. That sentence was checked against
every scan artifact in production on 27-Aug, and the diagnosis is precise enough to
build against.

### The control group: the SAME engine, the SAME managers, universal adoption

**Every fuel delivery since June carries a scanned invoice — 175 of 175, at every
outlet, uploaded by the managers themselves, month after month** (`fuel_deliveries.invoice_id`
joined to `delivery_invoices.uploaded_by`; every uploader is the outlet's manager, except
Sri Balaji's, which is the owner). Delivery scanning and slip scanning run through the
one shared engine, `services/visionOcr.js` (`billScan.js:37`, `slipParser.js:18`).

So the camera is not the problem, the OCR engine is not the problem, and the managers
are not the problem. **The difference is structural: the delivery scan has no identity
step.** It fills an editable form; the manager checks the figures and confirms. The slip
scan inserted a matching layer between camera and manager — and that layer failed
silently, on reference data that was partly invented.

### The slip scans, exhaustively

| Who | When | What happened (all VERIFIED from `station_artifacts`) |
|---|---|---|
| Kamala | 02-Aug ×3 | `ocr` stored as NULL — no structured result kept. Never scanned again |
| Adhoc | 02-Aug ×2 | Same. Never again |
| Highway / Hayat Nagar | 04-Aug ×4 each | Same. Never again |
| Nagole | 20-Aug | **0 of 28 lines matched** — the slips were Sri Balaji's machines (17CH2645V…) scanned under Nagole, whose pumps are M1832149/M1831227. `serial_known:false` sat on every line and no screen shouted it |
| Sri Balaji | 25-Aug | 42/44 matched. The 2 misses printed nozzle "4" on pumps whose `slip_nozzle_no` says "1","2" — because `defaultSlipNo()` DERIVED those from the internal number instead of anyone reading a slip |
| Sri Balaji | 26-Aug | 52/64. The 12 misses are one-character serial misreads (`17CH2900V` for 17EH2900V, `H28253V`, `2444`) killed by exact-string matching |
| Dilsukhnagar | 27-Aug | The 15BC1412V incident scans |

Plus: all 24 `meter_photos` ever taken say `ocr_legible = true` — including the ones
that returned the rupee line. `legible` certified pixel clarity while lying about
field identity. The fix (#353, route `/pos-meter` through the guarded reader) merged
27-Aug and has never been used by a manager.

**The managers behaved correctly.** They abandoned an instrument that lied with
confidence and failed without explanation. Typing was the right response.

### The four rules this burns into Step 4

1. **Commissioning is a verified act, and it gates the switch.** Every
   serial + printed-nozzle-number pair is captured by scanning a REAL slip at setup —
   the machine reads it, the human confirms "this is the pump by the air tower", and
   what the paper printed is stored. `defaultSlipNo()` guesses are abolished on
   flow-v2 outlets. The switch refuses to turn on until every active nozzle's identity
   is slip-proven; that commissioning reading is the chain's genesis event.
2. **Match with tolerance, confirm with a human, never fail silently.** An outlet has
   5–8 serials; an OCR read one character off PROPOSES the nearest ("Is this
   17EH2900V?") — one tap. A slip with no close match is a loud red card — "not from
   any machine at this outlet" (the Nagole case) — never a quiet unmatched row.
3. **A reading enters the chain only through three independent checks:** the V-line
   found by its label (#353), A÷V implies a sane price, and the physics pair (never
   decreases; never faster than the pump can deliver). Wrong numbers fail loudly in
   seconds, not at settlement.
4. **The process measures itself.** Scans attempted / lines matched / lines typed,
   per outlet per week, on the owner dashboard from day one — the PHOTO/TYPED badges
   aggregated. Scanning died in the first week of August and nobody could see it;
   that blindness is never rebuilt. Every scan stores its structured result, success
   or failure (the 02–04 Aug artifacts kept nothing, so the evidence of why managers
   quit had to be reconstructed from absence).

### Validation is REPLAY, not a field trial

No customer tests for a week. The failed scans are still in `station_artifacts` with
their images: re-run the stored photos through the current reader plus the hardened
matcher, offline, and measure the match rate before any screen ships. The 25/26-Aug
Sri Balaji composites and the Nagole set are the regression bench — real slips, real
glare, known right answers. Commissioning is likewise not a trial: one slip per pump,
five minutes, part of switch-on.

### Build-order amendment

Between Step 3 (sidebar swap) and Step 4 (the screens) sits **Step 3.5 — the
instrument slice**: commissioning-by-slip + the gate on the switch, tolerant
match-and-confirm, the wrong-outlet card, telemetry, and the replay bench run against
the stored artifacts. Smaller than any screen, and everything after it drinks from it.
The screens then follow the pattern deliveries already proved wins adoption: scan →
editable review, every figure badged → confirm.
