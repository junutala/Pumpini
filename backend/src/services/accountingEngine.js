// src/services/accountingEngine.js
//
// The Pumpini-owned posting engine. It turns a typed accounting EVENT into balanced
// double-entry JOURNAL lines using the central rulebook (posting_rules), and writes
// them to the per-outlet journal — idempotently, so re-posting the same source event
// is a no-op. It NEVER touches an existing Pumpini flow; it only reads the rulebook and
// writes its own journal tables.
//
// Two entry points:
//   • postEvent(db, event)   — rulebook-driven (the normal path). Looks up the rule for
//                              event.type and expands it into lines.
//   • postJournal(db, {...})  — low-level writer for callers that already computed
//                              balanced lines (a fuel-sale split, a manual adjustment).
//
// The line-building + balance check are PURE functions (buildLines / assertBalanced) so
// they can be unit-tested with no database (see scripts/accounts-engine-selftest.js).

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// A leg's amount: 'amount' = the event's headline amount; anything else is pulled from
// event.amounts (used by split events, e.g. a fuel sale broken out by payment mode).
function resolveAmount(event, amountKey) {
  if (!amountKey || amountKey === 'amount') return Number(event.amount || 0);
  const v = event.amounts && event.amounts[amountKey];
  return Number(v || 0);
}

// A leg's account: a fixed account_code, or one supplied by the event under account_key
// (e.g. the chosen expense head, or which bank the money left).
function resolveAccount(rule, event) {
  if (rule.account_code) return rule.account_code;
  const a = event.accounts && event.accounts[rule.account_key];
  if (!a) {
    throw new Error(
      `posting rule '${rule.event_type || event.type}' leg ${rule.leg_no}: ` +
      `no account supplied for key '${rule.account_key}'`);
  }
  return a;
}

// Throws unless debits == credits and the entry is non-empty. Returns the total (Σ debit).
function assertBalanced(lines) {
  const debit  = round2(lines.reduce((s, l) => s + Number(l.debit  || 0), 0));
  const credit = round2(lines.reduce((s, l) => s + Number(l.credit || 0), 0));
  if (debit !== credit) throw new Error(`unbalanced journal: debits ${debit} != credits ${credit}`);
  if (debit <= 0)       throw new Error('empty journal: total is zero');
  return debit;
}

// Pure: expand a set of rulebook legs against an event into balanced journal lines.
// Zero-amount legs are skipped (a split event may not touch every payment mode); the
// balance assertion then guarantees the remaining legs still tie out.
function buildLines(rules, event) {
  if (!rules || !rules.length) {
    throw new Error(`no active posting rule for event_type '${event.type}'`);
  }
  const lines = [];
  for (const r of rules) {
    const amt = round2(resolveAmount(event, r.amount_key));
    if (amt <= 0) continue;
    lines.push({
      account_code: resolveAccount(r, event),
      debit:  r.side === 'debit'  ? amt : 0,
      credit: r.side === 'credit' ? amt : 0,
      memo:   r.description || null,
    });
  }
  assertBalanced(lines);
  return lines;
}

// Low-level writer. `db` is a pg pool or client (both expose .query). Idempotent on
// (station_id, event_type, source_ref): a repeat returns the existing journal untouched.
// A NULL source_ref never conflicts (Postgres treats NULLs as distinct) → manual entries
// always insert.
async function postJournal(db, o) {
  const { station_id, entry_date, event_type, source, source_ref,
          narration, lines, created_by, party } = o;
  const total = assertBalanced(lines);

  const { rows: hdr } = await db.query(
    `INSERT INTO accounting_journal
       (station_id, entry_date, event_type, source, source_ref, narration, amount, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (station_id, event_type, source_ref) DO NOTHING
     RETURNING *`,
    [station_id, entry_date, event_type, source || null, source_ref || null,
     narration || null, total, created_by || null]);

  if (!hdr.length) {
    const { rows: ex } = await db.query(
      `SELECT * FROM accounting_journal
        WHERE station_id=$1 AND event_type=$2 AND source_ref=$3`,
      [station_id, event_type, source_ref]);
    return { journal: ex[0] || null, created: false };
  }

  const journal = hdr[0];
  for (const l of lines) {
    await db.query(
      `INSERT INTO accounting_journal_lines
         (journal_id, station_id, account_code, debit, credit, party_type, party_id, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [journal.id, station_id, l.account_code, round2(l.debit), round2(l.credit),
       l.party_type || party?.type || null, l.party_id || party?.id || null, l.memo || null]);
  }
  return { journal, created: true };
}

// Rulebook-driven post: the normal path. event = { station_id, type, date, amount,
// amounts?, accounts?, source?, source_ref?, narration?, created_by?, party? }.
async function postEvent(db, event) {
  const { rows: rules } = await db.query(
    `SELECT * FROM posting_rules WHERE event_type=$1 AND active ORDER BY leg_no`,
    [event.type]);
  const lines = buildLines(rules, event);
  return postJournal(db, {
    station_id: event.station_id,
    entry_date: event.date,
    event_type: event.type,
    source:     event.source,
    source_ref: event.source_ref,
    narration:  event.narration,
    created_by: event.created_by,
    party:      event.party,
    lines,
  });
}

// Trial balance: per-account debit/credit totals for a station (optional date window).
// `balanced` is the correctness invariant — it must always be true.
async function trialBalance(db, stationId, { from, to } = {}) {
  const params = [stationId];
  let f = '';
  if (from) { params.push(from); f += ` AND j.entry_date >= $${params.length}`; }
  if (to)   { params.push(to);   f += ` AND j.entry_date <= $${params.length}`; }
  const { rows } = await db.query(
    `SELECT l.account_code, a.name, a.acct_type, a.statement,
            SUM(l.debit)  AS debit,
            SUM(l.credit) AS credit
       FROM accounting_journal_lines l
       JOIN accounting_journal   j ON j.id   = l.journal_id
       JOIN accounting_accounts  a ON a.code = l.account_code
      WHERE l.station_id = $1 ${f}
      GROUP BY l.account_code, a.name, a.acct_type, a.statement, a.sort_order
      ORDER BY a.sort_order`, params);
  const totalDebit  = round2(rows.reduce((s, r) => s + Number(r.debit  || 0), 0));
  const totalCredit = round2(rows.reduce((s, r) => s + Number(r.credit || 0), 0));
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

// Journal with its lines (latest first), optional date window.
async function listJournal(db, stationId, { from, to, limit = 200 } = {}) {
  const params = [stationId];
  let f = '';
  if (from) { params.push(from); f += ` AND j.entry_date >= $${params.length}`; }
  if (to)   { params.push(to);   f += ` AND j.entry_date <= $${params.length}`; }
  params.push(Math.min(Number(limit) || 200, 500));
  const { rows: heads } = await db.query(
    `SELECT * FROM accounting_journal j
      WHERE j.station_id = $1 ${f}
      ORDER BY j.entry_date DESC, j.created_at DESC
      LIMIT $${params.length}`, params);
  if (!heads.length) return [];
  const ids = heads.map(h => h.id);
  const { rows: lines } = await db.query(
    `SELECT l.*, a.name AS account_name
       FROM accounting_journal_lines l
       JOIN accounting_accounts a ON a.code = l.account_code
      WHERE l.journal_id = ANY($1)
      ORDER BY l.debit DESC`, [ids]);
  const byJournal = {};
  for (const l of lines) (byJournal[l.journal_id] ||= []).push(l);
  return heads.map(h => ({ ...h, lines: byJournal[h.id] || [] }));
}

module.exports = {
  // pure helpers (unit-testable)
  buildLines, assertBalanced, resolveAmount, resolveAccount, round2,
  // db-backed
  postEvent, postJournal, trialBalance, listJournal,
};
