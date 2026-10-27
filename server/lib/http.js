'use strict';
/**
 * Small HTTP toolkit on top of node:http — router with params, JSON bodies
 * with size limits, cookies, static files (ETag, Range, gzip, cache headers),
 * path-traversal protection and security headers.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/* ------------------------------------------------------------------------ */
/* MIME types                                                                */
/* ------------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.wasm': 'application/wasm',
};

const mimeFor = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

const COMPRESSIBLE =
  /^(text\/|application\/(json|javascript|xml|manifest\+json|ld\+json|vnd\.ms-fontobject)|image\/svg\+xml|font\/(ttf|otf))/;
const isCompressible = (type) => COMPRESSIBLE.test(type || '');

/* ------------------------------------------------------------------------ */
/* Router                                                                     */
/* ------------------------------------------------------------------------ */

class Router {
  constructor() {
    this.routes = [];
  }

  /**
   * Register a route. Pattern segments starting with ":" are params,
   * a trailing "*" captures the rest as params.wild.
   */
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const body = pattern
      .replace(/\/+$/, '')
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        if (seg === '*') {
          keys.push('wild');
          return '(.*)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method: method.toUpperCase(), pattern, re: new RegExp(`^${body}/?$`), keys, handler, opts });
    return this;
  }

  get(p, h, o) {
    return this.add('GET', p, h, o);
  }
  post(p, h, o) {
    return this.add('POST', p, h, o);
  }
  put(p, h, o) {
    return this.add('PUT', p, h, o);
  }
  patch(p, h, o) {
    return this.add('PATCH', p, h, o);
  }
  delete(p, h, o) {
    return this.add('DELETE', p, h, o);
  }

  /** → { route, params } | { allowed: [methods] } | null */
  match(method, pathname) {
    const allowed = new Set();
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) {
        allowed.add(r.method);
        continue;
      }
      const params = {};
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1]);
        } catch {
          params[k] = m[i + 1];
        }
      });
      return { route: r, params };
    }
    return allowed.size ? { allowed: [...allowed] } : null;
  }
}

/* ------------------------------------------------------------------------ */
/* Request helpers                                                            */
/* ------------------------------------------------------------------------ */

function isPrivateIp(ip) {
  if (!ip) return false;
  const v = ip.replace(/^::ffff:/, '');
  return (
    v === '::1' ||
    v === 'localhost' ||
    /^127\./.test(v) ||
    /^10\./.test(v) ||
    /^192\.168\./.test(v) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v) ||
    /^169\.254\./.test(v) ||
    /^f[cd][0-9a-f]{2}:/i.test(v) ||
    /^fe80:/i.test(v)
  );
}

/**
 * Client IP. Proxy headers are only trusted when configured (or, in "auto"
 * mode, when the direct peer is a loopback/private address — i.e. a local
 * reverse proxy such as nginx or a Docker bridge).
 */
function clientIp(req, trustProxy = 'auto') {
  const remote = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const trusted =
    trustProxy === '1' || trustProxy === 'true' || trustProxy === 'yes' || (trustProxy === 'auto' && isPrivateIp(remote));
  if (!trusted) return remote || 'unknown';
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim().replace(/^::ffff:/, '');
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    // Right-most non-private entry = the address our proxy actually saw.
    const parts = String(xff)
      .split(',')
      .map((s) => s.trim().replace(/^::ffff:/, ''))
      .filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) if (!isPrivateIp(parts[i])) return parts[i];
    if (parts.length) return parts[0];
  }
  return remote || 'unknown';
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || out[k] !== undefined) continue;
    let v = part.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function serializeCookie(name, value, opts = {}) {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge != null) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
  if (opts.expires) s += `; Expires=${opts.expires.toUTCString()}`;
  s += `; Path=${opts.path || '/'}`;
  if (opts.domain) s += `; Domain=${opts.domain}`;
  if (opts.httpOnly !== false) s += '; HttpOnly';
  if (opts.secure) s += '; Secure';
  s += `; SameSite=${opts.sameSite || 'Lax'}`;
  return s;
}

/** Read the raw body, enforcing `limit` bytes. */
function readBody(req, limit = 1024 * 1024) {
  // Some hosts (Vercel helpers) may already have consumed and parsed the stream.
  if (req.readableEnded && req.body !== undefined) {
    const b = req.body;
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(typeof b === 'string' ? b : JSON.stringify(b ?? ''));
    if (buf.length > limit) return Promise.reject(new HttpError(413, `Request body too large (max ${Math.round(limit / 1024)} KB)`));
    return Promise.resolve(buf);
  }
  if (req.readableEnded) return Promise.resolve(Buffer.alloc(0)); // stream already consumed elsewhere — never wait for an 'end' that won't come
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      req.resume();
      return reject(new HttpError(413, `Request body too large (max ${Math.round(limit / 1024)} KB)`));
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        reject(new HttpError(413, `Request body too large (max ${Math.round(limit / 1024)} KB)`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
}

async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  const type = String(req.headers['content-type'] || '');
  if (type && !/json|text\/plain/i.test(type)) {
    throw new HttpError(415, 'Expected a JSON body (Content-Type: application/json)');
  }
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

/* ------------------------------------------------------------------------ */
/* Response helpers                                                           */
/* ------------------------------------------------------------------------ */

const acceptsGzip = (req) => /\bgzip\b(?!\s*;\s*q=0(\.0*)?\b)/i.test(String(req.headers['accept-encoding'] || ''));

function etagMatches(req, etag) {
  const inm = req.headers['if-none-match'];
  if (!inm || !etag) return false;
  if (inm.trim() === '*') return true;
  const strip = (t) => t.trim().replace(/^W\//, '');
  const target = strip(etag);
  return inm.split(',').some((t) => strip(t) === target);
}

function setSecurityHeaders(req, res, { production } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (production && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
}

/** Content-Security-Policy for HTML documents (kept permissive enough for fonts, WhatsApp links and remote images). */
const HTML_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https:",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "form-action 'self' https://wa.me https://api.whatsapp.com",
].join('; ');

/**
 * Generic buffered response with optional ETag (+304) and gzip.
 * @param {object} o { status, body, type, headers, etag (true|string), cacheControl }
 */
function respond(req, res, o) {
  const status = o.status || 200;
  let body = o.body == null ? Buffer.alloc(0) : Buffer.isBuffer(o.body) ? o.body : Buffer.from(String(o.body));
  const type = o.type || 'application/octet-stream';
  const headers = { ...(o.headers || {}) };
  if (o.cacheControl) headers['Cache-Control'] = o.cacheControl;

  let etag = o.etag === true ? `W/"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 27)}"` : o.etag;
  if (etag && status === 200) {
    headers.ETag = etag;
    if (etagMatches(req, etag)) {
      res.writeHead(304, headers);
      return res.end();
    }
  }

  headers['Content-Type'] = type;
  if (isCompressible(type) && body.length > 1024 && acceptsGzip(req)) {
    body = zlib.gzipSync(body, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  } else if (isCompressible(type)) {
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendJson(req, res, status, data, { headers, etag = false, cacheControl = 'no-store' } = {}) {
  respond(req, res, {
    status,
    body: JSON.stringify(data),
    type: 'application/json; charset=utf-8',
    headers,
    etag,
    cacheControl,
  });
}

function sendError(req, res, status, message, extra) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(req, res, status, { error: message, ...(extra || {}) });
}

function redirect(res, location, status = 301) {
  res.writeHead(status, { Location: location, 'Content-Length': 0 });
  res.end();
}

/* ------------------------------------------------------------------------ */
/* Static files                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Resolve a URL pathname inside `root`. Returns null for anything that could
 * escape the root (.., encoded separators, NUL bytes) or hits a dotfile.
 */
function safeJoin(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  decoded = decoded.replace(/\\/g, '/');
  const segments = decoded.split('/');
  if (segments.some((s) => s === '..')) return null;
  if (segments.some((s) => s.startsWith('.') && s !== '.well-known')) return null;
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, '.' + path.posix.normalize('/' + decoded));
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  return abs;
}

/** Small LRU for gzipped static files so we don't recompress on every request. */
class GzipCache {
  constructor(maxBytes = 32 * 1024 * 1024) {
    this.max = maxBytes;
    this.size = 0;
    this.map = new Map();
  }
  get(key) {
    const v = this.map.get(key);
    if (v) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key, buf) {
    if (buf.length > this.max / 4) return;
    if (this.map.has(key)) this.size -= this.map.get(key).length;
    this.map.set(key, buf);
    this.size += buf.length;
    for (const [k, v] of this.map) {
      if (this.size <= this.max) break;
      this.map.delete(k);
      this.size -= v.length;
    }
  }
}
const gzipCache = new GzipCache();

function statFile(file) {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

/**
 * Serve a file from disk. Returns false when the file does not exist.
 * Supports conditional GET (ETag / If-Modified-Since), single byte ranges
 * (needed for <video> in Safari) and gzip for text types.
 */
function serveFile(req, res, file, { cacheControl = 'no-cache', type, headers = {}, stat } = {}) {
  const st = stat || statFile(file);
  if (!st) return false;
  const mime = type || mimeFor(file);
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const base = {
    ...headers,
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
    'Cache-Control': cacheControl,
  };

  const notModified = req.headers['if-none-match']
    ? etagMatches(req, etag)
    : req.headers['if-modified-since'] && Date.parse(req.headers['if-modified-since']) >= Math.floor(st.mtimeMs / 1000) * 1000;
  if (notModified) {
    res.writeHead(304, base);
    res.end();
    return true;
  }

  // Byte ranges (no compression for ranged responses).
  const range = req.headers.range;
  const ifRange = req.headers['if-range'];
  if (range && (!ifRange || ifRange === etag) && /^bytes=/.test(range)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start;
    let end;
    if (m) {
      if (m[1] === '' && m[2] !== '') {
        start = Math.max(0, st.size - Number(m[2]));
        end = st.size - 1;
      } else if (m[1] !== '') {
        start = Number(m[1]);
        end = m[2] === '' ? st.size - 1 : Math.min(Number(m[2]), st.size - 1);
      }
    }
    if (start === undefined || start > end || start >= st.size) {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${st.size}` });
      res.end();
      return true;
    }
    res.writeHead(206, {
      ...base,
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${st.size}`,
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    pipeFile(file, res, { start, end });
    return true;
  }

  if (isCompressible(mime) && st.size > 1024 && st.size < 8 * 1024 * 1024 && acceptsGzip(req)) {
    const key = `${file}|${etag}`;
    let gz = gzipCache.get(key);
    if (!gz) {
      try {
        gz = zlib.gzipSync(fs.readFileSync(file), { level: 6 });
        gzipCache.set(key, gz);
      } catch {
        return false;
      }
    }
    res.writeHead(200, {
      ...base,
      'Content-Type': mime,
      'Content-Encoding': 'gzip',
      Vary: 'Accept-Encoding',
      'Content-Length': gz.length,
    });
    res.end(req.method === 'HEAD' ? undefined : gz);
    return true;
  }

  res.writeHead(200, {
    ...base,
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Content-Length': st.size,
    ...(isCompressible(mime) ? { Vary: 'Accept-Encoding' } : {}),
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  pipeFile(file, res);
  return true;
}

function pipeFile(file, res, opts) {
  const stream = fs.createReadStream(file, opts);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

module.exports = {
  HttpError,
  Router,
  MIME,
  mimeFor,
  isCompressible,
  isPrivateIp,
  clientIp,
  parseCookies,
  serializeCookie,
  readBody,
  readJson,
  acceptsGzip,
  etagMatches,
  setSecurityHeaders,
  HTML_CSP,
  respond,
  sendJson,
  sendError,
  redirect,
  safeJoin,
  statFile,
  serveFile,
};
