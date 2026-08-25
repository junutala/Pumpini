# Step 0 — the "outside-first" payment test (for non-technical use)

This proves we can **read** your payment transactions from a provider's **sandbox**
(test) system and add them up — **without touching Pumpini and without moving any
money.** If the numbers look right, we build it into Pumpini next.

There's exactly **one thing only you can do:** get the **sandbox credentials** from
each provider. Running the test is one click.

---

## 1. What to ask each provider for (sandbox / UAT — not production)

- **PhonePe:** *Merchant ID*, *Salt Key*, *Salt Index*. *(A public sample is already
  filled in, so PhonePe will run even before you get your own.)*
- **Pine Labs (Plural):** *Client ID*, *Client Secret*.
- **Paytm:** *MID*, *Merchant Key*.

That's it. These are **test** keys — safe, and they can't move money.

---

## 2. Run it — the no-install way (Google Colab, in your browser)

1. Go to **colab.research.google.com** → sign in with Google → **New notebook**.
2. Open the file **`psp_test.py`** (in this folder), select **all**, copy it.
3. Paste it into the Colab box.
4. Near the top you'll see a **CONFIG** section. For each provider you have keys for:
   set `"enabled": True` and paste the keys between the quotes. Set the `DATE`.
5. Press the ▶ **Run** button (or Ctrl+Enter).
6. Wait a few seconds. It prints each transaction and a **total**.
7. **Copy everything it printed and send it back to me.** That's the whole test.

*(Prefer a developer? Just hand them `psp_test.py` and say "run `python psp_test.py`".)*

---

## 3. What you'll see

```
================================================================
 PhonePe  (UAT)  —  2026-08-25
================================================================
  [ ] 2026-08-25 10:15   Rs 1,500.00   UPI    RRN 423819002341   COMPLETED
  ------------------------------------------------------------
  1 transactions   |   SUCCESSFUL TOTAL Rs 1,500.00
```

- A **total** you can compare to what an attendant would have declared.
- If a provider shows **"no transactions"** — that's fine: it means the connection
  worked but the sandbox had none. That still proves the plumbing.
- If a provider shows an **error** — the others still run; just re-check that key.

---

## Notes
- **Reads only. Moves no money.** The script never calls a payment or refund.
- It runs **outside Pumpini** — nothing here is deployed to your live system.
- Sandbox data is test data. Real numbers come later, with production keys, on the
  test outlets (Dilsukhnagar / Nagole / Hayat).
