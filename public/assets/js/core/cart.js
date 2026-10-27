/* ==========================================================================
   COLA STUDIO — core/cart.js
   The order list ("bag"), saved items, recently viewed, the WhatsApp order
   message and agent / Weidian link building.
   ========================================================================== */
(function () {
  'use strict';
  var Cola = window.Cola;
  var KEY = 'cola.bag.v1', SAVED = 'cola.saved.v1', RECENT = 'cola.recent.v1', ORDERS = 'cola.orders.v1';

  // Ignore malformed entries (old versions, manual edits) instead of rendering "undefined".
  function read() {
    var v = Cola.store.get(KEY, []);
    return Array.isArray(v) ? v.filter(function (i) { return i && i.productId && i.name && i.qty > 0; }).map(function (i) {
      if (!i.key) i.key = i.sku || (i.productId + '|' + (i.color || '') + '|' + (i.size || ''));
      return i;
    }) : [];
  }
  function write(items) { Cola.store.set(KEY, items); Cola.emit('bag:change', items); }

  var bag = (Cola.bag = {
    items: read,
    count: function () { return read().reduce(function (a, i) { return a + (i.qty || 0); }, 0); },
    subtotal: function () { return read().reduce(function (a, i) { return a + (i.price || 0) * (i.qty || 0); }, 0); },
    weight: function () { return read().reduce(function (a, i) { return a + (i.weightKg || 0) * (i.qty || 0); }, 0); },

    /** Add a product variant. Returns the line item. */
    add: function (p, opts) {
      opts = opts || {};
      var color = opts.color || ((p.colors || [])[0] || {}).name || '';
      var size = opts.size || ((p.sizes || []).length === 1 ? p.sizes[0] : '');
      var v = Cola.stock.find(p, color, size);
      var items = read();
      var key = (v && v.sku) || (p.id + '|' + color + '|' + size);
      var existing = items.find(function (i) { return i.key === key; });
      var qty = Math.max(1, parseInt(opts.qty, 10) || 1);
      if (existing) existing.qty = Math.min(99, existing.qty + qty);
      else {
        existing = {
          key: key, sku: v ? v.sku : '', productId: p.id, slug: p.slug, name: p.name, subtitle: p.subtitle || '',
          color: color, colorHex: Cola.media.colorHex(p, color), size: size, qty: qty, price: p.price,
          garment: p.garment, print: p.print || null, image: (p.images && p.images[0] && p.images[0].url) || '', weightKg: p.weightKg || 0,
          preorder: !!(v && v.preorder), sizes: p.sizes || [], addedAt: new Date().toISOString()
        };
        items.push(existing);
      }
      write(items);
      return existing;
    },
    setQty: function (key, qty) {
      var items = read(), it = items.find(function (i) { return i.key === key; });
      if (!it) return;
      qty = parseInt(qty, 10) || 0;
      if (qty <= 0) items = items.filter(function (i) { return i.key !== key; }); else it.qty = Math.min(99, qty);
      write(items);
    },
    /** Change size on a line (re-keys to the matching SKU, merging duplicates). */
    setSize: function (key, size, product) {
      var items = read(), it = items.find(function (i) { return i.key === key; });
      if (!it) return;
      var v = product ? Cola.stock.find(product, it.color, size) : null;
      var newKey = (v && v.sku) || (it.productId + '|' + it.color + '|' + size);
      var dup = items.find(function (i) { return i.key === newKey && i !== it; });
      if (dup) { dup.qty = Math.min(99, dup.qty + it.qty); items = items.filter(function (i) { return i !== it; }); }
      else { it.size = size; it.key = newKey; it.sku = v ? v.sku : ''; it.preorder = !!(v && v.preorder); }
      write(items);
    },
    remove: function (key) { write(read().filter(function (i) { return i.key !== key; })); },
    clear: function () { write([]); },
    restore: function (items) { write(items || []); },

    // ---- Saved (wishlist)
    saved: function () { return Cola.store.get(SAVED, []); },
    isSaved: function (id) { return bag.saved().indexOf(id) >= 0; },
    toggleSave: function (id) {
      var s = bag.saved(), i = s.indexOf(id);
      if (i >= 0) s.splice(i, 1); else s.unshift(id);
      Cola.store.set(SAVED, s.slice(0, 60)); Cola.emit('saved:change', s);
      return i < 0;
    },

    // ---- Recently viewed
    recent: function () { return Cola.store.get(RECENT, []); },
    pushRecent: function (id) { var r = bag.recent().filter(function (x) { return x !== id; }); r.unshift(id); Cola.store.set(RECENT, r.slice(0, 12)); },

    // ---- Past order references (local only)
    history: function () { return Cola.store.get(ORDERS, []); },
    remember: function (order) { var h = bag.history(); h.unshift(order); Cola.store.set(ORDERS, h.slice(0, 20)); }
  });

  // ---------------------------------------------------------------------------
  // Order reference + WhatsApp message
  // ---------------------------------------------------------------------------
  var order = (Cola.order = {
    ref: function () {
      var s = Cola.data.settings || {}, prefix = (s.whatsapp && s.whatsapp.orderPrefix) || 'CS';
      var d = new Date(), y = String(d.getFullYear()).slice(-2), m = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2);
      var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = '';
      for (var i = 0; i < 4; i++) r += chars[Math.floor(Math.random() * chars.length)];
      return prefix + '-' + y + m + dd + '-' + r;
    },
    number: function () { var s = Cola.data.settings || {}; return String((s.whatsapp && s.whatsapp.number) || '').replace(/\D/g, ''); },
    enabled: function () { var s = Cola.data.settings || {}; return !!(s.whatsapp && s.whatsapp.enabled !== false && order.number()); },
    waLink: function (text) { var n = order.number(); return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : ''); },

    /** Build the pre-filled WhatsApp order message. */
    message: function (items, customer, ref) {
      customer = customer || {};
      var s = Cola.data.settings || {}, cur = Cola.money.current();
      var greeting = (s.whatsapp && s.whatsapp.greeting) || 'Hello Cola Studio';
      var L = [];
      L.push(greeting + ' 👋');
      L.push('I would like to place an order' + (customer.channel === 'agent' ? ' (I will pay through my agent)' : '') + '.');
      L.push('');
      L.push('*Order ref:* ' + ref);
      L.push('————————————');
      items.forEach(function (it, i) {
        L.push((i + 1) + ') *' + it.name + '*');
        L.push('    Colour: ' + it.color + ' · Size: ' + (it.size || '—') + ' · Qty: ' + it.qty);
        L.push('    ' + Cola.money.cny(it.price) + ' each' + (it.sku ? ' · SKU ' + it.sku : '') + (it.preorder ? ' · PRE-ORDER' : ''));
      });
      L.push('————————————');
      var sub = items.reduce(function (a, i) { return a + i.price * i.qty; }, 0);
      var count = items.reduce(function (a, i) { return a + i.qty; }, 0);
      L.push('*Items:* ' + count);
      L.push('*Subtotal:* ' + Cola.money.cny(sub) + (cur !== 'CNY' ? ' (≈ ' + Cola.money.format(sub, cur) + ')' : ''));
      var info = [];
      if (customer.name) info.push('*Full name:* ' + customer.name);
      if (customer.email) info.push('*Email:* ' + customer.email);
      if (customer.phone) info.push('*Phone:* ' + customer.phone);
      if (customer.address) info.push('*Address:* ' + customer.address);
      if (customer.postcode) info.push('*Postcode:* ' + customer.postcode);
      if (customer.city) info.push('*City:* ' + customer.city);
      if (customer.country) info.push('*Country:* ' + customer.country);
      if (customer.contact) info.push('*Contact:* ' + customer.contact);
      if (info.length) { L.push(''); L = L.concat(info); }
      if (customer.notes) { L.push(''); L.push('*Notes:* ' + customer.notes); }
      L.push('');
      L.push('Could you confirm availability and the total including shipping? Thank you!');
      return L.join('\n');
    },

    /** Short message for a single product (quick "Order via WhatsApp"). */
    quickMessage: function (p, color, size, qty) {
      var item = { name: p.name, color: color, size: size, qty: qty || 1, price: p.price, sku: (Cola.stock.find(p, color, size) || {}).sku || '' };
      return order.message([item], {}, order.ref());
    },
    notifyMessage: function (p, color, size) {
      var s = Cola.data.settings || {};
      return ((s.whatsapp && s.whatsapp.greeting) || 'Hello Cola Studio') + ' 👋\nCould you let me know when the *' + p.name + '* in ' + color + (size ? ', size ' + size : '') + ' is back in stock?\n\nThank you!';
    },

    // ---- Agents & Weidian
    weidianUrl: function (p) {
      var s = Cola.data.settings || {}, w = p.weidian || {};
      if (w.url) return w.url;
      if (w.itemId && s.weidian && s.weidian.itemUrlTemplate) return s.weidian.itemUrlTemplate.replace('{itemId}', encodeURIComponent(w.itemId));
      return '';
    },
    agents: function () { var s = Cola.data.settings || {}; return (s.agents || []).filter(function (a) { return a.enabled !== false; }); },
    /** Resolve an agent link for a product. Empty string = not configured yet. */
    agentUrl: function (agent, p) {
      var override = p && p.agentLinks && p.agentLinks[agent.id];
      if (override) return override;
      var t = agent.urlTemplate || '';
      if (!t) return '';
      var wurl = p ? order.weidianUrl(p) : '';
      if (/\{weidianUrl\}|\{itemId\}/.test(t) && p && !wurl && !(p.weidian && p.weidian.itemId)) return '';
      return t.replace(/\{weidianUrl\}/g, encodeURIComponent(wurl)).replace(/\{itemId\}/g, encodeURIComponent((p && p.weidian && p.weidian.itemId) || ''))
        .replace(/\{slug\}/g, encodeURIComponent((p && p.slug) || '')).replace(/\{name\}/g, encodeURIComponent((p && p.name) || ''));
    },

    /** Log an order intent on the server (dashboard). Never blocks the WhatsApp flow. */
    log: function (ref, items, customer, channel) {
      return Cola.data.post('/api/orders', {
        ref: ref, channel: channel || 'whatsapp', currency: Cola.money.current(),
        items: items.map(function (i) { return { productId: i.productId, sku: i.sku, name: i.name, color: i.color, size: i.size, qty: i.qty, price: i.price }; }),
        customer: { name: customer.name || '', email: customer.email || '', phone: customer.phone || '', address: customer.address || '', postcode: customer.postcode || '', city: customer.city || '', country: customer.country || '' }
      });
    }
  });
})();
