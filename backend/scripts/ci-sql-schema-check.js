#!/usr/bin/env node
//
// EVERY COLUMN A SQL WRITE NAMES MUST EXIST IN PRODUCTION.
//
// WHY THIS EXISTS. On 22-Sep-2026 a manager at SBR could not add a vehicle:
//
//     column "driver_name" of relation "corporate_drivers" does not exist
//
// The table has always had `name`. `routes/corporate.js` had invented
// `driver_name` and used it in BOTH the INSERT and the list's ORDER BY, so the
// screen was broken in both directions and had been since it was written — at
// every outlet, for months.
//
// NOTHING COULD HAVE CAUGHT IT. eslint reads JavaScript scope, and a column name
// inside a template literal is just text. `next build` compiles the frontend. The
// unit tests never open a database. So the only thing standing between a typed
// column name and a manager's screen was somebody pressing the button in
// production. That is what this closes.
//
// The owner's question was "how many more headaches do we have to face", and the
// honest answer needed a machine that could be re-run, not one sweep by hand.
//
// WHAT IT CHECKS — the WRITE paths, which are the unambiguous ones:
//   INSERT INTO <table> (a, b, c)        every column
//   ... ON CONFLICT (...) DO UPDATE SET  every column, against the same table
//   UPDATE <table> SET a = ..., b = ...  every column
// A write names its table right there, so no alias resolution is needed and a
// finding is a fact rather than a guess.
//
// WHAT IT DOES NOT CHECK, said out loud so nobody reads a green tick as more than
// it is: SELECT / WHERE / ORDER BY. Those reach through aliases and joins
// (`ORDER BY cd.name`, `WHERE s.date=$1`), and resolving an alias to a table
// needs a real SQL parser. Half of the corporate bug lived there. Extending this
// to reads is worth doing and is deliberately not attempted here — a checker that
// guesses produces false alarms, and a gate people learn to ignore is worse than
// no gate.
//
// THE MANIFEST is backend/db/schema.prod.json, generated from the production
// information_schema. It is NOT pumpini-schema.snapshot.sql, which was found to be
// 30 tables out of date on 22-Sep-2026 while CLAUDE.md was telling every session
// to trust it. See docs/schema-manifest.md for how to regenerate.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const SRC      = path.join(ROOT, 'src');
const MANIFEST = path.join(ROOT, 'db', 'schema.prod.json');

// Tables the code writes to that do NOT exist in production. Each one is a real
// debt, listed here with its reason so the gate can be green without the debt
// becoming invisible — an undocumented skip is how the last one survived.
//
// settlement_ledger* / outlet_reco* — the materialised reconciliation ledger
// (services/settlementLedger.js). Its DDL lives in ops/staging/settlement-ledger.sql
// and has never been run on production, so the feature has never worked there.
// Both call sites in routes/reconcile.js wrap it in try/catch and only log, so it
// fails silently at every settlement rather than breaking one. Remove a name from
// this list the day its table is created.
const KNOWN_MISSING = new Set([
  'settlement_ledger', 'settlement_ledger_fuel', 'outlet_reco', 'outlet_reco_fuel',
]);

function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsFiles(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Comments carry SQL too — tombstones ("POST /reconcile/ocr-meter — REMOVED"),
// worked examples, the reasoning blocks this repo is full of. Scanning them would
// report columns nothing executes, so they come out first. Block comments and
// whole-line // comments only: a trailing // inside a string is left alone rather
// than risk cutting a live query in half.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const cols = new Map(Object.entries(manifest.tables).map(([t, c]) => [t, new Set(c)]));

const findings = [];
const skipped  = new Map();   // known-missing table -> times written
let checked = 0;

// One assignment list -> its column names. Stops at the first token that cannot
// begin an assignment, so `SET a=1, b=$2 WHERE ...` yields [a, b] and nothing from
// the WHERE. Qualified names (t.col) are skipped: they are legal in an UPDATE ...
// FROM and naming the owning table needs the parser this deliberately is not.
function assignedColumns(setClause) {
  const out = [];
  for (const m of setClause.matchAll(/(^|[,(\s])([a-z_][a-z0-9_]*)\s*=(?!=)/gi)) out.push(m[2].toLowerCase());
  return out;
}

function record(table, column, file, line) {
  checked++;
  if (KNOWN_MISSING.has(table)) {
    skipped.set(table, (skipped.get(table) || 0) + 1);
    return;
  }
  const known = cols.get(table);
  if (!known) { findings.push({ table, column: null, file, line, why: 'table does not exist' }); return; }
  if (!known.has(column)) findings.push({ table, column, file, line, why: 'column does not exist' });
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

for (const file of jsFiles(SRC)) {
  const raw = fs.readFileSync(file, 'utf8');
  const src = stripComments(raw);
  const rel = path.relative(ROOT, file);

  // INSERT INTO t (a,b,c). The match stops at the closing paren and consumes
  // nothing beyond it — an earlier draft swallowed 600 characters hunting for a
  // DO UPDATE clause and ate the NEXT INSERT sixteen lines below, which is how a
  // checker quietly stops checking. ON CONFLICT is handled separately, below.
  const inserts = [];
  for (const m of src.matchAll(
    /INSERT\s+INTO\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi)) {
    const table = m[1].toLowerCase();
    const line  = lineOf(src, m.index);
    inserts.push({ table, at: m.index, line });
    for (let c of m[2].split(',')) {
      c = c.trim().replace(/\s+[\s\S]*$/, '').replace(/["`]/g, '').toLowerCase();
      if (/^[a-z_][a-z0-9_]*$/.test(c)) record(table, c, rel, line);
    }
  }

  // ON CONFLICT ... DO UPDATE SET — the statement never repeats its table name, so
  // the owner is the nearest INSERT above it. Found in its own pass so neither
  // scan can consume the other's text.
  for (const m of src.matchAll(/DO\s+UPDATE\s+SET([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|`|;)/gi)) {
    let owner = null;
    for (const ins of inserts) { if (ins.at < m.index) owner = ins; else break; }
    if (!owner) continue;
    for (const c of assignedColumns(m[1])) record(owner.table, c, rel, owner.line);
  }

  // UPDATE t SET a=..., b=...
  for (const m of src.matchAll(
    /UPDATE\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|\bFROM\b|`|;)/gi)) {
    const table = m[1].toLowerCase();
    const line  = lineOf(src, m.index);
    for (const c of assignedColumns(m[2])) record(table, c, rel, line);
  }
}

const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`;

if (findings.length) {
  console.error('\n✗ SQL writes name columns that do not exist in production\n');
  for (const f of findings) {
    const what = f.column ? `${f.table}.${f.column}` : f.table;
    console.error(`  ${what}\n      ${f.why} — ${f.file}:${f.line}`);
    const known = cols.get(f.table);
    if (known && f.column) {
      // Name the near misses. The last one was `driver_name` against a table
      // holding `name`, and the fix is obvious the moment the two sit together.
      const near = [...known].filter(c => c.includes(f.column) || f.column.includes(c)).slice(0, 4);
      if (near.length) console.error(`      did you mean: ${near.join(', ')}`);
    }
  }
  console.error(`\n  ${plural(findings.length, 'finding')} across ${plural(checked, 'checked column reference')}.`);
  console.error('  Fix the SQL, or if the owner has run new DDL, regenerate');
  console.error('  backend/db/schema.prod.json — see docs/schema-manifest.md.\n');
  process.exit(1);
}

let note = '';
if (skipped.size) {
  const total = [...skipped.values()].reduce((a, b) => a + b, 0);
  note = `; ${plural(total, 'write')} to ${plural(skipped.size, 'known-missing table')} skipped `
       + `(${[...skipped.keys()].join(', ')})`;
}
console.log(`✓ sql schema — ${plural(checked, 'written column')} all exist in production${note}`);
