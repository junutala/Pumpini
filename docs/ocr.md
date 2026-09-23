# OCR — why the slip scan lost the managers, and the plan to win them back

Written 23-Sep-2026 for the agent that implements it. Read this whole file before touching code,
then read `docs/flow-v2-build-plan.md` §6 and §10 — the post-mortem this plan builds on — and
`backend/src/services/visionOcr.js`, the one reader every scan goes through.

The owner, 23-Sep: _"we lost a couple of paying customers due to this OCR issue and now, almost all
the real customers are manually entering the readings"_ — and _"if you can fix this OCR thing, I am
sure I will fly high with pumpini."_ This is the most important thing in the product. Treat it so.

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
them."_

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
  `PhotoCapture`.)
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

1. **Measured, on Pumpini's own stored photos**, against the readings the managers typed:
   **≥ 99% of nozzle lines correct to the last digit**, and **0 rupee-as-litre readings**.
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

- **Inputs:** every stored slip photograph that has a manager-typed reading for the same nozzle and
  shift — `station_artifacts` / `dispense_artifacts` / `meter_photos` (`file_base64`, `ocr`), joined
  to the readings the manager entered. Include the 13 live-outlet photos from 02/04-Aug whose `ocr`
  is NULL (§10) — they are the ones that lost the customers.
- **Engines to run, same photos:**
  - A. today's pipeline, unchanged (`readImageAsJson` as is);
  - B. the new reader from step 1;
  - C. B without the Google Vision text (image only) — to learn whether Vision still earns its call.
- **Score per nozzle line:** exact match of litres to the last decimal; rupee-as-litre (a separate
  column — the one that matters most); marked-legible-but-wrong (the other one that matters most);
  serial match; nozzle number match.
- **Output:** a table in `docs/ocr-bench-results.md` with the date, engine, model id and counts —
  and keep the per-line rows so a regression can be traced to a photograph.
- **Needs:** `ANTHROPIC_API_KEY`, `GOOGLE_VISION_API_KEY`, read access to the database. Cost is a
  few US cents a photograph for B/C (Opus-tier pricing, one image of ~1.5–3k tokens plus thinking).
  Ask the owner before running it against production data, and say what it will cost.

**Ship nothing in steps 1–2 until the bench shows B beating A.** If it does not, stop and report the
numbers — do not tune until green by feel.

### Step 1 — One reader, changed once (`backend/src/services/visionOcr.js`)

All six readers (delivery invoices, expense bills, dispenser slips, gauge console, totalizer photo,
coupons) go through `readImageAsJson`. Change it there, not per screen — the file's own header is
right about why.

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

### Step 4 — The manager confirms, beside the photograph

- After a scan, show each nozzle's reading next to a crop of the photograph where it was read, with
  one tap to confirm and a field to correct it.
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

1. Bench (step 0) → results table to the owner, with the cost of the run. **Stop here if B does not
   beat A.**
2. Reader change (step 1) + photo size (step 2), behind the bench — ship when B's numbers hold.
3. Checks (step 3) — ship with tests (use §6 as a fixture).
4. Confirm screen (step 4).
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
