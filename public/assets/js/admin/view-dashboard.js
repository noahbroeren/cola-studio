/* ==========================================================================
   Cola Studio — Admin · Dashboard
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;

  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  function kpi(o) {
    const tag = o.href ? 'a' : 'div';
    return (
      '<' + tag + ' class="kpi' + (o.tone ? ' kpi--' + o.tone : '') + '"' + (o.href ? ' href="' + A.href(o.href) + '"' : '') + '>' +
      '<span class="kpi__label">' + esc(o.label) + icon(o.icon, 16) + '</span>' +
      '<span class="kpi__value">' + esc(o.value) + '</span>' +
      '<span class="kpi__meta">' + (o.meta || '&nbsp;') + '</span>' +
      '</' + tag + '>'
    );
  }

  A.views.dashboard = {
    title: 'Dashboard',
    skeleton: 'page',
    async render(root) {
      const server = A.data.mode === 'server';
      const [dash, products, settings] = await Promise.all([A.data.getDashboard(), A.data.getProducts(), A.data.getSettings()]);
      const c = dash.counts || {};
      const units = products.filter((p) => p.status !== 'archived').reduce((n, p) => n + A.totalStock(p), 0);
      const drafts = products.filter((p) => p.status === 'draft').length;
      const byId = new Map(products.map((p) => [p.id, p]));
      const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      let newOrders = 0;
      if (server) newOrders = (dash.recentOrders || []).filter((o) => !o.status || o.status === 'new').length;

      const tiles = [
        kpi({ label: 'Products', icon: 'products', value: c.products || 0, href: '/products', meta: drafts ? esc(A.plural(drafts, 'draft')) : 'All live or archived' }),
        kpi({ label: 'Published', icon: 'eye', value: c.published || 0, href: '/products?status=published', meta: c.products ? Math.round(((c.published || 0) / c.products) * 100) + '% of the catalogue' : '' }),
        kpi({ label: 'SKUs', icon: 'inventory', value: c.variants || 0, href: '/inventory', meta: esc(A.num(units) + ' units in stock') }),
        kpi({ label: 'Low stock', icon: 'alert', value: c.lowStock || 0, href: '/inventory?f=low', tone: c.lowStock ? 'low' : '', meta: A.stockDot('low') + esc('≤ ' + A.lowThreshold(settings) + ' units left') }),
        kpi({ label: 'Sold out', icon: 'minus', value: c.soldOut || 0, href: '/inventory?f=soldout', tone: c.soldOut ? 'out' : '', meta: A.stockDot('soldout') + 'Variants at zero' }),
        kpi({ label: 'Pending updates', icon: 'updates', value: c.updatesPending || 0, href: '/updates?status=pending', meta: c.updatesPending ? 'Waiting for review' : 'Nothing to review' }),
        server
          ? kpi({ label: 'Orders', icon: 'orders', value: c.orders || 0, href: '/orders', meta: newOrders ? esc(newOrders + ' new recently') : 'Order intents from the site' })
          : kpi({ label: 'Orders', icon: 'orders', value: '—', tone: 'muted', href: '/orders', meta: icon('lock', 13) + 'Needs the server' }),
        server
          ? kpi({ label: 'Messages', icon: 'messages', value: c.messages || 0, href: '/messages', meta: c.messagesUnread ? esc(c.messagesUnread + ' unread') : c.messages ? 'All read' : 'No messages yet' })
          : kpi({ label: 'Messages', icon: 'messages', value: '—', tone: 'muted', href: '/messages', meta: icon('lock', 13) + 'Needs the server' }),
      ].join('');

      const low = dash.lowStock || [];
      const lowHtml = low.length
        ? '<ul class="list">' +
          low
            .slice(0, 8)
            .map((l) => {
              const p = byId.get(l.productId);
              return (
                '<li><a class="list__item" href="' + A.href('/products/' + encodeURIComponent(l.productId) + '?section=variants') + '">' +
                '<span class="thumb thumb--sm">' + (p ? A.productThumb(p, { color: l.color }) : '') + '</span>' +
                '<span class="list__main"><span class="list__title">' + esc(l.name) + '</span><span class="list__sub">' + esc([l.color, l.size].filter(Boolean).join(' · ')) + ' · <span class="mono">' + esc(l.sku) + '</span></span></span>' +
                '<span class="list__end">' + A.stockPill(l.status) + '<div class="small faint" style="margin-top:4px">' + esc(A.plural(Number(l.stock) || 0, 'unit')) + '</div></span></a></li>'
              );
            })
            .join('') +
          '</ul>'
        : ui.empty({ icon: 'check', title: 'Stock looks healthy', body: 'No variant is at or below the low-stock threshold.', compact: true });

      const ordersHtml = !server
        ? ''
        : '<div class="card"><div class="card__head"><span class="card__title">Recent orders</span><a class="card-link" href="' + A.href('/orders') + '">All orders' + icon('chevronRight', 14) + '</a></div>' +
          ((dash.recentOrders || []).length
            ? '<ul class="list">' +
              dash.recentOrders
                .map(
                  (o) =>
                    '<li><a class="list__item" href="' + A.href('/orders?id=' + encodeURIComponent(o.id)) + '"><span class="list__main"><span class="list__title">' + esc(o.ref || o.id) + ' · ' + esc((o.customer && o.customer.name) || 'Unknown customer') + '</span>' +
                    '<span class="list__sub">' + esc(A.plural((o.items || []).reduce((n, i) => n + (i.qty || 1), 0), 'item') + ' · ' + (o.channel || 'whatsapp') + ' · ' + A.ago(o.createdAt)) + '</span></span>' +
                    '<span class="list__end">' + esc(A.money(o.totalCNY || 0, 'CNY')) + '<div style="margin-top:4px"><span class="pill pill--' + (o.status === 'new' || !o.status ? 'new' : 'draft') + '">' + esc(o.status || 'new') + '</span></div></span></a></li>'
                )
                .join('') +
              '</ul>'
            : ui.empty({ icon: 'orders', title: 'No orders yet', body: 'Order intents appear here when customers check out via WhatsApp or an agent.', compact: true })) +
          '</div>' +
          '<div class="card"><div class="card__head"><span class="card__title">Recent messages</span><a class="card-link" href="' + A.href('/messages') + '">Inbox' + icon('chevronRight', 14) + '</a></div>' +
          ((dash.recentMessages || []).length
            ? '<ul class="list">' +
              dash.recentMessages
                .map(
                  (m) =>
                    '<li><a class="list__item" href="' + A.href('/messages?id=' + encodeURIComponent(m.id)) + '">' + (m.read ? '' : '<span class="unread-dot" aria-label="Unread"></span>') +
                    '<span class="list__main"><span class="list__title">' + esc(m.name) + (m.topic ? ' · ' + esc(m.topic) : '') + '</span><span class="list__sub">' + esc(m.message) + '</span></span>' +
                    '<span class="list__end">' + esc(A.ago(m.createdAt)) + '</span></a></li>'
                )
                .join('') +
              '</ul>'
            : ui.empty({ icon: 'messages', title: 'No messages yet', body: 'Contact form submissions land here.', compact: true })) +
          '</div>';

      const s = dash.sync || {};
      const syncHtml =
        '<div class="card"><div class="card__head"><span class="card__title">Sync status</span>' + (server ? '<a class="card-link" href="' + A.href('/integrations') + '">Integrations' + icon('chevronRight', 14) + '</a>' : '') + '</div><div class="card__body"><div class="sync">' +
        A.actions.syncRow('Weidian stock', 'sync', s.weidian, server ? 'Configure a provider under Integrations, then run a sync.' : 'Live stock sync runs on the server.') +
        (server ? '<div class="row" style="padding-left:50px"><button type="button" class="btn btn--sm btn--secondary" data-act="weidian-dry">Dry run</button><button type="button" class="btn btn--sm btn--primary" data-act="weidian">' + icon('sync', 15) + 'Sync now</button></div>' : '') +
        '<hr style="margin:4px 0">' +
        A.actions.syncRow('Weibo updates', 'globe', s.weibo, server ? 'Set the studio’s Weibo uid under Integrations.' : 'Weibo import runs on the server.') +
        (server ? '<div class="row" style="padding-left:50px"><button type="button" class="btn btn--sm btn--primary" data-act="weibo">' + icon('refresh', 15) + 'Fetch now</button></div>' : '') +
        '</div></div></div>';

      const quickHtml =
        '<div class="card"><div class="card__head"><span class="card__title">Quick actions</span></div><div class="card__body"><div class="quick">' +
        '<a class="quick__item" href="' + A.href('/products/new') + '">' + icon('plus') + 'New product' + icon('chevronRight', 16) + '</a>' +
        '<a class="quick__item" href="' + A.href('/inventory') + '">' + icon('inventory') + 'Update stock' + icon('chevronRight', 16) + '</a>' +
        '<a class="quick__item" href="' + A.href('/updates/new') + '">' + icon('updates') + 'New studio post' + icon('chevronRight', 16) + '</a>' +
        '<a class="quick__item" href="' + A.href('/settings') + '">' + icon('settings') + 'Edit settings' + icon('chevronRight', 16) + '</a>' +
        '<a class="quick__item" href="' + esc(A.siteUrl()) + '" target="_blank" rel="noopener">' + icon('globe') + 'View site' + icon('external', 16) + '</a>' +
        '</div></div></div>';

      root.innerHTML =
        '<header class="page-head"><div class="page-head__text"><p class="greeting">' + esc(greeting()) + '</p><h1>' + A.heading('Dashboard', today) + '</h1></div>' +
        '<div class="page-actions"><a class="btn btn--secondary" href="' + esc(A.siteUrl()) + '" target="_blank" rel="noopener">View site' + icon('external', 15) + '</a>' +
        '<a class="btn btn--secondary" href="' + A.href('/settings') + '">' + icon('settings', 16) + 'Settings</a>' +
        '<a class="btn btn--primary" href="' + A.href('/products/new') + '">' + icon('plus', 16) + 'New product</a></div></header>' +
        '<section class="kpis" aria-label="Key figures">' + tiles + '</section>' +
        '<div class="dash-grid"><div class="stack">' +
        '<div class="card"><div class="card__head"><span class="card__title">Needs restocking <span class="count">' + low.length + '</span></span><a class="card-link" href="' + A.href('/inventory?f=low') + '">Inventory' + icon('chevronRight', 14) + '</a></div>' + lowHtml +
        (low.length > 8 ? '<div class="card__foot"><span class="small faint">' + esc('+' + (low.length - 8) + ' more variants') + '</span><a class="card-link" href="' + A.href('/inventory?f=low') + '">Show all' + icon('chevronRight', 14) + '</a></div>' : '') + '</div>' +
        ordersHtml +
        '</div><div class="stack">' + syncHtml + quickHtml + '</div></div>';

      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const refresh = () => A.router.refresh();
        if (b.dataset.act === 'weibo') await A.actions.weiboFetch(b, { onClose: refresh });
        else if (b.dataset.act === 'weidian') await A.actions.weidianSync(b, { dryRun: false, onClose: refresh });
        else if (b.dataset.act === 'weidian-dry') await A.actions.weidianSync(b, { dryRun: true, onClose: refresh });
      });
      return null;
    },
  };
})();
