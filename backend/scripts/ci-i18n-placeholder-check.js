#!/usr/bin/env node
// EVERY PLACEHOLDER A SCREEN FILLS MUST SURVIVE TRANSLATION.
//
// tc('key', 'fallback') prefers the value in en.json and falls back to the literal.
// So a translation that has drifted AWAY from its fallback silently wins — and if it
// has lost a {placeholder}, the .replace() that fills it finds nothing and the value
// is never shown.
//
// That is not hypothetical. On 31-Aug-2026 a manager was shown:
//
//     Dip readings missing
//     No opening dip has been recorded for:
//
// and then nothing. The code said "Tank {list} has no opening dip…" and filled {list};
// en.json carried an older sentence with no {list} at all, so the tank numbers
// vanished. The dialog told him something was wrong and refused to say what.
//
// A missing placeholder is invisible in review — both strings read fine on their own.
// It is only wrong in combination, which is exactly what a check is for.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'frontend', 'src');
const EN   = path.join(ROOT, 'i18n', 'locales', 'en.json');

const flat = {};
(function walk(o, pre = '') {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') walk(v, `${pre}${k}.`);
    else flat[`${pre}${k}`] = String(v);
  }
})(JSON.parse(fs.readFileSync(EN, 'utf8')));

const files = [];
(function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) scan(f);
    else if (e.name.endsWith('.js')) files.push(f);
  }
})(ROOT);

const TC = /tc\(\s*'([\w.]+)'\s*,\s*'((?:[^'\\]|\\.)*)'/gs;
const holes = s => new Set(String(s).match(/\{\w+\}/g) || []);

const bad = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(TC)) {
    const [, key, fallback] = m;
    const want = holes(fallback);
    if (!want.size) continue;
    const have = flat[key];
    if (have === undefined) continue;          // no translation yet — the fallback is used
    const lost = [...want].filter(h => !holes(have).has(h));
    if (lost.length) {
      bad.push(`  ${key}\n      code fills ${lost.join(', ')}\n      en.json    "${have.slice(0, 80)}"`);
    }
  }
}

if (bad.length) {
  console.error(`\n✗ ${bad.length} translation(s) drop a placeholder the code fills:\n`);
  console.error(bad.join('\n\n'));
  console.error('\nThe screen will render the sentence with the value missing.\n');
  process.exit(1);
}
console.log('✓ i18n placeholders — every value a screen fills survives its translation');
