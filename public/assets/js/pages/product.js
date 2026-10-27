/* COLA STUDIO — Product detail page */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var P = null, state = null, ALL = [];

  function slugFromUrl() {
    var q = Cola.param('slug'); if (q) return q;
    var m = location.pathname.match(/\/products\/([^/?#]+)/); return m ? decodeURIComponent(m[1]) : '';
  }

  Cola.boot(function () {
    var slug = slugFromUrl();
    return Promise.all([Cola.data.product(slug), Cola.data.products(), Cola.data.inventory().catch(function () { return null; })]).then(function (r) {
      var res = r[0]; ALL = Cola.data.withStock(r[1], r[2]);
      if (!res || !res.product) return notFound();
      P = Cola.data.withStock([res.product], r[2])[0];
      var color = Cola.param('color');
      if (!color || !P.colors.some(function (c) { return c.name === color; })) {
        var firstAvail = P.colors.find(function (c) { var s = Cola.stock.product(P, c.name); return s !== 'soldout' && s !== 'restocking'; });
        color = (firstAvail || P.colors[0]).name;
      }
      state = { color: color, size: P.sizes.length === 1 ? P.sizes[0] : null, qty: 1 };
      Cola.bag.pushRecent(P.id);
      if (!Cola.isServer) document.title = P.name + ' | ' + ((Cola.data.settings && Cola.data.settings.brand && Cola.data.settings.brand.name) || 'Cola Studio');
      crumbs(); gallery(); info(); related(res.related || []); stickyCta();
    });
  });

  function notFound() {
    $('[data-pdp]').innerHTML = '<section class="container section">' + Cola.c.empty('This piece could not be found', 'It may have been renamed or archived.', '<a class="btn btn--sm" href="' + Cola.url('products') + '">Back to the collection</a>') + '</section>';
  }
  function crumbs() {
    var cat = (Cola.data.categories || []).find(function (c) { return c.id === P.category; });
    $('[data-pdp-crumbs]').innerHTML = '<a href="' + Cola.url('home') + '">Home</a><span aria-hidden="true">/</span><a href="' + Cola.url('products') + '">Shop</a>' +
      (cat ? '<span aria-hidden="true">/</span><a href="' + Cola.url('products', { category: cat.id }) + '">' + esc(cat.name) + '</a>' : '') + '<span aria-hidden="true">/</span><span>' + esc(P.name) + '</span>';
  }

  // ------------------------------------------------------------------ gallery
  var items = [];
  function gallery() {
    items = Cola.media.gallery(P, state.color);
    var host = $('[data-gallery]');
    host.innerHTML = '<div class="gal" data-gal>' + items.map(function (it, i) {
      return '<figure class="gal__item gal__item--' + it.kind + (i === 0 ? ' gal__item--lead' : '') + '" style="--bg:' + it.bg + '" data-gal-i="' + i + '"><div class="gal__frame">' + it.html + '</div></figure>';
    }).join('') + '</div><div class="gal__dots" data-gal-dots>' + items.map(function (_, i) { return '<span' + (i ? '' : ' class="is-on"') + '></span>'; }).join('') + '</div>' +
      (Cola.c.isDemo(P) && !Cola.media.hasPhotos(P) ? '<p class="gal__demo tiny subtle">Demo product — illustration until real photos are added.</p>' : '');
    host.querySelector('[data-gal]').addEventListener('click', function (e) {
      var f = e.target.closest('[data-gal-i]'); if (!f) return;
      Cola.ui.lightbox(items, +f.getAttribute('data-gal-i'));
    });
    var gal = host.querySelector('[data-gal]'), dots = $$('[data-gal-dots] span', host);
    gal.addEventListener('scroll', Cola.throttle(function () {
      var i = Math.round(gal.scrollLeft / gal.clientWidth);
      dots.forEach(function (d, j) { d.classList.toggle('is-on', j === i); });
    }, 80), { passive: true });
  }

  // ------------------------------------------------------------------ info
  function info() {
    var host = $('[data-info]');
    var words = P.name.split(' '), last = words.pop();
    var name = (words.length ? esc(words.join(' ')) + ' ' : '') + '<b>' + esc(last) + '</b>';
    host.innerHTML =
      '<div class="pdp__head"><div class="pdp__badges">' + Cola.c.badges(P, Cola.stock.product(P), 1) + '</div></div>' +
      '<h1 class="h2 pdp__name">' + name + '</h1>' +
      '<p class="pdp__sub">' + esc(P.subtitle || '') + '</p>' +
      '<div class="pdp__price"><span class="pdp__price-main">' + Cola.c.price(P.price, P.compareAt) + '</span>' +
        '<span class="tiny subtle" data-cny-note>' + cnyNote() + '</span></div>' +
      Cola.c.buyPanel(P, state) +
      '<div class="acc pdp__acc" data-acc>' +
        acc('Description', '<p>' + esc(P.description || '').replace(/\n+/g, '</p><p>') + '</p>', true) +
        acc('Details & care', '<ul class="bullets">' + (P.details || []).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' + (P.materials ? '<p class="mt-2"><b>' + esc(P.materials) + '</b></p>' : '') + '<ul class="bullets mt-1">' + (P.care || []).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>') +
        acc('Size & fit', (P.fit ? '<p>' + esc(P.fit) + '</p>' : '') +
          (P.sizeChartImage ? '<button type="button" class="pdp-chart" data-chart aria-label="Enlarge the size chart"><img src="' + esc(P.sizeChartImage) + '" alt="Size chart — ' + esc(P.name) + '" loading="lazy" decoding="async"></button>' : '') + (P.measurements ? '<div class="row row--between mt-2 mb-1"><span class="tiny subtle">Garment measurements</span><div class="segmented" data-units><button type="button" aria-pressed="true" data-unit="cm">cm</button><button type="button" aria-pressed="false" data-unit="in">inch</button></div></div><div data-mtable>' + Cola.c.sizeTable(P.measurements, 'cm') + '</div>' : '') + '<a class="link small mt-2" href="' + Cola.url('size-guide') + '">Full size guide & fit finder ' + Cola.icon('arrow-right') + '</a>') +
        (detailImgs().length ? acc('Detail photos <span class="tiny subtle">' + detailImgs().length + '</span>', '<div class="pdp-detail">' + detailImgs().map(function (d, i) { return '<button type="button" class="pdp-detail__img" data-detail="' + i + '" aria-label="Enlarge detail photo ' + (i + 1) + '"><img src="' + esc(d.url) + '" alt="' + esc(P.name) + ' — detail ' + (i + 1) + '" loading="lazy" decoding="async"></button>'; }).join('') + '</div>') : '') +
        acc('Shipping & ordering', '<p>' + esc(P.leadTime || 'Ships in 3–5 working days') + '. Orders are confirmed on WhatsApp or placed through your agent.</p><a class="link small mt-2" href="' + Cola.url('how-to-order') + '">How ordering works ' + Cola.icon('arrow-right') + '</a>') +
      '</div>' +
      '<div class="pdp__share"><button class="link link--quiet tiny" type="button" data-share>' + Cola.icon('share') + 'Share</button><span class="tiny subtle">SKU ' + esc(skuNow()) + '</span></div>';
    Cola.ui.accordion(host);
    Cola.c.bindBuy(host, P, state, onChange);
    host.addEventListener('click', function (e) {
      var u = e.target.closest('[data-unit]');
      if (u) { $$('[data-unit]', host).forEach(function (x) { x.setAttribute('aria-pressed', x === u); }); $('[data-mtable]', host).innerHTML = Cola.c.sizeTable(P.measurements, u.getAttribute('data-unit')); }
      if (e.target.closest('[data-share]')) share();
      var ch = e.target.closest('[data-chart]');
      if (ch) Cola.ui.lightbox([{ html: '<img src="' + esc(P.sizeChartImage) + '" alt="Size chart">', caption: 'Size chart — ' + P.name, kind: 'photo', bg: '#fff' }], 0);
      var dt = e.target.closest('[data-detail]');
      if (dt) Cola.ui.lightbox(detailImgs().map(function (d, i, all) { return { html: '<img src="' + esc(d.url) + '" alt="">', caption: P.name + ' — detail ' + (i + 1) + '/' + all.length, kind: 'photo', bg: '#fff' }; }), +dt.getAttribute('data-detail'));
    });
    Cola.rewriteLinks(host);
  }
  function detailImgs() { return (P.detailImages || []).filter(function (d) { return d && d.url && d.url !== P.sizeChartImage; }); }
  function acc(title, body, open) {
    return '<div class="acc__item' + (open ? ' is-open' : '') + '"><button class="acc__btn" type="button"><span>' + title + '</span><span class="acc__plus" aria-hidden="true"></span></button><div class="acc__panel"><div><div class="acc__content">' + body + '</div></div></div></div>';
  }
  function cnyNote() { return Cola.money.current() === 'CNY' ? 'Store price' : 'Charged as ' + Cola.money.cny(P.price) + ' · converted at today\'s rate'; }
  function skuNow() { var v = state.size ? Cola.stock.find(P, state.color, state.size) : null; return v ? v.sku : Cola.c.code(P); }
  Cola.on('currency:change', function () { var n = $('[data-cny-note]'); if (n && P) n.textContent = cnyNote(); });

  var lastColor = null;
  function onChange() {
    if (state.color !== lastColor) {
      lastColor = state.color; gallery();
      var url = new URL(location.href); if (state.color !== P.colors[0].name) url.searchParams.set('color', state.color); else url.searchParams.delete('color');
      history.replaceState(null, '', url.pathname + url.search);
    }
    var sku = $('.pdp__share .tiny.subtle'); if (sku) sku.textContent = 'SKU ' + skuNow();
    updateSticky();
  }

  function share() {
    var url = location.href;
    if (navigator.share) navigator.share({ title: P.name + ' — Cola Studio', url: url }).catch(function () {});
    else Cola.copy(url).then(function () { Cola.ui.toast('Link copied', { icon: 'copy' }); });
  }

  // ------------------------------------------------------------------ related
  function related(list) {
    if (!list.length) list = ALL.filter(function (p) { return p.id !== P.id && p.category === P.category; });
    if (list.length < 4) list = list.concat(ALL.filter(function (p) { return p.id !== P.id && list.indexOf(p) < 0 && p.featured; })).slice(0, 8);
    list = list.map(function (p) { return ALL.find(function (x) { return x.id === p.id; }) || p; }).slice(0, 4);
    var wrap = $('[data-related-wrap]'); wrap.hidden = false;
    $('[data-related-link]').setAttribute('href', Cola.url('products', { category: P.category }));
    var host = $('[data-related]');
    host.innerHTML = list.map(function (p, i) { return Cola.c.card(p, { index: i }); }).join('');
    Cola.c.bindCards(host, function (id) { return ALL.find(function (p) { return p.id === id; }); });
  }
  // ------------------------------------------------------------------ sticky mobile CTA
  function stickyCta() {
    var el = $('[data-sticky-cta]');
    el.innerHTML = '<div class="sticky-cta__img" style="--tint:' + Cola.media.tint(Cola.media.colorHex(P, state.color)) + '" data-sticky-img>' + Cola.media.productImage(P, { color: state.color }) + '</div>' +
      '<div class="sticky-cta__txt"><b>' + esc(P.name) + '</b><span data-sticky-meta></span></div><button class="btn btn--sm" type="button" data-sticky-add>Add</button>';
    updateSticky();
    el.querySelector('[data-sticky-add]').addEventListener('click', function () {
      if (!state.size && P.sizes.length > 1) { $('[data-buy]').scrollIntoView({ behavior: 'smooth', block: 'center' }); Cola.ui.toast('Choose a size first', { icon: 'ruler' }); return; }
      $('[data-buy-add]').click();
    });
    var buy = $('[data-buy-add]');
    if ('IntersectionObserver' in window) new IntersectionObserver(function (en) {
      var show = !en[0].isIntersecting && en[0].boundingClientRect.top < 0;
      el.classList.toggle('is-on', show); el.setAttribute('aria-hidden', !show); document.body.classList.toggle('has-sticky-cta', show);
    }).observe(buy);
  }
  function updateSticky() {
    var m = $('[data-sticky-meta]'); if (!m) return;
    m.innerHTML = esc(state.color) + (state.size ? ' · ' + esc(state.size) : '') + ' · ' + Cola.c.price(P.price);
    var img = $('[data-sticky-img]'); if (img) { img.style.setProperty('--tint', Cola.media.tint(Cola.media.colorHex(P, state.color))); img.innerHTML = Cola.media.productImage(P, { color: state.color }); }
  }
})();
