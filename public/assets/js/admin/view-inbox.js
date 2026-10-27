/* ==========================================================================
   Cola Studio — Admin · Orders, Messages, Restock requests (server mode)
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;
  const ORDER_STATUSES = ['new', 'contacted', 'confirmed', 'paid', 'shipped', 'completed', 'cancelled'];
  const ORDER_LABEL = { new: 'New', contacted: 'Contacted', confirmed: 'Confirmed', paid: 'Paid', shipped: 'Shipped', completed: 'Completed', cancelled: 'Cancelled' };
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

  function contactLinks(contact, text) {
    const c = String(contact || '').trim();
    if (!c) return '<span class="faint">—</span>';
    let html = '<span class="nowrap">' + esc(c) + '</span>';
    if (isEmail(c)) html += ' <a class="icon-btn icon-btn--sm" href="mailto:' + esc(c) + '" title="Email" aria-label="Email ' + esc(c) + '">' + icon('messages', 15) + '</a>';
    else if (A.isPhoneLike(c)) html += ' <a class="icon-btn icon-btn--sm" href="' + esc(A.waLink(c, text)) + '" target="_blank" rel="noopener" title="Open WhatsApp chat" aria-label="WhatsApp ' + esc(c) + '">' + icon('whatsapp', 15) + '</a>';
    return '<span class="row" style="gap:2px">' + html + '</span>';
  }

  function serverOnly(root, title, what) {
    root.innerHTML = '<header class="page-head"><div class="page-head__text"><h1>' + A.heading(title) + '</h1></div></header><div class="card">' + ui.serverOnly(title, what) + '</div>';
    return null;
  }

  /* =============================================================== orders */

  A.views.orders = {
    title: 'Orders',
    skeleton: 'table',
    async render(root, params, ctx) {
      if (!A.data.caps.inbox) return serverOnly(root, 'Orders', 'Order intents are recorded by the server when a customer checks out via WhatsApp or an agent.');
      let [orders, products] = await Promise.all([A.data.getCollection('orders'), A.data.getProducts().catch(() => [])]);
      if (ctx.stale()) return null;
      const st = { status: '', q: '' };
      let drawer = null;

      root.innerHTML =
        '<header class="page-head"><div class="page-head__text"><h1 data-count></h1><p class="lead">Order intents from the site. The customer completes the order on WhatsApp or with their agent — track progress here.</p></div></header>' +
        '<div class="card"><div class="tabs" data-tabs></div><div class="toolbar"><label class="search">' + icon('search', 16) + '<input class="input" type="search" data-search data-q placeholder="Search reference, customer or product" aria-label="Search orders"><kbd>/</kbd></label><span class="toolbar__count" data-shown></span></div>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th class="num">Total</th><th>Channel</th><th>Status</th><th class="shrink"></th></tr></thead><tbody data-rows></tbody></table></div><div data-empty></div></div>';

      function summary(o) {
        const cu = o.customer || {};
        const lines = ['Order ' + (o.ref || o.id), 'Date: ' + A.dateTime(o.createdAt), 'Full name: ' + (cu.name || '—'), 'Email: ' + (cu.email || '—'), 'Phone: ' + (cu.phone || cu.contact || '—'), 'Address: ' + ([cu.address, [cu.postcode, cu.city].filter(Boolean).join(' '), cu.country].filter(Boolean).join(', ') || '—'), 'Channel: ' + (o.channel || 'whatsapp') + (o.agentId ? ' (' + o.agentId + ')' : ''), ''];
        (o.items || []).forEach((i) => lines.push('• ' + (i.qty || 1) + ' × ' + i.name + ' — ' + [i.color, i.size].filter(Boolean).join(' / ') + (i.sku ? ' [' + i.sku + ']' : '') + (i.price != null ? ' — ' + A.money(i.price, 'CNY') : '')));
        lines.push('', 'Total: ' + A.money(o.totalCNY || 0, 'CNY'));
        if (o.note) lines.push('Note: ' + o.note);
        return lines.join('\n');
      }

      function draw() {
        const c = { '': orders.length };
        ORDER_STATUSES.forEach((s) => (c[s] = orders.filter((o) => (o.status || 'new') === s).length));
        root.querySelector('[data-count]').innerHTML = A.heading('Orders', orders.length);
        root.querySelector('[data-tabs]').innerHTML = [['', 'All']].concat(ORDER_STATUSES.map((s) => [s, ORDER_LABEL[s]])).filter(([v]) => v === '' || c[v] || v === 'new').map(([v, l]) => '<button type="button" class="tab' + (st.status === v ? ' is-active' : '') + '" data-status="' + v + '">' + l + '<span class="count">' + c[v] + '</span></button>').join('');
        const q = st.q.toLowerCase();
        const list = orders.filter((o) => (!st.status || (o.status || 'new') === st.status) && (!q || JSON.stringify([o.ref, o.customer, (o.items || []).map((i) => i.name + ' ' + i.sku)]).toLowerCase().includes(q)));
        root.querySelector('[data-shown]').textContent = A.plural(list.length, 'order') + ' shown';
        root.querySelector('[data-rows]').innerHTML = list
          .map((o) => {
            const qty = (o.items || []).reduce((n, i) => n + (i.qty || 1), 0);
            return (
              '<tr class="is-clickable" data-id="' + esc(o.id) + '"><td><span class="cell-title">' + esc(o.ref || o.id) + '</span><span class="cell-sub">' + esc(A.dateTime(o.createdAt)) + '</span></td>' +
              '<td><span class="cell-title">' + esc((o.customer && o.customer.name) || '—') + '</span><span class="cell-sub">' + esc([(o.customer && o.customer.city) || '', (o.customer && o.customer.country) || '', (o.customer && (o.customer.phone || o.customer.email || o.customer.contact)) || ''].filter(Boolean).join(' · ')) + '</span></td>' +
              '<td>' + esc(A.plural(qty, 'item')) + '<span class="cell-sub ellipsis" style="max-width:240px">' + esc((o.items || []).map((i) => i.name).join(', ')) + '</span></td>' +
              '<td class="num nowrap">' + esc(A.money(o.totalCNY || 0, 'CNY')) + (o.currency && o.currency !== 'CNY' ? '<span class="cell-sub">shown in ' + esc(o.currency) + '</span>' : '') + '</td>' +
              '<td class="nowrap">' + esc(o.channel === 'agent' ? 'Agent' + (o.agentId ? ' · ' + o.agentId : '') : 'WhatsApp') + '</td>' +
              '<td><select class="input input--sm" data-status-sel aria-label="Status" style="width:auto">' + ui.options(ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_LABEL[s] })), o.status || 'new') + '</select></td>' +
              '<td class="shrink"><button type="button" class="icon-btn icon-btn--sm" data-open aria-label="Open order">' + icon('chevronRight', 16) + '</button></td></tr>'
            );
          })
          .join('');
        root.querySelector('[data-empty]').innerHTML = list.length ? '' : ui.empty({ icon: 'orders', title: orders.length ? 'No orders in this view' : 'No orders yet', body: orders.length ? '' : 'When a customer sends their order via WhatsApp or picks an agent, it is logged here.', compact: !!orders.length });
      }

      async function setStatus(o, status) {
        try {
          await A.data.patchCollection('orders', o.id, { status });
          o.status = status;
          ui.toast('Order ' + (o.ref || '') + ' marked ' + ORDER_LABEL[status].toLowerCase());
          A.app.refreshBadges();
        } catch (e) {
          ui.error(e);
        }
      }

      function open(o) {
        const cu = o.customer || {};
        const phone = A.isPhoneLike(cu.phone) ? cu.phone : A.isPhoneLike(cu.contact) ? cu.contact : '';
        const hello = 'Hi ' + (cu.name || '') + ', about your Cola Studio order ' + (o.ref || '');
        const addr = [cu.address, [cu.postcode, cu.city].filter(Boolean).join(' '), cu.country].filter(Boolean);
        const productOf = (id) => products.find((p) => p.id === id);
        drawer = ui.drawer({
          titleHtml: esc('Order ' + (o.ref || o.id)),
          width: '600px',
          content:
            '<dl class="dl"><dt>Status</dt><dd><select class="input input--sm" data-d-status style="width:auto">' + ui.options(ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_LABEL[s] })), o.status || 'new') + '</select></dd>' +
            '<dt>Received</dt><dd>' + esc(A.dateTime(o.createdAt)) + ' <span class="faint">(' + esc(A.ago(o.createdAt)) + ')</span></dd>' +
            '<dt>Full name</dt><dd>' + esc(cu.name || '—') + '</dd>' +
            '<dt>Email</dt><dd>' + contactLinks(cu.email, hello) + '</dd>' +
            '<dt>Phone</dt><dd>' + contactLinks(cu.phone || (!cu.email && !cu.phone ? cu.contact : ''), hello) + '</dd>' +
            '<dt>Address</dt><dd>' + (addr.length ? addr.map(esc).join('<br>') : '<span class="faint">—</span>') + '</dd>' +
            '<dt>Channel</dt><dd>' + esc(o.channel === 'agent' ? 'Agent' + (o.agentId ? ' (' + o.agentId + ')' : '') : 'WhatsApp') + ' · prices shown in ' + esc(o.currency || 'CNY') + '</dd>' +
            (o.note ? '<dt>Customer note</dt><dd>' + esc(o.note) + '</dd>' : '') + '</dl>' +
            '<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th></tr></thead><tbody>' +
            (o.items || [])
              .map((i) => {
                const p = productOf(i.productId);
                return '<tr><td><div class="cell-main">' + (p ? '<span class="thumb thumb--sm">' + A.productThumb(p, { color: i.color }) + '</span>' : '') + '<div><span class="cell-title">' + (p ? '<a href="' + A.href('/products/' + encodeURIComponent(p.id)) + '">' + esc(i.name) + '</a>' : esc(i.name)) + '</span><span class="cell-sub">' + esc([i.color, i.size].filter(Boolean).join(' · ')) + (i.sku ? ' · <span class="mono">' + esc(i.sku) + '</span>' : '') + (i.known === false ? ' · unknown product' : '') + '</span></div></div></td><td class="num">' + esc(i.qty || 1) + '</td><td class="num nowrap">' + esc(i.price != null ? A.money(i.price, 'CNY') : '—') + '</td></tr>';
              })
              .join('') +
            '</tbody><tfoot><tr><td><b>Total (catalogue price)</b></td><td></td><td class="num"><b>' + esc(A.money(o.totalCNY || 0, 'CNY')) + '</b></td></tr></tfoot></table></div></div>' +
            '<div class="field" style="margin-top:20px"><label class="label" for="o-note">Admin note</label><textarea class="input" id="o-note" rows="3" placeholder="Internal note — not shown to the customer">' + esc(o.adminNote || '') + '</textarea>' +
            '<div class="row" style="margin-top:8px"><button type="button" class="btn btn--sm btn--secondary" data-d="note">Save note</button></div></div>',
          footer:
            '<button type="button" class="btn btn--danger" data-d="delete">' + icon('trash', 16) + 'Delete</button><span class="sp"></span>' +
            '<button type="button" class="btn btn--secondary" data-d="copy">' + icon('copy', 16) + 'Copy summary</button>' +
            (phone ? '<a class="btn btn--primary" href="' + esc(A.waLink(phone, 'Hi ' + ((o.customer && o.customer.name) || '') + ', about your Cola Studio order ' + (o.ref || ''))) + '" target="_blank" rel="noopener">' + icon('whatsapp', 16) + 'WhatsApp</a>' : ''),
          onClose: () => {
            drawer = null;
            draw();
          },
        });
        drawer.el.addEventListener('change', (e) => {
          if (e.target.matches('[data-d-status]')) setStatus(o, e.target.value);
        });
        drawer.el.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-d]');
          if (!b) return;
          if (b.dataset.d === 'copy') ui.copy(summary(o), 'Order summary');
          else if (b.dataset.d === 'note') {
            const note = drawer.el.querySelector('#o-note').value;
            try {
              await ui.busy(b, () => A.data.patchCollection('orders', o.id, { adminNote: note }));
              o.adminNote = note;
              ui.toast('Note saved');
            } catch (err) {
              ui.error(err);
            }
          } else if (b.dataset.d === 'delete') {
            if (!(await ui.confirm({ title: 'Delete order ' + (o.ref || '') + '?', body: 'It is removed from the dashboard. This cannot be undone.', confirmText: 'Delete order', danger: true }))) return;
            try {
              await A.data.deleteCollectionItem('orders', o.id);
              orders = orders.filter((x) => x.id !== o.id);
              drawer.close();
              ui.toast('Order deleted');
              A.app.refreshBadges();
            } catch (err) {
              ui.error(err);
            }
          }
        });
      }

      root.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-status]');
        if (tab) {
          st.status = tab.dataset.status;
          return draw();
        }
        if (e.target.closest('select')) return;
        const tr = e.target.closest('tr[data-id]');
        if (tr) open(orders.find((o) => o.id === tr.dataset.id));
      });
      root.addEventListener('change', (e) => {
        if (!e.target.matches('[data-status-sel]')) return;
        const o = orders.find((x) => x.id === e.target.closest('tr').dataset.id);
        setStatus(o, e.target.value);
      });
      root.querySelector('[data-q]').addEventListener('input', A.debounce((e) => {
        st.q = e.target.value;
        draw();
      }, 120));
      draw();
      if (ctx.query.id) {
        const o = orders.find((x) => x.id === ctx.query.id);
        if (o) open(o);
      }
      return { destroy: () => drawer && drawer.close() };
    },
  };

  /* ============================================================= messages */

  A.views.messages = {
    title: 'Messages',
    skeleton: 'table',
    async render(root, params, ctx) {
      if (!A.data.caps.inbox) return serverOnly(root, 'Messages', 'Contact-form messages are stored by the server.');
      let messages = await A.data.getCollection('messages');
      if (ctx.stale()) return null;
      const st = { view: 'inbox', q: '' };
      let drawer = null;

      root.innerHTML =
        '<header class="page-head"><div class="page-head__text"><h1 data-count></h1><p class="lead">Messages sent through the contact form.</p></div></header>' +
        '<div class="card"><div class="tabs" data-tabs></div><div class="toolbar"><label class="search">' + icon('search', 16) + '<input class="input" type="search" data-search data-q placeholder="Search name, email or text" aria-label="Search messages"><kbd>/</kbd></label></div>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th class="shrink"></th><th>From</th><th>Topic</th><th>Message</th><th>Received</th><th class="shrink"></th></tr></thead><tbody data-rows></tbody></table></div><div data-empty></div></div>';

      function draw() {
        const c = { inbox: messages.filter((m) => !m.archived).length, unread: messages.filter((m) => !m.read && !m.archived).length, archived: messages.filter((m) => m.archived).length };
        root.querySelector('[data-count]').innerHTML = A.heading('Messages', c.unread ? c.unread + ' unread' : messages.length);
        root.querySelector('[data-tabs]').innerHTML = [['inbox', 'Inbox'], ['unread', 'Unread'], ['archived', 'Archived']].map(([v, l]) => '<button type="button" class="tab' + (st.view === v ? ' is-active' : '') + '" data-view="' + v + '">' + l + '<span class="count">' + c[v] + '</span></button>').join('');
        const q = st.q.toLowerCase();
        const list = messages.filter((m) => (st.view === 'archived' ? m.archived : !m.archived && (st.view !== 'unread' || !m.read)) && (!q || (m.name + ' ' + m.email + ' ' + m.whatsapp + ' ' + m.topic + ' ' + m.message).toLowerCase().includes(q)));
        root.querySelector('[data-rows]').innerHTML = list
          .map(
            (m) =>
              '<tr class="is-clickable' + (m.read ? '' : ' is-unread') + '" data-id="' + esc(m.id) + '"><td class="shrink">' + (m.read ? '' : '<span class="unread-dot" title="Unread"></span>') + '</td>' +
              '<td><span class="cell-title">' + esc(m.name) + '</span><span class="cell-sub">' + esc(m.email || m.whatsapp || '') + '</span></td>' +
              '<td class="nowrap">' + esc(m.topic || '—') + '</td>' +
              '<td><span class="ellipsis" style="display:block;max-width:420px">' + esc(m.message) + '</span></td>' +
              '<td class="nowrap small muted" title="' + esc(A.dateTime(m.createdAt)) + '">' + esc(A.ago(m.createdAt)) + '</td>' +
              '<td class="shrink">' + icon('chevronRight', 16) + '</td></tr>'
          )
          .join('');
        root.querySelector('[data-empty]').innerHTML = list.length ? '' : ui.empty({ icon: 'messages', title: st.view === 'unread' ? 'All caught up' : st.view === 'archived' ? 'Nothing archived' : 'No messages yet', body: st.view === 'inbox' && !messages.length ? 'Contact form submissions land here.' : '', compact: true });
      }

      async function patch(m, body, msg) {
        try {
          await A.data.patchCollection('messages', m.id, body);
          Object.assign(m, body);
          if (msg) ui.toast(msg);
          A.app.refreshBadges();
        } catch (e) {
          ui.error(e);
        }
      }

      function open(m) {
        if (!m.read) patch(m, { read: true });
        const subject = 'Re: ' + (m.topic || 'your message to Cola Studio');
        const replyText = 'Hi ' + m.name + ',\n\n';
        drawer = ui.drawer({
          titleHtml: esc(m.topic || 'Message') + ' <span class="faint" style="font-weight:300">· ' + esc(m.name) + '</span>',
          width: '560px',
          content:
            '<dl class="dl"><dt>From</dt><dd>' + esc(m.name) + '</dd>' +
            (m.email ? '<dt>Email</dt><dd>' + contactLinks(m.email) + '</dd>' : '') +
            (m.whatsapp ? '<dt>WhatsApp</dt><dd>' + contactLinks(m.whatsapp, replyText) + '</dd>' : '') +
            '<dt>Topic</dt><dd>' + esc(m.topic || '—') + '</dd><dt>Received</dt><dd>' + esc(A.dateTime(m.createdAt)) + '</dd></dl>' +
            '<div class="msg-body">' + esc(m.message) + '</div>',
          footer:
            '<button type="button" class="btn btn--danger" data-d="delete" aria-label="Delete message">' + icon('trash', 16) + '</button>' +
            '<button type="button" class="btn btn--ghost" data-d="archive">' + (m.archived ? 'Move to inbox' : 'Archive') + '</button>' +
            '<button type="button" class="btn btn--ghost" data-d="unread">Mark unread</button><span class="sp"></span>' +
            '<button type="button" class="btn btn--secondary" data-d="copy">' + icon('copy', 16) + 'Copy</button>' +
            (m.whatsapp && A.isPhoneLike(m.whatsapp) ? '<a class="btn btn--secondary" href="' + esc(A.waLink(m.whatsapp, replyText)) + '" target="_blank" rel="noopener">' + icon('whatsapp', 16) + 'WhatsApp</a>' : '') +
            (m.email ? '<a class="btn btn--primary" href="mailto:' + esc(m.email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(replyText) + '">' + icon('messages', 16) + 'Reply</a>' : ''),
          onClose: () => {
            drawer = null;
            draw();
          },
        });
        drawer.el.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-d]');
          if (!b) return;
          if (b.dataset.d === 'copy') ui.copy(m.name + (m.email ? ' <' + m.email + '>' : '') + (m.whatsapp ? ' · ' + m.whatsapp : '') + '\n' + (m.topic || '') + '\n\n' + m.message, 'Message');
          else if (b.dataset.d === 'archive') {
            await patch(m, { archived: !m.archived }, m.archived ? 'Moved to inbox' : 'Archived');
            drawer.close();
          } else if (b.dataset.d === 'unread') {
            await patch(m, { read: false }, 'Marked as unread');
            drawer.close();
          } else if (b.dataset.d === 'delete') {
            if (!(await ui.confirm({ title: 'Delete this message?', body: 'From ' + esc(m.name) + '. This cannot be undone.', confirmText: 'Delete message', danger: true }))) return;
            try {
              await A.data.deleteCollectionItem('messages', m.id);
              messages = messages.filter((x) => x.id !== m.id);
              drawer.close();
              ui.toast('Message deleted');
              A.app.refreshBadges();
            } catch (err) {
              ui.error(err);
            }
          }
        });
      }

      root.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-view]');
        if (tab) {
          st.view = tab.dataset.view;
          return draw();
        }
        const tr = e.target.closest('tr[data-id]');
        if (tr) open(messages.find((m) => m.id === tr.dataset.id));
      });
      root.querySelector('[data-q]').addEventListener('input', A.debounce((e) => {
        st.q = e.target.value;
        draw();
      }, 120));
      draw();
      if (ctx.query.id) {
        const m = messages.find((x) => x.id === ctx.query.id);
        if (m) open(m);
      }
      return { destroy: () => drawer && drawer.close() };
    },
  };

  /* ============================================================= restock */

  A.views.restock = {
    title: 'Restock requests',
    skeleton: 'table',
    async render(root, params, ctx) {
      if (!A.data.caps.inbox) return serverOnly(root, 'Restock requests', 'Customers ask to be notified about sold-out sizes on the product page; the server stores those requests.');
      let [list, products, settings] = await Promise.all([A.data.getCollection('notify'), A.data.getProducts(), A.data.getSettings()]);
      if (ctx.stale()) return null;
      const st = { view: 'waiting' };
      const byId = new Map(products.map((p) => [p.id, p]));

      root.innerHTML =
        '<header class="page-head"><div class="page-head__text"><h1 data-count></h1><p class="lead">People waiting for a sold-out size. Mark them notified once you have let them know.</p></div></header>' +
        '<div data-top></div><div class="card"><div class="tabs" data-tabs></div><div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Variant</th><th>Stock now</th><th>Contact</th><th>Requested</th><th>Notified</th><th class="shrink"></th></tr></thead><tbody data-rows></tbody></table></div><div data-empty></div></div>';

      function variantOf(n) {
        const p = byId.get(n.productId);
        return p && n.sku ? (p.variants || []).find((v) => v.sku === n.sku) : null;
      }

      function draw() {
        const waiting = list.filter((n) => !n.notifiedAt);
        root.querySelector('[data-count]').innerHTML = A.heading('Restock requests', waiting.length + ' waiting');
        root.querySelector('[data-tabs]').innerHTML = [['waiting', 'Waiting', waiting.length], ['notified', 'Notified', list.length - waiting.length], ['all', 'All', list.length]].map(([v, l, n]) => '<button type="button" class="tab' + (st.view === v ? ' is-active' : '') + '" data-view="' + v + '">' + l + '<span class="count">' + n + '</span></button>').join('');
        // most requested (waiting) — the restock signal
        const tally = new Map();
        waiting.forEach((n) => {
          const k = n.productId + '|' + (n.sku || '');
          tally.set(k, (tally.get(k) || 0) + 1);
        });
        const top = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
        root.querySelector('[data-top]').innerHTML = top.length
          ? '<div class="card" style="margin-bottom:20px"><div class="card__head"><span class="card__title">Most requested</span></div><ul class="list">' +
            top
              .map(([k, n]) => {
                const [pid, sku] = k.split('|');
                const p = byId.get(pid);
                const v = p && (p.variants || []).find((x) => x.sku === sku);
                return '<li><a class="list__item" href="' + A.href('/products/' + encodeURIComponent(pid) + '?section=variants') + '"><span class="thumb thumb--sm">' + (p ? A.productThumb(p, { color: v && v.color }) : '') + '</span><span class="list__main"><span class="list__title">' + esc(p ? p.name : pid) + '</span><span class="list__sub">' + esc(v ? [v.color, v.size].filter(Boolean).join(' · ') : sku || 'Any size') + '</span></span><span class="list__end"><b>' + n + '</b> waiting<div class="small faint">' + esc(v ? v.stock + ' in stock' : '') + '</div></span></a></li>';
              })
              .join('') +
            '</ul></div>'
          : '';
        const rows = list.filter((n) => (st.view === 'all' ? true : st.view === 'waiting' ? !n.notifiedAt : !!n.notifiedAt));
        root.querySelector('[data-rows]').innerHTML = rows
          .map((n) => {
            const p = byId.get(n.productId);
            const v = variantOf(n);
            const status = v ? A.stockStatus(v, p, settings) : null;
            return (
              '<tr data-id="' + esc(n.id) + '"><td><div class="cell-main"><span class="thumb thumb--sm">' + (p ? A.productThumb(p, { color: v && v.color }) : '') + '</span><span class="cell-title">' + esc(p ? p.name : n.productId) + '</span></div></td>' +
              '<td class="nowrap">' + esc(v ? [v.color, v.size].filter(Boolean).join(' · ') : n.sku || 'Any size') + (n.sku ? '<span class="cell-sub mono">' + esc(n.sku) + '</span>' : '') + '</td>' +
              '<td>' + (v ? A.stockPill(status, '(' + v.stock + ')') : '<span class="faint">—</span>') + '</td>' +
              '<td>' + contactLinks(n.contact, 'Hi! Good news from Cola Studio — ' + (p ? p.name : 'the item') + (v ? ' (' + [v.color, v.size].filter(Boolean).join(' / ') + ')' : '') + ' is back in stock.') + '</td>' +
              '<td class="nowrap small muted" title="' + esc(A.dateTime(n.createdAt)) + '">' + esc(A.ago(n.createdAt)) + '</td>' +
              '<td>' + ui.toggle('data-notified', !!n.notifiedAt, n.notifiedAt ? A.date(n.notifiedAt) : '') + '</td>' +
              '<td class="shrink"><div class="row-actions"><button type="button" class="icon-btn icon-btn--sm" data-copy aria-label="Copy contact" title="Copy contact">' + icon('copy', 15) + '</button><button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-del aria-label="Delete request" title="Delete">' + icon('trash', 15) + '</button></div></td></tr>'
            );
          })
          .join('');
        root.querySelector('[data-empty]').innerHTML = rows.length ? '' : ui.empty({ icon: 'restock', title: st.view === 'waiting' ? 'Nobody is waiting' : 'No requests here', body: st.view === 'waiting' ? 'Requests appear when a customer asks to be told about a sold-out size.' : '', compact: true });
      }

      root.addEventListener('click', async (e) => {
        const tab = e.target.closest('[data-view]');
        if (tab) {
          st.view = tab.dataset.view;
          return draw();
        }
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const n = list.find((x) => x.id === tr.dataset.id);
        if (e.target.closest('[data-copy]')) ui.copy(n.contact, 'Contact');
        else if (e.target.closest('[data-del]')) {
          if (!(await ui.confirm({ title: 'Delete this request?', body: esc(n.contact), confirmText: 'Delete', danger: true }))) return;
          try {
            await A.data.deleteCollectionItem('notify', n.id);
            list = list.filter((x) => x.id !== n.id);
            draw();
            A.app.refreshBadges();
          } catch (err) {
            ui.error(err);
          }
        }
      });
      root.addEventListener('change', async (e) => {
        if (!e.target.matches('[data-notified]')) return;
        const n = list.find((x) => x.id === e.target.closest('tr').dataset.id);
        try {
          const r = await A.data.patchCollection('notify', n.id, { notified: e.target.checked });
          n.notifiedAt = (r.item && r.item.notifiedAt) || (e.target.checked ? new Date().toISOString() : null);
          ui.toast(e.target.checked ? 'Marked as notified' : 'Moved back to waiting');
          draw();
          A.app.refreshBadges();
        } catch (err) {
          e.target.checked = !e.target.checked;
          ui.error(err);
        }
      });
      draw();
      return null;
    },
  };
})();
