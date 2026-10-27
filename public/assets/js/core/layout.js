/* ==========================================================================
   COLA STUDIO — core/layout.js
   Shared chrome (announcement, header, full-screen menu, footer, order-list
   drawer, search overlay, demo marker) and the page boot sequence.
   ========================================================================== */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var L = (Cola.layout = {});
  var page = Cola.currentPage;

  var NAV = [
    { id: 'products', label: 'Shop' },
    { id: 'live-stock', label: 'Live Stock', live: true },
    { id: 'updates', label: 'Studio Updates' },
    { id: 'how-to-order', label: 'How to Order' },
    { id: 'about', label: 'About' }
  ];
  var MENU = [
    { id: 'products', label: 'Shop' }, { id: 'live-stock', label: 'Live stock' }, { id: 'updates', label: 'Studio updates' },
    { id: 'how-to-order', label: 'How to order' }, { id: 'about', label: 'About' }, { id: 'contact', label: 'Contact' }
  ];
  var SEARCH_PAGES = [
    ['products', 'All products'], ['live-stock', 'Live stock'], ['updates', 'Studio updates'], ['how-to-order', 'How to order'], ['order', 'Order list & checkout'],
    ['size-guide', 'Size guide'], ['faq', 'FAQ'], ['lookbook', 'Lookbook'], ['about', 'About the studio'], ['contact', 'Contact'], ['brand', 'Brand & logo']
  ];

  // ---------------------------------------------------------------------------
  L.render = function () {
    var s = Cola.data.settings || {};
    var body = document.body;
    var frag = '';
    // announcement — one quiet static line, only when switched on in the admin
    var annText = s.announcement && s.announcement.enabled && s.announcement.text ? s.announcement.text : '';
    if (annText) {
      body.classList.add('has-announce');
      var link = s.announcement.link ? (/^https?:/.test(s.announcement.link) ? s.announcement.link : Cola.url(s.announcement.link)) : null;
      frag += '<div class="announce" role="region" aria-label="Announcement"><div class="container announce__inner">' +
        (link ? '<a class="announce__text" href="' + esc(link) + '">' + esc(annText) + '</a>' : '<span class="announce__text">' + esc(annText) + '</span>') +
        '</div></div>';
    }
    // header
    frag += '<header class="site-header" data-site-header><div class="container site-header__inner">' +
      '<div class="site-header__left"><button class="burger" type="button" aria-label="Open menu" aria-expanded="false" data-burger><span></span></button>' + Cola.brand.lockup() + '</div>' +
      '<nav class="nav" aria-label="Primary">' + NAV.map(function (n) {
        return '<a class="nav__link" href="' + Cola.url(n.id) + '"' + (page === n.id || (page === 'product' && n.id === 'products') ? ' aria-current="page"' : '') + '>' + (n.live ? '<span class="live-dot" aria-hidden="true"></span>' : '') + n.label + '</a>';
      }).join('') + '</nav>' +
      '<div class="site-header__right">' +
        '<div class="currency" data-currency><button class="hdr-btn" type="button" aria-haspopup="true" aria-expanded="false" data-currency-btn><span data-currency-label>' + Cola.money.current() + '</span>' + Cola.icon('chevron-down') + '</button>' +
          '<div class="currency__menu" role="menu">' + ((s.currency && s.currency.available) || ['CNY', 'EUR', 'USD', 'GBP']).map(function (c) {
            return '<button type="button" role="menuitemradio" aria-checked="' + (c === Cola.money.current()) + '" data-cur="' + c + '"><span>' + Cola.money.symbol(c) + ' ' + c + '</span><small>' + ({ CNY: 'Store currency', EUR: 'Euro', USD: 'US dollar', GBP: 'Pound' }[c] || '') + '</small></button>';
          }).join('') + '</div></div>' +
        '<button class="hdr-btn" type="button" data-search-open aria-label="Search">' + Cola.icon('search') + '<span class="hide-sm">Search</span></button>' +
        '<button class="hdr-btn" type="button" data-bag-open aria-label="Open order list">' + Cola.icon('bag') + '<span class="hide-sm">Order</span><span class="hdr-btn__count" data-bag-count></span></button>' +
      '</div></div></header>';
    // menu
    frag += '<div class="menu theme-dark" id="site-menu" aria-hidden="true"><div class="menu__inner"><nav class="menu__list" aria-label="Menu">' + MENU.map(function (m, i) {
      return '<a class="menu__link" href="' + Cola.url(m.id) + '" style="--i:' + i + '"' + (page === m.id ? ' aria-current="page"' : '') + '>' + m.label + '</a>';
    }).join('') + '</nav><div class="menu__foot"><a href="' + Cola.url('faq') + '">FAQ</a><a href="' + Cola.url('size-guide') + '">Size guide</a><a href="' + Cola.url('order') + '">Your order list</a></div></div></div>';
    // drawer + overlay + search + to-top
    frag += '<div class="overlay" data-overlay></div><aside class="drawer" id="bag" aria-label="Order list" aria-hidden="true" data-bag></aside>';
    frag += '<div class="search" role="dialog" aria-modal="true" aria-label="Search" data-search><div class="search__head"><div class="container"><form class="search__form" role="search" data-search-form>' + Cola.icon('search', 'icon') +
      '<input class="search__input" type="search" placeholder="Search the collection" aria-label="Search products" autocomplete="off" data-search-input><span class="kbd only-desktop">Esc</span>' +
      '<button class="icon-btn" type="button" data-search-close aria-label="Close search">' + Cola.icon('close') + '</button></form></div></div>' +
      '<div class="search__body"><div class="container"><div class="search__cols"><div><p class="label mb-2">Pages</p><div class="search__pages" data-search-pages></div></div><div><p class="label mb-2" data-search-label>Popular right now</p><div class="search__results" data-search-results></div></div></div></div></div></div>';
    frag += '<button class="to-top" type="button" aria-label="Back to top" data-to-top><svg class="ring" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/></svg>' + Cola.icon('arrow-up', 'arrow') + '</button>';

    var holder = document.createElement('div'); holder.innerHTML = frag;
    var main = $('main');
    Array.prototype.slice.call(holder.children).forEach(function (el) {
      if (el.classList.contains('announce') || el.classList.contains('site-header') || el.classList.contains('menu')) body.insertBefore(el, main);
      else body.appendChild(el);
    });
    // footer
    var foot = $('[data-footer]');
    if (foot) {
      if (['order', 'notfound', 'brand', 'faq', 'contact'].indexOf(page) < 0 && !document.body.hasAttribute('data-no-cta')) foot.insertAdjacentHTML('beforebegin', L.endCta());
      foot.outerHTML = L.footer();
    }

    bindHeader(); bindBag(); bindSearch(); L.renderBag(); updateCount();
    $('[data-to-top]').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: Cola.reducedMotion ? 'auto' : 'smooth' }); });
    var di = $('[data-demo-info]'); if (di) di.addEventListener('click', L.demoInfo);
  };

  /** Closing call to action above the footer: an arch cut like the outer ring of the monogram. */
  L.endCta = function () {
    var s = Cola.data.settings || {};
    var wa = Cola.order.enabled() ? Cola.order.waLink(((s.whatsapp && s.whatsapp.greeting) || 'Hello Cola Studio') + ' 👋\n') : '';
    return '<section class="end-cta" aria-labelledby="end-cta-title"><div class="container"><div class="end-cta__arch theme-dark pattern-paper" data-header="dark">' +
      '<span class="end-cta__seam" aria-hidden="true"></span>' +
      '<div class="end-cta__body">' + Cola.brand.mono({ cls: 'end-cta__mark' }) +
        '<p class="eyebrow end-cta__eyebrow">Order directly</p>' +
        '<h2 class="end-cta__title" id="end-cta-title"><span class="thin">Found the one?</span><br><b>Let’s make it yours.</b></h2>' +
        '<p class="end-cta__text">Send your order list on WhatsApp — we confirm stock, shipping and your total, usually within a few hours.</p>' +
        '<div class="end-cta__actions">' +
          (wa ? '<a class="btn btn--light btn--wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + Cola.icon('whatsapp', 'btn__icon') + 'Chat with the studio</a>' : '') +
          '<a class="btn btn--ghost" href="' + Cola.url('products') + '">Shop the collection</a>' +
        '</div></div></div></div></section>';
  };

  L.footer = function () {
    var s = Cola.data.settings || {}, so = s.social || {};
    var socials = [['instagram', 'Instagram'], ['weibo', 'Weibo'], ['discord', 'Discord'], ['weidian', 'Weidian'], ['yupoo', 'Yupoo'], ['tiktok', 'TikTok'], ['xiaohongshu', 'Xiaohongshu'], ['whatsappChannel', 'WhatsApp channel']]
      .map(function (x) { return so[x[0]] ? '<li><a href="' + esc(so[x[0]]) + '" target="_blank" rel="noopener">' + x[1] + '</a></li>' : ''; }).join('');
    var col = function (title, links) { return '<div class="footer__col"><h4>' + title + '</h4><ul>' + links.map(function (l) { return '<li><a href="' + Cola.url(l[0]) + '">' + l[1] + '</a></li>'; }).join('') + '</ul></div>'; };
    var year = new Date().getFullYear();
    return '<footer class="site-footer theme-dark pattern-paper" data-header="dark"><div class="tape-edge site-footer__tape" aria-hidden="true"></div><div class="container">' +
      '<div class="footer__top"><div class="footer__brand">' + Cola.brand.lockup() + '<p class="small muted mt-3">International fashion studio — design, production, craftsmanship.</p></div>' +
      col('Shop', [['products', 'All products'], ['live-stock', 'Live stock'], ['updates', 'Studio updates']]) +
      col('Help', [['how-to-order', 'How to order'], ['size-guide', 'Size guide'], ['faq', 'FAQ'], ['contact', 'Contact']]) +
      '<div class="footer__col"><h4>Studio</h4><ul><li><a href="' + Cola.url('about') + '">About</a></li>' + socials + (s.brand && s.brand.email ? '<li><a href="mailto:' + esc(s.brand.email) + '">' + esc(s.brand.email) + '</a></li>' : '') + '</ul></div></div>' +
      '<div class="footer__bottom"><span>© ' + year + ' Cola Studio' + (s.demo ? ' · <button class="link link--quiet" type="button" data-demo-info>Demo catalogue</button>' : '') + '</span>' +
      '<span>Prices charged in CNY</span><a href="' + Cola.url('admin') + '" rel="nofollow">Studio login</a></div>' +
      '</div></footer>';
  };

  // ---------------------------------------------------------------------------
  function bindHeader() {
    var body = document.body, burger = $('[data-burger]'), menu = $('#site-menu');
    burger.addEventListener('click', function () { toggleMenu(!body.classList.contains('menu-open')); });
    function toggleMenu(open) {
      body.classList.toggle('menu-open', open); burger.setAttribute('aria-expanded', open); burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.setAttribute('aria-hidden', !open);
      if (open) { Cola.ui.lock(); body.classList.remove('header-hidden'); } else Cola.ui.unlock();
    }
    L.closeMenu = function () { if (body.classList.contains('menu-open')) toggleMenu(false); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') L.closeMenu(); });
    // currency
    var cur = $('[data-currency]'), btn = $('[data-currency-btn]');
    btn.addEventListener('click', function (e) { e.stopPropagation(); var o = !cur.classList.contains('is-open'); cur.classList.toggle('is-open', o); btn.setAttribute('aria-expanded', o); });
    document.addEventListener('click', function () { cur.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); });
    cur.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cur]'); if (!b) return;
      Cola.money.set(b.getAttribute('data-cur'));
      $('[data-currency-label]').textContent = b.getAttribute('data-cur');
      $$('[data-cur]', cur).forEach(function (x) { x.setAttribute('aria-checked', x === b); });
      Cola.ui.toast('Prices now shown in ' + b.getAttribute('data-cur'), { sub: 'Orders are always charged in CNY.', icon: 'globe' });
    });
  }

  // ---------------------------------------------------------------------------
  // Order list drawer
  // ---------------------------------------------------------------------------
  var bagTab = 'list';
  L.openBag = function (tab) {
    if (tab) bagTab = tab === 'saved' ? 'saved' : 'list';
    L.renderBag();
    L.closeMenu && L.closeMenu();
    $('[data-bag]').classList.add('is-open'); $('[data-bag]').setAttribute('aria-hidden', 'false'); $('[data-overlay]').classList.add('is-open'); Cola.ui.lock();
    setTimeout(function () { var f = $('[data-bag] [data-bag-close]'); if (f) f.focus(); }, 50);
  };
  L.closeBag = function () {
    var d = $('[data-bag]'); if (!d.classList.contains('is-open')) return;
    d.classList.remove('is-open'); d.setAttribute('aria-hidden', 'true'); $('[data-overlay]').classList.remove('is-open'); Cola.ui.unlock();
  };
  var productCache = null;
  function products() { if (!productCache) productCache = Cola.data.products().catch(function () { return []; }); return productCache; }

  L.renderBag = function () {
    var d = $('[data-bag]'); if (!d) return;
    var items = Cola.bag.items(), saved = Cola.bag.saved();
    var head = '<div class="drawer__head"><h2 class="drawer__title">Your <b>order</b></h2><button class="icon-btn" type="button" data-bag-close aria-label="Close order list">' + Cola.icon('close') + '</button></div>' +
      '<div class="drawer__tabs" role="tablist"><button type="button" role="tab" aria-selected="' + (bagTab === 'list') + '" data-bag-tab="list">Order list (' + Cola.bag.count() + ')</button><button type="button" role="tab" aria-selected="' + (bagTab === 'saved') + '" data-bag-tab="saved">Saved (' + saved.length + ')</button></div>';
    if (bagTab === 'list') {
      var bodyHtml = items.length ? items.map(lineItem).join('') : Cola.c.empty('Your order list is empty', 'Add pieces with a size and send them to us in one WhatsApp message.', '<a class="btn btn--sm" href="' + Cola.url('products') + '">Explore the collection</a>');
      var sub = Cola.bag.subtotal(), cur = Cola.money.current();
      d.innerHTML = head + '<div class="drawer__body">' + bodyHtml + '</div>' + (items.length ? '<div class="drawer__foot">' +
        '<div class="summary-row summary-row--total"><span>Subtotal</span><span>' + Cola.c.price(sub) + '</span></div>' +
        (cur !== 'CNY' ? '<div class="summary-row tiny subtle"><span>Charged in store currency</span><span>' + Cola.money.cny(sub) + '</span></div>' : '') +
        '<p class="tiny subtle">Shipping and final availability are confirmed by the studio on WhatsApp.</p>' +
        '<a class="btn btn--block" href="' + Cola.url('order') + '">Review & send order ' + Cola.icon('arrow-right', 'btn__arrow') + '</a>' +
        '<button class="btn btn--ghost btn--block btn--wa" type="button" data-bag-wa>' + Cola.icon('whatsapp', 'btn__icon') + 'Quick send via WhatsApp</button></div>' : '');
    } else {
      d.innerHTML = head + '<div class="drawer__body" data-saved-body>' + (saved.length ? '<p class="small subtle mt-2">Loading…</p>' : Cola.c.empty('Nothing saved yet', 'Tap the heart on any product to keep it here.')) + '</div>';
      if (saved.length) products().then(function (list) {
        var body = d.querySelector('[data-saved-body]'); if (!body) return;
        var map = {}; list.forEach(function (p) { map[p.id] = p; });
        body.innerHTML = saved.map(function (id) { var p = map[id]; if (!p) return ''; var c = p.colors[0]; return '<div class="line-item"><a class="line-item__img" href="' + Cola.productUrl(p) + '" style="--tint:' + Cola.media.tint(Cola.media.colorHex(p, c && c.name)) + '">' + Cola.media.productImage(p) + '</a><div><div class="line-item__top"><div><a class="line-item__name" href="' + Cola.productUrl(p) + '">' + esc(p.name) + '</a><p class="line-item__meta">' + esc(p.subtitle || '') + '</p></div><span class="small">' + Cola.c.price(p.price) + '</span></div><div class="line-item__bottom">' + Cola.stock.html(Cola.stock.product(p)) + '<button class="line-item__remove" type="button" data-unsave="' + esc(p.id) + '">Remove</button></div></div></div>'; }).join('');
        Cola.rewriteLinks(body);
      });
    }
    Cola.rewriteLinks(d);
  };
  function lineItem(it) {
    var sizes = it.sizes && it.sizes.length > 1 ? '<select class="select select--mini" data-line-size="' + esc(it.key) + '" aria-label="Size">' + it.sizes.map(function (s) { return '<option' + (s === it.size ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select>' : '';
    var img = it.image ? '<img src="' + esc(it.image) + '" alt="">' : Cola.media.garment(it.garment, { color: it.colorHex, print: it.print });
    return '<div class="line-item" data-key="' + esc(it.key) + '"><a class="line-item__img" href="' + Cola.url('product', { slug: it.slug }) + '" style="--tint:' + Cola.media.tint(it.colorHex) + '">' + img + '</a><div>' +
      '<div class="line-item__top"><div><a class="line-item__name" href="' + Cola.url('product', { slug: it.slug }) + '">' + esc(it.name) + '</a><p class="line-item__meta">' + esc(it.color) + (it.size && !sizes ? ' · ' + esc(it.size) : '') + (it.preorder ? ' · Pre-order' : '') + '</p></div>' +
      '<span class="small num">' + Cola.c.price(it.price * it.qty) + '</span></div>' +
      '<div class="line-item__bottom"><div class="row" style="--row-gap:8px">' + sizes + '<div class="qty qty--sm"><button type="button" data-line-dec aria-label="Decrease">−</button><input type="number" value="' + it.qty + '" min="1" max="99" aria-label="Quantity" data-line-qty><button type="button" data-line-inc aria-label="Increase">+</button></div></div>' +
      '<button class="line-item__remove" type="button" data-line-remove>Remove</button></div></div></div>';
  }
  function bindBag() {
    var d = $('[data-bag]');
    $$('[data-bag-open]').forEach(function (b) { b.addEventListener('click', function () { L.openBag(); }); });
    $('[data-overlay]').addEventListener('click', L.closeBag);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') L.closeBag(); if (e.key === 'Tab' && d.classList.contains('is-open')) Cola.ui.trap(e, d); });
    d.addEventListener('click', function (e) {
      if (e.target.closest('[data-bag-close]')) return L.closeBag();
      var tab = e.target.closest('[data-bag-tab]'); if (tab) { bagTab = tab.getAttribute('data-bag-tab'); return L.renderBag(); }
      var un = e.target.closest('[data-unsave]'); if (un) { Cola.bag.toggleSave(un.getAttribute('data-unsave')); return L.renderBag(); }
      if (e.target.closest('[data-bag-wa]')) {
        if (!Cola.order.enabled()) return Cola.ui.toast('WhatsApp ordering is not configured yet', { icon: 'info' });
        var items = Cola.bag.items(), ref = Cola.order.ref();
        Cola.order.log(ref, items, {}, 'whatsapp');
        Cola.bag.remember({ ref: ref, at: new Date().toISOString(), items: items, channel: 'whatsapp' });
        Cola.openExternal(Cola.order.waLink(Cola.order.message(items, {}, ref)));
        return;
      }
      var line = e.target.closest('[data-key]'); if (!line) return;
      var key = line.getAttribute('data-key'), it = Cola.bag.items().find(function (i) { return i.key === key; }); if (!it) return;
      if (e.target.closest('[data-line-remove]')) { Cola.bag.remove(key); Cola.ui.toast('Removed from order list', { sub: it.name, icon: 'close', action: { label: 'Undo', fn: function () { var all = Cola.bag.items(); all.push(it); Cola.bag.restore(all); } } }); }
      if (e.target.closest('[data-line-dec]')) Cola.bag.setQty(key, it.qty - 1);
      if (e.target.closest('[data-line-inc]')) Cola.bag.setQty(key, it.qty + 1);
    });
    d.addEventListener('change', function (e) {
      var q = e.target.closest('[data-line-qty]'); var line = e.target.closest('[data-key]');
      if (q && line) Cola.bag.setQty(line.getAttribute('data-key'), q.value);
      var sz = e.target.closest('[data-line-size]');
      if (sz) { var key = sz.getAttribute('data-line-size'); products().then(function (list) { var it = Cola.bag.items().find(function (i) { return i.key === key; }); var p = it && list.find(function (x) { return x.id === it.productId; }); Cola.bag.setSize(key, sz.value, p); }); }
    });
    Cola.on('bag:change', function () { if (d.classList.contains('is-open')) L.renderBag(); updateCount(true); });
    Cola.on('saved:change', function () { if (d.classList.contains('is-open')) L.renderBag(); });
    Cola.on('currency:change', function () { if (d.classList.contains('is-open')) L.renderBag(); });
  }
  function updateCount(bump) {
    var n = Cola.bag.count();
    $$('[data-bag-count]').forEach(function (el) { el.textContent = n || ''; el.setAttribute('data-count', n); if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } });
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  function bindSearch() {
    var s = $('[data-search]'), input = $('[data-search-input]'), results = $('[data-search-results]'), label = $('[data-search-label]');
    $('[data-search-pages]').innerHTML = SEARCH_PAGES.map(function (p) { return '<a href="' + Cola.url(p[0]) + '"><span>' + p[1] + '</span>' + Cola.icon('arrow-up-right') + '</a>'; }).join('');
    function open() { s.classList.add('is-open'); Cola.ui.lock(); L.closeMenu(); setTimeout(function () { input.focus(); }, 60); run(); }
    function close() { if (!s.classList.contains('is-open')) return; s.classList.remove('is-open'); Cola.ui.unlock(); }
    L.openSearch = open;
    $$('[data-search-open]').forEach(function (b) { b.addEventListener('click', open); });
    $('[data-search-close]').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); s.classList.contains('is-open') ? close() : open(); }
      if (e.key === 'Escape') close();
      if (e.key === '/' && !/input|textarea|select/i.test((document.activeElement || {}).tagName || '') && !s.classList.contains('is-open')) { e.preventDefault(); open(); }
    });
    $('[data-search-form]').addEventListener('submit', function (e) { e.preventDefault(); var q = input.value.trim(); location.href = Cola.url('products', { q: q }); });
    var run = Cola.debounce(function () {
      products().then(function (list) {
        var q = input.value.trim().toLowerCase();
        var hits;
        // Page shortcuts follow the query too; the block disappears when none match.
        var shown = 0;
        $$('[data-search-pages] a').forEach(function (a) { var hit = !q || a.textContent.toLowerCase().indexOf(q) >= 0 || a.getAttribute('href').toLowerCase().indexOf(q) >= 0; a.hidden = !hit; if (hit) shown++; });
        $('[data-search-pages]').parentNode.hidden = !shown;
        if (!q) {
          // Featured pieces first, then bestsellers and the newest in-stock pieces — never an empty block.
          var rank = function (p) { return (p.featured ? 4 : 0) + ((p.badges || []).indexOf('bestseller') >= 0 ? 2 : 0) + (Cola.stock.product(p) === 'soldout' ? -3 : 0); };
          hits = list.slice().sort(function (a, b) { return rank(b) - rank(a) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')); }).slice(0, 6);
          label.textContent = 'Popular right now';
        }
        else {
          var terms = q.split(/\s+/);
          hits = list.map(function (p) {
            var hay = [p.name, p.subtitle, p.category, p.collection, (p.tags || []).join(' '), (p.colors || []).map(function (c) { return c.name; }).join(' ')].join(' ').toLowerCase();
            var score = terms.reduce(function (a, t) { return a + (hay.indexOf(t) >= 0 ? 1 : 0) + (p.name.toLowerCase().indexOf(t) >= 0 ? 1 : 0); }, 0);
            return { p: p, score: terms.every(function (t) { return hay.indexOf(t) >= 0; }) ? score : 0 };
          }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; }).map(function (x) { return x.p; }).slice(0, 9);
          label.textContent = hits.length ? hits.length + ' result' + (hits.length === 1 ? '' : 's') + ' for “' + input.value.trim() + '”' : 'No products found for “' + input.value.trim() + '”';
        }
        results.innerHTML = hits.map(function (p, i) { return Cola.c.card(p, { quick: false, reveal: false, index: i }); }).join('');
        Cola.rewriteLinks(results);
        Cola.c.bindCards(results, function (id) { return list.find(function (p) { return p.id === id; }); });
      });
    }, 120);
    input.addEventListener('input', run);
  }

  L.demoInfo = function () {
    Cola.ui.modal({ label: 'About this demo', width: '560px', html: '<div class="modal__head"><p class="label"><span class="demo-flag">Demo catalogue</span></p><h2 class="h3 mt-2">Placeholder products, <b>real</b> website.</h2></div>' +
      '<div class="modal__body"><p class="muted small">Everything you see works — filters, live stock, the order list, WhatsApp messages and agent buttons — but the products, prices, stock levels and studio updates are <b>fictional demonstration data</b>. Product visuals are technical illustrations generated by the site until real photography is uploaded.</p>' +
      '<p class="muted small mt-2">The final catalogue is managed in the studio admin panel and synchronised with Weidian.</p></div>' });
  };

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  Cola.boot = function (init, opts) {
    opts = opts || {};
    var preload = Cola.ui.preloader();
    Cola.ui.hashLinks();
    Cola.rewriteLinks(document);
    return Cola.data.site().catch(function (err) {
      console.error('[Cola] could not load site settings', err);
      Cola.data.settings = Cola.data.settings || { currency: { rates: { CNY: 1 }, default: 'CNY', available: ['CNY'] } };
    }).then(function () {
      L.render();
      Cola.ui.transitions();
      Cola.ui.scrollState();
      Cola.ui.tooltips();
      Cola.ui.cursor();
      return Promise.resolve(init ? init() : null).catch(function (err) { console.error('[Cola] page init failed', err); });
    }).then(function () {
      return preload;
    }).then(function () {
      document.body.classList.add('is-ready');
      Cola.ui.enhance(document);
      Cola.ui.parallax();
      if (Cola.ui.refreshDarkSections) Cola.ui.refreshDarkSections();
      Cola.emit('ready');
    });
  };
})();
