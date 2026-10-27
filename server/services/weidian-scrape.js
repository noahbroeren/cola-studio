'use strict';
/**
 * Full Weidian product scrape for "Import from Weidian": photo gallery, colour
 * photos, description, the description's detail photos (size chart!) and the
 * SKUs with stock and price.
 *
 * Sources, merged (only the first is required):
 *   1. getItemSkuInfo   SKUs, stock, prices, main photo, colour photos
 *   2. getDetailDesc    the seller's description: text + detail photos
 *   3. the item page    weidian.com/item.html — gallery, title, description
 *
 * Every request is tried directly first, then through the scraping service
 * (Integrations → Weidian → fetchVia) and, for imports only, through Claude's
 * web fetch tool with the studio's own Anthropic key — Anthropic's servers do
 * the request, so it also works when Weidian blocks the host's IP address.
 * The stock sync never uses Claude (it runs every few minutes).
 */
const { parseItemResponse, extractItemInfo, viaService } = require('./weidian');

const SKU_URL = 'https://thor.weidian.com/detail/getItemSkuInfo/1.0?param={param}';
const DESC_URL = 'https://thor.weidian.com/detail/getDetailDesc/1.0?param={param}';
const PAGE_URL = 'https://weidian.com/item.html?itemID={itemId}';
const MAX_GALLERY = 12;
const MAX_DETAIL = 30;

/* ---------------------------------------------------------------- images */

/** Normalise a Weidian CDN image URL: https, no resize query, no ".webp" twin. '' when unusable. */
function cleanImageUrl(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
  if (s.startsWith('//')) s = 'https:' + s;
  if (!/^https?:\/\//i.test(s)) return '';
  let url;
  try {
    url = new URL(s);
  } catch {
    return '';
  }
  if (!/(^|\.)geilicdn\.com$/i.test(url.hostname)) return /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url.href) ? url.href : '';
  if (/^(s|assets|h5)\.geilicdn\.com$/i.test(url.hostname)) return ''; // scripts, styles, UI sprites
  url.protocol = 'https:';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\.(jpe?g|png|gif)\.webp$/i, '.$1');
  return /\.(jpe?g|png|webp|gif)$/i.test(url.pathname) ? url.href : '';
}

/** Weidian file names carry the pixel size: "…_1080_1620.jpg" → { w: 1080, h: 1620 }. */
function imageDims(u) {
  const m = /_(\d{2,5})_(\d{2,5})(?:_unadjust)?\.(?:jpe?g|png|webp|gif)$/i.exec(String(u || '').split('?')[0]);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}
const isIcon = (u) => {
  const d = imageDims(u);
  return !!d && d.w < 260 && d.h < 260;
};
/** The seller id inside a file name ("weidian1790815530-…", "bj-vshop-973365404-…"), to drop other shops' pictures. */
function sellerOf(u) {
  const m = /\/(?:weidian|[a-z]+-(?:vshop|pc|wd|item)-)(\d{6,12})[-_]/i.exec(String(u || ''));
  return m ? m[1] : '';
}

const IMG_RE = /(?:https?:)?(?:\\?\/){2}[a-z0-9.-]*geilicdn\.com(?:\\?\/)[^"'\s<>()\\]+?\.(?:jpe?g|png|webp|gif)(?:\.webp)?/gi;

/** Every Weidian image URL in a JSON value or a piece of text, in order, without duplicates or icons. */
function collectImages(value) {
  const text = (typeof value === 'string' ? value : JSON.stringify(value === undefined ? '' : value)).replace(/\\u002F/gi, '/');
  const out = [];
  for (const m of text.matchAll(IMG_RE)) {
    const u = cleanImageUrl(m[0].replace(/\\\//g, '/'));
    if (u && !isIcon(u) && !out.includes(u)) out.push(u);
  }
  return out;
}

const uniq = (list) => [...new Set(list.filter(Boolean))];

/* ------------------------------------------------------------- parsing */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function statusError(json) {
  const s = json && json.status;
  if (!isObj(s)) return null;
  const code = s.code ?? s.status_code;
  if (code === undefined || code === null || Number(code) === 0) return null;
  return `Weidian error ${code}: ${s.message || s.status_reason || s.description || 'unknown'}`;
}

function parseJsonText(text) {
  const s = String(text || '')
    .trim()
    .replace(/^[\w$.]+\(([\s\S]*)\);?$/, '$1');
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`not JSON (${s.slice(0, 80).replace(/\s+/g, ' ')}…)`);
  }
}

const TEXT_KEYS = /^(text|content|desc|description|itemDesc|item_desc|detail)$/i;

/** getDetailDesc → { text, images } (tolerant: walks the whole JSON). */
function parseDetailDesc(json) {
  const err = statusError(json);
  if (err) throw new Error(err);
  const texts = [];
  const walk = (node, key, depth) => {
    if (depth > 12 || node == null) return;
    if (typeof node === 'string') {
      const t = node.trim();
      if (key && TEXT_KEYS.test(key) && t.length > 1 && !/^(https?:)?\/\//.test(t) && !/^[\w.-]+\.(jpe?g|png|webp|gif)$/i.test(t)) {
        const plain = t
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .trim();
        if (plain && !texts.includes(plain)) texts.push(plain);
      }
      return;
    }
    if (Array.isArray(node)) return node.forEach((n) => walk(n, key, depth + 1));
    if (isObj(node)) for (const [k, v] of Object.entries(node)) if (k !== 'status') walk(v, k, depth + 1);
  };
  walk(json && json.result !== undefined ? json.result : json, '', 0);
  return { text: texts.join('\n').trim(), images: collectImages(json && json.result !== undefined ? json.result : json) };
}

/** JSON objects assigned or passed inside a <script> ("window.x = {…}", "init({…})"). */
function jsonBlobs(code, limit = 40) {
  const out = [];
  const starts = [];
  const re = /(?:=|\(|^)\s*\{/g;
  let m;
  while ((m = re.exec(code)) && starts.length < limit) starts.push(m.index + m[0].lastIndexOf('{'));
  for (const start of starts) {
    let depth = 0;
    let inStr = null;
    let end = -1;
    for (let i = start; i < code.length && i - start < 3_000_000; i++) {
      const c = code[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") inStr = c;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) continue;
    try {
      const v = JSON.parse(code.slice(start, end + 1));
      if (isObj(v)) out.push(v);
    } catch {
      /* not JSON (JS object literal) */
    }
  }
  return out;
}

function decodeAttr(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const GALLERY_KEYS = new Set(['imgs', 'images', 'itemImgs', 'item_imgs', 'pics', 'picList', 'headImgs', 'titles_imgs', 'imgList', 'mainPics', 'itemPics', 'banner', 'bannerImgs']);

/** The longest photo list under a gallery-like key anywhere in a JSON blob. */
function galleryFrom(blob) {
  let best = [];
  const walk = (node, depth) => {
    if (depth > 12 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    for (const [k, v] of Object.entries(node)) {
      if (GALLERY_KEYS.has(k) && Array.isArray(v)) {
        const list = uniq(v.map((x) => cleanImageUrl(typeof x === 'string' ? x : isObj(x) ? x.url || x.img || x.src || x.image || x.picUrl : ''))).filter((u) => !isIcon(u));
        if (list.length > best.length) best = list;
      } else if (v && typeof v === 'object' && !/desc|detail|recommend|similar|shop/i.test(k)) walk(v, depth + 1);
    }
  };
  walk(blob, 0);
  return best;
}

/** Keys whose values describe the item in detail (description blocks). */
const DETAIL_KEY = /desc|detail|graphic|content/i;

/** Item page HTML → { title, description, gallery, detail, all }. */
function parseItemPage(html) {
  const s = String(html || '');
  const meta = (name) => {
    const m = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i').exec(s) || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i').exec(s);
    return m ? decodeAttr(m[1]).trim() : '';
  };
  let title = meta('og:title') || decodeAttr((/<title[^>]*>([^<]*)<\/title>/i.exec(s) || [])[1] || '').trim();
  let description = meta('og:description') || meta('description');
  let gallery = [];
  const detail = [];
  const sources = [];
  for (const m of s.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (/geilicdn|itemId|itemID/.test(m[1])) sources.push(m[1]);
  for (const m of s.matchAll(/data-obj=["']([^"']+)["']/gi)) sources.push('=' + decodeAttr(m[1]));
  for (const code of sources) {
    for (const blob of jsonBlobs(code)) {
      const info = extractItemInfo(blob, 'auto');
      const imgs = galleryFrom(blob);
      if (imgs.length > gallery.length) gallery = imgs;
      if (!title && info.title) title = info.title;
      const walk = (node, depth) => {
        if (depth > 10 || !node || typeof node !== 'object') return;
        for (const [k, v] of Object.entries(node)) {
          if (DETAIL_KEY.test(k) && v && (typeof v === 'object' || typeof v === 'string')) {
            for (const u of collectImages(v)) if (!detail.includes(u)) detail.push(u);
            if (!description && typeof v === 'string' && v.length > 10 && !/^(https?:)?\/\//.test(v)) description = v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          } else if (typeof v === 'object') walk(v, depth + 1);
        }
      };
      walk(blob, 0);
    }
  }
  title = title.replace(/\s*[-_|–—]\s*(微店|weidian).*$/i, '').trim();
  if (/^(微店|weidian)$/i.test(title)) title = '';
  return { title, description, gallery, detail: detail.filter((u) => !gallery.includes(u)), all: collectImages(s) };
}

/** Colour photos from getItemSkuInfo: attrValue / SKU title → image. */
function colorImages(json) {
  const map = {};
  const walk = (node, depth) => {
    if (depth > 12 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    const name = node.attrValue ?? node.attr_value ?? node.title ?? node.skuTitle ?? node.value;
    const img = node.img ?? node.imgUrl ?? node.image ?? node.attrImg ?? node.pic;
    if (typeof name === 'string' && typeof img === 'string') {
      const u = cleanImageUrl(img);
      if (u && !map[name.trim()]) map[name.trim()] = u;
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  walk(json, 0);
  return map;
}

/* --------------------------------------------------------------- fetching */

/**
 * Fetch a URL through Claude's web fetch tool (Anthropic's servers do the
 * request). Returns the fetched text exactly as the tool result carries it.
 */
async function claudeFetch(fetchFn, url, { key, model, timeoutMs = 90000 } = {}) {
  if (!key) throw new Error('no Anthropic key');
  const res = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model || 'claude-sonnet-5-5',
      max_tokens: 64,
      tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 1, max_content_tokens: 60000 }],
      messages: [{ role: 'user', content: `Fetch this URL with the web_fetch tool, then reply with only the word "done".\n\n${url}` }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Anthropic HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(payload.error && payload.error.message) || text.slice(0, 120)}`);
  for (const block of payload.content || []) {
    if (!block || block.type !== 'web_fetch_tool_result') continue;
    const c = block.content || {};
    if (c.type === 'web_fetch_tool_result_error' || c.error_code) throw new Error(`Claude could not fetch it (${c.error_code || 'error'})`);
    const doc = c.content || {};
    const src = doc.source || {};
    if (typeof src.data === 'string') return src.type === 'base64' ? Buffer.from(src.data, 'base64').toString('utf8') : src.data;
  }
  throw new Error('Claude returned no page content');
}

/**
 * GET a Weidian URL: directly → scraping service → Claude (when allowed).
 * `check(text)` validates the body (throw to try the next route).
 * → { text, via, value } (value = what check returned)
 */
async function fetchChain(svc, url, { cfg = {}, claude = null, headers = {}, check = (t) => t } = {}) {
  const routes = [['direct', () => svc.getText(url, headers)]];
  if (cfg.fetchVia) routes.push(['scraping service', () => svc.getText(viaService(cfg.fetchVia, url), headers)]);
  if (claude && claude.key) routes.push(['Claude', () => claudeFetch(svc.fetch, url, claude)]);
  const failed = [];
  for (const [via, run] of routes) {
    try {
      const text = await run();
      const value = check(text);
      return { text, via, value };
    } catch (err) {
      failed.push(`${via}: ${String(err.message || err).slice(0, 160)}`);
    }
  }
  throw new Error(failed.join(' · '));
}

const paramUrl = (tmpl, obj) => tmpl.replace(/\{param\}/g, encodeURIComponent(JSON.stringify(obj)));

/**
 * Scrape one item completely.
 * → { item: { title, price, images, skus, description, descImages, colorImages }, json, sources, notes }
 */
async function fetchFullItem(svc, itemId, { cfg = {}, claude = null } = {}) {
  const id = String(itemId);
  const jsonHeaders = { Referer: 'https://weidian.com/', Origin: 'https://weidian.com' };
  const tmpl = cfg.itemUrlTemplate && /thor\.weidian\.com|\{param\}|\{itemId\}/.test(cfg.itemUrlTemplate) ? cfg.itemUrlTemplate : SKU_URL;
  const skuUrl = tmpl.includes('{param}') ? paramUrl(tmpl, { itemId: id }) : tmpl.replace(/\{itemId\}/g, encodeURIComponent(id));
  const sources = {};
  const notes = [];

  // 1 — SKUs (required)
  const sku = await fetchChain(svc, skuUrl, {
    cfg,
    claude,
    headers: jsonHeaders,
    check: (text) => {
      const json = parseJsonText(text);
      const item = parseItemResponse(json, { priceUnit: cfg.priceUnit || 'auto' });
      if (!item.skus.length && !item.title) throw new Error('no item data in the response');
      return { json, item };
    },
  });
  sources.skus = sku.via;
  const { json, item } = sku.value;
  if (!item.skus.length) return { item, json, sources, notes }; // nothing to import — skip the extra requests

  // 2 + 3 — description and item page, in parallel, both optional
  const [desc, page] = await Promise.allSettled([
    fetchChain(svc, paramUrl(DESC_URL, { vItemId: id }), { cfg, claude, headers: jsonHeaders, check: (text) => parseDetailDesc(parseJsonText(text)) }),
    fetchChain(svc, PAGE_URL.replace('{itemId}', encodeURIComponent(id)), {
      cfg,
      claude,
      headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: 'https://weidian.com/' },
      check: (text) => {
        if (!/geilicdn|itemI[Dd]/.test(text)) throw new Error('page has no product data (blocked or captcha)');
        return parseItemPage(text);
      },
    }),
  ]);
  const d = desc.status === 'fulfilled' ? desc.value.value : null;
  const p = page.status === 'fulfilled' ? page.value.value : null;
  sources.description = d ? `${desc.value.via} · ${d.images.length} photo(s)` : `unavailable (${String(desc.reason && desc.reason.message).slice(0, 200)})`;
  sources.page = p ? `${page.value.via} · ${p.gallery.length} gallery photo(s)` : `unavailable (${String(page.reason && page.reason.message).slice(0, 200)})`;

  // Gallery: the page's photo list, then whatever the SKU JSON had (main photo).
  const skuImages = uniq((item.images || []).map(cleanImageUrl));
  const seller = sellerOf(skuImages[0] || (p && p.gallery[0]) || '');
  let gallery = uniq([...(p ? p.gallery : []), ...skuImages]);
  let detail = uniq([...(d ? d.images : []), ...(p ? p.detail : [])]);
  if (!d && p && !p.detail.length) {
    // No description source: keep this seller's other pictures from the page as detail photos.
    detail = p.all.filter((u) => !gallery.includes(u) && (!seller || sellerOf(u) === seller));
  }
  if (gallery.length <= 1 && p) {
    const extra = p.all.filter((u) => !detail.includes(u) && (!seller || sellerOf(u) === seller) && !isLong(u));
    gallery = uniq([...gallery, ...extra]);
  }
  detail = detail.filter((u) => !gallery.includes(u));
  if (!d && !p) notes.push('Only the stock data could be read from Weidian — no extra photos or description. Add photos in the editor, or set a scraping service / Anthropic key under Integrations.');

  return {
    item: {
      ...item,
      title: item.title || (p && p.title) || null,
      images: gallery.slice(0, MAX_GALLERY),
      description: (d && d.text) || (p && p.description) || '',
      descImages: detail.slice(0, MAX_DETAIL),
      colorImages: colorImages(json),
    },
    json,
    sources,
    notes,
  };
}

function isLong(u) {
  const d = imageDims(u);
  return !!d && d.h > d.w * 2.2;
}

/* ---------------------------------------------------------------- links */

const SHORT_LINK = /https?:\/\/(?:k\.youshop10\.com|youshop10\.com|v\.youshop10\.com|weidian\.com\/s\/|vdian\.com|wd\.youshop10\.com)[^\s"'<>]*/gi;

/** Share links (k.youshop10.com/…) in a piece of text. */
function shortLinks(text) {
  return uniq(String(text || '').match(SHORT_LINK) || []).slice(0, 50);
}

/** Follow a share link to the item page and return the item id ('' when it is not an item). */
async function resolveShortLink(fetchFn, url) {
  const res = await fetchFn(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }, signal: AbortSignal.timeout(15000) });
  const final = res.url || url;
  let m = /item[_-]?id=(\d{6,14})/i.exec(final);
  if (m) return m[1];
  const body = await res.text().catch(() => '');
  m = /item[_-]?id(?:%3[AD]|%22|["':=\s]|\\u0022)*(\d{6,14})/i.exec(body);
  return m ? m[1] : '';
}

/* ------------------------------------------------------- image downloads */

/** Download images for Claude (base64). Skips files that are too large or too tall for the API. */
async function downloadForVision(fetchFn, urls, { max = 10, maxBytes = 3_600_000 } = {}) {
  const out = [];
  for (const url of urls) {
    if (out.length >= max) break;
    const d = imageDims(url);
    if (d && (d.h > 7800 || d.w > 7800)) continue;
    try {
      const res = await fetchFn(url, { headers: { Referer: 'https://weidian.com/', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      const mediaType = /image\/(jpeg|png|gif|webp)/.test(type) ? type : /\.png$/i.test(url) ? 'image/png' : /\.webp$/i.test(url) ? 'image/webp' : 'image/jpeg';
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > maxBytes) continue;
      out.push({ url, mediaType, data: buf.toString('base64') });
    } catch {
      /* skip this one */
    }
  }
  return out;
}

module.exports = {
  cleanImageUrl,
  imageDims,
  collectImages,
  parseDetailDesc,
  parseItemPage,
  colorImages,
  jsonBlobs,
  claudeFetch,
  fetchChain,
  fetchFullItem,
  shortLinks,
  resolveShortLink,
  downloadForVision,
  sellerOf,
  isLong,
};
