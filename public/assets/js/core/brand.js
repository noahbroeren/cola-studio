/* ==========================================================================
   COLA STUDIO — core/brand.js
   The logo system, generated as ID-free SVG (safe with <base href="/"> and
   any number of instances per page):
     mono()          primary monogram (exact vector reconstruction of the mark)
     monoDraw()      kept for compatibility — now the same static mark as mono()
     construction()  the mark with its geometry: guides, radii, angles, dimensions
     seal()          monogram inside circular type (static)
     lockup()        monogram + COLA STUDIO wordmark (horizontal / stacked)
     wordmark()      type-only mark
     tile()          repeating monogram pattern (data URI)
   ========================================================================== */
(function () {
  'use strict';
  var Cola = window.Cola;

  var VB = '-415 -415 830 830';
  var STROKES = { outer: 'M395.08 62.57A400.00 400.00 0 1 1 394.28 -67.40', innerL: 'M-141.30 150.25A206.64 206.64 0 0 1 -50.75 -199.47', bar: 'M-102.52 0.56H103.50' };
  var FILLS = {
    innerR: 'M2.10 -220.87A221.42 221.42 0 1 1 -105.47 194.62L-97.78 164.93A191.85 191.85 0 1 0 -5.58 -191.18Z',
    legs: 'M-210.22 357.57L-10.30 -414.66A414.79 414.79 0 0 1 13.03 -414.58L66.85 -203.28L38.19 -195.98L1.22 -341.13L-183.42 372.03A414.79 414.79 0 0 1 -210.22 357.57Z',
    legR: 'M83.59 -137.56A160.85 160.85 0 0 0 49.14 -152.97L182.92 372.27A414.79 414.79 0 0 0 209.76 357.84Z'
  };
  var INNER = '<g fill="none" stroke="currentColor" stroke-width="29.57"><path d="' + STROKES.outer + '"/><path d="' + STROKES.innerL + '"/><path d="' + STROKES.bar + '"/></g>' +
    '<g fill="currentColor"><path d="' + FILLS.innerR + '"/><path d="' + FILLS.legs + '"/><path d="' + FILLS.legR + '"/></g>';

  function attrs(o) { return (o.cls ? ' class="' + o.cls + '"' : '') + (o.style ? ' style="' + o.style + '"' : '') + (o.title ? ' role="img" aria-label="' + Cola.esc(o.title) + '"' : ' aria-hidden="true" focusable="false"'); }

  var brand = (Cola.brand = {
    inner: INNER,
    mono: function (o) { o = o || {}; return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + VB + '"' + attrs(o) + '>' + INNER + '</svg>'; },

    // Logo animations are switched off: the "drawn" mark is simply the solid mark.
    monoDraw: function (o) { return brand.mono(o); },

    /** Circular type around the monogram. Characters are placed individually (no textPath → no ids). */
    seal: function (o) {
      o = o || {};
      var text = (o.text || 'Cola Studio · Design · Production · Craftsmanship · ').toUpperCase();
      var r = o.radius || 82, n = text.length, out = '';
      for (var i = 0; i < n; i++) {
        var a = (360 / n) * i;
        if (text[i] === ' ') continue;
        out += '<text transform="rotate(' + a.toFixed(2) + ') translate(0 ' + (-r) + ')" text-anchor="middle">' + Cola.esc(text[i]) + '</text>';
      }
      return '<span class="seal ' + (o.cls || '') + '"' + (o.title ? ' role="img" aria-label="' + Cola.esc(o.title) + '"' : ' aria-hidden="true"') + '>' +
        '<svg class="seal__ring" viewBox="-100 -100 200 200" aria-hidden="true">' + out + '</svg>' +
        (o.mono === false ? '' : brand.mono({ cls: 'seal__mark' })) + '</span>';
    },

    /** No-op (logo animations are off); kept so older page scripts keep working. */
    drawOnView: function () {},

    lockup: function (o) {
      o = o || {};
      return '<a class="lockup ' + (o.stack ? 'lockup--stack ' : '') + (o.cls || '') + '" href="' + Cola.url('home') + '" aria-label="Cola Studio — home">' +
        brand.mono({ cls: 'lockup__mark' }) + '<span class="lockup__word"><b>Cola</b> <span>Studio</span></span></a>';
    },

    /** Engraving of a tailoring tool (machine, spool, shears, thimble, dressform, pincushion). */
    engraving: function (name, cls, label) {
      return '<span class="engraving engraving--' + name + (cls ? ' ' + cls : '') + '"' + (label ? ' role="img" aria-label="' + Cola.esc(label) + '"' : ' aria-hidden="true"') + '></span>';
    },

    wordmark: function () { return '<span class="lockup__word"><b>Cola</b> <span>Studio</span></span>'; },

    /** Repeating pattern tile as a CSS-ready data URI. */
    tile: function (color, opacity, size) {
      color = color || '#130D0A'; opacity = opacity == null ? 0.07 : opacity; size = size || 140;
      var m = '<g transform="scale(0.075)">' + INNER + '</g>';
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="-70 -70 140 140" style="color:' + color + '"><g opacity="' + opacity + '">' +
        '<g transform="translate(-35 -35)">' + m + '</g><g transform="translate(35 35)">' + m + '</g></g></svg>';
      return "url('data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg) + "')";
    },

    /**
     * The mark with its construction geometry. viewBox -640…640.
     * Hairlines use vector-effect so they stay 1px at any size.
     */
    construction: function (o) {
      o = o || {};
      var H = ' vector-effect="non-scaling-stroke"';
      var g = [];
      g.push('<g class="cx-guides" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"' + '>');
      // circles
      g.push('<circle r="560"' + H + ' opacity=".55"/>');
      g.push('<circle r="400"' + H + ' stroke-dasharray="6 7"/>');
      g.push('<circle r="206.6" cx="1.1" cy=".5"' + H + ' stroke-dasharray="6 7"/>');
      g.push('<circle r="414.8"' + H + ' opacity=".35"/><circle r="385.2"' + H + ' opacity=".35"/>');
      // axes
      g.push('<path d="M-620 0H620M0 -620V620"' + H + ' stroke-dasharray="2 6"/>');
      // leg extensions
      g.push('<path d="M1.33 -400.58L42.7 -560.5M1.33 -400.58L-39.3 -556"' + H + ' stroke-dasharray="3 5"/>');
      g.push('<path d="M-197.49 367.38L-246 554M197.03 367.76L245 556"' + H + ' stroke-dasharray="3 5"/>');
      g.push('</g>');
      // ticks around r=520
      var ticks = '';
      for (var a = 0; a < 360; a += 5) {
        var len = a % 30 === 0 ? 22 : 10, rad = a * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
        ticks += 'M' + (c * 520).toFixed(1) + ' ' + (s * 520).toFixed(1) + 'L' + (c * (520 + len)).toFixed(1) + ' ' + (s * (520 + len)).toFixed(1);
      }
      g.push('<path class="cx-ticks" d="' + ticks + '" fill="none" stroke="currentColor" stroke-width="1"' + H + ' opacity=".45"/>');
      // Radius lines
      g.push('<g fill="none" stroke="var(--accent, #C07A42)" stroke-width="1">');
      g.push('<path d="M0 0L282.8 282.8"' + H + '/><circle cx="282.8" cy="282.8" r="4" fill="var(--accent, #C07A42)" stroke="none"/>');
      g.push('<path d="M0 0L-146 -146"' + H + '/><circle cx="-146" cy="-146" r="4" fill="var(--accent, #C07A42)" stroke="none"/>');
      // apex angle arc (legs at 104.5° and 75.7°)
      var ar = 150, a1 = 75.7 * Math.PI / 180, a2 = 104.5 * Math.PI / 180;
      g.push('<path d="M' + (1.33 + Math.cos(a1) * ar).toFixed(1) + ' ' + (-400.58 + Math.sin(a1) * ar).toFixed(1) + 'A' + ar + ' ' + ar + ' 0 0 1 ' + (1.33 + Math.cos(a2) * ar).toFixed(1) + ' ' + (-400.58 + Math.sin(a2) * ar).toFixed(1) + '"' + H + '/>');
      // dimension line under the mark
      g.push('<path d="M-400 470H400M-400 455V485M400 455V485M-400 30V455M400 30V455"' + H + ' stroke-dasharray="0"/>');
      g.push('</g>');
      g.push('<circle r="6" fill="currentColor"/>');
      // labels
      var T = function (x, y, t, anchor, cls) { return '<text x="' + x + '" y="' + y + '" text-anchor="' + (anchor || 'start') + '" class="' + (cls || '') + '">' + t + '</text>'; };
      g.push('<g class="cx-labels" fill="currentColor" font-size="17" font-weight="500" letter-spacing="2.5">');
      g.push('<g fill="var(--accent, #C07A42)">' + T(296, 300, 'R 400') + T(-160, -160, 'R 207', 'end') + T(1.33, -222, '28.8°', 'middle') + T(0, 506, 'Ø 800 — LINE WEIGHT 29.6', 'middle') + '</g>');
      g.push('<g opacity=".55">' + T(-560, -598, 'CS—MARK 01') + T(560, -598, 'CONSTRUCTION', 'end') + T(-560, 616, 'SCALE 1:1') + T(560, 616, 'C · O · A', 'end') + '</g>');
      g.push('</g>');
      // corner registration marks
      g.push('<g stroke="currentColor" stroke-width="1" opacity=".55" fill="none">' +
        ['-630 -630', '630 -630', '-630 630', '630 630'].map(function (p) { var xy = p.split(' '); return '<path d="M' + (xy[0] - 12) + ' ' + xy[1] + 'h24M' + xy[0] + ' ' + (xy[1] - 12) + 'v24"' + H + '/>'; }).join('') + '</g>');
      // circular text r=588
      var text = (o.text || 'Cola Studio — International Fashion Studio — Design · Production · Craftsmanship — ').toUpperCase(), n = text.length, ring = '';
      for (var i = 0; i < n; i++) { if (text[i] === ' ') continue; ring += '<text transform="rotate(' + ((360 / n) * i).toFixed(2) + ') translate(0 -588)" text-anchor="middle">' + Cola.esc(text[i]) + '</text>'; }
      var markup = g.join('');
      return '<svg class="construction ' + (o.cls || '') + '" viewBox="-640 -640 1280 1280" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<g class="cx-ring" fill="currentColor" font-size="15" font-weight="500" letter-spacing="1" opacity=".7">' + ring + '</g>' +
        '<g class="cx-layer">' + markup + '</g>' +
        '<g class="cx-mark">' + brand.mono({ cls: 'cx-mono' }).replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + VB + '"', '<svg x="-415" y="-415" width="830" height="830" viewBox="' + VB + '"') + '</g>' +
        '</svg>';
    }
  });
})();
