/* ==========================================================================
   Cola Studio — Admin data access
   One interface, two backends:
     • server mode  → /api/admin/* (Bearer token in localStorage)
     • static mode  → public/data/*.json + localStorage overlay "cola.overlay.v1"
   Views only ever talk to ColaAdmin.data and never care which mode is active.
   All getters return fresh copies, so callers may mutate them freely.
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const TOKEN_KEY = 'cola.admin.token';
  const OVERLAY_KEY = 'cola.overlay.v1';
  const SEQ_KEY = 'cola.admin.seq';
  const MODE_KEY = 'cola.admin.mode'; // optional override ("server") for setups that proxy the API

  const D = (A.data = {
    mode: null,
    caps: {},
    TOKEN_KEY,
    OVERLAY_KEY,
  });

  const now = () => new Date().toISOString();
  const err = (message, status, extra) => Object.assign(new Error(message), { status: status || 0 }, extra || {});

  /* ================================================================ detect */

  async function fetchTimeout(url, ms) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), ms);
    try {
      return await fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Server mode when the server injected <meta name="cola-runtime" content="server">.
   * Without that tag the page was not served by server.js, so we only probe
   * /api/health when explicitly asked (?mode=server or localStorage override) —
   * this keeps pure static hosting free of 404 noise.
   */
  D.detect = async function () {
    const meta = document.querySelector('meta[name="cola-runtime"]');
    if (meta && meta.getAttribute('content') === 'server') return (D.mode = 'server');
    const q = new URLSearchParams(location.search).get('mode');
    const wantProbe = q === 'server' || A.store.getRaw(MODE_KEY) === 'server';
    if (wantProbe && q !== 'static') {
      try {
        const r = await fetchTimeout('/api/health', 2500);
        if (r.ok) {
          const j = await r.json();
          if (j && j.ok) return (D.mode = 'server');
        }
      } catch (e) {
        /* static */
      }
    }
    return (D.mode = 'static');
  };

  D.init = async function () {
    if (!D.mode) await D.detect();
    const server = D.mode === 'server';
    D.caps = {
      auth: server,
      integrations: server,
      inbox: server,
      uploadsLibrary: server,
      weibo: server,
      weidian: server,
      logs: server,
      translate: server,
    };
    if (!server) await loadSeed();
    return D.mode;
  };

  /* ============================================================ server api */

  D.token = () => A.store.getRaw(TOKEN_KEY) || '';
  D.setToken = (t) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      /* private mode: the session lasts for this tab only */
      D._memToken = t;
    }
  };

  async function api(method, path, body, opts) {
    const o = opts || {};
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const t = D.token() || D._memToken;
    if (t) headers.Authorization = 'Bearer ' + t;
    let res;
    try {
      res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' });
    } catch (e) {
      throw err('Could not reach the server. Check that it is running and try again.', 0);
    }
    if (res.status === 401 && !o.noAuthRedirect) {
      D.setToken('');
      if (A.app && A.app.onUnauthorized) A.app.onUnauthorized();
      throw err('Your session has expired. Log in again.', 401, { silent: true });
    }
    if (o.raw) {
      if (!res.ok) {
        let m = 'Request failed (' + res.status + ')';
        try {
          m = (await res.json()).error || m;
        } catch (e) {
          /* ignore */
        }
        throw err(m, res.status);
      }
      return res;
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }
    if (!res.ok) {
      const message = (data && data.error) || 'Request failed (' + res.status + ')';
      throw err(message, res.status, { data, retryAfter: res.headers.get('Retry-After') });
    }
    return data;
  }
  D.api = api;

  D.login = async function (password) {
    const r = await api('POST', '/api/admin/login', { password }, { noAuthRedirect: true });
    D.setToken(r.token);
    return r;
  };
  D.logout = function () {
    D.setToken('');
    D._memToken = '';
  };
  D.me = () => api('GET', '/api/admin/me', undefined, { noAuthRedirect: true });

  /* ============================================================ static mode */

  const seed = {};
  const SEED_FILES = { settings: 'settings.json', categories: 'categories.json', products: 'products.json', updates: 'updates.json', inventoryEvents: 'inventory-events.json' };

  function unwrap(v, key) {
    if (Array.isArray(v)) return v;
    if (A.isObj(v)) {
      if (Array.isArray(v[key])) return v[key];
      if (Array.isArray(v.items)) return v.items;
      if (key === 'inventoryEvents' && Array.isArray(v.events)) return v.events;
    }
    return [];
  }

  async function loadSeed() {
    const entries = Object.entries(SEED_FILES);
    const results = await Promise.all(
      entries.map(async ([key, file]) => {
        try {
          const r = await fetch(new URL('../data/' + file, location.href).href, { cache: 'no-cache' });
          if (!r.ok) throw new Error(r.status);
          return [key, await r.json()];
        } catch (e) {
          return [key, null];
        }
      })
    );
    let found = 0;
    for (const [key, v] of results) {
      if (v != null) found++;
      seed[key] = key === 'settings' ? (A.isObj(v) ? (A.isObj(v.settings) ? v.settings : v) : {}) : unwrap(v, key);
    }
    D.seedLoaded = found > 0;
    if (!found) throw err('Could not load the catalogue from ../data/*.json. Open the admin through a web server (not file://).', 0);
  }

  function overlay() {
    const o = A.store.get(OVERLAY_KEY, null);
    return A.isObj(o) ? o : {};
  }
  function writeOverlay(patch) {
    const o = Object.assign(overlay(), patch, { updatedAt: now() });
    try {
      localStorage.setItem(OVERLAY_KEY, JSON.stringify(o));
    } catch (e) {
      const quota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
      throw err(
        quota
          ? 'Browser storage is full. Remove some uploaded images or export your data, then try again.'
          : 'Could not save to browser storage (' + (e && e.message) + ').',
        507
      );
    }
    return o;
  }
  function col(key) {
    const o = overlay();
    const v = o[key] !== undefined ? o[key] : seed[key];
    return A.clone(v === undefined ? (key === 'settings' ? {} : []) : v);
  }
  D.overlayInfo = function () {
    const raw = A.store.getRaw(OVERLAY_KEY);
    const o = overlay();
    return {
      present: !!raw,
      bytes: raw ? raw.length : 0, // localStorage quotas count UTF-16 code units (~5M per origin)
      chars: raw ? raw.length : 0,
      keys: Object.keys(o).filter((k) => k !== 'updatedAt'),
      updatedAt: o.updatedAt || null,
    };
  };

  function nextProductId(products) {
    let max = Number(A.store.get(SEQ_KEY, 0)) || 0;
    for (const p of products) {
      const m = /^cs-(\d+)$/i.exec(p.id || '');
      if (m) max = Math.max(max, Number(m[1]));
    }
    return { id: 'cs-' + String(max + 1).padStart(3, '0'), seq: max + 1 };
  }
  D.predictNextId = async function () {
    const products = await D.getProducts();
    return nextProductId(products).id;
  };

  function uniqueSlug(base, taken) {
    const root = base || 'item';
    if (!taken(root)) return root;
    for (let i = 2; i < 10000; i++) if (!taken(root + '-' + i)) return root + '-' + i;
    return root + '-' + Date.now().toString(36);
  }

  /** Mirrors server/lib/products.js normalizeProduct closely enough for demo mode. */
  function normalizeLocal(input, ctx) {
    const existing = ctx.existing || null;
    const products = ctx.products || [];
    const merged = A.stripPrivate(Object.assign({}, existing || {}, input));
    const id = existing ? existing.id : ctx.nextId;
    const name = String(merged.name || '').trim();
    if (!name) throw err('Name is required.', 400);
    const others = products.filter((p) => p.id !== id);
    const slug = uniqueSlug(A.slugify(merged.slug || name) || A.slugify(id), (s) => others.some((p) => p.slug === s));
    const skus = new Set();
    const variants = (merged.variants || []).map((v) => {
      let sku = String(v.sku || '').trim() || A.genSku(id, A.colorCode(v.color), v.size);
      let u = sku;
      for (let i = 2; skus.has(u.toUpperCase()); i++) u = sku + '-' + i;
      skus.add(u.toUpperCase());
      return Object.assign({}, v, { sku: u, color: String(v.color || ''), size: String(v.size || ''), stock: Math.max(0, Math.trunc(Number(v.stock) || 0)), preorder: !!v.preorder, weidianSkuId: String(v.weidianSkuId || '') });
    });
    const maxOrder = products.reduce((m, p) => Math.max(m, Number(p.order) || 0), 0);
    const compareAt = Number(merged.compareAt);
    const t = now();
    const product = Object.assign({}, merged, {
      id,
      slug,
      name,
      price: Math.max(0, Number(merged.price) || 0),
      compareAt: compareAt > 0 ? compareAt : null,
      status: A.PRODUCT_STATUSES.includes(merged.status) ? merged.status : 'draft',
      order: Number.isFinite(Number(merged.order)) && merged.order !== '' && merged.order !== null ? Number(merged.order) : maxOrder + 10,
      variants,
      colors: Array.isArray(merged.colors) ? merged.colors : [],
      sizes: Array.isArray(merged.sizes) ? merged.sizes : [],
      images: (merged.images || []).filter((i) => i && i.url),
      createdAt: (existing && existing.createdAt) || t,
      updatedAt: t,
    });
    return product;
  }

  function logEvents(events) {
    if (!events.length) return;
    const list = col('inventoryEvents');
    const next = events.concat(list).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 300);
    writeOverlay({ inventoryEvents: next });
  }

  function stockEvents(before, after, at) {
    const out = [];
    for (const v of after.variants || []) {
      const old = (before.variants || []).find((x) => x.sku === v.sku);
      if (old && Number(old.stock) !== Number(v.stock)) out.push({ at, productId: after.id, sku: v.sku, from: Number(old.stock) || 0, to: Number(v.stock) || 0, source: 'admin' });
    }
    return out;
  }

  const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name || a.id).localeCompare(String(b.name || b.id));

  /* ============================================================== products */

  D.getProducts = async function () {
    if (D.mode === 'server') return (await api('GET', '/api/admin/products')).products || [];
    return col('products').sort(byOrder);
  };

  D.getProduct = async function (id) {
    if (D.mode === 'server') return (await api('GET', '/api/admin/products/' + encodeURIComponent(id))).product;
    const p = col('products').find((x) => x.id === id);
    if (!p) throw err('Product not found', 404);
    return p;
  };

  D.createProduct = async function (input) {
    if (D.mode === 'server') return (await api('POST', '/api/admin/products', A.stripPrivate(input))).product;
    const products = col('products');
    const { id, seq } = nextProductId(products);
    const product = normalizeLocal(input, { products, nextId: id });
    products.push(product);
    writeOverlay({ products });
    try {
      A.store.set(SEQ_KEY, seq);
    } catch (e) {
      /* ignore */
    }
    return A.clone(product);
  };

  D.saveProduct = async function (id, input) {
    if (D.mode === 'server') return (await api('PUT', '/api/admin/products/' + encodeURIComponent(id), A.stripPrivate(input))).product;
    const products = col('products');
    const i = products.findIndex((x) => x.id === id);
    if (i < 0) throw err('Product not found', 404);
    const existing = products[i];
    const product = normalizeLocal(input, { existing, products });
    products[i] = product;
    writeOverlay({ products });
    logEvents(stockEvents(existing, product, product.updatedAt));
    return A.clone(product);
  };

  D.deleteProduct = async function (id) {
    if (D.mode === 'server') return api('DELETE', '/api/admin/products/' + encodeURIComponent(id));
    const products = col('products').filter((x) => x.id !== id);
    writeOverlay({ products });
    return { ok: true };
  };

  D.duplicateProduct = async function (id) {
    if (D.mode === 'server') return (await api('POST', '/api/admin/products/' + encodeURIComponent(id) + '/duplicate')).product;
    const products = col('products');
    const src = products.find((x) => x.id === id);
    if (!src) throw err('Product not found', 404);
    const { id: newId, seq } = nextProductId(products);
    const from = A.idCode(src.id);
    const to = A.idCode(newId);
    const copy = A.clone(src);
    copy.name = src.name + ' (copy)';
    copy.slug = uniqueSlug(A.slugify(src.slug + '-copy'), (s) => products.some((p) => p.slug === s));
    copy.status = 'draft';
    copy.featured = false;
    copy.variants = (copy.variants || []).map((v) =>
      Object.assign({}, v, { sku: String(v.sku).toUpperCase().startsWith(from) ? to + String(v.sku).slice(from.length) : v.sku + '-' + to, weidianSkuId: '' })
    );
    copy.weidian = Object.assign({}, copy.weidian || {}, { itemId: '', url: '', syncEnabled: false, lastSyncedAt: null });
    delete copy.createdAt;
    const product = normalizeLocal(copy, { products, nextId: newId });
    products.push(product);
    writeOverlay({ products });
    try {
      A.store.set(SEQ_KEY, seq);
    } catch (e) {
      /* ignore */
    }
    return A.clone(product);
  };

  /**
   * Spreadsheet import. items = [{ id?, input, row? }] (no id → new product),
   * remove = product ids to delete. Server: one validated batch + backup snapshot.
   */
  D.bulkProducts = async function (items, remove) {
    if (D.mode === 'server') return api('POST', '/api/admin/products/bulk', { items: items.map((i) => ({ id: i.id || undefined, row: i.row, input: A.stripPrivate(i.input) })), remove: remove || [] });
    const products = col('products');
    let seqInfo = null;
    const created = [];
    const updated = [];
    const events = [];
    items.forEach((it, i) => {
      const where = it.row ? 'Row ' + it.row : 'Item ' + (i + 1);
      try {
        if (it.id) {
          const idx = products.findIndex((p) => p.id === it.id);
          if (idx < 0) throw err('product ' + it.id + ' not found', 404);
          const existing = products[idx];
          const product = normalizeLocal(it.input, { existing, products });
          products[idx] = product;
          updated.push(product.id);
          events.push(...stockEvents(existing, product, product.updatedAt).map((e) => Object.assign(e, { source: 'import' })));
        } else {
          seqInfo = nextProductId(products);
          const product = normalizeLocal(it.input, { products, nextId: seqInfo.id });
          products.push(product);
          created.push(product.id);
          try {
            A.store.set(SEQ_KEY, seqInfo.seq);
          } catch (e) {
            /* ignore */
          }
        }
      } catch (e) {
        throw err(where + ': ' + e.message, e.status || 400);
      }
    });
    const drop = new Set(remove || []);
    const kept = products.filter((p) => !drop.has(p.id));
    writeOverlay({ products: kept }); // throws (and writes nothing) when browser storage is full
    logEvents(events);
    return { ok: true, created, updated, removed: products.length - kept.length };
  };

  /** PATCH stock for one product: variants = [{ sku, stock, preorder? }]. */
  D.patchStock = async function (id, variants) {
    if (D.mode === 'server') return api('PATCH', '/api/admin/products/' + encodeURIComponent(id) + '/stock', { variants });
    const products = col('products');
    const p = products.find((x) => x.id === id);
    if (!p) throw err('Product not found', 404);
    const at = now();
    const changes = [];
    const unmatched = [];
    for (const item of variants) {
      const v = p.variants.find((x) => x.sku === item.sku);
      if (!v) {
        unmatched.push(item.sku);
        continue;
      }
      if (item.stock !== undefined) {
        const n = Math.max(0, Math.trunc(Number(item.stock) || 0));
        if (n !== Number(v.stock)) {
          changes.push({ at, productId: p.id, sku: v.sku, from: Number(v.stock) || 0, to: n, source: 'admin' });
          v.stock = n;
        }
      }
      if (item.preorder !== undefined) v.preorder = !!item.preorder;
    }
    p.updatedAt = at;
    writeOverlay({ products });
    logEvents(changes);
    return { product: A.clone(p), changes, unmatched };
  };

  /* ============================================================ categories */

  D.getCategories = async function () {
    if (D.mode === 'server') return (await api('GET', '/api/admin/categories')).categories || [];
    return col('categories').sort(byOrder);
  };
  D.saveCategories = async function (list) {
    if (D.mode === 'server') return (await api('PUT', '/api/admin/categories', list)).categories;
    const seen = new Set();
    const out = list.map((c, i) => {
      const name = String(c.name || '').trim();
      if (!name) throw err('Every category needs a name.', 400);
      const id = A.slugify(c.id || name);
      if (seen.has(id)) throw err('Duplicate category id "' + id + '".', 400);
      seen.add(id);
      return Object.assign({}, c, { id, name, description: String(c.description || ''), order: Number.isFinite(Number(c.order)) ? Number(c.order) : i + 1 });
    });
    writeOverlay({ categories: out });
    return A.clone(out).sort(byOrder);
  };

  /* ============================================================== settings */

  D.getSettings = async function () {
    if (D.mode === 'server') return (await api('GET', '/api/admin/settings')).settings || {};
    return col('settings');
  };
  D.saveSettings = async function (s) {
    if (D.mode === 'server') return (await api('PUT', '/api/admin/settings', { settings: s })).settings;
    writeOverlay({ settings: A.clone(s) });
    return A.clone(s);
  };

  /* =============================================================== updates */

  const tsOf = (v) => {
    const t = Date.parse(v || '');
    return Number.isFinite(t) ? t : 0;
  };
  const sortUpdates = (list) => list.sort((a, b) => (!!b.pinned !== !!a.pinned ? (b.pinned ? 1 : -1) : tsOf(b.publishedAt) - tsOf(a.publishedAt)));

  D.getUpdates = async function () {
    if (D.mode === 'server') return (await api('GET', '/api/admin/updates')).updates || [];
    return sortUpdates(col('updates'));
  };
  D.createUpdate = async function (u) {
    if (D.mode === 'server') return (await api('POST', '/api/admin/updates', u)).update;
    if (!u.title && !u.textEnglish) throw err('Add a title or English text.', 400);
    const at = now();
    const update = Object.assign(
      {
        id: 'su-' + Date.now().toString(36) + Math.random().toString(16).slice(2, 6),
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
      },
      u,
      { createdAt: at, updatedAt: at }
    );
    const list = col('updates');
    list.push(update);
    writeOverlay({ updates: list });
    return A.clone(update);
  };
  D.saveUpdate = async function (id, u) {
    if (D.mode === 'server') return (await api('PUT', '/api/admin/updates/' + encodeURIComponent(id), u)).update;
    const list = col('updates');
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw err('Update not found', 404);
    const before = list[i];
    const next = Object.assign({}, before, u, { updatedAt: now() });
    if (next.title !== before.title || next.textEnglish !== before.textEnglish) next.translation = Object.assign({}, before.translation || {}, { edited: true });
    list[i] = next;
    writeOverlay({ updates: list });
    return A.clone(next);
  };
  /** Change the status of many updates at once: { ids? , fromStatus?, source?, status } */
  D.bulkUpdates = async function (body) {
    if (D.mode === 'server') return api('POST', '/api/admin/updates/bulk', body);
    const ids = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : null;
    let changed = 0;
    const list = col('updates').map((u) => {
      if ((ids && !ids.has(u.id)) || (body.fromStatus && u.status !== body.fromStatus) || (body.source && u.source !== body.source) || u.status === body.status) return u;
      changed++;
      return Object.assign({}, u, { status: body.status, updatedAt: now() });
    });
    if (changed) writeOverlay({ updates: list });
    return { ok: true, changed };
  };
  D.deleteUpdate = async function (id) {
    if (D.mode === 'server') return api('DELETE', '/api/admin/updates/' + encodeURIComponent(id));
    writeOverlay({ updates: col('updates').filter((x) => x.id !== id) });
    return { ok: true };
  };

  /* ===================================================== inventory events */

  D.getInventoryEvents = async function () {
    if (D.mode === 'server') {
      const r = await api('GET', '/api/inventory');
      return (r && r.events) || [];
    }
    return col('inventoryEvents')
      .sort((a, b) => tsOf(b.at) - tsOf(a.at))
      .slice(0, 60);
  };

  /* ============================================================= dashboard */

  D.getDashboard = async function () {
    if (D.mode === 'server') return api('GET', '/api/admin/dashboard');
    const [products, settings, updates] = await Promise.all([D.getProducts(), D.getSettings(), D.getUpdates()]);
    let variants = 0;
    let low = 0;
    let soldOut = 0;
    const lowStock = [];
    for (const p of products.filter((x) => x.status !== 'archived')) {
      for (const v of p.variants || []) {
        variants++;
        const s = A.stockStatus(v, p, settings);
        if (s === 'low' || s === 'soldout' || s === 'restocking') {
          if (s === 'low') low++;
          else soldOut++;
          lowStock.push({ productId: p.id, name: p.name, slug: p.slug, sku: v.sku, color: v.color, size: v.size, stock: v.stock, status: s });
        }
      }
    }
    lowStock.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
    return {
      counts: {
        products: products.length,
        published: products.filter((p) => p.status === 'published').length,
        variants,
        lowStock: low,
        soldOut,
        updatesPending: updates.filter((u) => u.status === 'pending').length,
        messages: 0,
        messagesUnread: 0,
        orders: 0,
        notify: 0,
      },
      lowStock: lowStock.slice(0, 30),
      recentOrders: [],
      recentMessages: [],
      sync: { weidian: null, weibo: null },
    };
  };

  /* =============================================================== uploads */

  /** Upload a File/Blob. Server → /uploads/… URL; static → (downscaled) data URL. */
  D.upload = async function (file, opts) {
    const o = opts || {};
    const raster = /^image\/(jpeg|png|webp|avif|bmp)$/i.test(file.type);
    if (D.mode === 'server') {
      let dataUrl;
      let name = file.name || 'image';
      // Keep uploads web-sized (and below the ~3 MB request limit on Vercel).
      const dims = raster ? await A.ui.imageSize(file).catch(() => null) : null;
      if (raster && (file.size > 2.2 * 1024 * 1024 || (dims && Math.max(dims.width, dims.height) > 2400))) {
        let r = await A.ui.downscaleImage(file, { max: 2400, quality: 0.86 });
        if (r.bytes > 2.8 * 1024 * 1024) r = await A.ui.downscaleImage(file, { max: 1800, quality: 0.8 });
        dataUrl = r.dataUrl;
        name = name.replace(/\.[a-z0-9]+$/i, '') + (r.type === 'image/webp' ? '.webp' : '.jpg');
      } else {
        dataUrl = await A.ui.readAsDataURL(file);
      }
      const r = await api('POST', '/api/admin/upload', { filename: name, data: dataUrl });
      return { url: r.url, bytes: r.size || file.size, name: r.name };
    }
    // Static: keep it small — localStorage is ~5 MB for the whole overlay.
    let dataUrl;
    let bytes = file.size;
    if (raster && (file.size > 350 * 1024 || o.forceResize)) {
      const r = await A.ui.downscaleImage(file, { max: 1600, quality: 0.84 });
      dataUrl = r.dataUrl;
      bytes = r.bytes;
    } else if (raster) {
      const dims = await A.ui.imageSize(file).catch(() => null);
      if (dims && Math.max(dims.width, dims.height) > 1600) {
        const r = await A.ui.downscaleImage(file, { max: 1600, quality: 0.84 });
        dataUrl = r.dataUrl;
        bytes = r.bytes;
      } else dataUrl = await A.ui.readAsDataURL(file);
    } else {
      dataUrl = await A.ui.readAsDataURL(file);
    }
    return { url: dataUrl, bytes, name: file.name, inline: true, large: bytes > 1.5 * 1024 * 1024 };
  };

  D.getUploads = async function () {
    return (await api('GET', '/api/admin/uploads')).uploads || [];
  };
  D.deleteUpload = (name) => api('DELETE', '/api/admin/uploads/' + encodeURIComponent(name));

  /* ========================================================= server-only */

  D.getSeoInfo = () => api('GET', '/api/admin/seo');
  D.getIntegrations = () => api('GET', '/api/admin/integrations');
  D.saveIntegrations = (body) => api('PUT', '/api/admin/integrations', body);
  D.weiboFetch = (force) => api('POST', '/api/admin/weibo/fetch', force ? { force } : {});
  D.weiboHistory = () => api('GET', '/api/admin/weibo/history');
  D.weiboHistoryStart = (opts) => api('POST', '/api/admin/weibo/history', opts || {});
  D.weiboHistoryStop = () => api('POST', '/api/admin/weibo/history/stop', {});
  D.retranslate = async (id) => (await api('POST', '/api/admin/weibo/retranslate/' + encodeURIComponent(id))).update;
  D.translateTest = (text) => api('POST', '/api/admin/translate/test', { text });
  D.weidianSync = (opts) => api('POST', '/api/admin/weidian/sync', opts || {});
  D.weidianTest = (itemId) => api('POST', '/api/admin/weidian/test', { itemId });
  D.weidianImport = (items, translate, opts) => api('POST', '/api/admin/weidian/import', Object.assign({ items, translate: translate !== false }, opts || {}));
  D.getCollection = async (name) => (await api('GET', '/api/admin/' + name))[name] || [];
  D.patchCollection = (name, id, body) => api('PATCH', '/api/admin/' + name + '/' + encodeURIComponent(id), body);
  D.deleteCollectionItem = (name, id) => api('DELETE', '/api/admin/' + name + '/' + encodeURIComponent(id));
  D.getLogs = async () => (await api('GET', '/api/admin/logs')).logs || [];
  D.getDemo = () => api('GET', '/api/admin/demo');
  D.clearDemo = (parts) => api('POST', '/api/admin/demo/clear', parts ? { parts } : {});

  /* ================================================================ backup */

  D.exportBackup = async function () {
    if (D.mode === 'server') {
      const res = await api('GET', '/api/admin/export', undefined, { raw: true });
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename="?([^";]+)"?/i.exec(cd);
      return { blob, filename: m ? m[1] : 'cola-studio-backup-' + now().slice(0, 10) + '.json' };
    }
    const data = { format: 'cola-studio-backup', version: 1, appVersion: A.version, exportedAt: now(), source: 'static-demo' };
    for (const k of ['settings', 'categories', 'products', 'updates', 'inventoryEvents']) data[k] = col(k);
    return { blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename: 'cola-studio-backup-' + now().slice(0, 10) + '.json' };
  };

  /** Export one collection as the JSON file that replaces public/data/<file>. */
  D.exportCollection = async function (key) {
    const data = key === 'settings' ? await D.getSettings() : key === 'products' ? await D.getProducts() : key === 'categories' ? await D.getCategories() : key === 'updates' ? await D.getUpdates() : col(key);
    const file = SEED_FILES[key] || key + '.json';
    return { blob: new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }), filename: file };
  };

  /**
   * Import JSON. Accepts a full backup ({ products, settings, … }) or a single
   * collection file (array of products / categories / updates, or a settings object).
   */
  D.detectImport = function (json, filename) {
    if (A.isObj(json) && ['settings', 'categories', 'products', 'updates', 'inventoryEvents'].some((k) => json[k] !== undefined)) {
      const keys = ['settings', 'categories', 'products', 'updates', 'inventoryEvents', 'messages', 'orders', 'notify'].filter((k) => json[k] !== undefined);
      return { kind: 'backup', keys, data: json };
    }
    const name = String(filename || '').toLowerCase();
    if (Array.isArray(json)) {
      const first = json.find(A.isObj) || {};
      let key = null;
      if (first.variants || first.garment || first.price !== undefined || name.includes('product')) key = 'products';
      else if (first.textEnglish !== undefined || first.textOriginal !== undefined || name.includes('update')) key = 'updates';
      else if (first.sku && first.from !== undefined) key = 'inventoryEvents';
      else if (first.id && first.name !== undefined) key = 'categories';
      if (key) return { kind: 'collection', keys: [key], data: { [key]: json } };
    }
    if (A.isObj(json) && (json.brand || json.currency || json.whatsapp || name.includes('settings'))) return { kind: 'collection', keys: ['settings'], data: { settings: json } };
    return null;
  };

  D.importData = async function (data) {
    if (D.mode === 'server') return api('POST', '/api/admin/import', data);
    const patch = {};
    for (const k of ['settings', 'categories', 'products', 'updates', 'inventoryEvents']) {
      if (data[k] === undefined) continue;
      if (k === 'settings' ? !A.isObj(data[k]) : !Array.isArray(data[k])) throw err(k + ' has the wrong type', 400);
      patch[k] = data[k];
    }
    if (!Object.keys(patch).length) throw err('Nothing to import (no known collections found).', 400);
    writeOverlay(patch);
    return { ok: true, imported: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])) };
  };

  D.resetDemo = function () {
    A.store.remove(OVERLAY_KEY);
    A.store.remove(SEQ_KEY);
  };
})();
