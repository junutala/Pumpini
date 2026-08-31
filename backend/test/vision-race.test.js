// visionOcrBest races the frame AS TAKEN against an ENLARGED copy and keeps the
// better read. These pin the real rule — pickBetterRead is the function the racer
// itself calls, not a restatement of it.
//
// The rule that matters: this can NEVER return less than today, because the
// untouched read is always one of the two candidates.
const test = require('node:test');
const assert = require('node:assert');
const { pickBetterRead, visionOcrBest } = require('../src/services/visionOcr');

test('the enlarged read wins when it recovers more text', () => {
  // The real 31-Aug figures: a re-photographed frame against the original file.
  const r = pickBetterRead({ text: 'x'.repeat(732) }, { text: 'y'.repeat(1478) });
  assert.equal(r.variant, 'upscaled');
  assert.equal(r.text.length, 1478);
  assert.equal(r.ocr_chars_as_taken, 732);
  assert.equal(r.ocr_chars_upscaled, 1478);
});

test('the original wins when enlarging does not help — no regression, ever', () => {
  const r = pickBetterRead({ text: 'x'.repeat(1478) }, { text: 'y'.repeat(900) });
  assert.equal(r.variant, 'as_taken');
  assert.equal(r.text.length, 1478);
});

test('a tie keeps the original, so the rows cannot flatter the upscale', () => {
  const r = pickBetterRead({ text: 'x'.repeat(1000) }, { text: 'x'.repeat(1000) });
  assert.equal(r.variant, 'as_taken');
});

test('an upscale that failed entirely leaves the original read intact', () => {
  const r = pickBetterRead({ text: 'x'.repeat(1000) }, null);
  assert.equal(r.variant, 'as_taken');
  assert.equal(r.text.length, 1000);
  assert.equal(r.ocr_chars_upscaled, 0);
});

test('both reads empty is reported, not crashed on', () => {
  const r = pickBetterRead({ text: null, reason: 'vision_no_text' }, null);
  assert.equal(r.text, null);
  assert.equal(r.reason, 'vision_no_text');
  assert.equal(r.ocr_chars_as_taken, 0);
});

test('the reason travels with whichever read won', () => {
  const r = pickBetterRead({ text: 'x'.repeat(10), reason: 'short' },
                           { text: 'y'.repeat(99), reason: null });
  assert.equal(r.variant, 'upscaled');
  assert.equal(r.reason, null, 'the losing read’s reason must not be reported');
});

test('visionOcrBest is exported and takes the image', () => {
  assert.equal(typeof visionOcrBest, 'function');
  assert.equal(visionOcrBest.length, 1);
});
