/* ==========================================================================
   Cola Studio — Admin app shell
   Boot (mode detection + login), sidebar, banners, hash router, shortcuts.
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;
  const app = (A.app = {});

  const NAV = [
    { group: null, items: [{ route: '/dashboard', label: 'Dashboard', icon: 'dashboard', view: 'dashboard' }] },
    {
      group: 'Catalogue',
      items: [
        { route: '/products', label: 'Products', icon: 'products', view: 'products', badge: 'products' },
        { route: '/inventory', label: 'Inventory', icon: 'inventory', view: 'inventory', badge: 'inventory' },
        { route: '/categories', label: 'Categories', icon: 'categories', view: 'categories' },
      ],
    },
    {
      group: 'Content',
      items: [
        { route: '/updates', label: 'Studio updates', icon: 'updates', view: 'updates', badge: 'updates' },
        { route: '/media', label: 'Media library', icon: 'media', view: 'media' },
      ],
    },
    {
      group: 'Inbox',
      items: [
        { route: '/orders', label: 'Orders', icon: 'orders', view: 'orders', badge: 'orders', server: true },
        { route: '/messages', label: 'Messages', icon: 'messages', view: 'messages', badge: 'messages', server: true },
        { route: '/restock', label: 'Restock requests', icon: 'restock', view: 'restock', badge: 'restock', server: true },
      ],
    },
    {
      group: 'Studio',
      items: [
        { route: '/settings', label: 'Settings', icon: 'settings', view: 'settings' },
        { route: '/integrations', label: 'Integrations', icon: 'integrations', view: 'integrations', server: true },
        { route: '/backup', label: 'Backup & logs', icon: 'backup', view: 'backup' },
      ],
    },
  ];

  const ROUTES = [
    ['/', 'dashboard', 'dashboard'],
    ['/dashboard', 'dashboard', 'dashboard'],
    ['/products', 'products', 'products'],
    ['/products/new', 'editor', 'products', { id: 'new' }],
    ['/products/:id', 'editor', 'products'],
    ['/inventory', 'inventory', 'inventory'],
    ['/categories', 'categories', 'categories'],
    ['/updates', 'updates', 'updates'],
    ['/updates/new', 'updateEditor', 'updates', { id: 'new' }],
    ['/updates/:id', 'updateEditor', 'updates'],
    ['/orders', 'orders', 'orders'],
    ['/messages', 'messages', 'messages'],
    ['/restock', 'restock', 'restock'],
    ['/settings', 'settings', 'settings'],
    ['/integrations', 'integrations', 'integrations'],
    ['/media', 'media', 'media'],
    ['/backup', 'backup', 'backup'],
  ].map(([pattern, view, nav, params]) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (m, k) => (keys.push(k), '([^/]+)')) + '/?$');
    return { pattern, view, nav, params: params || {}, re, keys };
  });

  /* ================================================================ router */

  const router = (A.router = { ctl: null, lastHash: '', seq: 0 });

  function parseHash(hash) {
    const raw = String(hash || '').replace(/^#/, '') || '/';
    const qi = raw.indexOf('?');
    const path = (qi >= 0 ? raw.slice(0, qi) : raw) || '/';
    const query = Object.fromEntries(new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : ''));
    return { path, query };
  }

  function match(path) {
    for (const r of ROUTES) {
      const m = r.re.exec(path);
      if (m) {
        const params = Object.assign({}, r.params);
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        if (r.params.id) params.id = r.params.id;
        return { view: r.view, nav: r.nav, params };
      }
    }
    return null;
  }

  async function onHashChange() {
    const ctl = router.ctl;
    if (ctl && ctl.canLeave) {
      const ok = await ctl.canLeave();
      if (!ok) {
        history.replaceState(null, '', location.pathname + location.search + (router.lastHash || '#/'));
        return;
      }
    }
    render();
  }

  router.refresh = () => render();
  /** Change the URL without re-rendering (e.g. after "create" assigns an id). */
  router.replace = function (route) {
    const r = String(route).replace(/^#?\/?/, '/');
    history.replaceState(null, '', location.pathname + location.search + '#' + r);
    router.lastHash = '#' + r;
  };

  async function render() {
    const token = ++router.seq;
    if (router.ctl && router.ctl.destroy) {
      try {
        router.ctl.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    router.ctl = null;
    const { path, query } = parseHash(location.hash);
    const m = match(path);
    router.lastHash = location.hash || '#/';
    const old = document.getElementById('view');
    if (!old) return;
    // Fresh element per render: views attach listeners to their root, and a new
    // node guarantees no handler from a previous view survives navigation.
    const root = old.cloneNode(false);
    old.replaceWith(root);
    closeNav();
    window.scrollTo(0, 0);
    setActiveNav(m ? m.nav : null);
    root.className = 'view view--' + (m ? m.view : 'missing');
    if (!m || !A.views[m.view]) {
      root.innerHTML = ui.empty({ icon: 'alert', title: 'Page not found', body: 'There is no admin page at <code>#' + esc(path) + '</code>.', actions: '<a class="btn btn--primary" href="' + A.href('/dashboard') + '">Go to the dashboard</a>' });
      document.title = 'Not found — Cola Studio Admin';
      return;
    }
    const view = A.views[m.view];
    document.title = (view.title || 'Admin') + ' — Cola Studio Admin';
    root.innerHTML = ui.skeleton(view.skeleton || 'page');
    const ctx = {
      stale: () => token !== router.seq,
      setTitle: (t) => (document.title = t + ' — Cola Studio Admin'),
      query,
    };
    try {
      const ctl = await view.render(root, m.params, ctx);
      if (token !== router.seq) {
        if (ctl && ctl.destroy) ctl.destroy();
        return;
      }
      router.ctl = ctl || null;
      const h1 = root.querySelector('h1');
      if (h1 && !root.contains(document.activeElement)) {
        h1.setAttribute('tabindex', '-1');
        h1.focus({ preventScroll: true });
      }
    } catch (e) {
      if (token !== router.seq) return;
      if (e && e.status === 401) return;
      root.innerHTML = ui.empty({
        icon: 'alert',
        title: e && e.status === 404 ? 'Not found' : 'This page could not be loaded',
        body: esc((e && e.message) || String(e)),
        actions: '<button type="button" class="btn btn--secondary" data-retry>' + icon('refresh', 16) + 'Try again</button>',
      });
      const b = root.querySelector('[data-retry]');
      if (b) b.addEventListener('click', () => render());
      if (!e || !e.status) console.error('[admin]', e); // eslint-disable-line no-console
    }
  }

  /* ================================================================= shell */

  function wordmark() {
    return '<span class="wordmark"><b>COLA</b><span>STUDIO</span></span>';
  }

  function navHtml() {
    const server = A.data.mode === 'server';
    return NAV.map(
      (g) =>
        '<div class="nav__group">' +
        (g.group ? '<div class="nav__label">' + esc(g.group) + '</div>' : '') +
        g.items
          .map(
            (it) =>
              '<a class="nav__item' + (it.server && !server ? ' is-locked' : '') + '" href="' + A.href(it.route) + '" data-nav="' + it.view + '">' +
              icon(it.icon) + '<span class="nav__text">' + esc(it.label) + '</span>' +
              (it.server && !server ? '<span class="nav__lock" title="Needs the server">' + icon('lock', 13) + '</span>' : '') +
              (it.badge ? '<span class="nav__badge" data-badge="' + it.badge + '" hidden></span>' : '') +
              '</a>'
          )
          .join('') +
        '</div>'
    ).join('');
  }

  function renderShell() {
    const server = A.data.mode === 'server';
    document.body.classList.toggle('is-static', !server);
    document.getElementById('app').innerHTML =
      '<a class="skip" href="#view">Skip to content</a>' +
      '<div class="shell">' +
      '<aside class="side" id="side" aria-label="Admin navigation">' +
      '<div class="side__brand"><a class="brand" href="' + A.href('/dashboard') + '">' + A.monogram(30) + '<span class="brand__text">' + wordmark() + '<span class="brand__sub">Admin</span></span></a>' +
      '<button type="button" class="icon-btn side__close" data-nav-close aria-label="Close menu">' + icon('x') + '</button></div>' +
      '<nav class="nav">' + navHtml() + '</nav>' +
      '<div class="side__foot">' +
      '<a class="nav__item nav__item--quiet" href="' + esc(A.siteUrl()) + '" target="_blank" rel="noopener">' + icon('external') + '<span class="nav__text">View site</span></a>' +
      (server ? '<button type="button" class="nav__item nav__item--quiet" data-logout>' + icon('logout') + '<span class="nav__text">Log out</span></button>' : '') +
      '<div class="side__mode"><i class="mode-dot mode-dot--' + (server ? 'server' : 'static') + '"></i>' + (server ? 'Server' : 'Demo · this browser') + '<span>v' + esc(A.serverVersion || A.version) + '</span></div>' +
      '</div></aside>' +
      '<header class="topbar"><button type="button" class="icon-btn" data-nav-open aria-label="Open menu" aria-controls="side">' + icon('menu', 20) + '</button>' +
      '<a class="brand brand--top" href="' + A.href('/dashboard') + '">' + A.monogram(24) + wordmark() + '</a>' +
      '<a class="icon-btn" href="' + esc(A.siteUrl()) + '" target="_blank" rel="noopener" aria-label="View site">' + icon('external', 18) + '</a></header>' +
      '<div class="side-scrim" data-nav-close></div>' +
      '<main class="main" id="main"><div id="banners" class="banners"></div><div id="view" class="view" tabindex="-1"></div></main>' +
      '</div>';

    const appEl = document.getElementById('app');
    appEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-nav-open]')) openNav();
      else if (e.target.closest('[data-nav-close]')) closeNav();
      else if (e.target.closest('[data-logout]')) logout();
    });
    renderBanners();
  }

  function openNav() {
    document.body.classList.add('nav-open');
    const first = A.$('.side .nav__item');
    if (first) first.focus({ preventScroll: true });
  }
  function closeNav() {
    document.body.classList.remove('nav-open');
  }

  function setActiveNav(view) {
    A.$$('.nav__item[data-nav]').forEach((a) => {
      const on = a.dataset.nav === view;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function renderBanners() {
    const host = document.getElementById('banners');
    if (!host) return;
    let html = '';
    if (A.data.mode === 'static') {
      const info = A.data.overlayInfo();
      html +=
        '<div class="banner banner--demo"><span class="banner__ic">' + icon('info', 16) + '</span>' +
        '<p><b>Demo mode</b> — changes are saved in this browser only' + (info.present ? ' <span class="banner__meta">· ' + esc(A.plural(info.keys.length, 'collection')) + ' edited, ' + esc(A.bytes(info.bytes)) + '</span>' : '') + '. Export JSON to publish them on a static host.</p>' +
        '<div class="banner__actions"><a class="btn btn--sm btn--ghost-dark" href="' + A.href('/backup') + '">' + icon('download', 15) + 'Export / import</a>' +
        (info.present ? '<button type="button" class="btn btn--sm btn--ghost-dark" data-reset-demo>Reset demo data</button>' : '') + '</div></div>';
    }
    if (A.data.mode === 'server' && app.me && app.me.defaultPassword) {
      html +=
        '<div class="banner banner--warn"><span class="banner__ic">' + icon('alert', 16) + '</span>' +
        '<p><b>Default password in use.</b> Anyone who knows “colastudio” can log in. Set <code>ADMIN_PASSWORD</code> in <code>.env</code> (or your host’s environment) and restart the server before going live.</p></div>';
    }
    host.innerHTML = html;
    const reset = host.querySelector('[data-reset-demo]');
    if (reset) reset.addEventListener('click', app.resetDemo);
  }
  app.renderBanners = renderBanners;

  app.resetDemo = async function () {
    const ok = await ui.confirm({
      title: 'Reset demo data?',
      body: 'This removes every change saved in this browser and restores the original JSON files. Export first if you want to keep your edits.',
      confirmText: 'Reset demo data',
      danger: true,
    });
    if (!ok) return;
    A.data.resetDemo();
    if (router.ctl) router.ctl = null;
    renderBanners();
    ui.toast('Demo data reset');
    render();
    app.refreshBadges();
  };

  /* ================================================================ badges */

  app.refreshBadges = async function () {
    try {
      const d = await A.data.getDashboard();
      const c = d.counts || {};
      let newOrders = 0;
      if (A.data.mode === 'server') {
        try {
          newOrders = (await A.data.getCollection('orders')).filter((o) => !o.status || o.status === 'new').length;
        } catch (e) {
          newOrders = 0;
        }
      }
      const set = (key, n, tone) => {
        const b = A.$('[data-badge="' + key + '"]');
        if (!b) return;
        b.hidden = !n;
        b.textContent = n > 99 ? '99+' : String(n || '');
        b.className = 'nav__badge' + (tone ? ' nav__badge--' + tone : '');
      };
      set('inventory', (c.lowStock || 0) + (c.soldOut || 0), 'low');
      set('updates', c.updatesPending || 0);
      set('orders', newOrders);
      set('messages', c.messagesUnread || 0);
      set('restock', c.notify || 0);
      app.counts = c;
    } catch (e) {
      /* badges are best-effort */
    }
  };

  /* ================================================================= login */

  function renderLogin(message) {
    document.body.classList.add('is-login');
    document.title = 'Log in — Cola Studio Admin';
    document.getElementById('app').innerHTML =
      '<div class="login"><div class="login__art" aria-hidden="true">' + A.monogram(900) + '</div>' +
      '<form class="login__panel" novalidate>' +
      '<div class="login__brand">' + A.monogram(56) + wordmark() + '<span class="login__sub">Admin</span></div>' +
      '<h1 class="login__title"><b>Welcome</b> <span>back</span></h1>' +
      '<p class="login__lead">Log in to manage the catalogue, stock and studio updates.</p>' +
      '<label class="label" for="pw">Password</label>' +
      '<div class="pw"><input id="pw" class="input input--dark" type="password" name="password" autocomplete="current-password" required autofocus>' +
      '<button type="button" class="pw__toggle" aria-label="Show password">' + icon('eye', 18) + '</button></div>' +
      '<p class="login__error" role="alert"' + (message ? '' : ' hidden') + '>' + esc(message || '') + '</p>' +
      '<button type="submit" class="btn btn--light btn--block">Log in</button>' +
      '<a class="login__back" href="/">' + icon('chevronLeft', 14) + 'Back to the site</a>' +
      '</form></div>';
    const form = A.$('.login__panel');
    const input = A.$('#pw');
    const errEl = A.$('.login__error');
    A.$('.pw__toggle').addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      input.focus();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = input.value;
      if (!pw) {
        errEl.hidden = false;
        errEl.textContent = 'Enter the admin password.';
        input.focus();
        return;
      }
      const btn = form.querySelector('[type=submit]');
      await ui.busy(btn, async () => {
        try {
          await A.data.login(pw);
          app.me = await A.data.me();
          A.serverVersion = app.me.version;
          document.body.classList.remove('is-login');
          startShell();
        } catch (err) {
          errEl.hidden = false;
          if (err.status === 401) errEl.textContent = 'That password is not correct.';
          else if (err.status === 429) errEl.textContent = 'Too many attempts. Try again in ' + Math.ceil((Number(err.retryAfter) || 900) / 60) + ' minutes.';
          else errEl.textContent = err.message;
          input.select();
        }
      }, 'Logging in…');
    });
    setTimeout(() => input.focus(), 30);
  }

  app.onUnauthorized = function () {
    if (document.body.classList.contains('is-login')) return;
    if (router.ctl && router.ctl.destroy) router.ctl.destroy();
    router.ctl = null;
    renderLogin('Your session has expired. Log in again.');
  };

  function logout() {
    A.data.logout();
    if (router.ctl && router.ctl.destroy) router.ctl.destroy();
    router.ctl = null;
    renderLogin();
  }

  /* ================================================================== boot */

  let started = false;
  function startShell() {
    renderShell();
    render();
    app.refreshBadges();
    if (!started) {
      started = true;
      window.addEventListener('hashchange', onHashChange);
      setInterval(() => {
        if (!document.hidden && !document.body.classList.contains('is-login')) app.refreshBadges();
      }, 60000);
    }
  }

  // Global shortcuts: Cmd/Ctrl+S → save in the current view; "/" → focus search.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
      if (router.ctl && router.ctl.save && !ui.hasOverlay()) {
        e.preventDefault();
        router.ctl.save();
      } else if (router.ctl && router.ctl.save) e.preventDefault();
    } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '') && !ui.hasOverlay()) {
      const s = A.$('[data-search]');
      if (s) {
        e.preventDefault();
        s.focus();
      }
    } else if (e.key === 'Escape' && document.body.classList.contains('nav-open')) closeNav();
  });

  // Plain "#/route" anchors would resolve against <base href="/">; route them here instead.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    A.go(a.getAttribute('href').slice(1));
  });

  window.addEventListener('beforeunload', (e) => {
    if (router.ctl && router.ctl.isDirty && router.ctl.isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  async function boot() {
    const root = document.getElementById('app');
    try {
      await A.data.init();
    } catch (e) {
      root.innerHTML = '<div class="boot-error">' + ui.empty({ icon: 'alert', title: 'The admin could not start', body: esc(e.message) }) + '</div>';
      return;
    }
    if (A.data.mode === 'server') {
      if (!A.data.token()) return renderLogin();
      try {
        app.me = await A.data.me();
        A.serverVersion = app.me.version;
      } catch (e) {
        A.data.logout();
        return renderLogin(e.status === 401 ? '' : e.message);
      }
    }
    startShell();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
