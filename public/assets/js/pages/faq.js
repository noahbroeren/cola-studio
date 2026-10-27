/* COLA STUDIO — FAQ (questions live in public/data/faq.json — the server also renders them into the page and Google's FAQ data) */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var FAQ = [];

  function loadFaq() {
    return fetch((Cola.isServer ? '/' : '') + 'data/faq.json', { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { FAQ = (d.topics || []).map(function (c) { return { id: c.id, title: c.title, items: (c.items || []).map(function (q) { return [q.q, q.a]; }) }; }); });
  }

  Cola.boot(function () { return loadFaq().then(render, function () { /* keep the server-rendered questions */ bindSearch(); }); });

  function render() {
    var nav = $('[data-faq-nav]'), list = $('[data-faq-list]');
    nav.innerHTML = FAQ.map(function (c, i) { return '<a href="#' + c.id + '" data-faq-link="' + c.id + '"' + (i ? '' : ' class="is-on"') + '><span class="index">0' + (i + 1) + '</span>' + c.title + '</a>'; }).join('');
    list.innerHTML = FAQ.map(function (c, i) {
      return '<section class="faq-cat" id="' + c.id + '" data-faq-cat><h2 class="h3"><span class="index">0' + (i + 1) + '</span> ' + c.title + '</h2><div class="acc mt-3" data-acc>' + c.items.map(function (q) {
        return '<div class="acc__item" data-q="' + esc((q[0] + ' ' + q[1]).toLowerCase()) + '"><button class="acc__btn" type="button"><span>' + esc(q[0]) + '</span><span class="acc__plus" aria-hidden="true"></span></button><div class="acc__panel"><div><div class="acc__content">' + esc(q[1]) + '</div></div></div></div>';
      }).join('') + '</div></section>';
    }).join('');
    $('[data-faq-count]').textContent = FAQ.reduce(function (a, c) { return a + c.items.length; }, 0) + ' questions in ' + FAQ.length + ' topics';
    Cola.ui.accordion(list);
    bindSearch();
  }

  function bindSearch() {
    var total = $$('[data-q]').length, topics = $$('[data-faq-cat]').length;
    $('[data-faq-q]').addEventListener('input', Cola.debounce(function (e) {
      var q = e.target.value.trim().toLowerCase(), n = 0;
      $$('[data-q]').forEach(function (it) { var hit = !q || q.split(/\s+/).every(function (t) { return it.getAttribute('data-q').indexOf(t) >= 0; }); it.hidden = !hit; if (hit) n++; if (q && hit) it.classList.add('is-open'); if (!q) it.classList.remove('is-open'); });
      $$('[data-faq-cat]').forEach(function (c) { c.hidden = !$$('[data-q]:not([hidden])', c).length; });
      $('[data-faq-count]').textContent = q ? n + ' matching question' + (n === 1 ? '' : 's') : total + ' questions in ' + topics + ' topics';
    }, 120));
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) { en.forEach(function (e) { if (e.isIntersecting) $$('[data-faq-link]').forEach(function (a) { a.classList.toggle('is-on', a.getAttribute('data-faq-link') === e.target.id); }); }); }, { rootMargin: '-30% 0px -60% 0px' });
      $$('[data-faq-cat]').forEach(function (c) { io.observe(c); });
    }
  }
})();
