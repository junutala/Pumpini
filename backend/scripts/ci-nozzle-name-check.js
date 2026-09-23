#!/usr/bin/env node
// ONE NOZZLE NAME — enforced, not remembered.
//
// The rule (CLAUDE.md, owner-set 2026-08-20): a nozzle is shown as
// `<pump no>.<nozzle> · <pump serial>.<nozzle>` and NOTHING else ever reaches a user — not a
// screen, not an error message, not a CSV. `nozzles.nozzle_number` ("1.1") is our
// INTERNAL index. One writer produces the name: pumpService.nozzleNameExpr /
// nozzleName in SQL and JS, read on the frontend through lib/nozzle.js nozName().
//
// WHY THIS FILE EXISTS. PR #304 named every nozzle that comes from the `nozzles`
// TABLE, and that was believed to be all of them. It was not. The slip reader
// builds its lines from OCR OUTPUT — no nozzles row, so nozzleNameExpr never
// touched it and `nozzle_name` was simply never set on a slip line. Every consumer
// fell through to `nozzle_number`, and the internal index reached the manager in
// the one place he actually reads a nozzle name: the unmatched/refused list after
// a scan. It survived four months because you only see it when a slip FAILS.
//
// A convention that lives in someone's memory drifts back the week after it is
// fixed. This makes the drift fail the build instead.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
// The one writer, and this guard itself, are the only places allowed to compose
// or fall back to a nozzle label.
const ALLOW = [
  'backend/src/services/pumpService.js',
  'frontend/src/lib/nozzle.js',
  'backend/scripts/ci-nozzle-name-check.js',
];

const BANNED = [
  { re: /nozzle_name\s*\|\|/,
    why: 'rebuilds the name fallback inline — call pumpService.nozzleName(row) or nozName(n)' },
  { re: /['"`]\s*(?:Nozzle|N)\s*['"`]\s*\+\s*[A-Za-z_$][\w$]*\.nozzle_number/,
    why: 'builds a label from the INTERNAL nozzle_number' },
  { re: /`[^`]*\bN?o?z?z?l?e?\s*\$\{[^}]*\.nozzle_number\s*\}/,
    why: 'interpolates the INTERNAL nozzle_number into a user-facing string' },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const problems = [];
for (const abs of [...walk(path.join(ROOT, 'backend/src')), ...walk(path.join(ROOT, 'frontend/src'))]) {
  const rel = path.relative(ROOT, abs);
  if (ALLOW.includes(rel)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;            // prose about the rule is fine
    for (const b of BANNED) {
      if (b.re.test(line)) problems.push(`${rel}:${i + 1}  ${b.why}\n    ${line.trim()}`);
    }
  });
}

// POSITIVE CHECK — the exact regression above. Any object literal describing a
// scanned slip line (it carries `slip_no:`) must also carry `nozzle_name:`. The
// slip prints the pump serial and the nozzle number beside every reading, so a
// line can ALWAYS name itself; omitting it is what put the internal index on
// screen last time.
for (const abs of walk(path.join(ROOT, 'backend/src'))) {
  const rel = path.relative(ROOT, abs);
  const src = fs.readFileSync(abs, 'utf8');
  if (!/\bslip_no\s*:/.test(src)) continue;
  for (const m of src.matchAll(/\{[^{}]*\bslip_no\s*:[^{}]*\}/gs)) {
    if (!/\bnozzle_name\s*:/.test(m[0])) {
      const lineNo = src.slice(0, m.index).split('\n').length;
      problems.push(`${rel}:${lineNo}  a slip line omits nozzle_name — set it from the serial and the printed nozzle number`);
    }
  }
}

// THE ALIAS CONTRACT — splice the join in, and the alias it references must exist.
//
// WHAT PUT THIS HERE (23-Sep-2026). `pumpService.nozzleNameSelect()` hands back a
// SELECT fragment and a JOIN to splice into a query, and BOTH reference the caller's
// nozzles alias — which defaults to `n`:
//
//     LEFT JOIN pumps _np ON _np.id = n.pump_id AND _np.end_date IS NULL
//
// The new /shifts/nozzle-history query aliased its nozzles table `nz`. That parses,
// lints, builds, passes every other gate and ships — then throws
//     42P01  missing FROM-clause entry for table "n"
// at the FIRST REAL REQUEST. The owner found it by opening the screen.
//
// Nothing could have caught it. ci-sql-read-check reads a template literal as one
// flat string and cannot resolve `${nm.join}`, so the alias the helper introduces is
// invisible to it — a blind spot sitting exactly on the one-writer helper that
// dozens of queries splice in.
//
// So: for every literal that splices the join, require the matching nozzles alias to
// be bound in that same literal.
const aliasProblems = [];
for (const abs of walk(path.join(ROOT, 'backend/src'))) {
  const rel = path.relative(ROOT, abs);
  const src = fs.readFileSync(abs, 'utf8');
  if (!/nozzleNameSelect\s*\(/.test(src)) continue;

  // Which alias does each holder of a nozzleNameSelect() result expect? The default
  // is 'n'; an options object may override it with { n: 'x' }.
  const expected = new Map();
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[\w$.]*nozzleNameSelect\s*\(([^)]*)\)/g)) {
    const opts = /\bn\s*:\s*['"`]([^'"`]+)['"`]/.exec(m[2] || '');
    expected.set(m[1], opts ? opts[1] : 'n');
  }
  if (!expected.size) continue;

  // Every template literal in the file, with the line it starts on.
  for (const lit of src.matchAll(/`(?:[^`\\]|\\[\s\S])*`/g)) {
    const body = lit[0];
    for (const [holder, alias] of expected) {
      if (!body.includes('${' + holder + '.join}')) continue;
      const bound = new RegExp(String.raw`\b(?:JOIN|FROM)\s+nozzles\s+(?:AS\s+)?` + alias + String.raw`\b`, 'i');
      if (!bound.test(body)) {
        const lineNo = src.slice(0, lit.index).split('\n').length;
        aliasProblems.push(
          `${rel}:${lineNo}  splices \${${holder}.join} but no "nozzles ${alias}" in the same query — ` +
          `the join it adds references ${alias}.pump_id, so this throws 42P01 at runtime`);
      }
    }
  }
}
problems.push(...aliasProblems);

if (problems.length) {
  console.error('\n✗ ONE NOZZLE NAME — violations found:\n');
  problems.forEach(p => console.error('  ' + p + '\n'));
  console.error('  The name is `<pump no>.<nozzle> · <pump serial>.<nozzle>`, produced by ONE writer.');
  console.error('  See CLAUDE.md "ONE nozzle name, one pump name".\n');
  process.exit(1);
}
console.log('✓ one nozzle name — no inline labels, every slip line names itself, every spliced join has its alias');
