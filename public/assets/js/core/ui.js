/* ==========================================================================
   COLA STUDIO — core/ui.js
   Interaction: subtle reveals, counters, marquee, toasts, modals,
   lightbox, accordions, tooltips, countdowns.
   ========================================================================== */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var ui = (Cola.ui = {});

  // ---------------------------------------------------------------------------
  // Scroll lock (ref-counted)
  // ---------------------------------------------------------------------------
  var locks = 0;
  ui.lock = function () { if (locks++ === 0) { document.body.style.paddingRight = (window.innerWidth - document.documentElement.clientWidth) + 'px'; document.body.classList.add('is-locked'); } };
  ui.unlock = function () { if (locks > 0 && --locks === 0) { document.body.classList.remove('is-locked'); document.body.style.paddingRight = ''; } };

  // ---------------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------------
  ui.toast = function (msg, o) {
    o = o || {};
    var host = $('.toasts');
    if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
    var t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = '<span class="toast__icon">' + Cola.icon(o.icon || 'check') + '</span><div class="toast__body">' + esc(msg) + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</div>' +
      (o.action ? '<button class="toast__action" type="button">' + esc(o.action.label) + '</button>' : '');
    host.appendChild(t);
    if (o.action) t.querySelector('.toast__action').addEventListener('click', function () { o.action.fn(); close(); });
    var timer = setTimeout(close, o.timeout || 4200);
    function close() { clearTimeout(timer); t.classList.add('is-leaving'); setTimeout(function () { t.remove(); }, 420); }
    while (host.children.length > 3) host.firstChild.remove();
    return close;
  };

  // ---------------------------------------------------------------------------
  // Modal (generic)
  // ---------------------------------------------------------------------------
  ui.modal = function (o) {
    o = o || {};
    var prev = document.activeElement;
    var m = document.createElement('div');
    m.className = 'modal ' + (o.cls || '');
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    if (o.label) m.setAttribute('aria-label', o.label);
    if (o.width) m.style.setProperty('--modal-w', o.width);
    m.innerHTML = '<div class="modal__backdrop" data-close></div><div class="modal__panel">' +
      '<button class="icon-btn modal__close" type="button" data-close aria-label="Close">' + Cola.icon('close') + '</button>' + (o.html || '') + '</div>';
    document.body.appendChild(m);
    ui.lock();
    requestAnimationFrame(function () { requestAnimationFrame(function () { m.classList.add('is-open'); var f = o.focus ? m.querySelector(o.focus) : m.querySelector('.modal__panel [autofocus]'); if (!f) { f = m.querySelector('.modal__panel'); f.setAttribute('tabindex', '-1'); } f.focus({ preventScroll: true }); }); });
    function onKey(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') trap(e, m);
    }
    function close() {
      if (!m.isConnected) return;
      m.classList.remove('is-open'); document.removeEventListener('keydown', onKey);
      setTimeout(function () { m.remove(); ui.unlock(); if (prev && prev.focus) prev.focus({ preventScroll: true }); if (o.onClose) o.onClose(); }, 450);
    }
    m.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    Cola.rewriteLinks(m);
    var ctl = { el: m, panel: m.querySelector('.modal__panel'), close: close };
    if (o.onOpen) o.onOpen(ctl);
    return ctl;
  };
  function trap(e, root) {
    var f = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', root).filter(function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  ui.trap = trap;

  // ---------------------------------------------------------------------------
  // Lightbox — items: [{ html, caption, bg }]
  // ---------------------------------------------------------------------------
  ui.lightbox = function (items, start) {
    var i = start || 0;
    var lb = document.createElement('div'); lb.className = 'lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Image viewer');
    lb.innerHTML = '<div class="lightbox__bar"><span class="lb-count num"></span><button class="icon-btn" type="button" data-close aria-label="Close">' + Cola.icon('close') + '</button></div>' +
      '<div class="lightbox__stage"><div class="lb-media"></div>' +
      (items.length > 1 ? '<button class="icon-btn lightbox__nav lightbox__nav--prev" type="button" aria-label="Previous">' + Cola.icon('arrow-left') + '</button><button class="icon-btn lightbox__nav lightbox__nav--next" type="button" aria-label="Next">' + Cola.icon('arrow-right') + '</button>' : '') +
      '</div><div class="lightbox__caption"></div>';
    document.body.appendChild(lb); ui.lock();
    function show() {
      var it = items[i];
      var stage = lb.querySelector('.lb-media');
      stage.innerHTML = it.html; stage.style.background = it.bg || 'var(--foam-2)';
      lb.querySelector('.lb-count').textContent = String(i + 1).padStart(2, '0') + ' / ' + String(items.length).padStart(2, '0');
      lb.querySelector('.lightbox__caption').textContent = it.caption || '';
    }
    function go(d) { i = (i + d + items.length) % items.length; show(); }
    function close() { lb.classList.remove('is-open'); document.removeEventListener('keydown', key); setTimeout(function () { lb.remove(); ui.unlock(); }, 400); }
    function key(e) { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); }
    lb.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) close();
      else if (e.target.closest('.lightbox__nav--prev')) go(-1);
      else if (e.target.closest('.lightbox__nav--next')) go(1);
    });
    var sx = null;
    lb.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); sx = null; });
    document.addEventListener('keydown', key);
    show();
    requestAnimationFrame(function () { lb.classList.add('is-open'); lb.querySelector('[data-close]').focus(); });
  };

  // Word-by-word headline animation removed (calm design) — kept as a no-op.
  ui.split = function () {};

  // ---------------------------------------------------------------------------
  // Reveal on scroll ([data-reveal], [data-split], [data-count])
  // ---------------------------------------------------------------------------
  var io = null;
  ui.reveal = function (root) {
    root = root || document;
    $$('[data-split]', root).forEach(ui.split);
    var els = $$('[data-reveal]:not(.is-in), [data-split]:not(.is-in), [data-count]:not(.is-counted)', root);
    if (!('IntersectionObserver' in window) || Cola.reducedMotion) {
      els.forEach(function (el) { el.classList.add('is-in'); if (el.hasAttribute('data-count')) countUp(el, true); });
      return;
    }
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var el = en.target;
          el.classList.add('is-in');
          if (el.hasAttribute('data-count')) countUp(el);
          io.unobserve(el);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    }
    els.forEach(function (el) { io.observe(el); });
  };
  function countUp(el, instant) {
    el.classList.add('is-counted');
    var to = parseFloat(el.getAttribute('data-count')) || 0, dec = (String(el.getAttribute('data-count')).split('.')[1] || '').length;
    var prefix = el.getAttribute('data-prefix') || '', suffix = el.getAttribute('data-suffix') || '';
    if (instant) { el.textContent = prefix + to.toFixed(dec) + suffix; return; }
    var t0 = performance.now(), dur = parseInt(el.getAttribute('data-duration'), 10) || 1600;
    (function tick(t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = prefix + (to * e).toFixed(dec) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }
  ui.countUp = countUp;

  // Scroll-linked word highlight (manifesto paragraphs)
  ui.highlightWords = function (el) {
    var words = [];
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
            var s = document.createElement('span'); s.className = 'hw'; s.textContent = p; words.push(s); frag.appendChild(s);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1) walk(n);
      });
    })(el);
    el.classList.add('highlight-words');
    function update() {
      var r = el.getBoundingClientRect(), vh = window.innerHeight;
      var p = Cola.clamp((vh * 0.85 - r.top) / (r.height + vh * 0.35), 0, 1);
      var n = Math.round(p * words.length);
      words.forEach(function (w, i) { w.classList.toggle('on', i < n); });
    }
    window.addEventListener('scroll', update, { passive: true }); window.addEventListener('resize', update); update();
  };

  // ---------------------------------------------------------------------------
  // Marquee — duplicate track for a seamless loop
  // ---------------------------------------------------------------------------
  ui.marquee = function (root) {
    $$('.marquee', root || document).forEach(function (m) {
      if (m.dataset.ready) return; m.dataset.ready = '1';
      var track = m.querySelector('.marquee__track'); if (!track) return;
      var clone = track.cloneNode(true); clone.setAttribute('aria-hidden', 'true'); m.appendChild(clone);
    });
  };

  // ---------------------------------------------------------------------------
  // Accordion ([data-acc] container with .acc__item > .acc__btn + .acc__panel)
  // ---------------------------------------------------------------------------
  ui.accordion = function (root) {
    $$('[data-acc]', root || document).forEach(function (acc) {
      if (acc.dataset.ready) return; acc.dataset.ready = '1';
      var single = acc.getAttribute('data-acc') === 'single';
      $$('.acc__item', acc).forEach(function (item, i) {
        var btn = item.querySelector('.acc__btn'), panel = item.querySelector('.acc__panel');
        var id = Cola.uid('acc');
        btn.setAttribute('aria-controls', id); panel.id = id;
        btn.setAttribute('aria-expanded', item.classList.contains('is-open') ? 'true' : 'false');
        btn.addEventListener('click', function () {
          var open = !item.classList.contains('is-open');
          if (single) $$('.acc__item.is-open', acc).forEach(function (o) { if (o !== item) { o.classList.remove('is-open'); o.querySelector('.acc__btn').setAttribute('aria-expanded', 'false'); } });
          item.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      });
    });
  };

  // ---------------------------------------------------------------------------
  // Tooltips ([data-tip]) — one floating element, delegated
  // ---------------------------------------------------------------------------
  ui.tooltips = function () {
    var tip = document.createElement('div'); tip.className = 'tooltip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
    var cur = null;
    document.addEventListener('pointerover', function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]');
      if (!t || Cola.isTouch) return;
      cur = t; tip.textContent = t.getAttribute('data-tip');
      var r = t.getBoundingClientRect(); tip.style.left = (r.left + r.width / 2) + 'px'; tip.style.top = r.top + 'px'; tip.classList.add('is-on');
    });
    document.addEventListener('pointerout', function (e) { if (cur && (!e.relatedTarget || !cur.contains(e.relatedTarget))) { tip.classList.remove('is-on'); cur = null; } });
    window.addEventListener('scroll', function () { tip.classList.remove('is-on'); }, { passive: true });
  };

  // Magnetic buttons, custom cursor and parallax removed (calm design) — no-ops.
  ui.magnetic = function () {};
  ui.cursor = function () {};
  ui.parallax = function () {};

  // ---------------------------------------------------------------------------
  // Header scroll state, dark-section detection, back-to-top progress
  // ---------------------------------------------------------------------------
  ui.scrollState = function () {
    var lastY = window.scrollY, body = document.body, toTop = $('.to-top');
    var darks = $$('[data-header="dark"]');
    function run() {
      var y = window.scrollY, hh = 80;
      body.classList.toggle('is-scrolled', y > 10);
      if (!body.classList.contains('menu-open')) body.classList.toggle('header-hidden', y > 260 && y > lastY + 2 && !body.classList.contains('no-hide'));
      if (y < lastY - 2) body.classList.remove('header-hidden');
      lastY = y;
      var dark = darks.some(function (s) { var r = s.getBoundingClientRect(); return r.top <= hh && r.bottom >= hh; });
      body.classList.toggle('header-dark', dark);
      if (toTop) {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        toTop.style.setProperty('--p', max > 0 ? (y / max).toFixed(3) : 0);
        toTop.classList.toggle('is-visible', y > window.innerHeight * 1.2);
      }
    }
    window.addEventListener('scroll', function () { requestAnimationFrame(run); }, { passive: true });
    run();
    ui.refreshDarkSections = function () { darks = $$('[data-header="dark"]'); run(); };
  };

  // ---------------------------------------------------------------------------
  // Page transitions and the logo preloader were removed on request; these
  // stubs keep older page scripts working. Cleans up the old session flags.
  // ---------------------------------------------------------------------------
  ui.transitions = function () {
    try { Cola.session.del('cola.curtain'); } catch (e) { /* ignore */ }
  };
  ui.preloader = function () {
    var el = $('.preloader'); if (el) el.remove();
    return Promise.resolve();
  };

  // ---------------------------------------------------------------------------
  // Countdown
  // ---------------------------------------------------------------------------
  ui.countdown = function (el, iso, compact) {
    var target = new Date(iso).getTime();
    function pad(n) { return String(n).padStart(2, '0'); }
    function tick() {
      var d = Math.max(0, target - Date.now());
      var days = Math.floor(d / 86400000), h = Math.floor(d / 3600000) % 24, m = Math.floor(d / 60000) % 60, s = Math.floor(d / 1000) % 60;
      if (compact) el.textContent = d <= 0 ? 'Live now' : days + 'd ' + pad(h) + 'h ' + pad(m) + 'm ' + pad(s) + 's';
      else el.innerHTML = [[days, 'Days'], [h, 'Hours'], [m, 'Minutes'], [s, 'Seconds']].map(function (u, i) {
        return (i ? '<span class="countdown__sep" aria-hidden="true">:</span>' : '') + '<span class="countdown__unit"><span class="countdown__num">' + pad(u[0]) + '</span><span class="countdown__lbl">' + u[1] + '</span></span>';
      }).join('');
      return d;
    }
    tick();
    var iv = setInterval(function () { if (tick() <= 0) clearInterval(iv); }, 1000);
    return function () { clearInterval(iv); };
  };

  // ---------------------------------------------------------------------------
  // Drag-to-scroll rails ([data-drag-scroll])
  // ---------------------------------------------------------------------------
  ui.dragScroll = function (root) {
    $$('[data-drag-scroll]', root || document).forEach(function (el) {
      if (el.dataset.drag || Cola.isTouch) return; el.dataset.drag = '1';
      var down = false, sx = 0, sl = 0, moved = false;
      el.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') return; down = true; moved = false; sx = e.clientX; sl = el.scrollLeft; });
      window.addEventListener('pointermove', function (e) { if (!down) return; var dx = e.clientX - sx; if (Math.abs(dx) > 4) { moved = true; el.classList.add('is-dragging'); } el.scrollLeft = sl - dx; });
      window.addEventListener('pointerup', function () { down = false; setTimeout(function () { el.classList.remove('is-dragging'); }, 0); });
      el.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    });
  };

  // ---------------------------------------------------------------------------
  // In-page hash links. The server injects <base href="/">, which would turn
  // href="#section" into "/#section" (a different page) — so we scroll manually.
  // ---------------------------------------------------------------------------
  ui.hashLinks = function () {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || e.defaultPrevented) return;
      var id = decodeURIComponent(a.getAttribute('href').slice(1));
      e.preventDefault();
      if (!id) { window.scrollTo({ top: 0, behavior: Cola.reducedMotion ? 'auto' : 'smooth' }); return; }
      var el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: Cola.reducedMotion ? 'auto' : 'smooth', block: 'start' });
      try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch (err) { /* noop */ }
      if (a.classList.contains('skip-link')) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
    });
  };

  /**
   * Photos from Weibo / Weidian that the proxy cannot deliver are hidden instead
   * of showing a broken-image icon; a media strip left empty disappears too.
   */
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG' || !/\/media\/(weibo|img)\?/.test(img.getAttribute('src') || '')) return;
    var tile = img.closest('.tl-media__item, .ucard__media, .ucard-media, .pdp-detail__img, .gal__item, .ugrid-card__media') || img;
    tile.classList.add('is-broken');
    var strip = tile.parentElement && tile.parentElement.closest('.tl-media, .pdp-detail, .ucard__media');
    if (strip && !strip.querySelector(':scope > :not(.is-broken)')) strip.classList.add('is-broken');
  }, true);

  /**
   * Chip rows fade out on the right only while there is more to scroll to —
   * a row that fits shows every chip in full.
   */
  (function tabFades() {
    function check() {
      var rows = document.querySelectorAll('.tabs');
      for (var i = 0; i < rows.length; i++) {
        var t = rows[i];
        t.classList.toggle('has-more', t.scrollWidth - t.clientWidth - t.scrollLeft > 4);
      }
    }
    var later = Cola.throttle(check, 120);
    window.addEventListener('resize', later);
    document.addEventListener('scroll', function (e) { if (e.target && e.target.classList && e.target.classList.contains('tabs')) later(); }, true);
    if (window.MutationObserver) new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check); else check();
  })();

  /** Run all generic enhancers inside a root (used after dynamic renders). */
  ui.enhance = function (root) {
    Cola.rewriteLinks(root);
    ui.reveal(root); ui.marquee(root); ui.accordion(root); ui.magnetic(root); ui.dragScroll(root);
  };
})();
