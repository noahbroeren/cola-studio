/* COLA STUDIO — Brand & logo system */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc, B = Cola.brand;
  var COLA = '#130D0A', FOAM = '#F3EEE6', SYRUP = '#C07A42';
  var FONT = '<style>@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@300;700&amp;display=swap");</style>';

  function monoSvg(color, bg, pad, rx) {
    pad = pad || 415;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-' + pad + ' -' + pad + ' ' + pad * 2 + ' ' + pad * 2 + '" style="color:' + color + '" color="' + color + '">' +
      (bg ? '<rect x="-' + pad + '" y="-' + pad + '" width="' + pad * 2 + '" height="' + pad * 2 + '" rx="' + (rx || 0) + '" fill="' + bg + '"/>' : '') + B.inner + '</svg>';
  }
  function lockupSvg(color, stacked) {
    var m = '<g transform="' + (stacked ? 'translate(500 300) scale(.5)' : 'translate(150 150) scale(.3)') + '" style="color:' + color + '">' + B.inner + '</g>';
    if (stacked) return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 720">' + FONT + m + '<text x="500" y="620" text-anchor="middle" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="74" letter-spacing="19" fill="' + color + '"><tspan font-weight="700">COLA</tspan><tspan font-weight="300" dx="22">STUDIO</tspan></text></svg>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1180 300">' + FONT + m + '<text x="340" y="176" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="74" letter-spacing="19" fill="' + color + '"><tspan font-weight="700">COLA</tspan><tspan font-weight="300" dx="22">STUDIO</tspan></text></svg>';
  }
  function sealSvg(color) {
    var text = 'COLA STUDIO · DESIGN · PRODUCTION · CRAFTSMANSHIP · ', n = text.length, out = '';
    for (var i = 0; i < n; i++) if (text[i] !== ' ') out += '<text transform="rotate(' + (360 / n * i).toFixed(2) + ') translate(0 -82)" text-anchor="middle">' + text[i] + '</text>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200">' + FONT + '<g fill="' + color + '" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="11.5" font-weight="500" letter-spacing="3">' + out + '</g><g transform="scale(.092)" style="color:' + color + '">' + B.inner + '</g></svg>';
  }

  var VARIANTS = [
    { id: 'monogram', name: 'Primary monogram', use: 'Default mark — light backgrounds', bg: FOAM, svg: function () { return monoSvg(COLA); } },
    { id: 'monogram-reversed', name: 'Reversed', use: 'Dark backgrounds, packaging', bg: COLA, dark: true, svg: function () { return monoSvg(FOAM); } },
    { id: 'monogram-syrup', name: 'Syrup', use: 'Accents, labels, special editions', bg: COLA, dark: true, svg: function () { return monoSvg(SYRUP); } },
    { id: 'lockup-horizontal', name: 'Horizontal lockup', use: 'Website header, documents', bg: FOAM, wide: true, png: true, svg: function () { return lockupSvg(COLA); } },
    { id: 'lockup-stacked', name: 'Stacked lockup', use: 'Swing tags, social avatars', bg: '#EBE4D9', png: true, svg: function () { return lockupSvg(COLA, true); } },
    { id: 'seal', name: 'Seal', use: 'Stickers, packaging, motion', bg: FOAM, html: function () { return B.seal({ cls: 'variant__seal' }); }, svg: function () { return sealSvg(COLA); } },
    { id: 'app-icon', name: 'App icon', use: 'Favicons, home-screen icon', bg: '#EBE4D9', svg: function () { return monoSvg(FOAM, COLA, 560, 240); } },
    { id: 'woven-label', name: 'Woven label', use: 'Neck & hem labels', bg: '#EBE4D9', wide: true, html: function () { return '<div class="woven">' + B.mono({ cls: 'woven__mark' }) + '<div class="woven__text"><b>Cola Studio</b><br>Designed &amp; constructed<br>International fashion studio</div><div class="woven__code">CS-000<br>AW26<br>VOL. 04</div></div>'; } },
    { id: 'pattern', name: 'Monogram pattern', use: 'Tissue paper, linings, backgrounds', bg: FOAM, pattern: true }
  ];

  Cola.boot(function () {
    // hero mark (static)
    $('[data-hero-mark]').innerHTML = B.mono({ cls: 'brand-hero__svg', title: 'Cola Studio monogram' });
    // anatomy
    $('[data-anatomy]').innerHTML = B.construction();
    // variants
    $('[data-variants]').innerHTML = VARIANTS.map(function (v, i) {
      var art = v.pattern ? '<div class="variant__pattern" style="background-image:' + B.tile('#130D0A', 0.16, 120) + '"></div>' : (v.html ? v.html() : v.svg());
      return '<figure class="variant' + (v.wide ? ' variant--wide' : '') + (v.dark ? ' theme-dark' : '') + '" data-reveal style="--d:' + (i % 3 * 0.06) + 's"><div class="variant__art" style="background:' + v.bg + '">' + art + '</div>' +
        '<figcaption class="variant__cap"><div><b>' + v.name + '</b><small>' + v.use + '</small></div><div class="row" style="--row-gap:6px">' +
        (v.svg ? '<button class="btn btn--sm btn--ghost" type="button" data-dl="' + v.id + '">SVG</button>' : '') +
        (v.png ? '<button class="btn btn--sm btn--ghost" type="button" data-png="' + v.id + '">PNG</button>' : '') +
        (v.pattern ? '<button class="btn btn--sm btn--ghost" type="button" data-dl-tile>SVG tile</button>' : '') + '</div></figcaption></figure>';
    }).join('');
    $('[data-variants]').addEventListener('click', function (e) {
      var d = e.target.closest('[data-dl]'), p = e.target.closest('[data-png]');
      if (d) { var v = VARIANTS.find(function (x) { return x.id === d.getAttribute('data-dl'); }); Cola.downloadText('cola-studio-' + v.id + '.svg', '<?xml version="1.0" encoding="UTF-8"?>\n' + v.svg(), 'image/svg+xml'); }
      if (p) png(p.getAttribute('data-png'));
      if (e.target.closest('[data-dl-tile]')) (function () { var t = B.tile('#130D0A', 0.16, 240); Cola.downloadText('cola-studio-pattern-tile.svg', decodeURIComponent(t.slice(t.indexOf(',') + 1, -2)), 'image/svg+xml'); })();
    });
    // clear space & sizes
    $('[data-clearspace]').innerHTML = '<div class="clearspace"><span class="clearspace__zone"></span>' + B.mono({ cls: 'clearspace__mark' }) + '<span class="clearspace__x clearspace__x--t">x</span><span class="clearspace__x clearspace__x--l">x</span></div><p class="tiny subtle mt-1">x = ¼ Ø</p>';
    $('[data-minsize]').innerHTML = [64, 32, 24, 16].map(function (s) { return '<span class="minsize" style="--s:' + s + 'px">' + B.mono() + '<small>' + s + ' px</small></span>'; }).join('');
    $('[data-donts]').innerHTML = [['transform:scaleX(1.5)', 'Stretch'], ['transform:rotate(-20deg)', 'Rotate'], ['color:#3B82F6', 'Recolour'], ['filter:drop-shadow(4px 6px 0 rgba(0,0,0,.4))', 'Effects']].map(function (d) { return '<span class="dont"><span class="dont__art"><span style="' + d[0] + ';display:block;width:44px;height:44px">' + B.mono() + '</span></span><small>' + d[1] + '</small></span>'; }).join('');
    // palette
    var PAL = [['Cola', '#130D0A', 'Primary dark · text'], ['Foam', '#F3EEE6', 'Primary light · backgrounds'], ['Bone', '#DDD3C4', 'Lines · muted fills'], ['Stone', '#8F857A', 'Secondary text'], ['Syrup', '#C07A42', 'Accent · sparingly'], ['In stock', '#4F8A5B', 'Status'], ['Low stock', '#CC8A2B', 'Status'], ['Sold out', '#A8452F', 'Status']];
    $('[data-palette]').innerHTML = PAL.map(function (c, i) {
      var rgb = [1, 3, 5].map(function (k) { return parseInt(c[1].substr(k, 2), 16); }).join(', ');
      return '<button class="pal' + (i < 5 ? ' pal--main' : '') + '" type="button" data-copy-hex="' + c[1] + '" data-reveal style="--d:' + (i * 0.04) + 's"><span class="pal__chip" style="background:' + c[1] + '"></span><span class="pal__info"><b>' + c[0] + '</b><small>' + c[1] + ' · RGB ' + rgb + '</small><small>' + c[2] + '</small></span></button>';
    }).join('');
    $('[data-palette]').addEventListener('click', function (e) { var b = e.target.closest('[data-copy-hex]'); if (b) Cola.copy(b.getAttribute('data-copy-hex')).then(function () { Cola.ui.toast(b.getAttribute('data-copy-hex') + ' copied', { icon: 'copy' }); }); });
    // weights
    var W = [[100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']];
    $('[data-weights]').innerHTML = W.map(function (w) { return '<div class="tw"><span class="tw__aa" style="font-weight:' + w[0] + '">Aa</span><span class="label">' + w[0] + ' · ' + w[1] + '</span></div>'; }).join('');
  });

  // PNG export for lockups (draws the monogram + live Poppins on a canvas)
  function png(id) {
    var stacked = id === 'lockup-stacked';
    var W = stacked ? 2000 : 2360, H = stacked ? 1440 : 600, c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    var img = new Image();
    img.onload = function () {
      if (stacked) ctx.drawImage(img, W / 2 - 415, 185, 830, 830); else ctx.drawImage(img, 50, 50, 500, 500);
      ctx.fillStyle = COLA; ctx.textBaseline = 'alphabetic';
      var size = 148; ctx.font = '700 ' + size + 'px Poppins, "Poppins Local", Helvetica, Arial, sans-serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '38px';
      var w1 = ctx.measureText('COLA').width;
      ctx.font = '300 ' + size + 'px Poppins, "Poppins Local", Helvetica, Arial, sans-serif';
      var w2 = ctx.measureText('STUDIO').width, gap = 44;
      var x = stacked ? (W - (w1 + gap + w2)) / 2 : 680, y = stacked ? 1250 : 352;
      ctx.font = '700 ' + size + 'px Poppins, "Poppins Local", Helvetica, Arial, sans-serif'; ctx.fillText('COLA', x, y);
      ctx.font = '300 ' + size + 'px Poppins, "Poppins Local", Helvetica, Arial, sans-serif'; ctx.fillText('STUDIO', x + w1 + gap, y);
      c.toBlob(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'cola-studio-' + id + '.png'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(monoSvg(COLA));
  }
})();
