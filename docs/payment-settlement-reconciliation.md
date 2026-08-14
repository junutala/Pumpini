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

_Grounded in a real recon request/response sample. This is the PhonePe API we rely on for
shift verification. Chosen over the QR Transaction List because its per-transaction state is
**authoritative**, it **nets refunds**, and it carries the settlement **UTR** — whereas the
QR List flags its own `paymentState` as unreliable and shows no refunds/settlement (kept only
as a lighter real-time note in §4.5)._

Mechanism (same as Paytm Part A): pull the recon API for the shift window, sum the
`COMPLETED` amounts (**paise → ÷100**), subtract nested refunds, compare to the attendant's
figure. Transaction-time keyed → works any day.

### 4.1 Auth
- **X-VERIFY:** `SHA256(base64(payload) + apiPath + saltKey) + "###" + saltIndex`.
- Header **`X-PROVIDER-ID`** when a merchant has multiple MIDs.
- Per-outlet **Salt Key + Salt Index** as tenant secrets (server-side only).
- Body = the base64 of the JSON payload, wrapped `{ "request": "<base64>" }`;
  `Content-Type: application/json`.

### 4.2 Endpoint
- **Host (confirmed from the QR API):** prod `https://mercury-t2.phonepe.com`, UAT
  `https://mercury-uat.phonepe.com/enterprise-sandbox`.
- **Exact recon path — TO CONFIRM** with PhonePe (a sibling of `/v3/qr/transaction/list`
  under the same host).

### 4.3 Request (JSON, before base64)
| Field | Req | Notes |
|---|---|---|
| `merchantId` | ✔ | the outlet's PhonePe MID |
| `startTimestamp` / `endTimestamp` | ✔ | **EPOCH seconds** — the shift window (start < end) |
| `size` | ✔ | page size |
| `searchAfter` | – | cursor; `{}` on first call, echoed back for the next page |

```json
{ "merchantId": "MERCHANTPROD", "size": 10,
  "startTimestamp": 1739301380, "endTimestamp": 1739387780, "searchAfter": {} }
```

### 4.4 Response (grounded — real sample)
Top level: `success`, `code`, `message`, `data.transactionDetails[]`, `data.totalResult`,
`data.searchAfter` (cursor).

**Per transaction:**
- `transactionId`, `merchantOrderId`, `providerReferenceId`
- **`amount`** — **paise** (`4200` = ₹42.00) → ÷100
- **`paymentState`** — sum **`COMPLETED`**; `payResponseCode` = SUCCESS (treat as a string)
- **Attribution:** `storeId`, `terminalId` (also under `transactionContext`)
- `transactionDate` — **epoch millis**
- `transactionLevelSettlement` → `transactionSettlementDetails[]`: **`utr`**, `status`
  (`SETTLED`), `settlementDate`, `settlementAmount`
- `instrumentLevelSettlementDetails` (e.g. `ACCOUNT`: `totalAmount`, `settlementAmount`, `utr`)
- **`refundTransactionDetails[]`** — `amount` (paise), `transactionType=REFUND`,
  `originalTransactionId` → **net = amount − Σ refunds**

### 4.5 The verification design (PhonePe)
1. Call recon for the outlet's `merchantId`, `startTimestamp`/`endTimestamp` = shift window
   (epoch **seconds**); page with `size` + `searchAfter` until the cursor is exhausted.
2. Keep `paymentState = COMPLETED`; **sum `amount`/100**; **subtract** each row's
   `refundTransactionDetails`.
3. Compare to **₹XXXX** → **confirmed**, or **flag** the difference.

- **Attribution (pump pivot) + honest limit:** `terminalId` (and `storeId`) per txn → pump →
  its nozzles → the attendant. Per **pump, not per nozzle**: one attendant on a pump → clean
  per-attendant number; **shared pump → pump-level only, never an invented split**;
  **single-VPA outlet → shift-total match only**. Guardrail against a wrong accusation.
- **Weekend-proof:** keys on transaction time, not payout.
- **Lighter alternative (not the source of truth):** the **QR Transaction List**
  (`/v3/qr/transaction/list`, endpoints confirmed UAT `.../enterprise-sandbox/...` + prod
  `mercury-t2.phonepe.com/...`) gives a real-time per-store list, but PhonePe says to ignore
  its `paymentState` and it has no refunds/settlement — use it only for a live glance.

### 4.6 Phase-2 lever (later, optional)
`/v3/qr/init` takes a per-request **`x-callback-url`** + **`invoiceDetails`** — the real-time
per-sale binding lever if we ever attack personal-QR diversion. Not needed for the sum-based
verification.

### 4.7 Open items (small)
- Exact recon **endpoint path** (host is known).
- The full **`paymentState` set** (is `COMPLETED` the only success state?).
- Per-outlet **`merchantId` + `storeId`** (+ `terminalId` per pump) and **Salt Key + Salt
  Index** (prod creds).

---

## 5. Status & next steps

**Paytm — PRIMARY (GTM):**
- [x] APIs frozen: **Order List** (shift-window sum) + **Transaction Status** (per-order).
- [ ] Copy the last two page details: **Order List response fields** ("Orders+") +
      **endpoint URL**.
- [ ] Obtain prod **MID + Merchant Key** for one outlet (checksum auth) and confirm
      **which `paymentMode`s** count as the attendant's "UPI" (`UPI` only, or `UPI+PPI`).
- [ ] Confirm Order List returns **QR/Soundbox** collections, not just native-flow orders.

**PhonePe — FROZEN (Comprehensive Transaction Recon API, §4):**
- [x] **QR Transaction List** (§4.2) — endpoints **confirmed** (UAT
      `.../enterprise-sandbox/v3/qr/transaction/list`, prod
      `mercury-t2.phonepe.com/v3/qr/transaction/list`); per-store list, `amount` paise ÷100,
      `storeId`/`terminalId` attribution, X-VERIFY auth. The primary shift-sum API.
- [x] **Comprehensive Txn Recon** (§4.3) — settlement (UTR) + nested refunds + attribution,
      grounded on a real sample; endpoint **path/prod host still TBD**.
- [x] Key gap resolved: PhonePe **does** expose a time-window transaction list.
- [ ] Confirm: QR-List **pagination** across a full shift; Comprehensive-Recon **path/host**.
- [ ] Obtain per outlet: **`merchantId` + `storeId`** (+ `terminalId` per pump) and
      **Salt Key + Salt Index** (X-VERIFY, prod).

**Both:**
- [ ] One **live call each** → capture JSON **fixtures** (staging where available).
- [ ] Design the **per-station encrypted credential store** + the verification/matcher.
- [ ] Build the **fetch + sum/compare** layer (staging, against fixtures) before prod.


---

## 6. Deployment strategy — prove outside first

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

## 7. What we need from the customer (per gateway)

To run the outside-first test (§6), we need the following. Keys are secrets — have them sent
directly into the secure store, **not** pasted into chat or email where avoidable.

### 7.1 Paytm — to test first (per outlet)
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

### 7.2 PhonePe — next (per outlet)
- **`merchantId`** and **`storeId`** (and **`terminalId`** per pump, if terminals are used).
- **Salt Key + Salt Index** (for the X-VERIFY signature).
- The **exact Comprehensive Transaction Recon endpoint path** (prod host
  `mercury-t2.phonepe.com`) and confirmation the **recon API is enabled** for the merchant.

**Exact questions to ask the PhonePe executive** (copy-paste):
1. "Please share our **`merchantId`** and **`storeId`** (and **`terminalId`** per device, if
   we use terminals) for the outlet *<outlet name>*."
2. "Please share the **Salt Key** and **Salt Index** for X-VERIFY on this merchant."
3. "Please **enable the Comprehensive Transaction Recon API** and share its **exact endpoint
   path** on the production host `mercury-t2.phonepe.com`."
4. "Does the recon response return the **`storeId`/`terminalId`, settlement `utr`, and
   `refundTransactionDetails`** per transaction for our account? (We rely on these.)"
