/* ==========================================================================
   COLA STUDIO — core/colors.js
   Colour names → swatch colours. Shared by the storefront (Cola.colors) and
   the server (require), so imports, the admin and the site agree.
   "Brick Red", "Cocoa Brown", "Haze Blue", "Black and White", "黑色", "雾霾蓝"…
   Names that are not colours ("Default", "Original length") give null.
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Cola = root.Cola || {}; root.Cola.colors = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Placeholder older imports stored for "unknown colour". */
  var FALLBACK = '#9A948E';
  /** Neutral used on the site when a variant is not a colour. */
  var NEUTRAL = '#D9D2C5';

  var EN = {
    black: '#161514', jet: '#111111', onyx: '#1B1B1B', ebony: '#2B2522', ink: '#1E1B1A', 'off black': '#262321', 'washed black': '#33302E',
    charcoal: '#3A3A3C', anthracite: '#3B3D3F', graphite: '#55585C', slate: '#5E6670', grey: '#8D8C89', gray: '#8D8C89', ash: '#B5B2AC', smoke: '#9C9A96',
    'heather grey': '#A8A5A0', 'heather gray': '#A8A5A0', heather: '#A8A5A0', 'light grey': '#C9C7C2', 'light gray': '#C9C7C2', 'dark grey': '#4E4D4B', 'dark gray': '#4E4D4B',
    silver: '#B8B9BB', stone: '#C8C0B1', white: '#F4F2EE', snow: '#F7F6F3', milk: '#F3EFE6', 'off white': '#EFEBE3', 'off-white': '#EFEBE3',
    cream: '#EEE6D4', ivory: '#F1EBDD', ecru: '#E8E0CC', bone: '#E6DFD2', oat: '#D9CDB8', oatmeal: '#D9CDB8', sand: '#D1BD9C', beige: '#D8C7A8', nude: '#D9B9A0',
    apricot: '#E8B98F', peach: '#EBB89B', khaki: '#A89A72', taupe: '#8B7D6B', mushroom: '#A39887', camel: '#B9895A', tan: '#C49A6C', caramel: '#B47D4C',
    honey: '#C99A4B', mustard: '#C9A43A', yellow: '#E2C25B', lemon: '#EAD96B', gold: '#C8A951', champagne: '#D8C6A0',
    brown: '#6B4A35', cocoa: '#5C4033', coffee: '#5A3E2E', chocolate: '#4A2F22', espresso: '#3E2B21', mocha: '#7A5A48', walnut: '#5C4430', chestnut: '#6E3B2A',
    rust: '#9A4B2C', brick: '#9C4A3A', terracotta: '#B05E43', clay: '#AE7658', copper: '#B06B3F', orange: '#D9772B', coral: '#E27D68',
    red: '#A8322D', cherry: '#8E1F2B', burgundy: '#6B2230', wine: '#5E1F2B', maroon: '#5A1E24', bordeaux: '#5C1D2A', oxblood: '#4F1C1F',
    pink: '#E5B7B5', rose: '#D9A0A0', blush: '#E9C4BE', fuchsia: '#C2407E', purple: '#5B4470', violet: '#6C4F8C', plum: '#5E3550', lilac: '#BBA8CF', lavender: '#BBA8CF', mauve: '#A38995',
    navy: '#1F2A44', midnight: '#232A38', indigo: '#2C3954', blue: '#3D5A80', cobalt: '#2F4F9A', royal: '#2D4A8A', denim: '#4A6584', sky: '#A9C6DE', 'sky blue': '#A9C6DE',
    'baby blue': '#BCD3E6', 'powder blue': '#B8CCDD', 'ice blue': '#CFDDE6', 'fog blue': '#AFC0CE', 'haze blue': '#8FA3B8', teal: '#2F6B6B', turquoise: '#40A6A0', aqua: '#8CC9C6',
    mint: '#BFD8C6', sage: '#9AA58A', lichen: '#9EA184', pistachio: '#B5C59A', green: '#3F5A40', emerald: '#2E6B4F', forest: '#2E3F33', bottle: '#2C4A3A', pine: '#2F4A3B',
    olive: '#5D6046', army: '#4E5332', military: '#4E5332', moss: '#6B6F45', lake: '#3F6B66', avocado: '#6E7A3A', lime: '#B5C64B', bean: '#8FA383',
    zwart: '#161514', wit: '#F4F2EE', grijs: '#8D8C89', blauw: '#3D5A80', groen: '#3F5A40', bruin: '#6B4A35', rood: '#A8322D'
  };
  var ZH = {
    '黑': '#161514', '白': '#F4F2EE', '米白': '#EFE8DA', '奶白': '#F2EBDC', '乳白': '#F2EBDC', '本白': '#EFE8DA', '奶油': '#EEE6D4', '米色': '#D8C7A8', '燕麦': '#D9CDB8',
    '杏': '#E8B98F', '卡其': '#A89A72', '驼': '#B9895A', '焦糖': '#B47D4C', '咖啡': '#5A3E2E', '咖': '#5A3E2E', '巧克力': '#4A2F22', '棕': '#6B4A35', '褐': '#6B4A35',
    '灰': '#8D8C89', '深灰': '#4E4D4B', '浅灰': '#C9C7C2', '烟灰': '#9C9A96', '花灰': '#A8A5A0', '炭灰': '#3A3A3C', '银': '#B8B9BB', '金': '#C8A951', '香槟': '#D8C6A0',
    '藏青': '#1F2A44', '藏蓝': '#1F2A44', '深蓝': '#1F2A44', '海军蓝': '#1F2A44', '雾霾蓝': '#8FA3B8', '浅蓝': '#A9C6DE', '天蓝': '#A9C6DE', '宝蓝': '#2D4A8A', '牛仔蓝': '#4A6584', '蓝': '#3D5A80',
    '红': '#A8322D', '酒红': '#6B2230', '枣红': '#5A1E24', '砖红': '#9C4A3A', '粉': '#E5B7B5', '紫': '#5B4470',
    '绿': '#3F5A40', '军绿': '#4E5332', '墨绿': '#2C3E33', '橄榄': '#5D6046', '湖绿': '#3F6B66', '豆绿': '#8FA383', '薄荷': '#BFD8C6', '黄': '#E2C25B', '姜黄': '#C9A43A', '橙': '#D9772B'
  };
  var LIGHTER = /\b(light|pale|soft|baby|powder|ice|icy|dusty|dusky|haze|hazy|mist|misty|washed|faded|pastel)\b/;
  var DARKER = /\b(dark|deep|rich)\b/;
  var EN_KEYS = Object.keys(EN).sort(function (a, b) { return b.length - a.length; });
  var ZH_KEYS = Object.keys(ZH).sort(function (a, b) { return b.length - a.length; });

  function rgb(hex) { var h = hex.replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); var n = parseInt(h.slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function hexOf(c) { return '#' + c.map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join('').toUpperCase(); }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return hexOf([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; })); }

  /** Colour words in a piece of text, in order: [{ at, hex, len }] (longest names win). */
  function hits(s) {
    var found = [], taken = [];
    function free(a, b) { for (var i = a; i < b; i++) if (taken[i]) return false; return true; }
    function mark(a, b) { for (var i = a; i < b; i++) taken[i] = true; }
    EN_KEYS.forEach(function (k) {
      var re = new RegExp('(^|[^a-z])' + k.replace(/[-]/g, '[- ]') + '(?=$|[^a-z])', 'g'), m;
      while ((m = re.exec(s))) { var a = m.index + m[1].length, b = a + m[0].length - m[1].length; if (free(a, b)) { mark(a, b); found.push({ at: a, hex: EN[k], len: b - a }); } }
    });
    ZH_KEYS.forEach(function (k) {
      var i = s.indexOf(k);
      while (i >= 0) { if (free(i, i + k.length)) { mark(i, i + k.length); found.push({ at: i, hex: ZH[k], len: k.length }); } i = s.indexOf(k, i + 1); }
    });
    return found.sort(function (a, b) { return a.at - b.at; });
  }

  /** One colour for one name part: adjacent colour words blend ("Brick Red", "Black Grey"); modifiers lighten or darken. */
  function single(part) {
    var h = hits(part);
    if (!h.length) return null;
    var hex = h[0].hex;
    for (var i = 1; i < h.length; i++) hex = mix(hex, h[i].hex, 0.5);
    // modifiers count only outside the matched names ("haze blue" is already light)
    var rest = part;
    h.slice().sort(function (x, y) { return y.at - x.at; }).forEach(function (x) { rest = rest.slice(0, x.at) + ' ' + rest.slice(x.at + x.len); });
    if (LIGHTER.test(rest)) hex = mix(hex, '#FFFFFF', 0.38);
    else if (DARKER.test(rest)) hex = mix(hex, '#000000', 0.3);
    return hex;
  }

  /** Strip notes in brackets: "With Label Black (label-free version …)" → "With Label Black". */
  function label(name) {
    var s = String(name || '').replace(/\s*[（(][^)）]*[)）]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return s || String(name || '').trim();
  }

  /** → { hex, hex2? } or null when the name is not a colour. */
  function infer(name) {
    var s = label(name).toLowerCase().replace(/[_]+/g, ' ');
    if (!s) return null;
    var parts = s.split(/\s*(?:\/|&|\+|,|、|\band\b|\bx\b|拼|撞)\s*/).filter(function (x) { return x && x.trim(); });
    if (parts.length >= 2) {
      var a = single(parts[0]), b = single(parts[parts.length - 1]);
      if (a && b && a !== b) return { hex: a, hex2: b };
      if (a || b) return { hex: a || b };
    }
    var h = hits(s);
    // "黑白" (black-white) without a separator: two tones
    if (h.length === 2 && /[一-鿿]/.test(s) && h[1].at === h[0].at + h[0].len && h[0].hex !== h[1].hex) return { hex: h[0].hex, hex2: h[1].hex };
    var one = single(s);
    return one ? { hex: one } : null;
  }

  function validHex(h) { return typeof h === 'string' && /^#[0-9a-f]{3,8}$/i.test(h.trim()); }

  /**
   * The swatch for a stored colour { name, hex, hex2 }: a hex the owner chose wins;
   * the old placeholder grey or an empty hex is worked out from the name.
   * → { hex, hex2, real } — real=false when the option is not a colour at all.
   */
  function resolve(c) {
    c = c || {};
    var hex = String(c.hex || '').trim();
    if (validHex(hex) && hex.toUpperCase() !== FALLBACK) return { hex: hex, hex2: validHex(c.hex2) ? c.hex2 : '', real: true };
    var f = infer(c.name);
    if (f) return { hex: f.hex, hex2: f.hex2 || '', real: true };
    return { hex: NEUTRAL, hex2: '', real: false };
  }

  /** Colour family of a hex, for filters: Black, White, Grey, Beige, Brown, Red, Pink, Orange, Yellow, Green, Blue, Purple. */
  function familyOf(hex) {
    var c = rgb(hex).map(function (v) { return v / 255; });
    var max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]), l = (max + min) / 2, d = max - min;
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), h = 0;
    if (d) h = max === c[0] ? ((c[1] - c[2]) / d) % 6 : max === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    h = (h * 60 + 360) % 360;
    if (l < 0.17) return 'Black';
    if (l > 0.88 && s < 0.5) return 'White';
    if (s < 0.12) return l > 0.8 ? 'White' : 'Grey';
    if (h >= 8 && h < 38) { if (l > 0.66) return 'Beige'; return s < 0.5 || l < 0.42 ? 'Brown' : 'Orange'; }
    if (h >= 38 && h < 68) { if (s < 0.45) return h > 56 ? 'Green' : l > 0.45 ? 'Beige' : 'Brown'; return l > 0.78 ? 'Beige' : 'Yellow'; }
    if (h < 8 || h >= 345) return l > 0.68 ? 'Pink' : 'Red';
    if (h >= 68 && h < 170) return 'Green';
    if (h >= 170 && h < 255) return 'Blue';
    if (h >= 255 && h < 320) return 'Purple';
    return 'Pink';
  }
  /** Families of a stored colour (two for two-tone colours); [] when it is not a colour. */
  function families(c) {
    var r = resolve(c);
    if (!r.real) return [];
    var out = [familyOf(r.hex)];
    if (r.hex2 && out.indexOf(familyOf(r.hex2)) < 0) out.push(familyOf(r.hex2));
    return out;
  }
  var FAMILY_HEX = { Black: '#161514', White: '#F4F2EE', Grey: '#8D8C89', Beige: '#D8C7A8', Brown: '#6B4A35', Red: '#A8322D', Pink: '#E5B7B5', Orange: '#D9772B', Yellow: '#E2C25B', Green: '#3F5A40', Blue: '#3D5A80', Purple: '#5B4470' };

  return { FALLBACK: FALLBACK, NEUTRAL: NEUTRAL, infer: infer, resolve: resolve, label: label, mix: mix, families: families, FAMILY_HEX: FAMILY_HEX };
});
