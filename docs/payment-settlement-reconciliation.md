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

> **Update — the Paytm *for-Business outlet* model (§8.1, raw spec Appendix E §13) is the
> grounded reference for our fuel outlets, and matches the Pine Labs shape.** Intra-shift =
> **Webhook** + **Transaction Status** (`POST /v3/order/status`); EOD = **Settlement Detail**
> (`POST /merchant-settlement/v1/settlement/detail`, checksum). The Order-List-first framing
> below predates that package — **Order List is now an *optional* date-range enumerator** (its
> response fields were never confirmed); the **Webhook** is the shift enumerator instead.
> ⚠️ Two Settlement-Detail variants exist in Paytm's docs — JWT `/merchant-settlement/SettlementDetail`
> (§3.6) vs checksum `/merchant-settlement/v1/settlement/detail` (§8.1/§13); confirm which is
> enabled on the outlet's MID.

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
- **Endpoint (confirmed):** `POST /v3/order/status` (prod `securegw.paytm.in`, staging
  `securegw-stage.paytm.in`) — from the for-Business package (§8.1 / Appendix E §13).
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

> **Update — PhonePe *for-Business outlet* model (§8.2, raw spec Appendix F §14) matches
> Paytm/Pine Labs.** Intra-shift = **S2S Webhook** + **Check Status**
> (`GET /v3/transaction/{mid}/{txnId}/status`) + **EDC/POS Status** (`POST /v1/edc/transaction/...`);
> **EOD settlement recon = `/v1/transactions/details`** (this section). All **X-VERIFY** (salt);
> amounts in **paise ÷100**; `utr` / `referenceNumber` = RRN.

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
An outlet usually runs **several UPI sources in parallel** — e.g. a Pine Labs dynamic-QR terminal
**and** static Paytm / PhonePe / BharatPe sticker QRs for peak throughput. So the config is a
**list of PSP sources** per outlet, each with its own credentials. The engine queries **all**
configured sources for the shift window and **unifies** them into one stream: a payment goes
through exactly one QR, so summing across sources is the outlet's true UPI total, and the **UPI
RRN** is the unique key for matching the attendant's claim and de-duping. Stored **per station**,
secrets **encrypted**:

| Config | Example / notes |
|---|---|
| `psp_sources[]` | one or more of `paytm` / `phonepe` / `pinelabs` (+ `gpay` only with a dedicated GPay-for-Business VPA) |
| `environment` | `prod` / `uat` |
| credentials (encrypted) | per source: MID/merchantId, salt-key+index / merchant-key / OAuth `client_id`+`client_secret` / `clientId`, `storeId`, TID(s), webhook secret |
| terminal ↔ pump map | `tid` / `storeId` → pump → its nozzles → attendant |
| policy | does "UPI" include wallet? does the attendant tag the gateway? |

Onboarding a new outlet is **filling these in during outlet setup** — the `New-Outlet-Setup`
workbook gains a **"Payment Providers"** section (a row per source), landing in per-station config.
No engineering touch.

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

- **Pine Labs Plutus / Plural (UPI via terminal-generated *dynamic* QR)** — a **UPI** channel,
  **not card**. Attendant keys the amount on the POS/Soundbox → dynamic UPI QR → customer scans &
  pays → logged under the machine **TID** with **UPI RRN + approval code + batch**. `mode = UPI`.
  **Fully grounded** (§8.3; raw spec + samples + HMAC code in Appendix D §12). Two confirmed
  realities shape the design: **(a) hybrid** — outlets run Plutus dynamic QR *and* static
  Paytm/PhonePe/BharatPe QRs in parallel, so the engine treats them as **parallel sources**,
  unifies, and matches by **RRN**; **(b) batch = EOD-only** — so **intra-shift** verification uses
  the **Webhook (`payment.success`)** or **Transaction Enquiry**; the **Settlement/Batch API is
  EOD / audit only**.

---

## 6. Status & next steps

**Paytm — GROUNDED (for-Business model; §8.1 / Appendix E §13):**
- [x] Intra-shift = **Webhook** (`TXN_SUCCESS`, `paytmchecksum` verify) + **Transaction Status**
      (`POST /v3/order/status`); EOD = **Settlement Detail** (`/merchant-settlement/v1/settlement/detail`).
      Checksum auth (Merchant Key). Amounts in **rupees**; `paymentMode = UPI`.
- [ ] Obtain per outlet: **MID + MERCHANT_KEY**; register the **webhook URL** in the Paytm Dashboard;
      capture **SOUNDBOX_DEVICE_ID / STATIC_QR_ID / POS_ID** for attribution.
- [ ] Confirm which **Settlement-Detail variant** (JWT vs checksum) is enabled on the MID.

**PhonePe — GROUNDED (for-Business model; §8.2 / Appendix F §14):**
- [x] Intra-shift = **S2S Webhook** (X-VERIFY over base64 `response`) + **Check Status**
      (`GET /v3/transaction/{mid}/{txnId}/status`) + **EDC Status** (`/v1/edc/...`); EOD =
      **`/v1/transactions/details`** recon. Amounts **paise ÷100**; `utr`/`referenceNumber` = RRN.
- [ ] Obtain per outlet: **MERCHANT_ID, SALT_KEY, SALT_INDEX**, **STORE_ID/TERMINAL_ID** map;
      register our **webhook URL** with PhonePe.
- [ ] (EOD-only) confirm `/v1/transactions/details` timestamp unit + `includePaymentModes`.

**Pine Labs Plutus / Plural — GROUNDED (all 3 APIs; §8.3 / Appendix D §12):**
- [x] Transaction Enquiry + Webhook (`payment.success`, HMAC-verified) = intra-shift primary;
      Settlement/Batch = EOD audit. Amounts in **rupees** (not paise). Auth = OAuth Bearer.
- [ ] Obtain per outlet: `MID`, `STORE_ID`, OAuth `CLIENT_ID`+`CLIENT_SECRET`, `WEBHOOK_SECRET`,
      `TID_MAPPINGS` (TID → dispenser/island); register our callback URL.
- [ ] Confirm which outlets run Plutus, and which *also* have Paytm/PhonePe/BharatPe sticker QRs.

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

### 8.1 Paytm for Business — grounded (the outlet model)
Same shape as the others: **intra-shift = Webhook + Transaction Status; EOD = Settlement Detail.**
Raw spec + samples + verify code in **Appendix E (§13)**. ⚠️ Amounts are **rupee decimals** (`1500.00`).

**Auth (all):** every request `head` carries a `checksumHash` / `signature` from the **Paytm Merchant
Key** (Paytm Checksum lib, AES-128 + SHA-256). **Hosts:** staging `https://securegw-stage.paytm.in` ·
prod `https://securegw.paytm.in`.

- **(1) Webhook — PRIMARY intra-shift.** Configure our backend URL in the Paytm Dashboard; Paytm
  pushes each txn: `MID`, `ORDERID`, `TXNAMOUNT`, `TXNID`, **`BANKTXNID` (= RRN)**, `STATUS`
  (`TXN_SUCCESS`), **`PAYMENTMODE` (`UPI`)**, `TXNDATE`, `BANKNAME`, `CHECKSUMHASH`. **Verify** with
  the official `paytmchecksum` SDK (npm/pip):
  `verifySignatureByString(JSON.stringify(body_without_CHECKSUMHASH), MERCHANT_KEY, checksum)`.
- **(2) Transaction Status — enquiry.** `POST /v3/order/status`, body `{ mid, orderId }`. Response:
  `resultInfo{ resultStatus: TXN_SUCCESS, resultCode: 01 }`, `txnAmount`, `txnDate`, `paymentMode`,
  **`bankTxnId` (= RRN)**, `bankName`, `gatewayName`.
- **(3) Settlement Detail — EOD.** `POST /merchant-settlement/v1/settlement/detail`, body
  `{ MID, utrProcessedStartTime, utrProcessedEndTime, pageNum, pageSize }` (dates `YYYY-MM-DD`).
  Response `settlementDetailList[]{ txnId, orderId, txnDate, txnAmount, settleAmount, **utr (= RRN)**,
  utrProcessedTime, paymentMode, bankName, mercUnqRefVal }`. `mercUnqRefVal` can carry a
  nozzle/attendant tag (e.g. `NOZZLE_1_ATTENDANT_KUMAR`). ⚠️ A different **JWT** variant
  (`/merchant-settlement/SettlementDetail`, §3.6) also exists — confirm which is enabled on the MID.

**Per-outlet config (collect & store; secrets encrypted):**
| Key | Description | Scope |
|---|---|---|
| `MID` | Paytm Merchant ID (e.g. `INTEGR7769…`) | station |
| `MERCHANT_KEY` | AES secret for checksum generation / verification | integration |
| `SOUNDBOX_DEVICE_ID` | Soundbox hardware id (per attendant island, if mapped) | terminal |
| `STATIC_QR_ID` / `POS_ID` | tag embedded in the dispenser QR sticker → auto-attendant attribution | terminal |
| webhook URL | our callback, registered in the Paytm Dashboard | integration |

### 8.2 PhonePe for Business — grounded (the outlet model)
Same shape as the others: **intra-shift = Webhook (S2S) + Check Status; EOD = Settlement recon.**
Raw spec + samples + verify code in **Appendix F (§14)**. ⚠️ Amounts are **paise** (`150000` = ₹1,500) → ÷100.

**Auth (all): X-VERIFY** = `SHA256(<data> + SALT_KEY) + "###" + SALT_INDEX`, where `<data>` is the
**endpoint path** (status APIs), the **base64 payload + path** (`/v1/transactions/details`), or the
**base64 `response`** (webhook). **Hosts:** UAT `https://mercury-uat.phonepe.com` · prod
`https://mercury-t2.phonepe.com` (or `https://api.phonepe.com/apis/hermes`).

- **(1) Webhook (S2S callback) — PRIMARY intra-shift.** PhonePe POSTs `{ "response": "<base64>" }`;
  verify `X-VERIFY == SHA256(response + SALT_KEY) + "###" + SALT_INDEX`, then base64-decode →
  `paymentState` (`COMPLETED`), `amount` (paise), `providerReferenceId`, `paymentModes[].utr` (= RRN).
- **(2) Check Transaction Status — enquiry.** `GET /v3/transaction/{merchantId}/{transactionId}/status`
  (X-VERIFY over the path). Response `data`: `amount` (paise), `paymentState`, `payResponseCode`,
  `providerReferenceId`, `paymentModes[]{ mode (e.g. UPI_QR), amount, utr (= RRN) }`.
- **(3) EDC/POS Status — PhonePe Android POS.** `POST /v1/edc/transaction/{merchantId}/{transactionId}/status`.
  Response: `storeId`, `terminalId`, `referenceNumber` (= RRN), `paymentMode` (`DQR`), `amount` (paise).
- **(4) Settlement recon — EOD.** `POST /v1/transactions/details` (§4) — window list + UTRs + refunds.

**Per-outlet config (collect & store; secrets encrypted):**
| Key | Description | Scope |
|---|---|---|
| `MERCHANT_ID` | PhonePe Merchant ID (e.g. `MERCHANTUAT` / live MID) | station |
| `SALT_KEY` | secret key for SHA-256 checksums | integration |
| `SALT_INDEX` | key index (typically `1`) | integration |
| `STORE_ID` / `TERMINAL_ID` | EDC/Soundbox → nozzle/pump mapping | terminal |
| webhook URL | our callback, registered with PhonePe | integration |

### 8.3 Pine Labs Plutus / Plural — **grounded (all three APIs)**
UPI via terminal-generated dynamic QR (POS/Soundbox); each payment logged under the **TID**. Raw
spec + samples + signature code preserved in **Appendix D (§12)**. ⚠️ Amounts are **rupee decimals**
(e.g. `1200.00`) — **not paise** (unlike PhonePe); normalize accordingly.

**Auth (all):** OAuth 2.0 — `POST /api/auth/v1/token` (`client_id` + `client_secret`) → Bearer JWT.
**Hosts:** UAT `https://pluraluat.v2.pinepg.in` · Prod `https://api.pluralpay.in`.

- **(1) Transaction Enquiry — PRIMARY intra-shift (per payment).**
  `GET /api/pay/v1/orders/reference/{merchant_order_reference}` (or `/api/pay/v1/orders/{order_id}`),
  Bearer. Response `data`: `order_id`, `merchant_order_reference`, `amount` (₹), `currency`,
  `status` (**`CHARGED`** = success), `payment_method`, `payment_details{ rrn, approval_code, tid,
  payer_vpa, transaction_timestamp }`.
- **(2) Webhook `payment.success` — PRIMARY intra-shift (real-time push).**
  Headers `webhook-id`, `webhook-timestamp` (unix s), `webhook-signature = v1,<base64 HMAC>`.
  Body `data`: `order_id`, `merchant_order_reference`, `amount` (₹), `status` (**`PROCESSED`**),
  `payment_method`, `rrn`, `tid`, `mid`, `created_at`. **Verify every webhook** —
  `signed = "{webhook-id}.{webhook-timestamp}.{raw_body}"`; HMAC-SHA256 with the base64-decoded
  Webhook Secret Key; base64; constant-time compare to the part after `v1,` (code in §12).
- **(3) Settlement / Batch Report — SECONDARY (EOD audit only).**
  `GET /api/settlements/v1/list?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&page=&per_page=`
  (**max 60-day** window), Bearer. Response `data[]` per settlement: `settlement_id`, `settled_date`,
  **`utr_number`**, `tid`, `mid`, `batch_number`, `programs[]`, `actual_transaction_amount`,
  `total_deduction_amount`, `net_settled_amount`, `total_transactions_count`, `transactions[]{
  transaction_id, order_id, rrn, approval_code, amount, payment_method, payment_time, status }`.
  **Data appears only after batch close** → use for post-shift/EOD audit + the bank `utr_number`,
  not the live shift sum.

**Per-outlet config (collect & store; secrets encrypted):**
| Key | Description | Scope |
|---|---|---|
| `MID` | Pine Labs Merchant ID | station |
| `STORE_ID` | Store / outlet id (multi-outlet accounts) | station |
| `CLIENT_ID` | OAuth client id | integration / station |
| `CLIENT_SECRET` | OAuth client secret | integration / station |
| `WEBHOOK_SECRET` | HMAC-SHA256 verification key | integration / station |
| `TID_MAPPINGS` | each EDC/Soundbox **TID → dispenser / nozzle island** | terminal |

**Design:** intra-shift → ingest **verified webhooks** (and/or poll **Transaction Enquiry**) keyed by
`merchant_order_reference` / `rrn`, sum for the shift window; at EOD reconcile the day's total
against the Settlement report's `net_settled_amount` + `utr_number`.

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

---

## 12. Appendix D — Pine Labs Plutus / Plural (UPI): raw spec & samples

_Preserved verbatim (docs unreachable here). Curated: §8.3. **Amounts are rupee decimals.**_

**Auth:** OAuth 2.0 — `POST /api/auth/v1/token` with `client_id` + `client_secret` → Bearer JWT.
**Hosts:** UAT `https://pluraluat.v2.pinepg.in` · Prod `https://api.pluralpay.in`.

### D.1 Settlement / Batch Report (EOD)
```
GET /api/settlements/v1/list?start_date=2026-08-25&end_date=2026-08-25&page=1&per_page=50 HTTP/1.1
Host: api.pluralpay.in
Authorization: Bearer <JWT_ACCESS_TOKEN>
Content-Type: application/json
```
```json
{
  "status": "SUCCESS",
  "data": [
    {
      "settlement_id": "SETTL_987654321",
      "settled_date": "2026-08-25T14:30:00+05:30",
      "utr_number": "UTR410092786849",
      "tid": "44019281",
      "mid": "10098234",
      "batch_number": "000142",
      "programs": ["UPI"],
      "actual_transaction_amount": 4500.00,
      "total_deduction_amount": 0.00,
      "net_settled_amount": 4500.00,
      "total_transactions_count": 5,
      "transactions": [
        {
          "transaction_id": "TXN_11223344",
          "order_id": "ORD_PUMP1_SHIFT1_01",
          "rrn": "423819002341",
          "approval_code": "APPR892",
          "amount": 1200.00,
          "payment_method": "UPI",
          "payment_time": "2026-08-25T10:15:22+05:30",
          "status": "PROCESSED"
        }
      ]
    }
  ]
}
```

### D.2 Transaction Enquiry
`GET /api/pay/v1/orders/reference/{merchant_order_reference}` (or `GET /api/pay/v1/orders/{order_id}`).
```
GET /api/pay/v1/orders/reference/FUEL_SHIFT_20260825_0042 HTTP/1.1
Host: api.pluralpay.in
Authorization: Bearer <JWT_ACCESS_TOKEN>
Content-Type: application/json
```
```json
{
  "status": "SUCCESS",
  "data": {
    "order_id": "PL_ORD_99182371",
    "merchant_order_reference": "FUEL_SHIFT_20260825_0042",
    "amount": 850.00,
    "currency": "INR",
    "status": "CHARGED",
    "payment_method": "UPI",
    "payment_details": {
      "rrn": "423819002341",
      "approval_code": "AP6712",
      "tid": "44019281",
      "payer_vpa": "customer@oksbi",
      "transaction_timestamp": "2026-08-25T11:02:18+05:30"
    }
  }
}
```

### D.3 Webhook (`payment.success`) + signature verification
Headers: `webhook-id`, `webhook-timestamp` (unix seconds), `webhook-signature: v1,<Base64_HMAC>`.
```json
{
  "event": "payment.success",
  "event_id": "EVT_88291039",
  "data": {
    "order_id": "PL_ORD_99182371",
    "merchant_order_reference": "FUEL_SHIFT_20260825_0042",
    "amount": 850.00,
    "currency": "INR",
    "status": "PROCESSED",
    "payment_method": "UPI",
    "rrn": "423819002341",
    "tid": "44019281",
    "mid": "10098234",
    "created_at": "2026-08-25T11:02:18+05:30"
  }
}
```
**Verification:** `signed_content = "{webhook-id}.{webhook-timestamp}.{raw_body}"`; base64-decode the
**Webhook Secret Key** → bytes; HMAC-SHA256; base64-encode; compare to the signature after `v1,`.
```python
import base64, hmac, hashlib

def verify_pine_signature(raw_body, webhook_id, timestamp, signature_header, secret_key):
    signed_content = f"{webhook_id}.{timestamp}.{raw_body}".encode('utf-8')
    secret_bytes = base64.b64decode(secret_key)
    computed = base64.b64encode(hmac.new(secret_bytes, signed_content, hashlib.sha256).digest()).decode('utf-8')
    received = signature_header.split("v1,")[1] if "v1," in signature_header else signature_header
    return hmac.compare_digest(computed, received)
```

---

## 13. Appendix E — Paytm for Business (UPI): raw spec & samples

_Preserved verbatim (docs unreachable here). Curated: §8.1. **Amounts are rupee decimals.**_

Paytm at fuel stations: **static QR stickers, Soundbox, EDC (Smart POS)** → Paytm Payment Engine.
Intra-shift = **Webhook** or **Transaction Status**; EOD = **Settlement API** (settled batches + bank UTRs).

**Environment:** Staging `https://securegw-stage.paytm.in` · Prod `https://securegw.paytm.in`.
**Auth:** request `head` includes a `signature` / `checksumHash` from the Paytm **Merchant Key**
(Paytm Checksum lib, AES-128 + SHA-256).

### E.1 Date-Range Batch Settlement (EOD) — `POST /merchant-settlement/v1/settlement/detail`
Request:
```json
{
  "head": { "version": "v1", "requestTimestamp": "1724580600", "channelId": "WEB", "checksumHash": "BASE64_GENERATED_CHECKSUM_HASH" },
  "body": { "MID": "INTEGR7769XXXXXXXXX", "utrProcessedStartTime": "2026-08-25", "utrProcessedEndTime": "2026-08-25", "pageNum": 1, "pageSize": 50 }
}
```
Response:
```json
{
  "head": { "responseTimestamp": "1724580605", "version": "v1", "signature": "SIGNATURE_HASH" },
  "body": {
    "status": "SUCCESS", "resultCode": "00000000", "totalCount": 2,
    "settlementDetailList": [
      { "txnId": "20260825111212800110168516600919244", "orderId": "FUEL_ORD_20260825_P1_01",
        "txnType": "TRANSACTION", "txnDate": "2026-08-25 10:14:22", "txnAmount": "1500.00",
        "settleAmount": "1500.00", "utr": "423819002341", "utrProcessedTime": "2026-08-25 14:00:00",
        "paymentMode": "UPI", "bankName": "SBI", "mercUnqRefVal": "NOZZLE_1_ATTENDANT_KUMAR" }
    ]
  }
}
```

### E.2 Transaction Status (enquiry by Order ID) — `POST /v3/order/status`
Request:
```json
{ "head": { "tokenType": "CHECKSUM", "signature": "BASE64_GENERATED_CHECKSUM" },
  "body": { "mid": "INTEGR7769XXXXXXXXX", "orderId": "FUEL_ORD_20260825_P1_01" } }
```
Response:
```json
{
  "head": { "responseTimestamp": "1724580710", "version": "v1", "signature": "SIGNATURE_HASH" },
  "body": {
    "resultInfo": { "resultStatus": "TXN_SUCCESS", "resultCode": "01", "resultMsg": "Txn Success" },
    "txnId": "20260825111212800110168516600919244", "orderId": "FUEL_ORD_20260825_P1_01",
    "txnAmount": "1500.00", "txnDate": "2026-08-25 10:14:22.0", "paymentMode": "UPI",
    "bankTxnId": "423819002341", "gatewayName": "HDFC", "bankName": "STATE BANK OF INDIA"
  }
}
```

### E.3 Webhook + signature verification
Configure the backend URL in the Paytm Dashboard. Sample payload:
```json
{
  "MID": "INTEGR7769XXXXXXXXX", "ORDERID": "FUEL_ORD_20260825_P1_01", "TXNAMOUNT": "1500.00",
  "CURRENCY": "INR", "TXNID": "20260825111212800110168516600919244", "BANKTXNID": "423819002341",
  "STATUS": "TXN_SUCCESS", "RESPCODE": "01", "RESPMSG": "Txn Success", "TXNDATE": "2026-08-25 10:14:22",
  "GATEWAYNAME": "UPI", "BANKNAME": "STATE BANK OF INDIA", "PAYMENTMODE": "UPI", "CHECKSUMHASH": "s9df8sdf...kjsdf8="
}
```
Verify with the official `paytmchecksum` SDK (npm / pip):
```javascript
const PaytmChecksum = require('paytmchecksum');
const paytmChecksum = req.body.CHECKSUMHASH;
delete req.body.CHECKSUMHASH;
const isVerifySignature = PaytmChecksum.verifySignatureByString(
  JSON.stringify(req.body), MERCHANT_KEY, paytmChecksum);
// if (isVerifySignature) -> clear attendant's claimed UPI amount, match bankTxnId (RRN)
```
```python
import PaytmChecksum
received_checksum = request_dict.pop('CHECKSUMHASH', None)
is_valid = PaytmChecksum.verifySignature(request_dict, MERCHANT_KEY, received_checksum)
# if is_valid: match request_dict['BANKTXNID'] with attendant-claimed RRN
```

### E.4 Per-outlet config
`MID` (station), `MERCHANT_KEY` (integration, AES secret), `SOUNDBOX_DEVICE_ID` (terminal),
`STATIC_QR_ID` / `POS_ID` (terminal — tag in dispenser QR sticker for auto-attendant attribution).

---

## 14. Appendix F — PhonePe for Business (UPI): raw spec & samples

_Preserved verbatim (docs unreachable here). Curated: §8.2. **Amounts in paise.**_

PhonePe at fuel stations: **Smart POS/EDC, POS Soundbox, static QR** → PhonePe Payment Engine.
Intra-shift = **S2S Webhook** or **Check Payment Status**; EOD = **Settlement recon / dashboard sync**.

**Environment:** UAT `https://mercury-uat.phonepe.com` · Prod `https://mercury-t2.phonepe.com`
(or `https://api.phonepe.com/apis/hermes`).
**Auth:** `X-VERIFY = SHA256(<data> + SALT_KEY) + "###" + SALT_INDEX`.

### F.1 Check Transaction Status — `GET /v3/transaction/{merchantId}/{transactionId}/status`
`X-VERIFY = SHA256(endpoint_path + SALT_KEY) + "###" + SALT_INDEX` (GET, no body).
```
GET /v3/transaction/MERCHANTUAT/FUEL_SHIFT_20260825_P1_01/status HTTP/1.1
Host: mercury-t2.phonepe.com
Content-Type: application/json
X-VERIFY: 9f82c49b0124...f003a###1
```
```json
{
  "success": true, "code": "PAYMENT_SUCCESS", "message": "Your payment is successful.",
  "data": {
    "merchantId": "MERCHANTUAT", "transactionId": "FUEL_SHIFT_20260825_P1_01",
    "providerReferenceId": "T260825141528918237190", "amount": 150000,
    "paymentState": "COMPLETED", "payResponseCode": "SUCCESS",
    "paymentModes": [ { "mode": "UPI_QR", "amount": 150000, "utr": "423819002341" } ]
  }
}
```
(`amount` in paise: `150000` = ₹1,500.00.)

### F.2 EDC / POS Status — `POST /v1/edc/transaction/{merchantId}/{transactionId}/status`
`X-VERIFY = SHA256("/v1/edc/transaction/{merchantId}/{transactionId}/status" + SALT_KEY) + "###" + SALT_INDEX`.
```json
{
  "success": true, "code": "SUCCESS", "message": "Your request has been successfully completed.",
  "data": {
    "merchantId": "MERCHANTUAT", "storeId": "STORE_PUMP_MAIN", "terminalId": "EDC_TERM_01",
    "orderId": "FUEL_MRCH_124", "transactionId": "TXN_20260825_001",
    "referenceNumber": "423819002341", "paymentMode": "DQR", "amount": 120000
  }
}
```

### F.3 Webhook (S2S callback) + verification
PhonePe POSTs `{ "response": "<base64>" }` with an `X-VERIFY` header.
Verify, then base64-decode the `response` to read `paymentState`, `amount`, `paymentModes[].utr` (RRN).
```python
import base64, json, hashlib
def verify_phonepe_webhook(base64_response, received_x_verify, salt_key, salt_index):
    calculated_hash = hashlib.sha256(f"{base64_response}{salt_key}".encode('utf-8')).hexdigest()
    calculated_x_verify = f"{calculated_hash}###{salt_index}"
    if calculated_x_verify == received_x_verify:
        return json.loads(base64.b64decode(base64_response).decode('utf-8'))
    raise ValueError("Invalid Signature: Unauthorized Webhook Request")
```

### F.4 Per-outlet config
`MERCHANT_ID` (station), `SALT_KEY` (integration), `SALT_INDEX` (integration, typically `1`),
`STORE_ID` / `TERMINAL_ID` (terminal — EDC/Soundbox → nozzle mapping).
