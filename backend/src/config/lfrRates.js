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
// 🔴 VERIFIED FOR BPCL ONLY. Owner, 15-Sep-2026: "this rate is for BPCL, but we do not
// know if the same rate applies to IOCL. So until we get hold of the invoice, we will
// never know." He is right, and the shape of the estate makes it urgent: of the five
// real outlets, only SBR Energies is BPCL. Sri Balaji, Highway and Adhoc Highway are
// HPCL and Kamala is IOC — four outlets on cards nobody here has ever seen.
//
// So each card carries the OMCs it has actually been checked against. A match on any
// other OMC is still reported — reproducing a total to within a rupee from two different
// rates across two different volumes is evidence, not coincidence — but it comes back
// flagged `verified: false`, and the screen says the rate is inferred rather than known.
// The first HPCL or IOC invoice that reconciles is what promotes a card, and until one
// arrives we do not pretend.
//
// 'A' site — the OMC owns or leases the land AND the equipment.
// 'B' site — the dealer owns the land and building; the OMC still owns the equipment,
//            so LFR is lower (equipment only) and GST is 28% rather than 18%.
// A dealer who owns land AND equipment pays no LFR at all and never reaches this code.

const LFR_CARDS = [
  {
    category: 'A',
    gst_pct: 18,
    verified_for: ['BPCL'],
    note: 'OMC owns or leases the land and the equipment',
    rates_per_kl: { petrol: 443.50, premium_petrol: 443.50, diesel: 369.58 },
  },
  {
    category: 'B',
    gst_pct: 28,
    verified_for: ['BPCL'],
    note: 'Dealer owns land and building; OMC owns the equipment',
    rates_per_kl: { petrol: 184.34, premium_petrol: 184.34, diesel: 153.62 },
  },
];

// Rupee tolerance when matching a card to an invoice. Generous enough for the OMC's own
// rounding across several lines, tight enough that the two cards can never both match —
// they differ by thousands on any real lift.
const MATCH_TOLERANCE = 1.00;

// Normalise the oil-company spellings actually in the data ('IOC' and 'IOCL' are the
// same company; nobody should have to remember which one Settings holds).
function normalizeOmc(name) {
  const n = String(name || '').trim().toUpperCase();
  if (n === 'IOCL' || n === 'IOC' || n.startsWith('INDIAN OIL')) return 'IOC';
  if (n.startsWith('BHARAT')) return 'BPCL';
  if (n.startsWith('HINDUSTAN')) return 'HPCL';
  return n;
}

// Which card reproduces this invoice? rows: [{ fuel_type, gross_volume_ltrs }].
// `oilCompany` decides only whether the match is VERIFIED for that OMC — never whether
// it is attempted, because the arithmetic is the evidence and refusing to do it would
// throw away the very data that would let us verify a new OMC.
// Returns { category, rates_per_kl, expected, delta, verified } or null when none fits.
function matchCard(rows, invoiceTotal, oilCompany = null) {
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
               rates_per_kl: card.rates_per_kl, expected: +expected.toFixed(2), delta: +delta.toFixed(2),
               verified_for: card.verified_for,
               verified: card.verified_for.includes(normalizeOmc(oilCompany)) };
    }
  }
  return best;
}

module.exports = { LFR_CARDS, MATCH_TOLERANCE, matchCard, normalizeOmc };
