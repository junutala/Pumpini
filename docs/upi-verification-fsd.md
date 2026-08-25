# Functional Specification — Digital-payment (UPI + card) verification at shift settlement

_Draft for review — no code yet. Companion to the API reference in
`docs/payment-settlement-reconciliation.md` (endpoints, auth, samples, annexures A–E).
This doc specifies **what we build**; that doc specifies **the providers we call**._

---

## 1. Purpose & scope

**Goal.** When an attendant closes his shift and declares "I collected **₹XXXX by UPI**,"
Pumpini **independently verifies** that ₹XXXX of UPI was actually collected for that outlet
during the shift — **on any day, weekends included** — and flags any variance.

**In scope (v1):** **digital-tender** collections — **UPI *and* card** — through **Paytm**,
**PhonePe**, and **Pine Labs / Plural** (static QR, Soundbox, EDC). The same devices and the
same APIs carry both, tagged by `payment_method` (UPI / CARD); **cards get the same treatment as
UPI — the fraud risk is identical and we close it.** Read-only: we fetch/receive transaction data
and compare; **we never move money or write to money tables.**
> ⚠️ **HP / fleet card (D6):** in scope, but confirm whether it settles through the **same EDC
> acquirer** (then it's covered for free) or a **separate OMC / fleet-card switch** (then it's its
> own source/adapter). Do not assume — check on the ground.

**Out of scope (v1):** **GPay for Business** (a collection SDK, not a recon
API — only relevant with a dedicated GPay VPA); bank-payout/settlement reconciliation (a
**secondary, EOD** capability kept for later — §11).

---

## 2. Objective & non-goals

- **Objective:** a per-shift, per-attendant (where attributable) **UPI figure we can stand
  behind**, matched against the attendant's declaration, available intra-shift.
- **Non-goal:** replacing the gateway's own dashboards, or bank reconciliation (that's the
  secondary EOD path). This is *transaction-time* verification, not *payout-time*.
- **Completes the tender picture:** cash (denominations) + **UPI + card** (PSP/EDC) + credit
  (Pumpini's own) = the whole shift. The only non-instant bucket left is **credit customers**,
  already tracked in Pumpini; a **WhatsApp-notification** track (adjacent, out of scope here)
  closes that loop.

---

## 3. Actors & primary flow

**Actors:** Attendant (declares), Manager/Owner (reviews), the PSP switch (pushes/serves data),
Pumpini backend (ingests, verifies), Superadmin/Owner (configures providers per outlet).

**Primary flow (happy path):**
1. Through the shift, each UPI payment is **pushed to Pumpini in real time** by the PSP webhook
   and stored (verified signature) in a unified transactions table.
2. At settlement, the attendant declares his UPI total (existing settlement screen).
3. Pumpini **sums the shift window's verified UPI** for that outlet (attributed to the attendant
   where possible), and shows **declared vs verified + variance**.
4. Manager/owner sees the result; drill-down lists the transactions (RRN, amount, time, TID).

**Fallbacks:** if a webhook was missed, **Transaction Status / Enquiry** (by order ref) fills
gaps on demand; the **Settlement/Batch API** provides an EOD audit + bank UTRs (§11).

---

## 4. Architecture (per `payment-settlement-reconciliation.md` §5)

- **PSP-agnostic core** — one normalized model + all the verification logic; knows nothing
  about a specific PSP.
- **Per-PSP adapters** — Paytm / PhonePe / Pine Labs. Each: verifies a webhook signature,
  normalizes a payload/response, signs an outbound request, and maps raw → normalized.
- **Per-outlet config** — an outlet runs **one or more `psp_sources`** (hybrid is normal:
  Pine Labs dynamic QR + static Paytm/PhonePe stickers). The engine **unifies all sources**
  and de-dups/matches by **UPI RRN**.
- **Build once per PSP; onboard new outlets by config only** (no code, no deploy).

### 4.1 Normalized transaction model
```
NormalizedTxn {
  provider        // 'paytm' | 'phonepe' | 'pinelabs'
  station_id
  provider_txn_id // gateway's txn id
  order_ref       // merchant_order_reference / orderId (nullable for static QR)
  rrn             // UPI RRN  -> the cross-provider unique/match key
  tid             // terminal / device id (nullable)
  amount          // NUMERIC rupees (PhonePe paise ÷100; Paytm/PineLabs already rupees)
  status          // 'success' | 'pending' | 'refund' | 'failed'
  payment_mode    // 'upi' | 'card' | 'wallet' | ...   (tender; card carries network/last4 in raw)
  txn_time        // timestamptz
  raw             // original payload (jsonb, audit)
  source          // 'webhook' | 'enquiry' | 'settlement'
}
```

---

## 5. Providers — how each maps (from the API doc)

| Provider | Intra-shift (primary) | Enquiry (fallback) | EOD audit | Auth | Amount |
|---|---|---|---|---|---|
| **Paytm** | Webhook (`TXN_SUCCESS`) | `POST /v3/order/status` | `/merchant-settlement/v1/settlement/detail` | checksum (Merchant Key) | ₹ |
| **PhonePe** | **Webhook (S2S)** | `GET /v3/transaction/.../status` | `/v1/transactions/details` | X-VERIFY (salt) | **paise ÷100** |
| **Pine Labs** | Webhook (`payment.success`) | `/api/pay/v1/orders/reference/{ref}` | `/api/settlements/v1/list` | OAuth Bearer / HMAC webhook | ₹ |

> ✅ **All three providers push a real-time webhook** (Paytm, PhonePe S2S, Pine Labs). The core
> ingests on webhook, with **Check-Status / Enquiry** as the gap-filler and the **Settlement API**
> for EOD audit — same normalized model for all.
>
> **Cards:** the same EDC / settlement APIs return card transactions too (tagged
> `payment_method = CARD`) — we simply don't filter them out. Intra-shift uses the **EDC
> txn / webhook** (approval + RRN + gross amount); note card **settlement** is typically **T+1 and
> net of MDR**, so use the settled figure only for EOD bank recon, never against the gross swipe tally.

---

## 6. Data model (new tables — all station-scoped, RLS)

1. **`psp_sources`** — a provider instance configured on an outlet.
   `id, station_id, provider, environment('uat'|'prod'), is_active,
    credentials_encrypted(jsonb), created_at, updated_at`.
   Credentials per provider: Paytm `{mid, merchant_key}`; PhonePe `{merchant_id, salt_key,
   salt_index}`; Pine Labs `{mid, store_id, client_id, client_secret, webhook_secret}`.
2. **`psp_terminal_map`** — attribution.
   `id, station_id, provider, terminal_ref(tid/qr_id/soundbox_id), pump_id, nozzle_id?(nullable)`.
3. **`psp_transactions`** — the unified ingested stream.
   `id, station_id, provider, provider_txn_id, order_ref, rrn, tid, amount, status,
    payment_mode, txn_time, source, raw(jsonb), received_at`.
   **Dedup key:** `(provider, provider_txn_id)` unique; `rrn` indexed for matching.
4. **`psp_webhook_events`** (idempotency) — `id, provider, event_id/webhook_id, received_at`
   unique on `(provider, event_id)` so a re-delivered webhook is a no-op.
5. *(optional)* **`psp_verifications`** — a computed snapshot per (shift, attendant):
   `declared_amount, verified_amount, variance, status, computed_at`. May be computed on the fly.

**RLS:** every table `FOR ALL USING (station_id IN (SELECT my_stations())) WITH CHECK (same)`
(shipped in the same DDL block — house rule). Superadmin config runs on the BYPASSRLS role.
**Secrets:** `credentials_encrypted` is app-layer encrypted with a key from Railway env
(never plaintext in the DB or logs). **Decision D1 (§13).**

---

## 7. Adapter contract

```
interface PspAdapter {
  verifyWebhook(rawBody, headers, secret) -> bool          // signature check
  normalizeWebhook(payload, station_id)   -> NormalizedTxn
  fetchStatus({orderRef|orderId}, cfg)    -> NormalizedTxn  // enquiry
  fetchWindow({from, to}, cfg)            -> NormalizedTxn[] // EOD/gap-fill window (PhonePe /v1/transactions/details; Pine Labs/Paytm settlement)
  signRequest(body, cfg)                  -> headers/body    // outbound auth
}
```
One writer per concern; all outbound signing server-side. Adapters live in
`backend/src/services/psp/<provider>.js`; the registry resolves by `provider`.

---

## 8. Webhook receiver

- **Route:** `POST /api/psp/webhook/:provider` — **public** (PSPs send no JWT), but **every
  request's signature is verified** by the provider adapter before anything is trusted.
  (This is the one legitimate unauthenticated inbound route; it authenticates by signature.)
- **Tenant resolution:** derive `station_id` from the payload's `MID`/`merchantId`/`tid` via
  `psp_sources` / `psp_terminal_map`. Reject if it resolves to no station.
- **Idempotent:** insert into `psp_webhook_events` first (unique) → ignore duplicates.
- **Store:** upsert `psp_transactions` on `(provider, provider_txn_id)`.
- **Fast & safe:** verify → store → `200` quickly; never block; never 5xx on a duplicate.
- **Replay guard:** reject stale timestamps outside a tolerance window.
- **Signature schemes (from the API doc):** Paytm `paytmchecksum.verifySignatureByString`;
  Pine Labs `HMAC-SHA256(base64-secret, "{id}.{ts}.{body}")` vs `v1,<b64>`; PhonePe X-VERIFY (if a
  callback is enabled).

---

## 9. Verification logic (the core)

Given `(station_id, window[from,to], optional attendant_id)`:
1. Pull the station's transactions where `txn_time ∈ window` and `status='success'`,
   **grouped by tender** (`payment_mode ∈ {upi, card[, wallet per policy]}`), across **all** the
   outlet's sources.
2. **De-dup** by `rrn` (a payment goes through exactly one QR, but guards double delivery).
3. **Attribute** each txn: `tid → psp_terminal_map → pump → attendant on that pump this shift`.
   - one attendant on the pump → clean per-attendant figure;
   - shared pump → **pump-level only, never an invented split**;
   - no terminal/single static QR → **outlet shift-total only** (can't attribute per attendant).
4. **Sum** (net any refunds) → `verified_amount`.
5. Compare **each tender's** sum (UPI, card) to the attendant's declared figures →
   **matched / short / over** per tender and combined, with the drill-down list and any
   **declared-but-unmatched** / **found-but-undeclared** items.

**Guardrail:** never accuse on an un-attributable figure — degrade to pump-level or shift-total
and say so, rather than inventing a per-attendant number.

---

## 10. UI

- **Outlet Settings → "Payment Providers"** (owner/superadmin): list the outlet's `psp_sources`;
  add/edit (provider, environment, credentials [**write-only**, never shown], store id); the
  **webhook URL to paste into the PSP dashboard** is displayed; **TID → pump** mapping table.
  Feeds the `New-Outlet-Setup` workbook's "Payment Providers" section.
- **Settlement screen (existing):** a **"Digital collections — declared vs verified (UPI + card)"** panel per attendant
  (and outlet total) with the variance and a drill-down. Read-only; advisory to the manager.

---

## 11. Secondary (later) — EOD bank reconciliation

Not in v1's critical path. The **Settlement APIs** (Paytm `settlement/detail`, Pine Labs
`settlements/v1/list`, PhonePe `transactionLevelSettlement`) give **bank UTRs + settled amounts**
for **owner-facing payout reconciliation** at EOD. Wire after v1 verification is proven.

---

## 12. Non-functional

- **Read-only / no money coupling:** never writes sales/cash/margin; a fetch failure shows
  "couldn't verify," never breaks settlement.
- **Idempotent** ingestion; **retry with backoff** on outbound calls; respect PSP **rate limits**.
- **Observability:** structured logs per provider (no secrets/PII beyond masked), counters for
  received/verified/failed.
- **Secrets** server-side only, encrypted at rest, never logged.
- **Sandbox → prod** is a per-outlet **config** change (environment + creds); no redeploy.

---

## 13. Open decisions (need sign-off before coding)

- **D1 — RESOLVED:** per-outlet creds in the DB, **AES-256-GCM encrypted** with a single
  Railway-env master key, **write-only** UI field, **/admin**-gated, never logged; **and use
  read-only / reporting-scoped PSP keys wherever offered** so even a decrypted key can't move
  money. Full posture in §17.
- **D2 — RESOLVED:** PhonePe provides a real-time **S2S webhook** (§8.2 of the API doc) — it pushes
  like Paytm and Pine Labs. No polling needed.
- **D3 — "UPI" definition:** `UPI` only, or `UPI + wallet`, per outlet policy.
- **D4 — Settlement-Detail variant (Paytm):** JWT `/SettlementDetail` vs checksum
  `/v1/settlement/detail` — confirm per MID (EOD path only; not v1-blocking).
- **D5 — change-management routing:** this adds schema + a public webhook route + is
  money-*adjacent* (a figure attendants answer for). Route the first outlet through **staging**,
  or demo on a **test outlet on prod** with sandbox creds? *(Owner call; staging currently = VAWE.)*
- **D6 — HP / fleet card rail:** does the HP card settle through the **same EDC acquirer**
  (covered) or a **separate OMC / fleet switch** (its own source)? Confirm on the ground.

---

## 14. Impact analysis (per CLAUDE.md)

1. **Schema:** new tables (`psp_sources`, `psp_terminal_map`, `psp_transactions`,
   `psp_webhook_events`) — **each ships its RLS policy in the same DDL block**; owner-run,
   idempotent; code is column/table-tolerant until applied.
2. **Consumers:** a new settlement-screen panel + a new settings screen; **no change to existing
   money endpoints**. The webhook route is new and isolated.
3. **Blast radius:** read-only; degrades gracefully; cannot 500 a core path.
4. **Multi-tenant:** all tables station-scoped + RLS; webhook resolves station from payload and
   rejects unknown; one outlet can never read another's transactions.
5. **Money/masking:** touches **no** sales/cash/margin/credit; produces an advisory figure only.
6. **Rollback:** feature-flag/disable per outlet; revert the code; drop the new tables. No effect
   on existing flows when disabled.

---

## 15. Phased delivery

- **Phase 0 — outside-first harness** (standalone, sandbox): prove auth + fetch/verify + sum for
  Paytm, PhonePe, Pine Labs. *(The "run outside Pumpini" step from the deployment strategy.)*
- **Phase 1 — foundation:** DDL (4 tables + RLS), `psp_sources` config + settings screen,
  webhook receivers (signature-verified) + ingestion. Sandbox creds on a test outlet.
- **Phase 2 — verification:** the core sum/attribute/compare + the settlement-screen panel.
- **Phase 3 — EOD (secondary):** settlement/batch pull + bank-UTR reconciliation.
- **Go-live per outlet:** flip `environment`→prod + real creds after the owner's real-shift match.

---

## 16. Acceptance (v1)

- A sandbox **UPI or card** payment on a configured test outlet is **received, signature-verified,
  stored**, and appears in the settlement panel within seconds (webhook push).
- At settlement, **declared vs verified** shows for the outlet (and per attendant where a TID maps
  to one pump/attendant), with a correct variance and drill-down.
- Disabling the outlet's providers makes the panel inert; **no existing flow is affected.**

---

## 17. Security posture / owner assurance

**Credential handling.** Per-outlet PSP credentials live in the DB (not Railway per-outlet vars),
**AES-256-GCM encrypted** with a single master key held in the backend's Railway environment
(never in the DB). The config screen is **/admin-gated** and the secret field is **write-only**
(shows "•••• set", never the value); secrets are **never logged**. Where a PSP offers a
**read-only / reporting-scoped key**, we use that in preference to the master key.

**Pumpini is read-only.** The integration calls **only** status / settlement / verify endpoints
and receives webhooks — there is **no payment or refund code** anywhere in it. Money settles to
the owner's bank exactly as today; Pumpini is not in that path.

**Honest threat model (no fiction).**
- **DB-only breach** (leaked backup, mis-scoped `SELECT`, RLS gap, stolen connection string) →
  attacker gets **ciphertext**; the master key isn't in the DB → **cannot decrypt.** This is the
  common vector, and encryption defeats it.
- **Full backend/Railway takeover** → the app must decrypt to work, so the key is reachable →
  keys **could** be decrypted. But at that point the attacker owns the whole system anyway; the
  PSP keys are not the weak link. No at-rest encryption can prevent this — any secret a system can
  *use* it can be made to *leak* under total compromise.
- **Even if keys leak,** UPI/card funds are **structurally hard to divert:** settlements go only to
  the **merchant's registered bank account** (not changeable via API) and refunds go back to the
  **original payer** — not to an attacker. Worst realistic abuse is nuisance refunds, and the key
  is **rotatable** at the PSP dashboard (instantly killing the stolen one).

**Owner-facing line (all true):** *"Your keys are encrypted, shown to no one, and never logged;
Pumpini only reads — it never moves your money; and where the provider allows, we use a read-only
key that cannot move money at all."*
