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
| `Nozzles` | 4 · Nozzle readings | **4 and 4a are ONE screen.** Partial is the normal state, not an error. Its CTA is the model of rule 3 below: grey and naming the missing nozzle until 12/12, with the provisional path as a quiet secondary |
| `Variance` | 5 · The variance | **Testing gets its own line**, never folded into sales. Confirm or Start again. **Saved as a draft either way** |
| `FlowSwitch` | 6 · Settings | The migration switch (1240×880 — owner work, at a desk) |
| `Deliveries` | Exception · A tanker may be missing | Owner, 27-Aug: deliveries can be once a week, so it is NOT a recon step — a daily screen for a weekly event gets tapped through. The recon is 3 steps (ATG → nozzles → variance); a decant-sized gain on the variance leads here, and "Yes — scan now" opens the everyday Deliveries form. Trigger at COMPARTMENT scale (tankers are shared between outlets): gain beyond tolerance and ≥ ~1,000 L; never for a ~100 L difference |

### Three rules run through every screen

1. **Typing is not a fallback.** Camera and keyboard are the same size, the same height,
   the same border, side by side — and every figure carries a badge saying which one
   produced it.
2. **Nothing dead-ends.** Every screen has a way forward, including the ones where the
   camera failed.
3. **The CTA is earned, not offered** (owner, 27-Aug: the CTAs "illuminate and clamour
   for attention even if the data is not captured"). A step's primary button sits grey
   and unlit until the current screen's data is fully captured, and while grey it says
   exactly what is missing ("Waiting on 1 nozzle — 15BC1412V.2"). It lights the moment
   the job is done. Escape hatches — skip, provisional, add-later — stay available as
   quiet secondary buttons, never as the shouting one. The three spokes gate
   separately, so no spoke ever waits on another spoke's inputs. Mockups carry no
   readable invented figures where a photograph would be.

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
   *(Partly settled by ruling 1 in §11: the settlement entry itself brings the suspense
   down. What remains open is only who may record/confirm that entry.)*
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

## 10. Why nobody scans slips — the post-mortem, engine-corrected
### 27-Aug-2026. Rewritten the same day after the owner corrected the first draft's
### "one shared engine" claim — the engines and dates below are from the artifacts' own
### `engine` stamps and the visionOcr.js history, not from assumption.

**Deliveries prove the managers scan when the instrument works: 175 of 175 deliveries
since June carry a scanned invoice, uploaded by the managers themselves** (`fuel_deliveries.invoice_id`
→ `delivery_invoices.uploaded_by`, every uploader the outlet's manager bar Sri Balaji's owner).
Deliveries have run **Google-Vision-first** for ~two months. Slips ran **direct Claude
vision until 20-Aug**, when the Vision-first pipeline was centralised into
`services/visionOcr.js` and extended to every reader; `/pos-meter` additionally carried
the rupee-line prompt bug until #353 (27-Aug).

So the timeline reads: the managers tried slip scanning on 02–04 Aug **under the old
engine and the old prompt**, were lied to (`ocr_legible=true` on rupee-line readings —
all 24 `meter_photos` ever taken say legible, including the wrong ones), got silent
unmatched rows, and correctly quit. Those artifacts stored `ocr` NULL, so the evidence
had to be reconstructed from absence. **The repaired path has never been offered to them.**

### The engines, measured against each other on the same pumps

The 25/26-Aug Sri Balaji composites are stamped with the engine that read them:

| Engine | Line-match | Notes |
|---|---|---|
| `google_vision+claude_text` | **74/76 (97%)** | Its only 2 misses are the invented-mapping rows below |
| `claude_vision` (the fallback) | **20/32 (63%)** | ALL the garbled serials — `17CH2900V`, `H28253V`, `2444`, one scan with none |

**On 26-Aug the fallback fired on 3 of 8 scans** — Vision returned nothing usable and
the pipeline silently handed the photo to the engine that already lost the users. Why
Vision failed those frames is not recorded anywhere. That silent downgrade is a defect
in its own right.

### The defects that remain with the good engine in place

1. **Invented reference data.** 17CH2645V/17CH2653V slips print nozzle "4"; our
   `slip_nozzle_no` says "1","2" because `defaultSlipNo()` derived it from the internal
   number. Nobody ever read a slip at commissioning.
2. **Wrong outlet fails silently.** Nagole, 20-Aug: 0 of 28 lines matched — the slips
   were Sri Balaji's machines. `serial_known:false` sat on every line; no screen shouted.
3. **The fallback downgrade above**, unannounced and unrecorded.
4. **No telemetry.** Scanning died in the first week of August and nobody could see it.

### What the STORED readings show — pulled 27-Aug-2026 from `station_artifacts.ocr`
### Full 152-line ledger: https://claude.ai/code/artifact/23cff5b0-ee32-424f-a68a-ac7be0b18c68

Every reading Pumpini has kept, read straight out of the rows. Not a bench run — this
is what each scan recorded at the time, so Sri Balaji's describe the reader BEFORE
#353. The bench run that would describe it today still has to happen (§ below).

**THE THREE LIVE OUTLETS STORED NOTHING.** Kamala (3 photographs), Highway (4), Adhoc
Highway (2) and Hayat Nagar (4) scanned on 02 and 04-Aug — the week the managers tried
it and quit — and **not one of those 13 photographs recorded what was read**. `ocr` is
NULL on every one. Their accuracy cannot be reported at all, only re-measured by
running the reader over the images again. This is the "reconstructed from absence"
problem in its purest form, and it is why #367 now stores a failed scan too.

**The engine split, on Sri Balaji's 13 scans:**

| | `google_vision+claude_text` | `claude_vision` (fallback) |
|---|---|---|
| Scans | 9 | 4 |
| Lines | 76 | 32 |
| Serial matched a real pump | **76/76** | **20/32** |
| Impossible volume (>10M L) | 0 | 5 |
| …of those, marked `legible` anyway | 0 | **2** |
| Carried a `serial.nozzle` name | **0** | **0** |

Three findings that change what Step 3.5 has to build:

1. **THE NOZZLE NAME WAS NEVER STORED.** `nozzle_name` is null on all 152 lines. A scan
   kept `pump_serial` and a slip line number as separate fields and never assembled
   `17CH2645V.2`. So there is **no stored record of which nozzle a reading was assigned
   to** — only which serial the slip claimed. (Dilsukhnagar's 27-Aug scan does carry it,
   so newer code stores it; Sri Balaji's predate that.)

2. **THE A÷V BAND CANNOT CATCH A PAIR THAT IS WRONG TOGETHER.** It rejects an implied
   price outside ₹40–200/L, which catches a digit lost on ONE side. On 26-Aug 12:59 the
   fallback returned **168,018,917.48 L at ₹57.03/L** and **179,986,210 L at ₹54.43/L** —
   both inside the band, both marked `legible: true`, both on a serial (`17CH2900V`)
   that matches no pump at the outlet. The guard had nothing to object to. A physical
   plausibility test on the VOLUME itself is a separate check the parser does not have.

3. **ATTRIBUTION IS UNSTABLE ON THE GOOD ENGINE TOO.** Two Vision scans six minutes
   apart return identical figures on opposite serials, and nothing flagged either:

   ```
   26 Aug 13:11   17CH2645V.2 = 2,221,650.62   17CH2653V.2 =   127,330.32
   26 Aug 13:17   17CH2645V.2 =   127,330.32   17CH2653V.2 = 2,221,650.62
   ```

   The 25-Aug scans agree with 13:11, so 13:17 and 13:32 are the outliers. A manager
   accepting the later scan would have put one pump's meter on another — a two-million-
   litre error, silently. **This is the strongest evidence for rule 1 below:** the reader
   alone does not reliably know which line belongs to which machine, so the serial and
   its printed nozzle number must be captured once, from a real slip, and pinned.

### The rules this burns into Step 4

1. **Commissioning is a verified act, and it gates the switch.** Every serial +
   printed-nozzle-number pair captured by scanning a REAL slip at setup, human-confirmed,
   stored as printed. `defaultSlipNo()` guesses are abolished on flow-v2 outlets; the
   commissioning reading is the chain's genesis event.
2. **Never fail silently.** A near-miss serial PROPOSES the nearest known machine —
   one tap to confirm. No close match → a loud card: "not from any machine at this
   outlet." A fallback-engine read is marked low-trust and always goes through human
   confirmation; the fallback reason is recorded.
3. **A reading enters the chain only through three checks:** V-line found by its label
   (#353), A÷V implies a sane price, and the physics pair (never decreases, never
   faster than the pump delivers).
4. **The process measures itself.** Scans / matched / typed / engine / fallback-reason,
   per outlet per week, on the owner dashboard from day one. Every scan stores its
   structured result, success or failure.

### Validation is REPLAY, not a field trial

The stored artifacts — the 25/26-Aug composites, the Nagole set, the 02–04 Aug photos —
are the regression bench: real slips, real glare, known right answers. Re-run them
through the reader + hardened matcher offline and measure before any screen ships.
Commissioning is not a trial either: one slip per pump, five minutes, part of switch-on.

### Build-order amendment

Between Step 3 and Step 4 sits **Step 3.5 — the instrument slice**: commissioning-by-slip
gating the switch, match-and-confirm, the wrong-outlet card, the fallback made loud,
telemetry, and the replay bench. The screens then follow the pattern deliveries proved:
scan → editable review, every figure badged → confirm.

---

## 11. Owner rulings — 27-Aug evening. Settled; do not re-propose.

Four points from the design review, answered by the owner. These carry the same weight
as the frozen design in `CLAUDE.md`.

1. **The money loop is complete, and the document must say so.** When a duty closes,
   the CALCULATED outstanding registers as a liability against the attendant — the
   suspense shape `credit_suspense_entries` already uses. He then settles: hands the
   manager cash / UPI / card / credit slips / petty, and that settlement entry brings
   his suspense down. Nothing silently zeroes it, and nobody walks off with the money
   as a matter of design — the liability stands until cleared.

2. **Price changes are NOT this system's problem. Build nothing for them.** The price
   is updated manually at the forecourt controller and manually in Pumpini; we cannot
   know a change we are not told about, and there is no way to gate sales pre/post
   change. If the price changes at 6 AM, the manager closes and recommences around it —
   his duty, and his loss if he sleeps through it. No price-boundary machinery, no
   proration, no "reading at the price moment" requirement. (This retires the review's
   6 AM-anchor argument; the recon-cadence question in §8 stands on discipline alone.)

3. **The incoming man's slip closes the outgoing duty, and that is the whole design.**
   On a normal day the outgoing man brings slip AND money to the manager. A man
   running away without the slip is running away WITH the money — the slip is not his
   incentive. It is a technical possibility, not a scenario to engineer for: no
   missed-handover detection, no prompt system, no override. (Reaffirms the frozen
   design's "the act of taking over is the act of closing".)

4. **The sidebar stays as drawn. The badge is the nudge.** The manager chooses his
   function from the side panel like everywhere else in Pumpini. The Attendant Dues
   badge (men not yet cleared) and the landing screen's last-recon card are the
   reminders; no task-queue layer, no guided-home redesign.

5. **Deliveries is an exception, not a recon step** (same evening). A decant can be
   once a week; putting a deliveries screen in the daily path "just because the
   mathematical formula says so is pure hypocrisy." The recon runs three steps —
   landing (last recon + jump-to-date + one CTA), ATG capture with manual
   entry/correction, consolidated nozzle scan with manual entry for any line that
   fails — then the variance. Only when the variance shows a tanker-sized gain is
   the manager led to the deliveries screen, so an invoice forgotten at decant time
   gets scanned at the moment he has a reason to remember it. **Refined the same
   evening:** the trigger is COMPARTMENT scale, not full-tanker scale — tankers are
   shared between unrelated outlets, one compartment discharged here and another
   there, so a single compartment (~3–4 KL) is a normal decant. Fire when the gain
   is beyond the outlet's variance tolerance AND at least ~1,000 L (a build-time
   constant to tune with the owner); a difference around 100 L is dip noise and
   never asks for a tanker invoice.
