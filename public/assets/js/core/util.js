/* ==========================================================================
   COLA STUDIO — core/util.js
   Namespace, helpers, storage, routing helpers, icons, events.
   ========================================================================== */
(function () {
  'use strict';
  var Cola = (window.Cola = window.Cola || {});
  document.documentElement.classList.add('js');

  Cola.version = '1.4.0';
  Cola.$ = function (s, r) { return (r || document).querySelector(s); };
  Cola.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  Cola.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  Cola.clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  Cola.lerp = function (a, b, t) { return a + (b - a) * t; };
  Cola.debounce = function (fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; };
  Cola.throttle = function (fn, ms) { var last = 0, t; return function () { var now = Date.now(), a = arguments, s = this; if (now - last >= ms) { last = now; fn.apply(s, a); } else { clearTimeout(t); t = setTimeout(function () { last = Date.now(); fn.apply(s, a); }, ms - (now - last)); } }; };
  Cola.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  Cola.isTouch = window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;
  Cola.uid = function (p) { return (p || 'c') + Math.random().toString(36).slice(2, 9); };
  Cola.slugify = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };

  // ---- Safe storage (private mode / blocked storage never breaks the page)
  function mkStore(kind) {
    return {
      get: function (k, d) { try { var v = window[kind].getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
      set: function (k, v) { try { window[kind].setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
      del: function (k) { try { window[kind].removeItem(k); } catch (e) { /* noop */ } }
    };
  }
  Cola.store = mkStore('localStorage');
  Cola.session = mkStore('sessionStorage');

  // ---- Event bus
  var bus = {};
  Cola.on = function (evt, fn) { (bus[evt] = bus[evt] || []).push(fn); return function () { bus[evt] = (bus[evt] || []).filter(function (f) { return f !== fn; }); }; };
  Cola.emit = function (evt, data) { (bus[evt] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); };

  // ---- Runtime + URLs
  // The Node server injects <meta name="cola-runtime" content="server"> and <base href="/">.
  var meta = document.querySelector('meta[name="cola-runtime"]');
  Cola.isServer = !!(meta && meta.getAttribute('content') === 'server');

  var PAGES = {
    home: ['/', 'index.html'], products: ['/products', 'products.html'], product: ['/products/', 'product.html'],
    'live-stock': ['/live-stock', 'live-stock.html'], updates: ['/updates', 'updates.html'], 'how-to-order': ['/how-to-order', 'how-to-order.html'],
    order: ['/order', 'order.html'], about: ['/about', 'about.html'], contact: ['/contact', 'contact.html'], faq: ['/faq', 'faq.html'],
    'size-guide': ['/size-guide', 'size-guide.html'], lookbook: ['/lookbook', 'lookbook.html'], brand: ['/brand', 'brand.html'], admin: ['/admin', 'admin/index.html']
  };
  function qs(params) {
    if (!params) return '';
    var parts = Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    return parts.length ? '?' + parts.join('&') : '';
  }
  Cola.qs = qs;
  /** Build a link that works in both server mode (pretty URLs) and static mode (.html files). */
  Cola.url = function (page, params) {
    params = Object.assign({}, params || {});
    var p = PAGES[page] || PAGES.home;
    if (page === 'product') {
      var slug = params.slug; delete params.slug;
      return Cola.isServer ? '/products/' + encodeURIComponent(slug) + qs(params) : 'product.html' + qs(Object.assign({ slug: slug }, params));
    }
    return (Cola.isServer ? p[0] : p[1]) + qs(params);
  };
  Cola.productUrl = function (p, params) { return Cola.url('product', Object.assign({ slug: p.slug }, params || {})); };
  /** Own page for one studio update: /updates/<id> (server) or updates.html?post=<id> (static). */
  Cola.updateUrl = function (u) { var id = typeof u === 'string' ? u : u.id; return Cola.isServer ? '/updates/' + encodeURIComponent(id) : 'updates.html' + qs({ post: id }); };
  Cola.param = function (k) { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } };
  /** In server mode, rewrite hard-coded "page.html" links to pretty URLs. */
  Cola.rewriteLinks = function (root) {
    if (!Cola.isServer) return;
    Cola.$$('a[href]', root || document).forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href || /^(https?:|mailto:|tel:|#|\/|data:|javascript:)/i.test(href)) return;
      var m = href.match(/^([a-z0-9-]+)\.html(\?[^#]*)?(#.*)?$/i);
      if (!m) return;
      var name = m[1] === 'index' ? 'home' : m[1], q = m[2] || '', h = m[3] || '';
      if (name === 'product') {
        var sp = new URLSearchParams(q); var slug = sp.get('slug'); sp.delete('slug');
        var rest = sp.toString();
        a.setAttribute('href', '/products/' + (slug || '') + (rest ? '?' + rest : '') + h);
      } else if (PAGES[name]) a.setAttribute('href', PAGES[name][0] + q + h);
    });
  };
  Cola.currentPage = document.body ? document.body.getAttribute('data-page') : '';

  // ---- Dates
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  Cola.fmtDate = function (d, style) {
    d = d instanceof Date ? d : new Date(d);
    if (isNaN(d)) return '';
    if (style === 'short') return d.getDate() + ' ' + MONTHS[d.getMonth()];
    if (style === 'dots') return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + String(d.getFullYear()).slice(-2);
    if (style === 'time') return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    if (style === 'full') return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + Cola.fmtDate(d, 'time');
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };
  Cola.timeAgo = function (d) {
    d = d instanceof Date ? d : new Date(d);
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    if (isNaN(s)) return '';
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 7) { var dd = Math.round(s / 86400); return dd + (dd === 1 ? ' day ago' : ' days ago'); }
    return Cola.fmtDate(d);
  };

  // ---- Icons (inline, stroke-based, 24px grid)
  var P = {
    'arrow-right': '<path d="M4 12h15M13 6l6 6-6 6"/>',
    'arrow-left': '<path d="M20 12H5M11 6l-6 6 6 6"/>',
    'arrow-up-right': '<path d="M7 17L17 7M8 7h9v9"/>',
    'arrow-up': '<path d="M12 20V5M6 11l6-6 6 6"/>',
    'arrow-down': '<path d="M12 4v15M6 13l6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    bag: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6.5a3 3 0 016 0V8"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    refresh: '<path d="M20 12a8 8 0 11-2.3-5.7M20 4v4.5h-4.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    box: '<path d="M4 7.5L12 4l8 3.5v9L12 20l-8-3.5z"/><path d="M4 7.5l8 3.5 8-3.5M12 11v9"/>',
    shield: '<path d="M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.4-4.6"/>',
    ruler: '<path d="M3 15L15 3l6 6L9 21z"/><path d="M7 11l2 2M10 8l2 2M13 5l2 2"/>',
    share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4M8.2 13.2l7.6 4"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>', 'chevron-left': '<path d="M15 6l-6 6 6 6"/>', 'chevron-right': '<path d="M9 6l6 6-6 6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    scissors: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8 8l12 10M8 16L20 6"/>',
    needle: '<path d="M19 5L7 17l-2 2"/><ellipse cx="18" cy="6" rx="1.2" ry="2.4" transform="rotate(45 18 6)"/><path d="M4 20c4 0 6-3 9-3s4 2 7 1"/>',
    layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    translate: '<path d="M4 5h9M8.5 3v2M6 5c.6 3 2.6 5.6 5.5 7M11 5c-.8 3.6-3.3 6.6-7 8"/><path d="M12.5 21l4-9 4 9M14 18h5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3.5 6l8.5 7 8.5-7"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z"/>',
    pin: '<path d="M12 21s-7-6.3-7-11.5a7 7 0 0114 0C19 14.7 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.3-4 4.3-6 8-6s6.7 2 8 6"/>',
    spark: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
    bell: '<path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 004 0"/>',
    card: '<rect x="3" y="6" width="18" height="13" rx="1"/><path d="M3 10h18M7 15h4"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".6" fill="currentColor"/>',
    album: '<rect x="3.5" y="6.5" width="14" height="13" rx="1"/><path d="M7 3.5h13.5V17"/><circle cx="8.5" cy="11" r="1.5"/><path d="m4 18 4.5-4.5 3 3 2-2 3.5 3.5"/>',
    weibo: '<path d="M10.2 19.5c-4 0-7.2-2-7.2-4.6 0-1.4.9-3 2.4-4.5 2-2 4.4-3 5.3-2.1.4.4.4 1.1.2 1.9-.1.4.4.2.4.2 1.7-.7 3.2-.7 3.7 0 .3.4.3 1 0 1.6-.1.3 0 .3.3.4 1.3.4 2.7 1.3 2.7 2.9 0 2.6-3.8 4.2-7.8 4.2z"/><path d="M16 4.5a4.5 4.5 0 014.5 5.2M15.6 7a2 2 0 012.1 2.4"/>',
    tiktok: '<path d="M14 4v10.5a3.5 3.5 0 11-3.5-3.5"/><path d="M14 4c.4 2.6 2.2 4.4 5 4.6"/>',
    discord: '<path d="M8 7.5a14 14 0 018 0l1.2-1.5c2 .7 3.3 1.6 3.3 1.6s1.7 4.4 1 9.2c0 0-1.8 1.7-4.5 2.2l-1.1-1.6M8 7.5L6.8 6s-1.3.9-3.3 1.6c0 0-1.7 4.4-1 9.2 0 0 1.8 1.7 4.5 2.2L8 17.4"/><path d="M7.5 15.5c3 1.4 6 1.4 9 0"/><circle cx="9.3" cy="12.3" r="1.1"/><circle cx="14.7" cy="12.3" r="1.1"/>',
    xhs: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 9.5h8M8 14.5h8M12 8v8"/>'
  };
  var WA = '<path fill="currentColor" stroke="none" d="M12.04 2.5a9.42 9.42 0 00-8.1 14.24L2.5 21.5l4.9-1.4a9.43 9.43 0 104.64-17.6zm0 17.18a7.75 7.75 0 01-3.96-1.08l-.28-.17-2.92.83.85-2.84-.19-.29a7.76 7.76 0 116.5 3.55zm4.25-5.8c-.23-.12-1.38-.68-1.6-.76-.21-.08-.37-.12-.53.12-.15.23-.6.76-.74.92-.14.15-.27.17-.5.06a6.37 6.37 0 01-3.18-2.78c-.24-.41.24-.38.69-1.27.08-.15.04-.29-.02-.4-.06-.12-.53-1.27-.72-1.74-.19-.46-.39-.39-.53-.4h-.45a.87.87 0 00-.63.3 2.64 2.64 0 00-.83 1.97 4.6 4.6 0 00.97 2.44 10.5 10.5 0 004.03 3.56c1.5.65 2.08.7 2.83.6.46-.07 1.38-.57 1.58-1.11.2-.55.2-1.02.14-1.12-.06-.1-.21-.16-.44-.27z"/>';
  Cola.icon = function (name, cls) {
    if (name === 'whatsapp') return '<svg class="' + (cls || 'icon') + '" viewBox="0 0 24 24" aria-hidden="true">' + WA + '</svg>';
    return '<svg class="' + (cls || 'icon') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || P.info) + '</svg>';
  };

  // ---- Open an external link (WhatsApp etc.) in a new tab, falling back to the
  // current tab when a popup blocker refuses. (window.open with "noopener" always
  // returns null, so we clear opener manually instead.)
  Cola.openExternal = function (url) {
    var w = null;
    try { w = window.open(url, '_blank'); } catch (e) { w = null; }
    if (w) { try { w.opener = null; } catch (e) { /* noop */ } return true; }
    location.href = url;
    return false;
  };

  // ---- Clipboard
  Cola.copy = function (text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    return Promise.resolve(fallback());
    function fallback() {
      try { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
    }
  };

  // ---- Download a text file
  Cola.downloadText = function (name, text, type) {
    try {
      var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { /* noop */ }
  };
})();
