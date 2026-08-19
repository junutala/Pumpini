# Opening dip: carry, verify, and flag the mismatch

**Status:** design, not built. Schema below is owner-gated and not yet applied.
**Date:** 16-Aug-2026
**Owner ask:** *"Let the user scan the UGT image from the HPCL system and the nozzle
slip at the start of the shift. If the carried forward numbers do not match, raise an
alert and let the manager manually override by giving a reason."*

---

## 1. What is actually wrong today

The carry-forward rule is implemented and enforced. `seedOpeningDips` copies the
previous shift's closing dip into the new shift as its opening at the moment the
shift is created, and `POST /dipstick` refuses to overwrite an opening that already
exists (`kept = true`). **There is no drift in the stock record.**

Three defects sit on top of that correct rule.

### 1a. The lock cannot engage when the manager is looking at the screen

Shift Start renders a locked row — `🔒 Carried from last close` — for any tank in
`carriedDips`. That map is filled by `refreshShift(id)`, which reads
`/dipstick?shift_id=<id>`. **It needs a shift id.**

The screen deliberately does not create a shift until the first reading is saved
(*"nothing is created by just looking"*). So on arrival there is no shift, no
`carriedDips`, and every tank falls through to the editable branch. The previous
closing appears only as a grey footnote, beside an empty box.

The screen therefore invites an entry that the rule forbids.

### 1b. A typed opening is silently discarded

If the manager types into that box and continues:

1. `ensureShift()` creates the shift → `seedOpeningDips` carries the closing in.
2. His typed figure POSTs as `reading_type='opening'`.
3. The route finds the seeded row and keeps it, **writing nothing**.

The right number survives. His is thrown away with no message. Silent discard is
worse than either accepting or refusing, because it teaches nothing and hides a
disagreement that is worth knowing about.

### 1c. A real disagreement is not recorded anywhere

If the gauge at shift start genuinely reads differently from what the last shift
closed at, that is an overnight loss, a bad closing reading, or a delivery nobody
filed. All three deserve attention. Today the observation cannot even be expressed.

---

## 2. Principle

> **The carried figure is the opening. The observation verifies it. A disagreement
> is an event, not a correction.**

This is not a new idea in this codebase — it is what the **nozzle** path already
does. `resolveNozzleOpening`:

```js
return {
  opening: carried,          // the carry always wins
  source: 'carried',
  requested: asked,          // what the manager read, kept
  overridden: asked != null && Math.abs(asked - carried) > 0.0005,
};
```

with the comment: *"Flagged, not rejected. A manager whose slip reads differently
from the last close is looking at a real discrepancy — but the fix for that is an
investigation, not a different opening figure."*

**Dips get the same treatment.** Nothing here invents a second mechanism; it closes
the half of the pattern that meters have and tanks do not.

Note the nozzle path surfaces `carryConflicts` in the response but never persists
it — the discrepancy is shown once and lost. The dip path should persist, and the
nozzle path should later be brought up to match (out of scope here, logged in
`docs/drift-audit.md`).

---

## 3. Design

### Part 1 — Show the carried figure before the shift exists

Add a read-only preview: *what would be carried if this shift were opened now.*

- New: `GET /api/shifts/carry-preview?station_id=&date=&shift_number=`
- It runs **the same query as `seedOpeningDips`**, without the INSERT.

This must not be a second implementation of the carry rule. Extract the SELECT into
one exported function used by both, so a change to the rule cannot leave the screen
promising a carry that will not happen.

Why not derive it in the browser from the footnote? Because the footnote is *"the
tank's last saved reading"*, whereas the carry is *"the closing of the shift
immediately preceding this one"*. Those differ whenever the last closing belongs to
an older shift — and a UI that promises a carry which then does not happen is
exactly the class of bug being fixed.

Shift Start then renders `🔒 Carried from last close` from the preview, with **no
entry box**, before any shift exists. A tank with no prior close still gets an open
box, as today, because there is genuinely nothing to carry.

### Part 2 — The scan becomes a check, not an entry

`Take a photo of the gauge screen` already OCRs every tank at once
(`parseGaugeScreen` → `matchGaugeRows`). Today it fills the entry boxes.

For a **carried** tank it must instead compare. Per tank:

| | |
|---|---|
| `carried_volume_ltrs` | from the preview / seeded opening |
| `observed_volume_ltrs` | from the scan (or typed, if the gauge is unreadable) |
| `observed_at` | the artifact's `captured_at` — the photo is the clock |
| `variance_ltrs` | observed − carried |

`observed_at` also answers the separate question raised on 16-Aug: a reading entered
in the office at 11:40 for a measurement taken at 11:00 is currently stamped 11:40,
because `recorded_at` is hardcoded to `NOW()` on write. Taking the time from the
photograph makes the observation time a fact rather than an artefact of when someone
reached a desk.

### Part 3 — Flag beyond tolerance, override with a reason

**Tolerance reuses what exists** — `station_settings.stock_tol_pct_petrol`,
`stock_tol_pct_diesel`, `stock_tol_floor_ltrs`. These already define "how much
wet-stock variance is normal" for the stock reconciliation. A second, different
notion of tolerance for the same physical quantity is precisely the drift this
codebase keeps having to undo.

```
tolerance_ltrs = max(stock_tol_floor_ltrs, carried_volume × tol_pct_for_fuel / 100)
within tolerance  → record silently, no alert, shift proceeds
beyond tolerance  → REQUIRE a reason, then record + alert the owner
```

The opening **never changes**. The manager is not being asked to correct a figure; he
is being asked why the tank does not hold what the last shift said it held.

Alerting reuses `alertService.sendAlert({ station_id, alert_type:
'dip_carry_mismatch', severity: 'warning', message })`. No new alert channel.

**The reason is mandatory beyond tolerance and free text.** A dropdown would be
guessing at causes we have not yet seen; the first fifty reasons collected are what
should decide whether it becomes a list.

---

## 4. Schema

One table gains six columns. **No new table**, so no new RLS policy to forget —
`dipstick_readings` already carries `dipstick_readings_station_isolation`.

Everything is additive and nullable, so code shipping ahead of the DDL cannot break:
a read that does not find these columns behaves exactly as today.

### ⚠️ RUN THIS SQL FIRST — step 1 of 1

```sql
ALTER TABLE public.dipstick_readings
  ADD COLUMN IF NOT EXISTS observed_dip_cm       numeric(8,2),
  ADD COLUMN IF NOT EXISTS observed_volume_ltrs  numeric(10,2),
  ADD COLUMN IF NOT EXISTS observed_at           timestamptz,
  ADD COLUMN IF NOT EXISTS observed_artifact_id  uuid REFERENCES public.station_artifacts(id),
  ADD COLUMN IF NOT EXISTS carry_override_reason text,
  ADD COLUMN IF NOT EXISTS carry_variance_ltrs   numeric(10,2)
    GENERATED ALWAYS AS (observed_volume_ltrs - volume_ltrs) STORED;

CREATE INDEX IF NOT EXISTS dipstick_readings_carry_variance_idx
  ON public.dipstick_readings (station_id, recorded_at)
  WHERE carry_variance_ltrs IS NOT NULL;
```

Notes on the shape:

- `carry_variance_ltrs` is **generated**, not written — the same choice already made
  for `cash_denominations.total_cash` and `shift_reconciliation.variance`. A
  variance that can be written independently of its inputs is a variance that can
  disagree with them.
- `volume_ltrs` stays the carried figure and the opening. Nothing about the existing
  read path changes.
- The partial index exists so "show me every carry mismatch this month" does not
  scan a table that is mostly nulls.

Column-tolerance is required until this is applied — probe
`information_schema.columns`, never try-and-catch a 42703 inside the transaction
(CLAUDE.md, 30-Jul).

---

## 5. Impact analysis

**1. Schema dependency?** Yes — the six columns above. Additive and nullable, so the
code can ship first and degrade to today's behaviour. The carry preview and the
locked row need **no** schema and can ship independently; only the recording of a
mismatch needs the DDL. **Recommended split: Part 1 first, with no schema at all.**

**2. Who consumes this?** `dipstick_readings` is read by Shift Start (carry), Shift
End (closing), the Dipstick screen, stock reconciliation, the density register and
`dataHealthService`. All read `dip_cm` / `volume_ltrs`, which are unchanged. The new
columns are additive, so no existing consumer sees a different figure.

**3. Blast radius?** Part 1 is read-only: a failing preview should render the box as
editable (today's behaviour), never block a shift opening. Part 3 gates the shift
open on a reason only when beyond tolerance — worth stating plainly, since it is a
new way for shift start to stop. Tolerance floors must be sane or a busy outlet
gets a reason prompt every morning; the existing floor (`stock_tol_floor_ltrs`)
already guards small tanks.

**4. Multi-tenant.** No change. Existing RLS on `dipstick_readings` and
`station_artifacts` covers every new column; the preview derives `station_id` from
the caller's station access, never from the body.

**5. Money / masking.** No sales, credit, cash or margin surface. It touches
**stock**, and only to record an observation beside the carried figure — the opening
itself is never altered by this design.

**6. Rollback.** Revert the code. The columns can stay: nothing reads them when the
code is gone, and dropping a generated column on a hot table is a worse risk than
leaving six nulls.

---

## 6. What this deliberately does NOT do

- **It does not let anyone change the opening.** Override means "record why it
  disagrees", never "use my number instead". That is the whole rule.
- **It does not stop the outlet selling.** Sales are manually controlled (owner,
  16-Aug); nothing here freezes a nozzle.
- **It does not touch the nozzle carry path.** That path already flags and already
  fails to persist. Bringing it up to match belongs in its own slice.
- **It adds no screen and no route to an existing concept.** The preview is a new
  read on an existing rule; everything else extends the dip round and the gauge scan
  that are already there.

---

## 7. Suggested order

1. **Part 1 alone** — carry preview + locked row before the shift exists. No schema,
   no new writes, fixes the misleading screen and the silent discard immediately.
2. Owner runs the DDL above (single step, gated).
3. **Parts 2 and 3** — scan-as-check, tolerance, reason, alert.

Testable end to end on **Hayat Nagar**, which now carries a full clone of Highway's
structure and history.
