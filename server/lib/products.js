'use strict';
/**
 * Product normalisation + validation for admin create/update, and light shape
 * repair for seed data. Unknown fields are preserved (forward compatible with
 * whatever the admin panel adds), computed/underscore fields are dropped.
 */
const { HttpError } = require('./http');
const { isObj, slugify, uniqueSlug, toNumber, toInt, toBool, str, clamp } = require('./util');

const STATUSES = ['published', 'draft', 'archived'];
const COMPUTED_KEYS = new Set(['related', 'availability', 'stockStatus', 'stockSummary', 'totalStock']);

function bad(msg) {
  return new HttpError(400, msg);
}

function strArray(v, { max = 100, maxLen = 2000 } = {}) {
  if (typeof v === 'string') v = v.split(/\r?\n/);
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x == null ? '' : typeof x === 'string' ? x : String(x)).trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, max);
}

/** URLs we accept for images: site-relative, uploads, http(s), data:image. */
function safeUrl(u) {
  const s = str(u, 4000).trim();
  if (!s) return '';
  if (/^(javascript|vbscript|data:(?!image\/))/i.test(s)) return '';
  return s;
}

function normColors(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const c of v) {
    const item = typeof c === 'string' ? { name: c } : isObj(c) ? c : null;
    if (!item) continue;
    const name = str(item.name, 80).trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const hex = str(item.hex, 20).trim();
    out.push({ ...item, name, hex: /^#?[0-9a-f]{3,8}$/i.test(hex) ? (hex.startsWith('#') ? hex : '#' + hex) : '' });
  }
  return out;
}

function normImages(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((img) => (typeof img === 'string' ? { url: img } : isObj(img) ? img : null))
    .filter(Boolean)
    .map((img) => ({ ...img, url: safeUrl(img.url), alt: str(img.alt, 300), color: str(img.color, 80) }))
    .filter((img) => img.url)
    .slice(0, 40);
}

/** "Washed Black" → "WASHED", "Clay" → "CLAY" (used for generated SKUs). */
function code(s, len = 6) {
  const c = String(s || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, len);
  return c || 'X';
}

function idCode(id) {
  // "cs-001" → "CS001"
  return String(id || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

function normVariants(list, productId) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const skus = new Set();
  for (const raw of list) {
    if (!isObj(raw)) continue;
    const color = str(raw.color, 80).trim();
    const size = str(raw.size, 40).trim();
    let sku = str(raw.sku, 80).trim();
    if (!sku) sku = [idCode(productId), color && code(color), size && code(size, 4)].filter(Boolean).join('-');
    let unique = sku;
    for (let i = 2; skus.has(unique.toUpperCase()); i++) unique = `${sku}-${i}`;
    skus.add(unique.toUpperCase());
    const stockNum = toNumber(raw.stock, 0);
    if (stockNum === null) throw bad(`variant ${sku}: stock must be a number`);
    const { sku: _s, color: _c, size: _z, stock: _n, preorder: _p, weidianSkuId: _w, ...extras } = raw; // eslint-disable-line no-unused-vars
    out.push({
      sku: unique,
      color,
      size,
      stock: clamp(Math.trunc(stockNum), 0, 999999),
      preorder: toBool(raw.preorder, false),
      weidianSkuId: str(raw.weidianSkuId, 80).trim(),
      ...extras,
    });
  }
  return out.slice(0, 500);
}

function normMeasurements(m) {
  if (!isObj(m)) return null;
  return {
    ...m,
    unit: str(m.unit || 'cm', 10),
    columns: strArray(m.columns, { max: 20, maxLen: 60 }),
    rows: Array.isArray(m.rows)
      ? m.rows
          .filter(isObj)
          .map((r) => ({ ...r, size: str(r.size, 40), values: Array.isArray(r.values) ? r.values.slice(0, 20) : [] }))
      : [],
  };
}

function isoOrNull(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? String(v) : null;
}

/**
 * Normalise an admin payload into a product.
 * @param {object} input       request body (partial on update → merged onto existing)
 * @param {object} ctx         { existing, products, nextId, now }
 */
function normalizeProduct(input, { existing = null, products = [], nextId, now = new Date().toISOString() } = {}) {
  if (!isObj(input)) throw bad('Product body must be a JSON object');
  const merged = existing ? { ...existing, ...input } : { ...input };

  for (const k of Object.keys(merged)) if (k.startsWith('_') || COMPUTED_KEYS.has(k)) delete merged[k];

  const id = existing ? existing.id : nextId;
  const name = str(merged.name, 200).trim();
  if (!name) throw bad('name is required');

  if (merged.price !== undefined && merged.price !== null && merged.price !== '' && toNumber(merged.price) === null) {
    throw bad('price must be a number');
  }
  if (merged.compareAt != null && merged.compareAt !== '' && toNumber(merged.compareAt) === null) {
    throw bad('compareAt must be a number or null');
  }
  if (merged.status !== undefined && !STATUSES.includes(merged.status)) {
    throw bad(`status must be one of ${STATUSES.join(', ')}`);
  }
  for (const k of ['variants', 'colors', 'sizes', 'images']) {
    if (merged[k] !== undefined && merged[k] !== null && !Array.isArray(merged[k])) throw bad(`${k} must be an array`);
  }

  // Slug: explicit or from name; unique across other products.
  const others = products.filter((p) => p.id !== id);
  const wanted = slugify(merged.slug || name) || slugify(id) || 'product';
  const slug = uniqueSlug(wanted, (s) => others.some((p) => p.slug === s));

  const variants = normVariants(merged.variants || [], id);
  const colors = normColors(merged.colors || []);
  for (const v of variants) {
    if (v.color && !colors.some((c) => c.name.toLowerCase() === v.color.toLowerCase())) colors.push({ name: v.color, hex: '' });
  }
  const sizes = strArray(merged.sizes || [], { max: 40, maxLen: 40 });
  for (const v of variants) if (v.size && !sizes.includes(v.size)) sizes.push(v.size);

  const maxOrder = products.reduce((m, p) => Math.max(m, Number(p.order) || 0), 0);
  const weidianIn = isObj(merged.weidian) ? merged.weidian : {};
  const weidianOld = existing && isObj(existing.weidian) ? existing.weidian : {};

  const compareAt = toNumber(merged.compareAt, null);
  // Canonical key order (DATA_MODEL), unknown extra fields appended afterwards.
  const product = {
    id,
    slug,
    name,
    subtitle: str(merged.subtitle, 300),
    category: str(merged.category, 80),
    collection: str(merged.collection, 120),
    season: str(merged.season, 40),
    price: Math.max(0, toNumber(merged.price, 0)),
    compareAt: compareAt && compareAt > 0 ? compareAt : null,
    status: merged.status || 'draft',
    badges: strArray(merged.badges, { max: 10, maxLen: 30 }),
    featured: toBool(merged.featured, false),
    order: toNumber(merged.order, null) ?? maxOrder + 10,
    garment: str(merged.garment, 60),
    colors,
    sizes,
    variants,
    images: normImages(merged.images || []),
    description: str(merged.description, 20000),
    details: strArray(merged.details),
    materials: str(merged.materials, 2000),
    care: strArray(merged.care),
    fit: str(merged.fit, 2000),
    measurements: normMeasurements(merged.measurements),
    leadTime: str(merged.leadTime, 200),
    restockDate: isoOrNull(merged.restockDate),
    weidian: {
      ...weidianOld,
      ...weidianIn,
      itemId: str(weidianIn.itemId ?? weidianOld.itemId, 40).trim(),
      url: safeUrl(weidianIn.url ?? weidianOld.url),
      syncEnabled: toBool(weidianIn.syncEnabled ?? weidianOld.syncEnabled, false),
      lastSyncedAt: weidianIn.lastSyncedAt ?? weidianOld.lastSyncedAt ?? null,
    },
    agentLinks: isObj(merged.agentLinks)
      ? Object.fromEntries(Object.entries(merged.agentLinks).map(([k, v]) => [str(k, 60), safeUrl(v)]))
      : {},
    tags: strArray(merged.tags, { max: 40, maxLen: 60 }),
    weightKg: toNumber(merged.weightKg, null),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  for (const [k, v] of Object.entries(merged)) if (!(k in product)) product[k] = v;
  return product;
}

/** Light repair for seed/import data — never throws. */
function ensureProductShape(p, index = 0) {
  if (!isObj(p)) return null;
  const id = str(p.id).trim() || `cs-${String(index + 1).padStart(3, '0')}`;
  const variants = Array.isArray(p.variants) ? p.variants.filter(isObj) : [];
  return {
    ...p,
    id,
    slug: slugify(p.slug || p.name || id) || id,
    name: str(p.name || id),
    status: STATUSES.includes(p.status) ? p.status : 'published',
    order: toNumber(p.order, (index + 1) * 10),
    price: toNumber(p.price, 0),
    colors: Array.isArray(p.colors) ? p.colors : [],
    sizes: Array.isArray(p.sizes) ? p.sizes : [],
    images: Array.isArray(p.images) ? p.images : [],
    variants: variants.map((v) => ({ ...v, stock: Math.max(0, toInt(v.stock, 0)), preorder: !!v.preorder })),
    weidian: isObj(p.weidian) ? p.weidian : { itemId: '', url: '', syncEnabled: false, lastSyncedAt: null },
  };
}

/** Next product id "cs-XXX" — never reuses ids (tracks the highest number ever issued). */
function nextProductId(products, seq = 0) {
  let max = Number(seq) || 0;
  for (const p of products) {
    const m = /^cs-(\d+)$/i.exec(p.id || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  const n = max + 1;
  return { id: `cs-${String(n).padStart(3, '0')}`, seq: n };
}

/** Rewrite SKUs for a duplicated product: CS001-CLAY-S → CS007-CLAY-S. */
function remapSku(sku, fromId, toId) {
  const from = idCode(fromId);
  const to = idCode(toId);
  if (from && String(sku).toUpperCase().startsWith(from)) return to + String(sku).slice(from.length);
  return `${sku}-${to}`;
}

module.exports = {
  STATUSES,
  normalizeProduct,
  ensureProductShape,
  nextProductId,
  remapSku,
  normVariants,
  strArray,
  safeUrl,
  idCode,
};
