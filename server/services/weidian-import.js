'use strict';
/**
 * "Import from Weidian": Weidian item links → draft products.
 *
 * For every item id the configured provider (public-item or open-api) is asked
 * for the item, the SKU titles are split into colour + size ("黑色;M",
 * "颜色:陶土色;尺码:2XL", "Washed Black / XL"), Chinese colour names go through
 * the alias table and, when a translation provider is configured, titles and
 * remaining colour names are translated in one call per batch. The result is a
 * product draft (status draft, Weidian stock sync on) that the admin shows in a
 * preview and then creates through POST /api/admin/products/bulk.
 */
const { DEFAULT_SIZE_ALIASES, DEFAULT_COLOR_ALIASES } = require('./weidian');
const scrape = require('./weidian-scrape');
const { COLOR_HEX } = require('../../public/assets/js/admin/product-sheet.js');
const { sleep: realSleep } = require('../lib/util');

const CJK = /[㐀-鿿豈-﫿]/;
const SIZE_ORDER = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL', '6XL'];
const SIZE_RE = /^(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|[2-6]X|OS|ONE ?SIZE|FREE ?SIZE|\d{2,3}(?:\s*[/\-–]\s*\d{2,3})?|\d{1,2}(?:\.\d)?|[SML]\/[MLX]{1,2})$/i;
const MEDIA_HOSTS = /(^|\.)geilicdn\.com$/i;

/** Item ids from links, JSON snippets or plain numbers, in order of appearance, deduplicated. */
function extractItemIds(input) {
  const text = Array.isArray(input) ? input.join('\n') : String(input == null ? '' : input);
  const ids = [];
  const add = (id) => id && !ids.includes(id) && ids.push(id);
  const re = /item[_-]?id(?:%3[AD]|%22|["':=\s]|\\u0022)*(\d{6,14})|weidian\.com\/(?:[a-z]+\/)*item[^\d\s]{0,12}(\d{6,14})|(?:^|[\s,;])(\d{8,14})(?=$|[\s,;])/gi;
  let m;
  while ((m = re.exec(text))) add(m[1] || m[2] || m[3]);
  return ids;
}

const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-–—·.]+/g, '');
function alias(value, map) {
  const n = norm(value);
  for (const [k, v] of Object.entries(map || {})) if (norm(k) === n) return String(v);
  return null;
}

/** "M码" → "M", "3XL 定制" → "XXXL", "均码" → "OS"; null when it does not look like a size. */
function sizeToken(raw, sizeAliases) {
  const s = String(raw || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim();
  if (!s) return null;
  const candidates = [s, s.replace(/[码號号]$/, '').trim(), s.split(/\s+/)[0].replace(/[码號号]$/, '')];
  for (const c of candidates) {
    const a = alias(c, sizeAliases);
    if (a) return a;
    if (SIZE_RE.test(c)) {
      const up = c.toUpperCase().replace(/\s+/g, '');
      return /^(ONESIZE|FREESIZE)$/.test(up) ? 'OS' : up.replace(/^([2-6])X$/, '$1XL');
    }
  }
  return null;
}

/** Colour/size dimensions from an attrList (public item JSON), in SKU-title order. */
function attrDims(raw) {
  const queue = [raw];
  let seen = 0;
  while (queue.length && seen++ < 5000) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      if (node.length && node.every((x) => x && typeof x === 'object' && (x.attrTitle || x.attrName || x.name) && Array.isArray(x.attrValues || x.values))) {
        return node.map((x) => {
          const t = String(x.attrTitle || x.attrName || x.name);
          return /颜色|顏色|色|colou?r|款式|style/i.test(t) ? 'color' : /尺码|尺寸|码|size/i.test(t) ? 'size' : null;
        });
      }
      node.forEach((x) => x && typeof x === 'object' && queue.push(x));
    } else if (node && typeof node === 'object') Object.values(node).forEach((x) => x && typeof x === 'object' && queue.push(x));
  }
  return null;
}

/** "黑色;M" → { color: 'Black', size: 'M' } */
function splitSkuTitle(title, { dims, sizeAliases, colorAliases } = {}) {
  const t = String(title || '')
    .replace(/(颜色分类|颜色|顏色|colou?r|尺码|尺寸|码数|size)\s*[:：]/gi, '')
    .trim();
  let parts = t
    .split(/[;；|,，]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length === 1) {
    const one = parts[0];
    const spaced = one.split(/\s+\/\s+/);
    const slash = one.split('/');
    const m = /^(.*\S)[\s\-–_]+(\S+)$/.exec(one);
    if (spaced.length === 2) parts = spaced;
    else if (m && sizeToken(m[2], sizeAliases)) parts = [m[1], m[2]];
    else if (slash.length === 2 && sizeToken(slash[1], sizeAliases) && !sizeToken(slash[0], sizeAliases)) parts = slash;
  }
  let color = '';
  let size = '';
  if (dims && dims.length === parts.length && dims.includes('size')) {
    parts.forEach((p, i) => {
      if (dims[i] === 'size') size = sizeToken(p, sizeAliases) || p;
      else color = color ? color + ' ' + p : p;
    });
  } else {
    let idx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (sizeToken(parts[i], sizeAliases)) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) size = sizeToken(parts[idx], sizeAliases);
    color = parts.filter((_, i) => i !== idx).join(' ');
  }
  color = color.trim();
  const named = color ? alias(color, colorAliases) : null;
  return { color: named || color || 'Default', size: size || 'OS', rawColor: color };
}

function sortSizes(list) {
  const rank = (s) => {
    const i = SIZE_ORDER.indexOf(String(s).toUpperCase());
    if (i >= 0) return i;
    const n = parseFloat(s);
    return Number.isFinite(n) ? 100 + n : s === 'OS' ? -1 : 1000;
  };
  return list.slice().sort((a, b) => rank(a) - rank(b));
}

const CATEGORY_RULES = [
  ['hoodies', /卫衣|连帽|卫裤|hoodie|sweatshirt|crewneck|sweatpant|jogger/i],
  ['outerwear', /外套|夹克|棉服|羽绒|风衣|大衣|马甲|jacket|coat|parka|puffer|bomber|vest|gilet/i],
  ['knitwear', /针织|毛衣|开衫|羊毛衫|knit|sweater|cardigan/i],
  ['shirts', /衬衫|shirt(?!.*t-?shirt)/i],
  ['tees', /t恤|短袖|长袖|背心|tee\b|t-shirt|top\b|tank/i],
  ['trousers', /裤|jeans|trouser|pants|shorts|denim/i],
  ['accessories', /帽|包|袜|围巾|腰带|手套|cap\b|hat\b|beanie|bag|tote|sock|scarf|belt|glove/i],
];
const GARMENT_RULES = [
  ['ziphoodie', /拉链.*(卫衣|连帽)|zip.*hood/i],
  ['hoodie', /连帽|hoodie/i],
  ['sweatpants', /卫裤|sweatpant|jogger/i],
  ['crewneck', /卫衣|crewneck|sweatshirt/i],
  ['puffer', /羽绒|棉服|puffer|down jacket/i],
  ['bomber', /飞行|bomber/i],
  ['coach', /教练|coach/i],
  ['coat', /大衣|风衣|coat/i],
  ['workjacket', /夹克|外套|jacket/i],
  ['cardigan', /开衫|cardigan/i],
  ['knit', /针织|毛衣|knit|sweater/i],
  ['overshirt', /衬衫外套|overshirt/i],
  ['shirt', /衬衫|shirt(?!.*t-?shirt)/i],
  ['longsleeve', /长袖|long ?sleeve/i],
  ['tee', /t恤|短袖|tee\b|t-shirt/i],
  ['jeans', /牛仔裤|jeans|denim/i],
  ['cargo', /工装裤|cargo/i],
  ['shorts', /短裤|shorts/i],
  ['trousers', /裤|trouser|pants/i],
  ['beanie', /毛线帽|针织帽|beanie/i],
  ['cap', /帽|cap\b|hat\b/i],
  ['crossbody', /斜挎|crossbody|shoulder bag/i],
  ['tote', /包|tote|bag/i],
  ['socks', /袜|sock/i],
];
const DEFAULT_GARMENT = { outerwear: 'workjacket', hoodies: 'hoodie', tees: 'tee', knitwear: 'knit', shirts: 'shirt', trousers: 'trousers', accessories: 'cap' };
function guess(rules, text) {
  for (const [id, re] of rules) if (re.test(text)) return id;
  return '';
}

function cleanTitle(t) {
  return String(t || '')
    .replace(/【[^】]*】|\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const proxied = (url) => {
  try {
    const u = new URL(String(url).startsWith('//') ? 'https:' + url : url);
    return MEDIA_HOSTS.test(u.hostname) ? '/media/img?u=' + encodeURIComponent(u.href) : u.href;
  } catch {
    return '';
  }
};

/** Normalised item (parseItemResponse) + raw JSON → draft product input. */
function draftFromItem(item, raw, { itemId, cfg = {}, categories = [] } = {}) {
  const sizeAliases = { ...DEFAULT_SIZE_ALIASES, ...(cfg.sizeAliases || {}) };
  const colorAliases = { ...DEFAULT_COLOR_ALIASES, ...(cfg.colorAliases || {}) };
  const dims = attrDims(raw);
  const notes = [];
  const skus = (item.skus || []).map((s) => ({ ...s, ...(s.color || s.size ? { color: alias(s.color, colorAliases) || s.color || 'Default', size: sizeToken(s.size, sizeAliases) || s.size || 'OS', rawColor: s.color } : splitSkuTitle(s.title, { dims, sizeAliases, colorAliases })) }));
  const colors = [];
  for (const s of skus) if (!colors.some((c) => c.toLowerCase() === s.color.toLowerCase())) colors.push(s.color);
  let sizes = [];
  for (const s of skus) if (!sizes.includes(s.size)) sizes.push(s.size);
  sizes = sortSizes(sizes);
  if (!colors.length) colors.push('Default');
  if (!sizes.length) sizes.push('OS');
  const variants = [];
  for (const c of colors) {
    for (const z of sizes) {
      const hits = skus.filter((s) => s.color.toLowerCase() === c.toLowerCase() && s.size === z);
      variants.push({
        color: c,
        size: z,
        stock: hits.reduce((n, s) => n + (Number(s.stock) || 0), 0),
        preorder: false,
        weidianSkuId: hits.length === 1 && hits[0].skuId ? String(hits[0].skuId) : '',
      });
      if (hits.length > 1) notes.push(`${c} / ${z} appears ${hits.length}× on Weidian — stock added up`);
    }
  }
  const prices = skus.map((s) => Number(s.price)).filter((n) => Number.isFinite(n) && n > 0);
  const price = item.price != null && item.price > 0 ? item.price : prices.length ? Math.min(...prices) : 0;
  if (!price) notes.push('No price found — fill it in before publishing');
  if (prices.length && Math.max(...prices) > Math.min(...prices)) notes.push(`Weidian prices differ per size/colour (${Math.min(...prices)}–${Math.max(...prices)} CNY); the lowest is used`);
  const title = cleanTitle(item.title) || `Weidian item ${itemId}`;
  const text = `${item.title || ''}`;
  const catIds = new Set(categories.map((c) => c.id));
  let category = guess(CATEGORY_RULES, text);
  if (category && catIds.size && !catIds.has(category)) category = '';
  const garment = guess(GARMENT_RULES, text) || DEFAULT_GARMENT[category] || 'tee';
  // Gallery first, then one photo per colour (tagged with the colour so the site can switch photos).
  const images = [...new Set((item.images || []).map(proxied).filter(Boolean))].slice(0, 12).map((url) => ({ url, alt: '', color: '' }));
  const colorImgs = item.colorImages || {};
  for (const s of skus) {
    const src = colorImgs[s.rawColor] || colorImgs[s.title];
    const url = src && proxied(src);
    if (url && !images.some((im) => im.url === url && (!im.color || im.color === s.color))) {
      const same = images.find((im) => im.url === url);
      if (same) same.color = same.color || '';
      else images.push({ url, alt: '', color: s.color });
    }
  }
  const detailImages = [...new Set((item.descImages || []).map(proxied).filter(Boolean))].slice(0, 30).map((url) => ({ url }));
  const description = cleanDescription(item.description);
  return {
    draft: {
      name: title,
      status: 'draft',
      category,
      price: Math.round(price * 100) / 100,
      colors: colors.map((name) => ({ name, hex: COLOR_HEX[name.toLowerCase()] || '#9A948E' })),
      sizes,
      variants,
      images,
      detailImages,
      garment,
      description,
      // url stays empty: the site builds the link from the item id (Settings → Weidian link template)
      weidian: { itemId: String(itemId), url: '', syncEnabled: true, syncInfo: false, title: item.title || '', lastSyncedAt: null },
      tags: [],
    },
    notes,
    original: { title: item.title || '', colors: skus.map((s) => s.rawColor || s.color) },
    // Original CDN URLs (not proxied) for the size-chart reader.
    visionCandidates: [...(item.descImages || []), ...(item.images || []).slice(1)],
  };
}

/** Seller description → tidy paragraphs (drops empty lines, repeated lines and pure decoration). */
function cleanDescription(text) {
  const seen = new Set();
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((l) => l.replace(/[\s\u3000]+/g, ' ').trim())
    .filter((l) => l && !/^[-—_=*~·•.。、,，!！?？❤♡★☆✨🔥\s]+$/.test(l) && !seen.has(l) && seen.add(l))
    .slice(0, 40)
    .join('\n')
    .slice(0, 4000);
}

function friendlyError(err) {
  const m = String((err && err.message) || err);
  if (/HTTP 404/.test(m)) return 'Not found on Weidian — check the link (the item may be removed or hidden).';
  if (/HTTP (403|429)/.test(m)) return 'Weidian refused the request (' + m.slice(0, 60) + '). Try again later, or set a scraping service under Integrations → Weidian.';
  if (/timeout|aborted/i.test(m)) return 'Weidian did not answer in time — try again.';
  return m;
}

/**
 * Fetch + draft a batch of items. → { results: [{ itemId, ok, draft?, notes, error?, existing? }], translated }
 */
async function importItems({ ids, weidian, translator, cfg = {}, products = [], categories = [], translate = true, sizeChart = true, sleep = realSleep }) {
  const results = [];
  const claude = translator && translator.claudeConfig ? translator.claudeConfig() : null;
  for (let i = 0; i < ids.length; i++) {
    const itemId = ids[i];
    const existing = products.find((p) => String((p.weidian && p.weidian.itemId) || '') === String(itemId));
    if (existing) {
      results.push({ itemId, ok: true, skipped: true, existing: { id: existing.id, name: existing.name }, notes: [] });
      continue;
    }
    try {
      if (i > 0 && cfg.delayMs) await sleep(Math.min(Number(cfg.delayMs) || 0, 5000));
      let got;
      if (cfg.provider === 'open-api') got = { ...(await weidian.fetchItem(itemId, cfg)), sources: { skus: 'open-api' }, notes: [] };
      else got = await scrape.fetchFullItem(weidian, itemId, { cfg, claude: cfg.claudeFetch === false ? null : claude });
      const { item, json } = got;
      if (!item || !(item.skus || []).length) throw new Error('Weidian returned no colours/sizes for this item');
      const r = draftFromItem(item, json, { itemId, cfg, categories });
      results.push({ itemId, ok: true, draft: r.draft, notes: [...r.notes, ...(got.notes || [])], original: r.original, sources: got.sources, visionCandidates: r.visionCandidates });
    } catch (err) {
      results.push({ itemId, ok: false, error: friendlyError(err), notes: [] });
    }
  }

  // Translate titles + Chinese colour names in one call.
  let translated = false;
  const drafts = results.filter((r) => r.draft);
  const lines = [];
  const refs = [];
  for (const r of drafts) {
    if (CJK.test(r.draft.name)) {
      refs.push({ r, kind: 'name' });
      lines.push(r.draft.name);
    }
    r.draft.colors.forEach((c, i) => {
      if (CJK.test(c.name)) {
        refs.push({ r, kind: 'color', i });
        lines.push(c.name);
      }
    });
  }
  if (lines.length && translate && translator && translator.translateLines) {
    try {
      const out = await translator.translateLines(lines, { kind: 'fashion product titles and colour names' });
      if (out) {
        translated = true;
        refs.forEach((ref, k) => {
          const v = out[k];
          if (!v) return;
          if (ref.kind === 'name') ref.r.draft.name = v;
          else {
            const c = ref.r.draft.colors[ref.i];
            const old = c.name;
            c.name = v;
            c.hex = COLOR_HEX[v.toLowerCase()] || c.hex;
            ref.r.draft.variants.forEach((x) => x.color === old && (x.color = v));
            (ref.r.draft.images || []).forEach((x) => x.color === old && (x.color = v));
          }
        });
      }
    } catch (err) {
      for (const r of drafts) r.notes.push(`Translation failed (${err.message}) — Chinese text kept`);
    }
  }
  // Descriptions: one call per product (they are longer), Chinese paragraphs only.
  if (translate && translator && translator.translateLines) {
    for (const r of drafts) {
      const paras = r.draft.description ? r.draft.description.split('\n') : [];
      if (!paras.some((x) => CJK.test(x))) continue;
      try {
        const out = await translator.translateLines(paras, { kind: 'product description lines', prose: true });
        if (out) r.draft.description = out.filter((x) => x && x.trim()).join('\n');
        else r.notes.push('Description is in Chinese — add a translation key to translate it');
      } catch (err) {
        r.notes.push(`Description not translated (${err.message.slice(0, 80)})`);
      }
    }
  }

  // Size chart: let Claude find and read it among the detail photos.
  const vision = sizeChart && translator && translator.readSizeChart && translator.claudeConfig && translator.claudeConfig();
  for (const r of drafts) {
    r.sizeChart = false;
    if (!vision || !(r.visionCandidates || []).length) continue;
    try {
      const imgs = await scrape.downloadForVision(weidian.fetch, r.visionCandidates.slice(0, 16), { max: 10 });
      const chart = imgs.length ? await translator.readSizeChart(imgs, { title: r.original.title, sizes: r.draft.sizes }) : null;
      if (!chart) continue;
      const sizeAliases = { ...DEFAULT_SIZE_ALIASES, ...(cfg.sizeAliases || {}) };
      const url = proxied(imgs[chart.index].url);
      r.draft.sizeChartImage = url;
      r.draft.detailImages = [{ url }, ...(r.draft.detailImages || []).filter((x) => x.url !== url)];
      const rows = chart.rows.map((row) => ({ size: sizeToken(row.size, sizeAliases) || row.size, values: row.values }));
      const ours = rows.filter((row) => r.draft.sizes.includes(row.size));
      if (chart.columns.length && rows.length) {
        r.draft.measurements = { unit: chart.unit, columns: chart.columns, rows: ours.length ? ours : rows };
        r.sizeChart = true;
        if (!ours.length) r.notes.push('Size chart sizes differ from the Weidian sizes — check the size chart in the editor');
      }
    } catch (err) {
      r.notes.push(`Size chart not read (${String(err.message).slice(0, 80)})`);
    }
  }

  const catIds = new Set(categories.map((c) => c.id));
  for (const r of drafts) {
    // A second guess on the English title when the Chinese one gave nothing.
    if (!r.draft.category && translated) {
      const c = guess(CATEGORY_RULES, r.draft.name);
      if (c && (!catIds.size || catIds.has(c))) r.draft.category = c;
    }
    if (translated && !guess(GARMENT_RULES, r.original.title)) r.draft.garment = guess(GARMENT_RULES, r.draft.name) || DEFAULT_GARMENT[r.draft.category] || r.draft.garment;
    if (CJK.test(r.draft.name)) {
      // Clean URL until the product gets an English name (editor → URL slug → "From name").
      const latin = r.draft.name.replace(/[^\x00-\x7F]+/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      r.draft.slug = (latin ? latin + '-' : 'item-') + r.itemId;
      if (!translated) r.notes.push('Title is in Chinese — add a translation key under Integrations, or rename it in the editor (then click “From name” for a clean URL)');
    }
    const cjkColors = r.draft.colors.filter((c) => CJK.test(c.name)).map((c) => c.name);
    if (cjkColors.length) r.notes.push(`Colour names to translate: ${cjkColors.join(', ')} (or add them as colour aliases)`);
    if (!r.draft.category) r.notes.push('No category recognised — pick one before publishing');
  }
  for (const r of results) delete r.visionCandidates;
  return { results, translated };
}

module.exports = { extractItemIds, splitSkuTitle, sizeToken, attrDims, sortSizes, draftFromItem, importItems, cleanTitle, cleanDescription };
