# Highway data rectification — plan

Run everything on **staging first** (it now mirrors prod), verify, then repeat on prod.

## What's wrong (found from prod diagnostics)

1. **Mis-dated manager sales (all 3 outlets, incl. Highway).**
   Manager closes stamped `occurred_at = NOW()` instead of the trade day, so the
   dashboard filed sales by *close day*, not *sale day*. Batch-closing back-dated
   shifts (the Adhoc-manager situation) piled multiple days onto one date.
   - **Fix:** code fix already on the branch (future closes) + `backfill-occurred-at.sql`
     (historical rows). **Unambiguous — ready to run**, snapshot-first, per-station.

2. **Impossible / demo meter readings at Highway.**
   The go-live demo left readings like premium `250 → 1,464,332` (1.46 M L) and a
   diesel close *below* its open (negative throughput). `highway-rectify.sql` D1
   lists every such row.
   - **Fix:** needs YOUR input — only you know the true readings (or whether that
     shift was a demo to be voided). Options per row: (a) correct to the real
     open/close, or (b) void the demo shift so it never counts. I'll turn your
     decision into exact SQL.

3. **"Adhoc Highway Filling Station" — a second station.**
   Created as a workaround when the Highway manager didn't show. Decide: keep as a
   separate outlet, or merge its shifts into Highway and retire it. Needs your call.

## Tomorrow's order

1. Run `highway-rectify.sql` (D1–D3) on **staging** → confirm the exact bad rows.
2. Run `backfill-occurred-at.sql` STEP 1–3 on **staging** (snapshot → dry-run → Highway).
3. You tell me the true readings / void decision for the D1 rows → I hand you the fix SQL.
4. Decide on "Adhoc Highway".
5. Verify the per-shift dashboard on staging looks right with corrected data.
6. Repeat the confirmed SQL on **prod** (gated, step by step), then merge code to `main`.

## Decisions needed from you
- [ ] For each impossible-reading row in D1: correct value, or void the shift?
- [ ] "Adhoc Highway": keep separate, or merge into Highway and retire?
