/* ==========================================================================
   COLA STUDIO — core/components.js
   Product cards, the purchase panel (colour / size / qty / order actions),
   quick view, agent sheet, size guide, restock notify.
   ========================================================================== */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var C = (Cola.c = {});

  var BADGE = { new: ['New', ''], bestseller: ['Bestseller', 'badge--dark'], limited: ['Limited', 'badge--accent'], preorder: ['Pre-order', 'badge--dark'], restock: ['Restocked', ''] };

  C.badges = function (p, status, max) {
    var out = [];
    if (status === 'soldout') out.push('<span class="badge badge--dark">Sold out</span>');
    else if (status === 'restocking') out.push('<span class="badge badge--dark">Back ' + (p.restockDate ? Cola.fmtDate(p.restockDate, 'short') : 'soon') + '</span>');
    (p.badges || []).forEach(function (b) {
      if (b === 'restock' && (status === 'restocking' || status === 'soldout')) return;
      if (b === 'preorder' && status !== 'preorder') return;
      var d = BADGE[b]; if (d) out.push('<span class="badge ' + d[1] + '">' + d[0] + '</span>');
    });
    if (status === 'preorder' && (p.badges || []).indexOf('preorder') < 0) out.push('<span class="badge badge--dark">Pre-order</span>');
    return out.slice(0, max || 2).join('');
  };
  C.isDemo = function (p) { var s = Cola.data.settings || {}; return !!(s.demo && (!p || p.demo !== false)); };
  C.code = function (p) { return String(p.id || '').toUpperCase(); };

  /** Price markup that updates live when the currency changes. */
  C.price = function (cny, compare, opts) {
    opts = opts || {};
    return '<span class="price" data-price="' + cny + '"' + (compare ? ' data-compare="' + compare + '"' : '') + (opts.cny ? ' data-cny="1"' : '') + '>' + C.priceInner(cny, compare, opts.cny) + '</span>';
  };
  C.priceInner = function (cny, compare, showCny) {
    var cur = Cola.money.current();
    var s = Cola.money.format(cny, cur, { round: true });
    if (compare && compare > cny) s += '<s>' + Cola.money.format(compare, cur, { round: true }) + '</s>';
    if (showCny && cur !== 'CNY') s += ' <span class="price__alt">' + Cola.money.cny(cny) + '</span>';
    return s;
  };
  C.refreshPrices = function (root) {
    $$('[data-price]', root || document).forEach(function (el) {
      el.innerHTML = C.priceInner(parseFloat(el.getAttribute('data-price')), parseFloat(el.getAttribute('data-compare')) || 0, el.getAttribute('data-cny') === '1');
    });
  };
  Cola.on('currency:change', function () { C.refreshPrices(); });

  // ---------------------------------------------------------------------------
  // Product card
  // ---------------------------------------------------------------------------
  C.card = function (p, o) {
    o = o || {};
    var color = o.color || ((p.colors || [])[0] || {}).name;
    var hexc = Cola.media.colorHex(p, color);
    var status = Cola.stock.product(p);
    var total = Cola.stock.total(p);
    var hasBack = true;
    var url = Cola.productUrl(p, color && (p.colors || []).length > 1 && color !== p.colors[0].name ? { color: color } : null);
    var stLabel = status === 'low' ? 'Only ' + total + ' left' : Cola.stock.labels[status];
    return '<article class="pcard' + (status === 'soldout' ? ' is-soldout' : '') + (o.wide ? ' pcard--wide' : '') + '" data-pid="' + esc(p.id) + '" data-color="' + esc(color) + '"' + (o.reveal !== false ? ' data-reveal style="--d:' + ((o.index || 0) % 4 * 0.07).toFixed(2) + 's"' : '') + '>' +
      '<div class="pcard__media" style="--tint:' + Cola.media.tint(hexc) + '">' +
        '<div class="pcard__badges">' + C.badges(p, status, 1) + '</div>' +
        '<div class="pcard__img pcard__img--main">' + Cola.media.productImage(p, { color: color }) + '</div>' +
        (hasBack ? '<div class="pcard__img pcard__img--alt">' + Cola.media.productImage(p, { color: color, view: 'back' }) + '</div>' : '') +
        (o.quick ? C.quickSizes(p, color) : '') +
      '</div>' +
      '<div class="pcard__info">' +
        '<div class="pcard__row"><h3 class="pcard__name"><a href="' + url + '">' + esc(p.name) + '</a></h3><span class="pcard__price">' + C.price(p.price, p.compareAt) + '</span></div>' +
        (o.sub ? '<p class="pcard__sub">' + esc(p.subtitle || '') + '</p>' : '') +
        '<div class="pcard__meta">' + C.cardSwatches(p, color) + (status !== 'instock' ? Cola.stock.html(status, stLabel) : '') + '</div>' +
      '</div></article>';
  };
  C.cardSwatches = function (p, color) {
    if (!(p.colors || []).length) return '<span></span>';
    return '<div class="swatches" role="radiogroup" aria-label="Colour">' + p.colors.slice(0, 5).map(function (c) {
      return '<button class="swatch' + (c.name === color ? ' is-active' : '') + '" type="button" role="radio" aria-checked="' + (c.name === color) + '" style="--c:' + esc(c.hex) + '" data-swatch="' + esc(c.name) + '" data-tip="' + esc(c.name) + '" aria-label="' + esc(c.name) + '"></button>';
    }).join('') + (p.colors.length > 5 ? '<span class="tiny subtle">+' + (p.colors.length - 5) + '</span>' : '') + '</div>';
  };
  C.quickSizes = function (p, color) {
    var sizes = p.sizes || [];
    if (!sizes.length) return '';
    return '<div class="pcard__quick"><div class="pcard__quick-label"><span>Quick add · ' + esc(color) + '</span><button type="button" class="pcard__qv" data-quickview>Quick view</button></div><div class="sizes">' + sizes.map(function (s) {
      var v = Cola.stock.find(p, color, s), st = Cola.stock.variant(v, p);
      return '<button type="button" class="size size--sm' + (Cola.stock.available(st) ? '' : ' is-out') + '" data-quick-size="' + esc(s) + '" aria-label="Add size ' + esc(s) + (Cola.stock.available(st) ? '' : ' (sold out)') + '">' + esc(s) + '</button>';
    }).join('') + '</div></div>';
  };

  /** Delegated behaviour for cards inside a container. getProduct(id) → product */
  C.bindCards = function (root, getProduct) {
    if (root.dataset.cardsBound) return; root.dataset.cardsBound = '1';
    root.addEventListener('click', function (e) {
      var card = e.target.closest('.pcard'); if (!card) return;
      var p = getProduct(card.getAttribute('data-pid')); if (!p) return;
      var sw = e.target.closest('[data-swatch]');
      if (sw) { e.preventDefault(); setCardColor(card, p, sw.getAttribute('data-swatch')); return; }
      var save = e.target.closest('[data-save]');
      if (save) {
        e.preventDefault();
        var on = Cola.bag.toggleSave(p.id);
        save.setAttribute('aria-pressed', on); save.setAttribute('aria-label', on ? 'Remove from saved' : 'Save for later');
        Cola.ui.toast(on ? 'Saved for later' : 'Removed from saved', { sub: p.name, icon: 'heart', action: on ? { label: 'View', fn: function () { Cola.layout.openBag('saved'); } } : null });
        return;
      }
      if (e.target.closest('[data-quickview]')) { e.preventDefault(); C.quickView(p, card.getAttribute('data-color')); return; }
      var q = e.target.closest('[data-quick-size]');
      if (q) {
        e.preventDefault();
        var color = card.getAttribute('data-color'), size = q.getAttribute('data-quick-size');
        var v = Cola.stock.find(p, color, size), st = Cola.stock.variant(v, p);
        if (!Cola.stock.available(st)) { C.notify(p, color, size); return; }
        C.addToBag(p, { color: color, size: size, qty: 1 });
      }
    });
    if (!Cola.isTouch) root.addEventListener('pointerover', function (e) {
      var sw = e.target.closest('[data-swatch]'); if (!sw) return;
      var card = sw.closest('.pcard'); var p = card && getProduct(card.getAttribute('data-pid'));
      if (p && card.getAttribute('data-color') !== sw.getAttribute('data-swatch')) setCardColor(card, p, sw.getAttribute('data-swatch'));
    });
  };
  function setCardColor(card, p, color) {
    card.setAttribute('data-color', color);
    var hexc = Cola.media.colorHex(p, color);
    card.querySelector('.pcard__media').style.setProperty('--tint', Cola.media.tint(hexc));
    card.querySelector('.pcard__img--main').innerHTML = Cola.media.productImage(p, { color: color });
    var alt = card.querySelector('.pcard__img--alt'); if (alt) alt.innerHTML = Cola.media.productImage(p, { color: color, view: 'back' });
    $$('[data-swatch]', card).forEach(function (s) { var on = s.getAttribute('data-swatch') === color; s.classList.toggle('is-active', on); s.setAttribute('aria-checked', on); });
    var q = card.querySelector('.pcard__quick'); if (q) q.outerHTML = C.quickSizes(p, color);
    var a = card.querySelector('.pcard__name a'); if (a) a.setAttribute('href', Cola.productUrl(p, color !== p.colors[0].name ? { color: color } : null));
  }

  C.addToBag = function (p, sel) {
    var it = Cola.bag.add(p, sel);
    Cola.ui.toast('Added to your order list', { sub: p.name + ' · ' + sel.color + (sel.size ? ' · ' + sel.size : '') + (sel.qty > 1 ? ' × ' + sel.qty : ''), icon: 'bag', action: { label: 'View list', fn: function () { Cola.layout.openBag(); } } });
    return it;
  };

  // ---------------------------------------------------------------------------
  // Purchase panel (product page + quick view)
  // ---------------------------------------------------------------------------
  /** state: { color, size, qty } */
  C.buyPanel = function (p, state, o) {
    o = o || {};
    var multiSize = (p.sizes || []).length > 1;
    return '<div class="buy" data-buy>' +
      '<div class="buy__group"><div class="buy__label"><span class="label">Colour</span><span class="buy__value" data-buy-color>' + esc(state.color) + '</span></div>' +
        '<div class="swatches buy__swatches" role="radiogroup" aria-label="Colour">' + (p.colors || []).map(function (c) {
          var st = Cola.stock.product(p, c.name);
          return '<button type="button" class="swatch swatch--lg' + (c.name === state.color ? ' is-active' : '') + (st === 'soldout' ? ' is-out' : '') + '" role="radio" aria-checked="' + (c.name === state.color) + '" style="--c:' + esc(c.hex) + '" data-buy-swatch="' + esc(c.name) + '" data-tip="' + esc(c.name + (st === 'soldout' ? ' — sold out' : '')) + '" aria-label="' + esc(c.name) + '"></button>';
        }).join('') + '</div></div>' +
      '<div class="buy__group"><div class="buy__label"><span class="label">Size</span>' +
        (p.measurements ? '<button type="button" class="link link--quiet tiny" data-size-guide>' + Cola.icon('ruler') + ' Size guide</button>' : '<span class="tiny subtle">' + esc(p.fit || '') + '</span>') + '</div>' +
        '<div class="sizes" role="radiogroup" aria-label="Size" data-buy-sizes>' + C.sizeButtons(p, state) + '</div>' +
        '<p class="buy__stock" data-buy-stock aria-live="polite">' + C.stockLine(p, state) + '</p></div>' +
      '<div class="buy__actions">' +
        '<div class="buy__row"><div class="qty" data-qty><button type="button" data-qty-dec aria-label="Decrease quantity">−</button><input type="number" min="1" max="99" value="' + (state.qty || 1) + '" aria-label="Quantity" data-qty-input><button type="button" data-qty-inc aria-label="Increase quantity">+</button></div>' +
        '<button type="button" class="btn btn--block buy__add" data-buy-add>' + Cola.icon('bag', 'btn__icon') + '<span data-buy-add-label>Add to order list</span></button></div>' +
        '<button type="button" class="btn btn--ghost btn--block btn--wa" data-buy-wa>' + Cola.icon('whatsapp', 'btn__icon') + 'Order now via WhatsApp</button>' +
        '<button type="button" class="btn btn--ghost btn--block" data-buy-agent>' + Cola.icon('globe', 'btn__icon') + 'Buy via an agent</button>' +
      '</div></div>';
  };
  C.sizeButtons = function (p, state) {
    return (p.sizes || []).map(function (s) {
      var v = Cola.stock.find(p, state.color, s), st = Cola.stock.variant(v, p), n = v ? Number(v.stock) || 0 : 0;
      var note = st === 'low' ? '<span class="size__note">' + n + ' left</span>' : (st === 'preorder' ? '<span class="size__note size__note--pre">Pre</span>' : '');
      return '<button type="button" class="size' + (Cola.stock.available(st) ? '' : ' is-out') + '" role="radio" aria-checked="' + (state.size === s) + '" data-buy-size="' + esc(s) + '" aria-label="' + esc(s) + ' — ' + esc(Cola.stock.label(st, n)) + '">' + esc(s) + note + '</button>';
    }).join('');
  };
  C.stockLine = function (p, state) {
    if (!state.size) {
      var st = Cola.stock.product(p, state.color);
      return Cola.stock.html(st, st === 'low' ? 'Low stock in ' + state.color : Cola.stock.labels[st] + ' · select a size');
    }
    var v = Cola.stock.find(p, state.color, state.size), s = Cola.stock.variant(v, p), n = v ? Number(v.stock) || 0 : 0;
    var txt = s === 'instock' ? 'In stock — ships in ' + ((p.leadTime || '').replace(/^Ships in /i, '') || '3–5 working days')
      : s === 'low' ? 'Only ' + n + ' left in ' + state.size
      : s === 'preorder' ? (p.leadTime || 'Pre-order')
      : s === 'restocking' ? 'Sold out — restock expected ' + Cola.fmtDate(p.restockDate)
      : 'Sold out in ' + state.size + ' — get notified when it is back';
    return Cola.stock.html(s, txt);
  };

  /** Wire a purchase panel. onChange(state) is called on colour/size changes. */
  C.bindBuy = function (root, p, state, onChange) {
    var el = root.querySelector('[data-buy]');
    function sync() {
      el.querySelector('[data-buy-color]').textContent = state.color;
      $$('[data-buy-swatch]', el).forEach(function (s) { var on = s.getAttribute('data-buy-swatch') === state.color; s.classList.toggle('is-active', on); s.setAttribute('aria-checked', on); });
      el.querySelector('[data-buy-sizes]').innerHTML = C.sizeButtons(p, state);
      el.querySelector('[data-buy-stock]').innerHTML = C.stockLine(p, state);
      var v = state.size ? Cola.stock.find(p, state.color, state.size) : null, st = v ? Cola.stock.variant(v, p) : null;
      var add = el.querySelector('[data-buy-add-label]');
      add.textContent = st && !Cola.stock.available(st) ? 'Notify me when back' : (st === 'preorder' ? 'Pre-order — add to list' : 'Add to order list');
      if (onChange) onChange(state);
    }
    el.addEventListener('click', function (e) {
      var sw = e.target.closest('[data-buy-swatch]');
      if (sw) { state.color = sw.getAttribute('data-buy-swatch'); sync(); return; }
      var sz = e.target.closest('[data-buy-size]');
      if (sz) { state.size = sz.getAttribute('data-buy-size'); sync(); return; }
      if (e.target.closest('[data-qty-dec]')) { state.qty = Math.max(1, (state.qty || 1) - 1); el.querySelector('[data-qty-input]').value = state.qty; return; }
      if (e.target.closest('[data-qty-inc]')) { state.qty = Math.min(99, (state.qty || 1) + 1); el.querySelector('[data-qty-input]').value = state.qty; return; }
      if (e.target.closest('[data-size-guide]')) { C.sizeGuide(p); return; }
      if (e.target.closest('[data-buy-add]')) { act('add'); return; }
      if (e.target.closest('[data-buy-wa]')) { act('wa'); return; }
      if (e.target.closest('[data-buy-agent]')) { C.agentSheet(p, state); return; }
    });
    el.querySelector('[data-qty-input]').addEventListener('change', function (e) { state.qty = Cola.clamp(parseInt(e.target.value, 10) || 1, 1, 99); e.target.value = state.qty; });
    function act(kind) {
      if ((p.sizes || []).length && !state.size) {
        var box = el.querySelector('[data-buy-sizes]'); box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        el.querySelector('[data-buy-stock]').innerHTML = '<span class="status st-low"><span class="dot"></span><span>Please select a size first</span></span>';
        return;
      }
      var v = Cola.stock.find(p, state.color, state.size), st = Cola.stock.variant(v, p);
      if (!Cola.stock.available(st)) { C.notify(p, state.color, state.size); return; }
      if (kind === 'add') C.addToBag(p, { color: state.color, size: state.size, qty: state.qty || 1 });
      if (kind === 'wa') {
        if (!Cola.order.enabled()) { Cola.ui.toast('WhatsApp ordering is not configured yet', { icon: 'info' }); return; }
        var ref = Cola.order.ref();
        var item = { productId: p.id, name: p.name, color: state.color, size: state.size, qty: state.qty || 1, price: p.price, sku: v ? v.sku : '' };
        Cola.order.log(ref, [item], {}, 'whatsapp');
        Cola.bag.remember({ ref: ref, at: new Date().toISOString(), items: [item], channel: 'whatsapp' });
        Cola.openExternal(Cola.order.waLink(Cola.order.message([item], {}, ref)));
      }
    }
    return { sync: sync };
  };

  // ---------------------------------------------------------------------------
  // Quick view
  // ---------------------------------------------------------------------------
  C.quickView = function (p, color) {
    var state = { color: color || p.colors[0].name, size: (p.sizes || []).length === 1 ? p.sizes[0] : null, qty: 1 };
    var view = 'front';
    function media() { return Cola.media.productImage(p, { color: state.color, view: view }); }
    Cola.ui.modal({
      label: p.name, width: '1040px', cls: 'quickview',
      html: '<div class="qv"><div class="qv__media" style="--tint:' + Cola.media.tint(Cola.media.colorHex(p, state.color)) + '"><div class="qv__img">' + media() + '</div>' +
        '<div class="qv__views segmented"><button type="button" aria-pressed="true" data-qv-view="front">Front</button><button type="button" aria-pressed="false" data-qv-view="back">Back</button></div></div>' +
        '<div class="qv__info"><p class="label">' + esc(p.collection || '') + '</p><h2 class="h3 mt-1">' + esc(p.name) + '</h2><p class="muted small mt-1">' + esc(p.subtitle || '') + '</p>' +
        '<p class="qv__price mt-2">' + C.price(p.price, p.compareAt, { cny: true }) + '</p>' + C.buyPanel(p, state) +
        '<a class="link small mt-3" href="' + Cola.productUrl(p) + '">Full details ' + Cola.icon('arrow-right') + '</a></div></div>',
      onOpen: function (m) {
        C.bindBuy(m.panel, p, state, function () {
          m.panel.querySelector('.qv__media').style.setProperty('--tint', Cola.media.tint(Cola.media.colorHex(p, state.color)));
          m.panel.querySelector('.qv__img').innerHTML = media();
        });
        m.panel.addEventListener('click', function (e) {
          var b = e.target.closest('[data-qv-view]'); if (!b) return;
          view = b.getAttribute('data-qv-view');
          $$('[data-qv-view]', m.panel).forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
          m.panel.querySelector('.qv__img').innerHTML = media();
        });
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Agent sheet
  // ---------------------------------------------------------------------------
  C.agentSheet = function (p, state) {
    var agents = Cola.order.agents();
    var rows = agents.length ? agents.map(function (a) {
      var url = Cola.order.agentUrl(a, p);
      return '<li class="agent"><div class="agent__mark">' + esc((a.name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()) + '</div>' +
        '<div class="agent__body"><p class="agent__name">' + esc(a.name) + (a.recommended ? ' <span class="badge badge--accent">Recommended</span>' : '') + '</p><p class="tiny muted">' + esc(a.description || '') + '</p></div>' +
        (url ? '<a class="btn btn--sm" href="' + esc(url) + '" target="_blank" rel="noopener sponsored">Open ' + Cola.icon('external', 'btn__icon') + '</a>'
             : '<button type="button" class="btn btn--sm btn--ghost" data-agent-soon="' + esc(a.name) + '">Link soon</button>') + '</li>';
    }).join('') : '<li class="muted small">No agents configured yet.</li>';
    Cola.ui.modal({
      label: 'Buy via an agent', width: '620px',
      html: '<div class="modal__head"><p class="label">Order through an agent</p><h2 class="h3 mt-1">Choose your <b>agent</b></h2>' +
        '<p class="muted small mt-2">An agent buys the item for you from our Weidian store, inspects it in their warehouse (QC photos) and ships it to you together with your other orders.' +
        (state && state.size ? ' Selected: <b>' + esc(p.name) + ' · ' + esc(state.color) + ' · ' + esc(state.size) + '</b>.' : '') + '</p></div>' +
        '<div class="modal__body"><ul class="agents">' + rows + '</ul>' +
        '<div class="callout mt-3">' + Cola.icon('info') + '<div>Paste the product link into your agent if a button does not open the item directly. Questions? <a class="link" href="how-to-order.html#agents">How ordering via an agent works</a></div></div></div>',
      onOpen: function (m) {
        m.panel.addEventListener('click', function (e) {
          var s = e.target.closest('[data-agent-soon]');
          if (s) Cola.ui.toast(s.getAttribute('data-agent-soon') + ' link is coming soon', { sub: 'Order directly via WhatsApp in the meantime.', icon: 'clock' });
        });
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Size guide modal
  // ---------------------------------------------------------------------------
  C.sizeTable = function (m, unit) {
    if (!m) return '';
    var f = unit === 'in' ? function (v) { return (v / 2.54).toFixed(1); } : function (v) { return v; };
    return '<div class="table-wrap"><table class="table"><thead><tr><th>Size</th>' + m.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      m.rows.map(function (r) { return '<tr><td><b>' + esc(r.size) + '</b></td>' + r.values.map(function (v) { return '<td>' + f(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  };
  C.sizeGuide = function (p) {
    var unit = 'cm';
    Cola.ui.modal({
      label: 'Size guide', width: '760px',
      html: '<div class="modal__head"><p class="label">Size guide · ' + esc(p.name) + '</p><h2 class="h3 mt-1">Measure <b>twice</b>, order once.</h2></div>' +
        '<div class="modal__body"><div class="row row--between mb-2"><p class="small muted">' + esc(p.fit || '') + '</p><div class="segmented"><button type="button" aria-pressed="true" data-unit="cm">cm</button><button type="button" aria-pressed="false" data-unit="in">inch</button></div></div>' +
        '<div data-sg-table>' + C.sizeTable(p.measurements, unit) + '</div>' +
        '<p class="tiny subtle mt-2">Garment measurements, laid flat. "½" means measured across the front (double for full circumference). Tolerance ±1–2 cm.</p>' +
        '<a class="link small mt-3" href="size-guide.html">How to measure & fit finder ' + Cola.icon('arrow-right') + '</a></div>',
      onOpen: function (m) {
        m.panel.addEventListener('click', function (e) {
          var b = e.target.closest('[data-unit]'); if (!b) return;
          unit = b.getAttribute('data-unit');
          $$('[data-unit]', m.panel).forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
          m.panel.querySelector('[data-sg-table]').innerHTML = C.sizeTable(p.measurements, unit);
        });
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Restock notify
  // ---------------------------------------------------------------------------
  C.notify = function (p, color, size) {
    var v = Cola.stock.find(p, color, size);
    Cola.ui.modal({
      label: 'Notify me', width: '520px',
      html: '<div class="modal__head"><p class="label">Restock alert</p><h2 class="h3 mt-1">Tell me when it is <b>back</b></h2>' +
        '<p class="muted small mt-2">' + esc(p.name) + ' · ' + esc(color) + (size ? ' · ' + esc(size) : '') + (p.restockDate ? '<br>Restock expected around <b>' + Cola.fmtDate(p.restockDate) + '</b>.' : '') + '</p></div>' +
        '<div class="modal__body stack" style="--stack:12px">' +
        (Cola.order.enabled() ? '<a class="btn btn--block btn--wa" target="_blank" rel="noopener" href="' + esc(Cola.order.waLink(Cola.order.notifyMessage(p, color, size))) + '">' + Cola.icon('whatsapp', 'btn__icon') + 'Notify me on WhatsApp</a>' : '') +
        (Cola.isServer ? '<form class="notify-form" data-notify-form><div class="field"><label for="nf-contact">Or leave your email / WhatsApp number</label><div class="row"><input id="nf-contact" class="input" name="contact" required placeholder="you@email.com or +31 6…" autocomplete="email"><button class="btn" type="submit">Notify</button></div></div></form>' : '') +
        '</div>',
      onOpen: function (m) {
        var f = m.panel.querySelector('[data-notify-form]');
        if (f) f.addEventListener('submit', function (e) {
          e.preventDefault();
          var btn = f.querySelector('button'); btn.classList.add('is-loading');
          Cola.data.post('/api/notify', { productId: p.id, sku: v ? v.sku : '', contact: f.contact.value.trim() }).then(function (r) {
            btn.classList.remove('is-loading');
            if (r.ok) { m.close(); Cola.ui.toast('You are on the list', { sub: 'We will contact you when it is back.', icon: 'bell' }); }
            else Cola.ui.toast(r.error || 'Could not save — please try WhatsApp', { icon: 'info' });
          });
        });
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  C.sectionHead = function (o) {
    return '<div class="section-head"><div><p class="eyebrow">' + esc(o.eyebrow || '') + '</p><h2 class="h2 mt-2" data-split>' + o.title + '</h2></div>' +
      (o.link ? '<a class="link" href="' + o.link + '">' + esc(o.linkLabel || 'View all') + ' ' + Cola.icon('arrow-right') + '</a>' : '') + '</div>';
  };
  C.empty = function (title, text, cta) {
    return '<div class="empty">' + Cola.brand.engraving('spool', 'empty__art') + '<h3 class="h4">' + title + '</h3>' + (text ? '<p class="small muted">' + text + '</p>' : '') + (cta || '') + '</div>';
  };
})();
