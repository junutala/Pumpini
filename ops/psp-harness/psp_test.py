#!/usr/bin/env python3
# =============================================================================
#  Pumpini — UPI/Card "outside-first" test harness  (Phase 0)
#
#  WHAT THIS DOES (in plain words):
#  It logs in to your payment provider's SANDBOX with the test credentials you
#  paste below, asks "show me the transactions for this date", and prints them
#  with a total. Nothing is installed on Pumpini; nothing moves money. It only
#  reads. If the numbers look right, we proceed to build it into Pumpini.
#
#  HOW TO RUN IT (no software to install) — see README.md in this folder.
#  In short: open Google Colab in a browser, paste this file, fill the boxes
#  below, press Run. Or hand this file to a developer: `python psp_test.py`.
#
#  YOUR ONLY JOB: get SANDBOX credentials from each provider (README lists
#  exactly what to ask for) and paste them into the CONFIG block below.
# =============================================================================

# -----------------------------------------------------------------------------
#  CONFIG — the only thing you edit. Turn a provider ON, paste its sandbox keys.
# -----------------------------------------------------------------------------
DATE = "2026-08-25"          # the day you want to fetch (YYYY-MM-DD)

PHONEPE = {
    "enabled":    True,                                     # True = try this one
    "merchant_id": "MERCHANTUAT",                           # PhonePe sandbox MID
    "salt_key":   "f1fed176-917c-4c1b-b5ae-1e1d39e1f8d5",   # PhonePe sandbox Salt Key
    "salt_index": "1",
}

PINELABS = {
    "enabled":    False,                                    # set True once you have keys
    "client_id":  "PASTE_CLIENT_ID",
    "client_secret": "PASTE_CLIENT_SECRET",
}

PAYTM = {
    "enabled":    False,                                    # set True once you have keys
    "mid":        "PASTE_MID",
    "merchant_key": "PASTE_MERCHANT_KEY",
}
# -----------------------------------------------------------------------------
#  Nothing below needs editing.
# -----------------------------------------------------------------------------

import sys, subprocess, base64, hashlib, hmac, json, datetime

def _need(pkg, imp=None):
    try:
        __import__(imp or pkg)
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", pkg])
_need("requests")
import requests

INR = lambda n: f"Rs {n:,.2f}"

def _day_bounds_epoch(date_str):
    d = datetime.datetime.strptime(date_str, "%Y-%m-%d")
    start = int(d.timestamp())
    end = int((d + datetime.timedelta(days=1)).timestamp())
    return start, end

def _print_table(name, env, rows):
    print("\n" + "=" * 64)
    print(f" {name}  ({env})  —  {DATE}")
    print("=" * 64)
    if not rows:
        print("  (no transactions returned for this date — the call worked, the")
        print("   sandbox simply had none. That still proves the connection.)")
        return 0.0
    total = 0.0
    for t in rows:
        ok = str(t["status"]).upper() in ("SUCCESS", "COMPLETED", "PROCESSED", "CHARGED", "TXN_SUCCESS")
        if ok:
            total += t["amount"]
        flag = " " if ok else "x"
        print(f"  [{flag}] {t['time']:<19}  {INR(t['amount']):>14}  {t['mode']:<6}  RRN {t['rrn']:<14}  {t['status']}")
    print("  " + "-" * 60)
    print(f"  {len(rows)} transactions   |   SUCCESSFUL TOTAL {INR(total)}")
    return total


# ---------------------------- PhonePe ----------------------------------------
def run_phonepe(cfg):
    base = "https://mercury-uat.phonepe.com"
    path = "/v1/transactions/details"
    start, end = _day_bounds_epoch(DATE)
    payload = {"merchantId": cfg["merchant_id"], "size": 50,
               "startTimestamp": start, "endTimestamp": end, "searchAfter": {}}
    b64 = base64.b64encode(json.dumps(payload).encode()).decode()
    xverify = hashlib.sha256((b64 + path + cfg["salt_key"]).encode()).hexdigest() + "###" + cfg["salt_index"]
    r = requests.post(base + path, json={"request": b64},
                      headers={"Content-Type": "application/json", "X-VERIFY": xverify}, timeout=30)
    r.raise_for_status()
    data = (r.json().get("data") or {})
    rows = []
    for t in data.get("transactionDetails", []):
        pm = (t.get("paymentModes") or [{}])
        rows.append({
            "time": (t.get("transactionDate") or "")[:19] if isinstance(t.get("transactionDate"), str) else str(t.get("transactionDate")),
            "amount": (t.get("amount") or 0) / 100.0,            # PhonePe = paise
            "mode": (pm[0].get("mode") if pm else "") or t.get("paymentMode") or "UPI",
            "rrn": (pm[0].get("utr") if pm else "") or "",
            "status": t.get("paymentState") or t.get("code") or "",
        })
    return _print_table("PhonePe", "UAT", rows)


# ---------------------------- Pine Labs --------------------------------------
def run_pinelabs(cfg):
    base = "https://pluraluat.v2.pinepg.in"
    tok = requests.post(base + "/api/auth/v1/token",
                        json={"client_id": cfg["client_id"], "client_secret": cfg["client_secret"]},
                        headers={"Content-Type": "application/json"}, timeout=30)
    tok.raise_for_status()
    access = tok.json().get("access_token") or tok.json().get("token") or ""
    r = requests.get(base + "/api/settlements/v1/list",
                     params={"start_date": DATE, "end_date": DATE, "page": 1, "per_page": 50},
                     headers={"Authorization": f"Bearer {access}", "Content-Type": "application/json"}, timeout=30)
    r.raise_for_status()
    rows = []
    for s in (r.json().get("data") or []):
        for t in (s.get("transactions") or []):
            rows.append({
                "time": str(t.get("payment_time", ""))[:19],
                "amount": float(t.get("amount") or 0),          # Pine Labs = rupees
                "mode": t.get("payment_method") or "UPI",
                "rrn": t.get("rrn") or "",
                "status": t.get("status") or "",
            })
    return _print_table("Pine Labs", "UAT", rows)


# ---------------------------- Paytm ------------------------------------------
def run_paytm(cfg):
    _need("paytmchecksum", "paytmchecksum")
    import paytmchecksum
    base = "https://securegw-stage.paytm.in"
    path = "/merchant-settlement/v1/settlement/detail"
    body = {"MID": cfg["mid"], "utrProcessedStartTime": DATE, "utrProcessedEndTime": DATE,
            "pageNum": 1, "pageSize": 50}
    checksum = paytmchecksum.generateSignature(json.dumps(body), cfg["merchant_key"])
    req = {"head": {"version": "v1", "channelId": "WEB", "checksumHash": checksum}, "body": body}
    r = requests.post(base + path, json=req, headers={"Content-Type": "application/json"}, timeout=30)
    r.raise_for_status()
    b = (r.json().get("body") or {})
    rows = []
    for t in b.get("settlementDetailList", []):
        rows.append({
            "time": str(t.get("txnDate", ""))[:19],
            "amount": float(t.get("txnAmount") or 0),           # Paytm = rupees
            "mode": t.get("paymentMode") or "UPI",
            "rrn": t.get("utr") or "",
            "status": b.get("status") or "SUCCESS",
        })
    return _print_table("Paytm", "STAGING", rows)


if __name__ == "__main__":
    print("\nPumpini — payment sandbox test  (reads only; moves no money)\n")
    jobs = [("PhonePe", PHONEPE, run_phonepe),
            ("Pine Labs", PINELABS, run_pinelabs),
            ("Paytm", PAYTM, run_paytm)]
    grand = 0.0
    for name, cfg, fn in jobs:
        if not cfg.get("enabled"):
            continue
        try:
            grand += fn(cfg)
        except Exception as e:
            print(f"\n  X  {name}: {type(e).__name__}: {e}")
            print("     (check the credentials, or the date. The rest still run.)")
    print("\n" + "=" * 64)
    print(f"  GRAND TOTAL across enabled providers for {DATE}:  {INR(grand)}")
    print("=" * 64)
    print("\nDone. Copy everything above and send it back — that's the whole test.\n")
