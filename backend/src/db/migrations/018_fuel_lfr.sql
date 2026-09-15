-- 018_fuel_lfr.sql
-- Licence Fee Recovery (LFR) as part of the landed cost of fuel.
--
-- The OMC bills a delivery on TWO invoices: the fuel itself (VAT/CST, outside GST) and
-- a SEPARATE GST service invoice for LFR — SAC 997212, item code 4395, "LFR Recovery".
-- LFR is the OMC recovering its investment in the outlet's assets, and it is charged
-- PER KL LIFTED at a rate set by the site category:
--
--     'A' site (OMC owns the land AND the equipment)   MS 443.50/KL   HSD 369.58/KL   GST 18%
--     'B' site (dealer owns land+building, OMC the kit) MS 184.34/KL   HSD 153.62/KL   GST 28%
--
-- Verified against BPCL invoice FIIN112710061073 (07-Sep-2026, SBR Energies), which sits
-- against fuel invoice 1303629797 of the same date:
--     MS  4 KL x 443.50 = 1,774.00
--     HSD 8 KL x 369.58 = 2,956.64
--                         --------
--          taxable      = 4,730.64   (invoice: 4,730.64)   exact
--          + 18% GST    = 5,582.16   (invoice: 5,582.16)   exact
--
-- 🔴 WHY THIS IS ITS OWN COLUMN AND NOT FOLDED INTO rate_per_ltr.
-- `rate_per_ltr` is defined (routes/deliveries.js) as the all-inclusive cost per litre
-- taken FROM THE FUEL INVOICE, and it has to stay reconcilable to that document — a
-- manager checks it against the paper. LFR arrives on a different invoice under a
-- different tax regime, so it sits BESIDE the fuel figure exactly as `freight` already
-- does, and the landed cost is the sum of the three. Showing the parts is the point:
-- a total computed from parts must return the parts (CLAUDE.md, 29-Aug).
--
-- 🔴 AND WHY THE RATE CARD IS NOT HARDCODED ANYWHERE.
-- The rates above are corroborated against ONE invoice, ONE date, ONE OMC, and OMCs
-- revise them. The amount stored here is always the one the outlet was ACTUALLY billed,
-- read from its own LFR invoice. The published card is a sanity CHECK on that figure,
-- never a substitute for it.
--
-- Additive + idempotent. Nullable on purpose: every existing row reads as "no LFR
-- captured", which is true — and the dashboard says so rather than implying the margin
-- is net of it.

ALTER TABLE public.fuel_deliveries ADD COLUMN IF NOT EXISTS lfr_amount numeric;

COMMENT ON COLUMN public.fuel_deliveries.lfr_amount IS
  'Licence Fee Recovery apportioned to THIS delivery row, in rupees, taxable value as '
  'billed by the OMC on its separate GST invoice (SAC 997212). Per KL lifted, so it is '
  'split across the invoice''s fuel lines by volume. NULL = not captured (not zero). '
  'Sits beside freight in the landed cost; never folded into rate_per_ltr, which must '
  'stay reconcilable to the fuel invoice.';

-- The LFR invoice number, so the figure can be traced back to the paper it came from.
ALTER TABLE public.fuel_deliveries ADD COLUMN IF NOT EXISTS lfr_invoice_no text;

COMMENT ON COLUMN public.fuel_deliveries.lfr_invoice_no IS
  'Invoice number of the OMC LFR invoice this row''s lfr_amount was read from '
  '(e.g. FIIN112710061073). Lets a manager check the figure against the document.';
