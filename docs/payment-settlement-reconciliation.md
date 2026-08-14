# Digital-payment settlement reconciliation — Paytm & PhonePe

_Started 15-Aug-2026. The assistant has no cross-session memory — this file is the
memory. No prior PhonePe/Paytm integration write-up existed in the repo (main,
staging, history) or in Drive when this was created; this file starts the record._

---

## 1. The gap this closes

Outlets take digital payments (UPI / QR / card) through **Paytm** and **PhonePe**.
That money does **not** arrive per-sale — the gateway sweeps a day's collections and
pays it into the outlet's bank as a **settlement (payout)**, identified by a bank
**UTR**. Today nothing ties that bank payout back to the sales Pumpini recorded, so:

- We cannot prove "the ₹X Paytm deposited on the 12th = these sales," and
- A short-paid, delayed, or missing payout is invisible until someone eyeballs a
  bank statement.

The goal: pull each day's **settlement lines** from the gateway, **match** them to
Pumpini sales (by order id / UTR / amount), and **flag** anything unreconciled.
This is the bank-deposit side of the money loop, not the shift/cash settlement.

---

## 2. Shared approach (applies to BOTH gateways)

These hold for Paytm and PhonePe alike; the per-gateway sections only fill in the
concrete endpoints, auth, and fields.

1. **Read-only. No money moves.** These are recon/statement APIs — they fetch data,
   never write to the gateway. Worst case of a bad call is a failed fetch.
2. **Production-only credentials.** Both gateways gate settlement/recon behind the
   live merchant account — there is no sandbox that returns real settled data.
3. **Secrets stay server-side.** Merchant keys / salt keys live in Railway env (or an
   encrypted per-station config) — **never** in the repo, **never** in the frontend.
   The signature/checksum is computed **server-side only**. Do not paste keys into
   chat or commits.
4. **Per-station credentials.** Each outlet is its own merchant account (its own
   MID / merchantId + key). Store credentials **per station**, encrypted — this is a
   multi-tenant system and one outlet must never read another's payouts.
5. **Fixture-first development.** One live call → save the JSON → build the parser +
   reconciliation matcher against that **fixture in staging**. Only the thin
   fetch layer ever touches production.
6. **Reconciliation model.** A settlement line carries: a **UTR**, a **settled
   amount**, **fees/commission + GST**, a **payout date**, and **per-transaction
   references** (order id / txn id). Match those to Pumpini sales; unmatched → flag.
7. **Settlement APIs are PAYOUT-BOUND.** No payout day (weekend / public holiday) →
   **no data**. Weekend sales surface in the **next business-day payout's**
   settlement. For same-day weekend *transaction* visibility you need a
   transaction/order-status API — a different, non-payout-bound endpoint, out of
   scope for settlement reconciliation.

---

## 3. Paytm — **FROZEN**

Paytm exposes **three** settlement APIs. For reconciliation we **target the
Settlement Detail API** (richest — payout-centric, transaction-level, and it
includes refunds & chargebacks). The **Settlement API (list)** is the fallback if
Detail isn't entitled; the **Split Settlement API** is only for vendor/sub-merchant
split payouts.

| API | Auth | Granularity | Filter | Page size | Fit |
|---|---|---|---|---|---|
| **Settlement Detail** | JWT | txn-level, at **payout level**, incl. refunds/chargebacks | date range **or payout ID** | tbc | ★ primary |
| Settlement (list) | checksumHash | txn-level per settled day | date range (max 1 day) | 20 | fallback |
| Split Settlement | checksumHash | vendor/child-level | date range + `vendorId` | 50 | only if split payouts |

### 3.1 Credentials required (per outlet)
- **Production MID / merchantId** — the merchant identifier (base API: `MID`; split
  API: `merchantId`; max 64 chars).
- **Merchant Key** (for List/Split) — the secret used to build `checksumHash`.
- **JWT credentials** (for Settlement Detail) — Paytm token-based auth; capture the
  exact client id/secret + token endpoint from Paytm's JWT auth page.
- **Entitlement** — Paytm must enable the chosen settlement API on that MID (not on
  by default). Confirm with the Paytm account manager.
- All secrets server-side only; store per station, encrypted.

### 3.2 Auth (differs by API)
- **Settlement API / Split Settlement** → `checksumHash`: a signature over the
  **request body**, built with the **Merchant Key** (Paytm checksum util),
  server-side. Bad/mistyped signature → `00000022 CHECKSUM_VALIDATION_FAILED`.
- **Settlement Detail API** → **JWT tokenization** (bearer token), *not* checksum —
  a different credential flow (token endpoint + client credentials to capture).

### 3.3 API 1 — Settlement Detail API  *(PRIMARY — reconciliation target)*
- **Use case:** detailed transaction-level view of settled transactions **at payout
  level**, filtered by **date range OR payout ID**. Includes **forward (acquiring),
  refunds and chargebacks**, plus wide output (customer details, merchant bank
  details) — so a bank payout is fully explained down to each transaction.
- **Environment:** production only. **Auth:** JWT.
- **Why it fits us best:** querying **by payout ID** maps 1:1 to a bank-statement
  line (the UTR); it breaks that payout into the transactions we match to Pumpini
  sales; and refunds/chargebacks are included, so **gross sales reconcile to the net
  amount actually credited**. The list API below cannot net those out.
- ⚠️ **Spec still needed to finalise** — the source paste was truncated at "Request
  Attributes". To complete this subsection: request params (`payoutId`, date range,
  paging), the JWT token flow, and the full response field list (esp. their
  UTR/payout id, `settleAmount`, fees/commission/GST, and per-txn order/txn refs).

### 3.4 API 2 — Settlement API (list)  *(FALLBACK)*
- **Endpoint:** `POST https://secure.paytmpayments.com/merchant-settlement-service/settlement/list`
- **Environment:** production only.
- **Limits:** date range **max 1 day**; data retained **6 months**; **pageSize max 20**.

**Request body**

| Field | Req | Notes |
|---|---|---|
| `MID` | ✔ | Merchant ID |
| `utrProcessedStartTime` | ✔ | Start date (`YYYY-MM-DD`), within last 6 months |
| `utrProcessedEndTime` | – | End date; if omitted → `start + 1` |
| `checksumHash` | ✔ | Signature over the body (Merchant Key) |
| `pageNum` | ✔ | Page number (from 1) |
| `pageSize` | ✔ | Max 20 |

**Response**: `status` (SUCCESS / FAILURE / RECORD_NOT_FOUND), `resultCode`,
`errorMessage`, `count`, `totalCount`, `settlementDetailList[]`,
`paginatorPageNum`, `paginatorPageSize`, `paginatorTotalPage`, `paginatorTotalCount`.

**Per settled transaction** (`settlementDetailList[]`): `txnId`, `txnType`,
`txnDate`, `txnAmount`, `bankName`, `custId`, `paymentMode`, `mid`, `merchantName`,
`orderId`, `mercUnqRefVal`, `utrProcessedTime`, `utr`, `settleAmount`, `payoutDate`,
`gst`, `commission`.

→ The reconciliation keys we care about: **`orderId` / `mercUnqRefVal`** (to match a
Pumpini sale), **`utr` + `settleAmount` + `payoutDate`** (to match the bank credit),
and **`commission` + `gst`** (the deduction, so gross sale ≠ net payout is explained).

### 3.5 API 3 — Split Settlement API  *(OPTIONAL — vendor/child-level)*
Same `/settlement/list` family, but returns **vendor/child-level** data when a
`vendorId` is passed. Use **only** where an outlet's payouts are split to
sub-merchants/vendors (a franchisee/marketplace arrangement). A standalone outlet
does **not** need this now.

**Differences from the list API**
- Request uses **`merchantId`** (not `MID`) and adds **`vendorId`**.
- **pageSize max 50** (vs 20).
- Paginator fields are named `pageNum`, `pageSize`, `totalPages`, `totalTransactions`
  (vs the `paginator*` names above) — the parser must handle both shapes.

### 3.6 Weekend / holiday behaviour  *(answers the standing question)*
No settlement API returns data for a **non-payout day**. Paytm's recon runs on weekends
but the **payout is not released** until the next business day, so a weekend date
yields an empty response. Weekend sales appear under the **next business-day
payout** (by `payoutDate` / `utrProcessedTime`). Same-day weekend *transaction* data
needs a transaction/order-status API — not the settlement API.

### 3.7 Result codes (List / Split — checksum APIs)
| resultCode | status | meaning |
|---|---|---|
| `00000000` | SUCCESS | SUCCESS |
| `00000010` | FAILURE | Exception while processing query |
| `00000022` | FAILURE | CHECKSUM_VALIDATION_FAILED |
| `00000030` | FAILURE | ILLEGAL_PARAM |
| `00000031` | FAILURE | FACADE_EXCEPTION |
| `00000074` | FAILURE | Too many requests / TPS breached |

### 3.8 Implementation notes (for when credentials arrive)
- **Settlement Detail (primary):** query by **payout ID** where possible (one call
  per bank UTR); else by date range. Obtain/refresh the JWT before the call.
- **List/Split (fallback):** loop **one call per day** (1-day cap), paginating on
  `pageNum` until `paginatorTotalPage` (or `totalPages`).
- Respect the TPS limit (`00000074`) — throttle / back off.
- Store the raw JSON per (station, day/payout) as the audit fixture before parsing.

---

## 4. PhonePe — **TO BE COMPLETED** (dispatched to a research agent)

> This section is being completed by an agent researching PhonePe's current
> settlement / reconciliation API, mirroring the Paytm structure above. It must
> capture, from PhonePe's official docs: credentials (merchantId + **Salt Key +
> Salt Index**), the **X-VERIFY** request signing, the settlement/recon
> endpoint(s) and host, request params (and any date-range limits), the response
> shape (their UTR / settlement id, settled amount, fees, payout date, per-txn
> references), pagination, weekend/holiday behaviour, and error codes — flagging
> anything that cannot be confirmed rather than guessing.

_(placeholder — do not rely on this section until filled in)_

---

## 5. Status & next steps

- [ ] **Paytm:** obtain prod **MID + Merchant Key** (one outlet to start) and confirm
      the Settlement API is **entitled** on that MID.
- [ ] **PhonePe:** obtain prod **merchantId + Salt Key + Salt Index** and confirm
      recon/settlement API access. *(Section 4 to be completed first.)*
- [ ] One **live fetch each** → capture JSON **fixtures**.
- [ ] Design the **per-station encrypted credential store** + the **reconciliation
      schema** (settlement lines ↔ sales, with an "unreconciled" state).
- [ ] Build the **fetch layer + matcher** (staging, against fixtures) before any
      production wiring.
