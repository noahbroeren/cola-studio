'use strict';
/**
 * Application factory.
 *
 *   createCore(deps)  → routes + request handler for a given store/backends.
 *                       Shared by the Node server and the Vercel function.
 *   createApp(opts)   → the classic Node server: disk store, disk uploads,
 *                       in-process schedulers, node:http listener.
 *                       Used by server.js and by the integration tests.
 */
const http = require('node:http');
const path = require('node:path');
const { loadConfig } = require('./config');
const { createLogger } = require('./lib/log');
const { Router, HttpError, sendError, clientIp, readJson, sendJson, setSecurityHeaders, respond } = require('./lib/http');
const { Store, loadOrCreateSecret } = require('./lib/store');
const { createAuth } = require('./lib/auth');
const { createRateLimiter } = require('./lib/ratelimit');
const { MediaCache } = require('./services/media');
const { createTranslator } = require('./services/translate');
const { WeiboService } = require('./services/weibo');
const { WeidianService } = require('./services/weidian');
const { refreshRates } = require('./services/currency');
const { Scheduler } = require('./services/scheduler');
const { registerPublic } = require('./routes/public');
const { registerAdmin } = require('./routes/admin');
const { createPages } = require('./routes/pages');
const { createMediaHandler } = require('./routes/media');
const { createDiskUploads } = require('./lib/uploads');
const { versionAssets } = require('./lib/html');
const fs = require('node:fs');
const crypto = require('node:crypto');

/** Short hash of everything under public/assets — changes whenever CSS/JS/images change. */
function assetsHash(publicDir) {
  const h = crypto.createHash('sha1');
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|css)$/.test(e.name)) {
        h.update(e.name);
        try {
          h.update(fs.readFileSync(p));
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(path.join(publicDir, 'assets'));
  return h.digest('hex').slice(0, 10);
}

const DEV_PASSWORD = 'colastudio';

function readVersion() {
  try {
    return require('../package.json').version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * @param {object} [o]
 * @param {object} [o.env]     environment (default process.env)
 * @param {Function} [o.fetch] fetch implementation for all outbound calls
 * @param {object} [o.logger]
 * @param {Function} [o.sleep] used by services between upstream calls
 */
/** Resolve the admin password policy (shared by Node and Vercel). */
function resolvePassword(config, log) {
  const passwordState = { configured: true, isDefault: false };
  let password = config.adminPassword;
  if (!password) {
    if (config.production) {
      passwordState.configured = false;
      log.error('ADMIN_PASSWORD is not set — the admin panel is DISABLED until you set it (NODE_ENV=production).');
    } else {
      password = DEV_PASSWORD;
      passwordState.isDefault = true;
      log.warn('==================================================================');
      log.warn(`ADMIN_PASSWORD is not set — using the development default "${DEV_PASSWORD}".`);
      log.warn('Set ADMIN_PASSWORD in .env or the environment before going live!');
      log.warn('==================================================================');
    }
  } else if (password === DEV_PASSWORD) {
    passwordState.isDefault = true;
    log.warn(`ADMIN_PASSWORD is the public default "${DEV_PASSWORD}" — change it before going live.`);
  }
  return { password: password || '', passwordState };
}

/**
 * Build services, routes and the request handler around a store.
 *
 * @param {object} d
 * @param {object} d.config, d.log, d.store, d.auth, d.limiters, d.scheduler, d.passwordState
 * @param {object} d.uploads     { save(body), list(), remove(name), serve?(ctx) }
 * @param {object} [d.media]     MediaCache (Node) — optional
 * @param {Function} [d.handleMedia]  override for GET /media/weibo
 * @param {Function} [d.withLock]     (name, fn) → runs fn exclusively across instances
 * @param {Function} [d.readLogs]     async () → log lines (defaults to the in-memory ring)
 */
function createCore(d) {
  const { config, log, store, auth, limiters, scheduler, passwordState, uploads, media = null, version = readVersion() } = d;
  const fetchFn = d.fetch || globalThis.fetch;
  const sleep = d.sleep;
  const getPrivate = () => store.effectivePrivate(config.envOverrides);

  /* ----------------------------------------------------------- services */
  const translator = createTranslator({ getConfig: () => getPrivate().translation, fetch: fetchFn, log: log.child('translate') });
  const weibo = new WeiboService({
    getConfig: () => getPrivate().weibo,
    store,
    translator,
    media,
    log: log.child('weibo'),
    fetch: fetchFn,
    ...(sleep ? { sleep } : {}),
    prefetch: !!media && config.prefetchMedia,
  });
  const weidian = new WeidianService({
    getConfig: () => getPrivate().weidian,
    store,
    log: log.child('weidian'),
    fetch: fetchFn,
    ...(sleep ? { sleep } : {}),
    budgetMs: config.jobBudgetMs || 0,
  });

  const withLock = d.withLock || ((name, fn) => fn());
  const readLogs = d.readLogs || (async () => log.lines());
  const shared = { config, store, auth, log, weibo, weidian, translator, media, scheduler, getPrivate, limiters, version, passwordState, uploads, withLock, readLogs };

  /* ------------------------------------------------------------- routes */
  const api = new Router();
  registerPublic(api, shared);
  registerAdmin(api, shared);
  const pages = createPages(shared);
  const handleMedia = d.handleMedia || createMediaHandler({ media, log: log.child('media') });

  let siteHost = '';
  try {
    siteHost = new URL(config.siteUrl).host;
  } catch {
    /* ignore */
  }

  /** CSRF guard for state-changing requests: a present Origin must match this host. */
  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return false;
    }
    const reqHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() || req.headers.host;
    return host === reqHost || host === siteHost || config.allowedOrigins.includes(origin.replace(/\/+$/, ''));
  }

  async function handleApi(ctx) {
    const { req, res } = ctx;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'GET, HEAD, POST, PUT, PATCH, DELETE' });
      return res.end();
    }
    const match = api.match(req.method, ctx.path);
    if (!match) throw new HttpError(404, 'Not found');
    if (match.allowed) {
      res.setHeader('Allow', match.allowed.join(', '));
      throw new HttpError(405, 'Method not allowed');
    }
    const isAdmin = ctx.path.startsWith('/api/admin/');
    if (!['GET', 'HEAD'].includes(req.method) && !originAllowed(req)) throw new HttpError(403, 'Cross-origin request rejected');
    if (isAdmin && match.route.pattern !== '/api/admin/login') {
      const payload = auth.fromRequest(req);
      if (!payload) throw new HttpError(401, 'Unauthorized — log in again');
      ctx.admin = payload;
    }
    ctx.params = match.params;
    const limit = match.route.opts.bodyLimit || 1024 * 1024;
    ctx.body = () => readJson(req, limit);

    const result = await match.route.handler(ctx);
    // Persist before answering (the Redis store writes here; the disk store is debounced).
    if (typeof store.commit === 'function') await store.commit();
    if (res.headersSent || res.writableEnded) return;
    const publicGet = !isAdmin && req.method !== 'POST' && match.route.opts.publicCache;
    sendJson(req, res, ctx.status || 200, result === undefined ? { ok: true } : result, {
      etag: publicGet,
      cacheControl: publicGet ? config.publicCacheControl || 'no-cache' : 'no-store',
    });
  }

  function handleError(ctx, err) {
    const { req, res } = ctx;
    const known = err instanceof HttpError || (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600);
    const status = known ? err.status : 500;
    if (!known) log.error(`${req.method} ${ctx.path}: ${err && err.stack ? err.stack : err}`);
    if (res.headersSent) return res.destroy();
    if (status === 413) res.setHeader('Connection', 'close');
    if (err.extra && err.extra.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
    const message = known ? err.message : 'Internal server error';
    if (ctx.path.startsWith('/api') || ctx.path.startsWith('/media/')) return sendError(req, res, status, message);
    respond(req, res, { status, body: `<!doctype html><title>${status}</title><p>${status === 500 ? 'Something went wrong.' : message}</p>`, type: 'text/html; charset=utf-8' });
  }

  /**
   * Handle one request. `pathOverride` lets the Vercel adapter pass the
   * logical path when the platform rewrote the URL.
   */
  async function handler(req, res, pathOverride) {
    const started = Date.now();
    setSecurityHeaders(req, res, { production: config.production });
    let url;
    try {
      url = new URL(`http://local${req.url.startsWith('/') ? '' : '/'}${req.url}`);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    const ctx = { req, res, url, path: pathOverride || url.pathname, query: Object.fromEntries(url.searchParams), ip: clientIp(req, config.trustProxy), params: {}, status: 0 };
    if (config.logRequests) res.on('finish', () => log.info(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`));
    try {
      if (ctx.path === '/api' || ctx.path.startsWith('/api/')) await handleApi(ctx);
      else if (ctx.path === '/media/weibo' || ctx.path === '/media/img') await handleMedia(ctx);
      else if (ctx.path.startsWith('/uploads/') && typeof uploads.serve === 'function') await uploads.serve(ctx);
      else await pages.handle(ctx);
    } catch (err) {
      handleError(ctx, err);
    }
  }

  return { handler, weibo, weidian, translator, getPrivate, shared, version };
}

/**
 * The Node server.
 * @param {object} [o]
 * @param {object} [o.env]     environment (default process.env)
 * @param {Function} [o.fetch] fetch implementation for all outbound calls
 * @param {object} [o.logger]
 * @param {Function} [o.sleep] used by services between upstream calls
 */
function createApp({ env = process.env, fetch: fetchFn = globalThis.fetch, logger, sleep } = {}) {
  const config = loadConfig(env);
  const log = logger || createLogger({ silent: config.logSilent });
  const version = readVersion();
  const { password, passwordState } = resolvePassword(config, log);
  // Every release gets fresh ?v= asset URLs, so browsers never keep old CSS/JS.
  const assetVersion = assetsHash(config.publicDir);
  config.htmlTransform = (html) => versionAssets(html, assetVersion);

  const store = new Store({ dataDir: config.dataDir, publicDir: config.publicDir, log: log.child('store') }).init();
  const secret = config.sessionSecret || loadOrCreateSecret(config.dataDir);
  const auth = createAuth({ secret, password, ttlMs: config.tokenTtlMs });

  const media = new MediaCache({
    dir: path.join(config.dataDir, 'cache', 'weibo'),
    fetch: fetchFn,
    log: log.child('media'),
    videoMaxBytes: config.videoMaxBytes,
  });
  const uploads = createDiskUploads({ dir: config.uploadsDir, maxBytes: config.uploadMaxBytes });
  const limiters = {
    login: createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 }),
    publicPost: createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 }),
  };
  const scheduler = new Scheduler({ log: log.child('scheduler') });

  const core = createCore({ config, log, store, auth, limiters, scheduler, passwordState, uploads, media, version, fetch: fetchFn, sleep });
  const { weibo, weidian, translator, getPrivate } = core;

  scheduler.add('weibo', {
    interval: () => {
      const c = getPrivate().weibo;
      return c.enabled && c.uid ? Math.max(5, Number(c.intervalMinutes) || 15) * 60000 : 0;
    },
    run: () => weibo.run({ trigger: 'schedule' }),
    initialDelayMs: 20000,
  });
  scheduler.add('weidian', {
    interval: () => {
      const c = getPrivate().weidian;
      return c.enabled ? Math.max(2, Number(c.intervalMinutes) || 10) * 60000 : 0;
    },
    run: () => weidian.sync({ trigger: 'schedule' }),
    initialDelayMs: 30000,
  });
  scheduler.add('currency', {
    // Checks every 6 h; refreshRates itself only calls the API once a day.
    interval: () => (store.db.settings.currency?.autoUpdate ? 6 * 3600 * 1000 : 0),
    run: () => refreshRates({ store, fetch: fetchFn, log: log.child('currency') }),
    initialDelayMs: 45000,
  });

  const server = http.createServer((req, res) => {
    core.handler(req, res).catch((err) => {
      log.error(`unhandled: ${err && err.stack}`);
      try {
        if (!res.headersSent) sendError(req, res, 500, 'Internal server error');
        else res.destroy();
      } catch {
        /* ignore */
      }
    });
  });
  server.keepAliveTimeout = 65000; // longer than typical proxy idle timeouts
  server.headersTimeout = 66000;
  server.requestTimeout = 120000;

  function listen(port = config.port, host = config.host) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        if (config.schedulers) scheduler.start();
        resolve(server.address());
      });
    });
  }

  async function close() {
    scheduler.stop();
    await new Promise((resolve) => {
      server.close(() => resolve());
      if (server.closeIdleConnections) server.closeIdleConnections();
      setTimeout(() => {
        if (server.closeAllConnections) server.closeAllConnections();
        resolve();
      }, 3000).unref();
    });
    await Promise.race([weibo.idle(), new Promise((r) => setTimeout(r, 2000).unref())]);
    store.close();
  }

  return { config, store, server, log, auth, weibo, weidian, translator, media, scheduler, listen, close, version };
}

module.exports = { createApp, createCore, resolvePassword, readVersion, DEV_PASSWORD };
