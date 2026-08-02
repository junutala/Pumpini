// src/lib/face.js — PHASE 1 OF FACIAL RECOGNITION.
//
// Phase 0 (01-Aug-2026) put the camera BEFORE the operator picker and stored the
// photograph. This is the step the comment in shift-start promised: the picture
// now proposes WHO, and the picker becomes the fallback.
//
// WHY THIS RUNS IN THE BROWSER AND NOT ON THE SERVER. The model is ~6.5 MB of
// weights and a real tensor runtime. Putting that inside the Railway API would add
// it to the same process that settles shifts and writes credit sales — a memory
// spike or a failed native build there stops fuel being sold. Here it runs on the
// manager's phone, the weights are static files served from our own domain (no
// vendor, no third party ever sees a face), and the only thing that reaches the
// server is a list of 128 numbers. The server's whole job is arithmetic.
//
// WHAT A DESCRIPTOR IS. 128 floats that place a face in a space where the same
// person's photographs land close together. It is NOT reversible into a picture,
// so storing it is a smaller disclosure than the photograph we already keep.
//
// EVERYTHING HERE FAILS SOFT. No camera, no face found, bad light, an old phone
// that cannot run the model — every one of those returns null and the manager
// picks from the list exactly as he does today. A shift must never fail to start
// because a face could not be read.

let _api = null;      // the face-api module, imported on first use
let _loading = null;  // in-flight load, so two captures don't fetch 6.5 MB twice

// Euclidean distance between two 128-d descriptors. face-api's own convention:
// below ~0.6 is the same person. We are deliberately stricter than that, because
// the cost of a wrong name pre-filled is higher than the cost of asking.
export const STRONG = 0.45;   // confident — pre-select him
export const LIKELY = 0.58;   // probably him — pre-select, but say it is a guess
// Above LIKELY we propose nothing at all.

// A second face must be clearly further away than the best one, or we are choosing
// between two people who look alike and should not choose at all.
const MIN_MARGIN = 0.06;

// Load the module + weights once. Dynamic import keeps face-api out of the main
// bundle so every other screen in Pumpini is unaffected by its size.
async function ensureLoaded() {
  if (_api) return _api;
  if (_loading) return _loading;
  _loading = (async () => {
    const faceapi = await import('@vladmandic/face-api');
    const url = '/models';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(url),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(url),
      faceapi.nets.faceRecognitionNet.loadFromUri(url),
    ]);
    _api = faceapi;
    return faceapi;
  })();
  try {
    return await _loading;
  } catch (e) {
    _loading = null;   // let a later capture try again — a flaky network is not fatal
    throw e;
  }
}

// True once the weights are in memory, so a screen can show "getting ready" only
// when it is actually going to wait.
export function isReady() { return !!_api; }

// Start fetching the weights without blocking anything. Called when a screen that
// will need a face opens, so the model is usually warm by the time a photo is taken.
export function preload() {
  ensureLoaded().catch(() => { /* warming is best-effort by definition */ });
}

function toImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-decode-failed'));
    img.src = src;
  });
}

// Read ONE face out of a photograph.
//
// Returns { descriptor:number[128] } on success, or { error } naming what went
// wrong so the screen can say something useful instead of failing silently. Two
// faces in frame is an explicit refusal rather than a guess at which one is the
// operator.
export async function describe(dataUrl) {
  if (!dataUrl) return { error: 'no-image' };
  let faceapi;
  try { faceapi = await ensureLoaded(); }
  catch { return { error: 'model-load-failed' }; }

  let img;
  try { img = await toImageEl(dataUrl); }
  catch { return { error: 'image-decode-failed' }; }

  let results;
  try {
    results = await faceapi
      .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }))
      .withFaceLandmarks(true)      // true = the tiny landmark net, matching the weights we ship
      .withFaceDescriptors();
  } catch { return { error: 'detect-failed' }; }

  if (!results || results.length === 0) return { error: 'no-face' };
  if (results.length > 1)             return { error: 'many-faces' };

  const d = results[0].descriptor;
  if (!d || d.length !== 128) return { error: 'no-descriptor' };
  // Plain array so it survives JSON on the way to the server.
  return { descriptor: Array.from(d) };
}

export function distance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
  return Math.sqrt(sum);
}

// Compare one descriptor against the outlet's enrolled attendants.
//
// candidates: [{ user_id, name, descriptor:number[128] }]
// Returns { user_id, name, distance, verdict, runner_up } — verdict is one of
// 'strong' | 'likely' | 'unsure'. 'unsure' still carries the closest name so the
// screen can say who it nearly was, but it must not pre-select anyone.
export function bestMatch(descriptor, candidates) {
  if (!descriptor || !Array.isArray(candidates) || !candidates.length) return null;
  const scored = candidates
    .filter(c => Array.isArray(c.descriptor) && c.descriptor.length === 128)
    .map(c => ({ user_id: c.user_id, name: c.name, distance: distance(descriptor, c.descriptor) }))
    .sort((a, b) => a.distance - b.distance);

  if (!scored.length) return null;
  const best = scored[0];
  const second = scored[1] || null;
  const margin = second ? second.distance - best.distance : Infinity;

  let verdict = 'unsure';
  if (best.distance <= STRONG && margin >= MIN_MARGIN)      verdict = 'strong';
  else if (best.distance <= LIKELY && margin >= MIN_MARGIN) verdict = 'likely';

  return {
    user_id: best.user_id,
    name: best.name,
    distance: Number(best.distance.toFixed(4)),
    verdict,
    runner_up: second ? { name: second.name, distance: Number(second.distance.toFixed(4)) } : null,
  };
}
