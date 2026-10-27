'use strict';
/**
 * Vercel adapter: one serverless function (api/index.js) handles the API,
 * product pages (SEO), uploads, the Weibo media proxy, sitemap/robots and
 * the cron jobs. Static pages and assets are served by Vercel's CDN from
 * dist/ (see scripts/build-vercel.js and vercel.json).
 *
 * State lives in Upstash Redis:
 *   cola:c:<collection> / cola:r:<collection>   data + revision (RedisStore)
 *   cola:up:<name> + hash cola:uploads           admin uploads
 *   cola:rl:*                                    rate limits
 *   cola:lock:*                                  job locks (weibo/weidian)
 *   cola:logs                                    last 300 log lines
 *   cola:secret                                  session secret (if SESSION_SECRET unset)
 *   cola:backup:* + list cola:backups            snapshots (daily + pre-import)
 *
 * One core (routes + services) is built per function instance; each request
 * gets its own RedisStore through AsyncLocalStorage, so concurrent requests
 * on the same instance (fluid compute) never share mutable state.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { loadConfig } = require('../config');
const { createLogger } = require('../lib/log');
const { createCore, resolvePassword, readVersion } = require('../app');
const { createAuth } = require('../lib/auth');
const { HttpError, sendError, sendJson, respond } = require('../lib/http');
const { prepareUpload, UPLOAD_NAME, TYPES } = require('../lib/uploads');
const { allowedMediaUrl, MOBILE_UA } = require('../services/media');
const { refreshRates } = require('../services/currency');
const { createUpstash, upstashEnv } = require('./upstash');
const { RedisStore } = require('./redis-store');
const { RATE, UNLOCK } = require('./lua');
const { createMemoryRedis } = require('./memory-redis');
const { buildId } = require('../../scripts/build-vercel');
const { versionAssets } = require('../lib/html');

const PREFIX = 'cola:';
const LOG_KEEP = 300;
const MEDIA_CHUNK = 4 * 1024 * 1024; // stay under Vercel's 4.5 MB response limit
const UPLOAD_MAX = 3 * 1024 * 1024; // request bodies are limited to 4.5 MB (base64 adds ~33 %)

/* ------------------------------------------------------------------ routing */

const CORE = ['settings', 'categories', 'products', 'meta', 'inventoryEvents'];
const HEAVY_ROUTES = [
  [/^\/api\/updates/, ['updates']],
  [/^\/api\/contact$/, ['messages']],
  [/^\/api\/orders$/, ['orders']],
  [/^\/api\/notify$/, ['notify']],
  [/^\/api\/admin\/(updates|weibo)(\/|$)/, ['updates']],
  [/^\/api\/admin\/messages(\/|$)/, ['messages']],
  [/^\/api\/admin\/orders(\/|$)/, ['orders']],
  [/^\/api\/admin\/notify(\/|$)/, ['notify']],
];
const ALL_ROUTES = /^\/api\/admin\/(dashboard|export|import|demo|demo\/clear)$/;
const NO_STORE = /^\/(media\/weibo|uploads\/)/;

/** Which collections a request needs ('all', a list, or [] for none). */
function collectionsFor(p) {
  if (NO_STORE.test(p) || p === '/robots.txt') return [];
  if (ALL_ROUTES.test(p) || p.startsWith('/api/cron/')) return 'all';
  const extra = [];
  for (const [re, names] of HEAVY_ROUTES) if (re.test(p)) extra.push(...names);
  return [...CORE, ...extra];
}

/** Restore the logical URL when the request arrived through a vercel.json rewrite (?__route=…). */
function normalizeUrl(req) {
  let url;
  try {
    url = new URL(req.url, 'http://local');
  } catch {
    return '/';
  }
  const route = url.searchParams.get('__route');
  if (route != null) {
    url.searchParams.delete('__route');
    let p = route.startsWith('/') ? route : '/' + route;
    p = p.replace(/\/{2,}/g, '/');
    const qs = url.searchParams.toString();
    req.url = p + (qs ? '?' + qs : '');
    return p;
  }
  return url.pathname;
}

/* ----------------------------------------------------------------- the app */

function createVercelApp({ env = process.env, fetch: fetchFn = globalThis.fetch, redis, logger, sleep } = {}) {
  const config = loadConfig({ NODE_ENV: 'production', ...env });
  config.publicDir = env.PUBLIC_DIR ? path.resolve(config.root, env.PUBLIC_DIR) : path.join(config.root, 'public');
  config.trustProxy = 'true'; // Vercel sets X-Forwarded-For / X-Real-IP itself
  config.schedulers = false;
  config.uploadMaxBytes = UPLOAD_MAX;
  config.prefetchMedia = false;
  config.jobBudgetMs = 230000; // Weidian syncs stop in time for the 300 s function limit and resume next run
  // Product pages rendered by the function are cached briefly on the CDN as well.
  config.pageCacheControl = env.PAGE_CACHE_CONTROL || 'public, max-age=0, s-maxage=60, stale-while-revalidate=600';
  // Public GET responses are cached by Vercel's CDN for a short while.
  config.publicCacheControl = env.PUBLIC_CACHE_CONTROL || 'public, max-age=0, s-maxage=15, stale-while-revalidate=60';
  if (!env.SITE_URL && env.VERCEL_PROJECT_PRODUCTION_URL) config.siteUrl = `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  // Pages rendered by the function (product SEO pages, 404) use the same asset version as dist/.
  const assetVersion = buildId(env);
  config.htmlTransform = (html) => versionAssets(html, assetVersion);

  const pendingLogs = [];
  const baseLog = logger || createLogger({ silent: config.logSilent });
  const log = wrapLogger(baseLog, (e) => {
    pendingLogs.push(e);
    if (pendingLogs.length > LOG_KEEP) pendingLogs.splice(0, pendingLogs.length - LOG_KEEP);
  });
  const version = readVersion();

  const creds = redis ? null : upstashEnv(env);
  let kv = redis || (creds ? createUpstash({ ...creds, fetch: fetchFn }) : null);
  if (!kv && /^(1|true|yes)$/i.test(String(env.COLA_MEMORY_REDIS || ''))) {
    kv = createMemoryRedis();
    log.warn('Using in-memory Redis (COLA_MEMORY_REDIS=1) — data is lost on restart. Local testing only.');
  }
  const als = new AsyncLocalStorage();

  /* ------------------------------------------------------------ backends */

  async function flushLogs() {
    if (!pendingLogs.length || !kv) return;
    const batch = pendingLogs.splice(0);
    await kv.pipeline([['LPUSH', `${PREFIX}logs`, ...batch.map((e) => JSON.stringify(e))], ['LTRIM', `${PREFIX}logs`, '0', String(LOG_KEEP - 1)]]);
  }

  async function readLogs() {
    await flushLogs().catch(() => {});
    const rows = (await kv.cmd('LRANGE', `${PREFIX}logs`, '0', String(LOG_KEEP - 1))) || [];
    return rows
      .map((r) => {
        try {
          return JSON.parse(r);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  }

  function redisLimiter(name, { windowMs, max }) {
    const key = (k) => `${PREFIX}rl:${name}:${crypto.createHash('sha1').update(String(k)).digest('hex').slice(0, 20)}`;
    return {
      async hit(k) {
        try {
          const [count, ttl] = await kv.eval(RATE.lua, [key(k)], [String(windowMs)]);
          const allowed = Number(count) <= max;
          return { allowed, remaining: Math.max(0, max - Number(count)), retryAfter: allowed ? 0 : Math.ceil(Number(ttl) / 1000) };
        } catch (err) {
          log.warn(`rate limiter unavailable: ${err.message}`);
          return { allowed: true, remaining: max, retryAfter: 0 };
        }
      },
      async reset(k) {
        await kv.cmd('DEL', key(k)).catch(() => {});
      },
    };
  }

  /** Run fn while holding a Redis lock (one weibo/weidian job at a time across all instances). */
  async function withLock(name, fn, { ttlMs = 320000 } = {}) {
    const key = `${PREFIX}lock:${name}`;
    const token = crypto.randomBytes(8).toString('hex');
    const ok = await kv.cmd('SET', key, token, 'NX', 'PX', String(ttlMs));
    if (ok !== 'OK') throw new HttpError(409, `${name} is already running — try again in a minute`);
    try {
      return await fn();
    } finally {
      await kv.eval(UNLOCK.lua, [key], [token]).catch(() => {});
    }
  }

  const uploads = {
    kind: 'redis',
    async save(body) {
      const { buf, name, size, type } = prepareUpload(body, { maxBytes: UPLOAD_MAX });
      const meta = JSON.stringify({ size, type, modifiedAt: new Date().toISOString() });
      await kv.pipeline([
        ['SET', `${PREFIX}up:${name}`, buf.toString('base64')],
        ['HSET', `${PREFIX}uploads`, name, meta],
      ]);
      return { url: `/uploads/${name}`, name, size, type };
    },
    async list() {
      const flat = (await kv.cmd('HGETALL', `${PREFIX}uploads`)) || [];
      const out = [];
      for (let i = 0; i < flat.length; i += 2) {
        let m = {};
        try {
          m = JSON.parse(flat[i + 1]);
        } catch {
          /* ignore */
        }
        out.push({ name: flat[i], url: `/uploads/${encodeURIComponent(flat[i])}`, size: m.size || 0, type: m.type || 'application/octet-stream', modifiedAt: m.modifiedAt || '' });
      }
      return out.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
    },
    async remove(name) {
      if (!UPLOAD_NAME.test(String(name || ''))) throw new HttpError(400, 'Invalid file name');
      const [, removed] = await kv.pipeline([
        ['DEL', `${PREFIX}up:${name}`],
        ['HDEL', `${PREFIX}uploads`, name],
      ]);
      if (!Number(removed)) throw new HttpError(404, 'File not found');
      return true;
    },
    async serve(ctx) {
      const { req, res } = ctx;
      let name;
      try {
        name = decodeURIComponent(ctx.path.slice('/uploads/'.length));
      } catch {
        name = '';
      }
      if (!UPLOAD_NAME.test(name)) return sendError(req, res, 404, 'Not found');
      const b64 = await kv.cmd('GET', `${PREFIX}up:${name}`);
      if (!b64) return sendError(req, res, 404, 'Not found');
      const ext = name.split('.').pop();
      respond(req, res, {
        body: Buffer.from(b64, 'base64'),
        type: TYPES[ext] || 'application/octet-stream',
        // s-maxage lets Vercel's CDN keep the file, so Upstash is read once per image, not per visitor
        cacheControl: 'public, max-age=31536000, s-maxage=31536000, immutable',
        etag: `"${name}"`,
        headers: ext === 'svg' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" } : {},
      });
    },
  };

  /** Weibo media passthrough (no disk cache on Vercel — the CDN caches the responses). */
  async function handleMedia(ctx) {
    const { req, res } = ctx;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendError(req, res, 405, 'Method not allowed');
    }
    const raw = ctx.url.searchParams.get('u') || '';
    let target = allowedMediaUrl(raw);
    if (!target) return sendError(req, res, 400, 'Only *.sinaimg.cn (images) and *.weibocdn.com (video) URLs can be proxied');

    // Clamp ranges so every response stays below the function size limit.
    const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || '').trim());
    let range = null;
    if (m) {
      const start = Number(m[1]);
      const end = m[2] === '' ? start + MEDIA_CHUNK - 1 : Math.min(Number(m[2]), start + MEDIA_CHUNK - 1);
      range = `bytes=${start}-${end}`;
    }

    async function get(url) {
      let current = url;
      for (let hop = 0; hop < 4; hop++) {
        const r = await fetchFn(current.href, {
          headers: { Referer: 'https://m.weibo.cn/', 'User-Agent': MOBILE_UA, Accept: '*/*', ...(range ? { Range: range } : {}) },
          redirect: 'manual',
          signal: AbortSignal.timeout(25000),
        });
        if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
          const next = allowedMediaUrl(new URL(r.headers.get('location'), current).href);
          if (!next) throw new Error('redirect to a host that is not allowed');
          current = next;
          continue;
        }
        return r;
      }
      throw new Error('too many redirects');
    }

    try {
      let up = await get(target);
      let len = Number(up.headers.get('content-length') || 0);
      // Oversized images: fall back to Weibo's 1024px rendition.
      if (!range && up.ok && len > MEDIA_CHUNK && /sinaimg\.cn$/i.test(target.hostname)) {
        const smaller = allowedMediaUrl(target.href.replace(/\/(large|mw2000|mw1080|orj1080|oslarge|original)\//, '/mw1024/'));
        if (smaller && smaller.href !== target.href) {
          up.body?.cancel?.().catch?.(() => {});
          target = smaller;
          up = await get(target);
          len = Number(up.headers.get('content-length') || 0);
        }
      }
      if (!up.ok) {
        up.body?.cancel?.().catch?.(() => {});
        return sendError(req, res, up.status === 404 ? 404 : 502, 'Could not fetch media from Weibo');
      }
      const buf = Buffer.from(await up.arrayBuffer());
      const headers = { 'Accept-Ranges': 'bytes' };
      if (up.headers.get('content-range')) headers['Content-Range'] = up.headers.get('content-range');
      respond(req, res, {
        status: up.status === 206 ? 206 : 200,
        body: buf,
        type: up.headers.get('content-type') || 'application/octet-stream',
        cacheControl: up.status === 206 ? 'public, max-age=86400' : 'public, max-age=86400, s-maxage=31536000, immutable',
        headers,
      });
    } catch (err) {
      log.child('media').warn(`${err.message} (${raw.slice(0, 100)})`);
      return sendError(req, res, 502, 'Could not fetch media from Weibo');
    }
  }

  /* ---------------------------------------------------------------- core */

  // A facade that forwards to the store of the current request.
  const storeFacade = new Proxy(
    {},
    {
      get(_, prop) {
        const s = als.getStore();
        if (!s) throw new Error('No request store (called outside a request)');
        const v = Reflect.get(s, prop, s);
        return typeof v === 'function' ? v.bind(s) : v;
      },
      set(_, prop, value) {
        const s = als.getStore();
        if (!s) throw new Error('No request store (called outside a request)');
        s[prop] = value;
        return true;
      },
      has(_, prop) {
        const s = als.getStore();
        return !!s && prop in s;
      },
    }
  );

  const { password, passwordState } = resolvePassword(config, log);
  let ready = null;
  let core = null;

  function init() {
    if (!ready) {
      ready = (async () => {
        let secret = config.sessionSecret;
        if (!secret) {
          const fresh = crypto.randomBytes(48).toString('base64url');
          await kv.cmd('SET', `${PREFIX}secret`, fresh, 'NX');
          secret = await kv.cmd('GET', `${PREFIX}secret`);
        }
        const auth = createAuth({ secret, password, ttlMs: config.tokenTtlMs });
        const limiters = {
          login: redisLimiter('login', { windowMs: 15 * 60 * 1000, max: 10 }),
          publicPost: redisLimiter('post', { windowMs: 10 * 60 * 1000, max: 20 }),
        };
        // Jobs run from Vercel Cron (/api/cron/tick), not from an in-process scheduler.
        const scheduler = { status: () => ({}), reschedule() {}, start() {}, stop() {} };
        core = createCore({ config, log, store: storeFacade, auth, limiters, scheduler, passwordState, uploads, media: null, version, fetch: fetchFn, sleep, handleMedia, withLock, readLogs });
      })().catch((err) => {
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  function newStore() {
    return new RedisStore({ redis: kv, publicDir: config.publicDir, log: log.child('store'), prefix: PREFIX, onCommit: flushLogs });
  }

  /* --------------------------------------------------------------- cron */

  const DAY = 24 * 3600 * 1000;

  function cronAuthorized(req, url) {
    const secret = env.CRON_SECRET;
    if (!secret) return false;
    const h = String(req.headers.authorization || '');
    const given = /^Bearer\s+(.+)$/i.exec(h)?.[1] || url.searchParams.get('key') || '';
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(secret).digest();
    return crypto.timingSafeEqual(a, b);
  }

  const ts = (v) => {
    const t = Date.parse(v || '');
    return Number.isFinite(t) ? t : 0;
  };

  /** Which jobs are due now. */
  function dueJobs(store, now = Date.now()) {
    const priv = core.getPrivate();
    const sync = store.db.meta.sync || {};
    const due = [];
    const wb = priv.weibo;
    if (wb.enabled && wb.uid && now - ts(sync.weibo?.at) >= Math.max(5, Number(wb.intervalMinutes) || 15) * 60000 - 90000) due.push('weibo');
    const wd = priv.weidian;
    if (wd.enabled && now - ts(sync.weidian?.at) >= Math.max(5, Number(wd.intervalMinutes) || 10) * 60000 - 90000) due.push('weidian');
    if (store.db.settings.currency?.autoUpdate && now - ts(store.db.settings.currency?.updatedAt) >= DAY - 10 * 60000) due.push('currency');
    return due;
  }

  async function runJob(name) {
    if (name === 'weibo') return withLock('weibo', () => core.weibo.run({ trigger: 'cron' }));
    if (name === 'weidian') return withLock('weidian', () => core.weidian.sync({ trigger: 'cron' }));
    if (name === 'currency') return refreshRates({ store: storeFacade, fetch: fetchFn, log: log.child('currency'), force: false });
    if (name === 'backup') return { backup: storeFacade.snapshot('daily') };
    throw new HttpError(404, `Unknown job "${name}"`);
  }

  function summarize(r) {
    if (!r || typeof r !== 'object') return r;
    const out = {};
    for (const k of ['added', 'fetched', 'changed', 'items', 'remaining', 'skipped', 'updated', 'error', 'backup', 'applied']) if (r[k] !== undefined) out[k] = r[k];
    if (Array.isArray(r.errors) && r.errors.length) out.errors = r.errors.slice(0, 5);
    return out;
  }

  async function handleCron(req, res, p, url) {
    if (!cronAuthorized(req, url)) {
      if (!env.CRON_SECRET) log.warn('cron call rejected: CRON_SECRET is not set');
      return sendError(req, res, 401, 'Unauthorized');
    }
    const job = p.slice('/api/cron/'.length).replace(/\/+$/, '');
    const store = newStore();
    await store.load('all');
    const results = {};
    await als.run(store, async () => {
      let jobs;
      if (job === 'tick' || job === '') {
        jobs = dueJobs(store);
        const day = new Date().toISOString().slice(0, 10);
        const last = await kv.cmd('GET', `${PREFIX}backup:day`);
        if (last !== day) {
          jobs.push('backup');
          await kv.cmd('SET', `${PREFIX}backup:day`, day);
        }
      } else jobs = [job];
      await Promise.all(
        jobs.map(async (j) => {
          try {
            results[j] = summarize(await runJob(j));
          } catch (err) {
            results[j] = { error: err.message };
            if (!(err instanceof HttpError)) log.error(`cron ${j}: ${err.message}`);
          }
        })
      );
      await store.commit();
    });
    await flushLogs().catch(() => {});
    sendJson(req, res, 200, { ok: true, ran: Object.keys(results), results });
  }

  /* ------------------------------------------------------------- handler */

  async function handle(req, res) {
    const p = normalizeUrl(req);
    if (!kv) {
      return sendError(req, res, 503, 'Storage is not configured: connect an Upstash Redis database (UPSTASH_REDIS_REST_URL / KV_REST_API_URL).');
    }
    try {
      await init();
      if (p.startsWith('/api/cron/')) {
        const url = new URL(req.url, 'http://local');
        return await handleCron(req, res, p, url);
      }
      const store = newStore();
      const names = collectionsFor(p);
      if (names === 'all' || names.length) await store.load(names);
      await als.run(store, () => core.handler(req, res));
    } catch (err) {
      log.error(`${req.method} ${p}: ${err && err.stack ? err.stack : err}`);
      await flushLogs().catch(() => {});
      if (!res.headersSent) sendError(req, res, err.status || 500, err.status ? err.message : 'Internal server error');
      else res.destroy();
    }
  }

  return { handle, config, log, collectionsFor, normalizeUrl, redis: kv, flushLogs, newStore, getCore: () => core, init };
}

/** Logger that also feeds every entry to `sink` (for persisting to Redis). */
function wrapLogger(base, sink) {
  const wrap = (l) => {
    const api = {};
    for (const level of ['debug', 'info', 'warn', 'error']) {
      api[level] = (...args) => {
        const e = l[level](...args);
        if (e) sink(e);
        return e;
      };
    }
    api.child = (scope) => wrap(l.child(scope));
    api.capture = (lines, scope) => wrap(l.capture(lines, scope));
    api.lines = () => l.lines();
    return api;
  };
  return wrap(base);
}

let singleton = null;
/** Lazily created app for the serverless entry point. */
function getVercelApp() {
  if (!singleton) singleton = createVercelApp();
  return singleton;
}

module.exports = { createVercelApp, getVercelApp, collectionsFor, normalizeUrl };
