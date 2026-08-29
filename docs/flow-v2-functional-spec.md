# Flow v2 — Functional Specification

**Baseline:** `main` @ `22ed684`, 28-Aug-2026. Every fact below was read out of the
merged code or the production database on that date; nothing here is aspirational.

**Live at:** Dilsukhnagar Bunk only (`station_settings.hub_spokes_migration_enabled`
is TRUE at exactly one outlet — verified in production 28-Aug). Kamala Filling
Station, Adhoc Highway Filling Station and Highway Filling Station are untouched and
continue to run the shift flow.

---

## 1. What problem this solves

Pumpini's original model makes the **shift** the boundary for everything: stock is
measured across it, meters open and close on it, and a man's money settles inside it.
That works where a manager runs a tidy three-shift day.

It fails at Sri Balaji, and the owner's words are the specification:

> *"Srinivas is making a lot of noise around the shift and he does not understand
> shifts. He says he has 4 shift patterns and we have only 3 shift definitions."*

He is not being difficult. **A shift is our abstraction, not his.** He thinks in
tanks, nozzles and men. Three things move on three different clocks:

| The thing | Its clock |
|---|---|
| A **nozzle** | seconds — it moves whenever somebody pulls the trigger |
| A **tank** | readings — it moves when somebody reads the gauge |
| The **money** | days — it settles when a man hands cash over |

Welding all three to one shift is what produced every failure of 25/26-Aug. So in
Flow v2 the **outlet is the hub**, there are **three spokes**, and the spokes do not
reach into each other. Each owns one clock.

The shift is not deleted. It is **demoted** to roster and attendance — who was on
duty, and a label a report can group by. It answers *"how did the morning shift do"*
as a **view over accounts**, never as the thing that owns them.

---

## 2. Who does what

| Actor | What they do in Flow v2 | Permission |
|---|---|---|
| **Owner** | Turns the flow on for an outlet; commissions every nozzle from its slip | `settings.manage` **and** role `owner` |
| **Manager** | Takes the tank reconciliation; records every handover; settles each man | `stock.reconcile`, `reconcile.manage`, `settlement.enter` |
| **Attendant** | Works his nozzles; hands over money | unchanged — he has no screen in this flow |

The permissions are the ones these acts **already ran under** in the shift flow. A
spoke is the same job by a different route, not a new privilege.

---

## 3. Spoke 1 — UGT reconciliation (the manager's act)

**Three inputs captured together, at one moment.** That simultaneity is not a
convenience; it is the entire reason the flow exists.

1. **ATG** — the console's stock reading per tank. Photograph it or type it.
2. **Deliveries** — whatever decanted into the tank inside the window. Not entered
   here: it is read from the deliveries the outlet already records, because a
   delivery has never belonged to a shift (172 of 172 rows in production carry
   `tank_id` and a NULL `shift_id`).
3. **Nozzle slips — all nozzles, one composite photograph.**

### The straddle problem, and why this is the answer

An ATG reading is a **point in time**. A nozzle account is a **span**. Four ways out
were argued and all four were beaten:

- prorate by time — *this is the back-solved dip wearing a different hat*
- force a handover at every dip — *punishes the forecourt for our arithmetic*
- refuse to reconcile until all accounts close — *the tank waits on the men*
- reconcile on closed accounts and declare completeness — *quietly incomplete*

The owner's answer: **take the nozzle reading at the tank boundary without disturbing
anybody's account.** Because the composite slip scan happens at the same instant as
the ATG scan, the tank window and the nozzle totals share a boundary **by
construction** rather than by adjustment afterwards. Do not re-open this.

### What the manager sees

Four screens, in order — and the third and fourth are deliberately **one screen**,
because *partial is the normal state, not an error*: the nine nozzles that read sit
beside the three that did not, and each unread one offers the camera and the keyboard
together, at the same size.

| Screen | What happens |
|---|---|
| `/tank-recon` | Opens or resumes a draft. Shows when the last confirmed recon was taken. |
| `/tank-recon/atg` | Stock per tank — snap or type. |
| `/tank-recon/nozzles` | One photograph of every slip; every figure editable; unread ones typed. |
| `/tank-recon/variance` | What the arithmetic says, per tank, before anything is frozen. |

### The arithmetic

    book  = opening + deliveries + test-draws-that-crossed-tanks − sales
    variance = actual − book

- **opening** — the previous *confirmed* recon's figure for that tank. No opening,
  no variance: the tank reports "no baseline yet" rather than a phantom full-tank
  loss. (This was a real bug in the first draft — `Number(null)` is `0`, not `NaN` —
  caught by its own test.)
- **sales** — each nozzle's movement between the **same two instants** the tank was
  read at. A negative movement is a reset or a misread and is floored at zero rather
  than credited as fuel returning to the tank.
- **test draws** — only a draw that **crossed** tanks moves stock. A same-tank draw
  cancels itself.
- **tolerance** — a percentage of what *went through* the tank (`opening + deliveries`),
  not of the closing figure: a tank that took a delivery has had more chance to drift
  than one that sat. Defaults 0.75 % petrol, 0.50 % diesel, floor 20 L, all per-outlet.

A **gain** beyond tolerance and at least a compartment's worth (~3–4 KL) is far more
likely a delivery nobody recorded than a mystery. The screen says so and offers the
existing Deliveries screen, rather than inventing a second way to record a decant.

### Cadence

**Still the owner's call.** Daily is 12 slip prints and cheap. Per shift is 24 a day,
and somebody starts skipping — which quietly puts the straddle back. Nothing in the
code assumes either; the recon simply reconciles between its own two confirmed
readings.

---

## 4. Spoke 2 — the nozzle account

**A nozzle carries ONE CHAIN of readings. Each reading closes the account before it
and opens the one after — one number, stored once, read from both directions.**

There is no "closing" column and no "opening" column, so the two cannot disagree.
This is the 01-Aug one-meter-store rule carried into the new flow.

### The three kinds of reading

| | What it is | What it moves |
|---|---|---|
| **Event** | a nozzle slip scanned at a handover | the account, to the next man |
| **Co-event** | a scan producing the *same* reading as the one before it | nothing — it records the **drift in time** between the outgoing man's print and the incoming man's, so the owner has data to push the manager on discipline. A metric, not a measurement. |
| **Genesis** | the commissioning reading | opens the first account without closing one |

Spoke 1's composite scan is a reading on the same chain **but it never moves an
attendant account** — see §7.

### The pump is never blocked, and there is no override to build

If a man walks off without printing, **the next man's scan IS the closing event** and
the outstanding strikes against the man who left. The act of taking over is the act of
closing, so there is nothing to freeze and no break-glass. An earlier design proposed
a block with a manager override; the owner's model removes the need for both.

### Who a reading closes is never asked

The manager picks **who takes over** — and "nobody, it goes idle" is a real answer.
Who it *closes* is derived from the chain. A manager who is himself short would
otherwise only have had to pick a different name.

### Two alarms, and only two — both physics, not judgement

A handover where the readings differ is **usually just fuel sold in the gap** and must
raise nothing. A manager who justifies three litres twice a day learns to click
through, and then a real reset sails past on the same habit.

| Condition | Why it is certain |
|---|---|
| The reading **decreased** | A totaliser only counts up. Always a reset, a replacement or a misread. |
| It rose **faster than the pump can deliver** | ~40 L/min flat out. 400 L across a 3-minute gap is impossible. |

Everything else is recorded as drift, in silence.

When one of the two fires, the reading is **refused until the manager types a reason
in his own words**. Never a dropdown — a canned reason code becomes a reflex. And a
meter that was genuinely **reset or replaced** needs a new starting point, which is a
**commissioning action in Settings under the owner's eye** — never a number typed on a
handover screen.

---

## 5. Spoke 3 — the attendant

### The outstanding is CALCULATED. There is no field for it anywhere.

    what he owes = (litres he closed, priced at the fuel's current rate)
                 − (what he has already handed over)

That is the structural fix for the 25-Aug loss of **₹1,25,275** across three
settlements recorded with `cash_actual = 0`. **A manager cannot make a liability
vanish by leaving a field blank, because there is no field to leave blank.**

Litres come from the man's own events: each event he was on contributes the movement
since the event before it. A co-event moves nothing and contributes nothing. A genesis
closes nobody.

### The only manual entry is what he BROUGHT

Cash, card, UPI, credit slips, petty/skim — the **same five fields, in the same order,
on the same form** as Shift Close. Not a copy: literally the same component, embedded
in both screens, so a manager who learns it in one already knows it in the other. A
second set of five boxes differing only in a label is the named tell for the drift the
cardinal rule forbids, and it was written that way once before the owner said *"we can
borrow the same screen."*

**A settlement of nothing is refused.** It may not complete silently at zero.

### The money clock never blocks the forecourt

Every attendant with an outstanding keeps showing until the manager settles him. He
works his next shift regardless; he simply cannot reach zero until he settles. It
degrades exactly like the credit suspense ledgers already do.

### Who may clear an outstanding — still the owner's call

Today the settle route asks for `settlement.enter` and nothing more. That is the
**weak-control option**: the manager is often the man who took the cash. Owner-only is
slow. The middle path the owner sketched — manager records, owner confirms — is a
small change once he says so.

---

## 6. Commissioning — the act that unlocks the switch

The flow matches money on **`<pump serial>.<printed nozzle number>`** — the identity
the nozzle's own slip prints, which an attendant, a manager and an auditor can all
verify by holding the paper against the screen.

Until now the printed half was **defaulted from our own index**: `"1.3"` became `"3"`,
a convention this repo invented that no slip has ever confirmed. In the shift flow
that default is harmless. Here it is not — a wrong printed number puts one nozzle's
meter on another nozzle's account and **both men's outstandings are wrong**, with
nothing on any screen to show it. Nagole's six nozzles carry a serial and no printed
number at all, and its 20-Aug scan matched **0 of 28 lines** in silence.

So the pair is read off real paper, by a person who looks at it, once per pump. Five
minutes, part of switch-on.

**A nozzle is commissioned when it has all three:** a pump with a serial, a printed
nozzle number, and an opening reading. The screen names exactly which of the three is
missing, and a nozzle attached to no pump at all is told to go to Settings rather than
offered a serial box that has nowhere to store it.

### The switch has three refusals — all enforced in the backend

1. **Owner only.** This changes the outlet's whole operating model; holding
   `settings.manage` is not enough to decide it.
2. **Not while a shift is open**, in *either* direction. Half a shift under one model
   and half under the other leaves an opening reading nobody can defend.
3. **Not until every active nozzle is commissioned** — turning **on** only.

**Switching off is never gated.** A way back must never depend on the thing that is
going wrong. Turn it off and the old sidebar and the old flow come straight back; any
recons and events taken meanwhile stay on file.

---

## 7. Two tables for the slip readings — deliberate, priced, not a defect

> *"The nozzle slips at two different hands serve different purposes... I know this is
> duplicate, but I would pass it as design liability — clarity and separation of
> duties."*

Spoke 1's recon readings and Spoke 2's events live in **separate tables**, written by
the **same code**. This is a knowing exception to the one-writer rule, and the reason
is control, not tidiness: **money flows from Spoke 2 only.**

Two tables make *"a recon scan moved an attendant's liability"* **unwritable**. One
table with an origin flag makes it a forgotten `WHERE` clause away.

There is **no third table**. The chain lives in Spoke 2; Spoke 1 is a snapshot that is
never asked *"what did this nozzle last read"*. The one-meter-store rule is not
violated, because there is still exactly one chain.

---

## 8. Reading a slip — what is believed, and what is refused

Every scan goes through one reader (Google Vision for the characters, then Claude over
that text; a direct-vision fallback when Vision is unconfigured, errors, or returns too
little). A line enters a screen only if it survives all of this:

| Check | Refuses | Why |
|---|---|---|
| **Both figures present** | `no_amount_to_cross_check` | Every known layout prints amount *and* volume. A missing amount means we failed to read it, and leaves the volume with nothing to check against. A "volume" of 140,500,859 L passed this way on 20-Aug. |
| **Rupees/litres not swapped** | line marked illegible | At ~₹100/L the money is ~100× the litres. The two are **exchanged**, never one overwritten with the other — the old guard did `vol = amt` and left both holding the same number. |
| **Physically possible volume** | `volume_not_physical` | Above 10,000,000 L. Checked **before** the ratio, because a proportionally-wrong pair passes the ratio and would otherwise be believed. |
| **Implied price sane** | `implied_price_out_of_band` | amount ÷ volume outside ₹40–₹200/L. |

### Never fail silently

- A **near-miss serial proposes** the nearest known machine — one tap to confirm, never
  auto-accepted. The threshold is **one edit**, and that is measured rather than
  chosen: Sri Balaji's own `17CH2645V` and `17CH2653V` are two edits apart, so at two a
  *correctly read* serial would have been offered as a **different real pump**. Two
  equally-close machines propose nothing — a coin toss in a suggestion's clothes.
- **No close match → a loud card**: "not a machine at this outlet."
- **A fallback-engine read says so, on every screen that scans**, and says why. It
  renders nothing at all on a good read, because a badge on every scan is a badge
  nobody sees. On Sri Balaji's 13 stored scans the fallback took 4, and until now
  nobody could have known which 4.

### The process measures itself

Scans, matched lines, engine split and fallback reasons — per outlet, per week. Every
scan stores its structured result, success or failure, so a week like the first week of
August cannot happen again: scanning died and nobody could see it, and the three live
outlets stored **nothing** from 13 photographs.

---

## 9. What the evidence already ruled out — do not re-propose

Checked against production 26-Aug-2026, all four outlets:

- **Do NOT block overlapping shifts.** Kamala opens a shift before closing the previous
  one **12 times in 75** (Adhoc 5/68, Highway 2/59). That is how a night handover works.
- **A literal "one open account per nozzle" lock on the ASSIGNMENT would have refused 8
  Kamala handovers** — all one event, 02-Aug 06:58, where every one of eight nozzles
  closed and re-opened at the identical reading to three decimals. A textbook handover.
  **Gate on the READING, never on the shift clock.**
- **The empty-cash-box guard is safe**: 0 fires in Kamala's 264 settlements and
  Highway's 114; Adhoc's 13 total ₹159.35 — rounding.
- **Deliveries never belonged to a shift**: 172 of 172 rows carry `tank_id`, none carry
  `shift_id`.

---

## 10. Rollout

**This is a migration, not a feature.** A route you plan to close is a migration; a
route nobody closes is drift.

1. **Sri Balaji first** — one week of history, least to disturb, and the outlet with
   the problem.
2. **Kamala, Adhoc Highway and Highway stay exactly as they are** until the new flow is
   proven and its bugs are out. The two experienced managers become the **last**
   adopters, not the test subjects.
3. The old path is deleted when the last outlet moves.

**Only the flow branches. Not the foundations.** These stay single across both flows,
and if any is copied we no longer have two flows — we have two products: nozzle naming,
calibration and dip→litres, artifact storage, prices, users, stations.

### Current state, verified 28-Aug-2026

- All five tables exist in production with RLS on, one isolation policy each, and
  `app_authenticated` holding SELECT and INSERT.
- The flag is ON at **Dilsukhnagar Bunk** and nowhere else.
- **Zero genesis events exist at any of the eight outlets**, so the commissioning gate
  holds every outlet until somebody scans. That is the intent, not a defect.
- Sri Balaji's 12 nozzles all carry a serial and a printed number already, so
  commissioning there is 12 readings.

---

## 11. Open — the owner's calls

| | Question | Where it bites |
|---|---|---|
| 1 | **Recon cadence** — daily or per shift | Per shift is 24 prints a day and somebody skips, which puts the straddle back |
| 2 | **Who may clear an outstanding** | Today: `settlement.enter`. The manager is often the man who took the cash |
| 3 | **Owner dashboard** | Deliberately reworked **after** the flow is frozen, not alongside it |
