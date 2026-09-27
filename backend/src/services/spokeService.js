// SPOKES 2 AND 3 — the nozzle chain, and what the attendant owes.
//
// SPOKE 2: a nozzle carries ONE CHAIN of readings. Each reading closes the account
// before it and opens the one after — one number, stored once, read from both
// directions. There is no closing column and no opening column, so they cannot differ.
//
// SPOKE 3: the OUTSTANDING IS CALCULATED, never typed. It is derived from a man's own
// events, which is the structural fix for the 25-Aug loss of Rs 1,25,275: a manager
// cannot make a liability vanish by leaving a field blank, because there is no field.
// The only manual entry is what he BROUGHT.
//
// THE PUMP IS NEVER BLOCKED. If a man walks off without printing, the next man's scan
// IS the closing event and the outstanding stands against the man who left. The act of
// taking over is the act of closing, so there is nothing to freeze and no break-glass.
const pool  = require('../db/pool');
const pumps = require('./pumpService');

let _hasTables = false;
async function hasSpokeTables() {
  if (_hasTables) return true;
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='public'
          AND table_name IN ('nozzle_events','attendant_settlements')`);
    _hasTables = rows[0]?.n === 2;
  } catch { _hasTables = false; }
  return _hasTables;
}

// ── THE TWO PHYSICS TESTS ────────────────────────────────────────────────────
// A handover where the readings differ is USUALLY JUST FUEL SOLD IN THE GAP and must
// not raise an alarm — a manager who justifies three litres twice a day learns to
// click through it, and then a real reset sails past on the same habit. Only two
// conditions are certain, and they are physics rather than judgement.
//
// A totaliser only counts up: a decrease is always a reset, a replacement or a misread.
const MAX_FLOW_LTRS_PER_MIN = 40;   // a forecourt pump flat out
// Slack for a clock a few seconds out, so a legitimate back-to-back print at the same
// instant is not called impossible by arithmetic on a divide-by-nearly-zero.
const MIN_GAP_SECONDS = 30;

// tankLimit — the most this nozzle's tank could have given since the last reading
// (tankCeiling below), or null where there is no such bound.
//
// `final` is decided HERE, once, and every screen reads it rather than keeping its own
// list of which codes may be explained.
function physicsVerdict({ prevReading, prevAt, reading, at, tankLimit = null }) {
  if (prevReading == null) return null;
  const delta = Number(reading) - Number(prevReading);
  if (delta < 0) return { code: 'reading_decreased', delta, final: true };
  if (tankLimit != null && delta > Number(tankLimit)) {
    return { code: 'more_than_the_tank', delta, tank_limit: +Number(tankLimit).toFixed(2), final: true };
  }
  const seconds = Math.max(MIN_GAP_SECONDS,
    Math.round((new Date(at) - new Date(prevAt)) / 1000) || MIN_GAP_SECONDS);
  const ceiling = (seconds / 60) * MAX_FLOW_LTRS_PER_MIN;
  if (delta > ceiling) return { code: 'faster_than_the_pump', delta, seconds, ceiling: +ceiling.toFixed(2) };
  return null;   // everything else is trade. Record the drift, stay silent.
}

// ── THE TANK CEILING ─────────────────────────────────────────────────────────
// THE PUMP-SPEED TEST GROWS WITH THE GAP, so over a long leg it stops being a test: eight
// hours allows 19,200 L. The MBR rehearsal of 27-Sep-2026 typed 19902.9 for 1990.29 — one
// decimal place — across an eight-hour leg, and it went through without a murmur: 17,912 L
// charged to one man, ₹15.99 lakh, on a nozzle whose tank holds 15,000.
//
// A nozzle cannot give more than its tank held plus what was delivered into it. That is
// physics, not judgement, so like a decrease it is FINAL — there is no reason a man can
// type that makes a tank give more than it holds. The one real way to exceed it, a tanker
// not yet entered, has its own answer on the refusal: enter the delivery first.
//
// Deliberately generous, because a false refusal stops a handover:
//   * capacity × 1.10 — the nameplate is not the shell. A tank called 16 KL holds
//     17,279 L (CLAUDE.md, calibration authorities), and capacities here are nameplates.
//   * deliveries from a day BEFORE the last reading — received_at is often an invoice
//     date read off paper, and a day early only loosens the bound.
//   * CNG is skipped. Its "tank" is a cascade topped up continuously by a compressor;
//     Kamala's is configured at 500 and has legs of 1,281. There is no ceiling to test.
//
// Checked against production 27-Sep-2026 before it was written: 1,966 shift legs on the
// real outlets' liquid-fuel tanks, the largest 20% of its tank (Highway tank 2, 4,405 of
// 22,000), none over 110%. The bound would never have fired on a real leg.
const TANK_SLACK = 1.10;
async function tankCeiling(nozzle_id, sinceAt, client = pool) {
  if (!sinceAt) return null;
  const { rows } = await client.query(
    `SELECT t.capacity_ltrs,
            COALESCE((SELECT SUM(GREATEST(COALESCE(fd.gross_volume_ltrs, 0), COALESCE(fd.net_volume_ltrs, 0)))
                        FROM fuel_deliveries fd
                       WHERE fd.tank_id = t.id
                         AND COALESCE(fd.received_at, fd.created_at) >= $2::timestamptz - interval '1 day'), 0)
              AS delivered
       FROM nozzles n JOIN tanks t ON t.id = n.tank_id
      WHERE n.id = $1 AND COALESCE(lower(t.fuel_type), '') <> 'cng'`,
    [nozzle_id, sinceAt]);
  const cap = Number(rows[0]?.capacity_ltrs);
  if (!rows.length || !Number.isFinite(cap) || cap <= 0) return null;
  return cap * TANK_SLACK + (Number(rows[0].delivered) || 0);
}

// MAY THIS READING BE RECORDED? Pure, so it can be tested without a database.
//
//   'ok'       — no physics objection
//   'reason'   — FASTER THAN THE PUMP: refused until he explains in his own words.
//                A clock a minute out, or a test draw, can make a real reading look
//                fast; the reason box exists for that.
//   'refuse'   — THE READING WENT DOWN. Refused whatever he types. A totaliser only
//                counts up, so a decrease is a misread, a reset or a replacement —
//                and a reset is a new starting point for the chain, which is a
//                commissioning act in Settings under the owner's eye, never a number
//                on a handover screen (CLAUDE.md, Flow v2).
//
// 🔴 WHY 'refuse' HAS NO WAY ROUND IT. On 23-Sep-2026 at MBR, 1.1 was reassigned at
// 1255 when the last reading was 1925 — a typo. The reason box accepted "Hdjsjsjsbsn",
// the GREATEST(…,0) floor turned the leg into 0 L, the man leaving was charged ₹0 and
// dropped off Attendant Close, and the man taking over was opened 670 L too low — so
// his next close would have carried the outgoing man's litres and the gap. A reason
// box on a decrease is a click-through, and a click-through on money is a loss.
function mayRecord(verdict, drift_reason) {
  if (!verdict) return 'ok';
  if (verdict.final) return 'refuse';
  return String(drift_reason || '').trim() ? 'ok' : 'reason';
}

// IS THIS A READING AT ALL? Pure, so it can be tested without a database.
//
// Digits and one decimal point. "1,990.29" used to reach Postgres and come back as a
// 500 with the database's own error text (MBR rehearsal, 27-Sep-2026); a meter figure
// the screen cannot read is a question for the person typing it, not a crash.
const READING_RE = /^\s*\d+(\.\d+)?\s*$/;
function readingProblem(reading) {
  if (reading === null || reading === undefined || reading === '') return 'no_reading';
  if (typeof reading === 'string' && !READING_RE.test(reading)) return 'bad_reading';
  const x = Number(reading);
  if (!Number.isFinite(x) || x < 0) return 'bad_reading';
  return null;
}

async function lastEvent(nozzle_id, client = pool) {
  const { rows } = await client.query(
    `SELECT * FROM nozzle_events WHERE nozzle_id=$1 ORDER BY recorded_at DESC, created_at DESC LIMIT 1`,
    [nozzle_id]);
  return rows[0] || null;
}

// RECORD A HANDOVER. One reading, which closes one man's account and opens the next's.
// Returns { event, refused } — refused when the physics says the figure cannot be true
// and no reason was given for it.
// WHO IT CLOSES IS DERIVED, NEVER TYPED. It is the man the previous event OPENED — the
// chain already knows, and asking a screen to say so is asking for the wrong man to be
// struck. A manager who is himself short would only have to pick a different name.
// Spoke 3's outstanding is calculated from these rows, so this is the same rule one
// step upstream: the only thing a person enters is what he BROUGHT.
//
// 🔴 WHOSE NOZZLE, WHOSE MAN — both checked here, in the one writer. The MBR rehearsal
// of 27-Sep-2026 wrote ANOTHER outlet's nozzle onto MBR's chain: the row carried MBR's
// station, so row-level security passed it, and the foreign chain was invisible, so the
// reading was taken as a first one. The same gap let a nozzle be opened to any user at
// all. The screens never send either, but the writer must not depend on the screens.
async function recordEvent({ station_id, nozzle_id, reading,
                             opens_attendant_id, source, recorded_by, drift_reason,
                             read_pump_serial, read_nozzle_no, at }) {
  if (!(await hasSpokeTables())) return null;
  const badReading = readingProblem(reading);
  if (badReading) return { invalid: badReading };
  if (!UUID_RE.test(String(nozzle_id || ''))) return { invalid: 'nozzle_not_at_outlet' };
  if (opens_attendant_id && !UUID_RE.test(String(opens_attendant_id))) {
    return { invalid: 'not_an_attendant_here' };
  }
  reading = Number(reading);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The chain is per nozzle, so the lock is per nozzle: two managers closing two
    // different pumps must not queue behind each other.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(nozzle_id)]);

    const { rows: own } = await client.query(
      `SELECT 1 FROM nozzles WHERE id = $1 AND station_id = $2`, [nozzle_id, station_id]);
    if (!own.length) { await client.query('ROLLBACK'); return { invalid: 'nozzle_not_at_outlet' }; }
    if (opens_attendant_id) {
      const { rows: who } = await client.query(
        `SELECT 1 FROM users u JOIN station_users su ON su.user_id = u.id
          WHERE u.id = $1 AND su.station_id = $2 AND u.role = 'attendant'`,
        [opens_attendant_id, station_id]);
      if (!who.length) { await client.query('ROLLBACK'); return { invalid: 'not_an_attendant_here' }; }
    }

    const prev = await lastEvent(nozzle_id, client);
    const now = at ? new Date(at) : new Date();
    const verdict = physicsVerdict({
      prevReading: prev?.reading, prevAt: prev?.recorded_at, reading, at: now,
      tankLimit: prev ? await tankCeiling(nozzle_id, prev.recorded_at, client) : null,
    });

    // A CERTAIN IMPOSSIBILITY IS REFUSED UNLESS HE EXPLAINS IT IN HIS OWN WORDS. Never
    // a dropdown: a canned reason code becomes a reflex. A meter RESET is not a reason
    // typed on a handover screen either — it is a commissioning action in Settings,
    // under the owner's eye, because the chain needs a new starting point.
    const may = mayRecord(verdict, drift_reason);
    if (may !== 'ok') {
      await client.query('ROLLBACK');
      return { refused: { ...verdict, final: may === 'refuse' } };
    }

    // Read off the chain inside the same lock, so two handovers on one nozzle cannot
    // both close the same man.
    const closes_attendant_id = prev?.opens_attendant_id || null;
    const isCo = prev != null && Number(prev.reading) === Number(reading);
    // THE CO-EVENT'S METRIC, and only the co-event's: the gap between the outgoing
    // man's print and the incoming man's, for the owner to push the manager on. On an
    // ordinary handover the same subtraction is just the length of the leg — eight
    // hours under a clock icon read as eight hours of indiscipline (MBR rehearsal,
    // 27-Sep-2026). So it is stored only where it means what it says.
    const driftSeconds = prev && isCo
      ? Math.round((now - new Date(prev.recorded_at)) / 1000)
      : null;

    const { rows } = await client.query(
      `INSERT INTO nozzle_events(station_id, nozzle_id, closes_attendant_id,
         opens_attendant_id, reading, recorded_at, source, is_co_event, prev_event_id,
         drift_seconds, drift_reason, read_pump_serial, read_nozzle_no, recorded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [station_id, nozzle_id, closes_attendant_id || null, opens_attendant_id || null,
       reading, now, (source === 'photo' || source === 'typed') ? source : null,
       isCo, prev ? prev.id : null, driftSeconds,
       String(drift_reason || '').trim() || null,
       read_pump_serial || null, read_nozzle_no || null, recorded_by || null]);

    await client.query('COMMIT');
    return { event: rows[0], co_event: isCo, drift_seconds: driftSeconds };
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}

// WHERE EVERY NOZZLE STANDS RIGHT NOW — its last reading, when it was taken, and the
// man it is currently open against. This is what the handover screen needs before it
// can ask for anything: the manager sees the number the pump last printed and the name
// the account stands against, so he is confirming rather than remembering.
//
// A nozzle with no events at all has not been commissioned. It appears with nulls
// rather than being hidden, because a missing nozzle is a question and an empty row is
// an answer.
async function nozzleState(station_id) {
  const pumps = require('./pumpService');
  const nm = await pumps.nozzleNameSelect(pool);
  if (!(await hasSpokeTables())) {
    const { rows } = await pool.query(
      `SELECT n.id, n.nozzle_number, n.fuel_type ${nm.col}
         FROM nozzles n ${nm.join}
        WHERE n.station_id=$1 AND COALESCE(n.is_active, TRUE)
        ORDER BY n.nozzle_number`, [station_id]);
    return rows.map(r => ({ ...r, reading: null, recorded_at: null, on_attendant_id: null }));
  }
  const { rows } = await pool.query(
    `SELECT n.id, n.nozzle_number, n.fuel_type ${nm.col},
            e.reading, e.recorded_at, e.opens_attendant_id AS on_attendant_id,
            u.name AS on_attendant_name
       FROM nozzles n
       ${nm.join}
       LEFT JOIN LATERAL (
         SELECT * FROM nozzle_events ev
          WHERE ev.nozzle_id = n.id
          ORDER BY ev.recorded_at DESC, ev.created_at DESC LIMIT 1
       ) e ON true
       LEFT JOIN users u ON u.id = e.opens_attendant_id
      WHERE n.station_id=$1 AND COALESCE(n.is_active, TRUE)
      ORDER BY n.nozzle_number`, [station_id]);
  return rows;
}

// THE CHAIN, newest first, for one outlet.
async function chain(station_id, { nozzle_id = null, limit = 100 } = {}) {
  if (!(await hasSpokeTables())) return [];
  const pumps = require('./pumpService');
  const nm = await pumps.nozzleNameSelect(pool);
  const { rows } = await pool.query(
    `SELECT e.*, ${nm.col.replace(/^,\s*/, '')}
       FROM nozzle_events e
       JOIN nozzles n ON n.id = e.nozzle_id
       ${nm.join}
      WHERE e.station_id = $1 AND ($2::uuid IS NULL OR e.nozzle_id = $2::uuid)
      ORDER BY e.recorded_at DESC LIMIT $3`,
    [station_id, nozzle_id, Math.min(Number(limit) || 100, 500)]);
  return rows;
}

// ── TEST DRAWS ARE NOT SALES ─────────────────────────────────────────────────
// A calibration draw runs ~5 L through the meter into a can and pours it back. The
// totaliser counted it; nobody bought it. The shift flow has always taken it off the
// operator's sale (testDrawService); the nozzle flow did not, and the MBR rehearsal of
// 27-Sep-2026 charged a man ₹581.75 for a 5 L can check.
//
// A draw belongs to the leg it happened in: on the same nozzle, after the reading that
// opened the leg and no later than the one that closes it. ONE FRAGMENT, used by
// outstanding(), outstandingDetail() and — with the leg's end still open — by
// handoverPreview(), so the three can never disagree about what a leg is worth.
// It expects the closing event as `e` and the opening event as `p`.
const LEG_TEST_LTRS = `COALESCE((SELECT SUM(td.litres) FROM fuel_test_draws td
       WHERE td.nozzle_id = e.nozzle_id AND p.recorded_at IS NOT NULL
         AND td.drawn_at > p.recorded_at AND td.drawn_at <= e.recorded_at), 0)`;

// ── SPOKE 3 ──────────────────────────────────────────────────────────────────
// WHAT A MAN OWES, DERIVED. His litres are the sum of every closing he was on, priced
// at the fuel's current rate, less what he has already handed over.
//
// It is a LIABILITY that stands until cleared, exactly as credit_suspense_entries
// already does — and nothing silently zeroes it. A man with an outstanding works his
// next shift; he simply cannot reach zero until he settles. The money clock never
// blocks the forecourt.
async function outstanding(station_id) {
  if (!(await hasSpokeTables())) return [];
  const { rows } = await pool.query(
    `WITH legs AS (
       -- Each event closes the man named on it, over the movement since the event
       -- before, less any test draw poured back in between. A co-event moves nothing
       -- and contributes nothing.
       SELECT e.closes_attendant_id AS attendant_id,
              n.fuel_type,
              GREATEST(e.reading - COALESCE(p.reading, e.reading) - ${LEG_TEST_LTRS}, 0) AS ltrs,
              e.recorded_at
         FROM nozzle_events e
         JOIN nozzles n ON n.id = e.nozzle_id
         LEFT JOIN nozzle_events p ON p.id = e.prev_event_id
        WHERE e.station_id = $1 AND e.closes_attendant_id IS NOT NULL
     ),
     priced AS (
       SELECT l.attendant_id,
              SUM(l.ltrs) AS ltrs,
              -- The CURRENT price for that fuel. Price changes are not this system's
              -- problem (owner-set 27-Aug): the price is updated by hand at the
              -- controller and by hand in Pumpini, and there is no gating pre/post
              -- change to build.
              SUM(l.ltrs * COALESCE(pr.price, 0)) AS value,
              MAX(l.recorded_at) AS last_close
         FROM legs l
         LEFT JOIN LATERAL (
           SELECT fp.price FROM fuel_prices fp
            WHERE fp.station_id = $1 AND fp.fuel_type = l.fuel_type
            ORDER BY fp.effective_from DESC LIMIT 1
         ) pr ON true
        GROUP BY l.attendant_id
     ),
     brought AS (
       SELECT attendant_id,
              SUM(cash + upi + card + credit + petty) AS handed_over,
              MAX(settled_at) AS last_settled
         FROM attendant_settlements WHERE station_id = $1 GROUP BY attendant_id
     )
     SELECT u.id AS attendant_id, u.name,
            COALESCE(p.ltrs, 0)   AS ltrs,
            COALESCE(p.value, 0)  AS value,
            COALESCE(b.handed_over, 0) AS handed_over,
            COALESCE(p.value, 0) - COALESCE(b.handed_over, 0) AS outstanding,
            p.last_close, b.last_settled
       FROM priced p
       FULL JOIN brought b ON b.attendant_id = p.attendant_id
       JOIN users u ON u.id = COALESCE(p.attendant_id, b.attendant_id)
      ORDER BY (COALESCE(p.value,0) - COALESCE(b.handed_over,0)) DESC`,
    [station_id]);
  return rows;
}

// WHO IS HOLDING A NOZZLE RIGHT NOW, and which ones.
//
// outstanding() answers "who owes what", and it derives that from CLOSINGS — so a man
// who has taken a nozzle and not yet handed it over does not appear in it at all. He
// owes nothing yet, which is true, and he is also the man most likely to be standing
// in front of the manager wanting to go home.
//
// Owner, 23-Sep-2026: Attendant Close should "show all the attendants who have assigned
// nozzles and let the flow start from there instead of the current LOV for attendants."
//
// Built on nozzleState() rather than a second query: that function is already the one
// answer to "where does each nozzle stand", and a second SELECT over nozzle_events
// would be a second answer waiting to disagree with it.
async function holdings(station_id) {
  if (!(await hasSpokeTables())) return [];
  const nozzles = await nozzleState(station_id);
  const by = new Map();
  for (const n of nozzles) {
    if (!n.on_attendant_id) continue;
    if (!by.has(n.on_attendant_id)) {
      by.set(n.on_attendant_id, {
        attendant_id: n.on_attendant_id,
        name: n.on_attendant_name || null,
        nozzles: [],
      });
    }
    by.get(n.on_attendant_id).nozzles.push({
      nozzle_id: n.id,
      nozzle_name: n.nozzle_name ?? n.nozzle_number ?? null,
      fuel_type: n.fuel_type,
      reading: n.reading,
      since: n.recorded_at,
    });
  }
  return [...by.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

// THE WORKING BEHIND ONE MAN'S OUTSTANDING — every leg, both readings, the price.
//
// outstanding() derives each leg and then SUMs it away, so the screen could only ever
// show a total. Owner, 29-Aug-2026: "wherever money is involved, we should show as
// much info as possible so that the manager also knows that we are supporting him in
// his work rather than extending his work."
//
// He is right, and today proved the cost of the alternative. The slip reader handed a
// manager confident figures he could not check; he checked them himself, found them
// wrong, and stopped using it. A calculated outstanding he cannot audit is the same
// trap in better clothes — and the first time it disagrees with his own arithmetic he
// goes back to the register.
//
// So every row here is two readings off two slips HE photographed, with the
// subtraction and the multiplication shown. He verifies one line against paper in ten
// seconds, and after that he stops verifying. That is what trust is.
//
// Same shape as outstanding() deliberately — the same legs, the same test-draw
// fragment, the same price lookup, the same GREATEST() floor — so the lines can never
// sum to a different figure than the total they sit under. The test litres come back
// as their own column: a line that silently came out 5 L short of the two readings
// would be a line he could not check.
async function outstandingDetail(station_id, attendant_id) {
  if (!(await hasSpokeTables())) return [];
  const pumps = require('./pumpService');
  const nm = await pumps.nozzleNameSelect(pool, { n: 'n', p: '_np' });
  const { rows } = await pool.query(
    `SELECT e.id AS event_id,
            n.id AS nozzle_id, n.fuel_type${nm.col},
            p.reading      AS opened_at_reading,
            e.reading      AS closed_at_reading,
            ${LEG_TEST_LTRS} AS test_ltrs,
            GREATEST(e.reading - COALESCE(p.reading, e.reading) - ${LEG_TEST_LTRS}, 0) AS ltrs,
            COALESCE(pr.price, 0) AS price,
            GREATEST(e.reading - COALESCE(p.reading, e.reading) - ${LEG_TEST_LTRS}, 0) * COALESCE(pr.price, 0) AS value,
            p.recorded_at  AS opened_at,
            e.recorded_at  AS closed_at,
            e.is_co_event,
            e.source
       FROM nozzle_events e
       JOIN nozzles n ON n.id = e.nozzle_id
       ${nm.join}
       LEFT JOIN nozzle_events p ON p.id = e.prev_event_id
       LEFT JOIN LATERAL (
         SELECT fp.price FROM fuel_prices fp
          WHERE fp.station_id = $1 AND fp.fuel_type = n.fuel_type
          ORDER BY fp.effective_from DESC LIMIT 1
       ) pr ON true
      WHERE e.station_id = $1 AND e.closes_attendant_id = $2
      ORDER BY e.recorded_at DESC, n.nozzle_number`,
    [station_id, attendant_id]);
  return rows;
}

// THE ARITHMETIC OF ONE LEG, on its own so it can be tested without a database.
//
// Deliberately identical to what outstanding() and outstandingDetail() do in SQL:
//   * GREATEST(reading - prev, 0) — a misread that goes BACKWARDS must never become a
//     negative charge. The physics test calls that out separately; the money floors at
//     zero either way.
//   * litres times the fuel's CURRENT price. Price changes are not this system's
//     problem (owner-set 27-Aug): the price is updated by hand at the controller and by
//     hand here, and there is no gating pre/post change to build.
//   * no previous reading means no leg and no charge — a first reading opens a chain,
//     it does not close one.
//   * test litres drawn in the leg come off before pricing (LEG_TEST_LTRS).
function handoverMath({ prevReading, reading, price, testLtrs = 0 }) {
  const prev = prevReading == null ? null : Number(prevReading);
  const now  = Number(reading);
  const rate = Number(price) || 0;
  if (prev == null || !Number.isFinite(now) || !Number.isFinite(prev)) {
    return { ltrs: 0, value: 0 };
  }
  const ltrs = Math.max(now - prev - (Number(testLtrs) || 0), 0);
  return { ltrs, value: ltrs * rate };
}

// ── THE HANDOVER, PRICED, BEFORE IT IS RECORDED ──────────────────────────────
//
// WHAT THE OUTGOING MAN WILL OWE, shown at the moment of the handover instead of
// discovered later on his settlement screen. Owner, 23-Sep-2026: on Reassign,
// "seek nozzle reading (entry/slip) and show the amount due from the existing
// attendant."
//
// It is a PREVIEW, not a second arithmetic. It reuses the same pieces outstanding()
// and outstandingDetail() use — the same GREATEST() floor, the same current-price
// lookup — so the figure a manager confirms here is the figure that appears against
// the man afterwards. Two formulas for one number is how a screen and a ledger come
// to disagree, and a manager who finds them disagreeing stops trusting both.
//
// 🔴 IT DERIVES, IT NEVER ACCEPTS. No caller may pass an outstanding in. This returns
// what the reading WOULD mean; recording it is a separate, deliberate act.
async function handoverPreview({ station_id, nozzle_id, reading, at = new Date() }) {
  if (!(await hasSpokeTables())) return { enabled: false };

  const nm = await pumps.nozzleNameSelect(pool);
  const { rows: nz } = await pool.query(
    `SELECT n.id, n.fuel_type${nm.col},
            (SELECT fp.price FROM fuel_prices fp
              WHERE fp.station_id = $2 AND fp.fuel_type = n.fuel_type
              ORDER BY fp.effective_from DESC LIMIT 1) AS price
       FROM nozzles n ${nm.join}
      WHERE n.id = $1 AND n.station_id = $2`, [nozzle_id, station_id]);
  if (!nz.length) return { enabled: true, found: false };
  const n = nz[0];

  const prev = await lastEvent(nozzle_id);
  const num_ = Number(reading);
  const price = prev ? Number(n.price ?? 0) : 0;
  // The leg is still open, so its end is NOW — the same rule as LEG_TEST_LTRS.
  let testLtrs = 0;
  if (prev) {
    const { rows: td } = await pool.query(
      `SELECT COALESCE(SUM(litres), 0) AS ltrs FROM fuel_test_draws
        WHERE nozzle_id = $1 AND drawn_at > $2 AND drawn_at <= $3`,
      [nozzle_id, prev.recorded_at, at]);
    testLtrs = Number(td[0]?.ltrs) || 0;
  }
  const { ltrs, value } = handoverMath({
    prevReading: prev ? prev.reading : null, reading: num_, price, testLtrs,
  });

  // WHO IT CLOSES IS NOT ASKED AND NOT ACCEPTED — the chain already knows. Asking
  // would let a manager strike the outstanding against a different name.
  const closesId = prev?.opens_attendant_id || null;
  let closes = null, before = 0;
  if (closesId) {
    const { rows: u } = await pool.query('SELECT id, name FROM users WHERE id=$1', [closesId]);
    closes = u[0] || null;
    const all = await outstanding(station_id);
    before = Number(all.find(r => String(r.attendant_id) === String(closesId))?.outstanding || 0);
  }

  return {
    enabled: true,
    found: true,
    nozzle_name: n.nozzle_name ?? null,
    fuel_type: n.fuel_type,
    // The working, every part of it, never a total on its own.
    prev_reading: prev ? Number(prev.reading) : null,
    prev_at:      prev ? prev.recorded_at : null,
    reading:      Number.isFinite(num_) ? num_ : null,
    test_ltrs: testLtrs,
    ltrs, price, value,
    closes,
    outstanding_before: before,
    outstanding_after:  before + value,
    // Shown before he confirms, not after — the two physics tests, nothing else.
    physics: prev ? physicsVerdict({
      prevReading: prev.reading, prevAt: prev.recorded_at, reading: num_, at,
      tankLimit: await tankCeiling(nozzle_id, prev.recorded_at),
    }) : null,
    // A reading identical to the one before it moves nothing. Worth saying out loud so
    // "₹0" reads as a handover with no sale rather than as a screen that failed.
    co_event: !!(prev && Number.isFinite(num_) && Number(prev.reading) === num_),
  };
}

// IS THIS A SETTLEMENT AT ALL? Pure, so it can be tested without a database.
//
// Every part must be a real, non-negative amount, and the whole must be more than
// nothing. Until 27-Sep-2026 only the TOTAL was checked, so cash −5,000 alongside UPI
// +5,010 passed as "₹10 brought" — a negative figure on a money screen is never a
// payment, it is a typo or a way of moving a debt, and either way it is refused.
function settlementProblem({ cash, upi, card, credit, petty } = {}) {
  const parts = { cash, upi, card, credit, petty };
  for (const [field, v] of Object.entries(parts)) {
    if (v === undefined || v === null || v === '') continue;
    const x = Number(v);
    if (!Number.isFinite(x)) return { code: 'bad_amount', field };
    if (x < 0) return { code: 'negative_amount', field };
  }
  const total = Object.values(parts).reduce((a, b) => a + (Number(b) || 0), 0);
  if (!(total > 0)) return { code: 'nothing_brought' };
  return null;
}

// A settlement is refused as a repeat when the SAME amounts for the SAME man arrive
// within this window. A double-tap on a slow phone is the case; two genuinely separate
// hand-overs of identical sums inside two minutes is not a thing that happens.
const DUPLICATE_WINDOW_SECONDS = 120;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// WHAT HE BROUGHT — the only manual entry in Spoke 3. It brings his suspense down; it
// never sets it, and it may not complete silently at zero.
//
// 🔴 THREE CHECKS, ALL FOUND IN THE MBR REHEARSAL OF 27-Sep-2026:
//   * the amounts (settlementProblem above);
//   * the man — he must be an attendant at THIS outlet. A settlement against a
//     manager's id was accepted and sat at −₹10 for ever, blocking the flow switch
//     with nothing able to reverse it; an unknown id surfaced a database error;
//   * the repeat — two identical requests sent together were BOTH recorded, and the
//     second became a credit that Attendant Close hides and his next day's sales
//     silently absorb. One man's settlements now queue behind a lock, so the repeat
//     check cannot be raced.
async function settle({ station_id, attendant_id, cash = 0, upi = 0, card = 0,
                        credit = 0, petty = 0, notes, recorded_by }) {
  if (!(await hasSpokeTables())) return null;
  const problem = settlementProblem({ cash, upi, card, credit, petty });
  if (problem) return { refused: problem.code, field: problem.field };
  if (!UUID_RE.test(String(attendant_id || ''))) return { refused: 'not_an_attendant_here' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`settle:${attendant_id}`]);

    const { rows: who } = await client.query(
      `SELECT 1 FROM users u JOIN station_users su ON su.user_id = u.id
        WHERE u.id = $1 AND su.station_id = $2 AND u.role = 'attendant'`,
      [attendant_id, station_id]);
    if (!who.length) { await client.query('ROLLBACK'); return { refused: 'not_an_attendant_here' }; }

    const amounts = [num(cash), num(upi), num(card), num(credit), num(petty)];
    const { rows: dup } = await client.query(
      `SELECT id FROM attendant_settlements
        WHERE station_id = $1 AND attendant_id = $2
          AND cash = $3 AND upi = $4 AND card = $5 AND credit = $6 AND petty = $7
          AND settled_at > now() - make_interval(secs => $8)
        LIMIT 1`,
      [station_id, attendant_id, ...amounts, DUPLICATE_WINDOW_SECONDS]);
    if (dup.length) {
      await client.query('ROLLBACK');
      return { refused: 'duplicate', settlement_id: dup[0].id };
    }

    const { rows } = await client.query(
      `INSERT INTO attendant_settlements(station_id, attendant_id, cash, upi, card,
          credit, petty, notes, recorded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [station_id, attendant_id, ...amounts, notes || null, recorded_by || null]);
    await client.query('COMMIT');
    return { settlement: rows[0] };
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}

// ── THE QUIET MOMENT ─────────────────────────────────────────────────────────
//
// CAN THIS OUTLET CHANGE ITS FLOW RIGHT NOW? One function, so the Settings screen
// and the refusal can never disagree about the answer.
//
// The flow switch decides where a nozzle's opening comes from. Flip it with work
// still open and a leg is half under one model and half under the other, which
// leaves a reading nobody can defend. So the switch waits for a boundary where
// nothing is in flight — end of day, everybody settled.
//
// 🔴 OPEN SHIFTS WERE ALREADY CHECKED. OPEN LEGS WERE NOT, AND THAT IS THE HOLE.
// A leg keeps its liability until it gets a closing reading, and a shift can be
// CLOSED with its legs still open — SBR had 16 of those on 23-Sep-2026, against
// zero at every other real outlet. Every one would have passed the old guard,
// because it only asked whether a shift was running.
//
// Reported, never merely counted: the screen names the men and the nozzles, so
// the owner knows what to go and clear rather than being told "not yet".
async function quietMoment(station_id, client = pool) {
  const { rows: openShifts } = await client.query(
    `SELECT sh.id, sh.shift_number, to_char(sh.date, 'DD Mon YYYY') AS on_date
       FROM shifts sh
      WHERE sh.station_id = $1 AND sh.status = 'open'
      ORDER BY sh.date, sh.shift_number`, [station_id]);

  const nm = await pumps.nozzleNameSelect(client);
  const { rows: legs } = await client.query(`
    SELECT san.id                AS leg_id,
           usr.name              AS attendant_name,
           sh.status             AS shift_status,
           sh.shift_number,
           to_char(sh.date, 'DD Mon YYYY') AS on_date,
           san.opening_reading
           ${nm.col}
      FROM shift_attendant_nozzles san
      JOIN shifts  sh ON sh.id = san.shift_id
      JOIN nozzles n  ON n.id = san.nozzle_id
      ${nm.join}
      LEFT JOIN users usr ON usr.id = san.attendant_id
     WHERE sh.station_id = $1
       AND san.closing_reading IS NULL
     ORDER BY sh.date DESC, san.assigned_at DESC NULLS LAST
     LIMIT 200`, [station_id]);

  const stranded = legs.filter(l => l.shift_status !== 'open');
  const attendants = [...new Set(legs.map(l => l.attendant_name).filter(Boolean))];

  // 🔴 AND THE NOZZLE-LED SIDE, added 23-Sep-2026 with the switch-back carry. The legs
  // above are open work under the SHIFT model; a nozzle still held in the chain, or a
  // man who still owes, is open work under the NOZZLE model. Switching back over
  // either leaves an account that the new flow cannot see and nobody can settle: the
  // shift screens never read attendant_settlements. So the switch waits until every
  // nozzle is back in the pool and every account is under ₹1 — the same line Attendant
  // Close draws for "cleared". Empty where the spoke tables do not exist.
  const [held, owed] = await Promise.all([holdings(station_id), outstanding(station_id)]);
  const owing = owed
    .filter(r => Math.abs(num(r.outstanding)) >= CLEARED_BELOW_RUPEES)
    .map(r => ({ attendant_id: r.attendant_id, name: r.name, outstanding: num(r.outstanding) }));
  const heldNozzles = held.reduce((a, h) => a + h.nozzles.length, 0);

  return {
    quiet: openShifts.length === 0 && legs.length === 0 && heldNozzles === 0 && owing.length === 0,
    open_shifts: openShifts,
    open_legs: legs.length,
    // A leg left open on a shift that is already CLOSED. No ordinary flow can
    // close it, so it is named separately — it needs the owner, not the manager.
    stranded_legs: stranded.length,
    attendants,
    legs,
    held_nozzles: heldNozzles,
    holders: held.map(h => h.name).filter(Boolean),
    owing,
  };
}

// Under one rupee is cleared — owner, 23-Sep-2026: "yes ₹1 is fine". The Attendant
// Close screen draws the same line (CLEARED_BELOW); the switch must not disagree.
const CLEARED_BELOW_RUPEES = 1;

const num = v => Number(v) || 0;

module.exports = {
  hasSpokeTables, physicsVerdict, mayRecord, recordEvent, chain, nozzleState, outstanding,
  outstandingDetail, settle, settlementProblem, readingProblem, quietMoment, handoverPreview,
  handoverMath, holdings, MAX_FLOW_LTRS_PER_MIN,
};
