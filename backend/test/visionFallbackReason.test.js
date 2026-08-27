// THE DOWNGRADE MUST SAY WHY.
//
// readImageAsJson falls back from google_vision+claude_text (97% line-match on the
// 25/26-Aug Sri Balaji composites) to claude_vision (63%, and every garbled serial).
// On 26-Aug that fallback fired on 3 of 8 scans and the reason existed nowhere: it
// went to warn() and stopped. The post-mortem had to reconstruct it from absence.
//
// These pin the reason codes themselves, because they are what a telemetry query
// will group by — a silently renamed code is a chart that quietly reads zero.
//
// visionOcr()'s text-or-null contract is pinned too: billScan and deliveries call it
// directly, and widening the return would have broken both.
const test   = require('node:test');
const assert = require('node:assert');
const { visionOcr, visionOcrDetailed, readImageAsJson } = require('../src/services/visionOcr');

const KEY = 'GOOGLE_VISION_API_KEY';
// Each case swaps global fetch, so nothing here reaches Google.
async function withFetch(impl, fn) {
  const realFetch = global.fetch, realKey = process.env[KEY];
  global.fetch = impl;
  process.env[KEY] = 'test-key';
  try { return await fn(); }
  finally {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env[KEY]; else process.env[KEY] = realKey;
  }
}
const jsonRes = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

test('no API key — named, not a bare null', async () => {
  const real = process.env[KEY];
  delete process.env[KEY];
  try {
    assert.deepStrictEqual(await visionOcrDetailed('abc'), { text: null, reason: 'vision_key_unset' });
  } finally { if (real !== undefined) process.env[KEY] = real; }
});

test('a good read reports NO reason — the happy path must not look like a fallback', async () => {
  await withFetch(jsonRes({ responses: [{ fullTextAnnotation: { text: 'PUMP SERIAL 15BC1412V' } }] }), async () => {
    const r = await visionOcrDetailed('abc');
    assert.strictEqual(r.text, 'PUMP SERIAL 15BC1412V');
    assert.strictEqual(r.reason, null);
  });
});

test('an HTTP failure carries its status, so a 403 key problem is not read as a bad photo', async () => {
  await withFetch(jsonRes({}, false, 403), async () => {
    assert.strictEqual((await visionOcrDetailed('abc')).reason, 'vision_http_403');
  });
});

test('Vision reporting its own error is distinct from Vision finding no text', async () => {
  await withFetch(jsonRes({ responses: [{ error: { message: 'bad image' } }] }), async () => {
    assert.strictEqual((await visionOcrDetailed('abc')).reason, 'vision_error');
  });
  await withFetch(jsonRes({ responses: [{}] }), async () => {
    assert.strictEqual((await visionOcrDetailed('abc')).reason, 'vision_no_text');
  });
});

test('a timeout is told apart from a network failure', async () => {
  const abort = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  await withFetch(abort, async () => {
    assert.strictEqual((await visionOcrDetailed('abc')).reason, 'vision_timeout');
  });
  await withFetch(async () => { throw new Error('ECONNREFUSED'); }, async () => {
    assert.strictEqual((await visionOcrDetailed('abc')).reason, 'vision_failed');
  });
});

test('visionOcr keeps its text-or-null contract for billScan and deliveries', async () => {
  await withFetch(jsonRes({ responses: [{ fullTextAnnotation: { text: 'hello' } }] }), async () => {
    assert.strictEqual(await visionOcr('abc'), 'hello');
  });
  await withFetch(jsonRes({ responses: [{}] }), async () => {
    assert.strictEqual(await visionOcr('abc'), null, 'must be null, never an object');
  });
});

// THE CASE THAT USED TO RECORD NOTHING.
//
// When BOTH engines fail there is no parsed result to hang anything on, and the
// pipeline used to return a bare failure — so the one moment worth recording, the
// frame that beat the reader, was the one moment nothing was recorded about. The
// composite route now saves that photograph as evidence, and this is what tells it
// why. Runs fully offline: Vision is stubbed to find no text, and with no API key
// the model call cannot be made either.
test('a TOTAL failure still carries why the good engine did not read it', async () => {
  const realFetch = global.fetch;
  const realVision = process.env.GOOGLE_VISION_API_KEY;
  const realAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.GOOGLE_VISION_API_KEY = 'test-key';
  delete process.env.ANTHROPIC_API_KEY;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ responses: [{}] }) });
  try {
    const r = await readImageAsJson({ file_base64: 'abc', prompt: 'x' });
    assert.strictEqual(r.parsed, null, 'nothing was read');
    assert.strictEqual(r.error, 'api', 'and the model was never reached');
    // The point of the whole change: the failure is explained, not merely reported.
    assert.strictEqual(r.fallback_reason, 'vision_no_text');
  } finally {
    global.fetch = realFetch;
    if (realVision === undefined) delete process.env.GOOGLE_VISION_API_KEY; else process.env.GOOGLE_VISION_API_KEY = realVision;
    if (realAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = realAnthropic;
  }
});
