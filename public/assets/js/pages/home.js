/* COLA STUDIO — Home (calm): hero, selected pieces, how to order, studio updates */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, esc = Cola.esc;

  Cola.boot(function () {
    var s = Cola.data.settings || {};
    drop(s);
    return Promise.all([Cola.data.products(), Cola.data.updates({ limit: 3 }).catch(function () { return { updates: [] }; })])
      .then(function (r) {
        var products = r[0], ups = r[1];
        var picks = featuredList(products);
        heroArt(picks[0]);
        featured(picks, products);
        updates(ups.updates || []);
      });
  });

  function featuredList(products) {
    var list = products.filter(function (p) { return p.featured; });
    if (list.length < 4) list = list.concat(products.filter(function (p) { return !p.featured; }));
    return list.slice(0, 8);
  }

  // ---------------------------------------------------------------- hero
  function heroArt(p) {
    var host = $('[data-hero-art]'); if (!host) return;
    if (!p) { host.innerHTML = Cola.brand.mono({ cls: 'hero__mark' }); return; }
    var color = ((p.colors || [])[0] || {}).name;
    host.setAttribute('href', Cola.productUrl(p));
    host.setAttribute('aria-label', p.name);
    host.style.setProperty('--tint', Cola.media.tint(Cola.media.colorHex(p, color)));
    host.innerHTML = '<div class="hero__img">' + Cola.media.productImage(p, { color: color }) + '</div>' +
      '<span class="hero__caption"><span>' + esc(p.name) + '</span><span>' + Cola.c.price(p.price) + '</span></span>';
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
    host.innerHTML = list.slice(0, 3).map(ucard).join('');
  }
  function ucard(u, i) {
    var m = (u.media || [])[0];
    return '<article class="ucard" data-reveal style="--d:' + (i * 0.06) + 's">' +
      (m ? '<div class="ucard__media" style="--m:1"><div style="--bg-m:' + Cola.media.updateMediaBg(m) + '">' + Cola.media.updateMedia(m) + '</div></div>' : '') +
      '<div class="ucard__body"><time class="tiny subtle" datetime="' + esc(u.publishedAt) + '">' + Cola.timeAgo(u.publishedAt) + '</time>' +
      '<h3 class="ucard__title"><a href="' + Cola.updateUrl(u) + '">' + esc(u.title) + '</a></h3>' +
      '<p class="ucard__text">' + esc(u.textEnglish || u.textOriginal || '') + '</p></div></article>';
  }
})();
