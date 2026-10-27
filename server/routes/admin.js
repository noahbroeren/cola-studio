'use strict';
/**
 * Admin JSON API (see docs/API.md → "Admin endpoints").
 * Bearer-token auth is enforced centrally in app.js for every /api/admin/*
 * route except /api/admin/login.
 */
const { HttpError, sendJson } = require('../lib/http');
const { isObj, clone, str, toBool, toNumber, clamp, slugify, uniqueSlug, randomId, withDefaults } = require('../lib/util');
const { normalizeProduct, nextProductId, remapSku, safeUrl, strArray } = require('../lib/products');
const { stockStatus } = require('../lib/stock');
const { DEFAULT_SETTINGS, normalizeDb } = require('../lib/store');
const { CATEGORIES: UPDATE_CATEGORIES, PROVIDERS: TRANSLATION_PROVIDERS } = require('../services/translate');
const { PROVIDERS: WEIDIAN_PROVIDERS } = require('../services/weidian');
const { extractItemIds, importItems } = require('../services/weidian-import');
const { ENV_OVERRIDES } = require('../config');
const { byOrder } = require('./public');

const UPDATE_STATUSES = ['published', 'pending', 'hidden'];
const MASK = '••••';

/* ------------------------------------------------------------------------ */
/* Integrations schema (private config)                                      */
/* ------------------------------------------------------------------------ */

const SCHEMA = {
  weibo: {
    enabled: 'bool',
    uid: 'string',
    cookie: 'secret',
    intervalMinutes: ['number', 5, 1440],
    autoPublish: 'bool',
    backfill: ['number', 0, 20],
    lastId: 'lastId',
  },
  translation: {
    provider: ['enum', TRANSLATION_PROVIDERS],
    anthropicKey: 'secret',
    model: 'string',
    deeplKey: 'secret',
    googleKey: 'secret',
    libreUrl: 'string',
    libreKey: 'secret',
    glossary: 'text',
  },
  weidian: {
    enabled: 'bool',
    provider: ['enum', WEIDIAN_PROVIDERS],
    intervalMinutes: ['number', 2, 1440],
    appKey: 'string',
    appSecret: 'secret',
    accessToken: 'secret',
    feedUrl: 'string',
    sizeAliases: 'map',
    colorAliases: 'map',
    itemUrlTemplate: 'string',
    tokenUrl: 'string',
    apiUrl: 'string',
    apiMethod: 'string',
    apiVersion: 'string',
    delayMs: ['number', 0, 60000],
    priceUnit: ['enum', ['auto', 'cent', 'yuan']],
    fetchVia: 'secret',
  },
};

function maskValue(v) {
  if (!v) return '';
  const s = String(v);
  return MASK + (s.length >= 8 ? s.slice(-4) : '');
}

function maskedPrivate(effective) {
  const out = clone(effective);
  for (const [section, fields] of Object.entries(SCHEMA)) {
    for (const [key, type] of Object.entries(fields)) if (type === 'secret' && out[section]) out[section][key] = maskValue(out[section][key]);
  }
  return out;
}

function applyIntegrations(target, body) {
  for (const [section, fields] of Object.entries(SCHEMA)) {
    const input = body[section];
    if (input === undefined) continue;
    if (!isObj(input)) throw new HttpError(400, `${section} must be an object`);
    for (const [key, type] of Object.entries(fields)) {
      if (input[key] === undefined) continue;
      const v = input[key];
      const name = `${section}.${key}`;
      if (type === 'secret') {
        if (typeof v === 'string' && v.startsWith(MASK)) continue; // masked value sent back → keep the old secret
        target[section][key] = str(v, 8000).trim();
      } else if (type === 'bool') target[section][key] = toBool(v);
      else if (type === 'string') target[section][key] = str(v, 2000).trim();
      else if (type === 'text') target[section][key] = str(v, 50000);
      else if (type === 'lastId') {
        if (v === null || v === '') target[section][key] = null;
        else if (/^\d{1,25}$/.test(String(v))) target[section][key] = String(v);
        else throw new HttpError(400, `${name} must be a numeric Weibo id or null`);
      } else if (type === 'map') {
        if (!isObj(v)) throw new HttpError(400, `${name} must be an object of "from": "to" pairs`);
        target[section][key] = Object.fromEntries(
          Object.entries(v)
            .filter(([k, val]) => k && val !== undefined && val !== null && val !== '')
            .map(([k, val]) => [str(k, 60).trim(), str(val, 60).trim()])
        );
      } else if (Array.isArray(type) && type[0] === 'number') {
        const n = toNumber(v, null);
        if (n === null) throw new HttpError(400, `${name} must be a number`);
        target[section][key] = clamp(n, type[1], type[2]);
      } else if (Array.isArray(type) && type[0] === 'enum') {
        if (!type[1].includes(v)) throw new HttpError(400, `${name} must be one of: ${type[1].join(', ')}`);
        target[section][key] = v;
      }
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Updates                                                                    */
/* ------------------------------------------------------------------------ */

function normMedia(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(isObj)
    .map((m) => ({ ...m, type: ['image', 'illustration', 'video'].includes(m.type) ? m.type : 'image', ...(m.url !== undefined ? { url: safeUrl(m.url) } : {}) }))
    .filter((m) => m.type === 'illustration' || m.url)
    .slice(0, 30);
}

function applyUpdateFields(target, b, products) {
  if (b.title !== undefined) target.title = str(b.title, 300).trim();
  if (b.textEnglish !== undefined) target.textEnglish = str(b.textEnglish, 30000);
  if (b.textOriginal !== undefined) target.textOriginal = str(b.textOriginal, 30000);
  if (b.category !== undefined) {
    if (!UPDATE_CATEGORIES.includes(b.category)) throw new HttpError(400, `category must be one of ${UPDATE_CATEGORIES.join(', ')}`);
    target.category = b.category;
  }
  if (b.status !== undefined) {
    if (!UPDATE_STATUSES.includes(b.status)) throw new HttpError(400, `status must be one of ${UPDATE_STATUSES.join(', ')}`);
    target.status = b.status;
  }
  if (b.pinned !== undefined) target.pinned = toBool(b.pinned);
  if (b.relatedProducts !== undefined) {
    const ids = new Set(products.map((p) => p.id));
    target.relatedProducts = strArray(b.relatedProducts, { max: 20, maxLen: 40 }).filter((id) => ids.has(id));
  }
  if (b.media !== undefined) target.media = normMedia(b.media);
  if (b.video !== undefined) {
    target.video = isObj(b.video) && safeUrl(b.video.url) ? { ...b.video, url: safeUrl(b.video.url), poster: safeUrl(b.video.poster) || null } : null;
  }
  if (b.publishedAt !== undefined) {
    const t = Date.parse(b.publishedAt);
    if (!Number.isFinite(t)) throw new HttpError(400, 'publishedAt must be an ISO date');
    target.publishedAt = new Date(t).toISOString();
  }
}

/* ------------------------------------------------------------------------ */

function registerAdmin(router, app) {
  const { store, config, auth, log, weibo, weidian, translator, scheduler, getPrivate, limiters, version, passwordState, uploads, withLock, readLogs } = app;
  const db = () => store.db;
  const now = () => new Date().toISOString();

  const findProduct = (id) => {
    const p = db().products.find((x) => x.id === id);
    if (!p) throw new HttpError(404, 'Product not found');
    return p;
  };

  /* ------------------------------------------------------------- auth */

  router.post('/api/admin/login', async (ctx) => {
    const rl = await limiters.login.hit(ctx.ip);
    if (!rl.allowed) throw new HttpError(429, 'Too many login attempts — try again later', { retryAfter: rl.retryAfter });
    if (!passwordState.configured) throw new HttpError(503, 'ADMIN_PASSWORD is not configured on the server');
    const b = await ctx.body();
    if (!auth.checkPassword(isObj(b) ? b.password : '')) {
      log.warn(`failed admin login from ${ctx.ip}`);
      throw new HttpError(401, 'Invalid password');
    }
    await limiters.login.reset(ctx.ip);
    log.info(`admin login from ${ctx.ip}`);
    return auth.issue();
  });

  router.get('/api/admin/me', (ctx) => ({
    ok: true,
    user: 'admin',
    expiresAt: new Date(ctx.admin.exp).toISOString(),
    defaultPassword: passwordState.isDefault,
    version,
  }));

  /* -------------------------------------------------------- dashboard */

  router.get('/api/admin/dashboard', () => {
    const d = db();
    const settings = d.settings;
    const active = d.products.filter((p) => p.status !== 'archived');
    let variants = 0;
    let low = 0;
    let soldOut = 0;
    const lowStock = [];
    for (const p of active) {
      for (const v of p.variants) {
        variants++;
        const status = stockStatus(v, p, settings);
        if (status === 'low' || status === 'soldout' || status === 'restocking') {
          if (status === 'low') low++;
          else soldOut++;
          lowStock.push({ productId: p.id, name: p.name, slug: p.slug, sku: v.sku, color: v.color, size: v.size, stock: v.stock, status });
        }
      }
    }
    lowStock.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
    return {
      counts: {
        products: d.products.length,
        published: d.products.filter((p) => p.status === 'published').length,
        variants,
        lowStock: low,
        soldOut,
        updatesPending: d.updates.filter((u) => u.status === 'pending').length,
        messages: d.messages.length,
        messagesUnread: d.messages.filter((m) => !m.read).length,
        orders: d.orders.length,
        notify: d.notify.filter((n) => !n.notifiedAt).length,
      },
      lowStock: lowStock.slice(0, 30),
      recentOrders: d.orders.slice(-5).reverse(),
      recentMessages: d.messages.slice(-5).reverse(),
      sync: { weidian: d.meta.sync.weidian || null, weibo: d.meta.sync.weibo || null },
    };
  });

  /* --------------------------------------------------------- products */

  router.get('/api/admin/products', () => ({ products: [...db().products].sort(byOrder) }));

  router.post('/api/admin/products', async (ctx) => {
    const body = await ctx.body();
    const d = db();
    const { id, seq } = nextProductId(d.products, d.meta.productSeq);
    const product = normalizeProduct(body, { products: d.products, nextId: id, now: now() });
    d.meta.productSeq = seq;
    d.products.push(product);
    store.save();
    log.info(`product created: ${product.id} ${product.name}`);
    ctx.status = 201;
    return { product };
  });

  router.get('/api/admin/products/:id', (ctx) => ({ product: findProduct(ctx.params.id) }));

  router.put('/api/admin/products/:id', async (ctx) => {
    const existing = findProduct(ctx.params.id);
    const body = await ctx.body();
    const at = now();
    const product = normalizeProduct(body, { existing, products: db().products, now: at });
    // Stock changes made through a full edit are logged like PATCH /stock.
    const events = [];
    for (const v of product.variants) {
      const old = existing.variants.find((x) => x.sku === v.sku);
      if (old && Number(old.stock) !== v.stock) events.push({ at, productId: product.id, sku: v.sku, from: Number(old.stock) || 0, to: v.stock, source: 'admin' });
    }
    const list = db().products;
    list[list.indexOf(existing)] = product;
    store.addInventoryEvents(events);
    store.save();
    return { product };
  });

  router.delete('/api/admin/products/:id', (ctx) => {
    const p = findProduct(ctx.params.id);
    const list = db().products;
    list.splice(list.indexOf(p), 1);
    store.save();
    log.info(`product deleted: ${p.id} ${p.name}`);
    return { ok: true };
  });

  router.post('/api/admin/products/:id/duplicate', (ctx) => {
    const src = findProduct(ctx.params.id);
    const d = db();
    const { id, seq } = nextProductId(d.products, d.meta.productSeq);
    const copy = clone(src);
    copy.name = `${src.name} (copy)`;
    copy.slug = uniqueSlug(slugify(`${src.slug}-copy`), (s) => d.products.some((p) => p.slug === s));
    copy.status = 'draft';
    copy.featured = false;
    copy.variants = (copy.variants || []).map((v) => ({ ...v, sku: remapSku(v.sku, src.id, id), weidianSkuId: '' }));
    copy.weidian = { ...(copy.weidian || {}), itemId: '', url: '', syncEnabled: false, lastSyncedAt: null };
    delete copy.createdAt;
    const product = normalizeProduct(copy, { products: d.products, nextId: id, now: now() });
    d.meta.productSeq = seq;
    d.products.push(product);
    store.save();
    ctx.status = 201;
    return { product };
  });

  /**
   * Spreadsheet import: create/update many products at once.
   * Body: { items: [{ id?, input, row? }], remove?: [productId] }
   * Every item is validated first (all-or-nothing), then a backup snapshot is
   * taken and the whole batch is written in one save.
   */
  router.post(
    '/api/admin/products/bulk',
    async (ctx) => {
      const b = await ctx.body();
      const items = isObj(b) && Array.isArray(b.items) ? b.items : null;
      if (!items) throw new HttpError(400, 'Expected { items: [{ id?, input }], remove?: [ids] }');
      if (items.length > 2000) throw new HttpError(400, 'Too many products in one import (max 2000)');
      const remove = new Set((Array.isArray(b.remove) ? b.remove : []).map((x) => String(x)));
      const d = db();
      const at = now();
      const list = d.products.slice();
      let seq = d.meta.productSeq;
      const created = [];
      const updated = [];
      const events = [];
      items.forEach((it, i) => {
        const where = isObj(it) && it.row ? `Row ${it.row}` : `Item ${i + 1}`;
        if (!isObj(it) || !isObj(it.input)) throw new HttpError(400, `${where}: input must be an object`);
        try {
          if (it.id) {
            const idx = list.findIndex((p) => p.id === it.id);
            if (idx < 0) throw new HttpError(404, `product ${it.id} not found`);
            const existing = list[idx];
            const product = normalizeProduct(it.input, { existing, products: list, now: at });
            for (const v of product.variants) {
              const old = (existing.variants || []).find((x) => x.sku === v.sku);
              if (old && Number(old.stock) !== v.stock) events.push({ at, productId: product.id, sku: v.sku, from: Number(old.stock) || 0, to: v.stock, source: 'import' });
            }
            list[idx] = product;
            updated.push(product.id);
          } else {
            const next = nextProductId(list, seq);
            seq = next.seq;
            const product = normalizeProduct(it.input, { products: list, nextId: next.id, now: at });
            list.push(product);
            created.push(product.id);
          }
        } catch (e) {
          throw new HttpError(e.status && e.status < 500 ? e.status : 400, `${where}: ${e.message}`);
        }
      });
      const kept = list.filter((p) => !remove.has(p.id));
      const removed = list.length - kept.length;
      const backup = store.snapshot('pre-import');
      d.products.splice(0, d.products.length, ...kept);
      d.meta.productSeq = seq;
      store.addInventoryEvents(events);
      store.save();
      log.info(`spreadsheet import: ${created.length} created, ${updated.length} updated, ${removed} removed; snapshot ${backup}`);
      return { ok: true, created, updated, removed, backup };
    },
    { bodyLimit: 30 * 1024 * 1024 }
  );

  router.patch('/api/admin/products/:id/stock', async (ctx) => {
    const p = findProduct(ctx.params.id);
    const body = await ctx.body();
    const list = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.variants) ? body.variants : null;
    if (!list) throw new HttpError(400, 'Expected { variants: [{ sku, stock, preorder? }] }');
    // Validate everything first so the patch is all-or-nothing.
    const plan = [];
    const unmatched = [];
    for (const item of list) {
      if (!isObj(item)) throw new HttpError(400, 'Each variant must be an object');
      const v = p.variants.find((x) => x.sku === item.sku);
      if (!v) {
        unmatched.push(String(item.sku ?? ''));
        continue;
      }
      let stock;
      if (item.stock !== undefined) {
        const n = toNumber(item.stock, null);
        if (n === null || n < 0) throw new HttpError(400, `Invalid stock for ${v.sku}`);
        stock = Math.min(999999, Math.trunc(n));
      }
      plan.push({ v, stock, preorder: item.preorder === undefined ? undefined : toBool(item.preorder) });
    }
    const at = now();
    const events = [];
    for (const { v, stock, preorder } of plan) {
      if (stock !== undefined && stock !== Number(v.stock)) {
        events.push({ at, productId: p.id, sku: v.sku, from: Number(v.stock) || 0, to: stock, source: 'admin' });
        v.stock = stock;
      }
      if (preorder !== undefined) v.preorder = preorder;
    }
    p.updatedAt = at;
    store.addInventoryEvents(events);
    store.save();
    return { product: p, changes: events, unmatched };
  });

  /* ------------------------------------------------ categories/settings */

  router.get('/api/admin/categories', () => ({ categories: [...db().categories].sort(byOrder) }));

  router.put('/api/admin/categories', async (ctx) => {
    const body = await ctx.body();
    const list = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.categories) ? body.categories : null;
    if (!list) throw new HttpError(400, 'Expected an array of categories');
    const seen = new Set();
    const out = list.map((c, i) => {
      if (!isObj(c)) throw new HttpError(400, `categories[${i}] must be an object`);
      const name = str(c.name, 80).trim();
      if (!name) throw new HttpError(400, `categories[${i}]: name is required`);
      const id = slugify(c.id || name);
      if (!id) throw new HttpError(400, `categories[${i}]: could not derive an id`);
      if (seen.has(id)) throw new HttpError(400, `duplicate category id "${id}"`);
      seen.add(id);
      return { ...c, id, name, description: str(c.description, 2000), order: toNumber(c.order, i + 1) };
    });
    db().categories = out;
    store.save();
    return { categories: [...out].sort(byOrder) };
  });

  router.get('/api/admin/settings', () => ({ settings: db().settings }));

  router.put('/api/admin/settings', async (ctx) => {
    const body = await ctx.body();
    const s = isObj(body) && isObj(body.settings) && Object.keys(body).length === 1 ? body.settings : body;
    if (!isObj(s)) throw new HttpError(400, 'Expected a settings object');
    const next = withDefaults(clone(s), DEFAULT_SETTINGS);
    if (isObj(next.currency) && isObj(next.currency.rates)) {
      for (const [k, v] of Object.entries(next.currency.rates)) {
        const n = toNumber(v, null);
        if (n === null || n <= 0) throw new HttpError(400, `currency.rates.${k} must be a positive number`);
        next.currency.rates[k] = n;
      }
    }
    const wasAuto = !!db().settings.currency?.autoUpdate;
    db().settings = next;
    store.save();
    if (!wasAuto && next.currency?.autoUpdate) scheduler.reschedule('currency');
    return { settings: next };
  });

  /* ----------------------------------------------------- integrations */

  function integrationsPayload() {
    const d = db();
    const envOverrides = ENV_OVERRIDES.filter(([section, key]) => config.envOverrides[section]?.[key] !== undefined).map(
      ([section, key, name]) => ({ path: `${section}.${key}`, env: name })
    );
    return {
      ...maskedPrivate(getPrivate()),
      _meta: {
        envOverrides,
        providers: { translation: TRANSLATION_PROVIDERS, weidian: WEIDIAN_PROVIDERS },
        sync: { weibo: d.meta.sync.weibo || null, weidian: d.meta.sync.weidian || null, currency: d.meta.sync.currency || null },
        running: { weibo: weibo.busy, weidian: weidian.busy },
        scheduler: scheduler.status(),
      },
    };
  }

  router.get('/api/admin/integrations', () => integrationsPayload());

  router.put('/api/admin/integrations', async (ctx) => {
    const body = await ctx.body();
    if (!isObj(body)) throw new HttpError(400, 'Expected an object');
    const next = clone(store.private);
    applyIntegrations(next, body);
    store.private = next;
    store.savePrivate();
    scheduler.reschedule('weibo', 5000);
    scheduler.reschedule('weidian', 5000);
    log.info('integration settings updated');
    return integrationsPayload();
  });

  /* ---------------------------------------------------------- uploads */

  router.post(
    '/api/admin/upload',
    async (ctx) => {
      const b = await ctx.body();
      if (!isObj(b)) throw new HttpError(400, 'Expected { filename, data }');
      const result = await uploads.save(b);
      log.info(`upload saved: ${result.name} (${Math.round(result.size / 1024)} KB)`);
      ctx.status = 201;
      return result;
    },
    { bodyLimit: 12 * 1024 * 1024 }
  );

  router.get('/api/admin/uploads', async () => ({ uploads: await uploads.list() }));

  router.delete('/api/admin/uploads/:name', async (ctx) => {
    await uploads.remove(ctx.params.name);
    log.info(`upload deleted: ${ctx.params.name}`);
    return { ok: true };
  });

  /* ---------------------------------------------------------- updates */

  router.get('/api/admin/updates', () => ({ updates: store.sortedUpdates(db().updates) }));

  router.post('/api/admin/updates', async (ctx) => {
    const b = await ctx.body();
    if (!isObj(b)) throw new HttpError(400, 'Expected an object');
    const at = now();
    const update = {
      id: randomId('su', 4),
      source: 'studio',
      sourceId: null,
      url: '',
      title: '',
      category: 'studio',
      textOriginal: '',
      textEnglish: '',
      media: [],
      video: null,
      publishedAt: at,
      fetchedAt: null,
      status: 'published',
      pinned: false,
      translation: { provider: 'none', model: null, edited: true },
      relatedProducts: [],
    };
    applyUpdateFields(update, b, db().products);
    if (!update.title && !update.textEnglish) throw new HttpError(400, 'title or textEnglish is required');
    update.createdAt = at;
    update.updatedAt = at;
    db().updates.push(update);
    store.save();
    ctx.status = 201;
    return { update };
  });

  router.put('/api/admin/updates/:id', async (ctx) => {
    const update = db().updates.find((u) => u.id === ctx.params.id);
    if (!update) throw new HttpError(404, 'Update not found');
    const b = await ctx.body();
    if (!isObj(b)) throw new HttpError(400, 'Expected an object');
    const before = { title: update.title, textEnglish: update.textEnglish };
    applyUpdateFields(update, b, db().products);
    if (update.title !== before.title || update.textEnglish !== before.textEnglish) {
      update.translation = { ...(update.translation || {}), edited: true };
      if (update.translation.error) delete update.translation.error;
    }
    update.updatedAt = now();
    store.save();
    return { update };
  });

  router.delete('/api/admin/updates/:id', (ctx) => {
    const d = db();
    const i = d.updates.findIndex((u) => u.id === ctx.params.id);
    if (i < 0) throw new HttpError(404, 'Update not found');
    const [removed] = d.updates.splice(i, 1);
    if (removed.source === 'weibo' && removed.sourceId) {
      // Tombstone so the next fetch does not re-import it (a forced fetch still can).
      d.meta.weiboDeleted = [...(d.meta.weiboDeleted || []).filter((x) => x !== removed.sourceId), removed.sourceId].slice(-1000);
    }
    store.save();
    return { ok: true };
  });

  /* ------------------------------------------------ weibo / translate */

  router.post('/api/admin/weibo/fetch', async (ctx) => {
    const b = await ctx.body();
    try {
      return await withLock('weibo', () => weibo.run({ force: isObj(b) ? b.force : 0, trigger: 'admin' }));
    } catch (err) {
      if (err.status === 409) throw new HttpError(409, err.message);
      throw err;
    }
  });

  router.post('/api/admin/weibo/retranslate/:id', async (ctx) => {
    const update = await weibo.retranslate(ctx.params.id);
    if (!update) throw new HttpError(404, 'Update not found');
    return { update };
  });

  router.post('/api/admin/translate/test', async (ctx) => {
    const b = await ctx.body();
    const text = str(isObj(b) ? b.text : '', 20000).trim();
    if (!text) throw new HttpError(400, 'text is required');
    const r = await translator.translatePost(text, { products: db().products.filter((p) => p.status !== 'archived') });
    return {
      provider: r.provider,
      translation: r.translation,
      title: r.title,
      category: r.category,
      relatedProductIds: r.relatedProductIds,
      model: r.model,
      ok: r.ok,
      ...(r.error ? { error: r.error } : {}),
    };
  });

  /* ---------------------------------------------------------- weidian */

  router.post('/api/admin/weidian/sync', async (ctx) => {
    const b = await ctx.body();
    try {
      const opts = { dryRun: isObj(b) && toBool(b.dryRun), productId: (isObj(b) && b.productId) || null, trigger: 'admin' };
      return await (opts.dryRun ? weidian.sync(opts) : withLock('weidian', () => weidian.sync(opts)));
    } catch (err) {
      if (err.status === 409) throw new HttpError(409, err.message);
      throw err;
    }
  });

  router.post('/api/admin/weidian/test', async (ctx) => {
    const b = await ctx.body();
    const itemId = str(isObj(b) ? b.itemId : '', 60).trim();
    if (!itemId) throw new HttpError(400, 'itemId is required');
    try {
      return await weidian.test(itemId);
    } catch (err) {
      throw new HttpError(502, err.message);
    }
  });

  /**
   * Import from Weidian: item links/ids → draft products (nothing is saved here;
   * the admin shows a preview and creates them via /api/admin/products/bulk).
   * Body: { items: "links or ids" | [..], translate?: bool } — at most 10 per call.
   */
  router.post('/api/admin/weidian/import', async (ctx) => {
    const b = await ctx.body();
    const ids = extractItemIds(isObj(b) ? (b.items ?? b.text ?? b.itemIds ?? '') : b);
    if (!ids.length) throw new HttpError(400, 'No Weidian item links or item IDs found');
    if (ids.length > 10) throw new HttpError(400, 'Send at most 10 items per request');
    const cfg = getPrivate().weidian || {};
    if (cfg.provider === 'json-feed' || cfg.provider === 'mock') {
      throw new HttpError(400, 'Importing needs the Weidian provider “Public item page” or “Open API” (Integrations → Weidian).');
    }
    const d = db();
    return importItems({ ids, weidian, translator, cfg, products: d.products, categories: d.categories, translate: !(isObj(b) && b.translate === false) });
  });

  /* ---------------------------------------------------- submissions */

  const COLLECTIONS = {
    messages: { patch: (m, b) => ['read', 'archived'].forEach((k) => b[k] !== undefined && (m[k] = toBool(b[k]))) },
    orders: {
      patch: (o, b) => {
        if (b.status !== undefined) o.status = str(b.status, 30);
        if (b.adminNote !== undefined) o.adminNote = str(b.adminNote, 2000);
      },
    },
    notify: { patch: (n, b) => b.notified !== undefined && (n.notifiedAt = toBool(b.notified) ? now() : null) },
  };
  for (const [name, { patch }] of Object.entries(COLLECTIONS)) {
    router.get(`/api/admin/${name}`, () => ({ [name]: [...db()[name]].reverse() }));
    router.patch(`/api/admin/${name}/:id`, async (ctx) => {
      const item = db()[name].find((x) => x.id === ctx.params.id);
      if (!item) throw new HttpError(404, 'Not found');
      const b = await ctx.body();
      if (!isObj(b)) throw new HttpError(400, 'Expected an object');
      patch(item, b);
      store.save();
      return { item };
    });
    router.delete(`/api/admin/${name}/:id`, (ctx) => {
      const list = db()[name];
      const i = list.findIndex((x) => x.id === ctx.params.id);
      if (i < 0) throw new HttpError(404, 'Not found');
      list.splice(i, 1);
      store.save();
      return { ok: true };
    });
  }

  router.get('/api/admin/logs', async () => ({ logs: await readLogs() }));

  /* ------------------------------------------------------- demo content */

  function demoCounts() {
    const d = db();
    return {
      demoMode: !!d.settings.demo,
      products: d.products.filter((p) => p.demo).length,
      updates: d.updates.filter((u) => u.demo).length,
      inventoryEvents: d.inventoryEvents.filter((e) => e.demo).length,
    };
  }

  router.get('/api/admin/demo', () => demoCounts());

  /** Remove everything flagged demo:true (products, updates, stock history) and turn off demo mode. */
  router.post('/api/admin/demo/clear', async (ctx) => {
    const b = (await ctx.body()) || {};
    const parts = Array.isArray(b.parts) && b.parts.length ? b.parts : ['products', 'updates', 'inventoryEvents', 'flag'];
    const before = demoCounts();
    const backup = store.snapshot('pre-demo-clear');
    const d = db();
    const removed = {};
    if (parts.includes('products')) {
      const gone = new Set(d.products.filter((p) => p.demo).map((p) => p.id));
      d.products = d.products.filter((p) => !p.demo);
      d.updates.forEach((u) => {
        if (Array.isArray(u.relatedProducts)) u.relatedProducts = u.relatedProducts.filter((id) => !gone.has(id));
      });
      d.notify = d.notify.filter((n) => !gone.has(n.productId));
      removed.products = before.products;
    }
    if (parts.includes('updates')) {
      d.updates = d.updates.filter((u) => !u.demo);
      removed.updates = before.updates;
    }
    if (parts.includes('inventoryEvents') || parts.includes('products')) {
      d.inventoryEvents = d.inventoryEvents.filter((e) => !e.demo);
      removed.inventoryEvents = before.inventoryEvents;
    }
    if (parts.includes('flag')) d.settings.demo = false;
    store.save();
    log.info(`demo content removed (${Object.entries(removed).map(([k, n]) => `${n} ${k}`).join(', ') || 'demo flag only'}); snapshot ${backup}`);
    return { ok: true, removed, backup, ...demoCounts() };
  });

  /* ---------------------------------------------------- backup/restore */

  const BACKUP_KEYS = ['settings', 'categories', 'products', 'updates', 'inventoryEvents', 'messages', 'orders', 'notify'];

  router.get('/api/admin/export', (ctx) => {
    const d = db();
    const data = { format: 'cola-studio-backup', version: 1, appVersion: version, exportedAt: now() };
    for (const k of BACKUP_KEYS) data[k] = d[k];
    const day = new Date().toISOString().slice(0, 10);
    sendJson(ctx.req, ctx.res, 200, data, { headers: { 'Content-Disposition': `attachment; filename="cola-studio-backup-${day}.json"` } });
  });

  router.post(
    '/api/admin/import',
    async (ctx) => {
      const b = await ctx.body();
      const src = isObj(b) && isObj(b.data) && !b.products && !b.settings ? b.data : b;
      if (!isObj(src)) throw new HttpError(400, 'Expected a backup object');
      const present = BACKUP_KEYS.filter((k) => src[k] !== undefined);
      if (!present.length) throw new HttpError(400, 'Nothing to import (no known collections found)');
      for (const k of present) {
        if (k === 'settings' ? !isObj(src[k]) : !Array.isArray(src[k])) throw new HttpError(400, `${k} has the wrong type`);
      }
      const backup = store.snapshot('pre-import');
      const d = db();
      const merged = { ...d };
      for (const k of present) merged[k] = src[k];
      const next = normalizeDb(merged);
      next.meta = d.meta;
      next.meta.productSeq = Math.max(Number(d.meta.productSeq) || 0, nextProductId(next.products).seq - 1);
      next.meta.importedAt = now();
      store.data = next;
      store.save();
      log.info(`backup imported (${present.join(', ')}); previous state saved as ${backup}`);
      return { ok: true, imported: Object.fromEntries(present.map((k) => [k, Array.isArray(src[k]) ? src[k].length : 1])), backup };
    },
    { bodyLimit: 60 * 1024 * 1024 }
  );
}

module.exports = { registerAdmin, maskValue, maskedPrivate, applyIntegrations, SCHEMA };
