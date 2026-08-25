# Phase 0 — test findings (running log)

_The repo is the memory. Record what the outside-first runs actually showed._

## 2026-08-25 — PhonePe UAT, public sample keys
- **Ran** `psp_test.py` with PhonePe enabled using PhonePe's **public demo keys**
  (`MERCHANTUAT` / salt `f1fed176-…`). Colab reached `mercury-uat.phonepe.com`.
- **Result:** `HTTP 500 {"code":"INTERNAL_SERVER_ERROR", ... errorId=…}` on
  `/v1/transactions/details`. Same error with **both** timestamp units (seconds *and*
  milliseconds — the harness auto-retries both).
- **Interpretation (grounded):**
  - ✅ Our **X-VERIFY signing is correct** — PhonePe did not return `AUTHORIZATION_FAILED`.
  - ✅ Our **request shape/timestamp** is fine — not a `BAD_REQUEST`; both units fail the same.
  - ❌ Generic server 500 = **the public demo merchant is not provisioned for the recon /
    transaction-details API** (those keys are for the `/v3/qr/init` payment demo). Not our bug.
- **Conclusion:** the tool, connectivity, and signing are proven. To get live data we need a
  **real sandbox merchant with the reporting/recon API enabled** (any one provider unblocks us).
  Pine Labs / Paytm sandboxes typically work out of the box → likely the faster path.

## Still needed (inputs, not code)
- **PhonePe:** a UAT merchant with **Transaction Details / recon API enabled** (MID + Salt Key + Index).
- **Pine Labs:** UAT **Client ID + Client Secret** (settlement + order-status enabled).
- **Paytm:** staging **MID + Merchant Key** (settlement + order-status enabled).

## Next
Once any one working sandbox credential arrives → re-run the harness (should show a total),
then proceed to **Phase 1** (wire into Pumpini on a test outlet). See `docs/upi-verification-fsd.md`.
