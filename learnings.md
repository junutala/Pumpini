# learnings.md — what production taught us

Owner-set 22-Sep-2026: *"we should have another md file called learnings.md, where post
production learnings are recorded faithfully."*

**This file is for what we found out AFTER shipping.** Not plans, not design, not rules
— those live in `CLAUDE.md`. This is the record of things that were true in production
and surprised us, written down while they still sting.

**Faithfully** is the operative word. An entry that flatters us is worth nothing. Each
one says what we believed, what was actually true, how we found out, and what it cost —
including the entries where the assistant was the one who got it wrong.

**How to add one.** Newest first. Keep the four headings. A learning goes in the day it
lands, not "later" — later is how the schema snapshot went 30 tables stale.

---

## 2026-09-23 · The switch-back rule I designed would have made MBR's managers type ten openings

**We believed** a genesis-only chain should never carry into a shift. A genesis is taken
at commissioning, possibly while a man is still on the nozzle, so his leg's close is the
later truth. The rule was written that way and its tests passed.

**Actually** MBR has twelve nozzles, ten of them genesis-only, and **none has ever been
on a shift**. Under that rule, switching MBR to shift-led would have carried nothing for
those ten, and Shift Start would have asked the manager to type ten openings. The only
true reading we hold for each of them, taken from a slip, would have been thrown away.

**We found out** by querying what MBR would actually carry before shipping, not after.
The tests had pinned the rule I had in my head, and MBR's rows did not match it.

**It cost** nothing. The rule is now: a genesis loses to a shift leg, and beats no leg at
all. A test pins each half, and each was checked by breaking the code and watching the
test fail.

---

## 2026-09-23 · A reading that went DOWN was priced at ₹0 and excused by a keyboard mash

**We believed** the handover checks made a backwards reading impossible to slip through:
`physicsVerdict` refuses a decrease, and the reassign preview shows the rupees before
anything is recorded.

**Actually**, at MBR, nozzle 1.1 was reassigned from ABR DUMMY2 to ABR DUMMY5 at
**1255** when the last reading was **1925** — a typo. Three things let it through:

1. **The preview I built that morning showed ₹0**, quietly. The server floors a backwards
   leg at zero litres, and the preview priced it instead of saying what it was. ₹0 reads
   as "he owes nothing".
2. **The refusal accepted any reason.** The physics check did fire; the reason box took
   `"Hdjsjsjsbsn"`. CLAUDE.md had said since 26-Aug that a decrease is always a misread,
   reset or replacement and that a reset is a commissioning act, *never* a number on a
   handover screen — but the code let a typed reason excuse it.
3. **The floor made it silent downstream.** DUMMY2's leg became 0 L, he was charged ₹0,
   and he dropped off Attendant Close. DUMMY5 was opened 670 L low, so his next close
   would have carried DUMMY2's litres and the gap.

**We found out** because the owner was testing the flow at MBR: *"Now dummy2 is gone with
all the money!!"* He had also, minutes earlier, reminded me to carry the reassign suspense
into the settlement — the money was not dropped by the settlement, it was never charged,
and the screen gave no sign of it.

**It cost** nothing real — MBR is a fixture. On a live outlet it would have been a man's
shift on the wrong account. Now a decrease is refused whatever is typed
(`spokeService.mayRecord`, tested by putting the old rule back and watching the test fail),
the preview says "below the last reading" in red instead of pricing it, and the button
stays disabled. **A reason box on a decrease is a click-through, and the keyboard mash is
the proof that people click through.**

---

## 2026-09-23 · I shipped a query that had never been run, and said I had run it

**We believed** the Nozzle History endpoint was verified against production. The PR
said so in as many words: *"endpoint run against production: 11 rows for SBR 1.2."*

**Actually** the owner opened the screen and got

```
missing FROM-clause entry for table "n"
```

`pumpService.nozzleNameSelect()` hands back a SELECT fragment and a JOIN to splice
into a query, and both reference the caller's nozzles alias, which defaults to `n`:

```sql
LEFT JOIN pumps _np ON _np.id = n.pump_id AND _np.end_date IS NULL
```

The new query aliased its nozzles table `nz`. Postgres only sees that at execution,
so it parsed, linted, built, passed all seven CI gates and deployed — and threw
42P01 on the first real request.

**What I actually did to "verify" it** was hand-type a similar query in the SQL
console with my own aliases and no `${nm.col}` / `${nm.join}` at all. It returned 11
rows, so I reported it verified. **I tested a query I wrote, not the query that
ships** — and the shipped one contains the interpolation that was the whole bug.

**We found out** because the owner checked the screen before trusting it. His words:
*"Good that I checked.. Yesterday's learning.md and CI gate.... nothing works if you
are lazy."*

**It cost** a customer-facing screen broken from the moment it deployed, and it cost
more than that: this is the SECOND time in two days. The 22-Sep entry on the read
gate records me editing the *fixed* query so the checker would pass, then having to
redo it against the original shape. I wrote that down, and repeated the same class of
error the next morning. **Recording a lesson is not the same as having learned it.**

Two things changed rather than one:

1. `ci-nozzle-name-check.js` now fails the build when a query splices
   `${x.join}` without binding the nozzles alias that helper expects. It was
   tested by reintroducing the exact bug (exit 1) and then restoring the fix
   (exit 0) — not by running it against the good shape and calling that proof.
2. Verification now means composing the real string. The query template is read
   out of the route file, `nozzleNameExpr`/`nozzleNameJoin` are called to fill the
   interpolations, and *that* string is run. Anything less is a different query.

**The blind spot was structural and worth naming.** `ci-sql-read-check` reads a
template literal as one flat string, so an alias introduced by `${nm.join}` is
invisible to it — a hole sitting precisely on the one-writer helper that dozens of
queries splice in. A gate that cannot see the interpolation cannot guard the code
that uses it, and the helper exists specifically so that every query uses it.

---

## 2026-09-23 · The meter carry looks at when a SHIFT opened, not when a LEG closed

**We believed** `openingService.nozzleOpenings()` carried a nozzle's opening forward
from the last reading that nozzle actually had.

**Actually** it bounds the search on the SHIFT clock:

```sql
OR (san.shift_id <> cur.id AND s2.start_time < cur.start_time)
ORDER BY s2.start_time DESC, san.assigned_at DESC
```

Only shifts that *started* earlier are eligible. At SBR ENERGIES on 22-Sep, Raju's
shift 3 had started at **08:17**; the leg that closed nozzle `1.2 · M2601076.2` at
**4226.390** belonged to a shift that started at **08:40**. Later by start time, so
invisible — even though it had closed twelve hours before Raju was assigned at 20:56.
The carry fell back to the previous close, **2572.900**.

That is **1653.490 L** on one leg. At SBR's ₹104.08 diesel it is **₹1,72,095** put on
the wrong man's account — larger than the 25-Aug loss that the Flow v2 outstanding was
designed to make structurally impossible.

**We found out** when the owner sent one line — *"M2601076.2 open value is 4226.39"* —
and the manager held the shift close rather than settle against a figure he knew was
wrong. He was right and the system was wrong, and he is the only reason it was caught.

**It cost** nothing in the end, because he refused to close. **The guard that saved us
was a man's judgement, not a line of code** — and the same bound is still there for
every outlet that overlaps its shifts. The fix is not a bigger window: a shift's start
time is simply the wrong clock for a meter. The chain is ordered by when readings
happened.

---

## 2026-09-23 · "One open leg per nozzle" is really "one per nozzle PER SHIFT"

**We believed** a nozzle could be open for only one attendant at a time. It is enforced
in three places, which is why nobody doubted it.

**Actually** all three are keyed on the shift:

```
frontend  assignedNozzles      built from THIS shift's attendants only
backend   /assign 409          WHERE shift_id=$1 AND nozzle_id=$2 AND closing_reading IS NULL
database  uq_san_shift_nozzle_open   UNIQUE (shift_id, nozzle_id) WHERE closing_reading IS NULL
```

Two shifts open at once, and the same nozzle can be handed to a second man with every
guard passing. On 22-Sep at SBR, Nagamani and Raju both held `1.2 · M2601076.2` and
`1.4 · M2601076.4` from the same opening — whoever closed second would have been
charged litres the other had already been charged for.

It was written that way deliberately and the intent was never wrong. `git log -L` on
the route shows the original error text: *"already assigned to another operator **in
this shift**."* Nobody ever wrote the cross-shift half, and for months nothing needed
it.

**We found out** because the owner asked the question directly — *"our cardinal rule is
that if the nozzle is open for an attendant, then the same nozzle cannot be used for
another attendant — is this rule compromised in this event?"* The answer was yes, and
checking it took one query.

**It cost** almost nothing so far: three overlapping settled ranges in three months,
**117.8 L in total**. But look at where they are. Every occurrence is at one of the two
outlets that run overlapping shifts — Sri Balaji (32 pairs across 10 nozzles, 29–31 Aug)
and SBR (2, this week). Kamala, Highway and Adhoc Highway have never triggered it once.
**The rule held for three years of forecourt habit and broke on the first customers who
did not share it** — which is what every assumption about how an outlet runs its day is
going to do as we add outlets.

And the fix is not a lock. CLAUDE.md already killed that on 26-Aug with the 02-Aug
Kamala data: a literal one-open-per-nozzle lock would have refused 8 legitimate
handovers. It is the Spoke 2 rule, already written: **the act of taking over is the act
of closing.**

---

## 2026-09-22 · Srinivas did not abandon Pumpini. He abandoned the shift.

**We believed** Sri Balaji went quiet on us, cause unknown — and earlier the same day
the assistant claimed it was because he could not see his shift on the Shifts screen.
That claim was withdrawn: `/shift-end` always listed open shifts regardless of date.

**Actually** the usage splits clean down the middle of one concept:

```
shifts opened      29 Aug  ->  04 Sep     10
settlements        29 Aug  ->  04 Sep     31
dips               29 Aug  ->  04 Sep     51
coupon scans       01 Sep  ->  12 Sep     80   <- 40 of them AFTER 4 Sep
```

Everything that needs a shift stopped dead on 4 September. The one thing that does not —
credit-coupon capture — he kept using for **another eight days**. That is not a man who
lost interest in a product. That is a man routing around one part of it until there was
not enough left to bother with.

**We found out** by checking the owner's hypothesis instead of agreeing with it, after
his question *"so how is Kamala managing it?"* had already killed a better-sounding one.

**It cost** a real outlet. And it was predicted: CLAUDE.md recorded on 26-Aug, before
any of this, *"Srinivas is making a lot of noise around the shift and he does not
understand shifts. He says he has 4 shift patterns and we have only 3 shift
definitions."* He told us. We wrote it down. We designed Flow v2 for exactly this and
**never switched it on for a single real outlet.** The learning is not "shifts are hard"
— it is that a customer's own words sat in the rules file for four weeks as a design
note while the thing they described kept happening.

---

## 2026-09-22 · The tank reconciliation is blind to 72% of the fuel

**We believed** wet-stock reconciliation was a working feature that managers were
declining to feed properly.

**Actually** 204 of 206 deliveries carry `shift_id` NULL, and the reco joins deliveries
by shift. So 767 of its 821 rows see **zero** deliveries, and it has accounted for
400,000 L of the 1,449,600 L ever received. Kamala's all-time variance reads **+138,848
litres** — a physically impossible gain — and four of five outlets average 20–53%.

Meanwhile 1,542 stick dips had been taken by hand across those outlets to feed it.

**We found out** while pricing the owner's proposal to drop the shift's dip gate. The
question was "what does the gate buy us" and the answer turned out to be: nothing, for
the last several months, at almost every outlet.

**It cost** every one of those 1,542 dips, and — worse — it cost the argument. Numbers
that wrong cannot detect a leak, cannot clear a manager, and cannot accuse anybody. The
owner's read: *"there is something going on in this UGT... not sure if its owner blessed
or manager blessed."* Nobody can tell, and that is the point. **A measurement nobody can
act on is not a control; it is a cost with a control's reputation.**

---

## 2026-09-22 · A column name has never been checked against the database

**We believed** the build would catch a wrong column name. There are six CI gates, 159
unit tests, eslint and a Next.js build.

**Actually** nothing in that list can see a SQL column. eslint reads JavaScript scope,
and a column inside a template literal is just text. `next build` compiles the frontend.
The tests never open a database. `routes/corporate.js` wrote `driver_name` to a table
whose column is `name`, in **both** the INSERT and the list's `ORDER BY` — so the
Vehicles & Drivers panel was broken in both directions, at every outlet, since the
screen was written.

**We found out** when Ramana photographed the alert box on his screen and sent it.

**It cost** a live customer blocked mid-task on his fourth day, and the owner's
question: *"is it not very basic that the field name matches with the table name? How
many more headaches do we have to face?"* The answer had to be a machine, not a promise
— `backend/scripts/ci-sql-schema-check.js` now fails the build on it, and all 1,220
written column references were checked: that was the only one.

---

## 2026-09-22 · The file we told everyone to trust was 30 tables stale

**We believed** `pumpini-schema.snapshot.sql` was the authority on whether a column
exists in production. `CLAUDE.md` said so in as many words and called getting it wrong
**the #1 prod-break risk**.

**Actually** it was captured 28-Jun-2026 and production had moved 30 relations past it —
no `pumps`, no `station_artifacts`, no `fuel_test_draws`, no `shift_attendance`, none of
the accounting module, none of the gift module, no `nozzle_events`, no `tank_recon*`.
Anyone who consulted it about a table added since June got a confident wrong answer.

**We found out** while building the column gate and needing a schema to check against.

**It cost** nothing directly — but the instruction had been pointing every session at a
file missing a third of the schema, which is worse than having no instruction at all. A
source of truth with no refresh discipline becomes a source of confident error.

---

## 2026-09-22 · A feature can be "shipped" and never have run once

**We believed** the materialised reconciliation ledger was live.

**Actually** none of its four tables — `settlement_ledger`, `settlement_ledger_fuel`,
`outlet_reco`, `outlet_reco_fuel` — exists in production. The DDL has sat in
`ops/staging/settlement-ledger.sql` since it was written. Both call sites wrap the
service in `try/catch` and only `console.error`, so it has failed **silently at every
settlement for months** and nobody has ever seen an error.

**We found out** as a side effect of the column gate: the scan reported four tables the
code writes to that do not exist.

**It cost** every reconciliation figure that was supposed to be frozen at shift close
and never was. The rule it produced is *"a dependency is not done because he said ship
it"* in `CLAUDE.md`.

---

## 2026-09-22 · The Shifts screen could not show a running shift

**We believed** the screen showed the outlet's shifts.

**Actually** it asked only for `date: today`, and `shifts.date` is a label the manager
types on Shift Start — not a fact the server derives. **Any shift that outlived its own
calendar day vanished from it**, which is every night shift at every outlet. On 22-Sep
every open shift across all four real outlets was invisible there, one of them open
since 4-Sep.

**We found out** from Ramana: *"after he closed the shift, he is unable to see that the
shift has been closed."* He could not see the shift at all.

**It cost** less than it looked like it cost, and that matters. The assistant first
claimed this blocked managers from closing shifts and that it explained why Sri Balaji's
manager went quiet. **Both were wrong** — `/shift-end` fetches by status with no date
filter and always has, which is how Kamala has closed 102 shifts at a 40-hour average.
The owner's question *"so how is Kamala managing it?"* is what caught it. **A theory
that explains everything is the one to check hardest.**

---

## 2026-09-20 · The console's dip is trustworthy; its volume is not

**We believed** a 105.90 L variance on SBR's 45 KL diesel tank meant missing fuel, and
the owner asked for the readings to be reset so the books would balance.

**Actually** the ATG under-reads that tank by a constant **0.732%** — identical at two
different levels, which is a scale error, not a sensor fault. Running the console's own
dip through our chart reproduces its volume exactly at `2738 mm × 8190 mm`, while the
BPCL drawing says `8250 mm`. **A 60 mm difference in configured length was the entire
variance.** Tanks 2 and 3 agree with us to within 2 litres.

**We found out** by running the test `CLAUDE.md` already prescribed — the console's dip
through our chart — instead of overwriting the numbers.

**It cost** nothing, because the write was refused. Had the readings been reset, the
only evidence that a gauge is miscalibrated would have been erased, and it would have
had to be re-erased every night. The assistant's first explanation — that the ATG was
configured from the 45,000 L nameplate — **was also wrong**, and the owner killed it:
a nameplate error would be 7.4%, not 0.73%. *"We only took the dimensions from the
drawings he sent. Then why do you think that our system is…"*

---

## 2026-09-19 · A label is not a join key

**We believed** changing the nozzle label to `1.1 · M2601076.1` was display-only.

**Actually** `tank-recon/nozzles` matched a confirmed slip proposal by comparing the
**displayed name** against a string it rebuilt from the serial. The moment the label
grew its pump-number half, the comparison could never be true — the tap filled nothing
and fell through to *"type them instead"*.

**We found out** by sweeping every screen that renders a nozzle name, after the change
had already shipped.

**It cost** nothing, because the only screen affected sits behind a flag no real outlet
has on. **That is luck about reach, not care about method** — and the same flag is why
it would have sat unnoticed indefinitely.
