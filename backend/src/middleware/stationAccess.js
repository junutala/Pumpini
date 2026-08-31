// src/middleware/stationAccess.js
//
// Horizontal access control. A logged-in user may only touch a station they
// belong to — either directly (station_users) or via an owner group
// (owner_group_members -> station_groups -> station_group_members).
//
// Without this, any authenticated user could read/write another station's data
// just by passing a different station_id (IDOR). The frontend only *shows* a
// user's own stations, but that is UI-only; this is the server-side boundary.
const pool = require('../db/pool');

// Short-lived cache so we don't hit the DB on every request.
const _cache = new Map(); // `${userId}:${stationId}` -> { ok, ts }
const TTL = 60 * 1000;

async function canAccessStation(userId, stationId) {
  if (!userId || !stationId) return false;
  const key = `${userId}:${stationId}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.ok;

  const { rows } = await pool.query(
    `SELECT 1
       WHERE EXISTS (
               SELECT 1 FROM station_users
               WHERE user_id = $1 AND station_id = $2
             )
          OR EXISTS (
               SELECT 1
               FROM owner_group_members ogm
               JOIN station_groups stg        ON stg.owner_group_id = ogm.group_id
               JOIN station_group_members sgm ON sgm.station_group_id = stg.id
               WHERE ogm.user_id = $1 AND sgm.station_id = $2
             )
       LIMIT 1`,
    [userId, stationId]
  );
  const ok = rows.length > 0;
  _cache.set(key, { ok, ts: Date.now() });
  return ok;
}

// Call after a station_users / owner-group membership change so a revoked user
// loses access within the cache window instead of up to TTL later.
function clearAccessCache(userId) {
  if (!userId) { _cache.clear(); return; }
  for (const k of _cache.keys()) if (k.startsWith(`${userId}:`)) _cache.delete(k);
}

const deny = (res) =>
  res.status(403).json({ error: 'You do not have access to this station.' });

// Guard on a station_id taken from params.station_id / query / body.
// opts.required=true rejects a MISSING station_id (so a list endpoint can't be
// turned into "return everything" by simply omitting the filter).
function requireStationAccess(opts = {}) {
  const { required = false } = opts;
  return async (req, res, next) => {
    try {
      const stationId =
        req.params?.station_id || req.query?.station_id || req.body?.station_id;
      if (!stationId) {
        return required
          ? res.status(400).json({ error: 'station_id is required' })
          : next();
      }
      req.stationId = stationId; // expose for requirePerm (runs after this guard)
      return (await canAccessStation(req.user.id, stationId)) ? next() : deny(res);
    } catch (err) { next(err); }
  };
}

// Guard where the station id IS a named URL param (e.g. /stations/:id/...).
function requireStationId(paramName = 'id') {
  return async (req, res, next) => {
    try {
      const stationId = req.params[paramName];
      if (!stationId) return next();
      req.stationId = stationId; // expose for requirePerm
      return (await canAccessStation(req.user.id, stationId)) ? next() : deny(res);
    } catch (err) { next(err); }
  };
}

// Guard a child resource: resolve its parent station via `sql` ($1 = the id
// read from req.params[key] or req.body[key]), then check membership.
// Unknown ids fall through (handler returns its own 404).
function requireStationVia(sql, key) {
  return async (req, res, next) => {
    try {
      const id = req.params?.[key] ?? req.query?.[key] ?? req.body?.[key];
      if (!id) return next();
      const { rows } = await pool.query(sql, [id]);
      const stationId = rows[0]?.station_id;
      if (!stationId) return next();
      req.stationId = stationId; // expose for requirePerm (station derived from resource id)
      return (await canAccessStation(req.user.id, stationId)) ? next() : deny(res);
    } catch (err) { next(err); }
  };
}

// All station ids a user may access (direct + via owner group). Used to
// auto-scope list endpoints that can be called without an explicit station_id.
async function getAccessibleStationIds(userId) {
  if (!userId) return [];
  const { rows } = await pool.query(
    `SELECT station_id FROM station_users WHERE user_id = $1
     UNION
     SELECT sgm.station_id
       FROM owner_group_members ogm
       JOIN station_groups stg        ON stg.owner_group_id = ogm.group_id
       JOIN station_group_members sgm ON sgm.station_group_id = stg.id
      WHERE ogm.user_id = $1`,
    [userId]
  );
  return rows.map(r => r.station_id);
}

// A corporate account is reachable if the user can access its owning station
// (corporate_accounts.created_by_station) OR any station it's linked to.
async function canAccessCorporate(userId, corporateId) {
  if (!userId || !corporateId) return false;
  const ids = await getAccessibleStationIds(userId);
  if (!ids.length) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM corporate_accounts ca
       WHERE ca.id = $1
         AND ( ca.created_by_station = ANY($2::uuid[])
            OR EXISTS (SELECT 1 FROM corporate_station_links csl
                        WHERE csl.corporate_id = ca.id
                          AND csl.station_id = ANY($2::uuid[])) )
       LIMIT 1`,
    [corporateId, ids]
  );
  return rows.length > 0;
}

// Guard a corporate-keyed route (req.params[paramName] = corporate id).
function requireCorporateAccess(paramName = 'id') {
  return async (req, res, next) => {
    try {
      const corporateId = req.params[paramName];
      if (!corporateId) return next();
      // The credit customer themselves (role=corporate) can see their own account
      if (req.user.corporate_id && req.user.corporate_id === corporateId) return next();
      return (await canAccessCorporate(req.user.id, corporateId))
        ? next()
        : res.status(403).json({ error: 'You do not have access to this corporate account.' });
    } catch (err) { next(err); }
  };
}

// Which of these nozzle ids do NOT belong to `stationId`. Returns [] when they
// all do (and for an empty list).
//
// WHY THIS EXISTS. `requireStationVia` proves the SHIFT belongs to a station the
// caller may reach, and every write is keyed on that shift — so the guard is
// what keeps one outlet's data out of another's. But a nozzle id arrives in the
// request BODY, and nothing re-checked that the nozzle sits at the same station
// as the shift. In practice the screens only ever offer the current station's
// nozzles, so this was safe by convention rather than by construction, and a
// convention is exactly what stops holding the week nobody is looking.
//
// It matters most where two outlets are deliberately made to LOOK alike: a test
// outlet set up to mirror a real one carries the same pump serials and nozzle
// numbers, and the only thing separating them is the id. Slip MATCHING is
// already station-scoped (`nozzles.station_id = req.stationId`), so a scan
// cannot cross outlets; this closes the same door on the ids we are handed.
async function nozzlesOutsideStation(stationId, nozzleIds, db = pool) {
  // Non-uuid text can match no nozzle, so it is the handler's 404, not a
  // cross-outlet write — and casting it here would 500 instead.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = [...new Set((nozzleIds || []).map(String).filter(id => UUID.test(id)))];
  if (!stationId || !ids.length) return [];
  const { rows } = await db.query(
    `SELECT id FROM nozzles WHERE id = ANY($1::uuid[]) AND station_id IS DISTINCT FROM $2`,
    [ids, stationId]
  );
  // An id matching no row is left alone for the same reason: a missing nozzle is
  // not another outlet's nozzle. IS DISTINCT FROM also rejects a nozzle with no
  // station at all — there are none today (66 rows, 0 null, checked 31-Aug-2026)
  // and if one ever appears, failing closed is the direction we want.
  return rows.map(r => String(r.id));
}

module.exports = {
  canAccessStation,
  getAccessibleStationIds,
  canAccessCorporate,
  clearAccessCache,
  requireStationAccess,
  requireStationId,
  requireStationVia,
  nozzlesOutsideStation,
  requireCorporateAccess,
};
