/* COLA STUDIO — Home (calm): hero, selected pieces, how to order, studio updates */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, esc = Cola.esc;

  Cola.boot(function () {
    var s = Cola.data.settings || {};
    drop(s);
    heroArt();
    return Promise.all([Cola.data.products(), Cola.data.updates({ limit: 3 }).catch(function () { return { updates: [] }; })])
      .then(function (r) {
        var products = r[0], ups = r[1];
        var hero = featuredList(products).slice(0, 4);
        heroFeatured(hero);
        newIn(products.filter(function (p) { return hero.indexOf(p) < 0; }), products);
        updates(ups.updates || []);
      });
  });

  function featuredList(products) {
    var list = products.filter(function (p) { return p.featured; });
    if (list.length < 4) list = list.concat(products.filter(function (p) { return !p.featured; }));
    return list;
  }
  var ts = function (p) { return Date.parse(p.createdAt || p.updatedAt || 0) || 0; };

  // ---------------------------------------------------------------- hero (the monogram stays; products sit in the strip below)
  function heroArt() {
    var host = $('[data-hero-art]'); if (!host) return;
    host.innerHTML = Cola.brand.mono({ cls: 'hero__mark' });
  }
  function heroFeatured(list) {
    var host = $('[data-hero-feat]'); if (!host) return;
    host.innerHTML = list.map(function (p, i) {
      var color = ((p.colors || [])[0] || {}).name;
      return '<a class="hfeat" href="' + Cola.productUrl(p) + '" data-reveal style="--d:' + (0.08 + i * 0.06).toFixed(2) + 's">' +
        '<span class="hfeat__img" style="--tint:' + Cola.media.tint(Cola.media.colorHex(p, color)) + '">' + Cola.media.productImage(p, { color: color }) + '</span>' +
        '<span class="hfeat__txt"><span class="hfeat__name">' + esc(p.name) + '</span><span class="hfeat__price">' + Cola.c.price(p.price) + '</span></span></a>';
    }).join('');
    Cola.ui.enhance(host);
  }

  // ---------------------------------------------------------------- new in (everything not already featured above, newest first)
  function newIn(list, products) {
    var host = $('[data-featured]'), wrap = $('[data-newin-wrap]'); if (!host) return;
    list = list.slice().sort(function (a, b) { return ts(b) - ts(a); }).slice(0, 8);
    if (!list.length) { if (wrap) wrap.hidden = true; return; }
    host.innerHTML = list.map(function (p, i) { return Cola.c.card(p, { index: i }); }).join('');
    Cola.c.bindCards(host, function (id) { return products.find(function (p) { return p.id === id; }); });
  }

  // ---------------------------------------------------------------- drop (one quiet line)
  function drop(s) {
    var d = s.nextDrop, el = $('[data-drop]');
    if (!el || !d || !d.enabled || !d.date || new Date(d.date) < new Date()) return;
    var date = new Date(d.date);
    el.hidden = false;
    el.innerHTML = '<span class="label">Next drop</span><span class="drop-strip__title">' + esc(d.title) + '</span>' +
      '<span class="drop-strip__date">' + Cola.fmtDate(date) + '</span><span class="drop-strip__count" data-drop-count></span>';
    Cola.ui.countdown($('[data-drop-count]', el), d.date, true);
  }

  // ---------------------------------------------------------------- featured
  function featured(list, products) {
    var host = $('[data-featured]'); if (!host) return;
    host.innerHTML = list.map(function (p, i) { return Cola.c.card(p, { index: i }); }).join('');
    Cola.c.bindCards(host, function (id) { return products.find(function (p) { return p.id === id; }); });
  }

  // ---------------------------------------------------------------- updates
  function updates(list) {
    var host = $('[data-update-cards]'); if (!host) return;
    if (!list.length) { host.innerHTML = '<p class="muted">No updates yet.</p>'; return; }
    host.innerHTML = list.slice(0, 3).map(function (u, i) { return Cola.c.updateCard(u, { index: i }); }).join('');
    Cola.ui.enhance(host);
  }
})();
