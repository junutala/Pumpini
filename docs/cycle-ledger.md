# The cycle ledger — one reading, one record, no drift

> **Status:** design, owner-approved 04-Aug-2026. No code yet. The DDL in §7 is
> owner-run and gated, step by step, as every schema change is.

---

## 1. Why this exists

On 03-Aug-2026 Kamala's stock reconciliation reported **4,254 L of missing fuel**. None
was missing. Sales matched the meters exactly and the meter chain was unbroken across six
days and eight nozzles. The whole of it came from the opening dip, and the opening dip was
wrong for one reason:

> **One physical measurement was stored as two rows, and the two rows were free to
> disagree.**

The manager reads a gauge once at the handover. Pumpini filed that reading as the outgoing
shift's `closing` *and* as the incoming shift's `opening` — two rows, one fact. Once two
rows exist for one fact, everything else follows:

- **26 duplicated opening rows** in production, 12 of them holding contradictory figures.
- Highway tank 1 held **6,592.56 L** and **3,475.52 L** for the same morning.
- Kamala 16-Jul tank 2 held **511.69 L** and **12,824.76 L** for the same morning.
- Four readers resolved the contradiction four different ways — the stock reconciliation
  took the newest, deliveries and the settlement ledger took the oldest, data-health took
  the largest. The same tank-shift reported three different opening stocks on three
  screens.
- Asked for the same number twice, outlets did it once: Highway and Adhoc Highway recorded
  8 and 6 opening dips over 02–04 Aug and **not one closing**, so they had no wet-stock
  variance at all for three days.

Each of those was patched. Patching is the wrong answer. The defect is not in any query —
it is in a model that lets one fact be written twice.

**This design removes the second row.** A reading is stored once and serves both ends of
the boundary it sits on. The disagreements above become unrepresentable rather than
guarded against.

---

## 2. The model

Two tables. One row per **cycle** — what the owner called a *line*: the span a meter runs
between two readings.

A line is `open` from the moment it begins until a reading arrives. That reading **closes
it and opens the next one at the identical figure**, because it is the same stored value
read from two directions.

```
                seq 46            seq 47            seq 48
   ────────────────┼─────────────────┼─────────────────┼──────────────
              reading R1        reading R2        reading R3
              closes 45         closes 46         closes 47
              opens 46          opens 47          opens 48
```

`R2` is stored exactly once, on cycle 46. Cycle 47 does not copy it; it *derives* its
opening from cycle 46's closing. There is no second copy to drift.

### 2.1 Why the opening is derived, never stored

This is the decision the whole design rests on.

If a cycle row carried both `opening` and `closing`, the same number would sit in cycle
46's closing and cycle 47's opening — and one day they would differ, exactly as they do
today. Deriving it is not a normalisation nicety; it is the entire mechanism.

Reads are unaffected. A view exposes `opening_ltrs` as an ordinary column, so queries and
screens look precisely as they do now:

```sql
CREATE VIEW v_tank_cycles AS
SELECT c.*,
       LAG(c.closing_ltrs) OVER (PARTITION BY c.tank_id ORDER BY c.seq) AS opening_ltrs
  FROM tank_cycles c;
```

The difference is that **no writer can set it**.

### 2.2 Why `seq` and not dates

Sequence has no opinion about dates, timestamps, or which shift was opened first.

This matters immediately. The three outlets being onboarded run **three shifts a day**, so
the calendar date drifts inside a shift. Every ordering rule we have written against dates
or timestamps — `ORDER BY recorded_at`, `ORDER BY start_time`, "the immediately preceding
shift" — is a rule that can be got wrong at a boundary. `seq` cannot.

The scenario that breaks the current code:

> The 4-Aug shift is still open. On 5-Aug at 06:00 the manager opens the next shift and
> assigns attendants with their nozzle slips before anyone closes 4-Aug.

Today that silently carries a **two-shift-old** meter into the new opening and overrules
the manager's scan with it, charging the incoming attendant for a day of fuel he never
sold. Under this model it is unremarkable: the tank's line is at `seq 47`, state `open`,
and it stays open until a reading arrives. Nothing to detect, nothing to back-fill.

### 2.3 The invariant, enforced by the database

```sql
CREATE UNIQUE INDEX tank_cycles_one_open   ON tank_cycles   (tank_id)   WHERE state = 'open';
CREATE UNIQUE INDEX nozzle_cycles_one_open ON nozzle_cycles (nozzle_id) WHERE state = 'open';
```

**Two open lines on one meter become impossible.** That guarantee has never existed in
Pumpini, and its absence is what allowed the duplicate rows.

---

## 3. Commissioning — the only reading ever typed

**Owner rule, 04-Aug-2026:**

> *"The only way to ever open the tank reading and the pump/nozzle reading is when I define
> a new outlet and scan the image/slips for the first time from the SETTINGS. This is the
> time the first entry fires and quietly waits for the next reading onwards to print twice
> thereafter."*

So there is **exactly one typed reading per meter, for its whole life**:

- Defining a **tank** in Settings, with the gauge photo, writes `tank_cycles seq 0`,
  `state='closed'`, holding the commissioning stock.
- Defining a **pump/nozzle** in Settings, with the sample slip, writes `nozzle_cycles
  seq 0`, `state='closed'`, holding the commissioning meter.
- Both immediately open `seq 1`, and the outlet starts running.

Every reading after that closes a line and opens the next. None is ever "entered".

**What this removes.** Today `openingService` returns `source: 'entered'` whenever no
carry is found, and the screen then accepts a typed figure into a live opening. That is
the last remaining path for a bad number to enter the system, and this rule deletes it: a
carry can never be missing, because the line always exists.

**Consequences that must hold:**

- **No shift screen ever offers an opening field.** Shift Start shows the handover reading
  and nothing else. If it has an entry box for an opening, this design has been broken.
- A **nozzle or tank added later** to a running outlet is commissioned the same way, in
  Settings. It is a new meter, so it gets its own `seq 0`.
- A **meter with no open line** is a fault, not a prompt. It is repaired by a commissioning
  action in Settings — visible, audited, owner-level — never by typing a number on a shift
  screen.
- **Retiring** a pump or nozzle closes its line permanently (`end_date` already exists on
  both). A retired meter has no open cycle and is not offered anywhere.

---

## 4. The tables

Both are station-scoped and carry RLS from birth (§7).

### 4.1 `tank_cycles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `station_id` | uuid | RLS scope |
| `tank_id` | uuid | |
| `seq` | int | gapless per tank, from 0 |
| `state` | text | `open` \| `closed` |
| `opened_in_shift_id` | uuid null | null on `seq 0` |
| `closed_in_shift_id` | uuid null | differs from the above when the cycle spanned shifts (§4.3) |
| `closing_ltrs` | numeric null | **the reading.** null while open |
| `closing_dip_cm` | numeric null | null for a system/ATG reading — that is how the two are told apart |
| `closing_density` | numeric null | |
| `closing_temp_c` | numeric null | |
| `closed_at` | timestamptz null | |
| `closed_by` | uuid null | |
| `artifact_id` | uuid null | the gauge photograph the figure was read off |
| `delivered_ltrs` | numeric | decants inside this cycle |
| `sold_ltrs` | numeric | from the nozzle cycles drawing on this tank |
| `variance_ltrs` | numeric null | **materialised at close, never recomputed** |
| `variance_pct` | numeric null | |

`opening_ltrs` — **derived** (§2.1).

Reconciliation, stored once at close:

```
variance_ltrs = opening + delivered − sold − closing
```

### 4.2 `nozzle_cycles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `station_id` | uuid | RLS scope |
| `nozzle_id` | uuid | |
| `seq` | int | gapless per nozzle, from 0 |
| `state` | text | `open` \| `closed` |
| `opened_in_shift_id` | uuid null | |
| `closed_in_shift_id` | uuid null | differs when the man worked through a shift boundary (§4.3) |
| `attendant_id` | uuid null | who worked it in this cycle |
| `closing_reading` | numeric null | **the reading.** null while open |
| `test_ltrs` | numeric | |
| `closed_at`, `closed_by` | | |
| `artifact_id` | uuid null | the pump slip |
| `sold_ltrs` | numeric null | `closing − opening − test`, materialised at close |
| `variance_ltrs` | numeric null | vs. an independent check (POS/console), kept forever |
| `settlement_id` | uuid null | which settlement paid this cycle out; null = closed and unsettled (§4.3) |

`opening_reading` — **derived**.

**The meter belongs to the meter, not to the attendant.** Today the nozzle meter lives on
`shift_attendant_nozzles` — a meter fact stored on an attendant row. That is why one
attendant on four nozzles was awkward and why the retired tables held 70 negative and 150
impossible readings. Here the cycle belongs to the nozzle and *references* the attendant,
which is the right way round.

Two attendants on one nozzle in a shift is then natural: two cycles, consecutive `seq`,
each with its own operator, and the handover between them is one reading like any other.

---

## 4.3 A cycle is bounded by READINGS, not by shifts

This is the property that resolves a case Pumpini has never handled, raised by the owner
04-Aug-2026:

> *"Sometimes one attendant covers more than one shift and he comes back at the end of the
> second shift and does his settlement."*

Because a line closes only when a **reading arrives**, and no reading is taken when nobody
hands over, one cycle simply spans both shifts. The man works, no scan happens at the shift
boundary, the line stays `open`, and at the end of his second shift one reading closes it.
His sale is `closing − opening − test` on **one** cycle. There is no special case, no
"which shift does this settlement belong to", and no stitching of two half-settlements.

The current model cannot express this at all: a meter row is keyed to a shift
(`shift_attendant_nozzles`), so a man across two shifts has two rows and the boundary
between them is a reading nobody took.

Two consequences must be built in, or the case breaks anyway:

**A cycle records where it opened and where it closed.**

| | |
|---|---|
| `opened_in_shift_id` | the shift running when the line opened |
| `closed_in_shift_id` | the shift running when the reading arrived |

When they differ the cycle spanned shifts. That is a **fact to record, not an error to
reject** — and it is how the tank reco knows which shift's stock movement to attribute.
(A single `shift_id` column cannot express it, which is why it is two.)

**Settlement is keyed on cycles, not on a shift.** The rule:

> An attendant's settlement covers **every closed, unsettled cycle of his** — not "the
> cycles of this shift."

That one sentence handles all four shapes without branching:

| Situation | Cycles | Settlement |
|---|---|---|
| One attendant, one shift | 1 | that cycle |
| One attendant, two shifts, no boundary reading | 1, spanning both | that cycle |
| One attendant, two shifts, boundary reading taken | 2 | both, summed |
| Two attendants on one nozzle in a shift | 2, consecutive `seq` | each separately |

The third row matters: sometimes a reading *is* taken at the boundary because the other
operators changed over. The man himself did not, so his two cycles settle together. Keying
on the shift would have split his money in half.

This is also what the owner's ordering already implies — *the line closes → reco runs →
the cash settlement relieves the attendant.* The settlement relieves the **man**, and it
does so over whatever lines of his are closed and unpaid.

---

## 5. Closing a line — the one writer

A single service function, called by every path: the handover on Shift Start, Shift End,
and the Dipstick screen. One transaction, doing three things and incapable of doing two:

1. Stamp the reading onto the open cycle; set `state='closed'`; compute and store
   `variance_ltrs`.
2. Insert the next cycle, `seq+1`, `state='open'`.
3. Nothing else.

Guarded by the partial unique index (§2.3), so a double submit or two managers on two
phones cannot open two lines. A repeat submission is an **update to the still-open cycle**,
not a second row — the same shape as the fix already shipped for `POST /dipstick` in #248.

Trust boundaries stay separate routes over this one function, per the standing one-writer
rule: `reconcile.manage` for the manager, `settlement.enter` for the operator.

### 5.1 The three moments, kept apart

As the owner put it: *the line closes → reco runs for tank and nozzle → the cash settlement
relieves the attendant.*

| Moment | What it records | Where |
|---|---|---|
| **Close the line** | the physical reading | `*_cycles` |
| **Reco** | variance, stored forever | `*_cycles.variance_ltrs` |
| **Settle** | cash, card, UPI, credit, petty | settlement tables |

Today the first and third are entangled — the settlement is what *writes* the meter, which
is exactly why one scan cannot serve both ends of a handover. Separating them is what makes
one reading possible.

---

## 6. The variance field, and why it is stored

Materialised at close and **never recomputed**.

If variance were calculated on read, then correcting a nozzle→tank mapping, a price, or a
calibration chart six weeks later would silently rewrite what every past day appeared to
be. The ability to say *"on 03-Aug this outlet was short by X"* would be lost. Stored, the
drift is a permanent fact of that cycle.

This is not theoretical. After the 03-Aug repair Kamala reconciles to:

| Tank | Fuel | Variance |
|---|---|---|
| 1 | diesel | **+572.55** |
| 2 | diesel | **−629.46** |
| 3 | petrol | −9.47 |

Near-equal and opposite on the two diesel tanks: the signature of **cross-attribution**
between them — a nozzle mapped to the wrong diesel tank, or two tanks sharing a draw — not
of fuel going missing. A standing pattern like that would have been obvious within days
from a stored variance column. Instead it took a bad morning to find.

---

## 7. Migration — no ambiguous day

Every step is reversible and no old data is destroyed until the three real outlets have run
a full cycle on the new model.

**Step 1 — create.** Both tables, both partial unique indexes, and **RLS policies in the
same DDL block**. New tables get RLS enabled automatically on this Supabase project, and a
policy-less table reads as empty and refuses inserts — the failure is asymmetric and slips
through review, as `credit_slip_books` did on 30-Jul.

```sql
ALTER TABLE tank_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tank_cycles_station ON tank_cycles FOR ALL
  USING      (station_id IN (SELECT my_stations()))
  WITH CHECK (station_id IN (SELECT my_stations()));
-- same for nozzle_cycles
```

Verify with `SELECT * FROM pg_policies WHERE tablename IN ('tank_cycles','nozzle_cycles');`
before calling the step done.

**Step 2 — backfill.** From `dipstick_readings` and `shift_attendant_nozzles`, sequencing
by shift `start_time`. The backfill's own report is the deliverable: **every place a
derived opening disagrees with the stored one is a drift not yet found.** Expect Kamala
16-Jul tank 2 to appear (511.69 vs 12,824.76, prior close 9,382.66, no delivery — still
held for the owner's decision).

**Backfill ALL available history, not a chosen window.** `seq` must be gapless from the
meter's first known reading, and whatever the backfill starts from *becomes* `seq 0` — the
commissioning figure. Backfilling only July would silently declare the first July reading
to be each meter's commissioning point and orphan June behind it. The volume is trivial
(876 nozzle rows and a few hundred dips), so there is no reason to truncate. Production
data begins **25-Jun-2026**; the ledger starts there.

**Test fixtures are excluded.** Only Kamala, Adhoc Highway and Highway are real outlets in
production. Dilsukhnagar Bunk, VAWE-1 and the unnamed outlet are backfilled in staging
only, so a prod ledger holds nothing that has to be filtered out by hand later.

**Step 3 — dual-write.** New readings land in both models. Reads stay on the old. Nothing
user-visible changes; the two models are compared daily.

**Step 4 — flip reads per outlet**, via the existing `station_settings` switch. Kamala
first, for a full day, both models visible side by side.

**Step 5 — settlement and tank reco read the new tables** for all outlets.

**Step 6 — retire.** Old columns become read-only history.

Any step is undone by flipping the switch back. Steps 1 and 2 are additive and change no
behaviour at all.

---

## 8. What this closes

Per the cardinal rule, a change must say which route it closes. This one closes several:

- The **opening-dip entry** on Shift Start — gone. Commissioning is the only entry.
- The **opening-meter entry** on attendant assignment — gone, same reason.
- The **second scan** at Shift End for a reading already taken at the handover — gone.
- `source: 'entered'` as a runtime possibility — gone (§3).
- `shift_attendant_nozzles` as a meter store — superseded; the meter returns to the meter.

Net: fewer paths to the same destination, and one of them provably impossible to write
twice.
