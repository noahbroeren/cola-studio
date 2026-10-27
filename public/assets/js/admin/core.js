/* ==========================================================================
   Cola Studio — Admin core
   Namespace, small DOM/format helpers, icons, stock + product helpers.
   Plain classic script: everything hangs off window.ColaAdmin.
   ========================================================================== */
(function () {
  'use strict';

  const A = (window.ColaAdmin = window.ColaAdmin || {});
  A.version = '1.4.0';
  A.views = A.views || {};

  /* ------------------------------------------------------------------ DOM */

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  A.esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) => ESC[c]);
  A.$ = (sel, root) => (root || document).querySelector(sel);
  A.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** HTML string → first element (or DocumentFragment when `frag`). */
  A.el = function (html, frag) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return frag ? t.content : t.content.firstElementChild;
  };

  A.clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  A.isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  A.debounce = function (fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  /** rAF-coalesced call. */
  A.frame = function (fn) {
    let queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fn();
      });
    };
  };

  A.getPath = function (obj, path) {
    return String(path)
      .split('.')
      .reduce((o, k) => (o == null ? undefined : o[k]), obj);
  };
  A.setPath = function (obj, path, value) {
    const keys = String(path).split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!A.isObj(o[keys[i]]) && !Array.isArray(o[keys[i]])) o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
  };

  /** Deep copy without keys starting with "_" (editor-only bookkeeping). */
  A.stripPrivate = function strip(v) {
    if (Array.isArray(v)) return v.map(strip);
    if (A.isObj(v)) {
      const out = {};
      for (const k of Object.keys(v)) if (k[0] !== '_') out[k] = strip(v[k]);
      return out;
    }
    return v;
  };

  /* -------------------------------------------------------------- storage */

  A.store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    getRaw(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        /* ignore */
      }
    },
  };

  /* ------------------------------------------------------------ routing */

  /** Absolute href for a hash route — immune to <base href="/">. */
  A.href = function (route) {
    const r = String(route || '/').replace(/^#?\/?/, '/');
    return location.pathname + location.search + '#' + r;
  };
  A.go = function (route) {
    const r = String(route || '/').replace(/^#?\/?/, '/');
    if (location.hash === '#' + r) {
      if (A.router) A.router.refresh();
    } else location.hash = r;
  };

  /* ------------------------------------------------------------- format */

  A.slugify = function (input, max) {
    return String(input || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max || 80)
      .replace(/-+$/g, '');
  };

  A.CURRENCY_SYMBOL = { CNY: '¥', EUR: '€', USD: '$', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$', CHF: 'CHF ', HKD: 'HK$', KRW: '₩', SEK: 'kr ', DKK: 'kr ', NOK: 'kr ', PLN: 'zł ', SGD: 'S$', NZD: 'NZ$' };

  A.num = function (n, digits) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('en-GB', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits == null ? 2 : digits });
  };

  /** Format an amount already in `currency`. */
  A.money = function (amount, currency) {
    const v = Number(amount);
    if (!Number.isFinite(v)) return '—';
    const sym = A.CURRENCY_SYMBOL[currency] || currency + ' ';
    const digits = currency === 'CNY' || currency === 'JPY' || currency === 'KRW' ? (Number.isInteger(v) ? 0 : 2) : 2;
    return sym + v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  /** Convert CNY → currency with settings.currency.rates (1 CNY = x). */
  A.convert = function (cny, currency, settings) {
    const rates = (settings && settings.currency && settings.currency.rates) || {};
    const r = currency === 'CNY' ? 1 : Number(rates[currency]);
    if (!Number.isFinite(r) || r <= 0) return null;
    return Number(cny) * r;
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  A.date = function (iso, withYear) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return '—';
    const y = withYear === false ? '' : withYear || d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + y;
  };
  A.dateTime = function (iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return '—';
    return A.date(iso) + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  A.ago = function (iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '—';
    const s = Math.round((Date.now() - t) / 1000);
    const future = s < 0;
    const a = Math.abs(s);
    let out;
    if (a < 45) out = 'just now';
    else if (a < 3600) out = Math.round(a / 60) + ' min';
    else if (a < 86400) out = Math.round(a / 3600) + ' h';
    else if (a < 86400 * 14) out = Math.round(a / 86400) + ' d';
    else return A.date(iso);
    if (out === 'just now') return out;
    return future ? 'in ' + out : out + ' ago';
  };
  A.bytes = function (n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(v < 10240 ? 1 : 0) + ' KB';
    return (v / 1024 / 1024).toFixed(1) + ' MB';
  };
  A.plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

  /** Date → "YYYY-MM-DDTHH:mm" for <input type=datetime-local>. */
  A.toLocalInput = function (iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  /** "YYYY-MM-DDTHH:mm" (local) → ISO with the local UTC offset. */
  A.fromLocalInput = function (v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return '';
    const p = (n) => String(Math.abs(n)).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    return v.slice(0, 16) + ':00' + (off >= 0 ? '+' : '-') + p(Math.trunc(off / 60)) + ':' + p(off % 60);
  };

  /* ---------------------------------------------------------- constants */

  A.GARMENTS = ['tee', 'longsleeve', 'hoodie', 'ziphoodie', 'crewneck', 'sweatpants', 'workjacket', 'bomber', 'puffer', 'coach', 'coat', 'knit', 'cardigan', 'shirt', 'overshirt', 'trousers', 'jeans', 'cargo', 'shorts', 'cap', 'beanie', 'tote', 'crossbody', 'socks'];
  A.GARMENT_LABEL = {
    tee: 'T-shirt', longsleeve: 'Longsleeve', hoodie: 'Hoodie', ziphoodie: 'Zip hoodie', crewneck: 'Crewneck', sweatpants: 'Sweatpants',
    workjacket: 'Work jacket', bomber: 'Bomber', puffer: 'Puffer', coach: 'Coach jacket', coat: 'Coat', knit: 'Knit sweater', cardigan: 'Cardigan',
    shirt: 'Shirt', overshirt: 'Overshirt', trousers: 'Trousers', jeans: 'Jeans', cargo: 'Cargo pants', shorts: 'Shorts', cap: 'Cap',
    beanie: 'Beanie', tote: 'Tote bag', crossbody: 'Crossbody bag', socks: 'Socks',
  };
  A.BADGES = ['new', 'bestseller', 'limited', 'restock', 'preorder'];
  A.BADGE_LABEL = { new: 'New', bestseller: 'Bestseller', limited: 'Limited', restock: 'Restock', preorder: 'Pre-order' };
  A.PRODUCT_STATUSES = ['published', 'draft', 'archived'];
  A.UPDATE_CATEGORIES = ['production', 'drop', 'restock', 'studio', 'notice'];
  A.UPDATE_STATUSES = ['published', 'pending', 'hidden'];
  A.SIZE_PRESETS = [
    { id: 'sxxl', label: 'S–XXL', sizes: ['S', 'M', 'L', 'XL', 'XXL'] },
    { id: 'sxl', label: 'S–XL', sizes: ['S', 'M', 'L', 'XL'] },
    { id: 'denim', label: '28–36', sizes: ['28', '30', '32', '34', '36'] },
    { id: 'os', label: 'OS', sizes: ['OS'] },
  ];

  /* -------------------------------------------------------------- stock */

  A.STOCK_LABEL = { instock: 'In stock', low: 'Low stock', soldout: 'Sold out', preorder: 'Pre-order', restocking: 'Restocking' };
  A.lowThreshold = function (settings) {
    const n = Number(settings && settings.inventory && settings.inventory.lowStockThreshold);
    return Number.isFinite(n) ? n : 5;
  };
  A.stockStatus = function (v, p, settings) {
    if (v && v.preorder) return 'preorder';
    const s = Number(v && v.stock) || 0;
    if (s <= 0) return p && p.restockDate ? 'restocking' : 'soldout';
    if (s <= A.lowThreshold(settings)) return 'low';
    return 'instock';
  };
  A.availability = function (p, settings) {
    const vs = (p && p.variants) || [];
    if (!vs.length) return p && p.restockDate ? 'restocking' : 'soldout';
    const st = vs.map((v) => A.stockStatus(v, p, settings));
    for (const s of ['instock', 'low', 'preorder', 'restocking', 'soldout']) if (st.includes(s)) return s;
    return 'soldout';
  };
  A.totalStock = (p) => ((p && p.variants) || []).reduce((n, v) => n + (Number(v.stock) || 0), 0);
  A.stockDot = (status) => '<i class="dot dot--' + A.esc(status) + '" aria-hidden="true"></i>';
  A.stockPill = (status, extra) =>
    '<span class="pill pill--' + A.esc(status) + '">' + A.stockDot(status) + A.esc(A.STOCK_LABEL[status] || status) + (extra ? ' ' + A.esc(extra) : '') + '</span>';
  A.statusPill = function (status) {
    const label = { published: 'Published', draft: 'Draft', archived: 'Archived', pending: 'Pending', hidden: 'Hidden' }[status] || status;
    return '<span class="pill pill--' + A.esc(status) + '">' + A.esc(label) + '</span>';
  };

  /* ------------------------------------------------------- product helpers */

  A.idCode = (id) => String(id || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  /** Colour code for SKUs: "Clay" → CLAY, "Washed Black" → WASHEDB. Unique within `taken`. */
  A.colorCode = function (name, taken) {
    const words = String(name || '')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .trim()
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return 'X';
    let c = words.length === 1 ? words[0].slice(0, 6) : (words[0].slice(0, 6) + words.slice(1).map((w) => w[0]).join('')).slice(0, 8);
    if (taken) {
      let i = 2;
      const base = c;
      while (taken.has(c)) c = base + i++;
    }
    return c;
  };
  A.sizeCode = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5) || 'OS';
  A.genSku = function (id, colorCode, size) {
    return [A.idCode(id) || 'CSNEW', colorCode, size !== '' && size != null ? A.sizeCode(size) : ''].filter(Boolean).join('-');
  };

  /** Fill {placeholders} of an agent URL template. */
  A.fillTemplate = function (tpl, ctx) {
    if (!tpl) return '';
    return String(tpl).replace(/\{(weidianUrl|itemId|slug|name)\}/g, (m, k) => encodeURIComponent(ctx[k] || ''));
  };
  A.weidianUrl = function (product, settings) {
    const w = (product && product.weidian) || {};
    if (w.url) return w.url;
    if (!w.itemId) return '';
    const tpl = (settings && settings.weidian && settings.weidian.itemUrlTemplate) || 'https://weidian.com/item.html?itemID={itemId}';
    return tpl.replace(/\{itemId\}/g, encodeURIComponent(w.itemId));
  };

  /** Public product URL for "view on site". */
  A.productUrl = function (product) {
    if (!product || !product.slug) return A.siteUrl();
    if (A.data && A.data.mode === 'server') return '/products/' + encodeURIComponent(product.slug);
    return new URL('../product.html?slug=' + encodeURIComponent(product.slug), location.href).href;
  };
  A.siteUrl = function () {
    if (A.data && A.data.mode === 'server') return '/';
    return new URL('../', location.href).href;
  };

  /* ------------------------------------------------------------ garments */

  const FALLBACK_SHAPES = {
    top: 'M74 22 46 32 14 74l26 22 14-14v126h92V82l14 14 26-22-32-42-28-10c-4 14-14 22-26 22S78 36 74 22Z',
    pants: 'M58 18h84l10 196h-40l-12-128-12 128H48Z',
    head: 'M40 140c0-50 26-84 60-84s60 34 60 84Zm-8 0h136v16H32Z',
    bag: 'M44 92h112l-8 116H52Zm28 0c0-30 12-48 28-48s28 18 28 48',
    sock: 'M80 20h46v120l18 30c8 16-2 34-20 34H82c-14 0-22-10-22-22 0-10 6-18 20-24Z',
  };
  const SHAPE_OF = { sweatpants: 'pants', trousers: 'pants', jeans: 'pants', cargo: 'pants', shorts: 'pants', cap: 'head', beanie: 'head', tote: 'bag', crossbody: 'bag', socks: 'sock' };

  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return 0.5;
    const n = parseInt(m[1], 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }
  A.luminance = luminance;

  /** SVG markup for a garment placeholder — ColaGarments when available, else a quiet silhouette. */
  A.garmentSvg = function (type, opts) {
    const o = Object.assign({ color: '#8F857A', view: 'front' }, opts || {});
    try {
      if (window.ColaGarments && typeof window.ColaGarments.render === 'function') {
        const svg = window.ColaGarments.render(type || 'tee', { color: o.color, view: o.view, print: o.print || undefined });
        if (svg && typeof svg === 'string') return svg;
      }
    } catch (e) {
      /* fall through to the built-in silhouette */
    }
    const shape = FALLBACK_SHAPES[SHAPE_OF[type] || 'top'];
    if (shape === FALLBACK_SHAPES.pants && type === 'shorts') {
      return '<svg viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M54 40h92l10 110h-44l-12-60-12 60H44Z" fill="' + A.esc(o.color) + '" stroke="rgba(19,13,10,.35)" stroke-width="2" stroke-linejoin="round"/></svg>';
    }
    const stroke = luminance(o.color) > 0.8 ? 'rgba(19,13,10,.4)' : 'rgba(19,13,10,.28)';
    return '<svg viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="' + shape + '" fill="' + A.esc(o.color) + '" stroke="' + stroke + '" stroke-width="2" stroke-linejoin="round"/></svg>';
  };

  /** Swatch / pattern renderers for demo update media (use ColaGarments extras when present). */
  A.mediaSvg = function (m) {
    const G = window.ColaGarments || {};
    try {
      if (m.type === 'swatch' && typeof G.swatch === 'function') return G.swatch(m.color, m.texture);
      if (m.type === 'pattern' && typeof G.patternPieces === 'function') return G.patternPieces(m.garment);
    } catch (e) {
      /* fall back */
    }
    if (m.type === 'illustration') return A.garmentSvg(m.garment, { color: m.color, view: m.view, print: m.print });
    if (m.type === 'swatch') {
      const fg = luminance(m.color) > 0.6 ? 'rgba(19,13,10,.18)' : 'rgba(243,238,230,.16)';
      return (
        '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="120" height="120" fill="' + A.esc(m.color || '#8F857A') + '"/>' +
        Array.from({ length: 12 }, (_, i) => '<path d="M' + (i * 12 - 60) + ' 120 L' + (i * 12 + 60) + ' 0" stroke="' + fg + '" stroke-width="1"/>').join('') +
        '</svg>'
      );
    }
    if (m.type === 'pattern') {
      return (
        '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="120" height="120" fill="#F3EEE6"/>' +
        '<g fill="none" stroke="rgba(19,13,10,.45)" stroke-width="1" stroke-dasharray="3 3"><path d="M30 18h34l26 14-6 70H36l-6-70Z"/><path d="M64 18v84"/></g>' +
        '<g stroke="rgba(19,13,10,.12)"><path d="M0 40h120M0 80h120M40 0v120M80 0v120"/></g></svg>'
      );
    }
    return '';
  };

  /** Thumbnail markup for a product: first image, else its garment illustration. */
  A.productThumb = function (p, opts) {
    const o = opts || {};
    const imgs = (p && p.images) || [];
    const color = o.color || null;
    let img = null;
    if (imgs.length) img = (color && imgs.find((i) => i.color === color)) || imgs[0];
    if (img && img.url) return '<img src="' + A.esc(img.url) + '" alt="' + A.esc(img.alt || p.name || '') + '" loading="lazy" decoding="async">';
    const c = (p.colors || []).find((x) => x.name === color) || (p.colors || [])[0] || {};
    return A.garmentSvg(p.garment, { color: c.hex || '#8F857A', view: o.view || 'front', print: p.print });
  };

  /* -------------------------------------------------------------- icons */

  const I = {
    dashboard: '<rect x="3.5" y="3.5" width="7" height="9"/><rect x="13.5" y="3.5" width="7" height="5"/><rect x="13.5" y="11.5" width="7" height="9"/><rect x="3.5" y="15.5" width="7" height="5"/>',
    products: '<path d="M8.5 3.5 4 6v4l2.5-.8V20.5h11V9.2L20 10V6l-4.5-2.5c-.6 1.6-2 2.5-3.5 2.5S9.1 5.1 8.5 3.5Z"/>',
    inventory: '<path d="M3.5 7.5 12 3.5l8.5 4-8.5 4-8.5-4Z"/><path d="m3.5 12 8.5 4 8.5-4"/><path d="m3.5 16.5 8.5 4 8.5-4"/>',
    categories: '<path d="M3.5 6.5h7l2 2h8v10h-17Z"/>',
    updates: '<path d="M4.5 4.5h15v15h-15Z"/><path d="M8 9h8M8 12.5h8M8 16h5"/>',
    orders: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2Z"/><path d="M9 8.5h6M9 12h6"/>',
    messages: '<path d="M3.5 5.5h17v13h-17Z"/><path d="m4 6 8 6.5L20 6"/>',
    restock: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15Z"/><path d="M10 20.5h4"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    integrations: '<path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0Z"/><path d="M12 16v4.5"/>',
    media: '<rect x="3.5" y="4.5" width="17" height="15"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 2.5-2.5L20 19"/>',
    backup: '<path d="M4 6.5h16v4H4Z"/><path d="M5.5 10.5v9h13v-9"/><path d="M10 14h4"/>',
    sheet: '<rect x="3.5" y="4.5" width="17" height="15"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15"/>',
    external: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M17 14v5.5H4.5V7H10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
    trash: '<path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11"/><path d="M15.5 8.5V4.5h-11v11h4"/>',
    grip: '<circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    chevronLeft: '<path d="m15 6-6 6 6 6"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    logout: '<path d="M14 4.5H5v15h9"/><path d="M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    upload: '<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 15v4.5h15V15"/>',
    download: '<path d="M12 4v11.5M7.5 11 12 15.5l4.5-4.5"/><path d="M4.5 15v4.5h15V15"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.5M12 16.8v.2"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8V8"/>',
    star: '<path d="m12 4 2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8 5.4-.7Z"/>',
    pin: '<path d="M9 3.5h6l-1 6 3 3v2H7v-2l3-3Z"/><path d="M12 14.5v6"/>',
    chat: '<path d="M4.5 19.5 6 15.6A7.5 7.5 0 1 1 9 18.6Z"/>',
    sparkle: '<path d="M12 3.5 13.8 10 20.5 12l-6.7 2-1.8 6.5-1.8-6.5L3.5 12l6.7-2Z"/>',
    terminal: '<rect x="3.5" y="4.5" width="17" height="15"/><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4"/>',
    wand: '<path d="m4 20 11-11M14 4v3M19 9h-3M17.5 5.5 16 7"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.3 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.3-3.5-8.5s1-5.9 3.5-8.5Z"/>',
    sync: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9"/><path d="M19.5 4.5V9h-4.5"/><path d="M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15"/><path d="M4.5 19.5V15H9"/>',
    filter: '<path d="M4 5.5h16l-6 7.5v5.5l-4 1.5v-7Z"/>',
    more: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>',
    edit: '<path d="M4.5 19.5 5.5 15 15.5 5l3.5 3.5-10 10Z"/><path d="m13 7.5 3.5 3.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    whatsapp: '<path d="M4.5 19.5 5.6 16a7.5 7.5 0 1 1 2.6 2.5Z"/><path d="M9.3 8.8c.2 2.6 3.2 5.6 5.9 5.9l1.2-1.3-1.8-1-.8.8c-.9-.4-2-1.5-2.4-2.4l.8-.8-1-1.8Z"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  };
  A.icon = function (name, size) {
    const s = size || 18;
    return '<svg class="ico" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (I[name] || '') + '</svg>';
  };

  /** Brand monogram (currentColor). */
  A.monogram = function (size) {
    const s = size || 28;
    return (
      '<svg class="monogram" width="' + s + '" height="' + s + '" viewBox="-415 -415 830 830" aria-hidden="true" focusable="false">' +
      '<g fill="none" stroke="currentColor" stroke-width="29.57"><path d="M395.08 62.57A400.00 400.00 0 1 1 394.28 -67.40"/><path d="M-141.30 150.25A206.64 206.64 0 0 1 -50.75 -199.47"/><path d="M-102.52 0.56H103.50"/></g>' +
      '<g fill="currentColor"><path d="M2.10 -220.87A221.42 221.42 0 1 1 -105.47 194.62L-97.78 164.93A191.85 191.85 0 1 0 -5.58 -191.18Z"/><path d="M-210.22 357.57L-10.30 -414.66A414.79 414.79 0 0 1 13.03 -414.58L66.85 -203.28L38.19 -195.98L1.22 -341.13L-183.42 372.03A414.79 414.79 0 0 1 -210.22 357.57Z"/><path d="M83.59 -137.56A160.85 160.85 0 0 0 49.14 -152.97L182.92 372.27A414.79 414.79 0 0 0 209.76 357.84Z"/></g></svg>'
    );
  };

  /** Heading markup: "<b>Products</b> <span>26</span>". */
  A.heading = function (strong, light) {
    return '<b>' + A.esc(strong) + '</b>' + (light != null && light !== '' ? ' <span>' + A.esc(light) + '</span>' : '');
  };

  A.isPhoneLike = (s) => /^\+?[\d\s().-]{7,20}$/.test(String(s || '').trim());
  A.waLink = function (number, text) {
    const n = String(number || '').replace(/\D/g, '');
    if (!n) return '';
    return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '');
  };
})();

/* Photos the media proxy could not deliver: show a calm "unavailable" tile instead of a broken image. */
document.addEventListener(
  'error',
  function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    var tile = img.closest('.media-tile, .u-thumb, .img-card__media, .dimg__media, .wd-thumbs a, .wd-pick__img');
    if (tile) tile.classList.add('is-broken');
  },
  true
);
