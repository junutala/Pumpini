// The prep step that runs before a gauge screen reaches OCR.
//
// It exists because the manager photographs a monitor on a machine he may not
// touch: the digits arrive a few pixels tall in a 1280-wide frame, and on 31-Aug
// that returned '216000' for 16,000 and 'Ultage' for Ullage. Enlarging first is the
// fix. Everything here must DEGRADE TO NULL rather than throw — a photograph that
// reads slowly beats one that does not exist.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { upscaleForOcr, cropForOcr } = require('../src/services/imagePrep');

// A stand-in for a console screen: dark ground, a light block where the numbers sit.
async function frame(width = 640, height = 400) {
  return (await sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 20, b: 28 } },
  })
    .composite([{
      input: await sharp({ create: { width: 200, height: 60, channels: 3,
        background: { r: 230, g: 230, b: 235 } } }).png().toBuffer(),
      left: 40, top: 40,
    }])
    .png().toBuffer()).toString('base64');
}

test('upscaling enlarges the frame and keeps it a real image', async () => {
  const before = await frame(640, 400);
  const after  = await upscaleForOcr(before);
  assert.ok(after, 'must return an image');
  const m = await sharp(Buffer.from(after, 'base64')).metadata();
  assert.equal(m.width, 1920, '3x wider');
  assert.equal(m.height, 1200, 'aspect ratio held');
});

test('an already-huge frame is left alone rather than blown past the edge cap', async () => {
  // 4000px is the ceiling; a frame at it has nothing to gain and must not be scaled
  // into a request too large to ship.
  const big = await frame(4000, 200);
  assert.equal(await upscaleForOcr(big), null);
});

test('rubbish in gives null, never a throw', async () => {
  assert.equal(await upscaleForOcr(null), null);
  assert.equal(await upscaleForOcr(''), null);
  assert.equal(await upscaleForOcr('not-an-image'), null);
  assert.equal(await cropForOcr(null, { x0:0, y0:0, x1:1, y1:1 }), null);
  assert.equal(await cropForOcr(await frame(), null), null);
});

test('crops are taken in FRACTIONS, so a resized browser window cannot break them', async () => {
  const src = await frame(800, 400);
  // The left half, with the default 1% padding on each side.
  const out = await cropForOcr(src, { x0: 0, y0: 0, x1: 0.5, y1: 1 });
  assert.ok(out);
  const m = await sharp(Buffer.from(out, 'base64')).metadata();
  // 0.51 of 800 = 408 source px, scaled 3x.
  assert.equal(m.width, 1224);
});

test('a crop too small to hold a digit is refused', async () => {
  const src = await frame(800, 400);
  assert.equal(await cropForOcr(src, { x0: 0.5, y0: 0.5, x1: 0.501, y1: 0.501 }, 0), null);
});

test('a crop reaching past the edge is clamped, not an error', async () => {
  const src = await frame(400, 300);
  const out = await cropForOcr(src, { x0: -0.5, y0: -0.5, x1: 1.5, y1: 1.5 });
  assert.ok(out, 'clamps to the image instead of throwing');
});
