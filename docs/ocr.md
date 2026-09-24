# OCR — why the slip scan lost the managers, and the plan to win them back

Written 23-Sep-2026 for the agent that implements it. Read this whole file before touching code,
then read `docs/flow-v2-build-plan.md` §6 and §10 — the post-mortem this plan builds on — and
`backend/src/services/visionOcr.js`, the shared reader behind slips, coupons, the gauge screen and
gift plates (deliveries and expense bills call Claude directly — see §7).

The owner, 23-Sep: _"we lost a couple of paying customers due to this OCR issue and now, almost all
the real customers are manually entering the readings"_ — and _"if you can fix this OCR thing, I am
sure I will fly high with pumpini."_ This is the most important thing in the product. Treat it so.

> **🔴 REVIEWED 24-Sep-2026 against the code and the production database, before any code was
> written.** Five statements in the first draft were wrong, and one of them breaks the bench
> as written: the stored readings at Sri Balaji came FROM the old reader, so they cannot grade it.
> The corrections are made in place below and marked **[24-Sep]**; §7 carries the evidence
> (query or `file:line` for each), §8 the cost estimate, and **§9 the decisions the owner has
> not yet made. Nothing in §3 starts until §9 is answered.**
>
> Verdict on wish-vs-need (CLAUDE.md rule 2): **a need.** A nozzle reading IS the sale (litres ×
> price); the old reader stored rupee totals as litres and marked them legible — 3 of Kamala's 12
> stored photos read over 10 million litres, all `ocr_legible = true`. Wrong money, shown
> confidently, is what lost the managers. What IS a wish, until the edit rate says otherwise, is
> the per-nozzle photo crop in step 4 — see there.

---

## 1. What actually went wrong (from Pumpini's own evidence, not a guess)

Two different failures, and only one of them was about how well the engine reads.

**1a. The readings that lost the managers were a prompt bug, not an eyesight problem.**
`/pos-meter` carried its own prompt describing "a cumulative totalizer" — a mechanical dial — so
the model returned the largest run of digits on a printed slip: the **rupee total** (`Atot` / `A`),
not the litres (`Vtot` / `V`). Sri Balaji 25-Aug: `17558851.620` on a nozzle whose real movement
that shift was `5.78 L`. Kamala 23-Jun: three attempts, three rupee lines. **Every one was stored
`ocr_legible = true`.** The managers were shown confident wrong numbers, typed by hand, and stopped
scanning — the right response to an instrument that lies. Fixed 27-Aug (#353) by routing
`/pos-meter` through `slipParser`, but per §10: _"The repaired path has never been offered to
them."_ **[24-Sep]** True of Kamala, Highway and Adhoc. **Not of Sri Balaji**: it scanned 54
nozzle photographs on the repaired path between 1 and 4-Sep, and 50 of them were accepted exactly
as read (`meter_photos.ocr_reading` = the stored reading). Whether those 50 were right is unknown
— nobody typed an independent figure — and Sri Balaji's shifts stop on 4-Sep. See §7 row 1.

**1b. The direct Claude read was set up to lose.** Measured on the same Sri Balaji pumps (§10):

| engine                                        | line-match     |
| --------------------------------------------- | -------------- |
| `google_vision+claude_text`                   | 74/76 (97%)    |
| `claude_vision` (the fallback, image-only)    | 20/32 (63%)    |

But look at how `claude_vision` is run today:

- **An older model with no thinking.** `model = 'claude-sonnet-4-6'`, no `thinking`, no `effort`
  (`visionOcr.js`, `readImageAsJson`). Same in `billScan.js` and `routes/deliveries.js`.
- **A shrunken photograph.** Slip photos go through `components/shared/PhotoCapture.js`, which
  scales every picture to **1,400 px** on the long edge at JPEG 0.85 (`MAX_EDGE = 1400`). On a long
  thermal slip that puts a 14-character zero-padded figure like `00000031675.95` at a few pixels
  tall. Deliveries and the gauge screen already use **2,600 px at 0.92** for exactly this reason —
  the slip path never got the same treatment. (`HandoverReading.js` and `tank-recon/nozzles` use
  `PhotoCapture`.) **[24-Sep]** And today's model could not use more pixels if it had them:
  Sonnet 4.6 scales anything above **1,568 px** down itself; Opus 5 reads up to **2,576 px**. The
  photo size and the engine are therefore ONE change, not two (§7 row 5).
- **Only ever on the hardest frames.** It runs only when Google Vision returned nothing usable — so
  its 63% is measured on the photos Vision itself could not read, which flatters Vision and
  handicaps Claude. On 26-Aug that fallback fired on 3 of 8 scans.
- **Free-text JSON.** The prompt asks for "ONLY a JSON object" and `extractJson()` regexes it out;
  no schema is enforced, so a dropped field or prose answer becomes `unparsed`.
- **When Vision succeeds, Claude never sees the picture.** Claude structures Vision's flattened
  text. Columns get flattened and lines reordered, so which number sits under which label can be
  lost. BPCL/HPCL "Electronic Totalizer" slips make this worse: the header prints
  `Vtot … Atot` and the nozzle lines print `Atot … Vtot` — the labels swap sides on one strip.
  `LITRES_RULE_BLOCK`'s "take the smaller" rescues the rupee/litre confusion, but not a digit lost
  in the flattening.

**1c. A control test, 23-Sep.** A phone photo of a real Bharat Petroleum totalizer slip (the one in
§6 below: 4 nozzles, both label orders, handwriting on top, photographed on a table) was read by
Claude Opus 5.5 from the full-resolution image alone — no Vision, no prompt engineering. **Every
figure was right**, including the label swap, and the duplicate nozzle-02 block agreed with itself.
The same evening an SAP invoice rendered as an image was transcribed with 299/299 tokens and 90/90
numbers correct. One slip is not a benchmark — §3 step 0 is — but it says the model is not the
ceiling. The setup is.

---

## 2. What "fixed" means — the acceptance bar

1. **Measured, on Pumpini's own stored photos**, against a **human-checked answer key**:
   **≥ 99% of nozzle lines correct to the last digit**, and **0 rupee-as-litre readings**.
   **[24-Sep]** Not "against the readings the managers typed" — at Sri Balaji those readings came
   from the old reader (§7 row 1), so grading against them measures the old reader against itself.
2. **Never a confident wrong number.** Every reading either passes the checks in §3 step 3 or is
   shown as "couldn't read this one — retake or type it". `ocr_legible=true` on a wrong figure is
   the defect that lost the customers; it must be impossible, not unlikely.
3. **The manager confirms what was read** before it counts, with the photo beside it (§3 step 4).
4. **Every scan records which engine read it, what it saw, and whether the manager changed it** —
   so the next regression is visible in a day, not reconstructed from absence a month later.

---

## 3. The plan, in order

### Step 0 — The bench, before any engine change

Build `backend/scripts/ocr-bench.js` (or the repo's usual place for such scripts):

- **Inputs — [24-Sep] rewritten; the first draft's set does not exist.** What production holds
  (real outlets; fixtures listed in §7 row 1 and excluded from the score):

  | set | photos | answer available today |
  | --- | --- | --- |
  | Kamala `meter_photos`, 23-Jun – 23-Aug | 12 | **yes** — the typed reading differs from the scan on all 12 |
  | Sri Balaji `meter_photos`, 1–4-Sep | 54 | **no** — 50 of 54 stored readings ARE the scan's output |
  | Kamala / Highway / Adhoc slips, 02/04-Aug (`station_artifacts`, `entity_type='pump'`) | 9 | **no** — not linked to a shift; must be paired to a reading by hand |

  The §10 Sri Balaji composites (25/26-Aug) are gone — cleared with the outlet on 29-Aug.
  `dispense_artifacts` is not a table. So **12 photos can be scored as things stand, which cannot
  demonstrate 99%.** Build the answer key first: a sheet of each of the 75 real photos beside its
  stored reading, and a person marks each right or wrong from the photograph (owner's choice of
  who — §9). Only then run the engines.
- **Engines to run, same photos:**
  - A. today's pipeline, unchanged (`readImageAsJson` as is);
  - B. the new reader from step 1;
  - C. B without the Google Vision text (image only) — to learn whether Vision still earns its call.
- **Score per nozzle line:** exact match of litres to the last decimal; rupee-as-litre (a separate
  column — the one that matters most); marked-legible-but-wrong (the other one that matters most);
  serial match; nozzle number match.
- **Output:** a table in `docs/ocr-bench-results.md` with the date, engine, model id and counts —
  and keep the per-line rows so a regression can be traced to a photograph.
- **Needs:** `ANTHROPIC_API_KEY`, `GOOGLE_VISION_API_KEY`, read access to the database, and
  `SUPABASE_SERVICE_KEY` to fetch the photographs from the bucket. **[24-Sep]** All four live on
  Railway, not in a session — either the owner runs it with `railway run node
  backend/scripts/ocr-bench.js`, or the keys are added to the session's environment secrets (§9).
  Cost: see §8 — about **$10–20 for the whole bench**, more than "a few cents a photograph" once
  thinking is counted. Ask the owner before running it against production data.
- **[24-Sep] Add a fourth engine: B at `effort: 'medium'`.** It decides the running cost (§8).
- **[24-Sep] What the bench cannot measure:** every stored slip photo was captured at ≤ 1,400 px,
  so the resolution gain of step 2 is invisible to it. That gain is measured on new captures only.

**Ship nothing in steps 1–2 until the bench shows B beating A.** If it does not, stop and report the
numbers — do not tune until green by feel.

### Step 1 — One reader, changed once (`backend/src/services/visionOcr.js`)

~~All six readers go through `readImageAsJson`.~~ **[24-Sep] They do not** (§7 row 2).
`readImageAsJson` serves **slips** (`slipParser.js:127`), **credit coupons** (`routes/coupons.js:62`),
the **gauge screen** (`routes/dipstick.js:506`) and **gift plates** (`giftIssueService.js:217`).
**Delivery invoices** (`routes/deliveries.js:696/745/813`) and **expense bills**
(`billScan.js:54/68`) call Claude directly.

So: add the new reader to `readImageAsJson` as an **option**, and switch **only `slipParser`** to it.
Changing the default would silently move coupons — money — and the gauge screen onto a new engine
and a new cost with no measurement behind it. Each of those opts in when its own bench says so.
**Leave deliveries and bills alone:** 175 of 175 deliveries carry a scanned invoice (§10) — the
instrument works, and rebuilding it would be a wish.

- **Model:** default to `claude-opus-5` (the current Opus). Keep it a parameter so the bench can try
  others; the 23-Sep control test was Claude Opus 5.5 (`claude-opus-5-5`) — if the owner prefers it,
  it is a one-line change. Do not keep `claude-sonnet-4-6` as the default for reading photographs.
- **Thinking and effort:** `thinking: { type: 'adaptive' }` and `output_config: { effort: 'high' }`.
  Reading a smudged slip is exactly the work thinking helps; it is cents, not rupees.
- **Show Claude the photograph AND Vision's text together**, in one call: the image block first,
  then the prompt, then Vision's OCR text as a second opinion ("an OCR engine read these characters;
  use them to confirm digits, but the image is the source of truth for which number belongs to which
  label"). Today Claude gets one or the other, never both — each loses what the other has.
- **Structured output, not a regex.** Use the API's structured outputs
  (`output_config.format` with a JSON schema) so the answer always has `nozzles[]` with
  `nozzle_no`, `cumulative_volume`, `cumulative_amount`, `legible`, and the header fields.
  `extractJson()` stays only as the fallback for a model that cannot take a schema.
  **The SDK is `@anthropic-ai/sdk ^0.102.0` — check it supports `output_config` and adaptive
  thinking; upgrade it if not, and read the SDK's own docs rather than guessing the call shape.**
  **[24-Sep]** The installed 0.102.0 already types `output_config` and the `effort` levels
  (`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.mts`); confirm by compiling one
  real call before assuming no upgrade is needed.
- **[24-Sep] Refusals:** Opus 5 can return `stop_reason: "refusal"` — treat it like any other
  unread result ("couldn't read this one"), never as a partial reading.
- **Keep Google Vision** as the extra evidence in the same call, and as the fallback when the Claude
  call itself fails. Stamp `engine` accordingly (e.g. `claude_opus+vision_text`) so the rows keep
  telling the truth.
- **Handle `stop_reason`** (`refusal`, `max_tokens`) before reading the content, and give
  `max_tokens` real room (thinking counts against it) — a truncated answer must read as "unparsed",
  never as a partial reading.

### Step 2 — Stop shrinking slip photographs (`frontend/src/components/shared/PhotoCapture.js`)

- Give `PhotoCapture` a size prop. Slip / meter / document captures use **2,600 px at JPEG 0.92**
  (what deliveries and the gauge screen already use). Operator selfies and proof photos can stay at
  1,400 px.
- Pass the new size from `HandoverReading.js`, `app/tank-recon/nozzles/page.js`, and every other
  place a slip is photographed. `shift-end` already has a larger path for the console — make the
  slip path match it.
- Mobile upload size goes up (roughly 250 KB → 700–900 KB). Say so in the PR; it is the right trade
  for a reading that decides a shift's sales.
- **[24-Sep] Ships WITH step 1, never before it.** On today's model the extra pixels are thrown
  away above 1,568 px (§1b). `PhotoCapture` has ten callers today — `HandoverReading`,
  `tank-recon/nozzles`, `tank-recon/atg`, `settings/commissioning`, `settings`, `shift-start`,
  `shift-end`, `add-attendant`, `credit-slip-books`, `accounts/bills`. Go through each: the slip
  and console captures take the large size; the attendant face stays at 1,400 px.

### Step 3 — Checks in code, never in the prompt (`backend/src/services/slipParser.js`)

The model reads; code decides whether to believe it. After every read, per nozzle line:

1. **Litres, not rupees:** where both are read, volume must be the smaller and the ratio must be
   plausible for fuel. Derive the band from the station's own price history rather than a constant:
   the §6 fixture's slip reads Atot/Vtot ≈ 52, far from the ~₹100/L `LITRES_RULE_BLOCK` assumes, so
   a tight band around 100 would reject a correct slip. Fail → `legible=false`.
2. **The same nozzle printed twice must agree.** "Electronic Totalizer" slips print the selected
   nozzle in the header block and again in the per-nozzle list. If both are present and differ →
   `legible=false` for that nozzle.
3. **The meter only goes up.** Compare with the last confirmed reading for that nozzle: a cumulative
   total below it, or a jump larger than the nozzle can dispense in the elapsed time → flag, do not
   save silently.
4. **Shape:** digits and one decimal point only after stripping the zero padding; the serial matches
   a known machine at this outlet (`serial_known`), and an unknown serial is shouted, not silent
   (§10 defect 2).

A failed check is shown to the manager in plain words and offers **Retake** and **Type it** — never a
red error for a scan that simply needs a second photo.

**[24-Sep] Most of this exists — search before building (CLAUDE.md, cardinal rule).**

| check | today |
| --- | --- |
| 1. Litres, not rupees | **Exists** — `slipParser.normalizeSlipNozzles`: the rupee/litre swap guard, an implied-price ceiling taken from the outlet's own board price, a floor of ₹40/L (kept low on purpose: A÷V is a lifetime average, measured 12–13% under today's board at Kamala), and `MAX_CUMULATIVE_VOLUME` = 10,000,000 L. The §6 fixture's ≈ ₹52/L passes. |
| 2. Same nozzle printed twice agrees | **New.** Build it. |
| 3. Meter only goes up / not faster than a pump | **Exists for the nozzle-led flow** — `spokeService` (`reading_decreased` → refuse; rate test). **Not wired into the shift-led slip path.** Wire the same function in; do not write a second one. |
| 4. Shape, and a known serial | Shape: exists in the normaliser. `serial_known` is computed (`routes/reconcile.js:1495`); what is missing is the **shout** on an unknown serial (§10 defect 2). |

### Step 4 — The manager confirms, beside the photograph

- After a scan, show each nozzle's reading next to a crop of the photograph where it was read, with
  one tap to confirm and a field to correct it.
- **[24-Sep] Version 1 without crops.** A crop needs the model to return where on the photo each
  figure sits, plus a screen to cut and place it — the largest single build in this plan. v1 shows
  the **whole photograph, zoomable, beside the list of readings**, with Confirm / Correct per
  nozzle. The crop is a wish until the edit rate says managers are mis-confirming; build it then.
- Store both: what was read and what was confirmed. The **edit rate** is the health metric — if
  managers correct more than a couple in a hundred, the reader has regressed and somebody should
  know that day (§2 point 4).

### Step 5 — Win the managers back

The fix is worthless if nobody tries it again. Once the bench passes and the confirm screen ships:

- Tell the outlets plainly what was wrong ("it was reading the rupee total instead of litres") and
  that it is fixed — the owner's words, in Telugu and English (the app already has both).
- Offer the scan as the first option again on the shift screens, with typing one tap away.
- Watch the first week's scan-vs-type rate and edit rate per outlet, and report them to the owner.

---

## 4. What not to do

- **Don't add a second prompt or a second reader** for any screen. `slipParser` is the one reader of
  a slip; `visionOcr.readImageAsJson` is the one pipeline (`/pos-meter` having its own prompt is how
  the rupee bug happened).
- **Don't mark anything legible that failed a check in step 3.**
- **Don't tune the prompt against one photograph.** Every change is judged on the bench.
- **Don't delete the Google Vision call** until the bench (engine C) shows it adds nothing — and even
  then, keep it as the fallback when the Claude call fails.
- **Don't downscale to save bandwidth on anything that is read.** A retake costs more than 600 KB.

---

## 5. Order of work and what to hand back

0. **[24-Sep]** The owner answers §9. Nothing below starts before that.
1. Answer key (**[24-Sep]** new, §3 step 0 inputs), then bench (step 0) → results table to the
   owner, with the measured cost of the run and of a scan. **Stop here if B does not beat A.**
2. Reader change (step 1, **slips only**) + photo size (step 2), behind the bench — ship when B's
   numbers hold.
3. Checks (step 3 — **[24-Sep]** mostly wiring existing code, plus check 2) — ship with tests (use
   §6 as a fixture).
4. Confirm screen (step 4, **[24-Sep]** v1 without crops).
5. The relaunch to managers (step 5) — the owner's call on timing and words.

At every step, follow Pumpini's CLAUDE.md on testing, deployment and how to report what reached
production.

---

## 6. Test fixture — the 23-Sep Bharat Petroleum slip

A phone photograph of a thermal slip, handwriting ("PUMP 1", "1<2") above the print. Save the image
as a fixture (the owner has it) and assert the reader returns exactly these values. Note the label
order swaps between the header block and the nozzle list.

Header block — `Electronic Totalizer :`

| field          | value              |
| -------------- | ------------------ |
| FIP No.        | 02                 |
| Nozzle No.     | 02                 |
| Vtot           | 00000000611.34     |
| Atot           | 00000031675.95     |
| Date / Time    | 14/09/26 14:23     |
| DU SERIAL NO   | M2601076           |

Per-nozzle block — `Electronic Totalizer :` (printed `Atot … Vtot`)

| nozzle | Ecal factor | Atot           | Vtot           |
| ------ | ----------- | -------------- | -------------- |
| 01     | 0.40 %      | 00000034347.23 | 00000000593.72 |
| 02     | 0.58 %      | 00000031675.95 | 00000000611.34 |
| 03     | 0.14 %      | 00000008743.68 | 00000000611.08 |
| 04     | 0.00 %      | 00000007208.35 | 00000000594.10 |

`Printed on: 14/09/26 14:23`. Nozzle 02 appears in both blocks with identical figures — the §3
step 3 check 2 must pass on this slip and must fail if either copy is altered.

---

## 7. [24-Sep] Review findings — the evidence behind every correction above

Checked 24-Sep-2026, read-only, before any code. Fixtures (Dilsukhnagar, Nagole, Hayat Nagar, MBR,
the unnamed outlet) are excluded from every conclusion.

| # | first draft said | production / code says | source |
| --- | --- | --- | --- |
| 1 | Bench = stored photos vs readings the managers typed | Kamala: 12 `meter_photos`, all 12 marked legible, 0 of 12 stored readings equal the scan, **3 of 12 scans read > 10,000,000 L** (rupee-as-litre). Sri Balaji: 54 `meter_photos` (1–4-Sep), 51 carry a scan, **50 stored readings equal the scan exactly**. Real-outlet slips from 02/04-Aug: Kamala 3, Highway 4, Adhoc 2, all `entity_type='pump'`, no shift link. §10's Sri Balaji composites: no rows remain. Fixtures hold 17 more benchable photos (Dilsukhnagar 16, Hayat Nagar 1) — usable to exercise the engines, not to score them | `meter_photos` ⋈ `shift_attendant_nozzles` on shift + nozzle; `station_artifacts` where `kind='nozzle_slip'` |
| 2 | All six readers go through `readImageAsJson` | Four do (slips, coupons, gauge, gift plates). Deliveries and expense bills call `ai.messages.create` directly, all on `claude-sonnet-4-6` | `grep readImageAsJson(`: `slipParser.js:127`, `routes/coupons.js:62`, `routes/dipstick.js:506`, `giftIssueService.js:217`; direct: `routes/deliveries.js:696/745/813`, `billScan.js:54/68` |
| 3 | `dispense_artifacts` holds slip photos | No such table | `backend/db/schema.prod.json` |
| 4 | The SDK may need an upgrade | 0.102.0 is installed and types `output_config` and `effort` | `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.mts` |
| 5 | Photo size is a separate step | Sonnet 4.6 downsizes above 1,568 px; Opus 5 reads to 2,576 px. `PhotoCapture` is `MAX_EDGE = 1400`, `QUALITY = 0.85`; deliveries, dipstick, credit coupons and the shift-end console already use 2,600 px | `PhotoCapture.js:28-29`; `deliveries/page.js:259`, `dipstick/page.js:45`, `credit-coupons/page.js:79`, `shift-end/page.js:570`; Anthropic model notes for Opus 4.7+ |
| 6 | Step 3 is new work | Checks 1 and 4 (shape) exist in `slipParser`; check 3 exists in `spokeService` for nozzle-led only | `slipParser.js` `normalizeSlipNozzles`, `MAX_CUMULATIVE_VOLUME`; `spokeService.js:37-74`; `reconcile.js:1495` |
| 7 | "The repaired path has never been offered" | True for Kamala, Highway, Adhoc; Sri Balaji used it for 54 photos, 1–4-Sep | row 1 |

## 8. [24-Sep] Cost — estimates until the bench measures real tokens

Model prices (per million tokens, input / output): **Opus 5 `claude-opus-5` $5 / $25**, **Opus 5.5
`claude-opus-5-5` $4 / $20** (the 23-Sep control test), Sonnet 4.6 (today) $3 / $15. A 2,600 px
photo is up to ~4,800 image tokens on Opus 5; add ~2,000 for the prompt and Vision's text; thinking
plus the answer is roughly 1,500–4,000 output tokens at `high` effort. **UNVERIFIED — the bench
replaces every number here with a measured one.**

| | per slip scan | 5 real outlets, ~45 composite scans a day |
| --- | --- | --- |
| today (Sonnet 4.6, 1,400 px, no thinking) | about ₹1–2 | small |
| Opus 5, 2,600 px, `high` | about ₹5–12 | about ₹7–16k a month |
| Opus 5, `medium` / Opus 5.5 | lower — the bench measures by how much | |
| the bench itself, once | | about $10–20 |

Never downgrade the model or the effort for cost without the owner's word — the numbers go to him
and he decides.

## 9. [24-Sep] Decisions the owner has not yet made — nothing in §3 starts until these are answered

1. **Who marks the answer key** — about 75 real photos, each beside its stored reading, marked
   right or wrong from the picture: the owner, or Ramana. About 30–45 minutes.
2. **The bench run** — about $10–20, reads production photos, writes nothing. How the four keys
   reach it: the owner runs `railway run node backend/scripts/ocr-bench.js`, or adds them to the
   session's environment secrets.
3. **Which models to bench** — Opus 5 only, or Opus 5.5 as well.
4. **Scope** — slips only on the new reader; coupons, gauge and gift plates unchanged until each is
   measured; deliveries and bills untouched.
5. **The 23-Sep BPCL slip photograph** for the §6 fixture — the owner has it.
6. **Where step 1–2 ships** — it is a money path, so CLAUDE.md says staging first; staging is
   reserved for VAWE and has no data. Production with revert-the-PR as the rollback, as dashboard
   work does, or another route.
