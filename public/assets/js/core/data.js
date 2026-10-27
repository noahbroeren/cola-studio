/* ==========================================================================
   COLA STUDIO — core/data.js
   One data layer for both runtimes:
   - server mode → /api/* (Node server, admin panel, Weidian & Weibo sync)
   - static mode → data/*.json (+ the admin's localStorage overlay "cola.overlay.v1")
   Also: derived stock status and currency formatting.
   ========================================================================== */
(function () {
  'use strict';
  var Cola = window.Cola;
  var cache = {};
  var OVERLAY_KEY = 'cola.overlay.v1';

  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }
  function overlay() { return Cola.store.get(OVERLAY_KEY, null) || {}; }
  function once(key, fn) { if (!cache[key]) cache[key] = fn().catch(function (e) { delete cache[key]; throw e; }); return cache[key]; }
  function staticFile(name) {
    var ov = overlay();
    var key = name === 'inventory-events' ? 'inventoryEvents' : name;
    if (ov[key] != null) return Promise.resolve(JSON.parse(JSON.stringify(ov[key])));
    return getJSON('data/' + name + '.json');
  }
  function byOrder(a, b) { return (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name)); }

  var data = (Cola.data = {
    mode: Cola.isServer ? 'server' : 'static',
    settings: null, categories: [],

    site: function () {
      return once('site', function () {
        var p = Cola.isServer
          ? getJSON('/api/site')
          : Promise.all([staticFile('settings'), staticFile('categories')]).then(function (r) { return { settings: r[0], categories: r[1] }; });
        return p.then(function (res) {
          data.settings = res.settings || {};
          data.categories = (res.categories || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
          return { settings: data.settings, categories: data.categories };
        });
      });
    },

    products: function () {
      return once('products', function () {
        var p = Cola.isServer ? getJSON('/api/products').then(function (r) { return r.products || []; }) : staticFile('products');
        return p.then(function (list) {
          return (list || []).filter(function (x) { return !x.status || x.status === 'published'; }).sort(byOrder);
        });
      });
    },

    product: function (slug) {
      if (Cola.isServer) {
        return getJSON('/api/products/' + encodeURIComponent(slug)).then(function (r) { return r; }, function () { return { product: null, related: [] }; });
      }
      return data.products().then(function (list) {
        var product = list.find(function (p) { return p.slug === slug || p.id === slug; }) || null;
        var related = product ? list.filter(function (p) { return p.id !== product.id && p.category === product.category; }).slice(0, 8) : [];
        return { product: product, related: related };
      });
    },

    inventory: function (fresh) {
      if (fresh) delete cache.inventory;
      return once('inventory', function () {
        if (Cola.isServer) return getJSON('/api/inventory'); // short CDN cache on the server side
        return Promise.all([data.products(), staticFile('inventory-events').catch(function () { return []; })]).then(function (r) {
          var products = r[0], events = r[1] || [];
          var map = {}; products.forEach(function (p) { map[p.id] = p; });
          var enriched = events.map(function (e) {
            var p = map[e.productId]; if (!p) return null;
            var v = (p.variants || []).find(function (x) { return x.sku === e.sku; }) || {};
            return Object.assign({}, e, { name: p.name, slug: p.slug, color: v.color, size: v.size });
          }).filter(Boolean).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); }).slice(0, 40);
          var last = products.reduce(function (m, p) { var t = (p.weidian && p.weidian.lastSyncedAt) || p.updatedAt; return t && t > m ? t : m; }, '');
          return { updatedAt: new Date().toISOString(), sync: { at: last || null, status: 'demo', source: 'static', message: 'Demo data — connect the server to sync with Weidian' }, products: products, events: enriched };
        });
      });
    },

    updates: function (opts) {
      opts = opts || {};
      if (Cola.isServer) {
        return getJSON('/api/updates' + Cola.qs({ limit: opts.limit, category: opts.category, before: opts.before }));
      }
      return once('updates', function () { return staticFile('updates'); }).then(function (list) {
        list = (list || []).filter(function (u) { return !u.status || u.status === 'published'; })
          .sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.publishedAt).localeCompare(String(a.publishedAt)); });
        if (opts.category && opts.category !== 'all') list = list.filter(function (u) { return u.category === opts.category; });
        var total = list.length;
        if (opts.before) {
          var idx = list.findIndex(function (u) { return u.id === opts.before; });
          list = idx >= 0 ? list.slice(idx + 1) : list;
        }
        if (opts.limit) list = list.slice(0, opts.limit);
        return { updates: list, total: total };
      });
    },

    /** One update plus its newer/older neighbours: { update, newer, older }. */
    update: function (id) {
      if (Cola.isServer) return getJSON('/api/updates/' + encodeURIComponent(id)).catch(function () { return { update: null }; });
      return data.updates({}).then(function (r) {
        var list = (r.updates || []).slice().sort(function (a, b) { return String(b.publishedAt).localeCompare(String(a.publishedAt)); });
        var i = list.findIndex(function (u) { return u.id === id; });
        var brief = function (u) { return u ? { id: u.id, title: u.title, publishedAt: u.publishedAt } : null; };
        return i < 0 ? { update: null } : { update: list[i], newer: brief(list[i - 1]), older: brief(list[i + 1]) };
      });
    },

    /** Merge fresh inventory (variants/stock) into full product objects. */
    withStock: function (products, inv) {
      if (!inv || !inv.products) return products;
      var m = {}; inv.products.forEach(function (p) { m[p.id] = p; });
      return products.map(function (p) {
        var f = m[p.id]; if (!f || !f.variants) return p;
        return Object.assign({}, p, { variants: f.variants.map(function (v) { return Object.assign({}, v); }), restockDate: f.restockDate !== undefined ? f.restockDate : p.restockDate });
      });
    },

    /** POST to the API in server mode. In static mode resolves { ok:false, offline:true } so callers can fall back (e.g. to WhatsApp/mailto). */
    post: function (path, body) {
      if (!Cola.isServer) return Promise.resolve({ ok: false, offline: true });
      return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body || {}) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; if (!r.ok) j.ok = false; return j; }); })
        .catch(function (e) { return { ok: false, error: e.message }; });
    }
  });

  // ---------------------------------------------------------------------------
  // Stock status (mirrors server/lib/stock.js)
  // ---------------------------------------------------------------------------
  var LABELS = { instock: 'In stock', low: 'Low stock', soldout: 'Sold out', preorder: 'Pre-order', restocking: 'Restocking' };
  var stock = (Cola.stock = {
    labels: LABELS,
    threshold: function () { return (data.settings && data.settings.inventory && data.settings.inventory.lowStockThreshold) || 5; },
    variant: function (v, product) {
      if (!v) return 'soldout';
      if (v.status && LABELS[v.status] && v._fromServer) return v.status;
      if (v.preorder) return 'preorder';
      var n = Number(v.stock) || 0;
      if (n <= 0) return product && product.restockDate ? 'restocking' : 'soldout';
      if (n <= stock.threshold()) return 'low';
      return 'instock';
    },
    total: function (p, color) {
      return (p.variants || []).filter(function (v) { return !color || v.color === color; }).reduce(function (a, v) { return a + (Number(v.stock) || 0); }, 0);
    },
    /** Aggregate status for a product (optionally a single colour). */
    product: function (p, color) {
      var vs = (p.variants || []).filter(function (v) { return !color || v.color === color; });
      if (!vs.length) return 'soldout';
      if (vs.every(function (v) { return v.preorder; })) return 'preorder';
      var st = vs.map(function (v) { return stock.variant(v, p); });
      if (st.indexOf('instock') >= 0) return 'instock';
      if (st.indexOf('low') >= 0) return 'low';
      if (st.indexOf('preorder') >= 0) return 'preorder';
      return p.restockDate ? 'restocking' : 'soldout';
    },
    find: function (p, color, size) { return (p.variants || []).find(function (v) { return v.color === color && v.size === size; }) || null; },
    available: function (status) { return status === 'instock' || status === 'low' || status === 'preorder'; },
    label: function (status, n) {
      if (status === 'low' && n != null) return n + ' left';
      return LABELS[status] || status;
    },
    html: function (status, text) {
      return '<span class="status st-' + status + '"><span class="dot"></span><span>' + Cola.esc(text || LABELS[status] || status) + '</span></span>';
    }
  });

  // ---------------------------------------------------------------------------
  // Money — prices are stored in CNY; the visitor picks a display currency.
  // ---------------------------------------------------------------------------
  var SYMBOL = { CNY: '¥', EUR: '€', USD: '$', GBP: '£' };
  var money = (Cola.money = {
    base: 'CNY',
    current: function () {
      var c = data.settings && data.settings.currency;
      var saved = Cola.store.get('cola.currency', null);
      var avail = (c && c.available) || ['CNY', 'EUR', 'USD', 'GBP'];
      if (saved && avail.indexOf(saved) >= 0) return saved;
      return (c && c.default) || 'EUR';
    },
    set: function (cur) { Cola.store.set('cola.currency', cur); Cola.emit('currency:change', cur); },
    rate: function (cur) { var r = data.settings && data.settings.currency && data.settings.currency.rates; return (r && r[cur]) || (cur === 'CNY' ? 1 : null); },
    convert: function (cny, cur) { var r = money.rate(cur); return r == null ? null : cny * r; },
    format: function (cny, cur, opts) {
      opts = opts || {};
      cur = cur || money.current();
      var v = money.convert(Number(cny) || 0, cur);
      if (v == null) { cur = 'CNY'; v = Number(cny) || 0; }
      var digits = opts.digits != null ? opts.digits : (cur === 'CNY' ? 0 : (v < 100 && !opts.round ? 2 : 0));
      var s;
      try { s = new Intl.NumberFormat('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v); } catch (e) { s = v.toFixed(digits); }
      return (SYMBOL[cur] || cur + ' ') + s;
    },
    cny: function (cny) { return money.format(cny, 'CNY'); },
    symbol: function (cur) { return SYMBOL[cur] || cur; },
    /** Price HTML: display currency + compare-at, optional CNY hint. */
    html: function (p, opts) {
      opts = opts || {};
      var cur = money.current();
      var out = '<span class="price">' + money.format(p.price, cur);
      if (p.compareAt && p.compareAt > p.price) out += '<s>' + money.format(p.compareAt, cur) + '</s>';
      if (opts.cny && cur !== 'CNY') out += ' <span class="price__alt">' + money.cny(p.price) + '</span>';
      return out + '</span>';
    }
  });
})();
