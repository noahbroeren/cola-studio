'use strict';
/**
 * Stateless admin tokens: base64url(payload) + "." + base64url(HMAC-SHA256).
 *
 * The HMAC key is derived from SESSION_SECRET *and* the admin password, so
 * changing ADMIN_PASSWORD (or the secret) invalidates every issued token.
 */
const crypto = require('node:crypto');

function deriveKey(secret, password) {
  return crypto.createHmac('sha256', String(secret)).update(`cola-admin-v1:${password}`).digest();
}

function sign(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('base64url');
}

/** Constant-time string comparison (hash both sides so lengths never leak). */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a).length === String(b).length;
}

function createAuth({ secret, password, ttlMs = 7 * 24 * 3600 * 1000, now = () => Date.now() }) {
  if (!secret) throw new Error('auth: secret required');
  const key = deriveKey(secret, password);

  function issue() {
    const iat = now();
    const payload = { sub: 'admin', iat, exp: iat + ttlMs, n: crypto.randomBytes(6).toString('base64url') };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { token: `${body}.${sign(key, body)}`, expiresAt: new Date(payload.exp).toISOString() };
  }

  /** → payload or null */
  function verify(token) {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = sign(key, body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!payload || payload.sub !== 'admin' || typeof payload.exp !== 'number' || payload.exp <= now()) return null;
    return payload;
  }

  function checkPassword(candidate) {
    if (typeof candidate !== 'string' || !candidate) return false;
    return safeEqual(candidate, password);
  }

  function fromRequest(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? verify(m[1].trim()) : null;
  }

  return { issue, verify, checkPassword, fromRequest };
}

module.exports = { createAuth, safeEqual };
