'use strict';
/**
 * In-memory fixed-window rate limiter (per key, usually per IP).
 * Good enough for a single-process site; resets on restart.
 */
function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map();

  function sweep(t) {
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
  }

  /** Register a hit. → { allowed, remaining, retryAfter (seconds) } */
  function hit(key) {
    const t = now();
    if (hits.size > 10000) sweep(t);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    const allowed = entry.count <= max;
    return {
      allowed,
      remaining: Math.max(0, max - entry.count),
      retryAfter: allowed ? 0 : Math.ceil((entry.resetAt - t) / 1000),
    };
  }

  function reset(key) {
    hits.delete(key);
  }

  return { hit, reset, size: () => hits.size };
}

module.exports = { createRateLimiter };
