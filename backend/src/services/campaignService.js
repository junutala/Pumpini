// src/services/campaignService.js
//
// THE one writer for a gift campaign and its tiers.
//
// ── THE RULES THIS FILE EXISTS TO HOLD ────────────────────────────────────────
//
// A TIER IS JUDGED ON A SINGLE FILL, never on a running total. 100 L on Monday
// and 100 L on Tuesday is two 100 L fills, not one 200 L customer. (Owner,
// 20-Sep-2026 — an earlier reading of the spec had this as cumulative and it was
// wrong.)
//
// ONLY THE HIGHEST TIER MET IS AWARDED. A 250 L fill that clears both the 100 L
// and the 200 L rung pays the 200 L gift and nothing else — which is why the
// index on tiers is `min_litres DESC` and the lookup takes the first row that
// the fill clears.
//
// ONE GIFT PER VEHICLE PER TIER, for the life of the campaign. That is NOT
// enforced here: it is `uq_gi_vehicle_tier`, a UNIQUE index partial on
// status='issued'. A rule a service checks is a rule some future caller forgets;
// a rule the database holds cannot be forgotten. The partial-on-issued part is
// also what makes an out-of-stock refusal leave the entitlement intact, so the
// driver can claim it next visit — no code decides that either.
//
// THE DEFINITION FREEZES ON START. Tiers, gifts, dates and hours are editable
// only while the campaign is a draft; to change them you close the running
// campaign and start a new one. A gift already handed over must stay explainable
// by the rules that were live when it went out. Note what is NOT frozen: STOCK.
// Stock lives in the catalogue and moves as stock moves — replenishing mid-
// campaign is not a change of terms.
//
// ELIGIBLE FUELS ARE DERIVED, never stored. A fuel is eligible exactly when it
// has at least one tier. A second column listing them would be a second home for
// one fact, and they would drift.
const pool = require('../db/pool');

const FUELS = ['petrol', 'diesel', 'cng', 'premium_petrol'];
const EDITABLE = 'draft';

function badRequest(message, extra) {
  const e = new Error(message);
  e.status = 400;
  if (extra) Object.assign(e, extra);
  return e;
}
function notFound(message) {
  const e = new Error(message);
  e.status = 404;
  return e;
}

// Probed, not try/caught — this code reaches environments where the migration has
// not been run (staging carries VAWE and is deliberately behind), and a missing
// table inside a transaction would abort it rather than degrade. See stockService
// for the same pattern and CLAUDE.md for the incident that made it a rule.
let tablesPresent = null;
async function migrated(client = pool) {
  if (tablesPresent !== null) return tablesPresent;
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name IN ('gift_campaigns','gift_campaign_tiers','gift_issues')`
  );
  tablesPresent = rows[0].n === 3;
  return tablesPresent;
}
const NOT_MIGRATED = 'Gift campaigns are not set up on this database yet.';

async function assertMigrated() {
  if (!(await migrated())) throw badRequest(NOT_MIGRATED);
}

// ── READ ──────────────────────────────────────────────────────────────────────

async function listCampaigns({ station_id }) {
  if (!(await migrated())) return [];
  const { rows } = await pool.query(
    `SELECT c.*,
            (SELECT count(*)::int FROM gift_campaign_tiers t WHERE t.campaign_id = c.id) AS tier_count,
            (SELECT count(*)::int FROM gift_issues i
              WHERE i.campaign_id = c.id AND i.status='issued')                          AS issued_count,
            (SELECT array_agg(DISTINCT t.fuel_type ORDER BY t.fuel_type)
               FROM gift_campaign_tiers t WHERE t.campaign_id = c.id)                    AS fuels
       FROM gift_campaigns c
      WHERE c.station_id = $1
      ORDER BY c.start_date DESC, c.created_at DESC`,
    [station_id]
  );
  return rows;
}

// A campaign with its tiers, each carrying the LIVE catalogue figures — name and
// stock are read through, never copied onto the tier, so the setup screen shows
// what is actually in the gift store right now. (The snapshot onto gift_issues at
// award time is the opposite case and is deliberate: history must not move.)
async function getCampaign({ id, station_id }) {
  await assertMigrated();
  const { rows } = await pool.query(
    `SELECT * FROM gift_campaigns WHERE id=$1 AND station_id=$2`, [id, station_id]);
  if (!rows.length) throw notFound('Campaign not found.');

  const { rows: tiers } = await pool.query(
    `SELECT t.*, p.name AS product_name, p.unit,
            COALESCE(p.gift_stock,0) AS gift_stock
       FROM gift_campaign_tiers t
       JOIN products p ON p.id = t.product_id
      WHERE t.campaign_id = $1
      ORDER BY t.fuel_type, t.min_litres`,
    [id]
  );
  return { ...rows[0], tiers };
}

// THE award lookup. Highest rung the fill clears, or nothing.
//
// Returns the tier only — whether this vehicle has ALREADY had this tier is not
// asked here, because the answer would be stale by the time it is used. The
// unique index settles it at the moment of the write, which is the only moment
// that cannot be raced.
async function eligibleTier({ campaign_id, fuel_type, litres }) {
  await assertMigrated();
  const { rows } = await pool.query(
    `SELECT t.*, p.name AS product_name, p.unit, COALESCE(p.gift_stock,0) AS gift_stock
       FROM gift_campaign_tiers t
       JOIN products p ON p.id = t.product_id
      WHERE t.campaign_id = $1 AND t.fuel_type = $2 AND t.min_litres <= $3
      ORDER BY t.min_litres DESC
      LIMIT 1`,
    [campaign_id, fuel_type, litres]
  );
  return rows[0] || null;
}

// ── WRITE ─────────────────────────────────────────────────────────────────────

async function assertDraft(client, { id, station_id }) {
  const { rows } = await client.query(
    `SELECT status FROM gift_campaigns WHERE id=$1 AND station_id=$2 FOR UPDATE`,
    [id, station_id]
  );
  if (!rows.length) throw notFound('Campaign not found.');
  if (rows[0].status !== EDITABLE) {
    throw badRequest(
      'This campaign has started, so its rules are locked. Close it and start a new one to change a tier or a gift.',
      { status: rows[0].status }
    );
  }
}

async function createCampaign({ station_id, name, start_date, end_date, hours_from, hours_to, user_id }) {
  await assertMigrated();
  if (!name || !String(name).trim()) throw badRequest('Give the campaign a name.');
  if (!start_date || !end_date)      throw badRequest('Set a start and an end date.');
  if ((hours_from == null) !== (hours_to == null)) {
    throw badRequest('Set both operating hours, or neither.');
  }
  const { rows } = await pool.query(
    `INSERT INTO gift_campaigns
       (station_id, name, start_date, end_date, hours_from, hours_to, created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [station_id, String(name).trim(), start_date, end_date, hours_from || null, hours_to || null, user_id || null]
  );
  return rows[0];
}

async function updateCampaign({ id, station_id, name, start_date, end_date, hours_from, hours_to }) {
  await assertMigrated();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertDraft(client, { id, station_id });
    const { rows } = await client.query(
      `UPDATE gift_campaigns SET
         name       = COALESCE($1, name),
         start_date = COALESCE($2, start_date),
         end_date   = COALESCE($3, end_date),
         hours_from = $4,
         hours_to   = $5,
         updated_at = NOW()
       WHERE id=$6 AND station_id=$7 RETURNING *`,
      [name || null, start_date || null, end_date || null,
       hours_from || null, hours_to || null, id, station_id]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function addTier({ campaign_id, station_id, fuel_type, min_litres, product_id, quantity }) {
  await assertMigrated();
  if (!FUELS.includes(fuel_type)) throw badRequest(`Fuel must be one of: ${FUELS.join(', ')}.`);
  const litres = Number(min_litres);
  const qty    = Number(quantity ?? 1);
  if (!Number.isFinite(litres) || litres <= 0) throw badRequest('Set the litres this tier starts at.');
  if (!Number.isFinite(qty) || qty <= 0)       throw badRequest('Set how much of the gift is given.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertDraft(client, { id: campaign_id, station_id });

    // Re-scope the product to the station: a catalogue id from another outlet
    // must not become a gift here even though station_id passed the route guard.
    const { rows: pr } = await client.query(
      `SELECT id FROM products WHERE id=$1 AND station_id=$2 AND is_active = TRUE`,
      [product_id, station_id]
    );
    if (!pr.length) throw notFound('That gift is not in this outlet’s catalogue.');

    const { rows } = await client.query(
      `INSERT INTO gift_campaign_tiers
         (campaign_id, station_id, fuel_type, min_litres, product_id, quantity)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [campaign_id, station_id, fuel_type, litres, product_id, qty]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    // gct_rung_uniq — two rungs at one threshold would make the award ambiguous
    // at exactly the moment it matters, so the database refuses it.
    if (e.code === '23505') {
      throw badRequest(`There is already a ${fuel_type.replace('_', ' ')} tier at ${min_litres} L.`);
    }
    throw e;
  } finally { client.release(); }
}

async function removeTier({ tier_id, station_id }) {
  await assertMigrated();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: t } = await client.query(
      `SELECT campaign_id FROM gift_campaign_tiers WHERE id=$1 AND station_id=$2`,
      [tier_id, station_id]
    );
    if (!t.length) throw notFound('Tier not found.');
    await assertDraft(client, { id: t[0].campaign_id, station_id });
    await client.query(`DELETE FROM gift_campaign_tiers WHERE id=$1`, [tier_id]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// START — the moment the rules freeze.
//
// The "no two campaigns on the same fuel at the same time" rule is enforced HERE
// and not at save, so a draft can be built while another campaign runs. It cannot
// be a database constraint because the fuel lives on the tiers, not the campaign,
// and an exclusion constraint cannot reach across the join.
async function startCampaign({ id, station_id }) {
  await assertMigrated();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertDraft(client, { id, station_id });

    const { rows: tiers } = await client.query(
      `SELECT DISTINCT fuel_type FROM gift_campaign_tiers WHERE campaign_id=$1`, [id]);
    if (!tiers.length) {
      throw badRequest('Add at least one tier before starting — a campaign with no gift has nothing to give.');
    }
    const fuels = tiers.map(t => t.fuel_type);

    const { rows: clash } = await client.query(
      `SELECT DISTINCT c.name, t.fuel_type
         FROM gift_campaigns c
         JOIN gift_campaign_tiers t ON t.campaign_id = c.id
        WHERE c.station_id = $1
          AND c.id <> $2
          AND c.status = 'running'
          AND t.fuel_type = ANY($3::varchar[])
          AND c.start_date <= (SELECT end_date   FROM gift_campaigns WHERE id=$2)
          AND c.end_date   >= (SELECT start_date FROM gift_campaigns WHERE id=$2)`,
      [station_id, id, fuels]
    );
    if (clash.length) {
      const f = [...new Set(clash.map(r => r.fuel_type.replace('_', ' ')))].join(', ');
      throw badRequest(
        `${clash[0].name} is already running on ${f} over these dates. Close it first — two campaigns on one fuel would make the gift ambiguous.`,
        { clashes: clash }
      );
    }

    const { rows } = await client.query(
      `UPDATE gift_campaigns SET status='running', started_at=NOW(), updated_at=NOW()
        WHERE id=$1 RETURNING *`, [id]);
    await client.query('COMMIT');
    return rows[0];
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function stopCampaign({ id, station_id }) {
  await assertMigrated();
  const { rows } = await pool.query(
    `UPDATE gift_campaigns SET status='closed', closed_at=NOW(), updated_at=NOW()
      WHERE id=$1 AND station_id=$2 AND status='running' RETURNING *`,
    [id, station_id]
  );
  if (!rows.length) throw badRequest('Only a running campaign can be closed.');
  return rows[0];
}

module.exports = {
  FUELS,
  listCampaigns,
  getCampaign,
  eligibleTier,
  createCampaign,
  updateCampaign,
  addTier,
  removeTier,
  startCampaign,
  stopCampaign,
  migrated,
};
