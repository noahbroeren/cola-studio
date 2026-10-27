'use strict';
/**
 * Disk cache + proxy for Weibo media.
 *
 * Weibo's image CDN (*.sinaimg.cn) blocks hotlinking (it checks the Referer),
 * and video URLs (*.weibocdn.com) are signed and expire after a few hours. We
 * therefore fetch media server-side with a Weibo referer and keep a copy in
 * data/cache/weibo/<sha1>.<ext>. The site only ever links to
 * /media/weibo?u=<original url>.
 */
const fs = require('node:fs');
const path = require('node:path');
const { sha1, writeFileAtomic } = require('../lib/util');

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

// Weibo (images + video) and Weidian's image CDN (photos of imported products).
const ALLOWED_HOSTS = [/(^|\.)sinaimg\.cn$/i, /(^|\.)weibocdn\.com$/i, /(^|\.)geilicdn\.com$/i];
const refererFor = (u) => (/(^|\.)geilicdn\.com$/i.test(u.hostname) ? 'https://weidian.com/' : 'https://m.weibo.cn/');
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};
const KNOWN_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'mp4', 'mov']);

/** → URL object when the URL is an allowed Weibo media host, else null. */
function allowedMediaUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let u;
  try {
    u = new URL(raw.startsWith('//') ? 'https:' + raw : raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || (u.port && u.port !== '80' && u.port !== '443')) return null;
  if (!ALLOWED_HOSTS.some((re) => re.test(u.hostname))) return null;
  return u;
}

const isVideoUrl = (u) => /weibocdn\.com$/i.test(u.hostname) || /\.(mp4|mov)$/i.test(u.pathname);

async function readLimited(res, max) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > max) throw new Error(`file too large (${len} bytes)`);
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new Error('file too large');
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new Error('file too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

class MediaCache {
  constructor({ dir, fetch, log, imageMaxBytes = 20 * 1024 * 1024, videoMaxBytes = 60 * 1024 * 1024 }) {
    this.dir = dir;
    this.fetch = fetch;
    this.log = log || { info() {}, warn() {} };
    this.imageMaxBytes = imageMaxBytes;
    this.videoMaxBytes = videoMaxBytes;
    this.index = new Map(); // sha1 → filename
    this.inflight = new Map();
    this.failures = new Map(); // url → retryAfter timestamp
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) {
        const m = /^([0-9a-f]{40})\.(\w+)$/.exec(f);
        if (m) this.index.set(m[1], f);
      }
    } catch (err) {
      this.log.warn(`media cache unavailable: ${err.message}`);
    }
  }

  static proxyUrl(original) {
    return `/media/weibo?u=${encodeURIComponent(original)}`;
  }

  /** Cached file path for a URL, or null. */
  cachedFile(url) {
    const name = this.index.get(sha1(url));
    if (!name) return null;
    const file = path.join(this.dir, name);
    if (fs.existsSync(file)) return file;
    this.index.delete(sha1(url));
    return null;
  }

  /** Return a cached file path, downloading first when needed. Throws on failure. */
  async ensure(url) {
    const u = allowedMediaUrl(url);
    if (!u) throw Object.assign(new Error('host not allowed'), { status: 400 });
    const hit = this.cachedFile(url);
    if (hit) return hit;
    const retryAt = this.failures.get(url);
    if (retryAt && retryAt > Date.now()) throw Object.assign(new Error('upstream recently failed'), { status: 502 });
    if (this.inflight.has(url)) return this.inflight.get(url);
    const p = this.download(u, url).finally(() => this.inflight.delete(url));
    this.inflight.set(url, p);
    return p;
  }

  async download(u, key) {
    const video = isVideoUrl(u);
    const max = video ? this.videoMaxBytes : this.imageMaxBytes;
    try {
      let current = u;
      let res;
      // Follow at most 3 redirects, and only to allowed hosts (no SSRF via redirect).
      for (let hop = 0; hop < 4; hop++) {
        res = await this.fetch(current.href, {
          headers: {
            'User-Agent': MOBILE_UA,
            Referer: refererFor(current),
            Accept: video ? 'video/*,*/*;q=0.5' : 'image/avif,image/webp,image/*,*/*;q=0.5',
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(video ? 180000 : 30000),
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          const next = allowedMediaUrl(new URL(res.headers.get('location'), current).href);
          if (!next) throw new Error('redirect to a host that is not allowed');
          current = next;
          continue;
        }
        break;
      }
      if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (type && !/^(image|video)\//.test(type) && type !== 'application/octet-stream') {
        throw new Error(`unexpected content-type "${type}"`);
      }
      const buf = await readLimited(res, max);
      if (!buf.length) throw new Error('empty response');
      let ext = (path.extname(u.pathname).slice(1) || '').toLowerCase();
      if (!KNOWN_EXT.has(ext)) ext = EXT_BY_TYPE[type] || (video ? 'mp4' : 'jpg');
      if (ext === 'jpeg') ext = 'jpg';
      const name = `${sha1(key)}.${ext}`;
      const file = path.join(this.dir, name);
      writeFileAtomic(file, buf);
      this.index.set(sha1(key), name);
      this.failures.delete(key);
      return file;
    } catch (err) {
      this.failures.set(key, Date.now() + 10 * 60 * 1000);
      throw Object.assign(new Error(`media fetch failed: ${err.message}`), { status: 502 });
    }
  }

  /** Best-effort sequential prefetch (used right after a Weibo import). */
  async prefetch(urls) {
    let ok = 0;
    for (const url of urls) {
      try {
        await this.ensure(url);
        ok++;
      } catch (err) {
        this.log.warn(`prefetch ${url.slice(0, 80)}…: ${err.message}`);
      }
    }
    return ok;
  }
}

module.exports = { MediaCache, allowedMediaUrl, MOBILE_UA };
