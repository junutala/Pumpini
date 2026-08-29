// THE STORAGE PATH — what a person sees in the Supabase file browser.
//
// The owner opened the bucket on 29-Aug-2026 and called it "really a maze": three
// prefixes, nine UUID folders, and filenames like 1787447447914-m5q4r7-meter.jpg.
// These pin the shape that replaced it, and in particular the two decisions that
// look like details and are not.
const test = require('node:test');
const assert = require('node:assert');
const { safeName } = require('../src/services/vaweStorage');

// The path builder, mirrored: uploadDocumentBase64 needs a live bucket and a DB, so
// the naming rules are pinned here directly. If the real one changes, change this.
const FOLDER = { gauge_screen:'atg', atg:'atg', nozzle_slip:'nozzle', meter_photo:'nozzle', delivery_invoice:'deliveries' };
function buildPath({ slug, kind, at, label, ext = 'jpg' }) {
  const ist = new Date(at.getTime() + 5.5 * 3600 * 1000).toISOString();
  const ddmmyy = ist.slice(8,10) + ist.slice(5,7) + ist.slice(2,4);
  const hhmmss = ist.slice(11,19).replace(/:/g,'');
  const tag = label ? `-${safeName(String(label))}` : '';
  return `${FOLDER[kind] || 'other'}/${slug}${tag}-${ddmmyy}-${hhmmss}.${ext}`;
}

test('three folders, and only three', () => {
  const at = new Date('2026-08-30T00:42:04Z');
  assert.match(buildPath({ slug:'sri-balaji', kind:'gauge_screen',     at }), /^atg\//);
  assert.match(buildPath({ slug:'sri-balaji', kind:'nozzle_slip',      at }), /^nozzle\//);
  assert.match(buildPath({ slug:'sri-balaji', kind:'meter_photo',      at }), /^nozzle\//);
  assert.match(buildPath({ slug:'kamala',     kind:'delivery_invoice', at }), /^deliveries\//);
});

test('the filename alone gives outlet, date and time', () => {
  // 30-Aug-2026 06:12:04 IST
  assert.strictEqual(
    buildPath({ slug:'sri-balaji', kind:'nozzle_slip', at:new Date('2026-08-30T00:42:04Z') }),
    'nozzle/sri-balaji-300826-061204.jpg');
});

test('IST, not UTC — a file stamped 300826 is the day they worked', () => {
  // 23:50 UTC on the 29th is 05:20 IST on the 30th. The outlet worked on the 30th.
  const p = buildPath({ slug:'kamala', kind:'atg', at:new Date('2026-08-29T23:50:00Z') });
  assert.ok(p.includes('-300826-'), `expected the 30th, got ${p}`);
});

test('THE NOZZLE NAME is appended verbatim — one naming convention, everywhere', () => {
  const p = buildPath({ slug:'sri-balaji', kind:'meter_photo', label:'15BC1412V.1',
                        at:new Date('2026-08-30T00:42:04Z') });
  assert.strictEqual(p, 'nozzle/sri-balaji-15BC1412V.1-300826-061204.jpg');
  assert.ok(p.includes('15BC1412V.1'), 'the printed nozzle name must survive intact');
});

test('no label on a composite scan or an ATG screen — they have no single nozzle', () => {
  const at = new Date('2026-08-30T00:42:04Z');
  assert.strictEqual(buildPath({ slug:'sri-balaji', kind:'nozzle_slip', at }),
                     'nozzle/sri-balaji-300826-061204.jpg');
});

test('SECONDS ARE LOAD-BEARING: Kamala photographed ONE nozzle 3x inside a minute', () => {
  // Real history, 23-Jun-2026: 15BC1412V.2 at 09:42:26, 09:42:58 and 09:43:25.
  // putObject runs with x-upsert:true, so a repeated path SILENTLY REPLACES the
  // earlier object. Under HHMM the first two would have collided and one photograph
  // would be gone with nothing to show it ever existed.
  const mk = iso => buildPath({ slug:'kamala', kind:'meter_photo', label:'15BC1412V.2', at:new Date(iso) });
  const a = mk('2026-06-23T04:12:26Z');   // 09:42:26 IST
  const b = mk('2026-06-23T04:12:58Z');   // 09:42:58 IST
  assert.notStrictEqual(a, b, 'two retries of one nozzle must not share a path');
  assert.ok(a.endsWith('094226.jpg') && b.endsWith('094258.jpg'));
  // and the HHMM form they would have collapsed to:
  assert.strictEqual(a.slice(0, -6), b.slice(0, -6), 'they differ ONLY in the seconds');
});

test('a hostile outlet name cannot escape its folder', () => {
  assert.ok(!safeName('../../etc/passwd').includes('/'));
});
