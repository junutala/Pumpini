// src/config/lfrRates.js
//
// Known OMC Licence Fee Recovery rate cards, per KL lifted.
//
// 🔴 THESE ARE HYPOTHESES, NOT TRUTH. They are never used as "the rate" — they are
// CANDIDATES tested against the outlet's OWN invoice. Given the volumes on a delivery and
// the taxable total the OMC actually billed, only one card reproduces that total, so the
// site category is DERIVED from the paper rather than asked of the manager or stored as a
// setting he could get wrong. If a card is revised and none of these reconciles, nothing
// is silently substituted: the split falls back to flat per-litre and says so.
//
// That is the whole reason this file is safe to hold numbers at all. A hardcoded rate
// that is simply applied goes stale in silence; one that must first reproduce the
// invoice in front of it cannot.
//
// Source: PPAC / MoPNG and the professional record, corroborated to the paisa against
// BPCL invoice FIIN112710061073 (07-Sep-2026, SBR Energies): 4 KL MS + 8 KL HSD →
// 4 x 443.50 + 8 x 369.58 = 4,730.64, exactly the taxable value billed, with 18% GST
// giving 5,582.16, exactly its total.
//
// 'A' site — the OMC owns or leases the land AND the equipment.
// 'B' site — the dealer owns the land and building; the OMC still owns the equipment,
//            so LFR is lower (equipment only) and GST is 28% rather than 18%.
// A dealer who owns land AND equipment pays no LFR at all and never reaches this code.

const LFR_CARDS = [
  {
    category: 'A',
    gst_pct: 18,
    note: 'OMC owns or leases the land and the equipment',
    rates_per_kl: { petrol: 443.50, premium_petrol: 443.50, diesel: 369.58 },
  },
  {
    category: 'B',
    gst_pct: 28,
    note: 'Dealer owns land and building; OMC owns the equipment',
    rates_per_kl: { petrol: 184.34, premium_petrol: 184.34, diesel: 153.62 },
  },
];

// Rupee tolerance when matching a card to an invoice. Generous enough for the OMC's own
// rounding across several lines, tight enough that the two cards can never both match —
// they differ by thousands on any real lift.
const MATCH_TOLERANCE = 1.00;

// Which card reproduces this invoice? rows: [{ fuel_type, gross_volume_ltrs }].
// Returns { category, rates_per_kl, expected, delta } or null when none reconciles.
function matchCard(rows, invoiceTotal) {
  const total = Number(invoiceTotal);
  if (!Number.isFinite(total) || total <= 0) return null;
  let best = null;
  for (const card of LFR_CARDS) {
    // Every fuel on the invoice must be priced by the card, or it cannot explain it.
    if (!rows.every(r => Number(card.rates_per_kl[r.fuel_type]) > 0)) continue;
    const expected = rows.reduce((s, r) =>
      s + card.rates_per_kl[r.fuel_type] * ((Number(r.gross_volume_ltrs) || 0) / 1000), 0);
    const delta = Math.abs(expected - total);
    if (delta <= MATCH_TOLERANCE && (!best || delta < best.delta)) {
      best = { category: card.category, gst_pct: card.gst_pct, note: card.note,
               rates_per_kl: card.rates_per_kl, expected: +expected.toFixed(2), delta: +delta.toFixed(2) };
    }
  }
  return best;
}

module.exports = { LFR_CARDS, MATCH_TOLERANCE, matchCard };
