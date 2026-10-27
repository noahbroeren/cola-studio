/* COLA STUDIO — Live stock */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var PRODUCTS = [], INV = null, prevStock = {}, view = 'board';
  var f = { q: '', cat: 'all', st: 'all' };
  var refreshSec = 30, left = 30, timer = null;

  Cola.boot(function () {
    refreshSec = (Cola.data.settings.inventory && Cola.data.settings.inventory.refreshSeconds) || 30;
    left = refreshSec;
    var cat = $('[data-s-cat]');
    cat.innerHTML += (Cola.data.categories || []).map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');
    bind();
    return load(true).then(function () { tick(); });
  });

  function load(first) {
    return Promise.all([Cola.data.products(), Cola.data.inventory(!first)]).then(function (r) {
      INV = r[1];
      var fresh = Cola.data.withStock(r[0], INV);
      var changed = {};
      if (!first) fresh.forEach(function (p) { p.variants.forEach(function (v) { if (prevStock[v.sku] !== undefined && prevStock[v.sku] !== v.stock) changed[v.sku] = true; }); });
      fresh.forEach(function (p) { p.variants.forEach(function (v) { prevStock[v.sku] = v.stock; }); });
      PRODUCTS = fresh;
      syncCard(); render(changed);
    }).catch(function (e) { console.error(e); $('[data-sync-time]').textContent = 'Could not refresh'; });
  }

  // Quietly refresh in the background (no visible countdown).
  function tick() {
    clearInterval(timer);
    timer = setInterval(function () {
      if (document.hidden) return;
      left--;
      if (left <= 0) { left = refreshSec; load(false); }
    }, 1000);
  }

  function syncCard() {
    var s = (INV && INV.sync) || {};
    $('[data-sync-time]').textContent = s.status === 'error' ? 'Showing last known stock' : (s.at ? 'Synced ' + Cola.timeAgo(s.at) : 'Updated ' + Cola.fmtDate(new Date(), 'time'));
  }

  function visible(p) {
    if (f.cat !== 'all' && p.category !== f.cat) return false;
    if (f.q) {
      var hay = (p.name + ' ' + p.colors.map(function (c) { return c.name; }).join(' ') + ' ' + p.variants.map(function (v) { return v.sku; }).join(' ')).toLowerCase();
      if (!f.q.toLowerCase().split(/\s+/).every(function (t) { return hay.indexOf(t) >= 0; })) return false;
    }
    if (f.st !== 'all') return p.variants.some(function (v) { var s = Cola.stock.variant(v, p); return f.st === 'soldout' ? (s === 'soldout' || s === 'restocking') : s === f.st; });
    return true;
  }
  function cellMatches(st) { return f.st === 'all' || st === f.st || (f.st === 'soldout' && st === 'restocking'); }

  function cell(p, color, size, changed) {
    var v = Cola.stock.find(p, color, size);
    if (!v) return '<span class="cell cell--na" aria-hidden="true"><span class="cell__size">' + esc(size) + '</span><span class="cell__n">·</span></span>';
    var st = Cola.stock.variant(v, p), n = Number(v.stock) || 0;
    var label = size + ' · ' + color + ' · ' + Cola.stock.labels[st] + (Cola.stock.available(st) ? ' — click to add' : ' — click to get notified');
    return '<button type="button" class="cell st-' + st + (changed[v.sku] ? ' is-changed' : '') + (cellMatches(st) ? '' : ' is-dim') + '" data-cell="' + esc(p.id) + '|' + esc(color) + '|' + esc(size) + '" data-tip="' + esc(label) + '" aria-label="' + esc(p.name + ', ' + label) + '"><span class="cell__size">' + esc(size) + '</span><span class="cell__n">' + (st === 'preorder' ? 'PRE' : n) + '</span></button>';
  }

  function render(changed) {
    changed = changed || {};
    var host = $('[data-stock-view]');
    var list = PRODUCTS.filter(visible);
    if (!list.length) { host.innerHTML = Cola.c.empty('No matching stock', 'Try another filter.'); return; }
    if (view === 'board') {
      host.innerHTML = '<div class="sboard">' + list.map(function (p) {
        var st = Cola.stock.product(p);
        return '<article class="sb-card">' +
          '<a class="sb-card__img" href="' + Cola.productUrl(p) + '" style="--tint:' + Cola.media.tint(p.colors[0].hex) + '" aria-label="' + esc(p.name) + '">' + Cola.media.productImage(p) + '</a>' +
          '<div class="sb-card__body"><div class="sb-card__head"><div><h3 class="sb-card__name"><a href="' + Cola.productUrl(p) + '">' + esc(p.name) + '</a></h3><p class="tiny subtle">' + esc(Cola.c.code(p)) + ' · ' + Cola.c.price(p.price) + '</p></div>' + Cola.stock.html(st) + '</div>' +
          '<div class="sb-matrix" style="--n:' + p.sizes.length + '">' + p.colors.map(function (c) {
            return '<div class="sb-row"><span class="sb-row__color"><span class="swatch swatch--sm" style="--c:' + esc(c.hex) + '"></span>' + esc(c.name) + '</span><div class="cells" style="--n:' + p.sizes.length + '">' + p.sizes.map(function (s) { return cell(p, c.name, s, changed); }).join('') + '</div></div>';
          }).join('') + '</div></div></article>';
      }).join('') + '</div>';
    } else {
      host.innerHTML = '<div class="table-wrap"><table class="table stable"><thead><tr><th>Product</th><th>Colour</th><th>Sizes</th><th>Status</th></tr></thead><tbody>' +
        list.map(function (p) {
          return p.colors.map(function (c, i) {
            var st = Cola.stock.product(p, c.name);
            if (f.st !== 'all' && !p.variants.some(function (v) { return v.color === c.name && cellMatches(Cola.stock.variant(v, p)); })) return '';
            return '<tr><td>' + (i === 0 ? '<a class="stable__name" href="' + Cola.productUrl(p) + '">' + esc(p.name) + '</a><span class="tiny subtle"> · ' + esc(Cola.c.code(p)) + '</span>' : '') + '</td>' +
              '<td><span class="row" style="--row-gap:8px"><span class="swatch swatch--sm" style="--c:' + esc(c.hex) + '"></span>' + esc(c.name) + '</span></td>' +
              '<td><div class="cells cells--inline">' + p.sizes.map(function (s) { return cell(p, c.name, s, changed); }).join('') + '</div></td>' +
              '<td>' + Cola.stock.html(st) + '</td></tr>';
          }).join('');
        }).join('') + '</tbody></table></div>';
    }
    Cola.rewriteLinks(host);
  }

  function bind() {
    $('[data-s-q]').addEventListener('input', Cola.debounce(function (e) { f.q = e.target.value.trim(); render(); }, 150));
    $('[data-s-cat]').addEventListener('change', function (e) { f.cat = e.target.value; render(); });
    $('[data-s-status]').addEventListener('click', function (e) { var b = e.target.closest('[data-st]'); if (!b) return; f.st = b.getAttribute('data-st'); $$('[data-st]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); render(); });
    $('[data-refresh]').addEventListener('click', function (e) {
      left = refreshSec;
      load(false);
    });
    $('[data-stock-view]').addEventListener('click', function (e) {
      var c = e.target.closest('[data-cell]'); if (!c) return;
      var parts = c.getAttribute('data-cell').split('|');
      var p = PRODUCTS.find(function (x) { return x.id === parts[0]; }); if (!p) return;
      var v = Cola.stock.find(p, parts[1], parts[2]), st = Cola.stock.variant(v, p);
      if (!Cola.stock.available(st)) return Cola.c.notify(p, parts[1], parts[2]);
      Cola.c.addToBag(p, { color: parts[1], size: parts[2], qty: 1 });
    });
  }
})();
