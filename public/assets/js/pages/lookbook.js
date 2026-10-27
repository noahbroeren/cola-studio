/* COLA STUDIO — Lookbook (edit LOOKS to restyle; items reference product slugs + colour names) */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var LOOKS = [
    { title: 'Layered <b>Construction</b>', note: 'Waxed canvas over a dry twill, finished with a washed cap. The chore jacket softens with every wear.', bg: '#E9E1D4', items: [['construction-work-jacket', 'Clay'], ['pleated-wide-trouser', 'Charcoal'], ['six-panel-cap', 'Ink']] },
    { title: '<b>Cold</b> Front', note: 'The numbered down parka with rigid selvedge and a merino beanie — built for real winter.', bg: '#DCD8D1', items: [['technical-down-parka', 'Black'], ['carpenter-denim', 'Rinse Indigo'], ['ribbed-merino-beanie', 'Rust']] },
    { title: '<b>Foundation</b> Set', note: 'Heavyweight terry, head to toe. Garment dyed so every set has its own tone.', bg: '#E4DFD8', items: [['520-gsm-heavyweight-hoodie', 'Heather Grey'], ['studio-sweatpants', 'Heather Grey'], ['studio-socks-3-pack', 'Bone']] },
    { title: 'The <b>Atelier</b>', note: 'Double-faced wool, hand-folded seams and a crisp poplin underneath.', bg: '#E6DDD0', items: [['double-faced-wool-overcoat', 'Espresso'], ['pleated-wide-trouser', 'Sand'], ['canvas-tote', 'Ecru']] },
    { title: '<b>Utility</b> Line', note: 'Crinkle nylon, ripstop cargos and a magnetic-buckle crossbody for everyday carry.', bg: '#DFE0D8', items: [['nylon-coach-jacket', 'Midnight'], ['utility-cargo-pant', 'Olive'], ['utility-crossbody', 'Black']] },
    { title: 'Soft <b>Structure</b>', note: 'Brushed mohair over a structured boxy tee, with ecru carpenter denim.', bg: '#ECE3D3', items: [['brushed-mohair-cardigan', 'Caramel'], ['carpenter-denim', 'Ecru'], ['six-panel-cap', 'Bone']] }
  ];
  // [x, y, w, h] within a 1000×1250 frame — outer layer, bottom, accessory
  var POS = [[40, 70, 600, 750], [500, 330, 470, 880], [90, 860, 300, 360]];
  var PRODUCTS = [];

  Cola.boot(function () {
    return Cola.data.products().then(function (list) {
      PRODUCTS = list;
      var looks = LOOKS.map(function (l) {
        return Object.assign({}, l, { products: l.items.map(function (it) { var p = list.find(function (x) { return x.slug === it[0]; }); return p ? { p: p, color: p.colors.some(function (c) { return c.name === it[1]; }) ? it[1] : p.colors[0].name } : null; }).filter(Boolean) });
      }).filter(function (l) { return l.products.length; });
      $('[data-look-count]').textContent = looks.length ? looks.length + ' looks · ' + looks.reduce(function (a, l) { return a + l.products.length; }, 0) + ' pieces' : 'New looks soon';
      $('[data-looks]').innerHTML = looks.length ? looks.map(look).join('') :
        '<div class="container section--tight">' + Cola.c.empty('The new lookbook is being shot', 'Until then, every piece is in the collection — and the studio shares first looks in the updates.', '<a class="btn btn--sm" href="' + Cola.url('products') + '">Shop the collection</a><a class="btn btn--sm btn--ghost" href="' + Cola.url('updates') + '">Studio updates</a>') + '</div>';
      $('[data-looks]').addEventListener('click', function (e) {
        var b = e.target.closest('[data-shop-look]'); if (b) shop(looks[+b.getAttribute('data-shop-look')]);
      });
    });
  });

  function frame(l) {
    var parts = l.products.map(function (it, i) {
      var pos = POS[i] || POS[2];
      var svg = Cola.media.productImage(it.p, { color: it.color });
      if (svg.indexOf('<svg') === 0) svg = svg.replace('<svg', '<svg x="' + pos[0] + '" y="' + pos[1] + '" width="' + pos[2] + '" height="' + pos[3] + '"');
      else svg = '<foreignObject x="' + pos[0] + '" y="' + pos[1] + '" width="' + pos[2] + '" height="' + pos[3] + '">' + svg + '</foreignObject>';
      return svg;
    });
    // draw outer layer last so it overlaps the trousers
    var order = parts.length > 1 ? [parts[1]].concat(parts.slice(2), [parts[0]]) : parts;
    return '<svg class="look__svg" viewBox="0 0 1000 1250" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + order.join('') + '</svg>';
  }

  function look(l, i) {
    var total = l.products.reduce(function (a, it) { return a + it.p.price; }, 0);
    return '<article class="look' + (i % 2 ? ' look--flip' : '') + '" data-reveal>' +
      '<div class="look__frame crop-marks" style="background:' + l.bg + '">' + frame(l) + '<span class="look__num">Look ' + String(i + 1).padStart(2, '0') + '</span></div>' +
      '<div class="look__text"><span class="index">' + String(i + 1).padStart(2, '0') + ' / ' + String(LOOKS.length).padStart(2, '0') + '</span><h2 class="h2 mt-2">' + l.title + '</h2><p class="body-lg mt-2">' + esc(l.note) + '</p>' +
      '<ul class="look__items mt-4">' + l.products.map(function (it) {
        return '<li><a href="' + Cola.productUrl(it.p, { color: it.color }) + '"><span class="swatch swatch--sm" style="--c:' + Cola.media.colorHex(it.p, it.color) + '"></span><span><b>' + esc(it.p.name) + '</b><small>' + esc(it.color) + ' · ' + esc(Cola.stock.labels[Cola.stock.product(it.p, it.color)]) + '</small></span>' + Cola.c.price(it.p.price) + '</a></li>';
      }).join('') + '</ul>' +
      '<div class="row row--between row--wrap mt-3" style="--row-gap:10px"><span class="small muted">Complete look · ' + Cola.c.price(total) + '</span><button class="btn" type="button" data-shop-look="' + i + '">Shop the look</button></div></div></article>';
  }

  function shop(l) {
    Cola.ui.modal({
      label: 'Shop the look', width: '640px',
      html: '<div class="modal__head"><p class="label">Shop the look</p><h2 class="h3 mt-1">' + l.title + '</h2></div><div class="modal__body"><div class="shoplook">' + l.products.map(function (it, i) {
        var p = it.p;
        return '<div class="shoplook__row" data-i="' + i + '"><span class="shoplook__img" style="--tint:' + Cola.media.tint(Cola.media.colorHex(p, it.color)) + '">' + Cola.media.productImage(p, { color: it.color }) + '</span><div><b>' + esc(p.name) + '</b><small>' + esc(it.color) + ' · ' + Cola.c.price(p.price) + '</small></div>' +
          (p.sizes.length > 1 ? '<select class="select select--mini" aria-label="Size for ' + esc(p.name) + '"><option value="">Size</option>' + p.sizes.map(function (s) { var v = Cola.stock.find(p, it.color, s), st = Cola.stock.variant(v, p); return '<option value="' + esc(s) + '"' + (Cola.stock.available(st) ? '' : ' disabled') + '>' + esc(s) + (Cola.stock.available(st) ? '' : ' — sold out') + '</option>'; }).join('') + '</select>' : '<span class="tiny subtle">' + esc(p.sizes[0]) + '</span>') +
          '<label class="check"><input type="checkbox" checked aria-label="Include ' + esc(p.name) + '"></label></div>';
      }).join('') + '</div><button class="btn btn--block mt-3" type="button" data-add-look>Add selected to order list</button></div>',
      onOpen: function (m) {
        m.panel.querySelector('[data-add-look]').addEventListener('click', function () {
          var added = 0, missing = false;
          $$('.shoplook__row', m.panel).forEach(function (row) {
            var it = l.products[+row.getAttribute('data-i')], inc = row.querySelector('input[type=checkbox]').checked; if (!inc) return;
            var sel = row.querySelector('select'), size = sel ? sel.value : it.p.sizes[0];
            if (!size) { missing = true; sel.classList.add('shake'); return; }
            Cola.bag.add(it.p, { color: it.color, size: size, qty: 1 }); added++;
          });
          if (missing) return Cola.ui.toast('Choose a size for each selected piece', { icon: 'ruler' });
          m.close();
          if (added) Cola.ui.toast(added + ' piece' + (added > 1 ? 's' : '') + ' added to your order list', { icon: 'bag', action: { label: 'View', fn: function () { Cola.layout.openBag(); } } });
        });
      }
    });
  }
})();
