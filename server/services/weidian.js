'use strict';
/**
 * Weidian product info + stock sync.
 *
 * Providers (private.weidian.provider):
 *   public-item  Weidian's public item-detail JSON (unofficial; default)
 *   open-api     Weidian Open Platform (needs appKey/appSecret)
 *   json-feed    Your own JSON/CSV feed (Google Sheet export, script, …)
 *   mock         Deterministic pseudo-random stock walk (demos/tests)
 *
 * IMPORTANT: the public-item endpoint is not a documented API and its response
 * shape is not guaranteed. The parser below is deliberately tolerant — it
 * searches the whole JSON for SKU-like arrays — but you must verify it against
 * a real response with POST /api/admin/weidian/test before enabling the sync.
 * Likewise, Open Platform method names/versions must be checked in your
 * Weidian developer console.
 *
 * Variant matching order: weidianSkuId → exact sku → colour/size parsed from
 * the SKU title ("颜色;尺码", "Color / Size", "Color-Size"), with configurable
 * sizeAliases / colorAliases.
 */
const { isObj, sleep: realSleep, toInt, sha1 } = require('../lib/util');
const { MOBILE_UA } = require('./media');

const PROVIDERS = ['public-item', 'open-api', 'json-feed', 'mock'];
const DEFAULT_ITEM_URL = 'https://thor.weidian.com/detail/getItemSkuInfo/1.0?param={param}';
const DEFAULT_TOKEN_URL =
  'https://oauth.open.weidian.com/token?grant_type=client_credential&appkey={appKey}&secret={appSecret}';

const DEFAULT_SIZE_ALIASES = {
  均码: 'OS',
  'one size': 'OS',
  onesize: 'OS',
  free: 'OS',
  'free size': 'OS',
  F: 'OS',
  '2XL': 'XXL',
  '3XL': 'XXXL',
  小号: 'S',
  中号: 'M',
  大号: 'L',
  加大: 'XL',
};
const DEFAULT_COLOR_ALIASES = {
  黑色: 'Black',
  黑: 'Black',
  白色: 'White',
  白: 'White',
  灰色: 'Grey',
  深灰: 'Charcoal',
  藏青: 'Navy',
  藏蓝: 'Navy',
  卡其: 'Khaki',
  卡其色: 'Khaki',
  米白: 'Off-White',
  米色: 'Beige',
  杏色: 'Apricot',
  棕色: 'Brown',
  咖啡色: 'Coffee',
  军绿: 'Olive',
  绿色: 'Green',
  蓝色: 'Blue',
  红色: 'Red',
  深灰色: 'Charcoal',
  浅灰: 'Light Grey',
  浅灰色: 'Light Grey',
  灰白: 'Light Grey',
  深蓝: 'Navy',
  深蓝色: 'Navy',
  藏青色: 'Navy',
  藏蓝色: 'Navy',
  浅蓝: 'Sky Blue',
  浅蓝色: 'Sky Blue',
  天蓝色: 'Sky Blue',
  雾蓝: 'Fog Blue',
  牛仔蓝: 'Denim',
  军绿色: 'Olive',
  卡其绿: 'Olive',
  墨绿: 'Forest',
  墨绿色: 'Forest',
  湖水绿: 'Sage',
  奶油白: 'Cream',
  奶白: 'Cream',
  象牙白: 'Ivory',
  杏色系: 'Apricot',
  驼色: 'Camel',
  焦糖色: 'Caramel',
  咖色: 'Brown',
  深棕: 'Chocolate',
  深棕色: 'Chocolate',
  酒红: 'Burgundy',
  酒红色: 'Burgundy',
  粉色: 'Pink',
  粉红色: 'Pink',
  紫色: 'Purple',
  橙色: 'Orange',
  黄色: 'Yellow',
  银色: 'Silver',
  金色: 'Gold',
  香槟色: 'Champagne',
};

/**
 * Optional scraping service for the public-item provider (when Weidian blocks
 * the server's IP): "https://api.scraperapi.com/?api_key=KEY&url={url}" — {url}
 * becomes the encoded Weidian request. Without {url} the encoded URL is appended.
 */
function viaService(template, url) {
  const t = String(template || '').trim();
  if (!t) return url;
  if (!/^https:\/\//i.test(t)) throw new Error('Scraping service URL must start with https://');
  return t.includes('{url}') ? t.replace(/\{url\}/g, encodeURIComponent(url)) : t + encodeURIComponent(url);
}

/* ------------------------------------------------------------------------ */
/* Normalisation helpers                                                      */
/* ------------------------------------------------------------------------ */

const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-–—·.]+/g, '');

function alias(value, aliases) {
  if (value == null) return value;
  const n = norm(value);
  for (const [k, v] of Object.entries(aliases || {})) if (norm(k) === n) return String(v);
  return String(value).trim();
}

const isNumeric = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v));

function toYuan(v, unit = 'auto') {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (unit === 'yuan') return n;
  if (unit === 'cent') return Math.round(n) / 100;
  // auto: decimal strings / non-integers are yuan, integers are cents (Weidian's thor API uses fen)
  if (typeof v === 'string' && v.includes('.')) return n;
  if (!Number.isInteger(n)) return n;
  return n / 100;
}

const pick = (o, keys) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
};

/* ------------------------------------------------------------------------ */
/* Tolerant response parser                                                   */
/* ------------------------------------------------------------------------ */

const STOCK_KEYS = ['stock', 'quantity', 'stockNum', 'stock_num', 'inventory', 'stockCount', 'stock_count', 'num', 'qty'];
const ID_KEYS = ['skuId', 'sku_id', 'skuid', 'id'];
const CODE_KEYS = ['sku_merchant_code', 'merchantCode', 'merchant_code', 'outerId', 'outer_id', 'skuCode', 'sku_code', 'code', 'sku'];
const TITLE_KEYS = ['title', 'skuTitle', 'sku_title', 'skuName', 'sku_name', 'attrTitle', 'attrs', 'attrNames', 'attr_names', 'specName', 'spec', 'propertiesName', 'properties_name', 'name', 'desc'];
const PRICE_KEYS = ['discountPrice', 'discount_price', 'price', 'salePrice', 'sale_price', 'skuPrice', 'sku_price', 'originalPrice', 'origin_price'];
const NESTED_KEYS = ['skuInfo', 'sku_info', 'skuDetail', 'sku_detail', 'info'];

function flattenSku(el) {
  let o = { ...el };
  for (const k of NESTED_KEYS) if (isObj(el[k])) o = { ...o, ...el[k] };
  if (isObj(el.sku)) o = { ...o, ...el.sku };
  return o;
}

function looksLikeSku(el) {
  if (!isObj(el)) return false;
  const o = flattenSku(el);
  const hasStock = STOCK_KEYS.some((k) => isNumeric(o[k]));
  const hasIdent = ID_KEYS.some((k) => o[k] != null && !isObj(o[k])) || TITLE_KEYS.some((k) => typeof o[k] === 'string' || Array.isArray(o[k]));
  return hasStock && hasIdent;
}

/** Find the most SKU-like array anywhere in the JSON. */
function findSkuArray(json) {
  let best = null;
  const seen = new Set();
  const walk = (node, key, depth) => {
    if (!node || typeof node !== 'object' || depth > 12 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const objs = node.filter(isObj);
      const hits = objs.filter(looksLikeSku).length;
      if (hits && hits >= objs.length / 2) {
        const score = hits + (/sku/i.test(key || '') ? 1000 : 0);
        if (!best || score > best.score) best = { score, list: objs.filter(looksLikeSku), key };
      }
      node.forEach((n) => walk(n, key, depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, k, depth + 1);
  };
  walk(json, '', 0);
  return best ? best.list : [];
}

/** attrId → attribute value map from attrList-style structures ({attrTitle, attrValues:[{attrId, attrValue}]}). */
function attrValueMap(json) {
  const map = new Map();
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 10) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    const values = node.attrValues || node.attr_values || node.values;
    if (Array.isArray(values)) {
      for (const v of values) {
        if (!isObj(v)) continue;
        const id = pick(v, ['attrId', 'attr_id', 'id', 'valueId']);
        const val = pick(v, ['attrValue', 'attr_value', 'value', 'name']);
        if (id != null && val != null) map.set(String(id), String(val));
      }
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(json, 0);
  return map;
}

function skuTitle(o, attrMap) {
  const t = pick(o, TITLE_KEYS);
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) {
    return t
      .map((x) => (isObj(x) ? pick(x, ['attrValue', 'value', 'name', 'title']) : x))
      .filter((x) => x != null)
      .join(';');
  }
  const ids = o.attrIds || o.attr_ids || o.attrIdList;
  if (Array.isArray(ids) && attrMap.size) return ids.map((id) => attrMap.get(String(id)) ?? '').filter(Boolean).join(';');
  return '';
}

/** BFS for item-level info (title, price, images) without descending into SKU arrays. */
function extractItemInfo(json, priceUnit) {
  const info = { title: null, price: null, images: [] };
  const queue = [{ node: json, depth: 0 }];
  const TITLE = ['itemTitle', 'item_title', 'itemName', 'item_name'];
  const TITLE_LOOSE = ['title', 'name'];
  const PRICE = ['itemDiscountLowPrice', 'itemLowPrice', 'item_price', 'itemPrice', 'lowPrice', 'discountPrice', 'price'];
  const IMG_LIST = ['imgs', 'images', 'itemImgs', 'item_imgs', 'pics', 'picList', 'headImgs', 'titles_imgs'];
  const IMG_ONE = ['itemMainPic', 'mainPic', 'main_pic', 'thumbImg', 'img', 'image'];
  while (queue.length) {
    const { node, depth } = queue.shift();
    if (!isObj(node) || depth > 4) continue;
    if (looksLikeSku(node)) continue;
    if (!info.title) {
      const t = pick(node, TITLE) ?? (depth > 0 ? pick(node, TITLE_LOOSE) : undefined);
      if (typeof t === 'string' && t.trim().length > 1) info.title = t.trim();
    }
    if (info.price == null) {
      const p = pick(node, PRICE);
      if (isNumeric(p)) info.price = toYuan(p, priceUnit);
    }
    if (!info.images.length) {
      for (const k of IMG_LIST) {
        if (Array.isArray(node[k])) {
          info.images = node[k]
            .map((x) => (typeof x === 'string' ? x : isObj(x) ? pick(x, ['url', 'img', 'src', 'image']) : null))
            .filter((x) => typeof x === 'string' && /^https?:\/\//.test(x));
          if (info.images.length) break;
        }
      }
      if (!info.images.length) {
        const one = pick(node, IMG_ONE);
        if (typeof one === 'string' && /^https?:\/\//.test(one)) info.images = [one];
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (isObj(v)) queue.push({ node: v, depth: depth + 1 });
      else if (Array.isArray(v) && !/sku/i.test(k)) v.filter(isObj).slice(0, 5).forEach((x) => queue.push({ node: x, depth: depth + 1 }));
    }
  }
  return info;
}

/** Detect an error status in Weidian JSON ({status:{code}} / {status:{status_code}}). → message or null */
function responseError(json) {
  const s = json?.status;
  if (!isObj(s)) return null;
  const code = s.code ?? s.status_code;
  if (code === undefined || code === null || Number(code) === 0) return null;
  return `Weidian error ${code}: ${s.message || s.status_reason || s.description || 'unknown'}`;
}

/**
 * Sellers often set "unlimited" stock (999999999). Anything above MAX_STOCK is
 * shown as MAX_STOCK, so the site never displays absurd numbers.
 */
const MAX_STOCK = 999;
function capStock(v) {
  return Math.min(MAX_STOCK, Math.max(0, toInt(v, 0)));
}

/** Normalise any Weidian-ish item JSON. → { title, price, images, skus:[{skuId, sku, title, stock, price}] } */
function parseItemResponse(json, { priceUnit = 'auto' } = {}) {
  const err = responseError(json);
  if (err) throw new Error(err);
  const attrMap = attrValueMap(json);
  const skus = findSkuArray(json).map((el) => {
    const o = flattenSku(el);
    const id = pick(o, ID_KEYS);
    const code = pick(o, CODE_KEYS.filter((k) => k !== 'sku' || typeof o.sku !== 'object'));
    return {
      skuId: id != null && !isObj(id) ? String(id) : '',
      sku: code != null && !isObj(code) ? String(code) : '',
      title: skuTitle(o, attrMap),
      stock: capStock(pick(o, STOCK_KEYS)),
      price: toYuan(pick(o, PRICE_KEYS), priceUnit),
    };
  });
  const r = isObj(json) && isObj(json.result) ? json.result : json;
  const itemStock = isObj(r) ? pick(r, ['itemStock', 'item_stock', 'totalStock', 'stock']) : undefined;
  return { ...extractItemInfo(json, priceUnit), skus, ...(isNumeric(itemStock) ? { stock: capStock(itemStock) } : {}) };
}

/** JSON (array / {rows|items|data|products}) or CSV feed → rows. */
function parseFeed(text) {
  const s = String(text || '').replace(/^﻿/, '').trim();
  let rows;
  if (s.startsWith('[') || s.startsWith('{')) {
    const json = JSON.parse(s);
    rows = Array.isArray(json) ? json : ['rows', 'items', 'data', 'products', 'stock', 'values'].map((k) => json[k]).find(Array.isArray) || [];
  } else {
    rows = parseCsv(s);
  }
  const keyMap = {
    itemid: 'itemId',
    item_id: 'itemId',
    weidianitemid: 'itemId',
    productid: 'productId',
    product_id: 'productId',
    id: 'productId',
    slug: 'slug',
    sku: 'sku',
    weidianskuid: 'weidianSkuId',
    skuid: 'weidianSkuId',
    sku_id: 'weidianSkuId',
    color: 'color',
    colour: 'color',
    kleur: 'color',
    size: 'size',
    maat: 'size',
    stock: 'stock',
    qty: 'stock',
    quantity: 'stock',
    voorraad: 'stock',
    title: 'title',
  };
  return rows
    .filter(isObj)
    .map((r) => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        const key = keyMap[String(k).toLowerCase().replace(/[\s-]+/g, '')] || keyMap[String(k).toLowerCase()];
        if (key && v !== undefined && v !== null && v !== '') out[key] = typeof v === 'string' ? v.trim() : v;
      }
      return out;
    })
    .filter((r) => r.stock !== undefined && isNumeric(r.stock) && (r.itemId || r.productId || r.slug));
}

function parseCsv(text) {
  const lines = [];
  let row = [];
  let field = '';
  let q = false;
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      lines.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    lines.push(row);
  }
  const header = (lines.shift() || []).map((h) => h.trim());
  return lines.filter((l) => l.some((x) => x.trim())).map((l) => Object.fromEntries(header.map((h, i) => [h, (l[i] ?? '').trim()])));
}

/* ------------------------------------------------------------------------ */
/* Matching                                                                   */
/* ------------------------------------------------------------------------ */

function eqLoose(a, b) {
  return a != null && b != null && norm(a) === norm(b) && norm(a) !== '';
}

/** Find a unique variant for a colour/size pair (either may be null). */
function matchByColorSize(variants, color, size, { sizeAliases, colorAliases }) {
  const colors = new Set(variants.map((v) => norm(v.color)));
  const sizes = new Set(variants.map((v) => norm(v.size)));
  const cRaw = color == null || color === '' ? null : String(color).trim();
  const sRaw = size == null || size === '' ? null : String(size).trim();
  if (cRaw == null && sRaw == null) return null;
  const cAli = cRaw == null ? null : alias(cRaw, colorAliases);
  const sAli = sRaw == null ? null : alias(sRaw, sizeAliases);
  const colorOk = (v) => (cRaw == null ? colors.size <= 1 : eqLoose(v.color, cRaw) || eqLoose(v.color, cAli));
  const sizeOk = (v) => (sRaw == null ? sizes.size <= 1 : eqLoose(v.size, sRaw) || eqLoose(v.size, sAli));
  const exact = variants.filter((v) => colorOk(v) && sizeOk(v));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  // Loose colour: "Black" ⊂ "Washed Black" — only when unique.
  if (cAli != null && norm(cAli).length >= 3) {
    const loose = variants.filter((v) => norm(v.color).includes(norm(cAli)) && sizeOk(v));
    if (loose.length === 1) return loose[0];
  }
  return null;
}

/** Parse a SKU title such as "黑色;M", "Washed Black / XL", "Off-White-M", "颜色:黑色;尺码:均码". */
function matchByTitle(variants, title, aliases) {
  const t = String(title || '')
    .replace(/[^;；,，|/]*?[:：]/g, '') // drop "颜色:" / "Size:" prefixes
    .trim();
  if (!t) return null;
  const groups = [
    { re: /\s*[;；|/,，]\s*/, join: ';' },
    { re: /\s*[-–—]\s*/, join: '-' },
    { re: /\s+/, join: ' ' },
  ];
  for (const { re, join } of groups) {
    const tokens = t.split(re).map((x) => x.trim()).filter(Boolean);
    if (tokens.length < 2) continue;
    const tries = [];
    for (let j = 0; j < tokens.length; j++) {
      const rest = tokens.filter((_, i) => i !== j).join(join);
      tries.push([rest, tokens[j]], [tokens[j], rest]);
    }
    for (let i = 0; i < tokens.length; i++) for (let j = 0; j < tokens.length; j++) if (i !== j) tries.push([tokens[i], tokens[j]]);
    for (const [c, s] of tries) {
      const v = matchByColorSize(variants, c, s, aliases);
      if (v) return v;
    }
  }
  return matchByColorSize(variants, null, t, aliases) || matchByColorSize(variants, t, null, aliases);
}

/**
 * Match source SKUs to product variants.
 * → { matches: [{ variant, sku, by }], unmatched: [sku] }
 */
function matchSkus(product, skus, opts = {}) {
  const aliases = {
    sizeAliases: { ...DEFAULT_SIZE_ALIASES, ...(opts.sizeAliases || {}) },
    colorAliases: { ...DEFAULT_COLOR_ALIASES, ...(opts.colorAliases || {}) },
  };
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const used = new Set();
  const matches = [];
  const unmatched = [];
  for (const s of skus) {
    let v = null;
    let by = null;
    if (s.weidianSkuId || s.skuId) {
      const id = String(s.weidianSkuId || s.skuId);
      v = variants.find((x) => x.weidianSkuId && String(x.weidianSkuId) === id);
      if (v) by = 'weidianSkuId';
    }
    if (!v && s.sku) {
      const code = String(s.sku).trim().toLowerCase();
      v = variants.find((x) => String(x.sku || '').trim().toLowerCase() === code);
      if (v) by = 'sku';
    }
    if (!v && (s.color || s.size)) {
      v = matchByColorSize(variants, s.color, s.size, aliases);
      if (v) by = 'color/size';
    }
    if (!v && s.title) {
      v = matchByTitle(variants, s.title, aliases);
      if (v) by = 'title';
    }
    if (v && used.has(v.sku)) {
      unmatched.push({ ...s, reason: `duplicate match for ${v.sku}` });
      continue;
    }
    if (v) {
      used.add(v.sku);
      matches.push({ variant: v, sku: s, by });
    } else unmatched.push({ ...s, reason: 'no matching variant' });
  }
  return { matches, unmatched };
}

/** Deterministic PRNG (mulberry32) seeded from a string. */
function prng(seedStr) {
  let a = parseInt(sha1(seedStr).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------------ */
/* Service                                                                    */
/* ------------------------------------------------------------------------ */

class WeidianService {
  constructor({ getConfig, store, log, fetch: fetchFn = globalThis.fetch, sleep = realSleep, now = () => Date.now(), budgetMs = 0 }) {
    this.budgetMs = budgetMs;
    this.getConfig = getConfig;
    this.store = store;
    this.log = log || { info() {}, warn() {}, error() {} };
    this.fetch = fetchFn;
    this.sleep = sleep;
    this.now = now;
    this.token = null;
    this.running = null;
  }

  get busy() {
    return !!this.running;
  }

  async getText(url, headers = {}) {
    const res = await this.fetch(url, {
      headers: {
        'User-Agent': MOBILE_UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...headers,
      },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}: ${text.slice(0, 200)}`);
    return text;
  }

  async getJson(url, headers) {
    const text = await this.getText(url, headers);
    const s = text.trim().replace(/^[\w$.]+\(([\s\S]*)\);?$/, '$1'); // tolerate JSONP
    try {
      return JSON.parse(s);
    } catch {
      throw new Error(`non-JSON response from ${new URL(url).hostname}: ${text.slice(0, 200)}`);
    }
  }

  /* ---------------------------------------------------- provider: public */

  async fetchPublicItem(itemId, cfg) {
    const param = encodeURIComponent(JSON.stringify({ itemId: String(itemId) }));
    const tmpl = cfg.itemUrlTemplate || DEFAULT_ITEM_URL;
    const url =
      tmpl.includes('{param}') || tmpl.includes('{itemId}')
        ? tmpl.replace(/\{param\}/g, param).replace(/\{itemId\}/g, encodeURIComponent(itemId))
        : tmpl + param;
    const json = await this.getJson(viaService(cfg.fetchVia, url), { Referer: 'https://weidian.com/', Origin: 'https://weidian.com' });
    return { json, item: parseItemResponse(json, { priceUnit: cfg.priceUnit || 'auto' }) };
  }

  /* -------------------------------------------------- provider: open-api */

  async getToken(cfg, { refresh = false } = {}) {
    if (cfg.accessToken) return cfg.accessToken;
    if (!refresh && this.token && this.token.key === cfg.appKey && this.token.expiresAt > this.now() + 60000) return this.token.value;
    if (!cfg.appKey || !cfg.appSecret) throw new Error('Weidian appKey/appSecret are not configured');
    const url = (cfg.tokenUrl || DEFAULT_TOKEN_URL)
      .replace(/\{appKey\}/g, encodeURIComponent(cfg.appKey))
      .replace(/\{appSecret\}/g, encodeURIComponent(cfg.appSecret));
    const json = await this.getJson(url);
    const err = responseError(json);
    if (err) throw new Error(`token: ${err}`);
    const result = json.result || json;
    const value = result.access_token || result.accessToken;
    if (!value) throw new Error('token response had no access_token');
    const ttl = Number(result.expire_in || result.expires_in || 3600);
    this.token = { key: cfg.appKey, value, expiresAt: this.now() + Math.max(60, ttl - 300) * 1000 };
    return value;
  }

  async fetchOpenApiItem(itemId, cfg, retry = true) {
    const token = await this.getToken(cfg);
    const pub = { method: cfg.apiMethod || 'vdian.item.get', access_token: token, version: cfg.apiVersion || '1.0', format: 'json' };
    const url = `${cfg.apiUrl || 'https://api.vdian.com/api'}?param=${encodeURIComponent(
      JSON.stringify({ itemid: String(itemId) })
    )}&public=${encodeURIComponent(JSON.stringify(pub))}`;
    const json = await this.getJson(url);
    const err = responseError(json);
    if (err) {
      if (retry && !cfg.accessToken && /token|10013|10014|10015|10016/i.test(err)) {
        this.token = null;
        return this.fetchOpenApiItem(itemId, cfg, false);
      }
      throw new Error(err);
    }
    return { json, item: parseItemResponse(json, { priceUnit: cfg.priceUnit || 'auto' }) };
  }

  /* ---------------------------------------------------- provider: mock */

  mockItem(product, cfg) {
    const tick = Math.floor(this.now() / (Math.max(1, Number(cfg.intervalMinutes) || 10) * 60000));
    const skus = (product.variants || []).map((v) => {
      const r = prng(`${v.sku}:${tick}`);
      const roll = r();
      let stock = Number(v.stock) || 0;
      if (roll < 0.08) stock = 0; // sells out
      else if (roll < 0.16 && stock === 0) stock = 6 + Math.floor(r() * 15); // restock
      else stock = Math.max(0, stock + [-2, -1, -1, 0, 0, 0, 1, 2][Math.floor(r() * 8)]);
      return { skuId: v.weidianSkuId || '', sku: v.sku, title: [v.color, v.size].filter(Boolean).join(';'), stock: Math.min(stock, 99), price: null };
    });
    return { title: null, price: null, images: [], skus };
  }

  /* ------------------------------------------------------------- items */

  /** Fetch + normalise one item by Weidian item id with the configured provider. */
  async fetchItem(itemId, cfg = this.getConfig() || {}) {
    if (cfg.provider === 'open-api') return this.fetchOpenApiItem(itemId, cfg);
    if (cfg.provider === 'public-item' || !cfg.provider) return this.fetchPublicItem(itemId, cfg);
    throw new Error(`provider "${cfg.provider}" does not fetch single items`);
  }

  async loadFeed(cfg) {
    if (!cfg.feedUrl) throw new Error('feedUrl is not configured');
    return parseFeed(await this.getText(cfg.feedUrl, { Accept: 'application/json, text/csv, text/plain, */*' }));
  }

  /* -------------------------------------------------------------- sync */

  /**
   * @param {object} [o]
   * @param {number} [o.budgetMs]  stop fetching items after this long (serverless time limits);
   *                               the least recently synced products go first, so the
   *                               next run continues where this one stopped.
   */
  async sync({ dryRun = false, productId = null, trigger = 'manual', budgetMs = this.budgetMs } = {}) {
    if (this.running) {
      const err = new Error('A Weidian sync is already running');
      err.status = 409;
      throw err;
    }
    const deadline = budgetMs ? this.now() + budgetMs : 0;
    this.running = this._sync({ dryRun: !!dryRun, productId, trigger, deadline }).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async _sync({ dryRun, productId, trigger, deadline = 0 }) {
    const cfg = this.getConfig() || {};
    const provider = PROVIDERS.includes(cfg.provider) ? cfg.provider : 'public-item';
    const db = this.store.db;
    const opts = { sizeAliases: cfg.sizeAliases, colorAliases: cfg.colorAliases };
    const result = { provider, dryRun, changes: [], infoChanges: [], mappings: [], unmatched: [], errors: [], applied: false, changed: 0, items: 0 };
    const work = []; // [{ product, item }]

    try {
      if (provider === 'json-feed') {
        const rows = await this.loadFeed(cfg);
        const byProduct = new Map();
        for (const row of rows) {
          const product =
            (row.productId && db.products.find((p) => p.id === row.productId)) ||
            (row.slug && db.products.find((p) => p.slug === row.slug)) ||
            (row.itemId && db.products.find((p) => String(p.weidian?.itemId || '') === String(row.itemId))) ||
            null;
          if (!product) {
            result.unmatched.push({ ...row, reason: 'no product for this row' });
            continue;
          }
          if (productId && product.id !== productId) continue;
          if (!byProduct.has(product)) byProduct.set(product, []);
          byProduct.get(product).push({ skuId: row.weidianSkuId || '', sku: row.sku || '', color: row.color, size: row.size, title: row.title || '', stock: Math.max(0, toInt(row.stock, 0)) });
        }
        for (const [product, skus] of byProduct) work.push({ product, item: { skus } });
      } else if (provider === 'mock') {
        const targets = db.products.filter((p) => p.status !== 'archived' && p.variants?.length && (!productId || p.id === productId));
        for (const product of targets) work.push({ product, item: this.mockItem(product, cfg) });
      } else {
        const targets = db.products.filter((p) => p.weidian?.syncEnabled && p.weidian?.itemId && (!productId || p.id === productId));
        if (productId && !targets.length) {
          const p = db.products.find((x) => x.id === productId);
          throw new Error(p ? `${productId} has no Weidian itemId or sync is disabled for it` : `product ${productId} not found`);
        }
        const delay = Math.max(0, Number(cfg.delayMs ?? 1500));
        if (deadline) targets.sort((a, b) => String(a.weidian.lastSyncedAt || '').localeCompare(String(b.weidian.lastSyncedAt || '')));
        for (let i = 0; i < targets.length; i++) {
          const product = targets[i];
          if (deadline && this.now() + delay + 15000 > deadline) {
            result.remaining = targets.length - i;
            this.log.info(`weidian: time budget reached — ${result.remaining} product(s) continue in the next run`);
            break;
          }
          if (i > 0 && delay) await this.sleep(delay); // be polite
          try {
            const { item } = await this.fetchItem(product.weidian.itemId, { ...cfg, provider });
            work.push({ product, item });
          } catch (err) {
            result.errors.push({ productId: product.id, itemId: product.weidian.itemId, error: err.message });
            this.log.warn(`weidian item ${product.weidian.itemId} (${product.id}): ${err.message}`);
          }
        }
      }
    } catch (err) {
      result.errors.push({ error: err.message });
      this.log.warn(`weidian sync failed: ${err.message}`);
    }

    // Diff
    for (const { product, item } of work) {
      result.items++;
      const { matches, unmatched } = matchSkus(product, item.skus || [], opts);
      for (const u of unmatched) result.unmatched.push({ productId: product.id, itemId: product.weidian?.itemId || '', skuId: u.skuId || '', sku: u.sku || '', title: u.title || [u.color, u.size].filter(Boolean).join(' / '), stock: u.stock, reason: u.reason });
      for (const { variant, sku, by } of matches) {
        const to = Math.max(0, toInt(sku.stock, 0));
        const from = Number(variant.stock) || 0;
        if (to !== from) result.changes.push({ productId: product.id, sku: variant.sku, from, to, color: variant.color, size: variant.size, matchedBy: by });
        if (!variant.weidianSkuId && sku.skuId && by !== 'weidianSkuId' && provider !== 'mock') {
          result.mappings.push({ productId: product.id, sku: variant.sku, weidianSkuId: String(sku.skuId) });
        }
      }
      if (product.weidian?.syncInfo) {
        if (item.price != null && item.price > 0 && Number(product.price) !== item.price) {
          result.infoChanges.push({ productId: product.id, field: 'price', from: product.price, to: item.price });
        }
        if (item.images?.length && !(product.images || []).length) {
          result.infoChanges.push({ productId: product.id, field: 'images', from: [], to: item.images.slice(0, 12) });
        }
        if (item.title && product.weidian.title !== item.title) {
          result.infoChanges.push({ productId: product.id, field: 'weidian.title', from: product.weidian.title || null, to: item.title });
        }
      }
    }

    if (!dryRun) {
      const at = new Date(this.now()).toISOString();
      const events = [];
      const touched = new Set();
      for (const c of result.changes) {
        const p = db.products.find((x) => x.id === c.productId);
        const v = p?.variants.find((x) => x.sku === c.sku);
        if (!v) continue;
        v.stock = c.to;
        events.push({ at, productId: p.id, sku: v.sku, from: c.from, to: c.to, source: 'weidian' });
        touched.add(p);
      }
      for (const m of result.mappings) {
        const v = db.products.find((x) => x.id === m.productId)?.variants.find((x) => x.sku === m.sku);
        if (v && !v.weidianSkuId) v.weidianSkuId = m.weidianSkuId;
      }
      for (const ic of result.infoChanges) {
        const p = db.products.find((x) => x.id === ic.productId);
        if (!p) continue;
        if (ic.field === 'price') p.price = ic.to;
        else if (ic.field === 'images') p.images = ic.to.map((url) => ({ url, alt: p.name, color: '' }));
        else if (ic.field === 'weidian.title') p.weidian.title = ic.to;
        touched.add(p);
      }
      for (const { product } of work) {
        product.weidian = { ...(product.weidian || {}), lastSyncedAt: at };
        if (touched.has(product)) product.updatedAt = at;
      }
      this.store.addInventoryEvents(events);
      result.applied = true;
      result.changed = result.changes.length;
      const failedAll = result.errors.length && !result.items;
      db.meta.sync.weidian = {
        at,
        status: failedAll ? 'error' : result.errors.length ? 'partial' : 'ok',
        source: provider,
        message: failedAll
          ? result.errors.map((e) => e.error).join('; ').slice(0, 500)
          : `${result.changes.length} change(s), ${result.unmatched.length} unmatched, ${result.items} item(s)${result.errors.length ? `, ${result.errors.length} error(s)` : ''}`,
        changed: result.changes.length,
        unmatched: result.unmatched.length,
        trigger,
      };
      this.store.save();
      if (result.changes.length) this.log.info(`weidian sync (${provider}): ${result.changes.length} stock change(s) applied`);
    }
    result.ok = !(result.errors.length && !result.items);
    return result;
  }

  /** Raw mapped result for one item (admin "test" button). */
  async test(itemId) {
    const cfg = this.getConfig() || {};
    const provider = PROVIDERS.includes(cfg.provider) ? cfg.provider : 'public-item';
    const db = this.store.db;
    const product = db.products.find((p) => String(p.weidian?.itemId || '') === String(itemId)) || db.products.find((p) => p.id === itemId) || null;
    let item;
    let raw = null;
    if (provider === 'mock') {
      if (!product) throw new Error('mock provider: no product with this Weidian itemId or id');
      item = this.mockItem(product, cfg);
    } else if (provider === 'json-feed') {
      const rows = (await this.loadFeed(cfg)).filter(
        (r) => String(r.itemId || '') === String(itemId) || r.productId === itemId || r.slug === itemId
      );
      item = { title: null, price: null, images: [], skus: rows.map((r) => ({ skuId: r.weidianSkuId || '', sku: r.sku || '', color: r.color, size: r.size, title: r.title || '', stock: toInt(r.stock, 0) })) };
      raw = rows;
    } else {
      const r = await this.fetchItem(itemId, { ...cfg, provider });
      item = r.item;
      raw = r.json;
    }
    const out = { provider, itemId: String(itemId), item, product: product ? { id: product.id, name: product.name } : null };
    if (product) {
      const { matches, unmatched } = matchSkus(product, item.skus, { sizeAliases: cfg.sizeAliases, colorAliases: cfg.colorAliases });
      out.matches = matches.map((m) => ({ skuId: m.sku.skuId, title: m.sku.title, stock: m.sku.stock, variant: m.variant.sku, currentStock: m.variant.stock, matchedBy: m.by }));
      out.unmatched = unmatched;
    }
    if (raw) {
      const json = JSON.stringify(raw);
      out.raw = json.length > 20000 ? `${json.slice(0, 20000)}… (truncated)` : raw;
    }
    return out;
  }
}

module.exports = {
  WeidianService,
  viaService,
  parseItemResponse,
  findSkuArray,
  extractItemInfo,
  parseFeed,
  parseCsv,
  matchSkus,
  matchByTitle,
  matchByColorSize,
  toYuan,
  capStock,
  MAX_STOCK,
  PROVIDERS,
  DEFAULT_SIZE_ALIASES,
  DEFAULT_COLOR_ALIASES,
};
