# Artifact repository & the two-screen shift flow

_Written 01-Aug-2026. The assistant has no cross-session memory — this file is the
memory. If a decision isn't here, the next session doesn't know it._

---

## 1. The gap this closes

Pumpini could already READ four documents from a photograph. It only KEPT two.

| Document | Read from image | Image kept (before) | Image kept (now) |
|---|---|---|---|
| Delivery invoice | ✓ | ✓ `delivery_invoices` | unchanged |
| Settlement meter | ✓ | ✓ `meter_photos` | unchanged |
| **Credit coupon** | ✓ | ✗ **discarded** | ✓ `station_artifacts` |
| **ATG / Pinelabs gauge screen** | ✓ | ✗ **discarded** | ✓ `station_artifacts` |
| **Attendant at shift start/close** | — | — | ✓ `station_artifacts` |

The coupon gap mattered most: the coupon is the **authority** behind a credit
invoice line — it carries the customer's signature and seal, and it is what the
outlet produces when a bill is disputed months later. The line existed; the thing
that justified it did not. The gauge screen was the same problem one level down —
opening and closing stock are the two figures the entire wet-stock reconciliation
rests on, and neither had a picture behind it.

## 2. Why ONE table, not one per document type

The obvious move was `dipstick_artifacts` alongside the existing
`dispense_artifacts`. That is exactly the drift the one-writer rule exists to
stop: two artifact tables today, four once bank deposit slips, credit receipts
and petty-cash bills arrive — each with its own writer, its own RLS policy to
forget, and its own idea of what a "kind" is.

So the parent is **named rather than foreign-keyed**:

```
station_artifacts(station_id, entity_type, entity_id, kind, file_base64, ocr, meta, …)
```

| kind | entity_type | entity_id |
|---|---|---|
| `coupon` | `dispense_event` | the credit sale it created |
| `gauge_screen` | `shift` (or `station`) | the shift, or null for a plain dip-register entry |
| `attendant_photo` | `shift_attendant` | the assignment row |

**The trade is real and deliberate.** A soft parent reference gets no referential
integrity, so a deleted parent leaves an orphan artifact. That is the right way
round: an orphaned *proof* is harmless — evidence outliving its record is not a
corruption — whereas a cascade that silently destroys the photograph behind a
money document is.

`dispense_artifacts` (created 30-Jul, never wired to anything, **0 rows in both
prod and staging**, verified 01-Aug) was copied into this table and dropped. The
migration was free that day and would never have been free again.

## 3. Rules the writer enforces

`backend/src/services/artifactService.js` is the only writer. Two properties are
load-bearing and must not be relaxed:

1. **An artifact may never break the thing it is evidence of.** Every write is
   best-effort: it returns `null` instead of throwing, and inside a caller's
   transaction it runs in a **SAVEPOINT** so a storage failure cannot abort the
   sale it rode in on. A coupon saved without its picture is a small loss; a
   coupon refused because its picture wouldn't store is a real one.
2. **Probe, never try-and-catch.** The table arrives with owner-run DDL, so the
   code lives both before and after the migration. It checks
   `information_schema` — a catalog SELECT that succeeds either way and cannot
   poison a transaction. It does *not* attempt the insert and catch `42P01`;
   inside a `BEGIN…COMMIT` that aborts everything. (This is the mistake that
   broke every credit invoice in prod on 30-Jul. See CLAUDE.md.)

Reads go through `GET /api/artifacts` and `GET /api/artifacts/:id/image`. The
image is served as real bytes with a content type, not base64 in JSON — a 900 KB
photo costs a third more on the wire as a JSON string and re-downloads on every
render. Because the API authenticates on the `Authorization` header (which a
browser does not send for an `<img>` request), the frontend fetches through the
shared axios instance and wraps the result in an object URL:
`components/shared/ArtifactImage.js`.

## 4. The two-screen shift flow (owner-set, 01-Aug)

The owner's requirement, verbatim: *"the manager has only TWO screens to work
with. Gauge and attendant assignment. Two steps to start the shift."*

**Shift Open**
1. **Gauge & opening dip** — the shift's slot/date collapse into a header strip
   (the old separate "Open" step is gone; the shift row is created lazily so
   merely visiting the page cannot litter the DB with orphan shifts). Photograph
   the gauge screen → dip rows fill, **visible and editable**. Editability stays
   until confidence is earned; hardening it is a later, deliberate step.
2. **Attendant assignment** — photo → attendant → nozzles (+ pump-slip scan) →
   one **START** button. The manager returns to this screen for each attendant
   until every nozzle is manned.

**Shift Close**
1. **Settle attendants** — photo → attendant → nozzle slip → settlement breakup →
   close. Repeat until all open attendants are closed.
2. **Closing gauge & dip** — photograph the gauge, save the closing dips, close
   the shift.

**Opening float is prefilled 0 and hidden.** Owner's finding: no outlet gives a
float to attendants. The field is hidden rather than deleted, and the client still
sends `0`, so it can come back without a migration.

## 5. Per-attendant shift clock

`attendance` already existed and was already unique on
`(user_id, date, shift_number)` — it was simply never written by the flow that
knows the times. Now:

- Starting an attendant stamps `check_in` (and his start photo).
- Settling him stamps `check_out` (and his close photo).
- `attendance.shift_id` ties the row to the shift.

Two details that are easy to get wrong and are deliberate:

- Times book against the **shift's** date and slot, not today's. A night shift
  opened 22:00 on the 1st and closed 06:00 on the 2nd must book both ends against
  the 1st, or the operator appears twice and his attendance splits across two days.
- `check_in` is **never** moved by a later re-assignment (a manager correcting a
  nozzle an hour later must not rewrite when the man started), whereas `check_out`
  **is** overwritten (a re-settlement should move his release time).

This is what makes attendance provable rather than merely typed: the row joins to
his nozzle assignment and therefore to meter movement. A fingerprint proves a
finger touched a sensor; a meter that moved 400 litres under a named assignment
proves work happened.

## 6. Facial recognition — where this is going

**Owner's position (01-Aug), recorded because the assistant argued the wrong side
first.** The assistant's initial objection — that a photo proves presence, not
work, and that biometrics raise consent questions — was **overruled and is wrong
for this context**: biometric and facial attendance are settled practice in
employer–employee relations, with thousands of installations. Do not re-litigate.

The photograph shipped here is **Phase 0 of facial recognition, not a substitute
for it.** Owner: *"After we have a mature model we will drop the LOV and the
picture has to fetch the attendant. This is the ultimate goal."*

So the shape is built for that from the start:

- The photo is captured **before** the picker in the UI, because the picker is what
  eventually goes away — it becomes the fallback, not the primary.
- The photo is stored against the **assignment** (`shift_attendant`), which is the
  record a match verdict will need to attach to.
- `station_artifacts.meta` is reserved for `{"match": {...}}`, so Phase 1 adds a
  verdict **without a migration**.

Phase 1, when it comes, should be **1:1 verification, not 1:N identification** —
the system already knows who is being claimed, so the question is only "is this
the enrolled person?", which is a far more robust problem in forecourt sunlight
than "which of these thirty faces is this?". Advisory before gating: measure the
real match rate before letting it stop a shift starting, because shift start is a
core path.

## 7. Impact analysis (CLAUDE.md §1)

1. **Schema dependency** — yes: new `station_artifacts`, plus `dipstick_readings.artifact_id`
   and three `attendance` columns. All idempotent, all additive, RLS policy in the same
   block. Every consumer probes the catalog first, so the code is correct before the
   DDL runs.
2. **Who consumes this** — Credit Coupons, Shift Open, Shift Close, the dip register,
   and `GET /api/shifts/:id` (which powers both shift screens). The shift endpoint is
   the critical one: its new photo/clock lookups are guarded on the migration, so a
   missing table leaves the page working without photos rather than 500-ing it.
3. **Blast radius** — every new write is best-effort and cannot fail its parent.
   The one genuinely new failure mode is the shift screens themselves being rewritten;
   that is why this goes to staging for physical testing first.
4. **Multi-tenant** — `station_artifacts` carries `station_id` and the standard
   `FOR ALL USING (station_id IN (SELECT my_stations()))` policy. Verified on staging
   under the `app_authenticated` role: insert succeeded, select returned the row,
   cross-outlet insert was refused, zero rows leaked.
5. **Money / masking** — coupon capture now runs in a transaction (it did not before),
   which makes the credit-headroom check and the sale insert atomic. Blind-drop masking
   is untouched.
6. **Rollback** — revert the code; the tables and columns are additive and inert
   without it. The one irreversible step is dropping the empty `dispense_artifacts`,
   which nothing has ever read or written.
