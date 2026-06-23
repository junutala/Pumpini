// src/routes/corporate.js
const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const {
  requireStationAccess, requireCorporateAccess,
  getAccessibleStationIds, canAccessStation, canAccessCorporate,
} = require('../middleware/stationAccess');

// ── Duplicate check helper ──────────────────────────────────
// stationIds scopes the search to the caller's own outlets: the same real-world
// customer is a SEPARATE corporate account per owner group, so a duplicate hit
// must never reveal (or block on) another tenant's customer list.
const checkDuplicates = async (gstn, phone, excludeId = null, stationIds = null) => {
  const warnings = [];
  const scope = stationIds ? ' AND csl.station_id = ANY($SCOPE::uuid[])' : '';
  if (gstn) {
    const p = excludeId ? [gstn, excludeId] : [gstn];
    if (stationIds) p.push(stationIds);
    const { rows } = await pool.query(
      `SELECT DISTINCT ca.id, ca.company_name, s.name AS station_name
       FROM corporate_accounts ca
       JOIN corporate_station_links csl ON csl.corporate_id = ca.id
       JOIN stations s ON s.id = csl.station_id
       WHERE ca.gst_number = $1 AND ca.merged_into_id IS NULL
       ${excludeId ? 'AND ca.id != $2' : ''}
       ${scope.replace('$SCOPE', `$${p.length}`)}
       LIMIT 3`,
      p
    );
    if (rows.length) {
      warnings.push({
        type:    'gstn',
        level:   'error',
        message: `GSTN ${gstn} already exists`,
        matches: rows,
      });
    }
  }
  if (phone) {
    const p = excludeId ? [phone, excludeId] : [phone];
    if (stationIds) p.push(stationIds);
    const { rows } = await pool.query(
      `SELECT DISTINCT ca.id, ca.company_name, s.name AS station_name
       FROM corporate_accounts ca
       JOIN corporate_station_links csl ON csl.corporate_id = ca.id
       JOIN stations s ON s.id = csl.station_id
       WHERE ca.contact_phone = $1 AND ca.merged_into_id IS NULL
       ${excludeId ? 'AND ca.id != $2' : ''}
       ${scope.replace('$SCOPE', `$${p.length}`)}
       LIMIT 3`,
      p
    );
    if (rows.length) {
      warnings.push({
        type:    'phone',
        level:   'warning',
        message: `Phone ${phone} already used by another account`,
        matches: rows,
      });
    }
  }
  return warnings;
};

// GET /api/corporate — list for a station
router.get('/', authenticate, requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id } = req.query;
    let q = `
      SELECT 
        ca.id, ca.company_name, ca.contact_person, ca.contact_phone,
        ca.email, ca.gst_number, ca.gstn, ca.address, ca.is_active,
        ca.merged_into_id,
        csl.credit_limit, csl.payment_terms, csl.is_active AS link_active,
        csl.id AS link_id, csl.station_id,
        -- Control-total model: credit isn't tagged to a customer at the pump, so
        -- a customer's liability = what we've invoiced them − what they've paid.
        ( COALESCE((SELECT SUM(gi.total_amount) FROM gst_invoices gi
                    WHERE gi.corporate_id=ca.id AND gi.station_id=csl.station_id),0)
        - COALESCE((SELECT SUM(cr.amount) FROM corporate_receipts cr
                    WHERE cr.corporate_id=ca.id AND cr.station_id=csl.station_id),0)
        ) AS current_outstanding
      FROM corporate_accounts ca
      JOIN corporate_station_links csl ON csl.corporate_id = ca.id
      WHERE ca.merged_into_id IS NULL AND ca.is_active = TRUE
    `;
    const p = [];
    if (station_id) { p.push(station_id); q += ` AND csl.station_id=$${p.length}`; }
    q += ' ORDER BY ca.company_name';
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/corporate/all — every corp across the CALLER'S stations (merge UI)
router.get('/all', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const ids = await getAccessibleStationIds(req.user.id);
    if (!ids.length) return res.json([]);
    const { rows } = await pool.query(`
      SELECT ca.*,
        array_agg(DISTINCT s.name) AS stations,
        COUNT(DISTINCT csl.station_id)::int AS station_count,
        COUNT(DISTINCT de.id)::int AS total_transactions
      FROM corporate_accounts ca
      LEFT JOIN corporate_station_links csl ON csl.corporate_id = ca.id
      LEFT JOIN stations s ON s.id = csl.station_id
      LEFT JOIN dispense_events de ON de.corporate_id = ca.id AND NOT COALESCE(de.is_voided,FALSE)
      WHERE ca.merged_into_id IS NULL
        AND ( ca.created_by_station = ANY($1::uuid[])
           OR EXISTS (SELECT 1 FROM corporate_station_links l
                       WHERE l.corporate_id = ca.id AND l.station_id = ANY($1::uuid[])) )
      GROUP BY ca.id ORDER BY ca.company_name`, [ids]);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/corporate/check-duplicate — real-time duplicate check (own outlets only)
router.post('/check-duplicate', authenticate, async (req, res, next) => {
  try {
    const { gstn, phone, exclude_id } = req.body;
    const ids = await getAccessibleStationIds(req.user.id);
    if (!ids.length) return res.json({ warnings: [] });
    const warnings = await checkDuplicates(gstn, phone, exclude_id, ids);
    res.json({ warnings });
  } catch (err) { next(err); }
});

// POST /api/corporate — create new
router.post('/', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const {
      company_name, contact_person, contact_phone, email,
      gst_number, gstn, pan, address,
      station_id, credit_limit, payment_terms = 30,
      force_create = false, // skip duplicate warning
    } = req.body;

    const effectiveGstn = gstn || gst_number;

    // The new account (and its credit limit) hangs off a station — the caller
    // must own that station.
    if (!station_id) return res.status(400).json({ error: 'station_id is required' });
    if (!(await canAccessStation(req.user.id, station_id))) {
      return res.status(403).json({ error: 'You do not have access to this station.' });
    }

    // Duplicate check — block on GSTN match unless force_create
    if (!force_create) {
      const ids = await getAccessibleStationIds(req.user.id);
      const warnings = await checkDuplicates(effectiveGstn, contact_phone, null, ids);
      const errors = warnings.filter(w => w.level === 'error');
      if (errors.length) {
        return res.status(409).json({
          error:    'Potential duplicate detected',
          warnings,
          can_force: true,
        });
      }
    }

    // Run the create on the bypass owner role (als.run(undefined,…)) — the same fix
    // as Add-Attendant. A manager's app_authenticated identity can't satisfy the
    // corporate_accounts insert policy for a brand-new account, and the duplicate
    // trigger needs to read across ALL outlets to enforce GSTN uniqueness. Still
    // fully authorized above (owner/manager + canAccessStation); the row is stamped
    // created_by_station = the verified station, so per-tenant reads stay scoped.
    const corp = await pool.als.run(undefined, async () => {
      const client = await pool.connect();   // no ALS store → raw bypass owner client
      try {
        await client.query('BEGIN');

        const { rows } = await client.query(
          `INSERT INTO corporate_accounts(
             company_name, contact_person, contact_phone, email,
             gst_number, gstn, pan, address, is_active, created_by_station
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9) RETURNING *`,
          [company_name, contact_person||null, contact_phone||null,
           email||null, effectiveGstn||null, effectiveGstn||null,
           pan||null, address||null, station_id||null]
        );

        const created = rows[0];

        // Create station link
        if (station_id && credit_limit !== undefined) {
          await client.query(
            `INSERT INTO corporate_station_links(corporate_id,station_id,credit_limit,payment_terms)
             VALUES($1,$2,$3,$4) ON CONFLICT(corporate_id,station_id) DO NOTHING`,
            [created.id, station_id, credit_limit, payment_terms]
          );
        }

        await client.query('COMMIT');
        return created;
      } catch(e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    });

    res.status(201).json(corp);
  } catch (err) { next(err); }
});

// PATCH /api/corporate/:id — update master record
router.patch('/:id', authenticate, authorize('owner','manager'), requireCorporateAccess(), async (req, res, next) => {
  try {
    const {
      company_name, contact_person, contact_phone,
      email, gst_number, gstn, pan, address,
    } = req.body;
    const effectiveGstn = gstn || gst_number;
    const { rows } = await pool.query(
      `UPDATE corporate_accounts SET
         company_name=COALESCE($1,company_name),
         contact_person=COALESCE($2,contact_person),
         contact_phone=COALESCE($3,contact_phone),
         email=COALESCE($4,email),
         gst_number=COALESCE($5,gst_number),
         gstn=COALESCE($5,gstn),
         pan=COALESCE($6,pan),
         address=COALESCE($7,address)
       WHERE id=$8 RETURNING *`,
      [company_name, contact_person, contact_phone,
       email, effectiveGstn, pan, address, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Station links ───────────────────────────────────────────

// POST /api/corporate/:id/links — link to a station
router.post('/:id/links', authenticate, authorize('owner','manager'), requireCorporateAccess(), requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { station_id, credit_limit, payment_terms = 30 } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO corporate_station_links(corporate_id,station_id,credit_limit,payment_terms)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(corporate_id,station_id) DO UPDATE SET
         credit_limit=$3, payment_terms=$4, is_active=TRUE
       RETURNING *`,
      [req.params.id, station_id, credit_limit, payment_terms]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/corporate/:id/links — get all station links for a corporate
router.get('/:id/links', authenticate, requireCorporateAccess(), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT csl.*, s.name AS station_name, s.city, s.state,
        COALESCE((
          SELECT SUM(de.amount) FROM dispense_events de
          WHERE de.corporate_id=csl.corporate_id AND de.station_id=csl.station_id
            AND de.payment_mode='credit' AND (de.is_invoiced IS NULL OR de.is_invoiced=FALSE)
            AND NOT COALESCE(de.is_voided,FALSE)
        ),0) AS current_outstanding
      FROM corporate_station_links csl
      JOIN stations s ON s.id = csl.station_id
      WHERE csl.corporate_id = $1 ORDER BY s.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /api/corporate/:id/links/:station_id — update link
router.patch('/:id/links/:station_id', authenticate, authorize('owner','manager'), requireCorporateAccess(), requireStationAccess({ required: true }), async (req, res, next) => {
  try {
    const { credit_limit, payment_terms, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE corporate_station_links SET
         credit_limit=COALESCE($1,credit_limit),
         payment_terms=COALESCE($2,payment_terms),
         is_active=COALESCE($3,is_active)
       WHERE corporate_id=$4 AND station_id=$5 RETURNING *`,
      [credit_limit, payment_terms, is_active, req.params.id, req.params.station_id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Merge ───────────────────────────────────────────────────

// POST /api/corporate/merge — merge two accounts (superadmin or owner)
router.post('/merge', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { master_id, duplicate_id } = req.body;
    if (master_id === duplicate_id) {
      return res.status(400).json({ error: 'Cannot merge account with itself' });
    }
    // Both sides of a merge must belong to the caller's outlets — merging
    // into (or out of) another tenant's account would move their credit data.
    const [okMaster, okDup] = await Promise.all([
      canAccessCorporate(req.user.id, master_id),
      canAccessCorporate(req.user.id, duplicate_id),
    ]);
    if (!okMaster || !okDup) {
      return res.status(403).json({ error: 'You do not have access to one of these corporate accounts.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Move all dispense_events to master
      await client.query(
        `UPDATE dispense_events SET corporate_id=$1 WHERE corporate_id=$2`,
        [master_id, duplicate_id]
      );

      // 2. Move station links — if master already has link for same station, skip
      await client.query(
        `INSERT INTO corporate_station_links(corporate_id,station_id,credit_limit,payment_terms)
         SELECT $1, station_id, credit_limit, payment_terms
         FROM corporate_station_links
         WHERE corporate_id=$2
         ON CONFLICT(corporate_id,station_id) DO NOTHING`,
        [master_id, duplicate_id]
      );

      // 3. Move drivers
      await client.query(
        `UPDATE corporate_drivers SET corporate_id=$1 WHERE corporate_id=$2`,
        [master_id, duplicate_id]
      );

      // 4. Move gst_invoices
      await client.query(
        `UPDATE gst_invoices SET corporate_id=$1 WHERE corporate_id=$2`,
        [master_id, duplicate_id]
      );

      // 5. Mark duplicate as merged
      await client.query(
        `UPDATE corporate_accounts SET merged_into_id=$1, is_active=FALSE WHERE id=$2`,
        [master_id, duplicate_id]
      );

      // 6. Update duplicate flags
      await client.query(
        `UPDATE corporate_duplicate_flags SET status='merged', resolved_at=NOW()
         WHERE (corp1_id=$1 AND corp2_id=$2) OR (corp1_id=$2 AND corp2_id=$1)`,
        [master_id, duplicate_id]
      );

      await client.query('COMMIT');

      // Return merged master
      const { rows } = await pool.query(
        'SELECT * FROM corporate_accounts WHERE id=$1', [master_id]
      );
      res.json({ merged: true, master: rows[0] });
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// A duplicate flag is "mine" when both flagged accounts belong to my outlets.
const ACCESSIBLE_CORP_SQL = `
  ( ca.created_by_station = ANY($IDS::uuid[])
    OR EXISTS (SELECT 1 FROM corporate_station_links l
                WHERE l.corporate_id = ca.id AND l.station_id = ANY($IDS::uuid[])) )`;

// GET /api/corporate/duplicates — pending duplicate flags within MY outlets
router.get('/duplicates', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const ids = await getAccessibleStationIds(req.user.id);
    if (!ids.length) return res.json([]);
    const { rows } = await pool.query(`
      SELECT cdf.*,
        ca1.company_name AS corp1_name, ca1.gst_number AS corp1_gstn,
        ca1.contact_phone AS corp1_phone,
        ca2.company_name AS corp2_name, ca2.gst_number AS corp2_gstn,
        ca2.contact_phone AS corp2_phone
      FROM corporate_duplicate_flags cdf
      JOIN corporate_accounts ca1 ON ca1.id = cdf.corp1_id
      JOIN corporate_accounts ca2 ON ca2.id = cdf.corp2_id
      WHERE cdf.status = 'pending'
        AND ${ACCESSIBLE_CORP_SQL.replace(/\$IDS/g, '$1').replace(/ca\./g, 'ca1.')}
        AND ${ACCESSIBLE_CORP_SQL.replace(/\$IDS/g, '$1').replace(/ca\./g, 'ca2.')}
      ORDER BY cdf.flagged_at DESC`, [ids]);
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /api/corporate/duplicates/:id/dismiss
router.patch('/duplicates/:id/dismiss', authenticate, authorize('owner','manager'), async (req, res, next) => {
  try {
    const { rows: flag } = await pool.query(
      'SELECT corp1_id, corp2_id FROM corporate_duplicate_flags WHERE id=$1', [req.params.id]);
    if (!flag.length) return res.status(404).json({ error: 'Flag not found' });
    const [ok1, ok2] = await Promise.all([
      canAccessCorporate(req.user.id, flag[0].corp1_id),
      canAccessCorporate(req.user.id, flag[0].corp2_id),
    ]);
    if (!ok1 || !ok2) {
      return res.status(403).json({ error: 'You do not have access to this duplicate flag.' });
    }
    await pool.query(
      `UPDATE corporate_duplicate_flags SET status='dismissed', resolved_at=NOW() WHERE id=$1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/corporate/:id/statement
router.get('/:id/statement', authenticate, requireCorporateAccess(), async (req, res, next) => {
  try {
    const { station_id, month, date_from, date_to } = req.query;
    let dateFrom = date_from;
    let dateTo   = date_to;

    // Support legacy month parameter
    if (!dateFrom && month) {
      dateFrom = `${month}-01`;
      const d = new Date(month + '-01');
      d.setMonth(d.getMonth() + 1);
      dateTo = d.toISOString().slice(0, 10);
    }

    let q = `
      SELECT de.*, u.name AS attendant_name, n.nozzle_number
      FROM dispense_events de
      LEFT JOIN users u ON u.id = de.attendant_id
      LEFT JOIN nozzles n ON n.id = de.nozzle_id
      WHERE de.corporate_id = $1 AND de.payment_mode = 'credit'
        AND NOT COALESCE(de.is_voided,FALSE)
    `;
    const p = [req.params.id];
    if (station_id) { p.push(station_id); q += ` AND de.station_id=$${p.length}`; }
    if (dateFrom)   { p.push(dateFrom);   q += ` AND de.occurred_at::date>=$${p.length}`; }
    if (dateTo)     { p.push(dateTo);     q += ` AND de.occurred_at::date<=$${p.length}`; }
    q += ' ORDER BY de.occurred_at DESC';

    const { rows } = await pool.query(q, p);
    const total = rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    res.json({ transactions: rows, total_amount: total });
  } catch (err) { next(err); }
});

// GET /api/corporate/:id/drivers
router.get('/:id/drivers', authenticate, requireCorporateAccess(), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM corporate_drivers WHERE corporate_id=$1 ORDER BY driver_name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/corporate/:id/drivers
router.post('/:id/drivers', authenticate, authorize('owner','manager'), requireCorporateAccess(), async (req, res, next) => {
  try {
    const { vehicle_number, driver_name, phone } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO corporate_drivers(corporate_id,vehicle_number,driver_name,phone)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [req.params.id, vehicle_number, driver_name||null, phone||null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/corporate/:id — get single
router.get('/:id', authenticate, requireCorporateAccess(), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ca.*,
         COALESCE((
           SELECT SUM(de.amount) FROM dispense_events de
           WHERE de.corporate_id=ca.id AND de.payment_mode='credit'
             AND (de.is_invoiced IS NULL OR de.is_invoiced=FALSE)
             AND NOT COALESCE(de.is_voided,FALSE)
         ),0) AS current_outstanding
       FROM corporate_accounts ca WHERE ca.id=$1`,
      [req.params.id]
    );
    res.json(rows[0] || {});
  } catch (err) { next(err); }
});

module.exports = router;
