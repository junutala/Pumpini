#!/usr/bin/env node
//
// THE READ SIDE: a qualified column reference must exist on the table its alias
// names. `ORDER BY cd.name`, `WHERE s.date=$1`, `SELECT n.nozzle_number`.
//
// WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM ci-sql-schema-check.js. The
// 22-Sep-2026 outage at SBR had TWO halves. `routes/corporate.js` invented
// `driver_name` on a table whose column is `name`, and used it BOTH in the INSERT
// and in the list's `ORDER BY`. The write gate catches the first half. This one
// catches the second — the half that did not throw a visible alert, it just 500'd
// the list, which is how a screen goes quietly broken for months at every outlet.
//
// Reads are most of the code, so this is most of the exposure. Owner, 22-Sep:
// "customer facing comes first" — a manager meets a broken SELECT by seeing
// nothing, and seeing nothing is the failure mode nobody reports.
//
// 🔴 PRECISION OVER COVERAGE, DELIBERATELY. A gate people learn to ignore is worse
// than no gate, so this reports ONLY what it can prove:
//
//   * a reference must be QUALIFIED (`alias.column`). A bare `name` could belong to
//     any table in the FROM list and guessing is how false alarms start.
//   * the alias must resolve to EXACTLY ONE relation that is in the manifest.
//   * 🔴 AN ALIAS EVER BOUND TO SOMETHING THAT IS NOT A KNOWN TABLE IS POISONED,
//     and every reference through it is skipped. SQL scopes an alias per CTE and
//     per subquery; this reads a whole template literal as one string. In
//     spokeService's outstanding() query `LEFT JOIN nozzle_events p` binds `p`
//     inside the `legs` CTE and `FROM priced p` REBINDS it two CTEs later, so a
//     flat read blames nozzle_events for `p.value`, `p.ltrs` and `p.last_close`.
//     The first draft did exactly that and produced four confident false findings.
//     Poisoning the alias removes the whole class without pretending to scope.
//
// So a clean run means: every qualified reference this could resolve is real. It
// does NOT mean every query is sound — unqualified columns and anything reached
// through a CTE alias are not checked, and that is stated rather than hidden.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const SRC      = path.join(ROOT, 'src');
const MANIFEST = path.join(ROOT, 'db', 'schema.prod.json');

// Words that can follow a table name without being an alias.
const NOT_AN_ALIAS = new Set([
  'on', 'where', 'as', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'join',
  'group', 'order', 'set', 'using', 'and', 'or', 'limit', 'having', 'returning',
  'union', 'select', 'values', 'lateral', 'natural', 'for', 'offset', 'window',
]);

// Qualified references whose prefix is never a table alias.
const NOT_A_TABLE_PREFIX = new Set(['excluded', 'new', 'old', 'pg_catalog', 'information_schema', 'public']);

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const cols = new Map(Object.entries(manifest.tables).map(([t, c]) => [t, new Set(c)]));

function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsFiles(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Comments carry SQL too — tombstones, worked examples, the reasoning blocks this
// repo is full of. Scanning them reports columns nothing executes.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

// alias -> Set(known tables) ; poisoned = bound to a CTE, a subquery, or anything
// not in the manifest, so its scope cannot be trusted.
function aliasMap(q) {
  const bound = new Map();
  const poisoned = new Set();
  const bind = (alias, table) => {
    if (!alias || NOT_AN_ALIAS.has(alias)) return;
    if (table && cols.has(table)) {
      if (!bound.has(alias)) bound.set(alias, new Set());
      bound.get(alias).add(table);
    } else poisoned.add(alias);
  };

  // Every CTE name is a relation we cannot resolve; so is anything selecting from one.
  for (const m of q.matchAll(/(?:\bWITH\b|,)\s*([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)) poisoned.add(m[1].toLowerCase());
  // A subquery or LATERAL block aliased after its closing paren: ") e ON true".
  for (const m of q.matchAll(/\)\s*(?:AS\s+)?([a-z_][a-z0-9_]*)/gi)) {
    const a = m[1].toLowerCase();
    if (!NOT_AN_ALIAS.has(a)) poisoned.add(a);
  }
  for (const m of q.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*(?:AS\s+)?([a-z_][a-z0-9_]*)?/gi)) {
    const table = m[1].toLowerCase();
    const alias = (m[2] || '').toLowerCase();
    bind(alias, table);
    if (cols.has(table)) bind(table, table);   // the bare name is usable too
    else poisoned.add(table);
  }
  const out = new Map();
  for (const [a, tables] of bound) {
    if (poisoned.has(a)) continue;             // rebound somewhere we cannot see
    if (tables.size !== 1) continue;           // two tables, same alias — ambiguous
    out.set(a, [...tables][0]);
  }
  return out;
}

// Words that may follow ORDER BY without being a column.
const ORDER_NOISE = new Set([
  'asc', 'desc', 'nulls', 'first', 'last', 'case', 'when', 'then', 'else', 'end',
  'and', 'or', 'not', 'null', 'true', 'false', 'limit', 'offset', 'by', 'distinct',
]);

// 🔴 THE BARE CASE, which is the one that actually broke. The corporate outage's read
// half was `ORDER BY driver_name` — UNQUALIFIED, so the alias pass above skips it and
// the gate would have missed the very bug it was built for.
//
// A bare column is ambiguous in general, but NOT when the query reads from exactly one
// known table with no JOIN, no CTE and no subquery: then it can only belong to that
// table. That is the whole of this check, and it is why it refuses everything else.
//
// Two things that are legal SQL and are not columns, both found while building this:
//   ORDER BY fd.dc_date  — qualified; the alias pass owns it, so the prefix is skipped
//   count(*) AS n ... ORDER BY n — ordering by a SELECT-LIST ALIAS, legal and common
//                                  (giftReportService's reason tally does exactly this)
function bareOrderColumns(q) {
  if (/\bWITH\b/i.test(q) || /\(\s*SELECT/i.test(q) || /\bJOIN\b/i.test(q)) return null;
  const froms = [...q.matchAll(/\bFROM\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)].map(x => x[1].toLowerCase());
  if (froms.length !== 1 || !cols.has(froms[0])) return null;
  const ob = q.match(/\bORDER\s+BY\s+([\s\S]*?)(?:\bLIMIT\b|\bOFFSET\b|$)/i);
  if (!ob) return null;
  // Everything the SELECT list named, so ordering by an output alias is not a finding.
  const outputs = new Set([...q.matchAll(/\bAS\s+([a-z_][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase()));
  const out = [];
  for (const seg of ob[1].split(',')) {
    const m = seg.trim().match(/^([a-z_][a-z0-9_]*)\s*([.(]?)/i);
    if (!m || m[2] === '.' || m[2] === '(') continue;   // qualified, or a function call
    const c = m[1].toLowerCase();
    if (ORDER_NOISE.has(c) || outputs.has(c)) continue;
    out.push(c);
  }
  return { table: froms[0], columns: out };
}

const findings = [];
let resolved = 0, skipped = 0, bare = 0;

for (const file of jsFiles(SRC)) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(ROOT, file);
  for (const lit of src.matchAll(/`([^`]*)`/g)) {
    const q = lit[1];
    if (!/\bFROM\s+[a-z_]/i.test(q)) continue;
    const line = src.slice(0, lit.index).split('\n').length;

    const alias = aliasMap(q);
    for (const r of q.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
      const a = r[1].toLowerCase(), c = r[2].toLowerCase();
      if (NOT_A_TABLE_PREFIX.has(a)) continue;
      const table = alias.get(a);
      if (!table) { skipped++; continue; }
      resolved++;
      if (!cols.get(table).has(c)) findings.push({ table, alias: a, column: c, file: rel, line });
    }

    const b = bareOrderColumns(q);
    if (b) for (const c of b.columns) {
      bare++;
      if (!cols.get(b.table).has(c)) {
        findings.push({ table: b.table, column: c, file: rel, line, bare: true });
      }
    }
  }
}

const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`;

if (findings.length) {
  console.error('\n✗ SQL reads name columns that do not exist in production\n');
  for (const f of findings) {
    console.error(f.bare
      ? `  ORDER BY ${f.column}  ->  ${f.table}.${f.column}`
      : `  ${f.alias}.${f.column}  ->  ${f.table}.${f.column}`);
    console.error(`      column does not exist — ${f.file}:${f.line}`);
    const near = [...cols.get(f.table)]
      .filter(c => c.includes(f.column) || f.column.includes(c)).slice(0, 4);
    if (near.length) console.error(`      did you mean: ${near.join(', ')}`);
  }
  console.error(`\n  ${plural(findings.length, 'finding')} across ${plural(resolved, 'resolved reference')}.`);
  console.error('  Fix the SQL, or if the owner has run new DDL, regenerate');
  console.error('  backend/db/schema.prod.json — see docs/schema-manifest.md.\n');
  process.exit(1);
}

console.log(`✓ sql reads — ${plural(resolved, 'qualified reference')} + ${bare} bare ORDER BY `
          + `resolve to a real column (${skipped} through CTE/subquery aliases not checked)`);
