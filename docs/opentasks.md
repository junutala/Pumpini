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

---

## 5. LFR — the per-litre charge that never reaches the margin

**Raised 14-Sep-2026 by a prospective BPCL dealer (SBR Energies), who asked why
Pumpini captures only one of the two invoices his OMC sends him.**

### What LFR is, with the arithmetic

Licence Fee Recovery is the OMC recovering its investment in the outlet's assets.
It arrives as a **second, separate invoice on the same day as the fuel invoice**,
and it is a different tax regime entirely: fuel is outside GST and bills under
VAT/CST, LFR is a GST service invoice under **SAC 997212** (leasing of
non-residential property), item code `4395 - LFR Recovery`.

It is charged **per KL lifted**, at a rate set by the outlet's site category:

| | Who owns what | MS | HSD | GST |
|---|---|---|---|---|
| **'A' site** | OMC owns or leases the land AND the equipment | ₹443.50/KL | ₹369.58/KL | 18% |
| **'B' site** | Dealer owns land + building; **OMC still owns the equipment** | ₹184.34/KL | ₹153.62/KL | 28% |

A dealer who owns his own site still pays LFR — less, because he is renting only
the equipment. **LFR follows the equipment, not the land.**

**Verified against a real invoice** (BPCL `FIIN112710061073`, 07-Sep-2026, against
fuel invoice `1303629797` of the same date):

    MS   4 KL × 443.50  =  1,774.00
    HSD  8 KL × 369.58  =  2,956.64
                            ────────
         taxable        =  4,730.64     invoice: 4,730.64   ✔ exact
         + 18% GST      =  5,582.16     invoice: 5,582.16   ✔ exact

The A/B gap also implies the split the OMC used: **58.4% of an A-site rate is
land, 41.6% equipment — identical on both fuels, to the decimal.** That is a
designed apportionment, not a coincidence.

### Why it matters: the margin we show is overstated

LFR is ₹0.4435/L on petrol and ₹0.3696/L on diesel at an A site. Against the real
margins in production on 14-Sep:

| | LFR/L | margin/L | LFR as share of margin |
|---|---|---|---|
| Kamala petrol | 0.4435 | 4.12 | **10.8%** |
| Highway petrol | 0.4435 | 3.59 | **12.4%** |
| Sri Balaji diesel | 0.3696 | 3.61 | **10.2%** |
| Highway diesel | 0.3696 | 2.16 | **17.1%** |

Owner, 14-Sep: *"the owner will be counting a profit that does not show up in his
bank account."* He is right, and the error is **systematic and always in the same
direction** — the worst kind.

### 🔴 DO NOT HARDCODE THE RATE CARD

The rates above came from secondary sources and were corroborated against **one
invoice on one date from one OMC**. OMCs revise LFR. A constant in our code that
falls out of date shows a wrong margin silently, forever — worse than showing
gross and saying so.

**Derive the rate from the outlet's own LFR invoice**: `taxable ÷ KL lifted` gives
the ₹/KL actually charged. It is his data, it self-corrects on revision, it is
auditable against the paper, and it needs no rate table at all. Use the published
card only as a *validation check* — flag an invoice whose implied rate is far off
the card, do not substitute for it.

### Do NOT fold it into `rate_per_ltr`

`rate_per_ltr` is defined at `deliveries.js:451` as the all-inclusive landed cost
from the fuel invoice, and it must stay reconcilable to that document. LFR is
separately invoiced. Show it as **its own line**, per the show-the-working rule:

    selling price      115.09
  − landed cost        111.50
  − LFR                  0.4435
                      ─────────
    true margin          3.15      (not 3.59)

A margin that silently drops with no visible cause is a margin the owner stops
trusting.

### Blockers, in order

1. **No outlet's site category is stored.** Not A, not B, nowhere in the schema.
   Without it nothing can be computed, and guessing is a back-solved dip. One
   nullable column on `station_settings`, alongside `oil_company`.
2. **Not every outlet pays LFR at all.** A dealer owning land *and* equipment
   pays none. Deducting universally would understate his margin. The column must
   allow "none".
3. **Only BPCL is verified.** HPCL and IOCL rates and site-category naming are
   unchecked.
4. **🔴 The capture path already exists and has never been used.**
   `POST /api/accounts/scan-bill` → `expenseService.createExpense` already takes a
   vendor, `gst_amount`, `invoice_number` and the document, and posts a balanced
   entry. `expenses` has **zero rows across all four real outlets**;
   `accounts_enabled` is true at exactly one (Sri Balaji) and even there nothing
   has been entered. **Do not build a second "tagged invoice" route beside it** —
   that is the cardinal rule's exact failure mode.

**So the first step is capture, not display.** Put a real LFR invoice through the
existing bill scanner and see what it extracts. A margin deduction computed from
data nobody has captured is a number we invented.

### Open question for the owner's CA, not for us

GST on LFR is likely **cost, not credit**. Petrol and diesel are non-taxable
supplies, so under **s.17(2) CGST** input credit is restricted to the share
attributable to taxable supplies — a pump that is overwhelmingly fuel can claim
almost none of it. That decides whether `gst_amount` posts to `input_gst` or is
added to the expense. Not our call.
