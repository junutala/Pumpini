# Open tasks

Agreed with the owner, 31-Aug-2026. Newest decisions at the top of each item; when
one is finished, delete it from here rather than marking it done — a list of
completed work is not a list of open tasks.

---

## 1. Deterministic ATG reading — OpenCV + PaddleOCR + field templates

**Status: parked, deliberately. Owner: "keep it in opentasks for now."**

Not because it is wrong — because the cheaper change (crop-and-upscale before
Google Vision, item 2 below) may take most of the benefit for a fraction of the
work, and that has to be measured first.

### What it is

Replace the "photograph the whole console → OCR → ask a model to make sense of it"
pipeline with one that knows the shape of the screen:

    photo → perspective correction → detect the tank cards
          → crop the KNOWN position of each field → OCR that crop only
          → numeric normalisation → cross-validation → structured JSON

Then we never ask *"what does this image say"*, only *"what number is in the Gross
Volume position"* — a far easier problem, and a deterministic one.

### Why it is attractive

- **Same photo, same answer, every time.** On 31-Aug the identical image was read
  three times and gave three different answers — products swapped, then a product
  word missing, then tank numbers renumbered 1/2/3 for tanks numbered 1/3/4. That
  is a model guessing, and a model guesses differently each time.
- **Auditable.** A crop and a threshold can be shown to the owner. "The model
  inferred the labels from capacity bands" cannot.
- **No invented digits.** Vision returns per-symbol confidence; below a threshold we
  refuse the field instead of repairing it.
- Cost is **not** the reason. Google Vision is $1.50 per 1,000 scans after 1,000
  free per month; at four outlets the bill is under a dollar a month. Do this for
  determinism, not to save money.

### What it costs

- The backend is Node on Railway with **no image tooling at all** today. OpenCV and
  PaddleOCR mean a separate Python service — real infrastructure, not a dependency.
- **Templates are per console family.** HP/Pinelabs has a summary table; IOCL
  (Kamala) has cards only, different field names, and prints no capacity. Each needs
  its own field map, and an unseen console gets "enter manually" rather than a
  half-guess. That refusal is arguably correct, but it is a real change in coverage.
- The console is a **web page** (`192.168.0.188/status_tank.php` in Firefox), so its
  layout moves with window size, zoom and browser chrome. Field regions must be
  anchored to detected card edges, never to absolute pixels.

### Do this before deciding

Finish item 2 and measure it. If crop-and-upscale through Vision reads the field
case reliably, this becomes a determinism/auditability question rather than an
accuracy one — and can wait for a quieter month.

---

## 2. Crop and upscale before Vision — SHIPPED 31-Aug, now being measured

Shipped as a 3x greyscale upscale RACED against the untouched frame, longer text
wins, both counts stored on the artifact. Live and gathering rows.

    Nagole   19:57   as_taken 1461   upscaled 1492   upscaled won
    Hayat    20:00   as_taken 1478   upscaled 1492   upscaled won
    Nagole   20:45   as_taken 1127   upscaled    0   skipped, file already large

**Judge it on rows, not on the first three.** And note the honest weakness in the
metric: that 1,127-character read was PERFECT, as was the 1,478 one. Character count
catches 732-chars-of-mush; it cannot separate two good reads. If the counts stay
close, revert #394 and nothing is lost — the untouched read is always a candidate.

Still to do: FIELD-LEVEL crops. `cropForOcr` is shipped and unused, taking fractions
of the image rather than pixels because the console is a web page whose geometry moves
with the browser window. The entry point is Vision's own word boxes, which we fetch
(`DOCUMENT_TEXT_DETECTION`) and currently discard.

---

## 3. The A/V FLOOR — open, and do not tighten it by intuition

The CEILING was anchored to the outlet's board price on 31-Aug and is done. The floor
is a genuinely different question and is still 40.

A ÷ V is the meter's LIFETIME average, and it sits BELOW today's board by however much
prices have risen since the pump went in. Measured on genuine Kamala slips: ₹90.29 and
₹91.68 against ₹104.23 — 12-13% under. **A 5% floor would reject both.** It is a
function of the meter's AGE, not of the price, so it cannot be anchored the way the
ceiling was. Tune it from `scripts/slip-eval.js` once there are real slips to tune with.

---

## 3b. `fuel_prices` is queried from EIGHT places

`settlementService`, `settlementLedger`, `couponService`, `spokeService` (twice),
`routes/prices`, `routes/groups`, `routes/ai-chat` — and now `priceService`, which is
the writer for everything NEW so the count stops growing. Folding the other seven in is
its own change: they sit on live money paths, several take a transaction `client`, and
one caches per shift. Worth doing; not worth doing in passing.

---


## 4. The setup-scan reference ratio

Every nozzle slip prints lifetime rupees (A) and lifetime litres (V). A ÷ V is that
nozzle's average price per litre across the whole life of its meter — and it barely
moves: about **115,000 litres to shift it by 1%**, roughly a year of trade. So it is
a fingerprint of that nozzle.

We already scan the slip at commissioning. Store that ratio and every later scan
must land near it — 1–2%. For Kamala's `.1` that is a window of ₹88.50–92.10 against
today's ₹40–200: about forty times tighter. A volume misread as 1,954,130 instead of
1,654,130 implies ₹76.40, which both the flat band and a price-anchored band accept,
and the nozzle's own reference rejects at −15%.

**Blocker: we throw the reading away.** All 18 commissioning slips have `ocr: null` —
the photograph is kept and the numbers discarded. Storing it is step one.

Two conditions: the manager must confirm the genesis figures against the slip in his
hand (a wrong reference rejects every honest slip afterwards), and a meter reset or
pump replacement must void the reference and force a fresh genesis scan.
