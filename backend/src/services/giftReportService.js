// src/services/giftReportService.js
//
// The gift campaign report — what went out, who gave it, and whether it moved
// any fuel.
//
// 🔴 THE HARDEST THING THIS FILE HAS TO DO IS NOT OVERSTATE THE ANSWER.
//
// A campaign's "did it work" question is a before-and-after on daily litres, and
// daily litres are noisy enough that a fortnight's swing means almost nothing on
// its own. Measured on this outlet's OWN history — sixteen consecutive five-day
// windows at Highway with no campaign running at any point — premium ranged 442 L
// to 899 L, a 24% coefficient of variation, with block-to-block jumps of +71% and
// −42%. A campaign would have to move volume by roughly half before it could be
// told apart from an ordinary fortnight.
//
// So the report returns THREE things about volume and never one:
//   daily      — the series, because the shape is honest and a single delta is not
//   prior      — the matched window before it
//   baseline   — the range of the N windows before THAT, which is the error bar.
//                Without it, "+37%" reads as a result when it is weather.
//
// And it returns the SHARE of the eligible fuel against all fuel, which is far
// quieter than the raw litres: a busy week lifts both and cancels out, so a real
// shift in what people buy actually shows. (Owner, 20-Sep: show raw numbers,
// maybe a graph. The share is offered beside them, not instead of them.)
//
// ── THE OTHER HALF IS THE CONTROL ────────────────────────────────────────────
//
// Per-attendant counts, and beside them the MANUAL-PLATE RATE. The typed-plate
// path exists because a worn plate is the driver's problem and not his fault —
// but it is also the one door an attendant can walk through to name any vehicle
// he likes. One man typing 40% of his plates while everyone else types 3% is
// visible here without anybody being accused of anything, and it is the only
// control in the whole scheme that he KNOWS is watching him.
const pool = require('../db/pool');

let present = null;
async function migrated(client = pool) {
  if (present !== null) return present;
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('gift_campaigns','gift_issues')`);
  present = rows[0].n === 2;
  return present;
}

// Daily litres of one fuel set, in the outlet's own days. Every settlement-
// synthesised sale is stamped at the shift date + 12:00 IST, so the IST date IS
// the shift day; coupon rows carry their real date. Voided rows are excluded —
// they are not sales.
async function dailyLitres({ station_id, fuels, from, to }) {
  if (!fuels?.length) return [];
  const { rows } = await pool.query(
    `SELECT (de.occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS d,
            ROUND(SUM(de.quantity_ltrs)::numeric, 2) AS litres
       FROM dispense_events de
      WHERE de.station_id = $1
        AND de.fuel_type = ANY($2::varchar[])
        AND NOT COALESCE(de.is_voided, FALSE)
        AND (de.occurred_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $3 AND $4
      GROUP BY 1 ORDER BY 1`,
    [station_id, fuels, from, to]);
  return rows.map(r => ({ d: r.d, litres: Number(r.litres) }));
}

async function sumLitres({ station_id, fuels, from, to }) {
  if (!fuels?.length) return 0;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(quantity_ltrs),0) AS l FROM dispense_events
      WHERE station_id=$1 AND fuel_type = ANY($2::varchar[])
        AND NOT COALESCE(is_voided,FALSE)
        AND (occurred_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $3 AND $4`,
    [station_id, fuels, from, to]);
  return Number(rows[0].l);
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const istToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

async function report({ campaign_id, station_id }) {
  if (!(await migrated())) return null;

  const { rows: cs } = await pool.query(
    `SELECT * FROM gift_campaigns WHERE id=$1 AND station_id=$2`, [campaign_id, station_id]);
  if (!cs.length) { const e = new Error('Campaign not found.'); e.status = 404; throw e; }
  const c = cs[0];

  const { rows: fuelRows } = await pool.query(
    `SELECT DISTINCT fuel_type FROM gift_campaign_tiers WHERE campaign_id=$1`, [campaign_id]);
  const fuels = fuelRows.map(r => r.fuel_type);

  // The window is the campaign so far — never the whole planned range, or a
  // campaign on day 5 of 16 would be compared against eleven days that have not
  // happened and would read as a collapse.
  const start = String(c.start_date).slice(0, 10);
  const today = istToday();
  const end   = (String(c.end_date).slice(0, 10) < today) ? String(c.end_date).slice(0, 10) : today;
  const days  = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1);

  const priorFrom = addDays(start, -days);
  const priorTo   = addDays(start, -1);

  const [daily, prior, campaignL, priorL] = await Promise.all([
    dailyLitres({ station_id, fuels, from: start, to: end }),
    dailyLitres({ station_id, fuels, from: priorFrom, to: priorTo }),
    sumLitres({ station_id, fuels, from: start, to: end }),
    sumLitres({ station_id, fuels, from: priorFrom, to: priorTo }),
  ]);

  // THE ERROR BAR. Eight windows of the same length before the prior one, with
  // no campaign running. If the campaign's swing sits inside this range, it is
  // weather — and the screen must be able to say so.
  const baseline = [];
  for (let i = 2; i <= 9; i++) {
    const f = addDays(start, -days * i);
    const t = addDays(start, -days * (i - 1) - 1);
    baseline.push({ from: f, to: t, litres: await sumLitres({ station_id, fuels, from: f, to: t }) });
  }
  const seen = baseline.filter(b => b.litres > 0).map(b => b.litres);

  // The eligible fuel's SHARE of everything sold — quieter than raw litres,
  // because a busy week lifts both sides and cancels out.
  const allFuelNow   = await sumLitres({ station_id, fuels: ['petrol','diesel','cng','premium_petrol'], from: start, to: end });
  const allFuelPrior = await sumLitres({ station_id, fuels: ['petrol','diesel','cng','premium_petrol'], from: priorFrom, to: priorTo });

  const q = (sql, params = [campaign_id]) => pool.query(sql, params).then(r => r.rows);

  const [totals, byGift, byReason, byAttendant] = await Promise.all([
    q(`SELECT
         count(*) FILTER (WHERE status='issued')                              AS issued,
         count(*) FILTER (WHERE status='not_issued')                          AS not_issued,
         count(*) FILTER (WHERE status='draft' AND expires_at < NOW())        AS abandoned,
         count(*) FILTER (WHERE status='issued' AND plate_source='ocr')       AS plate_read,
         count(*) FILTER (WHERE status='issued' AND plate_source='manual')    AS plate_typed,
         count(*) FILTER (WHERE status='issued' AND bill_no IS NOT NULL)      AS with_slip,
         count(*) FILTER (WHERE status='issued' AND promo_consent)            AS consented
       FROM gift_issues WHERE campaign_id=$1`),
    q(`SELECT g.product_id, p.name AS product_name, p.unit,
              COALESCE(p.gift_stock,0) AS gift_stock,
              SUM(g.quantity) AS given, count(*) AS times
         FROM gift_issues g JOIN products p ON p.id=g.product_id
        WHERE g.campaign_id=$1 AND g.status='issued'
        GROUP BY 1,2,3,4 ORDER BY times DESC`),
    q(`SELECT reason, count(*) AS n FROM gift_issues
        WHERE campaign_id=$1 AND status='not_issued'
        GROUP BY 1 ORDER BY n DESC`),
    // The control. Typed-plate rate beside the count, because the count alone
    // says nothing — a man on the busy bay legitimately issues more.
    q(`SELECT g.issued_by, u.name AS attendant_name,
              count(*) FILTER (WHERE g.status='issued')                           AS issued,
              count(*) FILTER (WHERE g.status='issued' AND g.plate_source='manual') AS typed,
              count(*) FILTER (WHERE g.status='not_issued')                       AS refused
         FROM gift_issues g LEFT JOIN users u ON u.id=g.issued_by
        WHERE g.campaign_id=$1 AND g.status <> 'draft'
        GROUP BY 1,2 ORDER BY issued DESC`),
  ]);

  const t = totals[0] || {};
  const n = v => Number(v || 0);

  return {
    campaign: c,
    fuels,
    window:  { from: start, to: end, days },
    prior:   { from: priorFrom, to: priorTo },
    daily, prior_daily: prior,
    litres:  {
      campaign: campaignL,
      prior: priorL,
      // Null rather than a fabricated Infinity when there is nothing to compare
      // against — a campaign at a new outlet has no before, and saying so is the
      // honest answer.
      change_pct: priorL > 0 ? +(((campaignL - priorL) / priorL) * 100).toFixed(1) : null,
    },
    share: {
      campaign: allFuelNow   > 0 ? +((campaignL / allFuelNow)   * 100).toFixed(2) : null,
      prior:    allFuelPrior > 0 ? +((priorL    / allFuelPrior) * 100).toFixed(2) : null,
    },
    // The error bar. Empty when the outlet has no history that far back, which
    // is itself worth showing rather than hiding.
    baseline: seen.length ? { windows: seen.length, min: Math.min(...seen), max: Math.max(...seen) } : null,
    totals: {
      issued: n(t.issued), not_issued: n(t.not_issued), abandoned: n(t.abandoned),
      plate_read: n(t.plate_read), plate_typed: n(t.plate_typed),
      with_slip: n(t.with_slip), consented: n(t.consented),
    },
    by_gift: byGift.map(r => ({ ...r, given: Number(r.given), times: Number(r.times), gift_stock: Number(r.gift_stock) })),
    by_reason: byReason.map(r => ({ reason: r.reason, n: Number(r.n) })),
    by_attendant: byAttendant.map(r => ({
      id: r.issued_by, name: r.attendant_name,
      issued: Number(r.issued), typed: Number(r.typed), refused: Number(r.refused),
      typed_pct: Number(r.issued) > 0 ? +((Number(r.typed) / Number(r.issued)) * 100).toFixed(0) : 0,
    })),
  };
}

// The gifts themselves, newest first — the working behind every number above.
// A total nobody can open is a total nobody checks.
async function issues({ campaign_id, station_id, limit = 200 }) {
  if (!(await migrated())) return [];
  const { rows } = await pool.query(
    `SELECT g.id, g.status, g.vehicle_number, g.plate_source, g.fuel_type, g.litres,
            g.bill_no, g.quantity, g.reason, g.reason_note, g.settled_at, g.promo_consent,
            g.slip_artifact_id, g.plate_artifact_id, g.handover_artifact_id,
            p.name AS product_name, p.unit, u.name AS issued_by_name,
            t.min_litres
       FROM gift_issues g
       LEFT JOIN products p ON p.id = g.product_id
       LEFT JOIN users u    ON u.id = g.issued_by
       LEFT JOIN gift_campaign_tiers t ON t.id = g.tier_id
      WHERE g.campaign_id=$1 AND g.station_id=$2 AND g.status <> 'draft'
      ORDER BY g.settled_at DESC NULLS LAST
      LIMIT $3`,
    [campaign_id, station_id, Math.min(Number(limit) || 200, 500)]);
  return rows;
}

module.exports = { report, issues, migrated };
