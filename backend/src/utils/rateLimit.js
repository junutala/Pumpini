// src/utils/rateLimit.js
//
// A small in-memory sliding-window limiter for the PUBLIC, unauthenticated
// endpoints (the lead form and its transcription). index.js already sets
// `trust proxy` so req.ip is the real client behind Railway's proxy — but no
// limiter was ever actually installed (express-rate-limit is not in
// package.json), so that line has been aspirational. This is the missing half.
//
// Deliberately dependency-free and in-process: the backend runs as a single
// Railway service, so one Map is the whole picture. If the backend is ever
// scaled to multiple instances the ceiling becomes per-instance rather than
// global — acceptable for spam damping, NOT a security control. Anything that
// must be enforced exactly belongs in the database, not here.

const BUCKETS = new Map();          // key → number[] of request timestamps
const SWEEP_EVERY_MS = 10 * 60_000; // drop cold keys so the Map can't grow forever

let lastSweep = Date.now();

function sweep(now, windowMs) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, hits] of BUCKETS) {
    if (!hits.length || now - hits[hits.length - 1] > windowMs) BUCKETS.delete(key);
  }
}

/**
 * Express middleware: at most `max` requests per `windowMs` per client IP.
 *
 * @param {object} opts
 * @param {number} opts.windowMs  window length in ms
 * @param {number} opts.max       requests allowed inside the window
 * @param {string} opts.name      bucket namespace, so two limiters don't share counts
 * @param {string} [opts.message] body message on 429
 */
function rateLimit({ windowMs, max, name, message = 'Too many requests. Please try again shortly.' }) {
  return (req, res, next) => {
    const now = Date.now();
    sweep(now, windowMs);

    const key = `${name}:${req.ip || 'unknown'}`;
    const hits = (BUCKETS.get(key) || []).filter(t => now - t < windowMs);

    if (hits.length >= max) {
      BUCKETS.set(key, hits);
      const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message, retry_after_seconds: retryAfter });
    }

    hits.push(now);
    BUCKETS.set(key, hits);
    next();
  };
}

module.exports = { rateLimit };
