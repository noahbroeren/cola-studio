/* ==========================================================================
   COLA STUDIO — core/media.js
   Product imagery: uploaded photos when present, otherwise the studio's
   technical-flat illustrations (garments.js) framed per garment type.
   ========================================================================== */
(function () {
  'use strict';
  var Cola = window.Cola;
  var G = function () { return window.ColaGarments; };

  // Per-type framing (viewBox) so every garment fills the 4:5 frame consistently.
  var FRAME = { beanie: [125, 163, 550, 688], bomber: [25, 41, 750, 938], cap: [6, 15, 792, 990], cardigan: [32, 49, 736, 920], cargo: [0, 11, 799, 999], coach: [23, 37, 755, 943], coat: [-1, 9, 802, 1002], crewneck: [32, 49, 736, 920], crossbody: [108, 152, 582, 728], hoodie: [32, 49, 736, 920], jeans: [19, 33, 762, 952], knit: [32, 49, 736, 920], longsleeve: [45, 67, 709, 886], overshirt: [22, 36, 757, 946], puffer: [-14, -9, 828, 1036], shirt: [25, 41, 750, 938], shorts: [157, 201, 486, 608], socks: [111, 146, 578, 722], sweatpants: [24, 39, 752, 940], tee: [25, 41, 750, 938], tote: [68, 79, 672, 840], trousers: [13, 25, 774, 967], workjacket: [18, 32, 764, 955], ziphoodie: [32, 49, 736, 920] };
  // Detail crops (zoomed "macro" shot) — centre point and zoom per family
  var DETAIL = { tee: [400, 330, 2.4], longsleeve: [400, 330, 2.4], crewneck: [400, 320, 2.4], hoodie: [400, 300, 2.2], ziphoodie: [400, 330, 2.2], sweatpants: [400, 230, 2.4], workjacket: [400, 360, 2.2], bomber: [400, 380, 2.2], puffer: [400, 360, 2], coach: [400, 340, 2.2], coat: [400, 330, 2.1], knit: [400, 330, 2.3], cardigan: [400, 380, 2.3], shirt: [400, 330, 2.3], overshirt: [400, 340, 2.2], trousers: [400, 250, 2.3], jeans: [400, 260, 2.3], cargo: [400, 420, 2.2], shorts: [400, 360, 2.2], cap: [400, 470, 1.9], beanie: [400, 560, 2], tote: [400, 420, 1.9], crossbody: [400, 480, 1.9], socks: [400, 320, 2] };

  // ---- colour helpers
  function hex(h) { h = String(h || '#cccccc').replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function toHex(rgb) { return '#' + rgb.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join(''); }
  function mix(a, b, t) { var A = hex(a), B = hex(b); return toHex(A.map(function (v, i) { return v + (B[i] - v) * t; })); }
  function lum(h) { var c = hex(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }

  var media = (Cola.media = {
    mix: mix, lum: lum,
    /** Background tint for a product frame: foam, nudged towards the garment colour. */
    tint: function (color) {
      if (!color) return '#EBE4D9';
      var l = lum(color);
      if (l > 0.6) return mix('#E4DCCF', color, 0.18);
      return mix('#EDE6DB', color, 0.1);
    },
    colorHex: function (p, name) {
      var c = (p.colors || []).find(function (x) { return x.name === name; }) || (p.colors || [])[0];
      if (!c) return '#D9D2C5';
      return Cola.colors ? Cola.colors.resolve(c).hex : c.hex;
    },
    texture: function (p) {
      var s = ((p.subtitle || '') + ' ' + (p.materials || '') + ' ' + (p.name || '')).toLowerCase();
      var rules = [['denim', 'denim'], ['selvedge', 'denim'], ['corduroy', 'corduroy'], ['wale', 'corduroy'], ['waffle', 'waffle'], ['ripstop', 'ripstop'], ['nylon', 'nylon'], ['cordura', 'nylon'],
        ['merino', 'knit'], ['mohair', 'knit'], ['knit', 'knit'], ['rib', 'knit'], ['cashmere', 'wool'], ['wool', 'wool'], ['canvas', 'canvas'], ['duck', 'canvas'], ['twill', 'twill'],
        ['poplin', 'poplin'], ['terry', 'fleece'], ['loopback', 'fleece'], ['fleece', 'fleece'], ['jersey', 'jersey'], ['slub', 'jersey'], ['cotton', 'jersey']];
      for (var i = 0; i < rules.length; i++) if (s.indexOf(rules[i][0]) >= 0) return rules[i][1];
      return 'jersey';
    },

    /** Framed garment illustration (SVG string). */
    garment: function (type, opts) {
      opts = opts || {};
      if (!G()) return '<svg viewBox="0 0 800 1000"></svg>';
      var svg = G().render(type, { color: opts.color, view: opts.view || 'front', print: opts.print || null, accent: opts.accent, title: opts.title });
      var f = FRAME[type];
      var vb = f ? f.join(' ') : '0 0 800 1000';
      if (opts.detail) {
        var d = DETAIL[type] || [400, 400, 2]; var w = 800 / d[2], h = 1000 / d[2];
        vb = (d[0] - w / 2).toFixed(1) + ' ' + (d[1] - h / 2).toFixed(1) + ' ' + w.toFixed(1) + ' ' + h.toFixed(1);
      }
      return svg.replace(/viewBox="0 0 800 1000"/, 'viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet"');
    },

    /** Main product visual for cards: photo (first matching colour) or illustration. */
    productImage: function (p, opts) {
      opts = opts || {};
      var color = opts.color || ((p.colors || [])[0] || {}).name;
      var imgs = (p.images || []).filter(function (im) { return im && im.url; });
      if (imgs.length) {
        var forColor = imgs.filter(function (im) { return !im.color || im.color === color; });
        var list = forColor.length ? forColor : imgs;
        var im = opts.view === 'back' ? (list[1] || list[0]) : list[0];
        return '<img src="' + Cola.esc(im.url) + '" alt="' + Cola.esc(im.alt || p.name) + '"' + media.fitClass(im.url) + ' loading="lazy" decoding="async">';
      }
      return media.garment(p.garment, { color: media.colorHex(p, color), view: opts.view, print: p.print, title: p.name + (color ? ' — ' + color : '') });
    },
    /** ' class="is-fill"' when a photo is (almost) 4:5, read from Weidian's "_W_H" file names — it may fill the frame. */
    fitClass: function (url) {
      var r = media.photoRatio(url);
      return r && r > 0.765 && r < 0.835 ? ' class="is-fill"' : '';
    },
    /** width / height of a photo when its file name carries it ("…_2560_3838.jpg"), else null. */
    photoRatio: function (url) {
      var s = String(url || '');
      try { s = decodeURIComponent(s); } catch (e) { /* keep as is */ }
      var m = /_(\d{3,5})_(\d{3,5})\.(?:jpe?g|png|webp)/i.exec(s);
      return m ? +m[1] / +m[2] : null;
    },
    hasPhotos: function (p) { return (p.images || []).some(function (im) { return im && im.url; }); },

    /** Gallery items for the product page. Each: { html, caption, kind, bg } */
    gallery: function (p, color) {
      var hexc = media.colorHex(p, color), bg = media.tint(hexc);
      var imgs = (p.images || []).filter(function (im) { return im && im.url; });
      if (imgs.length) {
        var forColor = imgs.filter(function (im) { return !im.color || im.color === color; });
        return (forColor.length ? forColor : imgs).map(function (im, i) {
          return { html: '<img src="' + Cola.esc(im.url) + '" alt="' + Cola.esc(im.alt || p.name) + '"' + media.fitClass(im.url) + ' loading="' + (i ? 'lazy' : 'eager') + '">', caption: im.alt || p.name, kind: 'photo', bg: bg };
        });
      }
      var items = [
        { html: media.garment(p.garment, { color: hexc, view: 'front', print: p.print, title: p.name + ' — front' }), caption: 'Front — ' + color, kind: 'flat', bg: bg },
        { html: media.garment(p.garment, { color: hexc, view: 'back', print: p.print, title: p.name + ' — back' }), caption: 'Back — ' + color, kind: 'flat', bg: bg },
        { html: media.garment(p.garment, { color: hexc, view: 'front', print: p.print, detail: true, title: p.name + ' — detail' }), caption: 'Construction detail', kind: 'detail', bg: bg }
      ];
      return items;
    },

    /** Media for studio update posts (real images, video, or demo illustrations). */
    updateMedia: function (m) {
      var g = G();
      if (!m) return '';
      if (m.type === 'image') return '<img src="' + Cola.esc(m.url) + '" alt="' + Cola.esc(m.caption || 'Studio update image') + '" loading="lazy" decoding="async">';
      if (m.type === 'video') return '<video src="' + Cola.esc(m.url) + '" ' + (m.poster ? 'poster="' + Cola.esc(m.poster) + '" ' : '') + 'controls playsinline preload="none"></video>';
      if (m.type === 'illustration') return media.garment(m.garment, { color: m.color, view: m.view, print: m.print });
      if (m.type === 'swatch' && g) return g.swatch(m.color || '#AE7658', m.texture || 'jersey');
      if (m.type === 'pattern' && g) return g.patternPieces(m.garment || 'tee', { stroke: '#130D0A', accent: '#C07A42' });
      return '';
    },
    updateMediaBg: function (m) {
      if (!m) return '#EBE4D9';
      if (m.type === 'illustration') return media.tint(m.color);
      if (m.type === 'pattern') return '#F1ECE3';
      if (m.type === 'swatch') return m.color || '#EBE4D9';
      return '#1C1410';
    }
  });
})();
