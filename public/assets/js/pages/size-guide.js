/* COLA STUDIO — Size guide & fit finder */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var unit = Cola.store.get('cola.unit', 'cm'), PRODUCTS = [];
  var TOPS = ['S', 'M', 'L', 'XL', 'XXL'], DENIM = ['28', '30', '32', '34', '36'];

  Cola.boot(function () {
    diagrams();
    return Cola.data.products().then(function (list) {
      PRODUCTS = list.filter(function (p) { return p.measurements; });
      var cats = Cola.data.categories || [];
      $('[data-sg-product]').innerHTML = cats.map(function (c) {
        var ps = PRODUCTS.filter(function (p) { return p.category === c.id; });
        return ps.length ? '<optgroup label="' + esc(c.name) + '">' + ps.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</optgroup>' : '';
      }).join('');
      var pre = Cola.param('product');
      var first = PRODUCTS.find(function (p) { return p.slug === pre || p.id === pre; }) || PRODUCTS.find(function (p) { return p.garment === 'hoodie'; }) || PRODUCTS[0];
      if (first) $('[data-sg-product]').value = first.id;
      setUnit(unit); bind();
    });
  });

  function table() {
    var p = PRODUCTS.find(function (x) { return x.id === $('[data-sg-product]').value; }); if (!p) return;
    $('[data-sg-table]').innerHTML = Cola.c.sizeTable(p.measurements, unit);
    $('[data-sg-fit]').innerHTML = '<b>' + esc(p.name) + '</b> — ' + esc(p.fit || '') + ' <a class="link link--quiet" href="' + Cola.productUrl(p) + '">View product</a>';
    Cola.rewriteLinks($('[data-sg-fit]'));
  }
  function setUnit(u) {
    unit = u; Cola.store.set('cola.unit', u);
    $$('[data-unit]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-unit') === u); });
    $('[data-h-unit]').textContent = u === 'in' ? '(inches)' : '(cm)';
    var h = $('#ff-h'); h.placeholder = u === 'in' ? '71' : '180'; h.min = u === 'in' ? 55 : 140; h.max = u === 'in' ? 87 : 220;
    table();
  }

  function recommend(hcm, kg, pref) {
    var bmi = kg / Math.pow(hcm / 100, 2);
    var i = hcm < 168 ? 0 : hcm < 176 ? 1 : hcm < 184 ? 2 : hcm < 192 ? 3 : 4;
    i += bmi < 19.5 ? -1 : bmi < 25 ? 0 : bmi < 28.5 ? 1 : 2;
    var top = Cola.clamp(i + pref, 0, 4);
    var b = Cola.clamp(Math.round((kg - 55) / 11) + (bmi < 20 ? -1 : 0), 0, 4);
    return { top: TOPS[top], bottom: TOPS[Math.min(b, 3)], denim: DENIM[b], bmi: bmi };
  }

  function bind() {
    $('[data-units]').addEventListener('click', function (e) { var b = e.target.closest('[data-unit]'); if (b) setUnit(b.getAttribute('data-unit')); });
    $('[data-sg-product]').addEventListener('change', table);
    $('[data-fit-form]').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.currentTarget, h = parseFloat(f.h.value), w = parseFloat(f.w.value), pref = parseInt(f.p.value, 10);
      if (unit === 'in') h = h * 2.54;
      var out = $('[data-fit-result]');
      if (!h || !w || h < 140 || h > 225 || w < 35 || w > 170) { out.innerHTML = '<p class="small" style="color:var(--st-out)">Please enter a realistic height and weight.</p>'; return; }
      var r = recommend(h, w, pref);
      out.innerHTML = '<div class="fit-out"><div><span class="label">Tops &amp; outerwear</span><span class="fit-out__size">' + r.top + '</span></div><div><span class="label">Trousers</span><span class="fit-out__size">' + r.bottom + '</span></div><div><span class="label">Denim waist</span><span class="fit-out__size">' + r.denim + '</span></div></div>' +
        '<p class="tiny subtle mt-2">' + (pref === 0 ? 'Based on the intended oversized fit.' : pref < 0 ? 'One size down for a closer fit.' : 'One size up for extra room.') + ' Between sizes? Check the measurements below or ask us on WhatsApp.</p>';
    });
  }

  // measurement diagrams drawn over the garment flats (viewBox 0 0 800 1000)
  function diagrams() {
    var G = window.ColaGarments; if (!G) return;
    var C = '#C07A42';
    function dim(x1, y1, x2, y2, label, lx, ly) {
      return '<g stroke="' + C + '" stroke-width="2" fill="none"><line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>' + tick(x1, y1, x2, y2) + tick(x2, y2, x1, y1) + '</g>' +
        '<g><circle cx="' + lx + '" cy="' + ly + '" r="17" fill="' + C + '"/><text x="' + lx + '" y="' + (ly + 6) + '" text-anchor="middle" font-size="17" font-weight="700" fill="#fff" font-family="Poppins, sans-serif">' + label + '</text></g>';
    }
    function tick(x1, y1, x2, y2) { var a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2, dx = Math.cos(a) * 9, dy = Math.sin(a) * 9; return '<line x1="' + (x1 - dx) + '" y1="' + (y1 - dy) + '" x2="' + (x1 + dx) + '" y2="' + (y1 + dy) + '"/>'; }
    function wrap(svg, overlay, vb) { return '<svg viewBox="' + vb + '" xmlns="http://www.w3.org/2000/svg">' + svg.replace('<svg', '<svg x="0" y="0" width="800" height="1000"') + overlay + '</svg>'; }
    var top = G.render('tee', { color: '#E6DFD2' });
    var o1 = dim(203, 470, 597, 470, 'A', 400, 440) + dim(560, 262, 560, 744, 'B', 560, 600) +
      '<g stroke="' + C + '" stroke-width="1.2" stroke-dasharray="4 4"><line x1="176" y1="286" x2="176" y2="214"/><line x1="624" y1="286" x2="624" y2="214"/></g>' + dim(176, 222, 624, 222, 'C', 400, 196) +
      dim(640, 274, 748, 372, 'D', 722, 300);
    $('[data-measure="top"]').innerHTML = wrap(top, o1, '40 170 740 640');
    var bot = G.render('trousers', { color: '#C8C0B1' });
    var o2 = dim(250, 128, 550, 128, 'A', 400, 92) + dim(224, 300, 576, 300, 'B', 300, 272) + dim(392, 380, 380, 880, 'C', 430, 640) +
      '<g stroke="' + C + '" stroke-width="1.2" stroke-dasharray="4 4"><line x1="250" y1="112" x2="140" y2="112"/><line x1="400" y1="372" x2="140" y2="372"/></g>' + dim(150, 112, 150, 372, 'D', 118, 242) +
      dim(192, 905, 385, 905, 'E', 290, 940);
    $('[data-measure="bottom"]').innerHTML = wrap(bot, o2, '80 60 640 920');
  }
})();
