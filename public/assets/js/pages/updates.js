/* COLA STUDIO — Studio updates (Weibo, translated) */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var PAGE = 9, cat = 'all', lang = Cola.store.get('cola.lang', 'en') === 'zh' ? 'zh' : 'en', loaded = [], total = 0;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function postIdFromUrl() {
    var q = Cola.param('post'); if (q) return q;
    var m = location.pathname.match(/\/updates\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  Cola.boot(function () {
    setLang(lang);
    $('[data-lang]').addEventListener('click', function (e) { var b = e.target.closest('[data-l]'); if (b) setLang(b.getAttribute('data-l')); });
    bindTimeline();
    var single = postIdFromUrl();
    if (single) return loadSingle(single);
    bind();
    return load(true).then(function () {
      if (location.hash) {
        var el = document.getElementById(location.hash.slice(1));
        if (el) setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('is-target'); }, 400);
      }
    });
  });

  function load(reset) {
    if (reset) { loaded = []; }
    var before = loaded.length ? loaded[loaded.length - 1].id : null;
    return Cola.data.updates({ limit: PAGE, category: cat === 'all' ? '' : cat, before: before }).then(function (r) {
      var list = r.updates || [];
      total = r.total || list.length;
      loaded = loaded.concat(list);
      render(reset);
      $('[data-more]').hidden = loaded.length >= total || !list.length;
    });
  }

  function render(reset) {
    var host = $('[data-timeline]');
    if (!loaded.length) { host.innerHTML = '<div class="ugrid__empty">' + Cola.c.empty('No updates in this category yet', 'New posts appear here automatically once they are published on Weibo.') + '</div>'; return; }
    host.innerHTML = loaded.map(function (u, i) { return Cola.c.updateCard(u, { index: i }); }).join('');
    Cola.ui.enhance(host);
  }

  // ------------------------------------------------------------ one post (/updates/<id>)
  function loadSingle(id) {
    var tabs = $('[data-u-tabs]'); if (tabs) tabs.hidden = true;
    return Cola.data.update(id).then(function (r) {
      var u = r && r.update;
      var host = $('[data-timeline]'), more = $('[data-u-more]');
      host.className = 'timeline is-single';
      if (!u) {
        host.innerHTML = '<div>' + Cola.c.empty('This update could not be found', 'It may have been removed by the studio.', '<a class="btn btn--sm" href="' + Cola.url('updates') + '">All studio updates</a>') + '</div>';
        if (more) more.innerHTML = '';
        return;
      }
      loaded = [u];
      var title = u.title || 'Studio update';
      if (!Cola.isServer) document.title = title + ' — Studio Updates | ' + ((Cola.data.settings && Cola.data.settings.brand && Cola.data.settings.brand.name) || 'Cola Studio');
      var pt = Cola.c.postTitle(u);
      var t = $('[data-u-title]'); if (t) t.innerHTML = (pt.kicker ? '<span class="post-kicker">' + esc(pt.kicker) + '</span>' : '') + '<span class="post-title">' + esc(pt.title) + '</span>';
      var c = $('[data-u-crumbs]'); if (c) c.innerHTML = '<a href="' + Cola.url('home') + '">Home</a><span aria-hidden="true">/</span><a href="' + Cola.url('updates') + '">Studio updates</a><span aria-hidden="true">/</span><span>' + esc(title.length > 60 ? title.slice(0, 57) + '…' : title) + '</span>';
      var d = new Date(u.publishedAt);
      var l = $('[data-u-lead]'); if (l) l.innerHTML = '<time datetime="' + esc(u.publishedAt) + '">' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + '</time> · ' + (u.source === 'weibo' ? 'From the studio’s Weibo, translated into English.' : 'From the studio.');
      host.innerHTML = post(u, { single: true });
      Cola.ui.enhance(host);
      if (more) {
        more.innerHTML = '<nav class="post-nav" aria-label="More updates">' +
          (r.newer ? '<a class="post-nav__link" href="' + Cola.updateUrl(r.newer) + '" rel="prev"><span class="tiny subtle">Newer</span><span>' + esc(r.newer.title || 'Studio update') + '</span></a>' : '<span></span>') +
          '<a class="btn btn--ghost" href="' + Cola.url('updates') + '">All studio updates</a>' +
          (r.older ? '<a class="post-nav__link post-nav__link--older" href="' + Cola.updateUrl(r.older) + '" rel="next"><span class="tiny subtle">Older</span><span>' + esc(r.older.title || 'Studio update') + '</span></a>' : '<span></span>') +
          '</nav>';
      }
    });
  }

  function post(u, opts) {
    opts = opts || {};
    var d = new Date(u.publishedAt);
    var media = (u.media || []).filter(function (m) { return m && (m.type !== 'image' || m.url); });
    var isWeibo = u.source === 'weibo';
    // Demo posts have made-up ids: send people to the real account instead of a dead status link.
    var srcUrl = u.url && u.demo ? ((Cola.data.settings && Cola.data.settings.social && Cola.data.settings.social.weibo) || '') : u.url;
    var tr = u.translation || {};
    return '<div class="tl-item' + (u.pinned ? ' is-pinned' : '') + '" id="' + esc(u.id) + '" data-reveal>' +
      '<div class="tl-date"><span class="tl-date__day">' + String(d.getDate()).padStart(2, '0') + '</span><span class="tl-date__mon">' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear() + '</span></div>' +
      '<article class="tl-card">' +
        '<header class="tl-card__head"><div class="row row--wrap" style="--row-gap:12px">' + (u.pinned ? '<span class="badge badge--dark">Pinned</span>' : '') + '<span class="cat-chip cat-' + esc(u.category) + '">' + esc(u.category || 'update') + '</span></div></header>' +
        (opts.single ? '' : '<h2 class="tl-card__title"><a href="' + Cola.updateUrl(u) + '">' + esc(u.title || 'Studio update') + '</a></h2>') +
        '<div class="tl-text' + (!opts.single && (u.textEnglish || u.textOriginal || '').length > 260 ? ' is-clamped' : '') + '">' +
          '<div class="tl-en"><p>' + esc(u.textEnglish || u.textOriginal || '').replace(/\n+/g, '</p><p>') + '</p></div>' +
          (u.textOriginal && isWeibo ? '<div class="tl-zh zh"><span class="tl-zh__lbl">原文 · Original</span><p>' + esc(u.textOriginal).replace(/\n+/g, '</p><p>') + '</p></div>' : '') +
        '</div>' +
        (!opts.single && (u.textEnglish || u.textOriginal || '').length > 260 ? '<button class="link link--quiet small tl-more" type="button" data-more-text>Read more</button>' : '') +
        (media.length ? '<div class="tl-media" style="--m:' + Math.min(media.length, 3) + '">' + media.slice(0, opts.single ? 9 : 3).map(function (m, i) { return '<button type="button" class="tl-media__item' + (m.type === 'pattern' ? ' is-pattern' : '') + '" style="--bg-m:' + Cola.media.updateMediaBg(m) + '" data-media="' + esc(u.id) + '|' + i + '" aria-label="Open image ' + (i + 1) + '">' + Cola.media.updateMedia(m) + '</button>'; }).join('') + '</div>' : '') +
        (u.video && u.video.url ? '<div class="tl-video"><video src="' + esc(u.video.url) + '"' + (u.video.poster ? ' poster="' + esc(u.video.poster) + '"' : '') + ' controls playsinline preload="none"></video></div>' : '') +
        '<footer class="tl-card__foot">' +
          '<span class="tiny subtle">' + (isWeibo ? 'Translated from Chinese' + (tr.edited ? ' · edited by the studio' : '') : 'From the studio') + '</span>' +
          (srcUrl ? '<a class="link link--quiet tiny" href="' + esc(srcUrl) + '" target="_blank" rel="noopener">View on Weibo ' + Cola.icon('arrow-up-right') + '</a>' : '') + '</footer>' +
      '</article></div>';
  }

  function setLang(l) {
    lang = l; Cola.store.set('cola.lang', l);
    document.body.setAttribute('data-lang', l);
    $$('[data-l]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-l') === l); });
  }

  function bind() {
    $('[data-u-tabs]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-uc]'); if (!b) return;
      cat = b.getAttribute('data-uc');
      $$('[data-uc]').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      load(true);
    });
    $('[data-more]').addEventListener('click', function (e) { var b = e.currentTarget; b.classList.add('is-loading'); load(false).then(function () { b.classList.remove('is-loading'); }); });
  }

  function bindTimeline() {
    $('[data-timeline]').addEventListener('click', function (e) {
      var m = e.target.closest('[data-media]');
      if (m) {
        var parts = m.getAttribute('data-media').split('|'), u = loaded.find(function (x) { return x.id === parts[0]; });
        var items = (u.media || []).map(function (md, i) { return { html: Cola.media.updateMedia(md), bg: Cola.media.updateMediaBg(md), caption: u.title + ' — ' + (i + 1) + '/' + u.media.length }; });
        Cola.ui.lightbox(items, +parts[1]); return;
      }
      var mt = e.target.closest('[data-more-text]');
      if (mt) { var t = mt.previousElementSibling; var open = t.classList.toggle('is-clamped') === false; mt.textContent = open ? 'Show less' : 'Read more'; return; }
      var c = e.target.closest('[data-copy]');
      if (c) { var url = location.href.split('#')[0] + '#' + c.getAttribute('data-copy'); Cola.copy(url).then(function () { Cola.ui.toast('Link copied', { icon: 'copy' }); }); }
    });
  }
})();
