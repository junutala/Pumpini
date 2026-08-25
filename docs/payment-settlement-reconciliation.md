# Digital-payment verification & settlement reconciliation — Paytm & PhonePe

_Started 15-Aug-2026. The assistant has no cross-session memory — this file is the
memory. No prior PhonePe/Paytm integration write-up existed in the repo (main,
staging, history) or in Drive when this was created; this file starts the record._

---

## 1. The two objectives (don't confuse them)

Outlets take digital payments (UPI / QR / card) through **Paytm** and **PhonePe**.
There are **two** distinct questions, and they need **different APIs**:

**PRIMARY — settlement-time verification (this is the real goal).**
When the attendant closes his shift and declares "I collected **₹XXXX by UPI**," we
must **fetch and confirm that ₹XXXX of UPI was actually collected by the aggregator
for this outlet during the shift** — **on any day, weekends and holidays included**.
This is a **transaction-time** question ("did these payments happen?"), answered by a
**transaction-list / order-status API** (Paytm: **Order List** + **Transaction
Status**). It is **not** payout-bound, so it works every day.

**SECONDARY — payout / bank reconciliation (owner-facing, optional).**
Separately, the owner may want to confirm the gateway's **bank payout** matches the
sales (UTR, net-of-fees). That is **payout-bound** (T+1, nothing on non-payout days)
and is served by the **settlement APIs**. Useful, but it can never answer a
Sunday-evening shift settlement — which is why it is **not** the primary path.

> ⚠️ Earlier drafts of this doc led with the settlement APIs. That was the wrong tool
> for the primary objective. The settlement APIs are kept below as SECONDARY only.

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
7. **Verification ≠ reconciliation.** The **PRIMARY** path (settlement-time
   verification) uses **transaction-time** APIs (Order List / Transaction Status) —
   **not payout-bound**, so a Sunday sale is confirmable Sunday. The **SECONDARY**
   settlement APIs are **payout-bound** (no data on weekends/holidays; weekend sales
   land in the next business-day payout). Never use a settlement API to answer a
   same-day shift settlement.

---

## 3. Paytm — **GTM APIs frozen**

Paytm serves **both** objectives, with **different** APIs. Match the API to the job:

**Part A — settlement-time verification (PRIMARY).** Use the **Order List API** to pull
the shift window's UPI transactions and sum them; use the **Transaction Status API** to
drill into one order. Transaction-time based → works any day.

**Part B — payout / bank reconciliation (SECONDARY).** The **Settlement Detail API** is
richest (payout-level, incl. refunds/chargebacks); **Settlement API (list)** is the
fallback; **Split Settlement** only for vendor split payouts. Payout-bound.

| API | Part | Auth | Keyed by | Page size | Fit |
|---|---|---|---|---|---|
| **Order List** | A | checksum **or** JWT | MID + **date/time range** (≤30 d) | default 20 | ★ **primary — shift verification** |
| **Transaction Status** | A | checksum | MID + **`orderId`** | — | per-order confirm |
| Settlement Detail | B | JWT | date range (≤1 wk) **or** payout ID | 20 | owner bank-recon (secondary) |
| Settlement (list) | B | checksum | date range (≤1 day) | 20 | secondary fallback |
| Split Settlement | B | checksum | date range + `vendorId` | 50 | only if split payouts |

### 3.1 Credentials required (per outlet)
- **Production MID / merchantId** — the merchant identifier (base API: `MID`; split
  API: `merchantId`; max 64 chars).
- **Merchant Key** (for List/Split) — the secret used to build `checksumHash`.
- **JWT credentials** (for Settlement Detail) — a **`clientId`** (sent as a header)
  plus a client secret used to mint a **Bearer JWT** (sent as `Authorization:
  Bearer`). Only the token-minting endpoint remains to capture from Paytm's JWT
  auth page.
- **Entitlement** — Paytm must enable the chosen settlement API on that MID (not on
  by default). Confirm with the Paytm account manager.
- All secrets server-side only; store per station, encrypted.

### 3.2 Auth (differs by API)
- **Settlement API / Split Settlement** → `checksumHash`: a signature over the
  **request body**, built with the **Merchant Key** (Paytm checksum util),
  server-side. Bad/mistyped signature → `00000022 CHECKSUM_VALIDATION_FAILED`.
- **Settlement Detail API** → **JWT tokenization** (bearer token), *not* checksum —
  a different credential flow (token endpoint + client credentials to capture).

---

## Part A — settlement-time verification  *(PRIMARY)*

> **These two APIs — `Order List` + `Transaction Status` — are our GTM APIs** for the
> objective (confirm the attendant's declared UPI at settlement, any day). Everything we
> need is here; only two page-level details remain to copy (Order List's response-field
> list and its endpoint URL). Part B (settlement APIs) is not on the critical path.

### 3.3 Order List API  *(PRIMARY — the shift-verification workhorse)*
- **Use case:** fetch **order-level details for a MID over a date/time range**. This is
  how we confirm the attendant's declared UPI at settlement — **any day**, because it
  keys on **transaction time, not payout**.
- **Auth:** `tokenType` = **`CHECKSUM`** (signature over the body with the Merchant Key)
  or `JWT`. Use checksum. `signature` mandatory.
- **Endpoint:** *TO CONFIRM* — on the API page's REQUEST panel; same `…paytmpayments.com/theia/…`
  family (prod `secure.paytmpayments.com`, staging `securestage.paytmpayments.com`).
- **Request — Head:** `tokenType` (CHECKSUM|JWT, ✔), `signature` (✔), `requestTimestamp` (–).
- **Request — Body:**
  | Field | Req | Notes |
  |---|---|---|
  | `mid` | ✔ | the outlet's MID |
  | `orderSearchType` | ✔ | `TRANSACTION` for forward sales (pipe-separate for many; others: REFUND, CHARGEBACK, …) |
  | `orderSearchStatus` | ✔ | `SUCCESS` (only confirmed collections; also FAILURE, PENDING) |
  | `fromDate` / `toDate` | ✔ | `YYYY-MM-DDTHH:MM:SS`; **max 30-day range**, within 18 months → the **shift window** |
  | `payMode` | – | scope to UPI — value **`UPI`** (see §3.4) |
  | `pageNumber` / `pageSize` | ✔ | paginate (default 20); `isSort=true` caps at 10 000 rows |
  | `merchantOrderId`, `searchConditions` (VAN_ID, RRN_CODE) | – | optional |
- **Response:** `resultInfo`, **`orders`** (per-order list), `pageNum`, `pageSize`.
  ⚠️ **The `orders` / "Orders+" field list is TO CONFIRM** (expand it on the doc page) —
  must include **amount, order id, transaction timestamp, status, payMode** for the sum
  to be real. (By analogy to Transaction Status §3.4 it will.)
- **Result codes:** `1001` SUCCESS · `4001` invalid signature · `4002` mandatory param
  missing · `4003` invalid params · `4009` checksum failed · `4099` system error.

### 3.4 Transaction Status API  *(verification — per order)*
- **Use case:** real-time status of **one `orderId`** for a MID — the per-payment
  confirm / drill-down (resolve a PENDING line, verify a disputed one).
- **Auth:** checksum (`signature` ✔); optional `clientId` when the MID has multiple keys.
- **Request — Body:** `mid` (✔), `orderId` (✔), `txnType` (–, for pre-auth/capture flows).
- **Response (key fields):** `txnId`, `bankTxnId`, `orderId`, **`txnAmount`**,
  **`paymentMode`** (**`PPI, UPI, CC, DC, NB`**), `txnDate`, `merchantUniqueReference`,
  `utr` / `rrnCode` (bank-transfer), `resultInfo`.
- **Result codes:** `01` TXN_SUCCESS · `400`/`402` PENDING · `331` NO_RECORD_FOUND ·
  `334` Invalid Order ID · `335` Mid invalid · various `TXN_FAILURE`.

### 3.5 The verification design  *(what we build)*
At settlement, the attendant declares **₹XXXX UPI**:
1. Call **Order List** for the outlet's **MID** with `orderSearchType=TRANSACTION`,
   `orderSearchStatus=SUCCESS`, `payMode=UPI`, `fromDate/toDate` = **shift start/end**;
   paginate; **sum the order amounts**.
2. Compare the sum to **₹XXXX** → **confirmed**, or **flag** the difference.
3. Use **Transaction Status** to drill into any specific or PENDING order.

- **Weekend-proof:** keys on transaction time + `SUCCESS`, not payout — a Sunday sale is
  returned Sunday.
- **UPI vs PPI (decide with owner):** Paytm separates **`UPI`** from **`PPI`** (Paytm
  wallet) and cards (`CC`/`DC`). An attendant saying "UPI" for QR collections may mean
  **UPI + PPI** (both are scan-to-pay). Decide whether the verified figure sums `UPI`
  only or `UPI+PPI`; cards are a separate bucket.
- **PENDING at cut-off:** a just-completed txn can read `PENDING` (`400`/`402`); count
  `SUCCESS` only and re-check shortly after (or via Transaction Status).
- **Coverage — TO CONFIRM:** verify Order List returns **QR / Soundbox** collections
  (all orders under the MID), not only merchant-initiated native-flow orders. The
  Orders+ fields, or one live call, will settle this.

---

## Part B — payout / bank reconciliation  *(SECONDARY — owner-facing)*

### 3.6 API — Settlement Detail API  *(SECONDARY — richest payout view)*
- **Use case:** detailed transaction-level view of settled transactions **at payout
  level**, by **date range OR payout ID**. Includes **ACQUIRING (forward), REFUND,
  CHARGEBACK** (and REPAYMENT), with wide output (customer, fees, merchant bank,
  EDC/POS) — a bank payout fully explained down to each transaction.
- **Environment:** production only. **Auth:** **JWT** (bearer token).
- **Why it fits us best:** query **by `payoutId`** maps 1:1 to a bank-statement line;
  it breaks that payout into transactions we match to sales; refunds/chargebacks are
  included so **gross sales reconcile to the net amount actually credited**; and
  `merchantBillId` (POS order id) + `posId`/`extSerialNo` (the EDC / Pinelabs machine)
  tie a settlement line to a specific terminal and sale. The list API can't do this.
- **Endpoint:** `POST https://secure.paytmpayments.com/merchant-settlement/SettlementDetail`
- **Headers:** `Content-Type: application/json`, `clientId: <clientId>`,
  `Authorization: Bearer <JWT>`.
- **Request envelope** — fields from the tables below go inside `request.body`; the
  body is nested under a `request` object with a `head`:
  ```json
  {
    "request": {
      "head": { "reqMsgId": "<uuid-v4>" },
      "body": { "mid": "<MID>", "startDate": "2022-07-06" }
    }
  }
  ```
  Mode B swaps `startDate`/`endDate` for `"payoutId": "ALL2...911"`.
- **Remaining TO CONFIRM:** how the **Bearer JWT is minted** — Paytm issues it from a
  token endpoint using `clientId` + client secret; capture that token call (and the
  `reqMsgId` generation rule) from Paytm's "Merchant Authentication (JWT)" page.

**Request — Head:** `reqMsgId` (mandatory, UUID, one per request).

**Request — Body**, in one of two modes:

_Mode A — by payout date_
| Field | Req | Notes |
|---|---|---|
| `mid` | ✔ | Merchant ID |
| `startDate` | ✔ | `YYYY-MM-DD` |
| `endDate` | – | **Max range 1 week** |
| `pageNum` / `pageSize` | – | `pageSize` **max 20** |

_Mode B — by payout id_
| Field | Req | Notes |
|---|---|---|
| `mid` | ✔ | Merchant ID |
| `payoutId` | ✔ | The bank-transfer payout id |
| `pageNum` / `pageSize` | – | `pageSize` **max 20** |

**Response — Head:** `reqMsgId`, `respTime`.

**Response — Body (per transaction)**, grouped by how we use each field:
- **Match to a Pumpini sale:** `orderId`, `merchantUniqueRef`, `merchantBillId` (POS
  order id), `merchantRefId`, `transactionId`, `referenceTransactionId`, `prn`.
- **Match to the bank credit:** `payoutId`, `utrNo`, `settledAmount`, `payoutDate`,
  `settledDate`, `bankTransactionId`, `ifscCode`, `bankName`, `beneficiaryName`.
- **Explain gross → net:** `amount` (pre-settlement), `commission`, `gst`,
  `acquiringFee`, `platformFee`, `acquiringTax`, `platformTax`, `commissionRate`,
  `feeFactor`.
- **Type / status:** `transactionType` (ACQUIRING / REFUND / CHARGEBACK / REPAYMENT),
  `status` (SUCCESS / PENDING / FAILURE), `disputeId`, `rrnCode`.
- **Instrument:** `paymentMode` (UPI / BALANCE / card…), `channel`, `issuingBank`,
  `maskedCardNo`, `cardNetwork`, `gateway`, `requestType`, `productCode`, `van`.
- **Terminal / EDC:** `posId`, `extSerialNo` (EDC serial), `merchantName`.
- **Customer:** `customerId`, `nickName`, `customerPhoneNo`, `customerEmailId`,
  `transactionDate`, `updatedDate`.

**Result codes (Settlement Detail):**
| resultCode | status | meaning |
|---|---|---|
| `00000000` | S | success |
| `00000004` | F | parameter illegal |
| `00000019` | F | process fail |
| `00000900` | U | unknown system error |
| `10010007` | F | no records found |
| `12014162` | F | max query time is 180 days |
| `12014163` | F | platform internal id does not exist |

**Limits:** date-range mode **max 1 week per call**; data queryable up to **180 days**
back (`12014162`); `pageSize` **max 20**; paginate on `pageNum`.

### 3.7 API — Settlement API (list)  *(SECONDARY fallback)*
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

### 3.8 API — Split Settlement API  *(SECONDARY — vendor/child-level only)*
Same `/settlement/list` family, but returns **vendor/child-level** data when a
`vendorId` is passed. Use **only** where an outlet's payouts are split to
sub-merchants/vendors (a franchisee/marketplace arrangement). A standalone outlet
does **not** need this now.

**Differences from the list API**
- Request uses **`merchantId`** (not `MID`) and adds **`vendorId`**.
- **pageSize max 50** (vs 20).
- Paginator fields are named `pageNum`, `pageSize`, `totalPages`, `totalTransactions`
  (vs the `paginator*` names above) — the parser must handle both shapes.

### 3.9 Weekend / holiday behaviour  *(Part B only)*
No settlement API returns data for a **non-payout day**. Paytm's recon runs on weekends
but the **payout is not released** until the next business day, so a weekend date
yields an empty response. Weekend sales appear under the **next business-day
payout** (by `payoutDate` / `utrProcessedTime`). Same-day weekend *transaction* data
needs a transaction/order-status API — not the settlement API.

### 3.10 Result codes (List / Split — checksum APIs)
| resultCode | status | meaning |
|---|---|---|
| `00000000` | SUCCESS | SUCCESS |
| `00000010` | FAILURE | Exception while processing query |
| `00000022` | FAILURE | CHECKSUM_VALIDATION_FAILED |
| `00000030` | FAILURE | ILLEGAL_PARAM |
| `00000031` | FAILURE | FACADE_EXCEPTION |
| `00000074` | FAILURE | Too many requests / TPS breached |

### 3.11 Implementation notes — Part B (for when credentials arrive)
- **Settlement Detail (primary):** query by **payout ID** where possible (one call
  per bank UTR); else by date range. Obtain/refresh the JWT before the call.
- **List/Split (fallback):** loop **one call per day** (1-day cap), paginating on
  `pageNum` until `paginatorTotalPage` (or `totalPages`).
- Respect the TPS limit (`00000074`) — throttle / back off.
- Store the raw JSON per (station, day/payout) as the audit fixture before parsing.

---

## 4. PhonePe — **FROZEN: Comprehensive Transaction Recon API**

_Fully grounded in PhonePe's official spec (endpoint, X-VERIFY, request/response) + PhonePe's
own C#/Java/Python samples. **The raw spec and sample code are preserved verbatim in
[Appendix A (§9)](#9-appendix-a--phonepe-comprehensive-transaction-recon-api-raw-spec--samples)**
so we never lose them. This section is the curated design; §9 is the source._

Mechanism (same as Paytm Part A): pull `/v1/transactions/details` for the shift window, sum
the `COMPLETED` amounts (**paise → ÷100**), subtract nested refunds, compare to the
attendant's figure. Transaction-time keyed → works any day.

### 4.1 Endpoint & auth  *(confirmed — see §9)*
- **UAT:** `POST https://mercury-uat.phonepe.com/enterprise-sandbox/v1/transactions/details`
- **Prod:** `POST https://mercury-t2.phonepe.com/v1/transactions/details`
- **Body:** `{ "request": "<base64 of the JSON payload>" }`; `Content-Type: application/json`.
- **X-VERIFY:** `SHA256(base64Payload + "/v1/transactions/details" + saltKey) + "###" + saltIndex`
  (lower-case hex). ⚠️ Use this concatenation order (base64 + apiPath + saltKey) — PhonePe's
  C#/Python samples match it; the Java sample's variable order looks inconsistent (see §9).
- **X-PROVIDER-ID:** for merchants onboarded via a provider.
- Per-outlet **Salt Key + Salt Index** as tenant secrets (server-side only).

### 4.2 Request (JSON, before base64)
| Field | Req | Notes |
|---|---|---|
| `merchantId` | ✔ | the outlet's PhonePe MID |
| `startTimestamp` / `endTimestamp` | ✔ | **Epoch** shift window. ⚠️ *unit:* request sample is **10-digit (seconds)**, response `transactionDate`/`searchAfter.timestamp` are **13-digit (millis)** — confirm the request unit in the outside-first test |
| `size` | ✔ | page size |
| `storeId` | – | filter to a store (< 38 chars, no special chars) |
| `searchAfter` | – | cursor `{ timestamp, transactionId }` of the last row; `{}` first call |

### 4.3 Response (grounded — full sample in §9)
`success`, `code`, `message`, `data.transactionDetails[]`, `data.totalResult`,
`data.searchAfter` (cursor). **Per transaction:**
- `transactionId` (= merchant txn id), `providerReferenceId`, `merchantOrderId`
  (**only if `return_merchantorderId` on** — §4.5)
- **`amount`** — **paise** (`4200` = ₹42.00) → ÷100
- **`paymentState`** — sum **`COMPLETED`**; `payResponseCode` = SUCCESS (string)
- **Attribution:** top-level `storeId`/`terminalId` + `transactionContext`
  (`qrCodeId`, `posDeviceId`, `storeId`, `terminalId`) — **only for QR/SQR txns** (our case)
- `paymentMode` — **only if the MID has `includePaymentModes` on** (§4.5)
- `transactionDate` — **epoch millis**
- `transactionLevelSettlement` → `transactionSettlementDetails[]`: **`utr`**, `status`
  (`SETTLED`), `settlementDate`, `settlementAmount`; + `status`, `settlementText`, `toBeSettledDate`
- `instrumentLevelSettlementDetails` (e.g. `ACCOUNT`: `totalAmount`, `settlementAmount`, `utr`)
- **`refundTransactionDetails[]`** — `amount` (paise), `transactionType=REFUND`,
  `originalTransactionId`, `paymentState`, `transactionDate` → **net = amount − Σ refunds**

### 4.4 The verification design (PhonePe)
1. Call `/v1/transactions/details` for the outlet's `merchantId` (+ `storeId`), the shift
   window; page with `size` + `searchAfter` until the cursor is exhausted.
2. Keep `paymentState = COMPLETED`; **sum `amount`/100**; **subtract** each row's
   `refundTransactionDetails`.
3. Compare to **₹XXXX** → **confirmed**, or **flag** the difference.

- **Attribution (pump pivot) + honest limit:** `terminalId`/`storeId` per txn → pump → its
  nozzles → the attendant. Per **pump, not per nozzle**: one attendant on a pump → clean
  per-attendant number; **shared pump → pump-level only, never an invented split**;
  **single-VPA outlet → shift-total match only**. Guardrail against a wrong accusation.
- **Weekend-proof:** keys on transaction time, not payout.
- **Lighter alternative (not the source of truth):** the **QR Transaction List**
  (`/v3/qr/transaction/list`) — real-time per-store list, but PhonePe says ignore its
  `paymentState` and it has no refunds/settlement.

### 4.5 Config to request from PhonePe (so the response carries what we need)
- **`includePaymentModes`** on the MID → returns `paymentMode` (UPI vs wallet).
- **`return_merchantorderId`** flag → returns `merchantOrderId` (to match our sale).

### 4.6 Phase-2 lever (later, optional)
`/v3/qr/init` takes a per-request **`x-callback-url`** + **`invoiceDetails`** — the real-time
per-sale binding lever if we ever attack personal-QR diversion. Not needed for the sum-based
verification.

### 4.7 Open items (now small)
- Confirm the **timestamp unit** for request `start/endTimestamp` (seconds vs millis).
- Ask PhonePe to enable **`includePaymentModes`** + **`return_merchantorderId`** on the MID.
- Per-outlet **`merchantId` + `storeId`** + **Salt Key + Salt Index** (prod creds).

---

## 5. Integration architecture — PSP-agnostic core + per-outlet config

**Principle: build each PSP once; configure per outlet forever after.** A new outlet on an
already-supported PSP needs **zero code and zero deploy** — only configuration captured at
outlet setup. (e.g. Adhoc + Highway → Paytm, Kamala → PhonePe — all three onboarded by config.)

### 5.1 Two layers
- **PSP-agnostic core (shared, built once).** One internal interface —
  `fetchShiftTransactions(outlet, window) → NormalizedTxn[]` — returning a normalized model
  `{ amount₹, status, timestamp, mode, storeId, terminalId, refunds[] }`. The verification logic
  lives here and is **identical for every PSP**: sum the successful amounts, net refunds,
  attribute `terminalId → pump → nozzles → attendant`, compare to the attendant's declared
  figure. This layer never knows which PSP it is talking to.
- **Per-PSP adapters (drivers, one per PSP).** Each PSP implements the interface: build + sign
  the request, paginate, and **map the raw response into the normalized model**. Adapters absorb
  every difference — auth (checksum / X-VERIFY / JWT), amount unit (paise vs rupees), timestamp
  unit, success-state name (`COMPLETED` vs `SUCCESS`), pagination (cursor vs page-number),
  UPI-vs-wallet. Per-PSP contracts: **Paytm** §3 + Appendix B (§10); **PhonePe** §4 + Appendix A (§9).

### 5.2 Per-outlet configuration (set at onboarding — no code, no deploy)
Stored **per station**, secrets **encrypted**:

| Config | Example / notes |
|---|---|
| `psp` | `paytm` / `phonepe` / `gpay` |
| `environment` | `prod` / `uat` |
| credentials (encrypted) | MID/merchantId, merchant-key / salt-key + index / clientId, `storeId` |
| terminal ↔ pump map | `terminalId` → pump → its nozzles → attendant |
| policy | does "UPI" include wallet? |

Onboarding a new outlet on Paytm/PhonePe is **filling these in during outlet setup** — the
`New-Outlet-Setup` workbook gains a **"Payment Provider"** section, and the values land in the
per-station config. No engineering touch.

### 5.3 Runtime
**One multi-tenant Pumpini backend serves all outlets.** At shift verification it reads the
outlet's `psp` + variables, selects the matching adapter, fetches → normalizes → sums →
compares. Shared code, per-outlet variables.

### 5.4 Admin screen — what it owns (and what it can't)
- **Owns (config-driven, per outlet):** PSP choice, environment, credentials, terminal↔pump
  map, and the UPI-vs-wallet policy. Secrets are write-only/encrypted, never shown in plaintext.
- **Does NOT own:** the request/response shape, signing, pagination, field mapping — those are
  bespoke per PSP and live in the adapter (code). Getting them wrong is a **money-accuracy
  risk** (we already caught a concat-order bug in PhonePe's own Java sample). So the screen
  manages PSP *instances*; adding a new PSP *type* is a contained code adapter — deliberately
  **not** a full "declarative PSP engine."

### 5.5 The PSPs
- **Paytm** — adapter grounded (§3 + Appendix B §10): Order List + Transaction Status.
- **PhonePe** — adapter grounded (§4 + Appendix A §9): `/v1/transactions/details`.
- **Google Pay for Business (GPay)** — ⚠️ **does not fit the pull-recon model.** The Google
  Pay for Business API is a **collection SDK** (`isReadyToPay`, `loadPaymentData`) that accepts
  **one payment in-app** and returns a signed per-transaction response at that moment — there is
  **no "list a shift's transactions" recon API** like Paytm/PhonePe (confirmed from the spec —
  Appendix C §11). So GPay cannot be verified by pulling a window after the fact. Routes to
  reconcile GPay instead: **(a)** if GPay is processed through a **Payment Gateway**
  (`PAYMENT_GATEWAY` type), that **PG owns the recon** — reconcile via the PG's API (which may be
  Paytm/PhonePe/Razorpay/etc.); **(b)** the **bank / UPI settlement statement**; or **(c)**
  **capture each payment's SDK response at collection time** — only viable if Pumpini or the POS
  app is *in* the GPay payment flow (not a static-QR / soundbox setup). Decide the GPay route
  with the owner before building any adapter.

- **Pine Labs Plutus (card / EDC & Soundbox channel)** — the **card-acquiring** channel on the
  physical swipe / Android EDC (Verifone/Pax) & Soundbox, complementing the UPI-QR PSPs; same
  adapter model, `mode = CARD`. Functions gathered (full spec pending — see §8.3): **Batch Data /
  Settlement Report** (closed transactions/batches for shift recon — the primary pull),
  **Transaction Enquiry / Get Transaction Status** (per-txn by `PlutusTransactionRefID` /
  `MerchantOrderNo`), **Webhook / Callback Bridge** (real-time slip push). Attribution via
  **Terminal ID (TID) → pump/counter → attendant**. ⚠️ Two open questions decide the design:
  (a) does the EDC/Soundbox also carry **UPI/wallet** — if so, decide whether Plutus or
  Paytm/PhonePe **owns** those txns (avoid double-counting); (b) is batch/settlement data only
  available **after batch close (EOD)** — if so we may need the **webhook + enquiry** for
  intra-shift verification, not just the batch report.

---

## 6. Status & next steps

**Paytm — PRIMARY (GTM):**
- [x] APIs frozen: **Order List** (shift-window sum) + **Transaction Status** (per-order).
- [ ] Copy the last two page details: **Order List response fields** ("Orders+") +
      **endpoint URL**.
- [ ] Obtain prod **MID + Merchant Key** for one outlet (checksum auth) and confirm
      **which `paymentMode`s** count as the attendant's "UPI" (`UPI` only, or `UPI+PPI`).
- [ ] Confirm Order List returns **QR/Soundbox** collections, not just native-flow orders.

**PhonePe — FROZEN (Comprehensive Transaction Recon API, §4; raw spec §9):**
- [x] **Frozen on `/v1/transactions/details`** — endpoint, X-VERIFY, request/response all
      **confirmed** (raw spec + PhonePe C#/Java/Python samples, preserved in §9).
- [ ] Confirm the **timestamp unit** (seconds vs millis) during the outside-first test.
- [ ] Ask PhonePe to enable **`includePaymentModes`** + **`return_merchantorderId`** on the MID.
- [ ] Obtain per outlet: **`merchantId` + `storeId`** (+ `terminalId`) and **Salt Key + Salt Index**.

**Both:**
- [ ] One **live call each** → capture JSON **fixtures** (staging where available).
- [ ] Design the **per-station encrypted credential store** + the verification/matcher.
- [ ] Build the **fetch + sum/compare** layer (staging, against fixtures) before prod.


---

## 7. Deployment strategy — prove outside first

The integration is gated on the numbers proving out against a **real shift**, before any
production code is written:

1. **Paytm first.** Once we have credentials for **one outlet**, run the Order List API
   **outside Pumpini** (a standalone script / Postman), **fetch a shift's UPI transactions,
   and match the total** against what the attendant declared. Only if we're satisfied with
   the match do we proceed to integrate into Pumpini.
2. **Same approach for every other PSP** (PhonePe next): a standalone fetch-and-match against
   a real shift first, then integrate.

Why: no production code, no schema, no risk until the figure is proven against a real shift.
The standalone run's raw JSON becomes the **test fixture** for the eventual build (§2, item 5).

---

## 8. What we need from the customer (per gateway)

To run the outside-first test (§7), we need the following. Keys are secrets — have them sent
directly into the secure store, **not** pasted into chat or email where avoidable.

### 8.1 Paytm — to test first (per outlet)
- **Production MID** (merchant id).
- **Merchant Key** — the secret used to build the checksum/signature. If the MID has more
  than one key, the **`clientId`** for the key to use.
- Confirmation the **Order List API** and **Transaction Status API** are **enabled** on the MID.
- The **production base URL** for the Order List API.
- Product decision: does the attendant's "UPI" figure mean **`UPI` only**, or **`UPI` + `PPI`
  (Paytm wallet)**?

**Exact questions to ask the Paytm executive** (copy-paste):
1. "Please share our **production MID** for the outlet *<outlet name>*."
2. "Please share the **Merchant Key** used to generate the checksum/signature for that MID.
   If the MID has multiple keys, also share the **`clientId`** of the key we should use."
3. "Please **enable the Order List API and the Transaction Status API** on this MID for
   reconciliation/reporting."
4. "Do these report APIs authenticate with **checksum**, or do they need **JWT**? If JWT,
   please share the **`clientId` + client secret** and the **token-generation endpoint**."
5. "Our UPI is collected via **QR / Soundbox / EDC** — will those transactions appear in the
   **Order List API**? And what **`payMode`** value will they carry (e.g. `UPI`, and wallet
   as `PPI`)?"
6. "What is the **production base URL** for the Order List API, and is there any **TPS / rate
   limit** we should respect?"
7. "Is the Order List API date range limited to **30 days** per call, with data available for
   **18 months** — can you confirm?"

### 8.2 PhonePe — next (per outlet)
- **`merchantId`** and **`storeId`** (and **`terminalId`** per pump, if terminals are used).
- **Salt Key + Salt Index** (for the X-VERIFY signature).
- Enable **`includePaymentModes`** (returns `paymentMode`) and **`return_merchantorderId`**
  (returns `merchantOrderId`) on the MID.
- Endpoint is known: prod `https://mercury-t2.phonepe.com/v1/transactions/details`.

**Exact questions to ask the PhonePe executive** (copy-paste):
1. "Please share our **`merchantId`** and **`storeId`** (and **`terminalId`** per device, if we
   use terminals) for the outlet *<outlet name>*."
2. "Please share the **Salt Key** and **Salt Index** for X-VERIFY on this merchant."
3. "Please **enable the Transaction Details recon API** (`/v1/transactions/details`) for this
   MID, and turn on **`includePaymentModes`** and **`return_merchantorderId`** so the response
   carries `paymentMode` and `merchantOrderId`."
4. "Please confirm the request **`startTimestamp`/`endTimestamp` unit** — epoch **seconds** or
   **milliseconds**?"

### 8.3 Pine Labs Plutus — card / EDC channel (spec still needed)
The **card** side of digital collections (Paytm/PhonePe cover UPI-QR). To freeze the Plutus
adapter I need the actual API spec — paste it like the others:
- **Batch Data / Settlement Report** (primary): base URL (UAT + prod) + path + method; the
  **auth** scheme (API key / security token / merchant credentials — exactly what); request
  params (how to scope a **shift / batch** — date-time range? batch id? TID? does it require a
  batch close first?); response fields per txn — **amount, status (approved / void / refund),
  timestamp, TID, RRN, approval code, card-network / payment-type, MerchantOrderNo, batch id,
  settled amount**; pagination; a **sample request + response**.
- **Transaction Enquiry / Get Transaction Status**: endpoint + method + auth; request keys
  (`PlutusTransactionRefID`, `MerchantOrderNo`); response fields + status values; a sample.
- **Webhook / Callback Bridge**: the **payload shape** pushed; how it's **verified**
  (HMAC / signature? IP allowlist?); how the callback URL is **registered** (per TID? portal?);
  retry behaviour.
- **Per-outlet creds/config:** Merchant ID, Store ID, **Terminal ID(s) per EDC**, any API key /
  security token, environment + base URLs, and the **TID → pump/counter** mapping.

**Clarifying questions for the outlet / Pine Labs:**
1. Which payment types run through the Plutus EDC/Soundbox — **card only, or also UPI/wallet**?
   (If UPI too, which channel owns those txns for reconciliation, to avoid double-counting?)
2. Is settlement/batch data available **only after batch close (EOD)**, or intra-day per shift?
   (Decides whether we lean on the batch report vs the webhook + enquiry.)
3. One EDC per pump/counter, and does the response carry the **TID** so we can attribute?

---

## 9. Appendix A — PhonePe Comprehensive Transaction Recon API: raw spec & samples

_Preserved verbatim because PhonePe's docs are unreachable from this environment; the pasted
spec is our source of truth. Curated design: [§4](#4-phonepe--frozen-comprehensive-transaction-recon-api)._

**Endpoints**
- UAT: `POST https://mercury-uat.phonepe.com/enterprise-sandbox/v1/transactions/details`
- Prod: `POST https://mercury-t2.phonepe.com/v1/transactions/details`

**Request Headers**
| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-VERIFY` | `SHA256(base64 encoded payload + "/v1/transactions/details" + salt key) + ### + salt index` |
| `X-PROVIDER-ID` | Used where merchants are onboarded via their Providers |

**Sample Request — Payload**
```json
{
  "merchantId": "MERCHANTPROD",
  "size": 10,
  "startTimestamp": 1739387780,
  "endTimestamp": 1739301380,
  "searchAfter": {}
}
```
**Sample Request — Base64 encoded**
```json
{ "request": "ewogICJtZXJjaGFudElkIjogIk1FUkNIQU5UUFJPRCIsCiAgInNpemUiOiAxMCwKICAic3RhcnRUaW1lc3RhbXAiOiAxNzM5Mzg3NzgwLAogICJlbmRUaW1lc3RhbXAiOiAxNzM5MzAxMzgwLAogICJzZWFyY2hBZnRlciI6IHsKICAgIH0KfQ==" }
```

**Request Parameters**
| Name | Type | Description | Mandatory |
|---|---|---|---|
| `merchantId` | STRING | Unique MerchantID assigned by PhonePe | Yes |
| `storeId` | STRING | Store Id; unique; no special chars; < 38 chars | No |
| `startTimestamp` | LONG | Epoch base timestamp | Yes |
| `endTimestamp` | LONG | Epoch base timestamp | Yes |
| `size` | Integer | page size | Yes |
| `searchAfter` | object | `{ timestamp: last-txn-timestamp, transactionId: PhonePe txn id of last txn }` | No |

**Response Codes**
| Field | Mandatory | Type | Comments |
|---|---|---|---|
| `success` | Yes | boolean | true if 2xx else false |
| `code` | No | String | failure code, else null |
| `message` | Yes | — | null if 2xx |
| `data` | Yes | Json | Transaction List Response |

**Response Parameters (TransactionStatusResponse, per transaction)**
- `merchantId` (Yes)
- `transactionId` (Yes) — maps to Merchant TransactionId
- `providerReferenceId` (Yes)
- `amount` (Yes) — paise
- `merchantOrderId` (No) — returned only if `return_merchantorderId` flag is on
- `paymentState` (Yes)
- `transactionContext` (No) — returned **only when a QR code is present (SQR transactions)**:
  `qrCodeId`, `posDeviceId`, `storeId`, `terminalId`
- `storeId` (No), `terminalId` (No)
- `paymentMode` (No) — returned only if the MID is in `transactionStatusConfiguration.includePaymentModes`
- `transactionLevelSettlement` (Yes): `settlementText` (Yes), `toBeSettledDate` (No),
  `transactionSettlementDetails[]` → `utr`, `status`, `settlementDate`, `settlementAmount` (all No),
  `status` (Yes, settlement status)
- `instrumentLevelSettlementDetails` (No): `totalAmount`, `settlementAmount`, `utr` (all No)
- `transactionDate` (Yes) — forward transaction date, epoch
- `refundTransactionDetails` (No): `transactionId`, `providerReferenceId`, `amount`,
  `merchantorderId`, `paymentState`, `payResponseCode` (default "SUCCESS"), `paymentMode`,
  `transactionDate`

**Sample Success Response**
```json
{
  "success": true, "code": null, "message": null,
  "data": {
    "transactionDetails": [
      {
        "merchantId": "PUKHRAJP2M",
        "transactionId": "674d8fc7d63ec5d848fc2b6b",
        "providerReferenceId": "T2412021615439790985396",
        "amount": 4200,
        "merchantOrderId": "674d8fc7d63ec5d848fc2b6b",
        "paymentState": "COMPLETED",
        "payResponseCode": "SUCCESS",
        "paymentModes": [],
        "transactionContext": { "qrCodeId": null, "posDeviceId": null, "storeId": "A2BTEST", "terminalId": "KSTESTDEMO" },
        "storeId": "A2BTEST", "terminalId": "KSTESTDEMO",
        "transactionDate": 1734620679192,
        "transactionLevelSettlement": {
          "settlementText": "", "toBeSettledDate": null,
          "transactionSettlementDetails": [
            { "utr": "241202161543", "status": "SETTLED", "settlementDate": 1734621056000, "settlementAmount": 4200 }
          ],
          "status": "SETTLED"
        },
        "instrumentLevelSettlementDetails": { "ACCOUNT": { "totalAmount": 4200, "settlementAmount": 4200, "utr": "241202161543" } },
        "refundTransactionDetails": [
          { "merchantId": "M101VERXHLTR5M", "transactionId": "T2404101100287911939130", "transactionType": "REFUND",
            "paymentState": "COMPLETED", "amount": 4200, "merchantTransactionId": "OMR2404101100184735499130",
            "merchantOrderId": "OMR2404101100184735499130", "providerReferenceId": "T2404101100287911939130",
            "payResponseCode": "SUCCESS", "originalTransactionId": "674d8fc7d63ec5d848fc2b6b" }
        ]
      }
    ],
    "totalResult": 2,
    "searchAfter": { "timestamp": 1734620679192, "transactionId": "674d8fc7d63ec5d848fc2b6b" }
  }
}
```

**X-VERIFY signing — from PhonePe's sample code (checksum = SHA256(base64 + apiPath + saltKey), hex, then `###` + keyIndex).** PhonePe supplied C#/Java/Python samples for `/v3/qr/init`; the only change for this API is `apiPath = "/v1/transactions/details"`.

_Python (Django) — clearest, self-contained:_
```python
# base64-encode the JSON payload
encodeddata = base64.b64encode(json.dumps(payload).encode('UTF-8')).decode('UTF-8')
data = { "request": encodeddata }
# X-VERIFY
str_forSha256 = encodeddata + '/v1/transactions/details' + saltkey
x_verify = hashlib.sha256(str_forSha256.encode('UTF-8')).hexdigest() + '###' + keyindex
headers = { "Content-Type": "application/json", "X-VERIFY": x_verify }   # + "X-PROVIDER-ID" if applicable
res = requests.post(url=baseUrl + '/v1/transactions/details', data=json.dumps(data), headers=headers)
```

_C# — checksum function (verbatim shape):_
```csharp
// jsonSuffixString = apiPath + merchantKey;  checksumString = base64JsonString + jsonSuffixString
byte[] checksumBytes = SHA256.Create().ComputeHash(Encoding.UTF8.GetBytes(checksumString));
string checksum = ""; foreach (byte b in checksumBytes) checksum += $"{b:x2}";
checksum = checksum + "###1";
```

_Java — checksum function (verbatim shape):_
```java
// checksumString = base64Encoded + urlEndpoint;   md = SHA-256
// NOTE: PhonePe's Java sample sets urlEndpoint = saltKey + apiPath, i.e. base64 + saltKey + apiPath —
// this differs from the header spec (base64 + apiPath + saltKey) and from the C#/Python samples.
// Follow the HEADER SPEC order (base64 + apiPath + saltKey); verify during the outside-first test.
StringBuilder checksum = new StringBuilder();
for (byte b : md.digest()) checksum.append(String.format("%02x", b));
// + "###1"
```

---

## 10. Appendix B — Paytm Order List & Transaction Status APIs: raw spec

_Preserved verbatim (Paytm docs unreachable here). Curated design:
[§3 Part A](#part-a--settlement-time-verification-primary). The settlement-family raw detail
(Settlement Detail / list / Split) is captured in §3.6–§3.11._

### B.1 Order List API
**Use case:** fetch order-level details for a given MID and date range.

**Request — Head**
| Attr | Type | Mand | Notes |
|---|---|---|---|
| `requestTimestamp` | string(15) | optional | EPOCH |
| `tokenType` | string(10) | mandatory | `CHECKSUM` or `JWT` |
| `signature` | string | mandatory | checksum over the body params |

**Request — Body**
| Attr | Type | Mand | Notes |
|---|---|---|---|
| `mid` | string(64) | Yes | merchant id |
| `orderSearchType` | string | Yes | `TRANSACTION`, `REFUND`, `M2B`, `TRANSFER_FOR_SETTLEMENT`, `CANCEL`, `REPAYMENT`, `TRANSFER_TO_BANK`, `CHARGEBACK`, `ALL` (pipe-separated) |
| `orderSearchStatus` | string | Yes | `SUCCESS`, `FAILURE`, `PENDING` (pipe-separated) |
| `merchantOrderId` | string | optional | |
| `fromDate` | string | Yes | `YYYY-MM-DDTHH:MM:SS`; **max range 30 days**; within 18 months |
| `toDate` | string | Yes | same |
| `payMode` | string(64) | optional | e.g. `BANK_TRANSFER` |
| `isSort` | string | optional | `true`→caps total to 10 000; `false`→no cap |
| `pageNumber` | Integer | Yes | default 1 |
| `pageSize` | Integer | Yes | default 20 |
| `searchConditions` | object | optional | `VAN_ID`, `RRN_CODE` |

**Response — Head:** `responseTimestamp`, `version`, `signature`.
**Response — Body:** `resultInfo`, `orders`, `pageNum`, `pageSize`.

**Response Codes**
| ResultStatus | ResultCodeId | ResultCode | ResultMsg |
|---|---|---|---|
| SUCCESS | 1001 | SUCCESS | Success |
| INVALID_SIGNATURE | 4001 | FAILURE | Provided Signature is invalid |
| MANDATORY_PARAM_MISSING | 4002 | FAILURE | Mandatory Param Missing |
| REQUEST_PARAMS_INVALID | 4003 | FAILURE | Invalid Request Params |
| SYSTEM_ERROR | 4099 | FAILURE | System Error |
| CHECKSUM_VALIDATION_FAILED | 4009 | FAILURE | Checksum validation failed |

### B.2 Transaction Status API
**Use case:** transaction status for a given `orderId` for a MID.

**Request — Head:** `version`, `channelId` (`WEB`|`WAP`), `requestTimestamp`,
`clientId` (only if the MID has multiple keys), `signature` (mandatory).
**Request — Body:** `mid` (mandatory), `orderId` (mandatory),
`txnType` (optional: `PREAUTH`, `RELEASE`, `CAPTURE`, `WITHDRAW`).

**Response — Body (key fields):** `resultInfo`, `txnId`, `bankTxnId`, `orderId`, `txnAmount`,
`txnType`, `gatewayName`, `gatewayInfo`, `bankName`, `mid`, **`paymentMode`
(`PPI, UPI, CC, DC, NB`)**, `refundAmt`, `txnDate`, `merchantUniqueReference`;
(bank transfer) `vanInfo`, `sourceAccountDetails`, `transferMode` (`IMPS/NEFT/RTGS/XFER`),
`utr`, `bankTransactionDate`, `rrnCode`, `arnCode`, `authCode`;
(cards) `cardScheme`, `lastFourDigit`, `maskedCardNo`, `cardNetwork`; plus pre-auth fields
(`preAuthId`, `blockedAmount`, `cardPreAuthType`, `authRefId`).

**Response Codes**
| resultCode | resultStatus | resultMsg |
|---|---|---|
| 01 | TXN_SUCCESS | Txn Success |
| 227 / 401 / 810 / 843 / 820 / 267 | TXN_FAILURE | bank declines (various) |
| 235 | TXN_FAILURE | Wallet balance insufficient |
| 295 | TXN_FAILURE | invalid UPI VPA |
| 331 | NO_RECORD_FOUND | No Record Found |
| 334 | TXN_FAILURE | Invalid Order ID |
| 335 | TXN_FAILURE | Mid is invalid |
| 400 | PENDING | Transaction status not confirmed yet |
| 402 | PENDING | Payment not complete; confirming with bank |
| 501 | TXN_FAILURE | Server Down |

---

## 11. Appendix C — Google Pay for Business (Merchant SDK): raw spec

> ⚠️ **This is a COLLECTION SDK, not a reconciliation/transaction-list API** (see §5.5). It
> accepts one payment in-app and returns a signed per-transaction response; it cannot list a
> shift's transactions after the fact. Preserved verbatim as provided.

**Version (all APIs):** `apiVersion = 2`, `apiVersionMinor = 0` (required).

**`isReadyToPay`** — check GPay availability + registered methods on the device.
- Request: `allowedPaymentMethods` — `[{ type: "UPI" }, { type: "CARD", parameters: { allowedCardNetworks: ["VISA","MASTERCARD"] } }]`.
- Response: **boolean** (false → don't attempt payment).

**`loadPaymentData`** — async; collects ONE payment; result in `onActivityResult` as `PaymentDataResponse`.
- Request:
  - `allowedPaymentMethods[]` — UPI: `payeeVpa` (req), `payeeName` (req), `mcc` (req, 4-digit),
    `transactionReferenceId` (req, = `tr`, merchant order id), `referenceUrl` (opt), optional GST
    (`gstIdentificationNumber`, `gstBreakup{gst,cgst,sgst,igst,cess}`, `invoiceNumber`, `invoiceDate`);
    `transactionId` (`tid`) is **deprecated — keep unset**.
  - `tokenizationSpecification.type` — **`DIRECT`** (merchant handles credentials) or
    **`PAYMENT_GATEWAY`** (`gateway`, `gatewayMerchantId`, `gatewayTransactionId` → *the PG owns
    processing & recon*).
  - `transactionInfo` — `totalPrice`, `currencyCode` ("INR"), `totalPriceStatus` ("FINAL"),
    `transactionNote` (opt).
- Response: `paymentMethodData { type, tokenizationData { type: "DIRECT", token } }`, where
  `token` is a **signed** blob:
  - Outer: `protocolVersion` ("ECv1"), `signature` (ECDSA), `signedMessage`.
  - UPI `signedMessage`: `messageExpiration`, `paymentMethod` ("UPI"),
    `paymentMethodDetails { payeeVpa, status: SUCCESS|SUBMITTED|FAILURE, transactionId (tid),
    transactionReferenceId (tr = PSP txn id), transactionInfo }`.
  - CARD `signedMessage`: `paymentMethodDetails { status, gatewayTransactionId, gatewayResponse }`.

**Why it doesn't reconcile a shift:** the only transaction data GPay returns is this per-payment
`PaymentDataResponse` at collection time. There is no MID+window query. To reconcile GPay, see the
three routes in §5.5.
