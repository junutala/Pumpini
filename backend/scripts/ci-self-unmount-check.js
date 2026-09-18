#!/usr/bin/env node
// A CONTROL MAY NOT BE UNMOUNTED BY ITS OWN onChange.
//
// The shape this catches:
//
//     {form.city === '__other__' && (
//       <input onChange={e => f('city', e.target.value)} />   // ← writes what gates it
//     )}
//
// Pick "Other", type one character, and `form.city` becomes "H". The gate is now false,
// so React unmounts the very box being typed into: the character is lost, the select
// falls blank, and the field "closes out". The user cannot enter the value at all.
//
// WHAT PUT THIS HERE (18-Sep-2026). The owner reported it on Settings → Station Details
// → City → "Other (type below)". It was not one screen: sweeping for the SHAPE rather
// than the word found the identical bug on Lubes → Catalogue → HSN Code → "Other (type
// manually)", which nobody had reported yet. Both had been shipped and both were
// invisible to review, because each line reads perfectly well on its own — only the
// combination is wrong, which is exactly what a check is for.
//
// 🔴 WHY IT CANNOT BE FOUND BY eslint OR BY `next build`. Nothing here is undefined and
// nothing is a type error; the component renders, and the bug exists only in the
// relationship between a gate and a handler. It is a live-behaviour fault that compiles
// perfectly, so only a check that understands the pair can see it.
//
// FALSE-POSITIVE DISCIPLINE (ci.yml's own rule: a gate that fails for unrelated reasons
// gets muted). A handler that updates a FIELD of the gating object is safe and is not
// reported:
//
//     {editUser && ( <input onChange={e => setEditUser(p => ({...p, name: ...}))}/> )}
//
// `editUser` stays an object, so the gate stays true. Only a write that REPLACES the
// gating value is flagged.
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'frontend', 'src');

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f); }
    else if (e.name.endsWith('.js') || e.name.endsWith('.jsx')) files.push(f);
  }
})(ROOT);

// A render gate: `{ <expr> && (` at the end of a line, the JSX conditional form.
const GATE = /\{[^{}]*&&\s*\(\s*$/;
// A function updater that spreads the previous value — safe, never replaces the gate.
const SPREAD_UPDATER = /\(\s*(?:[A-Za-z_$][\w$]*)\s*=>\s*\(?\s*\{\s*\.\.\./;

const problems = [];

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/on(?:Change|Input)\s*=/.test(line)) continue;

    // What does this handler REPLACE? `f('key', …)` and `setThing(value)`, but not
    // `setThing(prev => ({...prev, …}))`.
    const written = new Set();
    for (const m of line.matchAll(/\bf\(\s*'([A-Za-z_$][\w$]*)'/g)) written.add(m[1]);
    for (const m of line.matchAll(/\bset([A-Z][\w$]*)\s*\(/g)) {
      const after = line.slice(m.index + m[0].length - 1);
      if (SPREAD_UPDATER.test(after)) continue;          // field update, gate survives
      written.add(m[1][0].toLowerCase() + m[1].slice(1));
    }
    if (!written.size) continue;

    // The nearest enclosing render gate above it.
    for (let j = i; j > Math.max(-1, i - 30); j--) {
      const g = lines[j];
      if (!GATE.test(g)) continue;
      const gated = new Set();
      for (const m of g.matchAll(/\bform\.([A-Za-z_$][\w$]*)/g))               gated.add(m[1]);
      for (const m of g.matchAll(/(?<![.\w])([a-z][\w$]*)\s*(?:===|!==|&&)/g))  gated.add(m[1]);
      const clash = [...written].filter(w => gated.has(w));
      if (clash.length) {
        problems.push({
          file: path.relative(path.join(__dirname, '..', '..'), file),
          gateLine: j + 1, handlerLine: i + 1, keys: clash,
          gate: g.trim().slice(0, 100), handler: line.trim().slice(0, 100),
        });
      }
      break;
    }
  }
}

if (problems.length) {
  console.error('\n✗ A control is unmounted by its own onChange — it cannot be typed into.\n');
  for (const p of problems) {
    console.error(`  ${p.file}`);
    console.error(`    gate    line ${p.gateLine}: ${p.gate}`);
    console.error(`    handler line ${p.handlerLine}: ${p.handler}`);
    console.error(`    the handler replaces ${p.keys.map(k => `\`${k}\``).join(', ')}, which is what renders it\n`);
  }
  console.error('  Fix: hold the MODE in its own state (e.g. `const [cityOther, setCityOther] = useState(false)`)');
  console.error('  and gate on that, so the field keeps the value and nothing unmounts mid-keystroke.');
  console.error('  See frontend/src/app/settings/page.js (City → Other) for the shape.\n');
  process.exit(1);
}

console.log(`✓ no self-unmounting controls (${files.length} frontend files scanned)`);
