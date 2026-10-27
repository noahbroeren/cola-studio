/*!
 * Cola Studio — garment technical flats
 * Tech-pack style SVG flats, fabric swatches and pattern-piece layouts.
 * Classic script, no dependencies. Exposes window.ColaGarments.
 *
 *   ColaGarments.types                      → ['tee', 'longsleeve', …]  (24 ids)
 *   ColaGarments.textures                   → ['jersey', 'fleece', …]   (12 ids)
 *   ColaGarments.render(type, opts)         → '<svg viewBox="0 0 800 1000">…'
 *       opts: { color '#hex' (default #D9D2C5), view 'front'|'back', accent '#hex', print null|'monogram'|'pocket',
 *               bg null|'#hex', title, className }. Unknown type → folded-garment fallback; never throws.
 *   ColaGarments.dataUri(type, opts)        → 'data:image/svg+xml;charset=utf-8,…' (with width/height for <img>/CSS)
 *   ColaGarments.swatch(color, texture, o)  → '<svg viewBox="0 0 200 200">…' (also accepts (texture, { color }))
 *   ColaGarments.patternPieces(type, o)     → '<svg viewBox="0 0 800 1000">…'  o: { stroke, accent, title, className }
 *   ColaGarments.pattern / swatchUri / patternUri — aliases and data-URI helpers.
 *
 * Output contains no id attributes and no url(#…) references (safe with <base href> and many per page).
 * Geometry is generated once per type/view/print and cached; colours are applied per call.
 */
(function (root) {
  'use strict';

  var CX = 400;
  var DEF_COLOR = '#D9D2C5';

  /* ================================================================ colour */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function toRgb(hex) {
    if (typeof hex !== 'string') return null;
    var h = hex.trim().replace(/^#/, '');
    if (h.length === 3 || h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-f]{6}/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function toHex(c) {
    var s = '#';
    for (var i = 0; i < 3; i++) { var v = clamp(Math.round(c[i]), 0, 255); s += (v < 16 ? '0' : '') + v.toString(16); }
    return s;
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function lum(c) {
    function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  var WHITE = [255, 255, 255], BLACK = [0, 0, 0], INK = [26, 20, 17], WARM = [44, 28, 18];

  /** Colour tokens used by every flat. Light fills get warm near-black linework, dark fills a lifted tone of themselves. */
  function palette(color, accent, defAccent) {
    var c = toRgb(color) || toRgb(DEF_COLOR), L = lum(c), dark = L < 0.085;
    var line = dark ? mix(c, WHITE, 0.46 + (0.085 - L) * 1.6) : INK;
    var a = toRgb(accent) || toRgb(defAccent) || (dark ? mix(c, WHITE, 0.3) : mix(c, BLACK, 0.3));
    var light = L > 0.45;
    return {
      f: toHex(c), l: toHex(line),
      lo: dark ? 0.95 : 0.86,          // outline
      lso: dark ? 0.8 : 0.72,          // seams
      lto: dark ? 0.7 : 0.6,           // topstitch
      lfo: dark ? 0.34 : 0.3,          // fine texture lines
      fo: dark ? 0.24 : 0.17,          // folds
      s: dark ? '#000000' : toHex(mix(c, WARM, 0.8)), so: dark ? 0.32 : (light ? 0.075 : 0.1),
      h: '#ffffff', ho: dark ? 0.045 : (light ? 0.26 : 0.11),
      i: toHex(dark ? mix(c, BLACK, 0.38) : mix(c, WARM, light ? 0.16 : 0.26)),
      r: toHex(mix(c, BLACK, dark ? 0.12 : 0.045)),
      a: toHex(a),
      ad: toHex(mix(a, BLACK, 0.35)),
      m: toHex(dark ? mix(c, WHITE, 0.66) : mix(c, INK, 0.72)),
      bt: toHex(dark ? mix(c, WHITE, 0.16) : mix(c, BLACK, 0.12)),
      mt: dark ? '#9C958C' : '#B9B0A3', mtl: dark ? '#D8D2C8' : '#4A423B',
      hn: '#5C4232', hnl: '#2E1F16', hnh: '#8A6A50'
    };
  }

  /* ================================================================ paths */

  function n1(v) { return Math.round(v * 10) / 10; }
  var ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, A: 7, Z: 0 };
  function isCmd(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
  /** read one number starting at i; returns end index (number in SCAN.v) */
  var SCAN = { v: 0 };
  function readNum(d, i, n) {
    var j = i, c = d.charCodeAt(j), dot = false;
    if (c === 45 || c === 43) j++;
    while (j < n) {
      c = d.charCodeAt(j);
      if (c >= 48 && c <= 57) j++;
      else if (c === 46 && !dot) { dot = true; j++; }
      else if (c === 101 || c === 69) { j++; c = d.charCodeAt(j); if (c === 45 || c === 43) j++; }
      else break;
    }
    SCAN.v = +d.slice(i, j);
    return j;
  }
  /** parse path data (M L H V C Q Z, absolute or relative) into absolute M/L/C/Q/Z segments — single pass */
  function parse(d) {
    var out = [], n = d.length, i = 0, cmd = 'M', C = 'M', rel = false, k = 2, a = [], cx = 0, cy = 0, sx = 0, sy = 0, c, j;
    while (i < n) {
      c = d.charCodeAt(i);
      if (c === 32 || c === 44 || c === 10 || c === 9) { i++; continue; }
      if (isCmd(c)) {
        cmd = d[i]; C = cmd.toUpperCase(); rel = cmd !== C; k = ARITY[C]; a = []; i++;
        if (C === 'Z') { out.push(['Z']); cx = sx; cy = sy; }
        continue;
      }
      i = readNum(d, i, n);
      a.push(SCAN.v);
      if (a.length < k) continue;
      if (C === 'H') { cx = rel ? cx + a[0] : a[0]; out.push(['L', cx, cy]); }
      else if (C === 'V') { cy = rel ? cy + a[0] : a[0]; out.push(['L', cx, cy]); }
      else if (C === 'A') { cx = rel ? cx + a[5] : a[5]; cy = rel ? cy + a[6] : a[6]; out.push(['L', cx, cy]); }
      else {
        if (rel) for (j = 0; j < k; j++) a[j] += j % 2 ? cy : cx;
        var T = C;
        a.unshift(T);
        out.push(a);
        cx = a[k - 1]; cy = a[k];
        if (T === 'M') { sx = cx; sy = cy; C = 'L'; if (rel) cmd = 'l'; }
      }
      a = [];
    }
    return out;
  }
  function fmt(v) { return '' + Math.round(v * 10) / 10; }
  /**
   * transform path data without building segment arrays.
   * fx/fy map absolute x/y; relative deltas are negated when `flip`.
   */
  function xform(d, flip, dx, dy) {
    var out = '', n = d.length, i = 0, C = 'M', rel = false, k = 0, ar = 2, c, last = 77;
    while (i < n) {
      c = d.charCodeAt(i);
      if (c === 32 || c === 44 || c === 10 || c === 9) { i++; continue; }
      if (isCmd(c)) { var ch = d[i]; C = ch.toUpperCase(); rel = ch !== C; ar = ARITY[C]; k = 0; out += ch; last = c; i++; continue; }
      var i0 = i;
      i = readNum(d, i, n);
      var v = SCAN.v, idx = k, v0 = v;
      if (C === 'A') {
        if (idx === 2 && flip) v = -v;
        else if (idx === 4 && flip) v = 1 - v;
        else if (idx === 5) v = rel ? (flip ? -v : v) : (flip ? 2 * CX - v : v + dx);
        else if (idx === 6 && !rel) v += dy;
      } else {
        var isX = C === 'H' ? true : C === 'V' ? false : idx % 2 === 0;
        if (isX) v = rel ? (flip ? -v : v) : (flip ? 2 * CX - v : v + dx);
        else if (!rel) v += dy;
      }
      var sv = v === v0 ? d.slice(i0, i) : (v === Math.floor(v) ? '' + v : fmt(v));
      out += (isCmd(last) || sv.charCodeAt(0) === 45) ? sv : ' ' + sv;
      last = 48;
      k++; if (k === ar) { k = 0; if (C === 'M') C = 'L'; }
    }
    return out;
  }
  function toD(segs) {
    var s = '';
    for (var i = 0; i < segs.length; i++) {
      var g = segs[i]; s += g[0];
      for (var j = 1; j < g.length; j++) s += (j > 1 ? ' ' : '') + n1(g[j]);
    }
    return s;
  }
  function mirSegs(segs) {
    return segs.map(function (g) { return g.map(function (v, j) { return j && j % 2 ? 2 * CX - v : v; }); });
  }
  function endPt(g) { return [g[g.length - 2], g[g.length - 1]]; }
  function revSegs(segs) {
    var s = segs.filter(function (g) { return g[0] !== 'Z'; });
    var pts = s.map(endPt), out = [['M'].concat(pts[pts.length - 1])];
    for (var i = s.length - 1; i >= 1; i--) {
      var g = s[i], p = pts[i - 1];
      if (g[0] === 'C') out.push(['C', g[3], g[4], g[1], g[2], p[0], p[1]]);
      else if (g[0] === 'Q') out.push(['Q', g[1], g[2], p[0], p[1]]);
      else out.push(['L', p[0], p[1]]);
    }
    return out;
  }
  /** mirror a path about x=400 */
  function mir(d) { return xform(d, true, 0, 0); }
  /** path + its mirror (two sub-paths) */
  function both(d) { return d + mir(d); }
  /** closed symmetric shape from a left-half path running centre-top → centre-bottom */
  function sym(d) {
    var h = parse(d);
    return toD(h) + toD(revSegs(mirSegs(h)).slice(1)) + 'Z';
  }
  /** flatten path to polyline points */
  function flat(d, steps) {
    var segs = typeof d === 'string' ? parse(d) : d, pts = [], cur = [0, 0], st = steps || 10;
    for (var i = 0; i < segs.length; i++) {
      var g = segs[i], t, k;
      if (g[0] === 'M' || g[0] === 'L') { cur = [g[1], g[2]]; pts.push(cur); }
      else if (g[0] === 'C') {
        for (k = 1; k <= st; k++) {
          t = k / st; var u = 1 - t;
          pts.push([u * u * u * cur[0] + 3 * u * u * t * g[1] + 3 * u * t * t * g[3] + t * t * t * g[5],
                    u * u * u * cur[1] + 3 * u * u * t * g[2] + 3 * u * t * t * g[4] + t * t * t * g[6]]);
        }
        cur = [g[5], g[6]];
      } else if (g[0] === 'Q') {
        for (k = 1; k <= st; k++) {
          t = k / st; var v = 1 - t;
          pts.push([v * v * cur[0] + 2 * v * t * g[1] + t * t * g[3], v * v * cur[1] + 2 * v * t * g[2] + t * t * g[4]]);
        }
        cur = [g[3], g[4]];
      }
    }
    return pts;
  }
  /** n+1 points evenly spaced (by length) along a path */
  function sample(d, n) {
    var p = flat(d, 12), L = [0], i;
    for (i = 1; i < p.length; i++) L.push(L[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    var tot = L[L.length - 1], out = [], j = 1;
    for (var k = 0; k <= n; k++) {
      var s = tot * k / n;
      while (j < L.length - 1 && L[j] < s) j++;
      var seg = L[j] - L[j - 1] || 1, t = (s - L[j - 1]) / seg;
      out.push([p[j - 1][0] + (p[j][0] - p[j - 1][0]) * t, p[j - 1][1] + (p[j][1] - p[j - 1][1]) * t]);
    }
    return out;
  }
  var rnd = Math.round;
  /** rib lines between two roughly parallel edges (both drawn in the same direction) */
  function ribs(dA, dB, n, from, to) {
    var A = sample(dA, n), B = sample(dB, n), s = '';
    for (var i = from == null ? 1 : from; i <= (to == null ? n - 1 : to); i++) {
      var ax = rnd(A[i][0]), ay = rnd(A[i][1]);
      s += 'M' + ax + ' ' + ay + 'l' + (rnd(B[i][0]) - ax) + ' ' + (rnd(B[i][1]) - ay);
    }
    return s;
  }
  /** parallel lines at `ang` degrees clipped to polygon(s); ins = inset from the edge */
  function hatch(d, ang, gap, ph, ins) {
    var poly = Array.isArray(d) ? d : flat(d, 8);
    var a = ang * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), P = [], i;
    var y0 = Infinity, y1 = -Infinity;
    for (i = 0; i < poly.length; i++) {
      var q = [poly[i][0] * c + poly[i][1] * s, -poly[i][0] * s + poly[i][1] * c];
      P.push(q); if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
    }
    var out = '', n = P.length, e = ins || 0;
    for (var y = y0 + (ph == null ? gap / 2 : ph); y < y1; y += gap) {
      var xs = [];
      for (i = 0; i < n; i++) {
        var A = P[i], B = P[(i + 1) % n];
        if ((A[1] <= y) !== (B[1] <= y)) xs.push(A[0] + (y - A[1]) * (B[0] - A[0]) / (B[1] - A[1]));
      }
      xs.sort(function (p, q) { return p - q; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        var xa = xs[k] + e, xb = xs[k + 1] - e;
        if (xb - xa < 2) continue;
        var px = rnd(xa * c - y * s), py = rnd(xa * s + y * c);
        out += 'M' + px + ' ' + py + 'l' + (rnd(xb * c - y * s) - px) + ' ' + (rnd(xb * s + y * c) - py);
      }
    }
    return out;
  }
  function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  function pt(p) { return Math.round(p[0]) + ' ' + Math.round(p[1]); }

  /* ================================================================ builder */

  /** Layered output: each part() opens a new level; within a level fill → shade → highlight → folds → texture → seams → topstitch → outline → hardware. */
  function Bld(k) { this.L = []; this.k = k || 1; this.lvl(); }
  Bld.prototype = {
    lvl: function () { this.c = { f: '', sh: '', hi: '', fo: '', fi: '', se: '', st: '', sa: '', ln: '', hw: '' }; this.L.push(this.c); return this; },
    part: function (d, fill, outline) {
      this.lvl();
      this.c.f += '<path d="' + d + '" fill="' + (fill || '{f}') + '"/>';
      if (outline !== false) this.c.ln += '<path d="' + (outline || d) + '"/>';
      return this;
    },
    fill: function (d, fill) { this.c.f += '<path d="' + d + '" fill="' + (fill || '{f}') + '"/>'; return this; },
    sh: function (d) { this.c.sh += d; return this; },
    hi: function (d) { this.c.hi += d; return this; },
    fold: function (d) { this.c.fo += d; return this; },
    fine: function (d) { this.c.fi += d; return this; },
    seam: function (d) { this.c.se += d; return this; },
    st: function (d) { this.c.st += d; return this; },
    sa: function (d) { this.c.sa += d; return this; },
    line: function (d) { this.c.ln += '<path d="' + d + '"/>'; return this; },
    hw: function (s) { this.c.hw += s; return this; },
    out: function () {
      var s = '', k = this.k, w = function (v) { return n1(v * k * 100) / 100; };
      for (var i = 0; i < this.L.length; i++) {
        var c = this.L[i];
        s += c.f;
        if (c.sh) s += '<path d="' + c.sh + '" fill="{s}" opacity="{so}"/>';
        if (c.hi) s += '<path d="' + c.hi + '" fill="{h}" opacity="{ho}"/>';
        if (c.fo) s += '<path d="' + c.fo + '" fill="none" stroke="{l}" stroke-width="' + w(1.3) + '" opacity="{fo}"/>';
        if (c.fi) s += '<path d="' + c.fi + '" fill="none" stroke="{l}" stroke-width="' + w(0.9) + '" opacity="{lfo}"/>';
        if (c.se) s += '<path d="' + c.se + '" fill="none" stroke="{l}" stroke-width="' + w(1.4) + '" opacity="{lso}"/>';
        if (c.st) s += '<path d="' + c.st + '" fill="none" stroke="{l}" stroke-width="' + w(1.1) + '" stroke-dasharray="' + w(5) + ' ' + w(4) + '" opacity="{lto}"/>';
        if (c.sa) s += '<path d="' + c.sa + '" fill="none" stroke="{a}" stroke-width="' + w(1.3) + '" stroke-dasharray="' + w(5) + ' ' + w(3.5) + '" opacity=".95"/>';
        if (c.ln) s += '<g fill="none" stroke="{l}" stroke-width="' + w(2.6) + '" opacity="{lo}">' + c.ln + '</g>';
        s += c.hw;
      }
      return s;
    }
  };

  /* ================================================================ hardware & marks */

  function circ(x, y, r) { r = n1(r); var R = r + ' ' + r + ' 0 1 0 '; return 'M' + n1(x - r) + ' ' + n1(y) + 'a' + R + n1(2 * r) + ' 0a' + R + n1(-2 * r) + ' 0Z'; }
  function button(x, y, r) {
    r = r || 9;
    return '<circle cx="' + n1(x) + '" cy="' + n1(y) + '" r="' + r + '" fill="{bt}" stroke="{l}" stroke-width="1.2" opacity=".95"/>' +
      '<path d="' + circ(x - r * 0.3, y, r * 0.15) + circ(x + r * 0.3, y, r * 0.15) + '" fill="{l}" opacity=".7"/>';
  }
  function horn(x, y, r) {
    r = r || 9;
    return '<circle cx="' + n1(x) + '" cy="' + n1(y) + '" r="' + r + '" fill="{hn}" stroke="{hnl}" stroke-width="1.2"/>' +
      '<circle cx="' + n1(x) + '" cy="' + n1(y) + '" r="' + n1(r * 0.62) + '" fill="none" stroke="{hnh}" stroke-width="1"/>' +
      '<path d="' + circ(x - r * 0.26, y, r * 0.14) + circ(x + r * 0.26, y, r * 0.14) + '" fill="{hnl}"/>';
  }
  function snap(x, y, r) {
    r = r || 8;
    return '<circle cx="' + n1(x) + '" cy="' + n1(y) + '" r="' + r + '" fill="{mt}" stroke="{mtl}" stroke-width="1.1"/>' +
      '<circle cx="' + n1(x) + '" cy="' + n1(y) + '" r="' + n1(r * 0.45) + '" fill="none" stroke="{mtl}" stroke-width=".9" opacity=".8"/>';
  }
  function rivet(x, y, r) {
    r = r || 3.4;
    return '<circle cx="' + n1(x) + '" cy="' + n1(y) + '" r="' + r + '" fill="{a}" stroke="{ad}" stroke-width=".9"/>';
  }
  /** vertical zip: tape lines, teeth ticks, optional puller at top */
  function zip(x, y1, y2, puller, tw) {
    var t = '', w = tw || 4;
    for (var y = y1 + 3; y < y2 - 1; y += 4.2) t += 'M' + n1(x - w) + ' ' + n1(y) + 'h' + 2 * w;
    var s = '<path d="' + t + '" stroke="{l}" stroke-width="1" opacity=".55"/>' +
      '<path d="M' + n1(x) + ' ' + y1 + 'L' + n1(x) + ' ' + y2 + '" stroke="{l}" stroke-width="1.2" opacity=".8"/>';
    if (puller) s += zipPull(x, puller === true ? y1 : puller);
    return s;
  }
  function zipPull(x, y, down) {
    var k = down === false ? -1 : 1;
    return '<path d="M' + n1(x - 5.5) + ' ' + n1(y) + 'h11l-1.5 ' + 14 * k + 'h-8Z" fill="{mt}" stroke="{mtl}" stroke-width="1.1"/>' +
      '<path d="M' + n1(x - 3.6) + ' ' + n1(y + 13 * k) + 'h7.2l1.2 ' + 22 * k + 'q-4.8 ' + 3 * k + ' -9.6 0Z" fill="{mt}" stroke="{mtl}" stroke-width="1.1"/>' +
      '<path d="M' + n1(x - 1.6) + ' ' + n1(y + 22 * k) + 'h3.2v' + 9 * k + 'h-3.2Z" fill="none" stroke="{mtl}" stroke-width=".9"/>';
  }
  function label(x, y, w, h, fill) {
    return '<rect x="' + n1(x) + '" y="' + n1(y) + '" width="' + w + '" height="' + h + '" fill="' + (fill || '{a}') + '" stroke="{l}" stroke-width=".9" opacity=".95"/>' +
      '<path d="M' + n1(x + 3) + ' ' + n1(y + h / 2) + 'h' + n1(w - 6) + '" stroke="{f}" stroke-width="1" opacity=".55" stroke-dasharray="2 1.5"/>';
  }
  /** brand mark: open outer ring (C), inner ring, A with crossbar — drawn as strokes */
  function monoMark(x, y, r, col, sw) {
    var w = sw || Math.max(1.2, r * 0.075), g = 13 * Math.PI / 180;
    var ax = r * Math.cos(g), ay = r * Math.sin(g), ri = r * 0.5;
    var d = 'M' + n1(x + ax) + ' ' + n1(y + ay) + 'A' + r + ' ' + r + ' 0 1 1 ' + n1(x + ax) + ' ' + n1(y - ay) +
      circ(x, y, n1(ri)) +
      'M' + n1(x - 0.5 * r) + ' ' + n1(y + 0.862 * r) + 'L' + n1(x) + ' ' + n1(y - r) + 'L' + n1(x + 0.5 * r) + ' ' + n1(y + 0.862 * r) +
      'M' + n1(x - 0.27 * r) + ' ' + n1(y) + 'H' + n1(x + 0.27 * r);
    return '<path d="' + d + '" fill="none" stroke="' + (col || '{m}') + '" stroke-width="' + n1(w) + '" stroke-linecap="butt"/>';
  }

  /* ================================================================ tops — shared geometry */

  // Tops share one scale: body ≈400 wide (x 200–600), dropped shoulder at P. Local frame: high point shoulder at y = 0.

  /** rib/band cuff quad from sleeve-end points O (outer) and I (inner) */
  function cuff(O, I, inset, depth) {
    var vx = I[0] - O[0], vy = I[1] - O[1], len = Math.hypot(vx, vy), ux = vx / len, uy = vy / len, dx = -uy, dy = ux;
    var a = [O[0] + ux * inset, O[1] + uy * inset], b = [I[0] - ux * inset, I[1] - uy * inset];
    return { a: a, b: b, a2: [a[0] + dx * depth, a[1] + dy * depth], b2: [b[0] + dx * depth, b[1] + dy * depth] };
  }

  /**
   * Generic top. o: { nw, nb, P, short, O, I, U, roll, cuff:{inset,depth,k:'rib'|'band'}, hx, len,
   *   hem: 'rib'|'straight'|'tail', rib, tail }
   */
  var TCACHE = {};
  function torso(o) {
    var key = JSON.stringify(o), hit = TCACHE[key];
    if (hit) { var cp = {}; for (var q in hit) cp[q] = hit[q]; return cp; }
    return (TCACHE[key] = torso_(o)), torso(o);
  }
  function torso_(o) {
    var g = { nw: o.nw, hps: [CX - o.nw, 0], nb: o.nb, len: o.len, P: o.P, U: o.U, O: o.O, I: o.I, hem: o.hem || 'straight' };
    var P = o.P, O = o.O, I = o.I, U = o.U, s;
    g.top = o.top || ('M400 ' + o.nb + 'C' + Math.round(CX - o.nw * 0.36) + ' ' + o.nb + ' ' + Math.round(CX - o.nw * 0.76) + ' ' + Math.round(o.nb * 0.7) + ' ' + g.hps[0] + ' 0');
    s = g.top + 'L' + pt(P);
    if (o.short) {
      g.outer = 'Q' + pt(o.q || [118, 72]) + ' ' + pt(O);
      s += g.outer + 'L' + pt(I);
    } else {
      var R = [O[0] + 13, P[1] + (o.roll || 134)];
      g.R = R;
      g.outer = 'C' + (P[0] - 42) + ' ' + (P[1] + 10) + ' ' + (R[0] + 7) + ' ' + (P[1] + 54) + ' ' + pt(R) + 'L' + pt(O);
      s += g.outer;
      if (o.cuff) {
        var cf = cuff(O, I, o.cuff.inset, o.cuff.depth);
        cf.k = o.cuff.k || 'rib';
        g.cf = cf;
        s += 'L' + pt(cf.a) + 'L' + pt(cf.a2) + 'L' + pt(cf.b2) + 'L' + pt(cf.b) + 'L' + pt(I);
      } else s += 'Q' + pt(lerp(lerp(O, I, 0.5), [O[0] + (I[1] - O[1]) * -0.04, O[1]], 0)) + ' ' + pt(I);
    }
    var m = lerp(I, U, 0.5);
    g.under = 'M' + pt(I) + 'Q' + n1(m[0] + 2) + ' ' + n1(m[1]) + ' ' + pt(U);
    s += 'Q' + n1(m[0] + 2) + ' ' + n1(m[1]) + ' ' + pt(U);
    var hx = o.hx, hy = o.len, hs;
    if (g.hem === 'rib') {
      hs = hy - o.rib;
      s += 'C' + (U[0] - 1) + ' ' + (U[1] + 90) + ' ' + hx + ' ' + (hs - 100) + ' ' + hx + ' ' + (hs - 6) + 'Q' + (hx + 1) + ' ' + hs + ' ' + (hx + 7) + ' ' + (hs + 1) + 'L' + (hx + 8) + ' ' + hy + 'L400 ' + hy;
      g.ribTop = hs + 1; g.ribX = hx + 7.5;
    } else if (g.hem === 'tail') {
      hs = hy - o.tail;
      s += 'C' + (U[0] - 1) + ' ' + (U[1] + 90) + ' ' + hx + ' ' + (hs - 100) + ' ' + hx + ' ' + hs + 'C' + (hx + 2) + ' ' + n1(hy - o.tail * 0.25) + ' ' + (hx + 90) + ' ' + (hy + 8) + ' 400 ' + (hy + 9);
      g.tail = o.tail;
    } else {
      hs = hy;
      s += 'C' + (U[0] - 1) + ' ' + (U[1] + 90) + ' ' + hx + ' ' + (hy - 120) + ' ' + hx + ' ' + hy + 'C' + (hx + 60) + ' ' + (hy + 1) + ' 330 ' + (hy + 2) + ' 400 ' + (hy + 2);
    }
    g.hx = hx; g.hs = hs;
    g.half = s;
    g.sil = sym(s);
    g.arm = o.arm || ('M' + pt(P) + 'C' + (P[0] + 12) + ' ' + (P[1] + 60) + ' ' + (U[0] - 4) + ' ' + (U[1] - 70) + ' ' + pt(U));
    return g;
  }

  /** standard top details: armholes, shading, sleeve ends, hem. o: { noArm, noHem, hemSt } */
  function topDetails(b, g, o) {
    o = o || {};
    var P = g.P, U = g.U, O = g.O, I = g.I, R = g.R;
    if (!o.noArm) b.seam(both(g.arm));
    var mid = (U[1] + g.hs) / 2;
    // right side falls into shade
    b.sh('M' + (800 - U[0]) + ' ' + (U[1] + 14) + 'L' + (800 - g.hx) + ' ' + (g.hs - 8) + 'Q' + (800 - g.hx - 62) + ' ' + n1(mid + 30) + ' ' + (800 - U[0]) + ' ' + (U[1] + 14) + 'Z');
    // soft light on the left front
    b.hi('M' + (U[0] + 8) + ' ' + (U[1] + 30) + 'Q' + (U[0] + 40) + ' ' + n1(mid) + ' ' + (g.hx + 10) + ' ' + (g.hs - 30) + 'Q' + (U[0] + 22) + ' ' + n1(mid) + ' ' + (U[0] + 8) + ' ' + (U[1] + 30) + 'Z');
    if (R) {
      var Pa = [P[0] - 26, P[1] + 10];
      var band = 'M' + pt(Pa) + 'C' + (P[0] - 62) + ' ' + (P[1] + 26) + ' ' + (R[0] + 3) + ' ' + (R[1] - 62) + ' ' + pt(R) + 'L' + pt(O) +
        'L' + pt(lerp(O, I, 0.28)) + 'C' + (O[0] + 30) + ' ' + (R[1] + 100) + ' ' + (R[0] + 30) + ' ' + (R[1] - 10) + ' ' + pt(Pa) + 'Z';
      b.sh(mir(band));
      b.hi('M' + pt([Pa[0] + 2, Pa[1] + 4]) + 'C' + (P[0] - 54) + ' ' + (P[1] + 32) + ' ' + (R[0] + 10) + ' ' + (R[1] - 56) + ' ' + pt([R[0] + 7, R[1]]) +
        'L' + pt([O[0] + 9, O[1] - 30]) + 'C' + (O[0] + 22) + ' ' + (R[1] + 90) + ' ' + (R[0] + 22) + ' ' + (R[1] - 20) + ' ' + pt([Pa[0] + 2, Pa[1] + 4]) + 'Z');
      b.sh(both('M' + pt([U[0] - 2, U[1] + 6]) + 'Q' + (U[0] - 10) + ' ' + (U[1] + 110) + ' ' + pt([I[0] + 2, I[1] - 8]) +
        'Q' + (U[0] - 22) + ' ' + (U[1] + 100) + ' ' + pt([U[0] - 2, U[1] + 6]) + 'Z'));
      var cf = g.cf;
      if (cf) {
        b.seam(both('M' + pt(cf.a) + 'L' + pt(cf.b)));
        if (cf.k === 'rib') {
          b.fine(both(ribs('M' + pt(cf.a) + 'L' + pt(cf.b), 'M' + pt(cf.a2) + 'L' + pt(cf.b2), 13)));
          b.fold(both('M' + pt(lerp(O, I, 0.3)) + 'l3 -14M' + pt(lerp(O, I, 0.62)) + 'l-2 -16'));
        }
      } else if (!o.noCuffSt) {
        b.st(both(offLine(O, I, 14, 2)));
      }
      var e = R[1] + 100;
      if (!o.noFold) b.fold(both('M' + (R[0] + 8) + ' ' + e + 'Q' + (R[0] + 30) + ' ' + (e - 8) + ' ' + (R[0] + 56) + ' ' + (e + 4) + 'M' + (R[0] + 6) + ' ' + (e + 38) + 'Q' + (R[0] + 24) + ' ' + (e + 34) + ' ' + (R[0] + 44) + ' ' + (e + 42)));
    } else {
      b.sh(mir('M' + pt([U[0] - 4, U[1] + 2]) + 'L' + pt([I[0] + 3, I[1] - 4]) + 'L' + pt(lerp(I, O, 0.35)) + 'Q150 150 ' + pt([U[0] - 4, U[1] + 2]) + 'Z'));
      b.st(both(offLine(O, I, 17) + offLine(O, I, 22)));
      b.fold(both('M206 206Q232 226 246 262M200 232Q222 262 228 300'));
    }
    if (g.hem === 'rib') {
      var rt = g.ribTop, hy = g.len, x0 = g.ribX, x1 = 800 - g.ribX;
      b.seam('M' + x0 + ' ' + rt + 'L' + x1 + ' ' + rt);
      b.fine(ribs('M' + x0 + ' ' + rt + 'L' + x1 + ' ' + rt, 'M' + x0 + ' ' + hy + 'L' + x1 + ' ' + hy, Math.round((x1 - x0) / 7)));
      b.fold('M' + (x0 + 35) + ' ' + (rt - 2) + 'l2 -14M' + (x0 + 90) + ' ' + (rt - 2) + 'l-1 -10M' + (x1 - 100) + ' ' + (rt - 2) + 'l1 -12M' + (x1 - 44) + ' ' + (rt - 2) + 'l-2 -14');
    } else if (!o.noHem) {
      var hy2 = g.len, hx = g.hx + 2, k = o.hemSt || [20, 25];
      for (var i = 0; i < k.length; i++) {
        var y = hy2 - k[i];
        if (g.hem === 'tail') b.st(both('M' + hx + ' ' + (g.hs - k[i] * 0.3) + 'C' + hx + ' ' + n1(hy2 - g.tail * 0.25 - k[i]) + ' ' + (hx + 88) + ' ' + (hy2 + 8 - k[i]) + ' 400 ' + (hy2 + 9 - k[i])));
        else b.st('M' + hx + ' ' + y + 'C' + (hx + 58) + ' ' + (y + 1) + ' 330 ' + (y + 2) + ' 400 ' + (y + 2) + 'C470 ' + (y + 2) + ' ' + (800 - hx - 58) + ' ' + (y + 1) + ' ' + (800 - hx) + ' ' + y);
      }
    }
  }

  var KNIT = {
    tee: { short: true, P: [176, 34], O: [70, 128], I: [161, 231], U: [200, 192], hx: 203, len: 494 },
    long: { P: [176, 34], O: [88, 452], I: [172, 459], U: [200, 204], roll: 118, cuff: { inset: 6, depth: 40 }, hx: 203, len: 494 },
    sweat: { P: [174, 36], O: [76, 424], I: [180, 433], U: [200, 212], cuff: { inset: 9, depth: 50 }, hx: 203, len: 520, hem: 'rib', rib: 48 }
  };
  function knit(kind, nw, nb, extra) {
    var o = {}, k = KNIT[kind], key;
    for (key in k) o[key] = k[key];
    for (key in extra || {}) o[key] = extra[key];
    o.nw = nw; o.nb = nb;
    return torso(o);
  }

  /** line parallel to segment A→B, offset `d` px to the left of travel (towards garment interior for sleeve openings) */
  function offLine(A, B, d, shrink) {
    var vx = B[0] - A[0], vy = B[1] - A[1], L = Math.hypot(vx, vy), ux = vx / L, uy = vy / L, nx = uy, ny = -ux, k = shrink || 0;
    return 'M' + pt([A[0] + nx * d + ux * k, A[1] + ny * d + uy * k]) + 'L' + pt([B[0] + nx * d - ux * k, B[1] + ny * d - uy * k]);
  }

  /** crew neck: front shows inside back neck + label; back shows the band only */
  function crewNeck(b, g, view, band, depth) {
    var x = g.hps[0], nb = g.nb, w = band;
    if (view === 'back') {
      var outer = 'M400 ' + nb + 'C' + (CX - g.nw * 0.36) + ' ' + nb + ' ' + (CX - g.nw * 0.76) + ' ' + (nb * 0.7) + ' ' + x + ' 0';
      var inner = 'M400 ' + (nb + w) + 'C' + (CX - g.nw * 0.4) + ' ' + (nb + w) + ' ' + (x - w * 0.1) + ' ' + (nb * 0.9 + w * 0.8) + ' ' + (x - w) + ' ' + (w * 0.2);
      b.seam(both(inner));
      b.st(both(offY(inner, 5)));
      b.fine(ribs(outer, inner, 9, 1, 9) + mir(ribs(outer, inner, 9, 1, 9)));
      return;
    }
    var fy = depth;
    var edge = 'M' + x + ' 0C' + (x + 2) + ' ' + (fy * 0.6) + ' ' + (CX - g.nw * 0.5) + ' ' + fy + ' 400 ' + fy;
    var seam = 'M' + (x - w) + ' ' + (w * 0.2) + 'C' + (x - w + 2) + ' ' + (fy * 0.68 + w) + ' ' + (CX - g.nw * 0.55) + ' ' + (fy + w) + ' 400 ' + (fy + w);
    // interior (inside of back neck)
    b.fill(sym(g.top + 'C' + (x + 2) + ' ' + (fy * 0.6) + ' ' + (CX - g.nw * 0.5) + ' ' + fy + ' 400 ' + fy), '{i}');
    b.seam(both('M' + (x + 4) + ' ' + (nb * 0.55 + 6) + 'C' + (CX - g.nw * 0.62) + ' ' + (nb + w * 0.7) + ' ' + (CX - g.nw * 0.3) + ' ' + (nb + w) + ' 400 ' + (nb + w)));
    b.hw(label(386, nb + w + 1, 28, 12));
    // front band
    var bandD = sym('M400 ' + fy + 'C' + (CX - g.nw * 0.5) + ' ' + fy + ' ' + (x + 2) + ' ' + (fy * 0.6) + ' ' + x + ' 0L' + (x - w) + ' ' + (w * 0.2) +
      'C' + (x - w + 2) + ' ' + (fy * 0.68 + w) + ' ' + (CX - g.nw * 0.55) + ' ' + (fy + w) + ' 400 ' + (fy + w));
    b.part(bandD, '{f}', both(edge));
    b.sh(sym('M400 ' + fy + 'C' + (CX - g.nw * 0.5) + ' ' + fy + ' ' + (x + 2) + ' ' + (fy * 0.6) + ' ' + x + ' 0L' + (x - 3) + ' 3C' + (x - 1) + ' ' + (fy * 0.62) + ' ' + (CX - g.nw * 0.5) + ' ' + (fy + 5) + ' 400 ' + (fy + 5)));
    b.seam(both(seam));
    b.st(both(offY(seam, 5.5)));
    b.fine(ribs(edge, seam, 14, 1, 13) + mir(ribs(edge, seam, 14, 1, 13)));
  }
  /** shift a path vertically */
  function offY(d, dy) { return xform(d, false, 0, dy); }
  function offXY(d, dx, dy) { return xform(d, false, dx, dy); }

  /* ================================================================ garments */

  var G = {};
  function bbox(top, bottom) { return [top, bottom]; }

  G.tee = function (v, o) {
    var g = knit('tee', 80, 12);
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g);
    crewNeck(b, g, v, 16, 62);
    if (v !== 'back') {
      if (o.print === 'monogram') b.hw(monoMark(400, 168, 34));
      else if (o.print === 'pocket') pocketPatch(b, 476, 124, 86, 98);
      b.hw(label(222, 452, 24, 10));
    }
    return { svg: b.out(), box: bbox(0, 496) };
  };

  function pocketPatch(b, x, y, w, h) {
    var r = 10, d = 'M' + x + ' ' + y + 'H' + (x + w) + 'V' + (y + h - r) + 'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w - r) + ' ' + (y + h) + 'H' + (x + r) + 'Q' + x + ' ' + (y + h) + ' ' + x + ' ' + (y + h - r) + 'Z';
    b.lvl();
    b.fill(d);
    b.sh('M' + (x + w - 10) + ' ' + (y + 18) + 'H' + (x + w) + 'V' + (y + h - r) + 'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w - r) + ' ' + (y + h) + 'H' + (x + 20) + 'Q' + (x + w - 8) + ' ' + (y + h - 6) + ' ' + (x + w - 10) + ' ' + (y + 18) + 'Z');
    b.seam(d + 'M' + x + ' ' + (y + 16) + 'H' + (x + w));
    var i = 5;
    b.st('M' + (x + i) + ' ' + (y + 16) + 'V' + (y + h - r) + 'Q' + (x + i) + ' ' + (y + h - i) + ' ' + (x + r + 2) + ' ' + (y + h - i) + 'H' + (x + w - r - 2) + 'Q' + (x + w - i) + ' ' + (y + h - i) + ' ' + (x + w - i) + ' ' + (y + h - r) + 'V' + (y + 16) +
      'M' + x + ' ' + (y + 11) + 'H' + (x + w));
  }

  G.longsleeve = function (v, o) {
    var g = knit('long', 80, 12);
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g);
    crewNeck(b, g, v, 16, 62);
    if (v !== 'back') {
      if (o.print === 'monogram') b.hw(monoMark(400, 168, 34));
      else if (o.print === 'pocket') pocketPatch(b, 476, 124, 86, 98);
      b.hw(label(222, 452, 24, 10));
    }
    return { svg: b.out(), box: bbox(0, 496) };
  };

  G.crewneck = function (v, o) {
    var g = knit('sweat', 84, 12);
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g);
    crewNeck(b, g, v, 22, 66);
    if (v !== 'back') {
      // V-insert below the neck rib
      b.lvl();
      b.fill('M384 88L416 88L400 124Z', '{r}');
      b.seam('M382 88L400 126L418 88');
      b.fine('M388 92L400 116M412 92L400 116M394 90L400 102M406 90L400 102');
      if (o.print === 'monogram') b.hw(monoMark(400, 190, 34));
      else if (o.print === 'pocket') pocketPatch(b, 476, 140, 86, 98);
    }
    return { svg: b.out(), box: bbox(0, 520) };
  };

  /** three-panel hood. zipFront: edges meet at the zip instead of crossing over */
  function hood(b, v, zipFront) {
    var outer = 'M400 -216C328 -216 276 -172 267 -104C261 -58 268 -18 290 6';
    var neck = v === 'back' ? 'C326 16 366 20 400 20' : 'C296 48 346 80 400 82';
    b.part(sym(outer + neck), '{f}', both(outer));
    b.sh(mir(outer + 'L306 10C290 -26 286 -66 292 -106C302 -164 344 -198 400 -200Z'));
    b.hi('M318 -184C296 -160 284 -132 280 -98L294 -96C298 -126 308 -150 328 -172Z');
    if (v === 'back') {
      var p = 'M374 -215C370 -140 372 -60 380 20';
      b.seam(both(p));
      b.st(both(offXY(p, -6, 0)) + both(offXY(p, 6, 0)));
      b.fold('M322 -70Q338 -30 336 6M470 -140Q480 -96 474 -50');
      return;
    }
    var bot = zipFront ? 70 : 74;
    var openHalf = 'M400 -184C346 -184 312 -140 308 -80C305 -30 330 30 400 ' + bot;
    b.part(sym(openHalf), '{i}');
    // depth inside the hood: brim shadow + inside centre-back seam + back-neck seam + label
    b.sh('M400 -184C346 -184 312 -140 308 -80C307 -62 309 -46 313 -32C320 -96 352 -156 400 -156C448 -156 480 -96 487 -32C491 -46 493 -62 492 -80C488 -140 454 -184 400 -184Z');
    b.seam('M400 -156C401 -90 401 -20 400 26M330 14Q366 28 400 30Q434 28 470 14');
    b.hw(label(388, 34, 24, 10));
    // edge band topstitch
    var band = 'M400 -200C336 -200 294 -150 292 -82C290 -26 316 34 372 76';
    b.st(both(band));
    b.seam('M400 -184V-216');
    b.seam(both('M290 6C296 48 346 80 400 82'));
    if (!zipFront) {
      // left hood edge crosses over the right one at the neck
      b.lvl();
      b.fill('M400 74L428 80L422 86Z');
      b.line('M400 74C408 78 416 81 424 84');
      b.st('M392 82C402 86 410 88 416 89');
    }
  }

  G.hoodie = function (v, o) {
    var g = knit('sweat', 92, 14);
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g);
    if (v !== 'back') kangaroo(b, false);
    if (v !== 'back' && o.print === 'monogram') b.hw(monoMark(400, 180, 34));
    hood(b, v);
    return { svg: b.out(), box: bbox(-216, 520) };
  };

  /** kangaroo pouch; split = two pockets either side of a centre zip */
  function kangaroo(b, split) {
    var top = 296, bot = 472, cx = split ? 390 : 400;
    var edge = 'M' + cx + ' ' + top + 'L284 ' + top + 'C270 338 246 384 238 424L236 ' + bot;
    b.lvl();
    b.fill(split ? both(edge + 'L' + cx + ' ' + bot + 'Z') : sym(edge + 'L400 ' + bot));
    b.sh(both('M284 ' + top + 'C270 338 246 384 238 424L250 426C258 386 280 340 296 ' + (top + 2) + 'Z'));
    b.seam(both(edge));
    b.st(both('M' + cx + ' ' + (top + 6) + 'L289 ' + (top + 6) + 'C275 340 252 386 244 426L242 ' + (bot - 2)));
    b.fold('M300 352Q330 360 352 380M500 352Q470 360 448 380');
  }

  G.ziphoodie = function (v, o) {
    var g = knit('sweat', 92, 14);
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g);
    if (v !== 'back') {
      kangaroo(b, true);
      b.lvl();
      b.seam('M393 70V520M407 70V520');
      b.st('M387 76V514M413 76V514');
      b.hw(zip(400, 70, 518) + '<rect x="395" y="506" width="10" height="12" rx="1.5" fill="{mt}" stroke="{mtl}" stroke-width="1"/>');
      if (o.print === 'monogram') b.hw(monoMark(500, 168, 24));
    }
    hood(b, v, true);
    if (v !== 'back') b.hw(zipPull(400, 74));
    return { svg: b.out(), box: bbox(-216, 520) };
  };

  /* ---------------------------------------------------------------- woven-top helpers */

  /**
   * Point collar with stand. c = { x: collar edge at shoulder, top: CB top y, tip: front tip, pt: collar point, sTop, sBot }
   * front: inside of back stand, front stand, two leaves + drop shadow; back: collar band.
   */
  function pointCollar(b, v, c) {
    var x = c.x, top = c.top, tip = c.tip, p = c.pt, r0 = [x - 12, top + 10];
    var backTop = 'M400 ' + top + 'C370 ' + top + ' ' + (x + 8) + ' ' + (top + 3) + ' ' + pt(r0);
    var outerEdge = 'C' + (x - 20) + ' ' + (top + 12) + ' ' + (x - 27) + ' -2 ' + (x - 28) + ' 8';
    if (v === 'back') {
      var bt = 'M400 ' + top + 'C356 ' + top + ' ' + (x + 2) + ' ' + (top + 2) + ' ' + (x - 12) + ' ' + (top + 9) + 'C' + (x - 20) + ' ' + (top + 14) + ' ' + (x - 25) + ' 2 ' + (x - 27) + ' 10';
      var lower = 'C' + (x + 4) + ' ' + (c.bBot - 2) + ' 362 ' + c.bBot + ' 400 ' + c.bBot;
      var band = sym(bt + lower);
      b.sh(offXY(band, 1, 7));
      b.part(band, '{f}', both(bt + lower));
      b.st(both('M' + (x - 21) + ' 5C' + (x + 6) + ' ' + (c.bBot - 7) + ' 362 ' + (c.bBot - 5) + ' 400 ' + (c.bBot - 5)));
      b.sh(mir('M' + (x - 12) + ' ' + (top + 9) + 'C' + (x - 20) + ' ' + (top + 14) + ' ' + (x - 25) + ' 2 ' + (x - 27) + ' 10C' + (x - 14) + ' 8 ' + (x - 4) + ' ' + (top + 14) + ' ' + (x - 12) + ' ' + (top + 9) + 'Z'));
      return;
    }
    var roll = 'C' + (r0[0] + 10) + ' ' + (r0[1] + 22) + ' ' + (tip[0] - 34) + ' ' + (tip[1] - 16) + ' ' + pt(tip);
    var leaf = 'M' + pt(tip) + 'L' + pt(p) + 'C' + (p[0] - 20) + ' ' + (p[1] - 34) + ' ' + (x - 30) + ' 46 ' + (x - 28) + ' 8' +
      'C' + (x - 27) + ' -2 ' + (x - 20) + ' ' + (top + 12) + ' ' + pt(r0) + roll + 'Z';
    // drop shadow of the leaves on the body
    b.sh(both(offXY(leaf, 3, 6)));
    // inside of the back stand
    b.lvl();
    b.fill(sym(backTop + 'C' + (r0[0] + 10) + ' ' + (r0[1] + 22) + ' ' + (tip[0] - 34) + ' ' + (tip[1] - 16) + ' 400 ' + tip[1]), '{i}');
    b.seam(both('M' + (x - 4) + ' ' + (top + 18) + 'Q360 ' + (top + 30) + ' 400 ' + (top + 30)));
    b.hw(label(388, top + 33, 24, 10));
    // front stand
    var st = 'M400 ' + c.sTop + 'C370 ' + c.sTop + ' ' + (x + 6) + ' ' + (c.sTop - 16) + ' ' + (x + 2) + ' ' + (top + 18);
    var sb = 'M' + (x + 10) + ' 4C' + (x + 12) + ' ' + (c.sBot - 24) + ' 368 ' + c.sBot + ' 400 ' + c.sBot;
    b.part(sym(st + 'L' + (x + 10) + ' 4C' + (x + 12) + ' ' + (c.sBot - 24) + ' 368 ' + c.sBot + ' 400 ' + c.sBot), '{f}', both(st));
    b.seam(both(sb));
    b.st(both(offY(st, 5)));
    // leaves
    b.part(both(leaf), '{f}');
    b.sh(mir('M' + pt(p) + 'C' + (p[0] - 20) + ' ' + (p[1] - 34) + ' ' + (x - 30) + ' 46 ' + (x - 28) + ' 8L' + (x - 16) + ' 10C' + (x - 16) + ' 46 ' + (p[0] - 8) + ' ' + (p[1] - 36) + ' ' + pt(p) + 'Z'));
    b.st(both('M' + (tip[0] - 5) + ' ' + (tip[1] + 6) + 'L' + (p[0] + 3) + ' ' + (p[1] - 8) + 'C' + (p[0] - 15) + ' ' + (p[1] - 36) + ' ' + (x - 24) + ' 46 ' + (x - 22) + ' 10'));
    b.hw(button(400, (c.sTop + c.sBot) / 2, 6.5));
  }
  /** woven patch pocket (rounded bottom), hem fold at top, double topstitch */
  function patchPocket(b, x, y, w, h, o) {
    o = o || {};
    var r = o.r == null ? 8 : o.r, pnt = o.point || 0;
    var d = 'M' + x + ' ' + y + 'H' + (x + w) + 'V' + (y + h - r - pnt) +
      (pnt ? 'L' + (x + w / 2) + ' ' + (y + h) + 'L' + x + ' ' + (y + h - pnt) : 'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w - r) + ' ' + (y + h) + 'H' + (x + r) + 'Q' + x + ' ' + (y + h) + ' ' + x + ' ' + (y + h - r)) + 'Z';
    b.sh(offXY(d, 2.5, 3.5));
    b.lvl();
    b.fill(d);
    b.sh('M' + (x + w - 9) + ' ' + (y + 14) + 'H' + (x + w) + 'V' + (y + h - r - pnt) + (pnt ? 'L' + (x + w / 2 + 10) + ' ' + (y + h - 4) : 'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w - r) + ' ' + (y + h) + 'H' + (x + w - 26)) + 'Q' + (x + w - 9) + ' ' + (y + h - 20) + ' ' + (x + w - 9) + ' ' + (y + 14) + 'Z');
    b.seam(d);
    var i = 5, hem = o.hem == null ? 18 : o.hem;
    if (hem) b.st('M' + x + ' ' + (y + hem) + 'H' + (x + w) + (o.dbl ? 'M' + x + ' ' + (y + hem - 5) + 'H' + (x + w) : ''));
    var k = function (j) {
      return 'M' + (x + j) + ' ' + (y + (hem ? hem : j)) + 'V' + (y + h - r - pnt - (pnt ? j * 0.4 : 0)) +
        (pnt ? 'L' + (x + w / 2) + ' ' + (y + h - j * 1.3) + 'L' + (x + w - j) + ' ' + (y + h - r - pnt - j * 0.4) :
          'Q' + (x + j) + ' ' + (y + h - j) + ' ' + (x + r + j * 0.6) + ' ' + (y + h - j) + 'H' + (x + w - r - j * 0.6) + 'Q' + (x + w - j) + ' ' + (y + h - j) + ' ' + (x + w - j) + ' ' + (y + h - r)) +
        'V' + (y + (hem ? hem : j));
    };
    b.st(k(i) + (o.dbl ? k(i + 5) : ''));
    if (o.slot) b.seam('M' + (x + o.slot) + ' ' + (y + hem) + 'V' + (y + h - 4)).st('M' + (x + o.slot - 4) + ' ' + (y + hem) + 'V' + (y + h - 8));
    if (o.tack) b.hw('<path d="M' + (x + 2) + ' ' + (y + 2) + 'v8M' + (x + w - 2) + ' ' + (y + 2) + 'v8" stroke="{l}" stroke-width="2.2" opacity=".6"/>');
  }
  /** flap (pointed or square) with button/snap. returns nothing */
  function flap(b, x, y, w, h, o) {
    o = o || {};
    var pnt = o.point || 0;
    var d = 'M' + (x - 2) + ' ' + y + 'H' + (x + w + 2) + 'V' + (y + h - pnt) + (pnt ? 'L' + (x + w / 2) + ' ' + (y + h) + 'L' + (x - 2) + ' ' + (y + h - pnt) : 'Q' + (x + w + 2) + ' ' + (y + h) + ' ' + (x + w - 6) + ' ' + (y + h) + 'H' + (x + 6) + 'Q' + (x - 2) + ' ' + (y + h) + ' ' + (x - 2) + ' ' + (y + h - 8)) + 'Z';
    b.sh(offXY(d, 2, 5));
    b.lvl();
    b.fill(d);
    b.seam(d);
    b.st('M' + (x + 3) + ' ' + (y + 3) + 'V' + (y + h - pnt - 4) + (pnt ? 'L' + (x + w / 2) + ' ' + (y + h - 5) + 'L' + (x + w - 3) + ' ' + (y + h - pnt - 4) : 'Q' + (x + 3) + ' ' + (y + h - 4) + ' ' + (x + 10) + ' ' + (y + h - 4) + 'H' + (x + w - 10) + 'Q' + (x + w - 3) + ' ' + (y + h - 4) + ' ' + (x + w - 3) + ' ' + (y + h - pnt - 4)) + 'V' + (y + 3));
    if (o.btn === 'snap') b.hw(snap(x + w / 2, y + h - pnt * 0.5 - 12, 6.5));
    else if (o.btn !== false) b.hw(button(x + w / 2, y + h - pnt * 0.6 - 11, 6.5));
  }
  /** front closure edge (overlap) with facing topstitch */
  function frontEdge(b, y0, y1, x) {
    x = x || 384;
    b.lvl();
    b.line('M' + x + ' ' + y0 + 'V' + y1);
    b.st('M' + (x + 6) + ' ' + (y0 + 4) + 'V' + (y1 - 4));
    b.sh('M' + (x - 1) + ' ' + y0 + 'h-7V' + y1 + 'h7Z');
  }
  /** polygon of a left sleeve panel (for texture clipping) */
  function sleevePoly(g, top) {
    var cf = g.cf, s = 'M' + pt(top || g.P) + (top ? 'L' + pt(g.P) : '') + g.outer;
    s += cf ? 'L' + pt(cf.a) + 'L' + pt(cf.b) + 'L' + pt(g.I) : 'L' + pt(g.I);
    s += g.under.replace(/^M[^Q]+/, '');
    s += 'C' + (g.U[0] - 4) + ' ' + (g.U[1] - 70) + ' ' + (g.P[0] + 12) + ' ' + (g.P[1] + 60) + ' ' + pt(top || g.P) + 'Z';
    return s;
  }

  /* ---------------------------------------------------------------- woven tops */

  G.shirt = function (v, o) {
    var g = torso({ nw: 72, nb: 12, P: [170, 40], O: [70, 458], I: [174, 468], U: [196, 214], cuff: { inset: 4, depth: 46, k: 'band' }, hx: 197, len: 548, hem: 'tail', tail: 58 });
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g, { hemSt: [8] });
    var cf = g.cf;
    // cuff: topstitch, button, sleeve placket + pleats
    b.st(both(offLine(cf.a, cf.b, -5, 3) + offLine(cf.a2, cf.b2, 5, 3)));
    var pl = lerp(cf.a, cf.b, 0.3), pq = lerp(cf.a, cf.b, 0.58), pr = lerp(cf.a, cf.b, 0.7);
    b.seam(both('M' + pt(pl) + 'L' + pt([pl[0] + 4, pl[1] - 74])));
    b.st(both('M' + pt([pl[0] + 6, pl[1] - 2]) + 'L' + pt([pl[0] + 10, pl[1] - 70]) + 'L' + pt([pl[0] + 2, pl[1] - 78])));
    b.fold(both('M' + pt(pq) + 'l1 -22M' + pt(pr) + 'l2 -18'));
    var cb = lerp(lerp(cf.a, cf.b, 0.8), lerp(cf.a2, cf.b2, 0.8), 0.5);
    b.hw(button(cb[0], cb[1], 5.5) + button(800 - cb[0], cb[1], 5.5));
    // side vent gusset
    b.seam(both('M' + (g.hx - 1) + ' ' + (g.hs - 2) + 'l9 -12l-2 14'));
    if (v === 'back') {
      b.seam(both('M180 104Q290 112 400 112'));
      b.st(both('M181 110Q290 118 400 118'));
      b.lvl();
      b.fill('M384 112L378 226L400 230L422 226L416 112Z', '{f}');
      b.sh('M400 116L416 112L422 226L400 230Z');
      b.seam('M386 112L380 224M414 112L420 224M398 112L400 230');
      b.st('M384 118H416');
      b.part('M393 112Q394 128 400 128Q406 128 407 112Z', '{f}', 'M393 112Q394 128 400 128Q406 128 407 112');
      b.fold('M300 300Q312 360 306 420M500 290Q488 360 496 430');
      pointCollar(b, 'back', { x: 330, top: -16, bBot: 18 });
      return { svg: b.out(), box: bbox(-20, 557) };
    }
    // box placket + buttons
    b.lvl();
    b.seam('M386 62V556M414 62V556');
    b.st('M390 64V554M410 64V554');
    b.sh('M414 62h5V556h-5Z');
    for (var y = 122; y < 540; y += 76) b.hw(button(400, y, 6.5));
    patchPocket(b, 448, 136, 82, 96, { point: 12, hem: 16 });
    b.fold('M250 250Q262 320 256 390M548 260Q540 330 546 400');
    pointCollar(b, 'front', { x: 330, top: -20, tip: [396, 40], pt: [352, 106], sTop: 36, sBot: 62 });
    return { svg: b.out(), box: bbox(-20, 557) };
  };

  G.overshirt = function (v, o) {
    var g = torso({ nw: 74, nb: 12, P: [168, 40], O: [68, 456], I: [176, 468], U: [195, 214], cuff: { inset: 4, depth: 44, k: 'band' }, hx: 196, len: 540, hem: 'tail', tail: 26 });
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g, { hemSt: [9] });
    var cf = g.cf;
    b.st(both(offLine(cf.a, cf.b, -5, 3) + offLine(cf.a2, cf.b2, 5, 3)));
    var pl = lerp(cf.a, cf.b, 0.3);
    b.seam(both('M' + pt(pl) + 'L' + pt([pl[0] + 4, pl[1] - 70])));
    var cb = lerp(lerp(cf.a, cf.b, 0.8), lerp(cf.a2, cf.b2, 0.8), 0.5);
    b.hw(button(cb[0], cb[1], 6) + button(800 - cb[0], cb[1], 6));
    if (v === 'back') {
      b.seam(both('M181 112Q290 120 400 120'));
      b.st(both('M181 118Q290 126 400 126'));
      b.seam(both('M262 118L258 190'));
      b.fold(both('M264 122Q268 170 262 230'));
      b.fold('M320 330Q332 390 326 450M480 320Q470 390 476 460');
      pointCollar(b, 'back', { x: 328, top: -18, bBot: 19 });
      return { svg: b.out(), box: bbox(-22, 550) };
    }
    frontEdge(b, 64, 549);
    for (var y = 128; y < 530; y += 80) b.hw(button(400, y, 7));
    patchPocket(b, 236, 150, 92, 104, { r: 6, hem: 0 });
    patchPocket(b, 472, 150, 92, 104, { r: 6, hem: 0 });
    b.seam('M282 154V250M518 154V250');
    flap(b, 236, 136, 92, 40, { point: 10 });
    flap(b, 472, 136, 92, 40, { point: 10 });
    b.fold('M252 300Q262 370 256 440M548 300Q540 370 546 440');
    pointCollar(b, 'front', { x: 328, top: -22, tip: [394, 44], pt: [346, 114], sTop: 38, sBot: 64 });
    return { svg: b.out(), box: bbox(-22, 550) };
  };

  G.workjacket = function (v, o) {
    var g = torso({ nw: 76, nb: 12, P: [166, 42], O: [64, 486], I: [176, 498], U: [194, 216], hx: 194, len: 556, hem: 'straight' });
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g, { hemSt: [14, 19], noCuffSt: true });
    b.st(both(offLine(g.O, g.I, 14, 2) + offLine(g.O, g.I, 19, 2)));
    // sleeve vent with two small buttons
    var vt = lerp(g.O, g.I, 0.72);
    b.seam(both('M' + pt(vt) + 'l3 -56'));
    b.hw(button(vt[0] - 9, vt[1] - 20, 5) + button(800 - vt[0] + 9, vt[1] - 20, 5));
    if (v === 'back') {
      b.seam(both('M182 120Q290 126 400 126'));
      b.st(both('M182 126Q290 132 400 132M182 131Q290 137 400 137'));
      b.seam('M400 137V557');
      b.st('M406 141V552');
      b.part('M393 126Q394 142 400 142Q406 142 407 126Z', '{f}', 'M393 126Q394 142 400 142Q406 142 407 126');
      b.fold('M300 300Q312 380 304 470M502 290Q490 380 498 480');
      pointCollar(b, 'back', { x: 324, top: -19, bBot: 21 });
      return { svg: b.out(), box: bbox(-24, 558) };
    }
    frontEdge(b, 72, 557);
    for (var y = 150; y < 540; y += 96) b.hw(button(400, y, 8.5));
    patchPocket(b, 230, 162, 102, 100, { r: 6, hem: 20, dbl: true, slot: 80 });
    patchPocket(b, 468, 162, 102, 100, { r: 6, hem: 20, dbl: true });
    patchPocket(b, 220, 332, 126, 124, { r: 8, hem: 22, dbl: true, tack: true });
    patchPocket(b, 454, 332, 126, 124, { r: 8, hem: 22, dbl: true, tack: true });
    b.fold('M352 470Q360 510 354 552M446 470Q440 510 446 552');
    pointCollar(b, 'front', { x: 324, top: -24, tip: [392, 52], pt: [334, 128], sTop: 44, sBot: 72 });
    b.hw(button(400, 58, 8));
    return { svg: b.out(), box: bbox(-24, 558) };
  };

  G.coach = function (v, o) {
    var g = torso({ nw: 76, nb: 12, P: [172, 46], O: [68, 452], I: [176, 464], U: [194, 218], cuff: { inset: 6, depth: 34, k: 'band' }, hx: 194, len: 524, hem: 'straight',
      arm: v === 'back' ? 'M316 16C270 64 214 140 194 218' : 'M310 26C264 76 214 146 194 218' });
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g, { noHem: true });
    var cf = g.cf;
    b.st(both(offLine(cf.a, cf.b, -5, 3) + offLine(cf.a2, cf.b2, 5, 3)));
    var cs = lerp(lerp(cf.a, cf.b, 0.78), lerp(cf.a2, cf.b2, 0.78), 0.5);
    b.hw(snap(cs[0], cs[1], 5.5) + snap(800 - cs[0], cs[1], 5.5));
    // drawcord channel
    b.seam('M196 496C262 497 330 498 400 498C470 498 538 497 604 496');
    b.st('M196 491C262 492 330 493 400 493C470 493 538 492 604 491M196 519C262 520 330 521 400 521C470 521 538 520 604 519');
    b.fold('M232 498l-2 18M300 499l1 20M500 499l-1 20M568 498l2 18');
    if (v === 'back') {
      b.seam(both('M196 150Q300 140 400 146'));
      b.st(both('M196 156Q300 146 400 152'));
      b.lvl();
      b.fill('M388 150L382 250L400 254L418 250L412 150Z');
      b.sh('M400 152L412 150L418 250L400 254Z');
      b.seam('M388 150L382 248M412 150L418 248M400 150V254');
      b.fold('M300 300Q310 380 304 460M500 300Q492 380 498 460');
      pointCollar(b, 'back', { x: 326, top: -15, bBot: 17 });
      return { svg: b.out(), box: bbox(-18, 526) };
    }
    frontEdge(b, 60, 525);
    for (var y = 132; y < 470; y += 88) b.hw(snap(400, y, 7.5));
    // angled welt hand pockets
    b.lvl();
    var wl = 'M300 318L316 318L288 420L272 420Z';
    b.fill(both(wl));
    b.seam(both(wl));
    b.st(both('M305 324L281 414'));
    b.hw('<path d="' + both('M299 316h18M271 422h18') + '" stroke="{l}" stroke-width="2.4" opacity=".55"/>');
    // cord ends with grommets, cord locks and aglets
    var cord = function (x, k) {
      return '<circle cx="' + x + '" cy="508" r="4.5" fill="{mt}" stroke="{mtl}" stroke-width="1"/>' +
        '<path d="M' + x + ' 508C' + (x + k * 2) + ' 530 ' + (x - k * 4) + ' 548 ' + (x - k * 2) + ' 572" fill="none" stroke="{l}" stroke-width="3.2" opacity=".85"/>' +
        '<rect x="' + (x - 6 - k * 2) + '" y="536" width="12" height="16" rx="3" fill="{mt}" stroke="{mtl}" stroke-width="1"/>' +
        '<rect x="' + (x - 3.2 - k * 2) + '" y="572" width="6.4" height="11" rx="1.5" fill="{l}" opacity=".9"/>';
    };
    b.hw(cord(368, 1) + cord(432, -1));
    pointCollar(b, 'front', { x: 326, top: -18, tip: [394, 42], pt: [356, 98], sTop: 34, sBot: 58 });
    return { svg: b.out(), box: bbox(-18, 584) };
  };

  /** rib-knit stand collar (bomber) */
  function ribCollar(b, v) {
    var backTop = 'M400 -24C366 -24 334 -20 316 -12';
    if (v === 'back') {
      var lower = 'C324 4 364 12 400 12';
      b.part(sym(backTop + 'L298 6' + lower), '{f}', both(backTop + 'L298 6'));
      b.seam(both('M298 6' + lower));
      b.fine(both(ribs(backTop, 'M400 12C364 12 324 4 298 6', 12)));
      return;
    }
    b.lvl();
    b.fill(sym(backTop + 'C322 18 356 38 400 42'), '{i}');
    b.fine(both(ribs(backTop, 'M400 -2C368 -2 340 -4 322 -2', 10)));
    var band = 'M316 -12C322 18 356 38 390 42L390 76C350 74 304 48 298 6Z';
    b.part(both(band), '{f}', both('M298 6L316 -12C322 18 356 38 390 42'));
    b.fine(both(ribs('M316 -12C322 18 356 38 390 42', 'M298 6C304 48 350 74 390 76', 13)));
    b.seam(both('M298 6C304 48 350 74 390 76'));
    b.sh(mir(band));
  }

  G.bomber = function (v, o) {
    var g = torso({ nw: 78, nb: 12, P: [170, 40], O: [70, 436], I: [178, 448], U: [194, 214], cuff: { inset: 9, depth: 46 }, hx: 196, len: 522, hem: 'rib', rib: 50 });
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g, { noFold: true });
    var rt = g.ribTop;
    // diamond quilting
    var armR = 'C' + (g.U[0] - 4) + ' ' + (g.U[1] - 70) + ' ' + (g.P[0] + 12) + ' ' + (g.P[1] + 60) + ' ' + pt(g.P);
    var panel = v === 'back' ? 'M400 12L400 ' + rt + 'L' + g.ribX + ' ' + rt + 'L196 ' + (rt - 8) + 'C196 380 194 300 194 214' + armR + 'L298 6C324 4 364 12 400 12Z'
      : 'M386 76L386 ' + rt + 'L' + g.ribX + ' ' + rt + 'L196 ' + (rt - 8) + 'C196 380 194 300 194 214' + armR + 'L298 6C304 48 350 74 386 76Z';
    var q = hatch(panel, 45, 44, 22, 3) + hatch(panel, -45, 44, 22, 3);
    var sp = sleevePoly(g), qs = hatch(sp, 45, 44, 10, 3) + hatch(sp, -45, 44, 10, 3);
    b.st(both(q + qs));
    if (v === 'back') {
      b.fold('M300 300Q312 360 306 430M500 300Q490 360 496 430');
      ribCollar(b, 'back');
      return { svg: b.out(), box: bbox(-24, 522) };
    }
    // welt pockets with tonal binding
    b.lvl();
    var wl = 'M298 332L316 330L290 428L272 430Z';
    b.fill(both(wl), '{r}');
    b.seam(both(wl));
    b.hw('<path d="' + both('M298 332L272 430') + '" stroke="{a}" stroke-width="2.4" opacity=".9"/>');
    b.st(both('M304 336L282 422'));
    // snap placket
    b.part('M386 42H414V522H386Z');
    b.sh('M408 42H414V522H408Z');
    b.st('M391 46V' + (rt - 4) + 'M409 46V' + (rt - 4));
    b.fine(ribs('M386 ' + rt + 'H414', 'M386 522H414', 4));
    for (var y = 120; y < 470; y += 84) b.hw(snap(400, y, 7.5));
    b.hw(snap(400, 60, 6.5) + snap(400, 497, 6.5));
    ribCollar(b, 'front');
    b.part('M386 42H414V76H386Z');
    b.fine('M390 44V74M395 44V74M400 44V74M405 44V74M410 44V74');
    b.hw(snap(400, 59, 6.5));
    return { svg: b.out(), box: bbox(-24, 522) };
  };

  /** puffer outline helpers */
  function bulge(A, B, k) {
    var mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
    return 'Q' + n1(mx + dy / L * k * 2) + ' ' + n1(my - dx / L * k * 2) + ' ' + pt(B);
  }
  function scal(pts, k) { var s = ''; for (var i = 1; i < pts.length; i++) s += bulge(pts[i - 1], pts[i], k); return s; }

  G.puffer = function (v, o) {
    var b = new Bld();
    var P = [160, 48], O = [50, 452], I = [164, 466], U = [184, 228], HY = 572;
    var BY = [146, 228, 310, 392, 474];
    var xo = function (y) { return 78 - 28 * (y - 192) / 260; };
    var xi = function (y) { return 164 + 20 * (466 - y) / 238; };
    var outer = [[78, 192], [xo(232), 232], [xo(312), 312], [xo(392), 392], O];
    var inner = [I, [xi(390), 390], [xi(310), 310], [xi(250), 250], U];
    var side = [U, [183.5, 310], [183, 392], [182.5, 474], [182, 552]];
    var cf = cuff(O, I, 4, 18), rb = cuff(cf.a2, cf.b2, 10, 24);
    var half = 'M400 14C370 14 342 10 316 0L' + pt(P) + 'C118 58 84 106 78 192' + scal(outer, -5) +
      'L' + pt(cf.a) + 'L' + pt(cf.a2) + 'L' + pt(rb.a) + 'L' + pt(rb.a2) + 'L' + pt(rb.b2) + 'L' + pt(rb.b) + 'L' + pt(cf.b2) + 'L' + pt(cf.b) + 'L' + pt(I) +
      scal(inner, -5) + scal(side, -5) + 'L182 ' + HY + 'L400 ' + HY;
    b.part(sym(half));
    var arm = 'M' + pt(P) + 'C172 110 184 160 184 228';
    b.seam(both(arm));
    // baffles: body
    var ax = function (y) { return y < 228 ? 160 + 24 * Math.pow((y - 48) / 180, 0.7) : 184; };
    var cx0 = v === 'back' ? 400 : 381, bl = '', shd = '', hil = '';
    for (var i = 0; i < BY.length; i++) {
      var y = BY[i], x0 = ax(y) + 1;
      bl += 'M' + n1(x0) + ' ' + y + 'L' + cx0 + ' ' + y;
      var yp = i ? BY[i - 1] : 60;
      shd += 'M' + n1(x0 + 2) + ' ' + (y - 1) + 'Q' + n1((x0 + cx0) / 2) + ' ' + (y - 24) + ' ' + (cx0 - 2) + ' ' + (y - 1) + 'Z';
      if (i) hil += 'M' + n1(x0 + 8) + ' ' + (yp + 3) + 'Q' + n1(x0 + 70) + ' ' + (yp + 18) + ' ' + n1(x0 + 140) + ' ' + (yp + 3) + 'Z';
    }
    shd += 'M184 551Q' + ((184 + cx0) / 2) + ' 528 ' + cx0 + ' 551Z';
    // sleeves
    var SY = [[232, 238], [312, 316], [392, 394]];
    for (i = 0; i < SY.length; i++) {
      var y0 = SY[i][0], y1 = SY[i][1];
      bl += 'M' + n1(xo(y0) + 1) + ' ' + y0 + 'L' + n1(xi(y1) - 1) + ' ' + y1;
      shd += 'M' + n1(xo(y0) + 3) + ' ' + (y0 - 1) + 'Q' + n1((xo(y0) + xi(y1)) / 2) + ' ' + (y0 - 20) + ' ' + n1(xi(y1) - 3) + ' ' + (y1 - 1) + 'Z';
    }
    shd += 'M' + pt([cf.a[0] + 3, cf.a[1] - 1]) + 'Q108 438 ' + pt([cf.b[0] - 3, cf.b[1] - 1]) + 'Z';
    b.seam(both(bl));
    b.st(both(offY(bl, 3)));
    b.sh(both(shd));
    b.hi(hil);
    b.sh('M616 236L617 552Q560 400 616 236Z' + mir('M150 70C110 90 84 140 80 200L58 446L82 448C92 360 102 200 150 70Z'));
    // cuffs + hem binding
    b.seam(both('M' + pt(cf.a) + 'L' + pt(cf.b) + 'M' + pt(cf.a2) + 'L' + pt(cf.b2)));
    b.st(both(offLine(cf.a, cf.b, -4, 2) + offLine(cf.a2, cf.b2, 4, 2)));
    b.fine(both(ribs('M' + pt(rb.a) + 'L' + pt(rb.b), 'M' + pt(rb.a2) + 'L' + pt(rb.b2), 12)));
    b.seam('M182 552H618');
    b.st('M183 557H617M183 567H617');
    if (v === 'back') {
      b.hw(label(388, 30, 24, 10));
      puffHood(b, 'back');
      return { svg: b.out(), box: bbox(-238, HY) };
    }
    // flap pockets
    flap(b, 218, 404, 114, 34, { btn: 'snap' });
    flap(b, 468, 404, 114, 34, { btn: 'snap' });
    // storm flap over two-way zip
    b.part('M381 84H419V546Q419 552 413 552H387Q381 552 381 546Z');
    b.sh('M413 84H419V546Q419 552 413 552H409V84Z');
    b.st('M386 88V546M414 88V546');
    for (i = 0; i < BY.length; i++) b.hw(snap(400, BY[i] + 40, 7));
    b.hw(zip(400, 552, 572) + zipPull(400, 554));
    puffHood(b, 'front');
    b.hw(zip(400, 30, 84) + zipPull(400, 34));
    return { svg: b.out(), box: bbox(-238, 594) };
  };
  function puffHood(b, v) {
    var outer = 'M400 -238C316 -238 256 -188 248 -108C243 -54 252 -12 282 16';
    var neck = v === 'back' ? 'C320 22 364 26 400 26' : 'C292 52 344 82 400 84';
    b.part(sym(outer + neck), '{f}', both(outer));
    var arc = 'M400 -218C328 -218 280 -170 274 -98C270 -48 280 -8 314 20';
    if (v === 'back') {
      b.seam(both(arc) + 'M400 -238V26');
      b.st(both(offY(arc, 3)) + 'M405 -236V24');
      b.sh(both('M400 -219C330 -219 283 -172 277 -100C276 -80 277 -60 280 -44C292 -140 340 -196 400 -196Z') + mir(outer + 'L300 18C276 -16 270 -60 274 -100C282 -170 330 -216 400 -218Z'));
      b.hi('M316 -196C292 -170 280 -140 276 -110L286 -108C292 -140 306 -166 326 -186Z');
      return;
    }
    b.seam(both(arc));
    b.st(both(offY(arc, 3)));
    b.sh(mir(outer + 'L300 18C276 -16 270 -60 274 -100C282 -170 330 -216 400 -218Z'));
    b.hi('M316 -196C292 -170 280 -140 276 -110L286 -108C292 -140 306 -166 326 -186Z');
    // brim + opening
    var openHalf = 'M400 -196C342 -196 306 -150 302 -86C299 -38 316 12 400 30';
    b.part(sym(openHalf), '{i}');
    b.sh('M400 -196C342 -196 306 -150 302 -86C302 -70 304 -56 307 -44C314 -112 350 -166 400 -166C450 -166 486 -112 493 -44C496 -56 498 -70 498 -86C494 -150 458 -196 400 -196Z');
    b.st(both('M400 -207C334 -207 293 -156 290 -88C287 -34 306 18 372 36'));
    b.seam('M400 -166C401 -100 401 -30 400 14M332 4Q366 16 400 18Q434 16 468 4');
    // chin guard / collar
    b.seam(both('M282 16C292 52 344 82 400 84'));
    b.seam('M393 30V84M407 30V84');
  }

  G.coat = function (v, o) {
    var g = torso({ nw: 76, nb: 12, P: [164, 46], O: [60, 486], I: [172, 498], U: [190, 228], hx: 172, len: 772, hem: 'straight' });
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g, { hemSt: [24], noCuffSt: true });
    b.st(both(offLine(g.O, g.I, 30, 2)));
    if (v === 'back') {
      // collar from behind
      var band = 'M400 -24C356 -24 328 -20 314 -11C301 -2 292 8 288 18C320 30 362 34 400 34';
      b.sh(offXY(sym(band), 1, 8));
      b.part(sym(band), '{f}', both(band));
      b.st(both('M294 15C324 26 362 29 400 29'));
      b.sh(mir('M316 -12C302 -2 292 8 288 18C300 26 312 4 322 -8Z'));
      b.seam('M400 34V560');
      b.lvl();
      b.fill('M400 560L414 572V772H400Z');
      b.sh('M400 560L414 572V772H408V574Z');
      b.seam('M400 560L414 572V772M400 560V772');
      b.st('M406 580V766M394 562L414 580');
      b.fold('M300 320Q314 460 300 640M502 300Q488 460 500 660');
      return { svg: b.out(), box: bbox(-28, 774) };
    }
    // lining visible in the V between the lapels
    b.lvl();
    b.fill(sym('M400 -28C368 -28 336 -24 318 -14C326 40 372 180 400 262'), '{i}');
    b.seam('M334 18Q370 30 400 30Q430 30 466 18');
    b.hw(label(388, 34, 24, 11));
    var lapel = function (brk) {
      return 'M300 94L274 106C286 170 348 232 ' + pt(brk) + 'C372 200 342 124 334 84Z';
    };
    var collar = 'M300 94L286 80C282 50 286 18 298 0C304 -8 310 -12 318 -14C322 16 328 50 334 84Z';
    // left (under) side
    b.sh(offXY(lapel([398, 264]), 3, 6));
    b.part(lapel([398, 264]));
    b.st('M282 110C294 168 350 226 392 258');
    b.part(collar);
    b.st('M292 80C288 52 291 22 302 6');
    // front edge of the overlapping panel
    frontEdge(b, 268, 771, 386);
    for (var y = 322; y < 620; y += 112) b.hw(button(400, y, 10));
    // right (over) side
    var lr = 'M500 94L526 106C514 170 452 234 386 272C428 200 458 124 466 84Z';
    b.sh(offXY(lr, 3, 6));
    b.part(lr);
    b.sh(lr);
    b.st('M518 110C506 168 450 230 394 264');
    b.part(mir(collar));
    b.sh(mir(collar));
    b.st(mir('M292 80C288 52 291 22 302 6'));
    patchPocket(b, 208, 456, 126, 128, { r: 10, hem: 26 });
    patchPocket(b, 466, 456, 126, 128, { r: 10, hem: 26 });
    // chest welt
    b.lvl();
    b.fill('M474 214L546 206L547 220L475 228Z');
    b.seam('M474 214L546 206L547 220L475 228Z');
    b.fold('M300 620Q312 700 304 770M500 620Q490 700 496 770');
    return { svg: b.out(), box: bbox(-28, 774) };
  };

  G.knit = function (v, o) {
    var g = knit('sweat', 86, 12, { cuff: { inset: 8, depth: 62 }, rib: 64, P: [174, 38] });
    var b = new Bld();
    b.part(g.sil);
    var sad = v === 'back' ? 'M312 8L182 64' : 'M312 18L182 66';
    var armS = 'M182 66C190 120 196 150 200 212';
    g.arm = armS;
    topDetails(b, g, { noArm: true, noFold: true });
    b.seam(both(sad + armS.replace(/^M182 66/, '')));
    // chunky 2x2 rib on body, sleeves and saddle
    var rt = g.ribTop;
    var body = (v === 'back' ? 'M400 14C362 14 330 10 312 8' : 'M400 34C362 34 318 22 312 18') + 'L182 66C190 120 196 150 200 212C199 302 203 372 203 ' + (rt - 6) + 'L210 ' + rt + 'L400 ' + rt + 'Z';
    var rib = hatch(body, 90, 14, 4, 2) + hatch(body, 90, 14, 8, 2);
    var sp = 'M182 66L174 38' + g.outer + 'L' + pt(g.cf.a) + 'L' + pt(g.cf.b) + 'L' + pt(g.I) + g.under.replace(/^M[^Q]+/, '') + 'C196 150 190 120 182 66Z';
    var srib = hatch(sp, 93, 14, 4, 2) + hatch(sp, 93, 14, 8, 2);
    var sd = 'M318 0L174 38L182 66L312 18Z';
    var drib = hatch(sd, -14.5, 9, 4, 1);
    b.fine(both(rib + srib + drib));
    b.fold(both('M' + pt(lerp(g.O, g.I, 0.3)) + 'l3 -14M' + pt(lerp(g.O, g.I, 0.62)) + 'l-2 -16'));
    // mock neck
    if (v === 'back') {
      var bt = 'M400 -50C366 -50 334 -48 320 -40';
      var bn = sym(bt + 'L308 2C330 12 366 16 400 16');
      b.part(bn, '{f}', both(bt + 'L308 2'));
      b.seam(both('M308 2C330 12 366 16 400 16'));
      b.fine(both(ribs(bt, 'M400 16C366 16 330 12 308 2', 12)));
      b.st(both('M400 -44C366 -44 336 -42 322 -34'));
      return { svg: b.out(), box: bbox(-50, 520) };
    }
    b.lvl();
    b.fill(sym('M400 -50C366 -50 334 -48 320 -40C330 -16 368 -10 400 -10'), '{i}');
    var ft = 'M320 -40C330 -16 368 -10 400 -10', fb = 'M308 2C316 22 360 34 400 34';
    b.part(sym('M400 -10C368 -10 330 -16 320 -40L308 2C316 22 360 34 400 34'), '{f}', both('M400 -50C366 -50 334 -48 320 -40L308 2') + both(ft));
    b.sh(mir('M320 -40L308 2C316 22 360 34 400 34L400 26C362 26 326 16 320 -6Z'));
    b.seam(both(fb));
    b.fine(both(ribs(ft, fb, 12)));
    return { svg: b.out(), box: bbox(-50, 520) };
  };

  G.cardigan = function (v, o) {
    var g = knit('sweat', 86, 14, { rib: 46 });
    var b = new Bld();
    b.part(g.sil);
    topDetails(b, g);
    if (v === 'back') {
      var outer = 'M400 14C369 14 335 10 314 0', inner = 'M400 36C368 36 330 30 296 6';
      b.part(sym(outer + 'L296 6C330 30 368 36 400 36'), '{f}', false);
      b.seam(both(inner));
      b.fine(both(ribs(outer, inner, 10)));
      return { svg: b.out(), box: bbox(0, 520) };
    }
    b.lvl();
    b.fill(sym(g.top + 'C330 70 380 190 400 236'), '{i}');
    b.seam(both('M320 12C350 30 376 36 400 36'));
    b.fine(both(ribs('M400 14C369 14 335 10 316 1', 'M400 36C376 36 350 30 320 12', 9)));
    b.hw(label(388, 40, 24, 10));
    var lInner = 'M314 0C330 70 380 190 400 236', lOuter = 'M292 6C312 90 372 220 388 266';
    b.part('M314 0C330 70 380 190 400 236L412 262L388 266C372 220 312 90 292 6Z', '{f}', 'M314 0C330 70 380 190 400 236M292 6L314 0');
    b.fine(ribs(lInner, lOuter, 24));
    b.seam(lOuter);
    var rI = 'M486 0C470 70 420 190 400 236', rO = 'M508 6C488 90 428 220 412 268';
    b.part('M486 0C470 70 420 190 400 236L388 262V520H412V268C428 220 488 90 508 6Z', '{f}', 'M486 0C470 70 420 190 400 236L388 262V520M508 6L486 0');
    b.sh('M486 0C470 70 420 190 400 236L388 262V270L398 252C426 190 474 70 492 2Z');
    b.fine(ribs(rI, rO, 24));
    var t = '';
    for (var y = 272; y < 520; y += 6) t += 'M389 ' + y + 'H411';
    b.fine(t);
    b.seam(rO + 'V520');
    for (y = 272; y <= 472; y += 50) b.hw(horn(400, y, 8.5));
    // patch pockets with rib tops
    var pk = function (x) {
      var d = 'M' + x + ' 330H' + (x + 94) + 'V424H' + x + 'Z';
      b.sh(offXY(d, 2, 3));
      b.lvl();
      b.fill(d);
      b.seam(d + 'M' + x + ' 348H' + (x + 94));
      b.fine(ribs('M' + x + ' 330H' + (x + 94), 'M' + x + ' 348H' + (x + 94), 15));
      b.st('M' + (x + 4) + ' 350V420H' + (x + 90) + 'V350');
    };
    pk(230); pk(476);
    return { svg: b.out(), box: bbox(0, 520) };
  };

  /* ================================================================ bottoms */
  // Waist ≈300 wide (x 250–550), waist top at y = 0.

  function beltLoop(b, x, acc) {
    b.lvl();
    var d = 'M' + (x - 6) + ' -3H' + (x + 6) + 'V42H' + (x - 6) + 'Z';
    b.sh(offXY(d, 2, 2));
    b.fill(d);
    b.seam(d);
    var t = 'M' + (x - 4) + ' 3H' + (x + 4) + 'M' + (x - 4) + ' 37H' + (x + 4);
    if (acc) b.sa(t); else b.st(t);
  }
  /** shading common to two-leg bottoms: right outer leg, inner legs, left highlight */
  function legShade(b, outerTop, outerBot, innerTop, innerBot) {
    b.sh(mir('M' + pt(outerTop) + 'C' + (outerTop[0] - 4) + ' ' + (outerTop[1] + 160) + ' ' + (outerBot[0] + 4) + ' ' + (outerBot[1] - 200) + ' ' + pt(outerBot) +
      'L' + (outerBot[0] + 36) + ' ' + (outerBot[1] + 1) + 'C' + (outerBot[0] + 40) + ' ' + (outerBot[1] - 200) + ' ' + (outerTop[0] + 30) + ' ' + (outerTop[1] + 160) + ' ' + pt([outerTop[0] + 24, outerTop[1] + 10]) + 'Z'));
    b.sh(both('M' + pt(innerTop) + 'C' + (innerTop[0] - 3) + ' ' + (innerTop[1] + 120) + ' ' + (innerBot[0] + 2) + ' ' + (innerBot[1] - 220) + ' ' + pt(innerBot) +
      'L' + (innerBot[0] - 22) + ' ' + innerBot[1] + 'C' + (innerBot[0] - 14) + ' ' + (innerBot[1] - 220) + ' ' + (innerTop[0] - 8) + ' ' + (innerTop[1] + 120) + ' ' + pt(innerTop) + 'Z'));
    b.hi('M' + (outerTop[0] + 22) + ' ' + (outerTop[1] + 30) + 'C' + (outerTop[0] + 16) + ' ' + (outerTop[1] + 200) + ' ' + (outerBot[0] + 14) + ' ' + (outerBot[1] - 220) + ' ' + (outerBot[0] + 10) + ' ' + (outerBot[1] - 30) +
      'L' + (outerBot[0] + 24) + ' ' + (outerBot[1] - 30) + 'C' + (outerBot[0] + 28) + ' ' + (outerBot[1] - 220) + ' ' + (outerTop[0] + 32) + ' ' + (outerTop[1] + 200) + ' ' + (outerTop[0] + 34) + ' ' + (outerTop[1] + 30) + 'Z');
  }
  function sideAdjuster(b) {
    b.lvl();
    var t = 'M253 8H292L302 17L292 26H253Z';
    b.sh(both(offXY(t, 1.5, 2.5)));
    b.fill(both(t));
    b.seam(both(t));
    b.st(both('M256 12H290L296 17L290 22H256'));
    b.hw(both('M261 5H273V29H261Z').replace(/^/, '<path d="').concat('" fill="{mt}" stroke="{mtl}" stroke-width="1.1"/>') +
      '<path d="' + both('M264 9H270V25H264Z') + '" fill="{f}" stroke="{mtl}" stroke-width=".8"/>');
  }

  G.trousers = function (v) {
    var half = 'M400 0L250 0C246 60 226 140 222 200C216 330 200 600 190 770Q290 776 386 772C390 560 396 330 400 262';
    var b = new Bld();
    b.part(sym(half));
    legShade(b, [222, 200], [190, 770], [398, 290], [386, 772]);
    b.seam('M248 34H552');
    b.st('M249 5H551M248 29H552');
    // crease lines with a light edge and a shaded edge
    var cl = 'M336 70C332 300 304 560 290 772', cr = 'M464 70C468 300 496 560 510 772';
    b.sh('M337 90C333 300 306 560 292 770L301 771C311 560 337 300 337 90Z' + 'M465 90C469 300 497 560 511 770L520 771C508 560 474 300 465 90Z');
    b.fine(cl + cr);
    b.fine('M192 738Q290 744 384 740M416 740Q510 744 608 738');
    b.fold('M250 690Q258 730 252 768M548 690Q542 730 548 768M360 690Q366 728 362 770M440 690Q434 728 438 770');
    if (v === 'back') {
      b.seam('M400 0V34M400 34C402 120 402 200 400 262');
      b.st('M406 36C408 120 408 196 406 250');
      b.seam(both('M304 34L306 92'));
      b.lvl();
      var w = 'M282 100H352V112H282Z';
      b.fill(both(w), '{i}');
      b.seam(both(w + 'M282 106H352'));
      b.hw(button(317, 124, 5.5) + button(483, 124, 5.5));
      return { svg: b.out(), box: bbox(0, 776) };
    }
    b.seam(both('M336 34V72M306 34V60'));
    b.fold(both('M336 72Q334 110 330 150M306 60Q306 90 302 120'));
    b.seam(both('M284 34Q252 96 228 164'));
    b.st(both('M291 34Q259 98 235 166'));
    b.hw('<path d="' + both('M226 160l9 6') + '" stroke="{l}" stroke-width="2.4" opacity=".6"/>');
    b.seam('M400 34V236');
    b.st('M428 34V200Q428 228 402 240');
    b.line('M382 0V34');
    b.hw(button(392, 17, 5.5));
    sideAdjuster(b);
    return { svg: b.out(), box: bbox(0, 776) };
  };

  G.jeans = function (v) {
    var half = 'M400 0L250 0C246 50 232 120 230 180C226 320 218 560 214 756Q296 760 380 758C384 560 394 330 400 250';
    var b = new Bld();
    b.part(sym(half));
    legShade(b, [230, 180], [214, 756], [398, 280], [380, 758]);
    b.seam('M248 36H552');
    b.sa('M249 6H551M248 31H552');
    b.sa('M216 732Q296 736 380 734M420 734Q504 736 584 732M216 738Q296 742 380 740M420 740Q504 742 584 738');
    b.fold('M300 610Q314 650 306 700M500 610Q486 650 494 700M268 300Q290 312 300 340M532 300Q510 312 500 340');
    if (v === 'back') {
      // yoke, centre seam, back pockets, patch
      b.seam('M235 98L400 130L565 98');
      b.sa('M235 104L400 136L565 104M235 109L400 141L565 109');
      b.seam('M400 36V130M400 130C402 180 402 220 400 250');
      b.sa('M405 140C407 186 407 222 405 244M410 140C412 186 412 220 410 238');
      var pk = 'M270 150H362L358 252L316 270L274 252Z';
      b.sh(both(offXY(pk, 2, 3)));
      b.lvl();
      b.fill(both(pk));
      b.seam(both(pk));
      b.sa(both('M275 156H357M275 161H357M275 167L278 249L316 264L354 249L357 167M281 172L283 245L316 258L349 245L351 172'));
      b.lvl();
      b.fill('M446 7H506V31H446Z', '{a}');
      b.seam('M446 7H506V31H446Z');
      b.st('M450 11H502V27H450Z');
      for (var i = 0; i < 5; i++) beltLoop(b, [262, 336, 400, 464, 538][i], true);
      // hammer loop on the left leg (seen from the back)
      b.lvl();
      var hl = 'M232 152H252L250 292H230Z';
      b.sh(offXY(hl, 3, 4));
      b.part(hl);
      b.sa('M235 158V286M247 158V286');
      return { svg: b.out(), box: bbox(-3, 760) };
    }
    // scoop pockets + coin pocket + rivets
    b.seam(both('M300 36C296 96 262 128 233 130'));
    b.sa(both('M307 36C303 104 266 136 233 138M312 36C308 110 268 142 232 144'));
    b.lvl();
    b.fill('M254 36H290V80H254Z');
    b.seam('M254 36V80H290V36');
    b.sa('M254 44H290M258 36V76H286V36');
    b.hw(rivet(300, 42) + rivet(500, 42) + rivet(235, 129) + rivet(565, 129) + rivet(256, 41) + rivet(288, 41));
    // fly
    b.seam('M400 36V214');
    b.sa('M428 36V176Q428 204 402 216M434 36V178Q434 210 404 222');
    b.line('M382 0V36');
    b.hw('<circle cx="394" cy="18" r="8.5" fill="{mt}" stroke="{mtl}" stroke-width="1.2"/><circle cx="394" cy="18" r="4.2" fill="none" stroke="{mtl}" stroke-width=".9"/>');
    // utility (rule) pocket, right leg of the wearer
    var up = 'M238 214H296V392H236Z';
    b.sh(offXY(up, 2, 3));
    b.lvl();
    b.fill(up);
    b.seam(up + 'M262 214V300');
    b.sa('M242 222H292M242 228H292M242 220V386H291V220');
    // hammer loop, left leg of the wearer
    b.lvl();
    var hl = 'M546 150H566L570 292H550Z';
    b.sh(offXY(hl, -3, 4));
    b.part(hl);
    b.sh('M560 150H566L570 292H564Z');
    b.sa('M549 156L553 286M563 156L567 286');
    for (i = 0; i < 4; i++) beltLoop(b, [262, 336, 464, 538][i], true);
    return { svg: b.out(), box: bbox(-3, 760) };
  };

  G.sweatpants = function (v) {
    var half = 'M400 0L252 0L248 54C238 120 226 190 224 250C222 400 230 560 238 690Q246 694 248 698L250 750L372 752L372 698Q378 692 384 688C388 560 394 360 400 272';
    var b = new Bld();
    b.part(sym(half));
    legShade(b, [224, 250], [238, 690], [398, 300], [384, 688]);
    b.seam('M248 54H552');
    b.st('M251 18H549M250 37H550');
    b.fold('M268 4Q272 28 266 52M300 4Q296 28 302 52M334 4Q338 28 332 52M366 4Q362 26 368 52M434 4Q438 28 432 52M466 4Q462 28 468 52M500 4Q504 28 498 52M532 4Q528 28 534 52');
    b.seam(both('M248 698L372 698'));
    b.fine(both(ribs('M248 698L372 698', 'M250 750L372 752', 18)));
    b.fold(both('M262 690l2 -16M300 690l-1 -14M342 690l1 -16M240 420Q268 432 300 428M236 470Q262 480 288 476'));
    if (v === 'back') {
      b.seam('M400 54C402 140 402 210 400 272');
      b.st('M406 58C408 140 408 206 406 262');
      patchPocket(b, 450, 100, 86, 98, { r: 6, hem: 16 });
      return { svg: b.out(), box: bbox(0, 752) };
    }
    b.seam('M400 54C402 140 402 210 400 272');
    b.seam(both('M258 62Q244 120 236 190'));
    b.st(both('M265 62Q251 122 243 192'));
    b.hw('<path d="' + both('M234 186l9 4') + '" stroke="{l}" stroke-width="2.4" opacity=".6"/>');
    // drawcord through eyelets
    var cord = function (d, ex, ey) {
      return '<path d="' + d + '" fill="none" stroke="{l}" stroke-width="6.2" opacity=".9"/><path d="' + d + '" fill="none" stroke="{f}" stroke-width="3.6"/>' +
        '<rect x="' + (ex - 3.6) + '" y="' + ey + '" width="7.2" height="15" rx="1.6" fill="{mt}" stroke="{mtl}" stroke-width="1"/>';
    };
    b.hw(cord('M386 30C380 74 388 112 378 160', 374.6, 158) + cord('M414 30C422 78 412 120 424 172', 420.8, 170) +
      '<circle cx="386" cy="30" r="5" fill="{mt}" stroke="{mtl}" stroke-width="1"/><circle cx="414" cy="30" r="5" fill="{mt}" stroke="{mtl}" stroke-width="1"/>');
    b.hw(label(436, 22, 22, 10));
    return { svg: b.out(), box: bbox(0, 752) };
  };

  G.cargo = function (v) {
    var half = 'M400 0L252 0C248 50 232 130 228 190C224 340 220 560 216 742Q213 756 222 770L378 770Q387 756 384 742C388 560 394 330 400 256';
    var b = new Bld();
    b.part(sym(half));
    legShade(b, [228, 190], [216, 742], [398, 286], [384, 742]);
    b.seam('M249 36H551');
    b.st('M250 6H550M249 31H551');
    // drawcord hem channel
    b.seam(both('M216 742H384'));
    b.st(both('M217 736H383'));
    b.fold(both('M240 744l-1 22M276 744l1 24M318 744l-1 24M356 744l1 22'));
    var cargoPocket = function (back) {
      var x1 = back ? 290 : 312;
      var d = 'M223 360H' + x1 + 'V492H221Z';
      b.sh(offXY(d, 3, 4));
      b.lvl();
      b.fill(d);
      b.fill('M' + x1 + ' 360H' + (x1 + 8) + 'V500H221V492H' + x1 + 'Z', '{r}');
      b.seam(d + 'M' + x1 + ' 360H' + (x1 + 8) + 'V500H221');
      b.sh('M' + x1 + ' 360H' + (x1 + 8) + 'V500H221V492H' + x1 + 'Z');
      b.st('M227 384V486H' + (x1 - 5) + 'V384');
      flap(b, 221, 346, x1 - 219, 40, { btn: 'snap' });
    };
    if (v === 'back') {
      b.seam('M400 0V36M400 36C402 120 402 200 400 256');
      b.st('M406 38C408 120 408 196 406 246');
      patchPocket(b, 280, 120, 84, 96, { r: 6, hem: 0 });
      patchPocket(b, 436, 120, 84, 96, { r: 6, hem: 0 });
      flap(b, 280, 108, 84, 34, { btn: 'snap' });
      flap(b, 436, 108, 84, 34, { btn: 'snap' });
      cargoPocket(true);
      b.L.push({ f: '', sh: '', hi: '', fo: '', fi: '', se: '', st: '', sa: '', ln: '', hw: '' });
      var tmp = new Bld(); var save = b; b = tmp; cargoPocket(true); var m = tmp.out(); b = save;
      b.hw('<g transform="matrix(-1 0 0 1 800 0)">' + m + '</g>');
      for (var i = 0; i < 5; i++) beltLoop(b, [262, 336, 400, 464, 538][i]);
      return { svg: b.out(), box: bbox(-3, 770) };
    }
    b.seam(both('M286 36Q256 100 230 168'));
    b.st(both('M293 36Q263 102 238 170'));
    b.seam('M400 36V226');
    b.st('M428 36V192Q428 220 402 230');
    b.line('M382 0V36');
    b.hw(button(393, 18, 6));
    // knee darts
    b.seam(both('M222 552Q250 556 284 568M222 596Q248 600 280 610'));
    b.fold(both('M226 560Q252 566 280 578M226 604Q250 610 276 618'));
    cargoPocket(false);
    var tmp2 = new Bld(), save2 = b; b = tmp2; cargoPocket(false); var m2 = tmp2.out(); b = save2;
    b.hw('<g transform="matrix(-1 0 0 1 800 0)">' + m2 + '</g>');
    // cord ends at the hems
    var ce = function (x) {
      return '<path d="M' + x + ' 756C' + (x - 6) + ' 772 ' + (x - 2) + ' 784 ' + (x - 8) + ' 796" fill="none" stroke="{l}" stroke-width="3.2" opacity=".85"/>' +
        '<rect x="' + (x - 12) + '" y="772" width="11" height="14" rx="3" fill="{mt}" stroke="{mtl}" stroke-width="1"/>';
    };
    b.hw(ce(232) + ce(584));
    for (i = 0; i < 4; i++) beltLoop(b, [262, 336, 464, 538][i]);
    return { svg: b.out(), box: bbox(-3, 796) };
  };

  G.shorts = function (v) {
    var half = 'M400 0L232 0L228 50C220 100 206 160 202 230C198 300 190 380 186 430Q290 438 392 432C394 400 398 360 400 336';
    var b = new Bld();
    b.part(sym(half));
    legShade(b, [204, 220], [186, 430], [399, 350], [392, 432]);
    b.seam('M228 50H572');
    b.st('M231 16H569M230 34H570');
    b.fold('M250 4Q254 26 248 48M286 4Q282 26 288 48M322 4Q326 26 320 48M360 4Q356 26 362 48M440 4Q444 26 438 48M478 4Q474 26 480 48M514 4Q518 26 512 48M550 4Q546 26 552 48');
    b.st(both('M189 408Q290 416 392 410M189 402Q290 410 393 404'));
    b.fold(both('M260 380Q266 404 262 430M340 384Q344 410 340 432'));
    if (v === 'back') {
      b.seam('M400 50C402 160 402 260 400 336');
      b.st('M406 54C408 160 408 254 406 326');
      patchPocket(b, 452, 98, 88, 96, { r: 6, hem: 16 });
      return { svg: b.out(), box: bbox(0, 436) };
    }
    b.seam('M400 50C402 160 402 260 400 336');
    b.seam(both('M330 50V68'));
    b.fold(both('M330 68Q328 110 322 160M300 50Q300 80 296 104'));
    b.seam(both('M244 56Q226 120 212 186'));
    b.st(both('M251 56Q233 122 219 188'));
    var cord = function (d, ex, ey) {
      return '<path d="' + d + '" fill="none" stroke="{l}" stroke-width="6.2" opacity=".9"/><path d="' + d + '" fill="none" stroke="{f}" stroke-width="3.6"/>' +
        '<rect x="' + (ex - 3.6) + '" y="' + ey + '" width="7.2" height="15" rx="1.6" fill="{mt}" stroke="{mtl}" stroke-width="1"/>';
    };
    b.hw(cord('M386 28C380 70 388 104 378 146', 374.6, 144) + cord('M414 28C422 74 412 112 424 158', 420.8, 156) +
      '<circle cx="386" cy="28" r="5" fill="{mt}" stroke="{mtl}" stroke-width="1"/><circle cx="414" cy="28" r="5" fill="{mt}" stroke="{mtl}" stroke-width="1"/>');
    return { svg: b.out(), box: bbox(0, 436) };
  };

  /* ================================================================ accessories */

  G.cap = function (v) {
    var b = new Bld(1 / 1.2);
    if (v === 'back') {
      // side profile, brim to the right
      var crown = 'M200 640C192 548 250 404 410 398C548 394 604 474 608 584L610 640Q400 656 200 630Z';
      b.part('M602 634C664 626 734 640 780 676L776 686C728 658 666 652 606 658Z');
      b.st('M614 640C670 634 728 646 768 674M616 648C670 642 724 652 760 678');
      b.sh('M606 651C666 645 728 652 776 686C728 658 666 652 606 658Z');
      b.part(crown);
      b.sh('M201 636C197 598 206 560 222 522C230 562 236 600 248 634Z' + 'M559 448C591 481.5 606 529 608 584L610 640Q584 643 556 644C572 580 576 500 559 448Z');
      b.hi('M330 424C380 406 440 404 482 414C430 424 380 436 340 456Z');
      var s1 = 'M410 398C362 410 314 520 304 646', s2 = 'M410 398C468 410 504 520 500 650';
      b.seam(s1 + s2);
      b.st(offXY(s1, -6, 0) + offXY(s1, 6, 0) + offXY(s2, -6, 0) + offXY(s2, 6, 0));
      b.st('M204 624Q400 650 606 632');
      b.hw('<circle cx="404" cy="464" r="7" fill="{i}" stroke="{l}" stroke-width="1.2" opacity=".9"/>');
      b.part('M398 398Q398 384 410 384Q422 384 422 398Z');
      return { svg: b.out(), box: bbox(384, 686), dx: -88, scale: 1.2 };
    }
    var top = 'M400 304C306 304 200 350 176 466C166 516 162 590 162 642';
    var base = 'C236 662 322 670 400 670';
    b.part(sym('M400 670C322 670 236 662 162 642L148 652C196 712 300 744 400 744'), '{f}', both('M162 642L148 652C196 712 300 744 400 744'));
    b.sh(sym('M400 670C322 670 236 662 162 642L152 654C232 676 320 684 400 684') + mir('M148 652C196 712 300 744 400 744L400 730C318 728 236 704 178 664Z'));
    // brim stitch rows: interpolate between base seam and brim edge
    var B0 = [[162, 642], [236, 662], [322, 670], [400, 670]], E0 = [[148, 652], [196, 712], [300, 744], [400, 744]], rows = '';
    [0.32, 0.46, 0.6, 0.74, 0.88].forEach(function (t) {
      var p = B0.map(function (q, i) { return lerp(q, E0[i], t); });
      rows += 'M' + pt(p[0]) + 'C' + pt(p[1]) + ' ' + pt(p[2]) + ' ' + pt(p[3]);
    });
    b.st(both(rows));
    b.part(sym(top + base));
    b.sh(mir('M400 304C306 304 200 350 176 466C166 516 162 590 162 642L214 656C206 560 222 440 282 362C312 330 350 312 400 308Z'));
    b.hi('M300 344C252 372 220 414 204 462L220 466C236 424 264 388 310 356Z');
    var ss = 'M400 306C334 320 272 420 262 660';
    b.seam('M400 306V670' + both(ss));
    b.st('M394 316V664M406 316V664' + both(offXY(ss, -6, 2)) + both(offXY(ss, 6, -2)));
    b.hw('<path d="' + circ(334, 404, 8) + circ(466, 404, 8) + '" fill="{i}" stroke="{l}" stroke-width="1.2" opacity=".9"/>');
    b.part('M386 308Q386 292 400 292Q414 292 414 308Z');
    // embroidered monogram
    b.hw(monoMark(400, 522, 46, '{m}', 5.2));
    return { svg: b.out(), box: bbox(292, 744), scale: 1.2 };
  };

  G.beanie = function (v) {
    var b = new Bld(1 / 1.1);
    var dome = 'M400 216C290 216 214 306 210 450L210 560L400 560';
    b.part(sym(dome));
    b.sh(mir('M400 216C290 216 214 306 210 450L210 560L262 560C258 440 286 300 400 230Z'));
    b.hi('M300 270C262 300 236 350 228 400L242 404C252 356 274 314 310 280Z');
    // knit ribs following the crown
    var r = '', ry = function (x) { var u = (x - 400) / 190; return 560 - 344 * Math.sqrt(Math.max(0, 1 - u * u)); };
    for (var x = 220; x <= 580; x += 13) {
      var xe = 400 + (x - 400) * 0.36, ye = ry(xe) + 30;
      r += 'M' + n1(x) + ' 556Q' + n1(x + (x - 400) * 0.05) + ' ' + n1((556 + ye) / 2) + ' ' + n1(xe) + ' ' + n1(ye);
    }
    b.fine(r);
    if (v === 'back') b.seam('M400 232V560');
    // folded cuff
    var cuffTop = 'M400 548C320 548 260 546 204 542', cuffBot = 'M400 716C330 716 270 712 212 704';
    b.part(sym(cuffTop + 'C202 600 204 660 212 704C270 712 330 716 400 716'));
    b.sh(mir('M204 542C202 600 204 660 212 704C230 706 250 708 262 709C256 650 254 590 256 545Z'));
    b.hi('M206 548C260 552 330 554 400 554C470 554 540 552 594 548L594 556C540 560 470 562 400 562C330 562 260 560 206 556Z');
    b.fine(both(ribs(cuffTop, cuffBot, 15)));
    if (v === 'back') {
      b.seam('M400 548V716');
      return { svg: b.out(), box: bbox(216, 716), scale: 1.1 };
    }
    b.lvl();
    b.sh('M376 606H430V636H376Z');
    b.hw('<rect x="373" y="602" width="54" height="30" fill="{a}" stroke="{l}" stroke-width="1" opacity=".96"/>' +
      '<path d="M377 606h46v22h-46Z" fill="none" stroke="{f}" stroke-width=".8" stroke-dasharray="2 1.6" opacity=".6"/>' + monoMark(400, 617, 8.5, '{f}', 1.3));
    return { svg: b.out(), box: bbox(216, 716), scale: 1.1 };
  };

  G.tote = function (v) {
    var b = new Bld();
    var handle = function (x0, x1, top, w, dx, dy) {
      var cx = (x0 + x1) / 2, o = 'M' + (x0 + dx) + ' ' + (440 + dy) + 'C' + (x0 + dx) + ' ' + (top + 90 + dy) + ' ' + (cx - 70 + dx) + ' ' + (top + dy) + ' ' + (cx + dx) + ' ' + (top + dy) +
        'C' + (cx + 70 + dx) + ' ' + (top + dy) + ' ' + (x1 + dx) + ' ' + (top + 90 + dy) + ' ' + (x1 + dx) + ' ' + (440 + dy);
      var i = 'L' + (x1 - w + dx) + ' ' + (440 + dy) + 'C' + (x1 - w + dx) + ' ' + (top + w + 96 + dy) + ' ' + (cx + 62 + dx) + ' ' + (top + w + dy) + ' ' + (cx + dx) + ' ' + (top + w + dy) +
        'C' + (cx - 62 + dx) + ' ' + (top + w + dy) + ' ' + (x0 + w + dx) + ' ' + (top + w + 96 + dy) + ' ' + (x0 + w + dx) + ' ' + (440 + dy) + 'Z';
      return o + i;
    };
    var hst = function (x0, x1, top, w, dx, dy) {
      var cx = (x0 + x1) / 2, k = w / 2;
      return 'M' + (x0 + k + dx) + ' ' + (430 + dy) + 'C' + (x0 + k + dx) + ' ' + (top + 92 + k + dy) + ' ' + (cx - 66 + dx) + ' ' + (top + k + dy) + ' ' + (cx + dx) + ' ' + (top + k + dy) +
        'C' + (cx + 66 + dx) + ' ' + (top + k + dy) + ' ' + (x1 - k + dx) + ' ' + (top + 92 + k + dy) + ' ' + (x1 - k + dx) + ' ' + (430 + dy);
    };
    var tab = function (x, y) {
      return '<path d="M' + (x - 19) + ' ' + y + 'h38v50l-19 10l-19 -10Z" fill="{a}" stroke="{l}" stroke-width="1.2" opacity=".97"/>' +
        '<path d="M' + (x - 14) + ' ' + (y + 5) + 'h28v42l-14 7l-14 -7Z" fill="none" stroke="{f}" stroke-width=".9" stroke-dasharray="3 2.4" opacity=".55"/>' +
        rivet(x, y + 16, 3.6).replace('{a}', '{mt}').replace('{ad}', '{mtl}') + rivet(x, y + 38, 3.6).replace('{a}', '{mt}').replace('{ad}', '{mtl}');
    };
    if (v === 'back') {
      // three-quarter view with the side gusset
      b.lvl();
      b.hw('<path d="' + handle(328, 532, 196, 20, 48, -26) + '" fill="{ad}" stroke="{l}" stroke-width="1.6"/>');
      var face = 'M196 372L540 360L552 832L184 842Z', gus = 'M540 360L622 338L632 806L552 832Z';
      b.part(gus);
      b.sh(gus + gus);
      b.seam('M581 349L586 440L592 819M581 349L574 380');
      b.fold('M586 440L566 470M586 440L604 466');
      b.part(face);
      b.sh('M500 362L540 360L552 832L510 834C516 640 512 480 500 362Z');
      b.hi('M220 390L250 389L244 820L214 822Z');
      b.seam('M196 416L542 404M186 790L550 780');
      b.st('M197 378L540 366M196 410L542 398M187 796L550 786M187 834L551 825');
      b.lvl();
      b.hw('<path d="' + handle(258, 470, 214, 20, 0, 0) + '" fill="{a}" stroke="{l}" stroke-width="1.6"/>');
      b.hw('<path d="' + hst(258, 470, 214, 20, 0, 0) + '" fill="none" stroke="{f}" stroke-width="1" stroke-dasharray="4 3" opacity=".6"/>');
      b.hw(tab(268, 392) + tab(460, 386));
      b.hw('<path d="M342 452h60v34h-60Z" fill="{a}" stroke="{l}" stroke-width="1" opacity=".96"/>' + monoMark(372, 469, 10, '{ad}', 1.4));
      return { svg: b.out(), box: bbox(188, 842) };
    }
    b.lvl();
    b.hw('<path d="' + handle(290, 510, 182, 20, 0, -18) + '" fill="{ad}" stroke="{l}" stroke-width="1.6"/>');
    var body = 'M400 360L190 360L176 818Q176 832 190 832L400 832';
    b.part(sym(body));
    b.sh(mir('M190 360L176 818Q176 832 190 832L238 832C228 680 228 500 236 360Z'));
    b.hi('M214 380L240 380L230 812L204 812Z');
    b.seam('M188 410H612M179 788H621');
    b.st('M190 368H610M189 402H611M178 794H622M178 824H622');
    b.fold('M216 362L212 410M584 362L588 410M196 470Q204 560 198 660M604 470Q596 560 602 660');
    b.lvl();
    b.hw('<path d="' + handle(290, 510, 196, 20, 0, 0) + '" fill="{a}" stroke="{l}" stroke-width="1.6"/>');
    b.hw('<path d="' + hst(290, 510, 196, 20, 0, 0) + '" fill="none" stroke="{f}" stroke-width="1" stroke-dasharray="4 3" opacity=".6"/>');
    b.hw(tab(300, 390) + tab(500, 390));
    b.hw('<path d="M368 452h64v36h-64Z" fill="{a}" stroke="{l}" stroke-width="1" opacity=".96"/>' + monoMark(400, 470, 10.5, '{ad}', 1.4));
    return { svg: b.out(), box: bbox(178, 832) };
  };

  G.crossbody = function (v) {
    var b = new Bld();
    var strap = 'M224 496C150 362 230 140 400 140C570 140 650 362 576 496';
    b.hw('<path d="' + strap + '" fill="none" stroke="{l}" stroke-width="28" opacity=".85"/><path d="' + strap + '" fill="none" stroke="{r}" stroke-width="23.4"/>' +
      '<path d="' + strap + '" fill="none" stroke="{l}" stroke-width=".9" stroke-dasharray="1.5 3" opacity=".35"/>');
    // length slider on the right run, side-release buckle on the left run
    b.hw('<g transform="translate(606 318) rotate(-81)"><rect x="-23" y="-18" width="46" height="36" rx="5" fill="{bt}" stroke="{l}" stroke-width="1.3"/><path d="M-12 -18v36M12 -18v36" stroke="{l}" stroke-width="1.1" opacity=".6"/></g>');
    b.hw('<g transform="translate(194 318) rotate(81)"><path d="M-32 -18h32l12 6v24l-12 6h-32Z" fill="{bt}" stroke="{l}" stroke-width="1.3"/><path d="M0 -18v36M-22 -11h15v22h-15Z" fill="none" stroke="{l}" stroke-width="1" opacity=".6"/><path d="M12 -12h22v24h-22Z" fill="{bt}" stroke="{l}" stroke-width="1.3"/></g>');
    var body = 'M400 456L262 456Q214 456 214 504L214 674Q214 722 262 722L400 722';
    b.hw('<path d="M205 478h22v30h-22Z" fill="{a}" stroke="{l}" stroke-width="1.2"/><path d="M573 478h22v30h-22Z" fill="{a}" stroke="{l}" stroke-width="1.2"/>' +
      '<path d="M211 470h10v8h-10ZM579 470h10v8h-10Z" fill="{mt}" stroke="{mtl}" stroke-width="1"/>');
    b.part(sym(body));
    b.sh(mir('M262 456Q214 456 214 504L214 674Q214 722 262 722L282 722C254 700 248 610 252 504C254 478 266 462 282 457Z'));
    b.hi('M234 508Q238 480 268 474L270 484Q246 490 244 512Z');
    b.st('M224 504Q224 466 262 466H538Q576 466 576 504V674Q576 712 538 712H262Q224 712 224 674Z');
    if (v === 'back') {
      // back zip pocket
      var t = '';
      for (var x = 262; x < 538; x += 4.2) t += 'M' + n1(x) + ' 552V560';
      b.lvl();
      b.fill('M258 548H542V564H258Z', '{i}');
      b.fine(t);
      b.seam('M258 548H542V564H258Z');
      b.hw('<g transform="translate(282 556) rotate(-90)">' + zipPull(0, 0) + '</g>');
      b.hw(label(388, 676, 24, 10));
      return { svg: b.out(), box: bbox(124, 722) };
    }
    // top zip
    b.lvl();
    b.fill('M242 482Q400 490 558 482L558 494Q400 502 242 494Z', '{i}');
    var z = '';
    for (x = 246; x < 556; x += 4.2) z += 'M' + n1(x) + ' ' + n1(483 + 4 * (1 - Math.pow((x - 400) / 156, 2))) + 'v10';
    b.fine(z);
    b.seam('M242 482Q400 490 558 482M242 494Q400 502 558 494');
    b.hw('<g transform="translate(528 491) rotate(-90)">' + zipPull(0, 0) + '</g>');
    // front slip pocket
    var pk = 'M400 570L234 570L234 676Q234 704 262 704L400 704';
    b.sh(sym('M400 570L234 570L234 580L400 580'));
    b.lvl();
    b.fill(sym(pk));
    b.sh(sym('M400 570L234 570L234 579L400 579'));
    b.seam(sym(pk));
    b.st('M238 577H562M239 585H561M240 592V674Q240 698 264 698H536Q560 698 560 674V592');
    b.hw('<path d="M382 604h36v15h-36Z" fill="{a}" stroke="{l}" stroke-width=".9"/>' + monoMark(400, 611.5, 5, '{f}', 1));
    return { svg: b.out(), box: bbox(124, 722) };
  };

  G.socks = function (v) {
    var flip = v === 'back';
    var F = function (d) { return flip ? mir(d) : d; };
    var b = new Bld();
    var sock = 'M256 206L360 206L360 556C362 610 396 640 470 650L548 662C586 668 608 688 608 710C608 732 584 746 530 746L304 746C266 746 244 716 246 664C248 630 254 610 254 560L256 206Z';
    var heel = 'M254 604C290 630 332 690 346 746L304 746C266 746 244 716 246 664C248 636 252 618 254 604Z';
    var toe = 'M548 662C586 668 608 688 608 710C608 732 584 746 530 746C546 722 552 692 548 662Z';
    var cuffB = 'M256 312L360 312';
    var one = function (dx, dy, back) {
      var o = function (d) { return F(offXY(d, dx, dy)); };
      b.part(o(sock));
      b.lvl();
      b.fill(o(heel) + o(toe), '{r}');
      b.seam(o('M254 604C290 630 332 690 346 746') + o('M548 662C552 692 546 722 530 746'));
      b.st(o('M254 594C294 622 340 684 356 746') + o('M540 662C545 692 540 722 522 746'));
      b.seam(o(cuffB));
      b.fine(ribs(o('M256 206L360 206'), o('M256 312L360 312'), 12));
      b.sh(o('M326 316L360 316L360 556C361 590 372 614 396 632C360 612 342 580 336 540Z') + o('M520 704C560 710 590 714 608 716C606 736 584 746 530 746L420 746C470 740 500 726 520 704Z'));
      b.hi(o('M266 326L280 326L278 590L266 596Z'));
      b.fold(o('M266 520Q290 528 314 524M266 470Q286 476 308 472M410 652Q436 662 458 658'));
      if (back) b.sh(o(sock));
      else {
        var mx = flip ? 800 - (308 + dx) : 308 + dx;
        b.hw(monoMark(mx, 262 + dy, 15, '{m}', 2.2));
      }
    };
    one(66, -38, true);
    one(0, 0, false);
    return { svg: b.out(), box: bbox(168, 746), dx: flip ? 33 : -33 };
  };

  /* ================================================================ fallback */

  G.fallback = function () {
    var b = new Bld();
    var body = 'M400 396L250 396Q226 396 224 420L216 628Q216 650 240 650L400 650';
    b.part(sym(body));
    b.sh(mir('M250 396Q226 396 224 420L216 628Q216 650 240 650L276 650C262 600 262 470 270 396Z'));
    b.hi('M244 420L258 420L252 620L238 620Z');
    // folded-back sleeves and shoulders
    b.seam('M286 398L280 650M514 398L520 650M226 470Q252 480 282 478M574 470Q548 480 518 478');
    b.fold('M300 560Q340 572 380 566M420 566Q460 572 500 560');
    // collar
    b.lvl();
    b.fill('M330 396Q400 382 470 396Q440 430 400 432Q360 430 330 396Z', '{i}');
    b.part('M318 396Q326 446 400 448Q474 446 482 396L470 396Q440 430 400 432Q360 430 330 396Z', '{f}', 'M318 396Q326 446 400 448Q474 446 482 396');
    b.fine(ribs('M330 396Q360 430 400 432Q440 430 470 396', 'M318 396Q326 446 400 448Q474 446 482 396', 16));
    b.hw(label(388, 404, 24, 10));
    b.st('M220 616Q400 620 580 616M220 622Q400 626 580 622');
    return { svg: b.out(), box: bbox(382, 650) };
  };

  /* ================================================================ swatches */

  var TEXTURES = ['jersey', 'fleece', 'canvas', 'twill', 'denim', 'corduroy', 'knit', 'waffle', 'nylon', 'quilted', 'ripstop', 'wool', 'poplin'];
  function rng(seed) {
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function P(d, col, w, op, extra) { return d ? '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + w + '" opacity="' + op + '"' + (extra || '') + '/>' : ''; }
  function F(d, col, op) { return d ? '<path d="' + d + '" fill="' + col + '" opacity="' + op + '"/>' : ''; }

  /** soft diagonal sheen made of nested translucent bands */
  function sheen(dark, amt) {
    var a = (amt || 1) * (dark ? 0.012 : 0.03), s = '';
    for (var i = 0; i < 6; i++) {
      var w = 8 + i * 9;
      s += F('M-20 ' + (70 - w) + 'C50 ' + (50 - w) + ' 110 ' + (40 - w) + ' 220 ' + (0 - w) + 'L220 ' + (0 + w) + 'C110 ' + (40 + w) + ' 50 ' + (50 + w) + ' -20 ' + (70 + w) + 'Z', '#ffffff', a);
      s += F('M-20 ' + (178 - w * 0.6) + 'C60 ' + (150 - w * 0.6) + ' 140 ' + (128 - w * 0.6) + ' 220 ' + (108 - w * 0.6) + 'L220 ' + (108 + w * 0.6) + 'C140 ' + (128 + w * 0.6) + ' 60 ' + (150 + w * 0.6) + ' -20 ' + (178 + w * 0.6) + 'Z', '#ffffff', a * 0.6);
    }
    return s;
  }
  /** square fabric close-up, viewBox 0 0 200 200, no ids */
  function swatch(color, texture, opts) {
    // accept (texture, opts) as well as (color, texture, opts)
    if (typeof color === 'string' && TEXTURES.indexOf(color.toLowerCase()) >= 0 && (texture == null || typeof texture === 'object')) {
      opts = texture; texture = color; color = opts && opts.color;
    }
    var o = opts || {};
    var tex = TEXTURES.indexOf(String(texture || '').toLowerCase()) >= 0 ? String(texture).toLowerCase() : 'jersey';
    var c = toRgb(color) || toRgb(DEF_COLOR), L = lum(c), dark = L < 0.1;
    var base = toHex(c), dk = toHex(mix(c, BLACK, dark ? 0.5 : 0.32)), dk2 = toHex(mix(c, BLACK, dark ? 0.7 : 0.5)), lt = toHex(mix(c, WHITE, dark ? 0.22 : 0.42));
    var R = rng(hash(tex + base)), s = '', i, j, x, y, d, d2;
    var k = dark ? 1.35 : 1; // lift texture contrast on dark cloth
    function noise(n, len, col, op, w) {
      var q = '';
      for (var m = 0; m < n; m++) {
        var a = R() * Math.PI * 2, l = len * (0.5 + R());
        var px = R() * 200, py = R() * 200;
        q += 'M' + Math.round(px) + ' ' + Math.round(py) + 'l' + n1(Math.cos(a) * l) + ' ' + n1(Math.sin(a) * l);
      }
      return P(q, col, w || 0.6, op);
    }
    switch (tex) {
      case 'jersey':
        // fine vertical wales broken into courses
        d = ''; d2 = '';
        for (x = 0; x < 202; x += 3.2) { d += 'M' + n1(x) + ' 0V200'; d2 += 'M' + n1(x + 1.4) + ' 0V200'; }
        s += P(d, dk, 1.1, 0.2 * k, ' stroke-dasharray="3 1.4" stroke-linecap="butt"') + P(d2, lt, 0.9, 0.22 * k, ' stroke-dasharray="3 1.4" stroke-dashoffset="2.2" stroke-linecap="butt"') +
          noise(220, 2.4, lt, 0.12 * k) + noise(160, 3, dk, 0.08 * k);
        break;
      case 'fleece':
        s += noise(650, 2.8, dk, 0.18 * k, 0.75) + noise(500, 2.4, lt, 0.22 * k, 0.75);
        for (i = 0; i < 26; i++) s += F(circ(R() * 200, R() * 200, n1(6 + R() * 16)), R() > 0.5 ? lt : dk, 0.025 * k);
        break;
      case 'canvas':
        // plain weave: alternate over/under phase every other yarn
        var g2 = 2.8, h0 = '', h1 = '', v0 = '', v1 = '';
        for (i = 0, y = 0; y < 202; y += g2, i++) { d = 'M0 ' + n1(y + R() * 0.3) + 'H200'; if (i % 2) h1 += d; else h0 += d; }
        for (i = 0, x = 0; x < 202; x += g2, i++) { d = 'M' + n1(x + R() * 0.3) + ' 0V200'; if (i % 2) v1 += d; else v0 += d; }
        var da = ' stroke-dasharray="' + g2 + ' ' + g2 + '"', db = da + ' stroke-dashoffset="' + g2 + '"';
        s += P(h0, dk, 1.7, 0.16 * k, da) + P(h1, dk, 1.7, 0.16 * k, db) + P(v0, lt, 1.5, 0.2 * k, db) + P(v1, lt, 1.5, 0.2 * k, da);
        var sl2 = '';
        for (i = 0; i < 16; i++) { y = R() * 200; sl2 += 'M' + n1(R() * 140) + ' ' + n1(y) + 'h' + n1(24 + R() * 70); }
        s += P(sl2, lt, 1.4, 0.12 * k) + noise(160, 1.4, dk, 0.08 * k);
        break;
      case 'twill':
      case 'denim':
        var g = tex === 'denim' ? 3 : 3.6, ang = tex === 'denim' ? 63 : 45;
        var A = hatch([[-20, -20], [220, -20], [220, 220], [-20, 220]], ang, g, 0), B = hatch([[-20, -20], [220, -20], [220, 220], [-20, 220]], ang, g, g / 2);
        if (tex === 'denim') {
          s += P(A, dk2, 1.5, 0.32 * k) + P(B, '#e8e4dc', 0.9, 0.14 * k, ' stroke-dasharray="2 3 5 2"');
          var sl = '';
          for (i = 0; i < 26; i++) { y = R() * 200; sl += 'M' + n1(R() * 200 - 40) + ' ' + n1(y) + 'h' + n1(14 + R() * 40); }
          s += P(sl, '#f1ede6', 1.4, 0.07);
          s += noise(300, 1.6, '#f1ede6', 0.1);
        } else {
          s += P(A, dk, 1.3, 0.24 * k) + P(B, lt, 0.8, 0.22 * k) + noise(120, 2, dk, 0.08 * k);
        }
        break;
      case 'corduroy':
        d = ''; d2 = ''; var d3 = '';
        for (x = 0; x < 204; x += 8) { d += 'M' + x + ' 0V200'; d2 += 'M' + (x + 4) + ' 0V200'; d3 += 'M' + (x + 2.4) + ' 0V200'; }
        s += P(d, dk2, 1.8, 0.34 * k) + P(d2, lt, 2.6, 0.2 * k) + P(d3, dk, 1, 0.1 * k) + noise(500, 1.6, lt, 0.12 * k);
        break;
      case 'knit':
        // stockinette: each stitch is a V of two leaning loops
        var lv = '', ry2 = 7.2, rx2 = 3.6;
        function leg(cx, cy, ph) {
          var a = ph * Math.PI / 180, ux = -Math.sin(a) * ry2, uy = Math.cos(a) * ry2;
          var A1 = 'a' + rx2 + ' ' + ry2 + ' ' + ph + ' 1 0 ';
          return 'M' + n1(cx - ux) + ' ' + n1(cy - uy) + A1 + n1(2 * ux) + ' ' + n1(2 * uy) + A1 + n1(-2 * ux) + ' ' + n1(-2 * uy) + 'Z';
        }
        for (y = -8; y < 210; y += 12) for (x = 12; x < 214; x += 24) lv += leg(x - 5, y + 6.5, -36) + leg(x + 5, y + 6.5, 36);
        var gp = '';
        for (x = 0; x < 214; x += 24) gp += 'M' + x + ' 0V200';
        s += P(gp, dk2, 3, 0.16 * k) + '<path d="' + lv + '" fill="' + lt + '" fill-opacity="' + n1(0.26 * k * 100) / 100 + '" stroke="' + dk2 + '" stroke-width=".8" stroke-opacity="' + n1(0.2 * k * 100) / 100 + '"/>' + noise(200, 2, lt, 0.08 * k);
        break;
      case 'waffle':
        d = ''; var hT = '', vL = '', hB = '', vR = '';
        for (y = 0; y < 200; y += 12.5) for (x = 0; x < 200; x += 12.5) d += 'M' + n1(x + 2.2) + ' ' + n1(y + 2.2) + 'h8.1v8.1h-8.1Z';
        for (i = 0; i < 16; i++) {
          var o2 = n1(i * 12.5 + 2.2), o3 = n1(i * 12.5 + 10.3);
          hT += 'M2.2 ' + o2 + 'H200'; vL += 'M' + o2 + ' 2.2V200'; hB += 'M2.2 ' + o3 + 'H200'; vR += 'M' + o3 + ' 2.2V200';
        }
        var dsh = ' stroke-dasharray="8.1 4.4"';
        s += F(d, dk, 0.18 * k) + P(hT + vL, dk2, 1, 0.3 * k, dsh + ' stroke-linecap="butt"') + P(hB + vR, lt, 1, 0.34 * k, dsh + ' stroke-linecap="butt"') + noise(200, 1.6, lt, 0.08 * k);
        break;
      case 'nylon':
        d = '';
        for (y = 0; y < 200; y += 1.6) d += 'M0 ' + n1(y) + 'H200';
        s += P(d, dk, 0.5, 0.07 * k);
        s += sheen(dark, dark ? 2 : 1);
        s += P('M10 140C60 120 110 128 190 96M20 40C70 60 120 40 180 50', dk, 1, 0.12 * k) + P('M12 142C62 122 112 130 192 98', lt, 1, (dark ? 0.32 : 0.2) * k);
        break;
      case 'quilted':
        // down-filled baffles: a soft highlight in every channel, stitched seams in between
        d = '';
        for (y = 0; y < 200; y += 1.6) d += 'M0 ' + n1(y) + 'H200';
        s += P(d, dk, 0.5, 0.06 * k);
        var bh = 50, seams = '', stitch = '';
        for (y = 0; y < 220; y += bh) {
          for (i = 0; i < 6; i++) {
            var hw = bh * 0.78 - i * 6.5, cy = y + bh / 2 + (R() - 0.5) * 2;
            s += F('M-4 ' + n1(cy - hw / 2) + 'C60 ' + n1(cy - hw / 2 - 3) + ' 140 ' + n1(cy - hw / 2 + 3) + ' 204 ' + n1(cy - hw / 2 - 1) + 'V' + n1(cy + hw / 2 - 1) + 'C140 ' + n1(cy + hw / 2 + 3) + ' 60 ' + n1(cy + hw / 2 - 3) + ' -4 ' + n1(cy + hw / 2) + 'Z', lt, (dark ? 0.06 : 0.045) * k);
          }
          seams += 'M0 ' + n1(y) + 'C60 ' + n1(y + 2) + ' 140 ' + n1(y - 2) + ' 200 ' + n1(y + 1);
          stitch += 'M0 ' + n1(y + 1.4) + 'C60 ' + n1(y + 3.4) + ' 140 ' + n1(y - 0.6) + ' 200 ' + n1(y + 2.4);
        }
        s += P(seams, dk2, 7, 0.32 * k) + P(seams, dk2, 2, 0.4 * k) + P(stitch, lt, 0.9, 0.34 * k, ' stroke-dasharray="3.5 2.5"') + sheen(dark, 0.8);
        break;
      case 'ripstop':
        d = '';
        for (y = 0; y < 200; y += 2) d += 'M0 ' + y + 'H200';
        for (x = 0; x < 200; x += 2) d += 'M' + x + ' 0V200';
        d2 = '';
        for (i = 0; i <= 200; i += 16) d2 += 'M0 ' + i + 'H200M0 ' + (i + 1.8) + 'H200M' + i + ' 0V200M' + (i + 1.8) + ' 0V200';
        s += P(d, dk, 0.5, 0.07 * k) + P(d2, dk2, 0.8, 0.3 * k) + P(offXY(d2, 0.9, 0.9), lt, 0.6, 0.24 * k) + sheen(dark, 0.6);
        break;
      case 'wool':
        s += P(hatch([[-20, -20], [220, -20], [220, 220], [-20, 220]], 45, 4, 0), dk, 0.8, 0.08 * k) + noise(700, 2.6, dk, 0.18 * k, 0.65) + noise(560, 2.4, lt, 0.22 * k, 0.65);
        for (i = 0; i < 18; i++) s += F(circ(R() * 200, R() * 200, n1(8 + R() * 18)), R() > 0.5 ? lt : dk, 0.02 * k);
        break;
      case 'poplin':
        d = ''; d2 = '';
        for (y = 0; y < 200; y += 2.2) { d += 'M0 ' + n1(y) + 'H200'; }
        for (x = 0; x < 200; x += 3) d2 += 'M' + x + ' 0V200';
        s += P(d, dk, 0.9, 0.14 * k) + P(offY(d, 1.1), lt, 0.6, 0.2 * k) + P(d2, dk, 0.4, 0.06 * k) + sheen(dark, 0.35);
        break;
    }
    // soft vignette + light from the upper left, built from finely stepped translucent layers (no gradients, no ids)
    var vig = 'M0 0H200V200H0Z', vg = '';
    for (i = 1; i <= 14; i++) vg += P(vig, '#000000', i * 7, dark ? 0.014 : 0.0065);
    var lg = '';
    for (i = 1; i <= 10; i++) lg += F(circ(10, 10, i * 16), '#ffffff', dark ? 0.006 : 0.012);
    s += vg + lg;
    var title = o.title != null ? String(o.title) : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"' + (o.className ? ' class="' + esc(o.className) + '"' : '') +
      (title ? ' role="img" aria-label="' + esc(title) + '"' : ' aria-hidden="true"') + ' preserveAspectRatio="xMidYMid slice" stroke-linecap="round">' +
      (title ? '<title>' + esc(title) + '</title>' : '') +
      '<rect width="200" height="200" fill="' + base + '"/>' + s + '</svg>';
  }

  /* ================================================================ pattern pieces */

  /** inward offset of a closed polygon (miter, clamped) */
  function offsetPoly(pts, d) {
    var n = pts.length, area = 0, i, out = [];
    for (i = 0; i < n; i++) { var a = pts[i], b2 = pts[(i + 1) % n]; area += a[0] * b2[1] - b2[0] * a[1]; }
    var sg = area > 0 ? 1 : -1;
    for (i = 0; i < n; i++) {
      var p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
      var e1 = [c[0] - p[0], c[1] - p[1]], e2 = [q[0] - c[0], q[1] - c[1]];
      var l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
      var m1 = [-e1[1] / l1 * sg, e1[0] / l1 * sg], m2 = [-e2[1] / l2 * sg, e2[0] / l2 * sg];
      var m = [m1[0] + m2[0], m1[1] + m2[1]], ml = Math.hypot(m[0], m[1]) || 1;
      m = [m[0] / ml, m[1] / ml];
      var dot = m[0] * m1[0] + m[1] * m1[1], len = Math.min(d / Math.max(dot, 0.3), d * 2.5);
      out.push([c[0] + m[0] * len, c[1] + m[1] * len]);
    }
    return out;
  }
  function dedupe(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = out[out.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 2) out.push(p);
    }
    if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 2) out.pop();
    return out;
  }
  function polyD(pts) { var s = 'M' + pt(pts[0]); for (var i = 1; i < pts.length; i++) s += 'L' + pt(pts[i]); return s + 'Z'; }
  function txt(x, y, str, size, o) {
    o = o || {};
    return '<text x="' + n1(x) + '" y="' + n1(y) + '" font-size="' + size + '" text-anchor="' + (o.anchor || 'middle') + '" letter-spacing="' + (o.ls || '.16em') + '"' +
      (o.weight ? ' font-weight="' + o.weight + '"' : '') + (o.rot ? ' transform="rotate(' + o.rot + ' ' + n1(x) + ' ' + n1(y) + ')"' : '') +
      ' fill="' + (o.fill || '{ac}') + '"' + (o.op ? ' opacity="' + o.op + '"' : '') + '>' + esc(str) + '</text>';
  }
  function arrowLine(x1, y1, x2, y2, k) {
    var a = Math.atan2(y2 - y1, x2 - x1), h = 7 * (k || 1), w = 3.2 * (k || 1);
    function head(x, y, ang) {
      var bx = x - Math.cos(ang) * h, by = y - Math.sin(ang) * h;
      return 'M' + n1(bx - Math.sin(ang) * w) + ' ' + n1(by + Math.cos(ang) * w) + 'L' + n1(x) + ' ' + n1(y) + 'L' + n1(bx + Math.sin(ang) * w) + ' ' + n1(by - Math.cos(ang) * w);
    }
    return 'M' + n1(x1) + ' ' + n1(y1) + 'L' + n1(x2) + ' ' + n1(y2) + head(x2, y2, a) + head(x1, y1, a + Math.PI);
  }
  /**
   * piece: { d, at:[x,y], name, cut, grain:[x1,y1,x2,y2], fold:[x1,y1,x2,y2], notches:[[x,y,n]], drills:[[x,y]], lines: d (internal, dash-dot), label:[x,y], sa }
   */
  function piece(p, sc) {
    sc = sc || 1;
    var W = function (v) { return n1(v / sc * 100) / 100; };
    var poly = dedupe(flat(p.d, 6)), seam = offsetPoly(poly, (p.sa == null ? 7 : p.sa) / Math.sqrt(sc));
    var s = '<g transform="translate(' + p.at[0] + ' ' + p.at[1] + ')">';
    s += '<path d="' + p.d + '" fill="{k}" fill-opacity=".028" stroke="{k}" stroke-width="' + W(1.3) + '"/>';
    s += '<path d="' + polyD(seam) + '" fill="none" stroke="{k}" stroke-width="' + W(0.8) + '" stroke-dasharray="' + W(4) + ' ' + W(3) + '" opacity=".7"/>';
    if (p.lines) s += '<path d="' + p.lines + '" fill="none" stroke="{ac}" stroke-width="' + W(0.9) + '" stroke-dasharray="' + W(9) + ' ' + W(3) + ' ' + W(2) + ' ' + W(3) + '" opacity=".9"/>';
    if (p.fold) {
      var f = p.fold;
      s += '<path d="M' + f[0] + ' ' + f[1] + 'L' + f[2] + ' ' + f[3] + '" stroke="{ac}" stroke-width="' + W(1.6) + '" stroke-dasharray="' + W(12) + ' ' + W(3) + ' ' + W(2) + ' ' + W(3) + '"/>';
      var fa = Math.atan2(f[3] - f[1], f[2] - f[0]) * 180 / Math.PI, fx = (f[0] + f[2]) / 2, fy = (f[1] + f[3]) / 2;
      var nx = -(f[3] - f[1]), ny = f[2] - f[0], nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      var tx = fx + nx * 12 / sc, ty = fy + ny * 12 / sc;
      s += txt(tx, ty, 'PLACE ON FOLD', W(7.5), { rot: fa, op: 0.95 });
    }
    if (p.grain) { var g = p.grain; s += '<path d="' + arrowLine(g[0], g[1], g[2], g[3], 1 / sc) + '" fill="none" stroke="{ac}" stroke-width="' + W(1.1) + '"/>'; }
    if (p.notches) {
      var nd = '';
      p.notches.forEach(function (q) {
        // inward normal of the nearest edge
        var best = 1e9, bi = 0;
        for (var i = 0; i < poly.length; i++) {
          var A = poly[i], B = poly[(i + 1) % poly.length], vx = B[0] - A[0], vy = B[1] - A[1], L2 = vx * vx + vy * vy || 1;
          var t = clamp(((q[0] - A[0]) * vx + (q[1] - A[1]) * vy) / L2, 0, 1), dx = A[0] + vx * t - q[0], dy = A[1] + vy * t - q[1], dd = dx * dx + dy * dy;
          if (dd < best) { best = dd; bi = i; }
        }
        var A2 = poly[bi], B2 = poly[(bi + 1) % poly.length], ex = B2[0] - A2[0], ey = B2[1] - A2[1], el = Math.hypot(ex, ey) || 1;
        var c = [q[0] + 0, q[1] + 0], test = [c[0] - ey / el * 4, c[1] + ex / el * 4];
        var sgn = inside(poly, test) ? 1 : -1, mx = -ey / el * sgn, my = ex / el * sgn;
        for (var k = 0; k < (q[2] || 1); k++) {
          var ox = ex / el * k * 5, oy = ey / el * k * 5;
          nd += 'M' + n1(c[0] + ox / sc) + ' ' + n1(c[1] + oy / sc) + 'l' + n1(mx * 9 / sc) + ' ' + n1(my * 9 / sc);
        }
      });
      s += '<path d="' + nd + '" stroke="{k}" stroke-width="' + W(1.3) + '"/>';
    }
    if (p.drills) p.drills.forEach(function (q) {
      var r = 3.2 / sc, e = 6 / sc;
      s += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="' + n1(r) + '" fill="none" stroke="{k}" stroke-width="' + W(0.9) + '"/><path d="M' + n1(q[0] - e) + ' ' + q[1] + 'h' + n1(2 * e) + 'M' + q[0] + ' ' + n1(q[1] - e) + 'v' + n1(2 * e) + '" stroke="{k}" stroke-width="' + W(0.7) + '"/>';
    });
    if (p.marks) s += '<path d="' + p.marks + '" fill="none" stroke="{k}" stroke-width="' + W(0.9) + '"/>';
    var lb = p.label || [0, 0];
    s += txt(lb[0], lb[1], p.name, W(11.5), { weight: 600, rot: p.rot });
    if (p.cut) s += txt(lb[0] + (p.rot ? 14 / sc : 0), lb[1] + (p.rot ? 0 : 15 / sc), p.cut, W(8.5), { op: 0.85, rot: p.rot });
    return s + '</g>';
  }
  function inside(poly, q) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b2 = poly[j];
      if ((a[1] > q[1]) !== (b2[1] > q[1]) && q[0] < (b2[0] - a[0]) * (q[1] - a[1]) / (b2[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }

  /* piece shapes (≈5 px per cm) */
  function bodice(o) {
    // half front/back with centre on x = 0 (fold) unless ext (button extension) is set
    var w = o.w || 150, l = o.l || 360, nw = o.nw || 40, nd = o.nd, sd = o.sd || 16, e = o.ext || 0;
    var hem = o.tail ? 'L' + (w + 2) + ' ' + (l - o.tail) + 'C' + (w - 20) + ' ' + (l - 6) + ' ' + (w * 0.4) + ' ' + l + ' ' + (-e) + ' ' + l : 'L' + (w + 2) + ' ' + l + 'L' + (-e) + ' ' + l;
    return 'M' + (-e) + ' ' + nd + 'L0 ' + nd + 'C' + (nw * 0.55) + ' ' + nd + ' ' + nw + ' ' + (nd * 0.6) + ' ' + nw + ' 0L' + w + ' ' + sd +
      'C' + (w - 7) + ' ' + (sd + 44) + ' ' + (w - 5) + ' ' + (sd + 90) + ' ' + (w + 2) + ' ' + (sd + 114) + hem + 'Z';
  }
  function sleeveP(o) {
    var w = o.w || 250, l = o.l || 270, cw = o.cw || 120, cap = o.cap || 30, x0 = (w - cw) / 2;
    return 'M0 ' + cap + 'C' + (w * 0.16) + ' ' + (cap * 0.34) + ' ' + (w * 0.34) + ' 0 ' + (w / 2) + ' 0C' + (w * 0.66) + ' 0 ' + (w * 0.84) + ' ' + (cap * 0.34) + ' ' + w + ' ' + cap +
      'L' + (w - x0) + ' ' + l + 'L' + x0 + ' ' + l + 'Z';
  }
  function rectP(w, h, r) { r = r || 0; return r ? 'M' + r + ' 0H' + (w - r) + 'Q' + w + ' 0 ' + w + ' ' + r + 'V' + (h - r) + 'Q' + w + ' ' + h + ' ' + (w - r) + ' ' + h + 'H' + r + 'Q0 ' + h + ' 0 ' + (h - r) + 'V' + r + 'Q0 0 ' + r + ' 0Z' : 'M0 0H' + w + 'V' + h + 'H0Z'; }
  function hoodP() { return 'M0 196L0 26C30 4 100 -6 150 22C182 42 186 110 164 160L150 196Z'; }
  function collarP(w, h, pnt) { return 'M0 ' + (h * 0.3) + 'C' + (w * 0.3) + ' ' + (h * 0.05) + ' ' + (w * 0.7) + ' 0 ' + w + ' 0L' + w + ' ' + h + 'C' + (w * 0.68) + ' ' + h + ' ' + (w * 0.3) + ' ' + (h * 1.1) + ' ' + (-pnt) + ' ' + (h * 1.5) + 'Z'; }
  function trouserF(o) {
    var l = o.l || 470, h = o.hem || 116;
    if (l < 320) return 'M22 0L130 0C136 30 144 64 146 110L' + (14 + h) + ' ' + l + 'L0 ' + l + 'C-6 190 -16 150 -26 132C-10 128 4 118 10 84Z';
    return 'M22 0L130 0C136 30 144 64 144 100C144 180 130 250 128 300L' + (12 + h) + ' ' + l + 'L12 ' + l + 'L8 300C2 220 -14 150 -26 132C-10 128 4 118 10 84Z';
  }
  function trouserB(o) {
    var l = o.l || 470, h = o.hem || 128;
    if (l < 320) return 'M-4 -14L124 0C132 34 142 70 144 120L' + (8 + h) + ' ' + l + 'L-16 ' + l + 'C-26 204 -44 166 -66 150C-34 144 -14 128 -10 92Z';
    return 'M-4 -14L124 0C132 34 142 70 142 110C142 190 132 260 130 310L' + (8 + h) + ' ' + l + 'L8 ' + l + 'L2 310C-6 230 -40 166 -66 150C-34 144 -14 128 -10 92Z';
  }

  function patternPieces(type, opts) {
    var o = opts || {}, t = typeof type === 'string' ? type.toLowerCase().trim() : '';
    var k = toRgb(o.stroke) ? o.stroke : '#130D0A', ac = toRgb(o.accent) ? o.accent : '#C07A42';
    var no = TYPES.indexOf(t) + 1, id = 'CS-PATTERN ' + (no > 0 ? (no < 10 ? '0' : '') + no : '00');
    var pcs = layout(t);
    // fit the marker into the sheet (x 40–760, y 56–884)
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pcs.forEach(function (p) {
      var pts = flat(p.d, 4).concat(p.label ? [[p.label[0] + 50, p.label[1]], [p.label[0] - 50, p.label[1] - 12]] : []);
      pts.forEach(function (q) { var X = q[0] + p.at[0], Y = q[1] + p.at[1]; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; });
    });
    var sc = pcs.length ? Math.min(700 / (x1 - x0), 800 / (y1 - y0), 1.5) : 1;
    var tx = n1(400 - sc * (x0 + x1) / 2), ty = n1(470 - sc * (y0 + y1) / 2);
    var s = '<g transform="matrix(' + n1(sc * 1000) / 1000 + ' 0 0 ' + n1(sc * 1000) / 1000 + ' ' + tx + ' ' + ty + ')">' + pcs.map(function (p) { return piece(p, sc); }).join('') + '</g>';
    // sheet furniture: registration marks, title block, scale bar
    var reg = function (x, y) { return '<circle cx="' + x + '" cy="' + y + '" r="7" fill="none" stroke="{k}" stroke-width=".8"/><path d="M' + (x - 12) + ' ' + y + 'h24M' + x + ' ' + (y - 12) + 'v24" stroke="{k}" stroke-width=".8"/>'; };
    var tb = '<path d="M40 900H760" stroke="{k}" stroke-width=".8"/>' +
      txt(40, 930, id, 15, { anchor: 'start', weight: 600, fill: '{k}', ls: '.22em' }) +
      txt(40, 950, (t && G[t] && t !== 'fallback' ? t : 'garment').toUpperCase() + ' · PATTERN ROOM', 9, { anchor: 'start', op: 0.9 }) +
      txt(760, 930, 'SIZE M · SCALE 1:20', 9, { anchor: 'end', fill: '{k}', op: 0.8 }) +
      txt(760, 950, 'SEAM ALLOWANCE 1 CM INCLUDED', 8, { anchor: 'end', op: 0.9 }) +
      '<path d="M520 940h100M520 935v10M545 937v6M570 935v10M595 937v6M620 935v10" stroke="{k}" stroke-width=".8"/>' + txt(570, 958, '10 CM', 7.5, { fill: '{k}', op: 0.7 }) +
      reg(40, 40) + reg(760, 40) + reg(40, 880) + reg(760, 880);
    var title = o.title != null ? String(o.title) : '';
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000"' + (o.className ? ' class="' + esc(o.className) + '"' : '') +
      (title ? ' role="img" aria-label="' + esc(title) + '"' : ' aria-hidden="true"') +
      ' font-family="Poppins, \'Helvetica Neue\', Helvetica, Arial, sans-serif" stroke-linejoin="round" stroke-linecap="round">' +
      (title ? '<title>' + esc(title) + '</title>' : '') + s + tb + '</svg>';
    return out.replace(/\{k\}/g, k).replace(/\{ac\}/g, ac);
  }

  function layout(t) {
    var P = [];
    function add(p) { P.push(p); return p; }
    var knitT = ['tee', 'longsleeve', 'crewneck', 'hoodie', 'ziphoodie', 'knit', 'cardigan'];
    var wovenT = ['shirt', 'overshirt', 'workjacket', 'coach', 'bomber', 'puffer', 'coat'];
    var botT = ['sweatpants', 'trousers', 'jeans', 'cargo', 'shorts'];
    if (knitT.indexOf(t) >= 0 || !t || !G[t] || t === 'fallback') {
      var tee = t === 'tee', open = t === 'ziphoodie' || t === 'cardigan', sweat = !(tee || t === 'longsleeve');
      var L = sweat ? 330 : 360;
      add({ d: bodice({ nd: t === 'cardigan' ? 160 : 46, nw: t === 'hoodie' || t === 'ziphoodie' ? 46 : 40, l: L, ext: open ? 0 : 0 }), at: [74, 78], name: 'FRONT', cut: open ? 'CUT 2' : 'CUT 1 ON FOLD',
        fold: open ? null : [0, t === 'cardigan' ? 160 : 46, 0, L], grain: [80, 100, 80, L - 50], notches: [[146, 96], [152, L - 4]], label: [86, L / 2 + 20],
        drills: t === 'hoodie' ? [[30, L - 120], [90, L - 120]] : null, lines: t === 'cardigan' ? 'M14 160L40 0' : null });
      add({ d: bodice({ nd: 12, nw: t === 'hoodie' || t === 'ziphoodie' ? 46 : 40, l: L }), at: [272, 78], name: 'BACK', cut: 'CUT 1 ON FOLD', fold: [0, 12, 0, L], grain: [80, 70, 80, L - 50],
        notches: [[146, 92, 2], [152, L - 4]], label: [86, L / 2 + 20] });
      if (tee) {
        add({ d: sleeveP({ w: 214, l: 104, cw: 188, cap: 26 }), at: [74, 486], name: 'SLEEVE', cut: 'CUT 2', grain: [107, 30, 107, 90], notches: [[107, 0], [44, 12], [170, 12, 2]], label: [107, 60] });
        add({ d: rectP(260, 26), at: [74, 650], name: 'NECK RIB', cut: 'CUT 1 · 1×1 RIB', grain: [20, 6, 20, 20], label: [140, -10] });
        add({ d: 'M0 0H96V112L48 124L0 112Z', at: [326, 480], name: 'POCKET', cut: 'CUT 1', grain: [48, 20, 48, 96], label: [48, 60], marks: 'M0 18H96' });
      } else {
        add({ d: sleeveP({ w: 244, l: sweat ? 270 : 300, cw: 110, cap: 30 }), at: [474, 78], name: 'SLEEVE', cut: 'CUT 2', grain: [122, 50, 122, sweat ? 230 : 260], notches: [[122, 0], [44, 14], [200, 14, 2]], label: [122, 150] });
      }
      var y2 = 500;
      if (t === 'hoodie' || t === 'ziphoodie') {
        add({ d: hoodP(), at: [474, 390], name: 'HOOD', cut: 'CUT 2 + 2 LINING', grain: [70, 40, 70, 170], notches: [[0, 120], [150, 196]], label: [86, 110] });
        add({ d: 'M0 0C120 -6 240 -6 360 0L360 52C240 58 120 58 0 52Z', at: [74, 470], name: 'HOOD CENTRE', cut: 'CUT 1 + 1 LINING', grain: [30, 26, 330, 26], notches: [[180, 0], [180, 52]], label: [180, 22] });
        add({ d: t === 'ziphoodie' ? 'M0 0H118C126 40 140 80 150 112L150 150H0Z' : 'M0 0H118C126 40 140 80 150 112L150 150H0Z', at: [74, 580], name: 'POCKET', cut: t === 'ziphoodie' ? 'CUT 2' : 'CUT 1 ON FOLD', fold: t === 'ziphoodie' ? null : [0, 0, 0, 150], grain: [60, 30, 60, 130], label: [72, 92] });
        y2 = 580;
      }
      if (t === 'knit') {
        add({ d: rectP(220, 70), at: [474, 400], name: 'MOCK NECK', cut: 'CUT 1 · 2×2 RIB', grain: [24, 12, 24, 58], label: [120, 38], lines: 'M0 35H220' });
        add({ d: 'M0 0L150 16L150 52L0 40Z', at: [474, 510], name: 'SADDLE', cut: 'PART OF SLEEVE', grain: [20, 20, 130, 34], label: [80, 70] });
      }
      if (t === 'cardigan') {
        add({ d: rectP(46, 380), at: [474, 390], name: 'BAND', cut: 'CUT 1', grain: [23, 30, 23, 350], drills: [[23, 160], [23, 210], [23, 260], [23, 310], [23, 360]], label: [70, 200], rot: 90 });
        add({ d: rectP(96, 96), at: [570, 400], name: 'POCKET', cut: 'CUT 2', grain: [48, 24, 48, 80], label: [48, 56], marks: 'M0 18H96' });
      }
      if (sweat) {
        add({ d: rectP(120, 80), at: [t === 'hoodie' || t === 'ziphoodie' ? 260 : 74, y2 + 20], name: 'CUFF', cut: 'CUT 2 · 2×2 RIB', grain: [14, 10, 14, 70], label: [64, 34], lines: 'M0 40H120' });
        add({ d: rectP(t === 'hoodie' || t === 'ziphoodie' ? 300 : 340, 92), at: [t === 'hoodie' || t === 'ziphoodie' ? 260 : 74, y2 + 140], name: 'HEM RIB', cut: 'CUT 1 · 2×2 RIB', grain: [14, 12, 14, 80], label: [170, 40], lines: 'M0 46H340'.replace('340', t === 'hoodie' || t === 'ziphoodie' ? '300' : '340') });
        if (t === 'crewneck') add({ d: rectP(250, 50), at: [474, 420], name: 'NECK RIB', cut: 'CUT 1 · 1×1 RIB', grain: [16, 8, 16, 42], label: [130, -10], lines: 'M0 25H250' });
      }
      if (t === 'longsleeve') {
        add({ d: rectP(260, 26), at: [474, 420], name: 'NECK RIB', cut: 'CUT 1 · 1×1 RIB', grain: [20, 6, 20, 20], label: [140, -10] });
        add({ d: rectP(110, 60), at: [474, 500], name: 'CUFF', cut: 'CUT 2 · 1×1 RIB', grain: [14, 10, 14, 50], label: [55, 34], lines: 'M0 30H110' });
      }
      return P;
    }
    if (wovenT.indexOf(t) >= 0) {
      var coat = t === 'coat', puff = t === 'puffer', shirt = t === 'shirt' || t === 'overshirt';
      var Lw = coat ? 470 : puff ? 380 : 360, ext = coat ? 30 : 14;
      var qy = puff ? 'M0 70H150M0 130H150M0 190H150M0 250H150M0 310H150' : t === 'bomber' ? hatch(flat(bodice({ nd: 40, l: 330 })), 45, 30, 15, 6) + hatch(flat(bodice({ nd: 40, l: 330 })), -45, 30, 15, 6) : null;
      add({ d: bodice({ nd: coat ? 120 : 44, nw: 40, l: Lw, ext: ext, tail: shirt ? 40 : 0 }), at: [96, 70], name: 'FRONT', cut: 'CUT 2', grain: [80, 110, 80, Lw - 50],
        notches: [[146, 96], [152, Lw - 30], [0, coat ? 120 : 44]], label: [86, Lw / 2 + 30], lines: (coat ? 'M-30 260L40 0' : 'M0 ' + (coat ? 120 : 44) + 'V' + Lw) + (qy && puff ? qy : ''),
        drills: coat ? [[30, 300], [100, 300]] : t === 'workjacket' ? [[40, 110], [110, 110], [30, 220], [116, 220]] : shirt ? [[96, 96]] : null,
        marks: (function () { var m = ''; for (var y = coat ? 290 : 80; y < Lw - 30; y += coat ? 70 : 64) m += 'M-4 ' + y + 'h8M0 ' + (y - 4) + 'v8'; return m; })() });
      add({ d: bodice({ nd: 12, nw: 40, l: Lw - (shirt ? 70 : 0), tail: shirt ? 40 : 0 }), at: [294, shirt ? 140 : 70], name: 'BACK', cut: coat ? 'CUT 2' : 'CUT 1 ON FOLD', fold: coat ? null : [0, 12, 0, Lw - (shirt ? 70 : 0)],
        grain: [80, 80, 80, Lw - 80], notches: [[146, 92, 2]], label: [86, Lw / 2], lines: coat ? 'M0 330L14 340V470' : shirt ? 'M14 10V60M24 10V60' : puff ? 'M0 70H150M0 130H150M0 190H150M0 250H150' : null });
      if (shirt) add({ d: 'M0 0L40 0L150 18L152 52L0 60Z', at: [294, 70], name: 'YOKE', cut: 'CUT 2 ON FOLD', fold: [0, 0, 0, 60], grain: [30, 30, 130, 30], label: [80, 46] });
      add({ d: sleeveP({ w: 244, l: coat ? 330 : 300, cw: coat ? 150 : 124, cap: 34 }), at: [486, 70], name: 'SLEEVE', cut: 'CUT 2', grain: [122, 50, 122, coat ? 300 : 270], notches: [[122, 0], [44, 15], [200, 15, 2]], label: [122, 170],
        lines: shirt ? 'M84 300V230' : puff ? 'M10 90H234M20 160H224M30 230H214' : null });
      var yy = coat ? 580 : 470;
      if (puff) {
        add({ d: hoodP(), at: [486, 420], name: 'HOOD', cut: 'CUT 2 + 2 LINING', grain: [70, 40, 70, 170], notches: [[0, 120]], label: [86, 110], lines: 'M20 60C60 40 120 40 150 70M10 120C60 100 130 100 160 130' });
        add({ d: rectP(46, 370, 6), at: [96, 480], name: 'STORM FLAP', cut: 'CUT 2', grain: [23, 30, 23, 340], label: [80, 190], rot: 90, drills: [[23, 70], [23, 150], [23, 230], [23, 310]] });
        add({ d: rectP(120, 40, 8), at: [200, 500], name: 'POCKET FLAP', cut: 'CUT 4', grain: [20, 10, 100, 10], label: [60, 26] });
      } else if (coat) {
        add({ d: 'M0 0C60 -10 140 -10 200 0L190 40C130 32 70 32 10 40Z', at: [486, 440], name: 'UNDER COLLAR', cut: 'CUT 2 · BIAS', grain: [40, 30, 70, 0], label: [100, 24], notches: [[100, 0]] });
        add({ d: 'M0 0L70 0L60 470L20 470L20 120Z', at: [710, 70], name: 'FACING', cut: 'CUT 2', grain: [40, 140, 40, 440], label: [42, 300], rot: 90 });
        add({ d: rectP(124, 128, 12), at: [486, 520], name: 'POCKET', cut: 'CUT 2', grain: [62, 26, 62, 106], label: [62, 70], marks: 'M0 26H124' });
      } else {
        add({ d: collarP(210, 40, 12), at: [486, 420], name: 'COLLAR', cut: 'CUT 2 + 1 INTERLINING', grain: [20, 20, 190, 20], notches: [[210, 20]], label: [110, 68] });
        if (t !== 'bomber') add({ d: 'M0 30C60 22 140 6 210 0L210 26C140 32 70 46 0 52Z', at: [486, 520], name: 'COLLAR STAND', cut: 'CUT 2', grain: [20, 36, 190, 12], notches: [[210, 13]], label: [110, 76] });
        if (shirt || t === 'coach') add({ d: rectP(130, t === 'coach' ? 36 : 56, 4), at: [96, yy + 20], name: 'CUFF', cut: 'CUT 4', grain: [14, 10, 116, 10], label: [65, t === 'coach' ? 24 : 34], drills: [[112, 28]] });
        if (t === 'bomber') {
          add({ d: rectP(250, 70), at: [96, yy + 30], name: 'RIB COLLAR', cut: 'CUT 1 · 1×1 RIB', grain: [14, 10, 14, 60], label: [125, 40], lines: 'M0 35H250' });
          add({ d: rectP(120, 90), at: [96, yy + 140], name: 'RIB CUFF', cut: 'CUT 2', grain: [14, 10, 14, 80], label: [62, 50], lines: 'M0 45H120' });
          add({ d: rectP(160, 100), at: [240, yy + 140], name: 'RIB HEM', cut: 'CUT 1 ON FOLD', fold: [0, 0, 0, 100], grain: [140, 10, 140, 90], label: [80, 54], lines: 'M0 50H160' });
        } else {
          var pk = t === 'workjacket' ? 'M0 0H110V110H0Z' : t === 'overshirt' ? 'M0 0H96V104H0Z' : 'M0 0H86V96L43 108L0 96Z';
          add({ d: pk, at: [270, yy + 30], name: 'POCKET', cut: t === 'workjacket' ? 'CUT 4' : t === 'overshirt' ? 'CUT 2' : 'CUT 1', grain: [43, 20, 43, 86], label: [48, 60], marks: 'M0 18H' + (t === 'workjacket' ? 110 : 96) });
          if (t === 'overshirt') add({ d: 'M0 0H96V30L48 42L0 30Z', at: [270, yy + 170], name: 'FLAP', cut: 'CUT 4', grain: [20, 10, 76, 10], label: [48, 22], drills: [[48, 28]] });
          if (shirt || t === 'workjacket') add({ d: rectP(36, 380), at: [400, 470], name: 'PLACKET', cut: 'CUT 1', grain: [18, 30, 18, 350], label: [60, 190], rot: 90, drills: [[18, 60], [18, 136], [18, 212], [18, 288], [18, 364]] });
        }
      }
      return P;
    }
    if (botT.indexOf(t) >= 0) {
      var sh = t === 'shorts', Lb = sh ? 220 : 470, hemF = sh ? 140 : t === 'trousers' ? 120 : t === 'sweatpants' ? 76 : 104, hemB = hemF + 14;
      var pleat = t === 'trousers' || sh;
      add({ d: trouserF({ l: Lb, hem: hemF }), at: [110, 74], name: 'FRONT', cut: 'CUT 2', grain: [68, 120, 68, Lb - 40], notches: sh ? [[130, 0], [-26, 132]] : [[130, 0], [143, 120], [-26, 132], [128, 300]],
        label: [70, Lb / 2 + 50], lines: (pleat ? 'M64 0L70 70M44 0L48 46' : '') + (t === 'cargo' ? 'M30 300L130 300' : ''), drills: t === 'cargo' ? [[96, 250], [96, 380]] : null,
        marks: pleat ? 'M56 0l8 10l8 -10M38 0l6 8l6 -8' : null });
      add({ d: trouserB({ l: Lb, hem: hemB }), at: [380, 88], name: 'BACK', cut: 'CUT 2', grain: [70, 120, 70, Lb - 40], notches: [[124, 0], [142, 130, 2], [-66, 150, 2]], label: [70, Lb / 2 + 50],
        lines: t === 'jeans' ? 'M-6 60L132 86' : null, drills: t === 'trousers' ? [[40, 80], [100, 86]] : t === 'jeans' || t === 'cargo' || t === 'sweatpants' || sh ? [[50, 120], [104, 126]] : null,
        marks: t === 'trousers' ? 'M56 2L62 70L66 4' : null });
      var yb = sh ? 380 : 620;
      add({ d: rectP(t === 'sweatpants' || sh ? 330 : 440, t === 'sweatpants' || sh ? 56 : 42), at: [80, yb], name: 'WAISTBAND', cut: t === 'sweatpants' || sh ? 'CUT 1 · ELASTIC 4 CM' : 'CUT 1 + INTERLINING', grain: [20, 21, 300, 21], label: [180, -10], notches: [[110, 0], [220, 0], [330, 0]] });
      add({ d: 'M0 0H110L120 150C110 190 20 196 0 160Z', at: [600, yb - 40], name: 'POCKET BAG', cut: 'CUT 4 · LINING', grain: [50, 30, 50, 150], label: [58, 90] });
      if (t === 'cargo') {
        add({ d: rectP(130, 150), at: [80, yb + 90], name: 'CARGO POCKET', cut: 'CUT 2', grain: [65, 20, 65, 130], label: [65, 80], lines: 'M20 0V150M110 0V150' });
        add({ d: rectP(130, 50, 8), at: [240, yb + 90], name: 'FLAP', cut: 'CUT 4', grain: [20, 12, 110, 12], label: [65, 34], drills: [[65, 38]] });
      }
      if (t === 'jeans') {
        add({ d: 'M0 0H96L92 104L48 122L4 104Z', at: [80, yb + 80], name: 'BACK POCKET', cut: 'CUT 2', grain: [48, 20, 48, 100], label: [48, 60] });
        add({ d: 'M0 0L140 30L136 60L0 40Z', at: [210, yb + 80], name: 'YOKE', cut: 'CUT 2', grain: [20, 24, 120, 44], label: [70, 76] });
        add({ d: rectP(30, 150), at: [400, yb + 80], name: 'HAMMER LOOP', cut: 'CUT 1', grain: [15, 14, 15, 136], label: [56, 76], rot: 90 });
      }
      if (t === 'sweatpants') add({ d: rectP(124, 100), at: [80, yb + 90], name: 'RIB CUFF', cut: 'CUT 2 · 2×2 RIB', grain: [14, 12, 14, 88], label: [64, 54], lines: 'M0 50H124' });
      return P;
    }
    if (t === 'cap') {
      var panel = function (w, h) { return 'M0 ' + h + 'C' + (w * 0.05) + ' ' + (h * 0.5) + ' ' + (w * 0.3) + ' ' + (h * 0.12) + ' ' + (w / 2) + ' 0C' + (w * 0.7) + ' ' + (h * 0.12) + ' ' + (w * 0.95) + ' ' + (h * 0.5) + ' ' + w + ' ' + h + 'Q' + (w / 2) + ' ' + (h + 14) + ' 0 ' + h + 'Z'; };
      add({ d: panel(170, 210), at: [80, 90], name: 'FRONT', cut: 'CUT 2 + BUCKRAM', grain: [85, 50, 85, 190], label: [85, 140], notches: [[85, 0]], drills: [[110, 70]] });
      add({ d: panel(150, 200), at: [300, 100], name: 'SIDE', cut: 'CUT 2', grain: [75, 50, 75, 180], label: [75, 140], drills: [[75, 60]] });
      add({ d: panel(150, 196).replace(/Z$/, '') + 'Z', at: [500, 104], name: 'BACK', cut: 'CUT 2', grain: [75, 50, 75, 176], label: [75, 120], lines: 'M40 196Q75 150 110 196' });
      add({ d: 'M0 40C60 76 260 76 320 40C306 150 14 150 0 40Z', at: [90, 400], name: 'BRIM', cut: 'CUT 2 + 1 BOARD', grain: [160, 74, 160, 124], label: [210, 104], notches: [[160, 67]] });
      add({ d: rectP(440, 40), at: [90, 640], name: 'SWEATBAND', cut: 'CUT 1', grain: [20, 20, 420, 20], label: [220, -10] });
      add({ d: rectP(150, 28, 10), at: [90, 740], name: 'STRAP', cut: 'CUT 2', grain: [16, 14, 134, 14], label: [75, -10], drills: [[130, 14]] });
      return P;
    }
    if (t === 'beanie') {
      add({ d: 'M0 520L0 200C0 120 20 70 60 30L120 0L180 30C220 70 240 120 240 200L240 520Z', at: [140, 110], name: 'BODY', cut: 'KNIT 1 · 2×2 RIB', grain: [120, 80, 120, 480], label: [120, 300], notches: [[0, 380], [240, 380]], lines: 'M0 380H240' });
      add({ d: rectP(150, 40, 3), at: [460, 150], name: 'LABEL', cut: 'WOVEN · CUT 1', grain: [20, 20, 130, 20], label: [75, -10] });
      add({ d: 'M0 0H200V60H0Z', at: [460, 260], name: 'CROWN TIE', cut: 'LINKING GUIDE', grain: [20, 30, 180, 30], label: [100, 90], lines: 'M100 0V60' });
      return P;
    }
    if (t === 'tote') {
      add({ d: rectP(300, 340), at: [80, 70], name: 'BODY', cut: 'CUT 2 · CANVAS', grain: [150, 60, 150, 300], label: [150, 190], drills: [[80, 40], [220, 40]], lines: 'M0 40H300' });
      add({ d: rectP(90, 640), at: [440, 70], name: 'GUSSET & BASE', cut: 'CUT 1', grain: [45, 40, 45, 600], label: [96, 320], rot: 90, notches: [[0, 160], [90, 160], [0, 480], [90, 480]] });
      add({ d: rectP(300, 50), at: [80, 450], name: 'FACING', cut: 'CUT 2', grain: [20, 25, 280, 25], label: [150, 30] });
      add({ d: rectP(26, 300, 13), at: [600, 70], name: 'HANDLE', cut: 'CUT 2 · LEATHER', grain: [13, 30, 13, 270], label: [50, 150], rot: 90 });
      add({ d: 'M0 0H40V52L20 62L0 52Z', at: [80, 550], name: 'TAB', cut: 'CUT 4 · LEATHER', grain: [20, 10, 20, 44], label: [80, 34], drills: [[20, 16], [20, 38]] });
      return P;
    }
    if (t === 'crossbody') {
      add({ d: rectP(330, 230, 40), at: [80, 80], name: 'FRONT', cut: 'CUT 1', grain: [165, 40, 165, 190], label: [165, 120], lines: 'M0 110H330' });
      add({ d: rectP(330, 230, 40), at: [80, 360], name: 'BACK', cut: 'CUT 1', grain: [165, 40, 165, 190], label: [165, 120], lines: 'M40 96H290' });
      add({ d: rectP(330, 130, 24), at: [440, 80], name: 'POCKET', cut: 'CUT 1', grain: [165, 30, 165, 110], label: [165, 74] });
      add({ d: rectP(56, 560), at: [470, 260], name: 'GUSSET', cut: 'CUT 1', grain: [28, 30, 28, 530], label: [100, 280], rot: 90, notches: [[0, 280], [56, 280]] });
      add({ d: rectP(40, 70, 4), at: [650, 260], name: 'TAB', cut: 'CUT 2', grain: [20, 10, 20, 60], label: [20, 92], drills: [[20, 50]] });
      return P;
    }
    if (t === 'socks') {
      var sk = 'M0 0H110V350C112 404 146 430 220 440L300 450C340 456 360 476 360 500C360 522 336 536 280 536L48 536C10 536 -10 506 -8 454C-6 420 0 400 0 350Z';
      add({ d: sk, at: [140, 110], name: 'SOCK', cut: 'KNIT 2 · CIRCULAR', grain: [55, 20, 55, 330], label: [56, 220], lines: 'M0 110H110M-2 392C40 420 80 480 96 536M300 450C304 480 298 512 280 536' });
      add({ d: rectP(110, 110), at: [560, 110], name: 'CUFF', cut: 'RIB 2×1', grain: [16, 14, 16, 96], label: [55, 140] });
      return P;
    }
    return P;
  }

  /* ================================================================ render */

  var TYPES = ['tee', 'longsleeve', 'hoodie', 'ziphoodie', 'crewneck', 'sweatpants', 'workjacket', 'bomber', 'puffer', 'coach', 'coat', 'knit', 'cardigan',
    'shirt', 'overshirt', 'trousers', 'jeans', 'cargo', 'shorts', 'cap', 'beanie', 'tote', 'crossbody', 'socks'];
  var CARAMEL = '#C07A42', LEATHER = '#6B4631';
  var TYPE_ACCENT = { jeans: '#C9994F', tote: LEATHER, crossbody: LEATHER, bomber: null };
  var cache = {}, pcache = {};
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function body(type, view, print) {
    var key = type + '|' + view + '|' + (print || '');
    var hit = cache[key];
    if (hit) return hit;
    var fn = G[type] || G.fallback, r;
    r = fn(view, { print: print });
    var s = r.scale || 1, dx = r.dx || 0;
    var ty = n1(500 - s * (r.box[0] + r.box[1]) / 2), tx = n1(400 - s * (400 - dx));
    var svg = '<g transform="' + (s === 1 ? 'translate(' + tx + ' ' + ty + ')' : 'matrix(' + s + ' 0 0 ' + s + ' ' + tx + ' ' + ty + ')') + '">' + r.svg + '</g>';
    // pre-split on colour tokens: even entries are literal markup, odd entries token names
    var parts = [], a = 0, o, c;
    while ((o = svg.indexOf('{', a)) >= 0 && (c = svg.indexOf('}', o)) > o) { parts.push(svg.slice(a, o), svg.slice(o + 1, c)); a = c + 1; }
    parts.push(svg.slice(a));
    hit = { parts: parts };
    cache[key] = hit;
    return hit;
  }

  function render(type, opts) {
    var o = opts || {};
    var t = typeof type === 'string' ? type.toLowerCase().trim() : '';
    if (!G[t] || t === 'fallback') t = 'fallback';
    var view = o.view === 'back' ? 'back' : 'front';
    var print = o.print === 'monogram' || o.print === 'pocket' ? o.print : null;
    var da = t in TYPE_ACCENT ? TYPE_ACCENT[t] : CARAMEL, pk = o.color + '|' + o.accent + '|' + da;
    var p = pcache[pk] || (pcache[pk] = palette(o.color, o.accent, da));
    var b = body(t, view, print), parts = b.parts, inner = '';
    for (var i = 0; i < parts.length; i++) inner += i % 2 ? (p[parts[i]] != null ? p[parts[i]] : '{' + parts[i] + '}') : parts[i];
    var title = o.title != null ? String(o.title) : '';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000"' +
      (o.className ? ' class="' + esc(o.className) + '"' : '') +
      (title ? ' role="img" aria-label="' + esc(title) + '"' : ' aria-hidden="true"') +
      ' stroke-linejoin="round" stroke-linecap="round">' +
      (title ? '<title>' + esc(title) + '</title>' : '') +
      (o.bg && toRgb(o.bg) ? '<rect width="800" height="1000" fill="' + esc(o.bg) + '"/>' : '') +
      inner +
      '</svg>';
    return svg;
  }

  /** data URI with explicit pixel size so <img>/CSS backgrounds get an intrinsic size */
  function uri(svg, w, h) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', '<svg width="' + w + '" height="' + h + '" ')); }
  function dataUri(type, opts) { return uri(render(type, opts), 800, 1000); }

  var api = {
    version: '1.0.0',
    types: TYPES.slice(),
    textures: TEXTURES.slice(),
    render: render,
    dataUri: dataUri,
    swatch: swatch,
    patternPieces: patternPieces,
    pattern: function (type, opts) { return patternPieces(type, opts); },
    swatchUri: function (color, texture, opts) { return uri(swatch(color, texture, opts), 400, 400); },
    patternUri: function (type, opts) { return uri(patternPieces(type, opts), 800, 1000); },
    _palette: palette,
    _reset: function () { cache = {}; pcache = {}; }
  };
  root.ColaGarments = api;
})(typeof window !== 'undefined' ? window : this);
