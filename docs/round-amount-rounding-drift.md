# Round-amount sales: is the dealer losing money to rounding?

**Raised by:** Srinivas Yarramada, Sri Balaji Oil Company, 16-Aug-2026
**Claim:** customers buying in round rupee amounts (₹100, ₹500, ₹2000) cause a
rounding remainder from the third decimal of a litre onwards; over time this is a
real loss, thought to run to **thousands of rupees a month**, with a gain on small
amounts and a loss on large ones (₹2000+).

**Finding:** the mechanism is real and he identified it correctly. It is in
*Pumpini's* code, not the pump. But it is bounded by arithmetic at **±5.8 paise per
sale**, and measured against two months of real trading it comes to **₹1.26 across
three outlets** — not thousands a month. The direction does not vary with ticket
size the way he expects; if anything the ₹2000+ band is the *least* affected.

This note records the working so it can be re-run and challenged.

---

## 1. The mechanism — confirmed

`frontend/src/app/pos/page.js` line 141, POS entry in **Amount** mode:

```js
const calcLitres = amount && price ? (parseFloat(amount) / price).toFixed(3) : '';
```

The attendant keys a rupee figure; we divide by the rate, **round the litres to three
decimals**, and store that as `quantity_ltrs`. The money is then generated back from
the rounded litres — `dispense_events.amount` is a generated column:

```sql
amount GENERATED ALWAYS AS (quantity_ltrs * rate_per_ltr) STORED
```

So for ₹100 of petrol at ₹115.55/L:

| | |
|---|---|
| true litres | 100 ÷ 115.55 = 0.8654262… L |
| stored litres | 0.865 L |
| booked amount | 0.865 × 115.55 = **₹99.95** |
| cash collected | **₹100.00** |
| difference | **₹0.05 collected but not booked** |

He is right that the books and the cash box disagree, and right about why.

## 2. The size of it is fixed by arithmetic

Rounding a litre figure to three decimals can be wrong by at most **0.0005 L**. In
money that is `0.0005 × rate`:

| Fuel | Rate | Maximum error per sale |
|---|---|---|
| Petrol | ₹115.55 | **₹0.058** |
| Diesel | ₹103.67 | ₹0.052 |
| Premium | ₹125.87 | ₹0.063 |

This is a hard ceiling, not an average, and **it does not scale with the size of the
sale** — the same 0.0005 L whether the customer buys ₹100 or ₹5,000. A ₹2,000 sale
cannot lose more than six paise this way.

For the claim of "thousands of rupees a month" to hold through this mechanism, the
outlet would need on the order of **50,000 round-amount sales a month**, every one of
them erring in the same direction. Neither is the case.

## 3. Direction does not follow ticket size

Computed exactly as the POS does it — `booked = round(round(asked ÷ rate, 3) × rate, 2)`
— across round amounts at Sri Balaji's three live rates. Positive = dealer gains.

| Asked | Petrol | Diesel | Premium |
|---:|---:|---:|---:|
| ₹100 | −0.05 | +0.04 | −0.06 |
| ₹200 | +0.02 | −0.02 | +0.01 |
| ₹500 | −0.02 | 0.00 | −0.04 |
| ₹1,000 | −0.03 | 0.00 | +0.04 |
| ₹1,500 | −0.05 | 0.00 | −0.01 |
| **₹2,000** | **+0.05** | **0.00** | −0.05 |
| ₹2,500 | +0.04 | 0.00 | +0.03 |
| ₹3,000 | +0.02 | 0.00 | −0.01 |

There is no trend with size. The sign depends on where the third decimal of
`amount ÷ rate` happens to fall, which is a property of that particular
amount-and-rate pair and has nothing to do with how large the sale is. **₹2,000 of
petrol currently drifts five paise in the dealer's favour.** Diesel at ₹103.67 lands
on exact multiples often enough to drift zero at most round figures.

## 4. What the real sales show

2,764 dispense events at the three genuine outlets — Kamala, Highway, Adhoc Highway —
over roughly two months. Round-rupee sales identified as those whose booked amount
falls within `0.0006 × rate` of a multiple of ₹10, ₹50 or ₹100; anything further away
could not have been produced by this mechanism.

| Ticket band | Sales | Net drift | Per sale | Dealer gains | Dealer loses |
|---|---:|---:|---:|---:|---:|
| under ₹500 | 11 | −₹0.09 | −0.008 | 2 | 9 |
| ₹500 – 999 | 20 | −₹0.56 | −0.028 | 0 | 20 |
| ₹1,000 – 1,999 | 15 | −₹0.48 | −0.032 | 3 | 11 |
| **₹2,000 and above** | **120** | **−₹0.13** | **−0.001** | 51 | 59 |
| **All** | **166** | **−₹1.26** | −0.008 | 56 | 99 |

**₹1.26 in two months across three outlets.** At that rate, of the order of **₹8 a
year** for the group.

Two honest observations:

- **The bias is real.** 99 losses against 56 gains is not a coin toss, and every band
  is negative. Rounding does favour the customer slightly. His instinct was sound.
- **It is inverted from his model.** The ₹2,000+ band, where he expects the loss to
  concentrate, is the least affected — a tenth of a paisa per sale, and almost evenly
  split. The bias sits in ₹500–1,999, and even there it is three paise a sale.

## 5. What this does NOT measure

**This measures Pumpini's booking drift, not the pump's own.** The dispenser keeps its
own cumulative registers — `A` in rupees and `V` in litres, both to three decimals —
and those are printed on every ETOT slip. Any drift *inside the pump* between money
collected and volume delivered is a separate question, and one this analysis cannot
answer because we have no scanned slips in production yet.

If Srinivas is seeing real money go missing, that is where to look, and the instrument
already exists: `parse-slip` reads both registers off the slip and stores them with the
photograph. Once his outlet is scanning slips, the two registers can be compared
against each other shift by shift — a far stronger control than either figure alone.

## 6. Reproducing this

Both queries are read-only.

```sql
-- (a) Theoretical drift, exactly as the POS computes it
WITH rates AS (SELECT * FROM (VALUES ('petrol',115.55::numeric),('diesel',103.67),('premium',125.87)) r(fuel,rate)),
     asks  AS (SELECT generate_series(100,3000,100)::numeric AS asked)
SELECT a.asked,
       max(CASE WHEN r.fuel='petrol'  THEN round(round(a.asked/r.rate,3)*r.rate,2) - a.asked END) AS petrol_drift,
       max(CASE WHEN r.fuel='diesel'  THEN round(round(a.asked/r.rate,3)*r.rate,2) - a.asked END) AS diesel_drift,
       max(CASE WHEN r.fuel='premium' THEN round(round(a.asked/r.rate,3)*r.rate,2) - a.asked END) AS premium_drift
FROM asks a CROSS JOIN rates r
GROUP BY a.asked ORDER BY a.asked;

-- (b) Measured drift on real sales, by ticket band
WITH s AS (
  SELECT de.amount, de.rate_per_ltr,
         CASE WHEN round(de.amount/100)*100 > 0 AND abs(de.amount - round(de.amount/100)*100) <= 0.0006*de.rate_per_ltr THEN round(de.amount/100)*100
              WHEN round(de.amount/50 )*50  > 0 AND abs(de.amount - round(de.amount/50 )*50 ) <= 0.0006*de.rate_per_ltr THEN round(de.amount/50 )*50
              WHEN round(de.amount/10 )*10  > 0 AND abs(de.amount - round(de.amount/10 )*10 ) <= 0.0006*de.rate_per_ltr THEN round(de.amount/10 )*10
         END AS asked
  FROM dispense_events de
  WHERE de.station_id IN ('93ddaa38-8adc-40b9-8a9a-a69f92f657ee',   -- Kamala
                          '3b9d35cc-195a-458a-a0c3-51af6be9e73d',   -- Highway
                          'deb43fce-c294-4f9c-b634-e575383740a8')   -- Adhoc Highway
    AND de.quantity_ltrs > 0 AND de.rate_per_ltr > 0
), d AS (SELECT asked, asked - amount AS drift FROM s WHERE asked IS NOT NULL)
SELECT CASE WHEN asked < 500 THEN 'under 500'
            WHEN asked < 1000 THEN '500-999'
            WHEN asked < 2000 THEN '1000-1999'
            ELSE '2000 and above' END AS ticket_band,
       count(*) AS sales, round(sum(drift),2) AS net_drift_rs, round(avg(drift),4) AS avg_per_sale,
       count(*) FILTER (WHERE drift > 0) AS dealer_gains,
       count(*) FILTER (WHERE drift < 0) AS dealer_loses
FROM d GROUP BY 1
UNION ALL
SELECT 'ALL', count(*), round(sum(drift),2), round(avg(drift),4),
       count(*) FILTER (WHERE drift > 0), count(*) FILTER (WHERE drift < 0) FROM d
ORDER BY 1;
```

## 7. What we are doing about it

The rounding itself is worth removing — six paise a sale is small but it is avoidable,
and a dealer should never be asked to accept that his books and his cash box differ by
construction. The fix is to stop deriving money from rounded litres in Amount mode.

More valuable is the **second totalizer**. `parse-slip` already captures the pump's
rupee register alongside the litre register and keeps the photograph. Settling against
the money the pump says it took — rather than inferring it from litres × rate —
removes the conversion from the chain entirely, and gives every shift an independent
cross-check that no amount of volume arithmetic can provide.

That is the enhancement worth building, and Srinivas asked for it. The rounding
analysis simply says it should be justified on control, not on recovering thousands a
month that are not in fact being lost.
