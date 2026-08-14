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

## 4. PhonePe

> **Research note (accuracy).** `developer.phonepe.com`, `cms.phonepe.com` and every
> third-party mirror are **blocked by this environment's egress proxy**, so the facts
> below were assembled from the **search-result summaries** of PhonePe's official pages
> (developer docs + merchant-help), not from a live read of the page bodies. Treat the
> **shapes and field names as high-confidence but not byte-verified**; every item I could
> not pin to an exact path/param is marked **TO CONFIRM** and must be checked against the
> live doc (URLs in Sources) before we code against it. Nothing here is invented — a
> gap is flagged, not filled.

> **Correction to §2 for PhonePe (auth).** §2 implicitly assumes a salt-key/checksum
> signature for both gateways. That holds for PhonePe's **legacy v1** APIs (the
> **X-VERIFY** salt-key scheme) but **not** for the **current v2 "Standard Checkout"**
> stack, which has moved to **OAuth2 client-credentials** (an `O-Bearer` access token),
> **no salt key**. So "merchantId + Salt Key + Salt Index" is the *v1* credential set;
> the *v2* set is **client_id + client_secret + client_version**. Both are covered below.

Unlike Paytm — whose Settlement APIs are **payout-centric** (pull a payout, enumerate its
transactions) — PhonePe's reconciliation APIs are **transaction-centric**: you look up a
**single transaction** and read back the settlement (UTR + settled amount + date) it landed
in. The **payout-level artifact** (one row per bank credit) is PhonePe's **Settlement
Report**, which today is a **dashboard/app download**, not a clearly-documented date-range
bulk API. That inversion drives our design (see §4.8): for PhonePe we iterate over Pumpini's
recorded PhonePe sales and ask "which UTR settled this order," rather than pulling a payout
and matching down.

| API | Gen | Auth | Granularity | Keyed by | Fit |
|---|---|---|---|---|---|
| **Transaction Settlement Recon API** | v2 | OAuth `O-Bearer` | per-transaction, incl. settlement (UTR/amount/date) | merchant order / txn id | ★ primary (new integrations) |
| **Comprehensive Transaction Recon API** | v1 | X-VERIFY salt key | per-transaction, incl. `transactionLevelSettlement` | `merchantId` + `merchantTransactionId` | fallback (legacy/offline stack) |
| **Settlement Report** (download) | — | dashboard login | **payout-level**, all txns + refunds, net of fees | settlement / UTR | payout-level truth; **not confirmed as an API** |

### 4.1 Credentials required (per outlet)

**v2 (current — Standard Checkout / OAuth):**
- **`merchantId`** — merchant identifier, created at onboarding.
- **`client_id` + `client_secret` + `client_version`** — OAuth client-credentials, read
  from the **PhonePe Business Dashboard → Developer Settings**. `client_version` is `1` in
  the sandbox examples. These mint the `O-Bearer` token; there is **no salt key** in v2.

**v1 (legacy — X-VERIFY):**
- **`merchantId`**, **Salt Key**, **Salt Index** — the Salt Key + Index are shared by
  PhonePe for that MID and drive the `X-VERIFY` checksum. The Salt Index is a small
  integer (e.g. `1`) selecting which key is in force (supports key rotation).

- **Entitlement / access** — recon/settlement API access is tied to the live merchant
  account; confirm PhonePe has enabled it for the MID. **TO CONFIRM** whether recon APIs
  need explicit enablement or ship with PG access.
- All secrets **server-side only**, stored **per station, encrypted** (per §2).

### 4.2 Auth (differs by generation)

- **v2 → OAuth2 client-credentials.**
  `POST` to the token endpoint with `client_id`, `client_version`, `client_secret`,
  `grant_type=client_credentials`.
  - Sandbox token endpoint (confirmed in search):
    `https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token`.
  - Production token endpoint: **TO CONFIRM** — commonly documented as
    `https://api.phonepe.com/apis/identity-manager/v1/oauth/token`; verify the exact prod
    host/path against the live Authorization page.
  - Response: `access_token`, `encrypted_access_token`, `issued_at`, `expires_at`,
    `session_expires_at`, `token_type` = **`O-Bearer`**. Cache the token and refresh on
    `expires_at`.
  - Every subsequent call carries **`Authorization: O-Bearer <access_token>`** (note the
    `O-Bearer` prefix, not plain `Bearer`).

- **v1 → `X-VERIFY` salt-key checksum.**
  Header value = `SHA256(base64Payload + apiPath + saltKey) + "###" + saltIndex`.
  For **GET** endpoints (e.g. status/recon lookups) there is **no request body**, so the
  base64 payload term drops out: `SHA256(apiPath + saltKey) + "###" + saltIndex`. Computed
  **server-side only**. A wrong/mistyped checksum returns **`AUTHORIZATION_FAILED`**
  ("Checksum sent in header was not valid"). **TO CONFIRM** the exact `apiPath` string used
  for each recon endpoint (it is the request path, but confirm whether query string is
  included).

### 4.3 API 1 — Transaction Settlement Recon API (v2)  *(PRIMARY for new integrations)*
- **Doc:** `developer.phonepe.com/v2/reference/transaction-settlement-recon-api`.
- **Auth:** OAuth `O-Bearer` (§4.2). **Environment:** production for real settled data;
  sandbox exists but does not return real payouts (per §2 assumption 2 — **TO CONFIRM** for
  PhonePe specifically).
- **Granularity:** per-transaction. You supply a transaction/order reference and read back
  its settlement.
- **Response (field names from search summaries — TO CONFIRM exact casing):** the
  transaction (`merchantId`, `transactionId` / `merchantOrderId`, `amount`, `paymentState`)
  plus a **`transactionLevelSettlement`** block carrying the reconciliation keys:
  - **`status`** — settlement state (e.g. `SETTLED`),
  - **`utr`** — bank UTR of the payout (matches the bank-statement credit),
  - **`settlementAmount`** — amount settled for this transaction (net),
  - **`settlementDate`** — when it settled (the payout date).
- ⚠️ **TO CONFIRM (blocks coding):**
  - **Request shape** — exact host/path and method, and **whether it accepts a date range
    or only a single order/txn id**. The name and the sibling v1 API both point to
    **single-transaction** lookups; a bulk/date-range mode is **not confirmed**.
  - **Fee/GST breakup** — whether the API returns fee/commission + IGST/CGST/SGST (the
    downloadable report does; the recon API may return only `settlementAmount`). **TO
    CONFIRM.**
  - **Refunds/chargebacks** — how a refunded/charged-back txn appears (separate line, sign,
    or a `type`). **TO CONFIRM.**
  - **Pagination / date-range limits / retention window** — **TO CONFIRM** (unknown).

### 4.4 API 2 — Comprehensive Transaction Recon API (v1)  *(FALLBACK — legacy/offline stack)*
- **Doc:** `developer.phonepe.com/offline-integration/response-capturing-api/comprehensive-transaction-recon-api`.
- **Auth:** **X-VERIFY** salt key (§4.2). **Host:** the v1 `hermes` stack —
  prod `https://api.phonepe.com/apis/hermes/...`, sandbox
  `https://api.preprod.phonepe.com/apis/hermes/...` (the sibling status API is
  `.../hermes/pg/v1/status/{merchantId}/{merchantTransactionId}`; the exact recon path is
  **TO CONFIRM**).
- **Keyed by:** `merchantId` + `merchantTransactionId` — **one transaction per call**
  (`"auth":"required"`).
- **Response (from search summaries):** `merchantId`, `transactionId`,
  `providerReferenceId`, `amount`, `merchantOrderId`, `paymentState`, `payResponseCode`,
  and a **`transactionLevelSettlement`** → **`transactionSettlementDetails[]`** array whose
  entries carry **`UTR`**, settlement **status**, settlement **date** (`settlementDate`),
  and **`settlementAmount`**.
- **Reconciliation keys:** `merchantTransactionId` / `merchantOrderId` /
  `providerReferenceId` (to match the Pumpini sale) and **`UTR` + `settlementAmount` +
  `settlementDate`** (to match the bank credit).
- **When to prefer this over §4.3:** if the outlet is on the older PG/offline stack and
  holds a Salt Key rather than OAuth client creds. Same transaction-centric model as v2.

### 4.5 The Settlement Report  *(payout-level truth — download, not confirmed as an API)*
This is PhonePe's analogue of a Paytm payout: **one settlement = one bank credit**, all its
transactions and post-settlement refunds, net of charges.
- **Contents (from PhonePe merchant-help):** per transaction — **amount**, **Fee**, **IGST /
  CGST / SGST** (fees/taxes shown as **negative** values), and the **settled/net amount**,
  computed as **`Amount + Fee + IGST + CGST + SGST`**. Identifiers: **Merchant Reference
  ID**, **PhonePe Reference ID**, and **Bank Reference ID = the UTR**. Includes **payments
  and refunds**, so gross reconciles to the net actually credited.
- **Access:** generated/downloaded from the **PhonePe Business app / website** (Settlements
  tab → per-settlement report); a report for a specific period can be requested.
- ⚠️ **TO CONFIRM (the key PhonePe gap vs Paytm):** whether this payout-level report is
  exposed as a **programmatic date-range API** (or SFTP/scheduled file). PhonePe's public
  developer docs surface **transaction-level recon APIs** (§4.3/§4.4), not an obvious
  **payout-level bulk API**. If none exists, our payout-level reconciliation for PhonePe may
  have to be **seeded from the report file** (manual/scheduled) while the recon API supplies
  the per-transaction UTR linkage. **Confirm with PhonePe / the account manager.**

### 4.6 Weekend / holiday behaviour  *(answers the standing question — consistent with §2.7)*
PhonePe settles on a **T+1** basis (offline **and** online) **except bank holidays: 2nd and
4th Saturdays, Sundays, and government holidays**. On those days **no payout is released**, so
there is **no settlement/UTR to reconcile** for that date; those sales roll into the **next
business-day payout** (visible by `settlementDate` / UTR). The exact cycle can vary by
merchant/business model and is fixed at commercial onboarding — **confirm each outlet's cycle
at signup**. Same-day weekend *transaction* visibility (not settlement) comes from the
transaction **status** API, not a settlement API — out of scope here, per §2.

### 4.7 Error codes  *(indicative — full list on the Error Codes page)*
| code | meaning |
|---|---|
| `SUCCESS` / `PAYMENT_SUCCESS` | request OK / payment successful |
| `BAD_REQUEST` | a mandatory parameter was missing/invalid |
| `AUTHORIZATION_FAILED` | **checksum (X-VERIFY) invalid** — v1 signing error |
| `INVALID_TRANSACTION_ID` | transaction id was duplicate/invalid |
| `PAYMENT_ERROR` | payment failed (detail in `code`) |
| `INTERNAL_SERVER_ERROR` | PhonePe-side error — retry with backoff |

v2 also returns standard HTTP status codes plus a JSON `{ code, message }`. A dedicated
**Error Codes** page (`developer.phonepe.com/payment-gateway/error-codes`) lists the full
set including a **Common Errors** subsection — **TO CONFIRM** the recon-specific codes
(e.g. a "transaction not settled yet" / "not found" state) from that page.

### 4.8 How it fits our reconciliation (implementation notes)
- **Model inversion vs Paytm.** PhonePe is **transaction-first**. Iterate over Pumpini's
  recorded **PhonePe sales** for the day and call the recon API **per order** to fetch its
  `utr` + `settlementAmount` + `settlementDate`; **group by `utr`** to reconstruct a payout,
  then match that group's total to the **bank credit**. (Paytm hands you the payout already
  grouped; for PhonePe we build the group.)
- **Payout-level cross-check.** Because a per-transaction sum can miss txns Pumpini didn't
  record, reconcile our reconstructed payout total against the **Settlement Report's** net
  for that UTR (once we confirm how to obtain the report — §4.5). The report is the
  authority on **fees + IGST/CGST/SGST**; net = `Amount + Fee + IGST + CGST + SGST`.
- **Auth per outlet.** Branch on the outlet's generation: **v2 → mint/cache the `O-Bearer`
  token** (refresh on `expires_at`); **v1 → compute `X-VERIFY`** per call. Both server-side,
  keys per-station encrypted.
- **Weekend/holiday.** Don't expect a payout on 2nd/4th Sat, Sun, or govt holidays; expect
  those sales under the next business-day UTR.
- **Fixture-first (per §2).** One live recon call per generation → save the raw JSON →
  build the parser + `utr`-grouping matcher against the fixture in staging. Only the thin
  fetch layer touches production.
- **Before coding, resolve the TO-CONFIRMs:** (1) does a **payout-level / date-range** API
  exist, or is the report a download only? (2) exact **v2 recon request** (date range vs
  single id) and **prod hosts/paths**; (3) **fee/GST + refund** representation in the recon
  API; (4) pagination/retention limits.

### Sources
- PhonePe — Settlements (developer docs): `https://developer.phonepe.com/docs/settlements`
- PhonePe — Transaction Settlement Recon API (v2): `https://developer.phonepe.com/v2/reference/transaction-settlement-recon-api`
- PhonePe — Comprehensive Transaction Recon API (offline/v1): `https://developer.phonepe.com/offline-integration/response-capturing-api/comprehensive-transaction-recon-api`
- PhonePe — Calculating X-VERIFY: `https://developer.phonepe.com/switch/documentation/calculating-x-verify`
- PhonePe — Authorization (v2 OAuth / `O-Bearer`): `https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/authorization`
- PhonePe — Get Access Token (OAuth token endpoint): `https://developer.phonepe.com/v4/reference/get-auth-token`
- PhonePe — Check Status API (v1 hermes host/path reference): `https://developer.phonepe.com/v4/reference/check-status-api`
- PhonePe — Error Codes / Common Errors: `https://developer.phonepe.com/payment-gateway/error-codes` , `.../error-codes/common-errors`
- PhonePe merchant-help — reading the Settlement Report (fields, net = Amount+Fee+IGST+CGST+SGST, UTR = Bank Reference ID): `https://cms.phonepe.com/en/mx/merchant-help/settlements/know-more-about-settlements/settlement-report/how-do-i-read-and-understand-my-settlement-report/`
- PhonePe merchant-help — download/request settlement report for a period: `https://cms.phonepe.com/en/mx/merchant-help/settlements/settlement-report/how-do-i-view-or-download-my-settlement-report/`

_(Note: pages could not be fetched live in this environment — egress-blocked — so exact
paths/params/casing are TO CONFIRM against the live docs above.)_

---

## 5. Status & next steps

**Paytm — PRIMARY (GTM):**
- [x] APIs frozen: **Order List** (shift-window sum) + **Transaction Status** (per-order).
- [ ] Copy the last two page details: **Order List response fields** ("Orders+") +
      **endpoint URL**.
- [ ] Obtain prod **MID + Merchant Key** for one outlet (checksum auth) and confirm
      **which `paymentMode`s** count as the attendant's "UPI" (`UPI` only, or `UPI+PPI`).
- [ ] Confirm Order List returns **QR/Soundbox** collections, not just native-flow orders.

**PhonePe — SECONDARY (not on the critical path; still open):**
- [ ] **Not frozen.** §4 is a *research draft* from search snippets (PhonePe docs were
      egress-blocked), all marked TO CONFIRM. To close it, do the Paytm drill: paste
      PhonePe's **transaction-status** API and any **transaction-list-by-date** API.
- [ ] Resolve the key gap: does PhonePe expose a **time-window transaction list** (the
      Order-List equivalent), or only per-transaction lookups + a download-only report?
- [ ] Then obtain prod creds per generation (v2 OAuth `client_id/secret/version`, or v1
      `merchantId`+Salt Key+Index).

**Both:**
- [ ] One **live call each** → capture JSON **fixtures** (staging where available).
- [ ] Design the **per-station encrypted credential store** + the verification/matcher.
- [ ] Build the **fetch + sum/compare** layer (staging, against fixtures) before prod.
