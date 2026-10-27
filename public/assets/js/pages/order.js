/* COLA STUDIO — Order builder (WhatsApp checkout) */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var PRODUCTS = [], REF = null, DETAILS_KEY = 'cola.details.v1';
  var COUNTRIES = ['Netherlands', 'Belgium', 'Germany', 'France', 'United Kingdom', 'Ireland', 'Spain', 'Portugal', 'Italy', 'Switzerland', 'Austria', 'Denmark', 'Sweden', 'Norway', 'Finland', 'Poland', 'Czech Republic', 'Hungary', 'Romania', 'Greece', 'Luxembourg', 'Estonia', 'Latvia', 'Lithuania', 'Slovakia', 'Slovenia', 'Croatia', 'Bulgaria', 'United States', 'Canada', 'Mexico', 'Brazil', 'Australia', 'New Zealand', 'Japan', 'South Korea', 'Singapore', 'Hong Kong', 'Taiwan', 'Malaysia', 'Thailand', 'Philippines', 'Indonesia', 'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Israel', 'Turkey', 'South Africa', 'Other'];

  Cola.boot(function () {
    REF = Cola.session.get('cola.ref', null) || Cola.order.ref();
    Cola.session.set('cola.ref', REF);
    $('[data-countries]').innerHTML = '<option value="">Select country</option>' + COUNTRIES.map(function (c) { return '<option>' + c + '</option>'; }).join('');
    var agents = Cola.order.agents();
    $('[data-agent-select]').innerHTML = '<option value="">Choose your agent</option>' + agents.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>'; }).join('') + '<option value="other">Another agent</option>';
    restoreDetails();
    return Cola.data.products().then(function (list) {
      PRODUCTS = list;
      deepLinkAdd();
      bind();
      renderAll();
      history();
    });
  });

  // ?add=slug:Colour:Size:qty,slug2:...  — shareable order links
  function deepLinkAdd() {
    var add = Cola.param('add'); if (!add) return;
    var n = 0;
    add.split(',').forEach(function (chunk) {
      var p = chunk.split(':').map(decodeURIComponent);
      var prod = PRODUCTS.find(function (x) { return x.slug === p[0]; }); if (!prod) return;
      var color = prod.colors.some(function (c) { return c.name === p[1]; }) ? p[1] : prod.colors[0].name;
      var size = prod.sizes.indexOf(p[2]) >= 0 ? p[2] : (prod.sizes.length === 1 ? prod.sizes[0] : prod.sizes[Math.floor(prod.sizes.length / 2)]);
      Cola.bag.add(prod, { color: color, size: size, qty: parseInt(p[3], 10) || 1 }); n++;
    });
    var url = new URL(location.href); url.searchParams.delete('add'); window.history.replaceState(null, '', url.pathname + url.search);
    if (n) Cola.ui.toast(n + ' item' + (n > 1 ? 's' : '') + ' added from your link', { icon: 'bag' });
  }

  function details() {
    var f = $('[data-details]'), d = {};
    ['name', 'email', 'phone', 'address', 'postcode', 'city', 'country', 'notes', 'agent'].forEach(function (k) { d[k] = ((f[k] && f[k].value) || '').trim(); });
    d.channel = (f.querySelector('[name="channel"]:checked') || {}).value || 'whatsapp';
    var ag = Cola.order.agents().find(function (a) { return a.id === d.agent; });
    d.agentName = ag ? ag.name : (d.agent === 'other' ? 'another agent' : '');
    return d;
  }
  function saveDetails() { var d = details(); Cola.store.set(DETAILS_KEY, d); }
  function restoreDetails() {
    var d = Cola.store.get(DETAILS_KEY, null); if (!d) return;
    var f = $('[data-details]');
    ['name', 'email', 'phone', 'address', 'postcode', 'city', 'country', 'notes', 'agent'].forEach(function (k) { if (d[k] != null && f[k]) f[k].value = d[k]; });
    var r = f.querySelector('[name="channel"][value="' + (d.channel || 'whatsapp') + '"]'); if (r) r.checked = true;
  }

  function message() {
    var d = details();
    var c = { name: d.name, email: d.email, phone: d.phone, address: d.address, postcode: d.postcode, city: d.city, country: d.country, channel: d.channel, notes: d.notes };
    if (d.channel === 'agent' && d.agentName) c.notes = (c.notes ? c.notes + '\n' : '') + 'Agent: ' + d.agentName;
    return Cola.order.message(Cola.bag.items(), c, REF);
  }

  function renderAll() { lines(); summary(); preview(); agentLinks(); steps(); }

  function lines() {
    var items = Cola.bag.items(), host = $('[data-lines]');
    $('[data-line-count]').textContent = items.length ? '(' + Cola.bag.count() + ')' : '';
    if (!items.length) {
      host.innerHTML = '<div class="order-empty">' + Cola.brand.engraving('spool', 'empty__art') + '<div><p class="h4">Your order list is empty</p><p class="small muted">Add pieces from the collection or the live stock page — or use the field below.</p></div><a class="btn btn--sm" href="' + Cola.url('products') + '">Shop the collection</a></div>';
      return;
    }
    host.innerHTML = '<div class="olines">' + items.map(function (it) {
      var p = PRODUCTS.find(function (x) { return x.id === it.productId; });
      var v = p ? Cola.stock.find(p, it.color, it.size) : null, st = p ? Cola.stock.variant(v, p) : 'instock';
      var sizes = p && p.sizes.length > 1 ? '<select class="select select--mini" data-o-size aria-label="Size">' + p.sizes.map(function (s) { var vv = Cola.stock.find(p, it.color, s), ss = Cola.stock.variant(vv, p); return '<option value="' + esc(s) + '"' + (s === it.size ? ' selected' : '') + '>' + esc(s) + (Cola.stock.available(ss) ? '' : ' — sold out') + '</option>'; }).join('') + '</select>' : '<span class="tiny">' + esc(it.size || 'One size') + '</span>';
      // Older list entries may lack the drawing details — fall back to the product itself.
      var hex = it.colorHex || (p ? Cola.media.colorHex(p, it.color) : '');
      var img = it.image ? '<img src="' + esc(it.image) + '" alt="">' : !it.garment && p ? Cola.media.productImage(p, { color: it.color }) : Cola.media.garment(it.garment, { color: hex, print: it.print });
      return '<div class="oline" data-key="' + esc(it.key) + '"><a class="oline__img" href="' + Cola.url('product', { slug: it.slug || (p && p.slug) }) + '" style="--tint:' + Cola.media.tint(hex) + '">' + img + '</a>' +
        '<div class="oline__main"><div><a class="oline__name" href="' + Cola.url('product', { slug: it.slug }) + '">' + esc(it.name) + '</a><p class="tiny subtle">' + esc(it.color) + (it.sku ? ' · ' + esc(it.sku) : '') + '</p></div>' +
        '<div class="oline__controls">' + sizes + '<div class="qty qty--sm"><button type="button" data-o-dec aria-label="Decrease">−</button><input type="number" min="1" max="99" value="' + it.qty + '" data-o-qty aria-label="Quantity"><button type="button" data-o-inc aria-label="Increase">+</button></div></div>' +
        '<div class="oline__stock">' + Cola.stock.html(st, null) + '</div></div>' +
        '<div class="oline__end"><span class="oline__price">' + Cola.c.price(it.price * it.qty) + '</span><span class="tiny subtle">' + (it.qty > 1 ? it.qty + ' × ' + Cola.money.format(it.price, null, { round: true }) : '') + '</span><button class="icon-btn" type="button" data-o-remove aria-label="Remove ' + esc(it.name) + '">' + Cola.icon('close') + '</button></div></div>';
    }).join('') + '</div>';
    Cola.rewriteLinks(host);
  }

  function summary() {
    var items = Cola.bag.items(), sub = Cola.bag.subtotal(), cur = Cola.money.current(), w = Cola.bag.weight();
    $('[data-ref]').textContent = REF;
    $('[data-summary]').innerHTML =
      '<dt>Items</dt><dd>' + Cola.bag.count() + '</dd>' +
      '<dt>Subtotal</dt><dd>' + Cola.c.price(sub) + '</dd>' +
      (cur !== 'CNY' ? '<dt>Charged in CNY</dt><dd>' + Cola.money.cny(sub) + '</dd>' : '') +
      '<dt>Est. parcel weight</dt><dd>' + (w ? w.toFixed(1) + ' kg' : '—') + '</dd>' +
      '<dt>Shipping</dt><dd class="subtle">Quoted in chat</dd>';
    var dis = !items.length;
    ['[data-send]', '[data-copy-msg]', '[data-download]'].forEach(function (s) { var el = $(s); if (el) el.disabled = dis; });
    if (!Cola.order.enabled()) { $('[data-send]').disabled = true; $('[data-send]').title = 'WhatsApp number not configured'; }
  }

  function preview() {
    var items = Cola.bag.items();
    $('[data-preview]').innerHTML = items.length ? esc(message()).replace(/\*([^*\n]+)\*/g, '<b>$1</b>') + '<time>' + Cola.fmtDate(new Date(), 'time') + '</time>' : '<span class="subtle">Your message appears here as you build your order.</span>';
  }

  function agentLinks() {
    var d = details(), wrap = $('[data-agent-links]');
    $('[data-agent-field]').hidden = d.channel !== 'agent';
    var items = Cola.bag.items();
    if (d.channel !== 'agent' || !items.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    var agent = Cola.order.agents().find(function (a) { return a.id === d.agent; });
    $('[data-agent-list]').innerHTML = items.map(function (it) {
      var p = PRODUCTS.find(function (x) { return x.id === it.productId; });
      var url = agent && p ? Cola.order.agentUrl(agent, p) : '';
      var wd = p ? Cola.order.weidianUrl(p) : '';
      return '<div class="agent-line"><span><b>' + esc(it.name) + '</b><small>' + esc(it.color) + ' · ' + esc(it.size || '') + ' × ' + it.qty + '</small></span>' +
        (url ? '<a class="btn btn--sm" target="_blank" rel="noopener" href="' + esc(url) + '">Open in ' + esc(agent.name) + '</a>'
          : wd ? '<button class="btn btn--sm btn--ghost" type="button" data-copy-link="' + esc(wd) + '">Copy Weidian link</button>'
          : '<span class="tiny subtle">' + (agent ? 'Link coming soon' : 'Choose your agent above') + '</span>') + '</div>';
    }).join('');
  }

  function steps() {
    var d = details(), has = Cola.bag.items().length;
    var det = $('[data-step-details]'), send = $('[data-step-send]');
    if (!det || !send) return;
    det.classList.toggle('is-active', has && !!(d.name || d.country));
    send.classList.toggle('is-active', has && !!d.name && !!d.country);
  }

  // add-product search
  function addSearch(q) {
    var box = $('[data-add-results]');
    q = q.trim().toLowerCase();
    if (!q) { box.hidden = true; return; }
    var hits = PRODUCTS.filter(function (p) { return (p.name + ' ' + p.subtitle + ' ' + p.category).toLowerCase().indexOf(q) >= 0; }).slice(0, 6);
    box.hidden = false;
    box.innerHTML = hits.length ? hits.map(function (p) {
      return '<div class="add-hit" data-add-id="' + esc(p.id) + '"><span class="add-hit__img" style="--tint:' + Cola.media.tint(Cola.media.colorHex(p)) + '">' + Cola.media.productImage(p) + '</span><div class="add-hit__main"><b>' + esc(p.name) + '</b><div class="row row--wrap" style="--row-gap:6px">' +
        '<select class="select select--mini" data-add-color aria-label="Colour">' + p.colors.map(function (c) { return '<option>' + esc(c.name) + '</option>'; }).join('') + '</select>' +
        (p.sizes.length > 1 ? '<select class="select select--mini" data-add-size aria-label="Size">' + p.sizes.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select>' : '') +
        '</div></div><button class="btn btn--sm" type="button" data-add-go>Add</button></div>';
    }).join('') : '<p class="small subtle" style="padding:14px">No products match “' + esc(q) + '”.</p>';
  }

  function send() {
    var items = Cola.bag.items(); if (!items.length) return;
    var d = details();
    var form = $('[data-details]');
    var missing = [];
    if (!d.name) missing.push(form.name);
    if (!d.country) missing.push(form.country);
    $$('.field', form).forEach(function (f) { f.classList.remove('has-error'); });
    if (missing.length) {
      missing.forEach(function (el) { el.closest('.field').classList.add('has-error'); });
      missing[0].focus();
      Cola.ui.toast('Add your name and country so we can quote shipping', { icon: 'info' });
      return;
    }
    var msg = message();
    Cola.order.log(REF, items, { name: d.name, email: d.email, phone: d.phone, address: d.address, postcode: d.postcode, city: d.city, country: d.country }, d.channel);
    Cola.bag.remember({ ref: REF, at: new Date().toISOString(), items: items, channel: d.channel, total: Cola.bag.subtotal() });
    Cola.openExternal(Cola.order.waLink(msg));
    done(items, msg);
  }

  function done(items, msg) {
    var el = $('[data-done]'), ref = REF;
    $('[data-order-grid]').hidden = true; el.hidden = false;
    var count = items.reduce(function (n, it) { return n + (Number(it.qty) || 1); }, 0);
    var total = items.reduce(function (n, it) { return n + (Number(it.price) || 0) * (Number(it.qty) || 1); }, 0);
    var sum = '<aside class="order-sum" aria-label="What you sent"><div class="order-sum__head"><span class="label">Order</span><span class="order-sum__ref">' + esc(ref) + '</span></div>' +
      '<div class="order-sum__list">' + items.map(function (it) {
        var p = PRODUCTS.find(function (x) { return x.id === it.productId; });
        var hex = it.colorHex || (p ? Cola.media.colorHex(p, it.color) : '');
        var img = it.image ? '<img src="' + esc(it.image) + '" alt="">' : p ? Cola.media.productImage(p, { color: it.color }) : Cola.media.garment(it.garment, { color: hex, print: it.print });
        return '<div class="order-sum__item"><span class="order-sum__img" style="--tint:' + Cola.media.tint(hex) + '">' + img + '</span><div><div class="order-sum__name">' + esc(it.name) + '</div><div class="order-sum__meta">' + esc([it.color, it.size].filter(Boolean).join(' · ')) + (it.qty > 1 ? ' · ' + it.qty + '×' : '') + '</div></div><span>' + Cola.c.price((Number(it.price) || 0) * (Number(it.qty) || 1)) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="order-sum__total"><span>' + count + ' item' + (count === 1 ? '' : 's') + '</span><span>' + Cola.c.price(total) + '</span></div>' +
      '<p class="order-sum__note">Shipping is quoted in the chat. Keep this reference — it is also in your WhatsApp message.</p></aside>';
    el.innerHTML = '<div class="order-done__inner"><div class="order-done__main">' + Cola.brand.engraving('shears', 'order-done__art') +
      '<p class="eyebrow">Order sent</p><h2 class="h1 mt-2">Thank <b>you.</b></h2><p class="lead mt-3">Your order <b>' + esc(ref) + '</b> is waiting in WhatsApp. If the chat did not open, use the button below — the message is ready to go.</p>' +
      '<div class="row row--wrap mt-4"><a class="btn btn--wa" href="' + esc(Cola.order.waLink(msg)) + '" target="_blank" rel="noopener">' + Cola.icon('whatsapp', 'btn__icon') + 'Open WhatsApp again</a><button class="btn btn--ghost" type="button" data-done-clear>Start a new order</button><button class="btn btn--ghost" type="button" data-done-back>Edit this order</button></div>' +
      '<ol class="next-steps mt-6"><li><span class="index">01</span><b>We confirm</b><p class="small muted">Availability, shipping options and your total — usually within a few hours.</p></li><li><span class="index">02</span><b>You pay</b><p class="small muted">Securely, using the payment method we agree on in the chat.</p></li><li><span class="index">03</span><b>We pack &amp; ship</b><p class="small muted">Inspected, packed and shipped with tracking. You get updates in the same chat.</p></li></ol></div>' + sum + '</div>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    el.querySelector('[data-done-clear]').addEventListener('click', function () { Cola.bag.clear(); newRef(); el.hidden = true; $('[data-order-grid]').hidden = false; renderAll(); history(); });
    el.querySelector('[data-done-back]').addEventListener('click', function () { el.hidden = true; $('[data-order-grid]').hidden = false; });
    history();
  }
  function newRef() { REF = Cola.order.ref(); Cola.session.set('cola.ref', REF); }

  function history() {
    var h = Cola.bag.history(), el = $('[data-history]');
    if (!h.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '<div class="section-head"><div><p class="eyebrow">On this device</p><h2 class="h3 mt-2">Previous <b>orders</b></h2></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Date</th><th>Items</th><th>Channel</th><th></th></tr></thead><tbody>' +
      h.slice(0, 8).map(function (o, i) {
        var n = (o.items || []).reduce(function (a, it) { return a + (it.qty || 1); }, 0);
        return '<tr><td class="num"><b>' + esc(o.ref) + '</b></td><td>' + Cola.fmtDate(o.at, 'full') + '</td><td>' + n + ' · ' + esc((o.items || []).map(function (it) { return it.name; }).slice(0, 2).join(', ')) + ((o.items || []).length > 2 ? '…' : '') + '</td><td>' + esc(o.channel || 'whatsapp') + '</td><td class="ta-r"><button class="link link--quiet tiny" type="button" data-reorder="' + i + '">Order again</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function bind() {
    var form = $('[data-details]');
    form.addEventListener('input', Cola.debounce(function () { saveDetails(); preview(); agentLinks(); steps(); }, 120));
    form.addEventListener('change', function () { saveDetails(); preview(); agentLinks(); steps(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    $('[data-lines]').addEventListener('click', function (e) {
      var line = e.target.closest('[data-key]'); if (!line) return;
      var key = line.getAttribute('data-key'), it = Cola.bag.items().find(function (i) { return i.key === key; }); if (!it) return;
      if (e.target.closest('[data-o-remove]')) { Cola.bag.remove(key); Cola.ui.toast('Removed', { sub: it.name, icon: 'close', action: { label: 'Undo', fn: function () { var all = Cola.bag.items(); all.push(it); Cola.bag.restore(all); } } }); }
      if (e.target.closest('[data-o-dec]')) Cola.bag.setQty(key, it.qty - 1);
      if (e.target.closest('[data-o-inc]')) Cola.bag.setQty(key, it.qty + 1);
    });
    $('[data-lines]').addEventListener('change', function (e) {
      var line = e.target.closest('[data-key]'); if (!line) return;
      var key = line.getAttribute('data-key');
      if (e.target.matches('[data-o-qty]')) Cola.bag.setQty(key, e.target.value);
      if (e.target.matches('[data-o-size]')) { var it = Cola.bag.items().find(function (i) { return i.key === key; }); Cola.bag.setSize(key, e.target.value, PRODUCTS.find(function (p) { return p.id === it.productId; })); }
    });
    $('[data-clear-list]').addEventListener('click', function () { var all = Cola.bag.items(); if (!all.length) return; Cola.bag.clear(); Cola.ui.toast('Order list cleared', { icon: 'close', action: { label: 'Undo', fn: function () { Cola.bag.restore(all); } } }); });
    var q = $('[data-add-q]');
    q.addEventListener('input', Cola.debounce(function () { addSearch(q.value); }, 120));
    $('[data-add-results]').addEventListener('click', function (e) {
      var go = e.target.closest('[data-add-go]'); if (!go) return;
      var hit = go.closest('[data-add-id]'), p = PRODUCTS.find(function (x) { return x.id === hit.getAttribute('data-add-id'); });
      var color = hit.querySelector('[data-add-color]').value, sizeEl = hit.querySelector('[data-add-size]'), size = sizeEl ? sizeEl.value : p.sizes[0];
      var v = Cola.stock.find(p, color, size), st = Cola.stock.variant(v, p);
      if (!Cola.stock.available(st)) { Cola.c.notify(p, color, size); return; }
      Cola.bag.add(p, { color: color, size: size, qty: 1 });
      q.value = ''; addSearch('');
      Cola.ui.toast('Added to your order', { sub: p.name + ' · ' + color + ' · ' + size, icon: 'bag' });
    });
    $('[data-send]').addEventListener('click', send);
    $('[data-copy-msg]').addEventListener('click', function () { Cola.copy(message()).then(function (ok) { Cola.ui.toast(ok ? 'Message copied' : 'Copy failed', { sub: ok ? 'Paste it into WhatsApp, Instagram or your agent.' : '', icon: 'copy' }); }); });
    var dl = $('[data-download]'); if (dl) dl.addEventListener('click', function () { Cola.downloadText('cola-studio-order-' + REF + '.txt', message().replace(/\*/g, '')); });
    var nr = $('[data-new-ref]'); if (nr) nr.addEventListener('click', function () { newRef(); renderAll(); });
    document.addEventListener('click', function (e) {
      var c = e.target.closest('[data-copy-link]'); if (c) Cola.copy(c.getAttribute('data-copy-link')).then(function () { Cola.ui.toast('Weidian link copied', { icon: 'copy' }); });
      var r = e.target.closest('[data-reorder]');
      if (r) { var o = Cola.bag.history()[+r.getAttribute('data-reorder')]; if (o) { var all = Cola.bag.items().concat((o.items || []).map(function (it) { return Object.assign({}, it); })); var merged = {}; all.forEach(function (it) { if (merged[it.key]) merged[it.key].qty += it.qty; else merged[it.key] = it; }); Cola.bag.restore(Object.keys(merged).map(function (k) { return merged[k]; })); window.scrollTo({ top: 0, behavior: 'smooth' }); Cola.ui.toast('Items added to your order list', { icon: 'bag' }); } }
    });
    Cola.on('bag:change', renderAll);
    Cola.on('currency:change', renderAll);
  }
})();
