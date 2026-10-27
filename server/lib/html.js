'use strict';
/**
 * HTML post-processing for server mode:
 *  - runtime marker <meta name="cola-runtime" content="server"> + <base href="/">
 *  - per-product <title>, description, Open Graph, canonical and JSON-LD
 *  - sitemap.xml / robots.txt generation
 */
const { escapeHtml, truncate } = require('./util');
const { productAvailability } = require('./stock');

const RUNTIME_META = '<meta name="cola-runtime" content="server">';
const BASE_TAG = '<base href="/">';

/** Insert `snippet` right after the charset meta (if early in <head>) or right after <head>. */
function insertEarly(html, snippet) {
  const headMatch = /<head(\s[^>]*)?>/i.exec(html);
  if (!headMatch) {
    // No <head>: put it after <html> or at the very top.
    const htmlTag = /<html(\s[^>]*)?>/i.exec(html);
    if (htmlTag) return html.slice(0, htmlTag.index + htmlTag[0].length) + snippet + html.slice(htmlTag.index + htmlTag[0].length);
    return snippet + html;
  }
  const headEnd = headMatch.index + headMatch[0].length;
  const closeHead = html.search(/<\/head>/i);
  const charset = /<meta\s+[^>]*charset\s*=[^>]*>/i.exec(html.slice(headEnd, closeHead > 0 ? closeHead : undefined));
  const at = charset ? headEnd + charset.index + charset[0].length : headEnd;
  return html.slice(0, at) + snippet + html.slice(at);
}

/** Add the runtime marker and <base href="/"> to any HTML document. */
function injectRuntime(html) {
  let out = String(html);
  let snippet = '';
  const metaRe = /<meta\s+[^>]*name\s*=\s*["']cola-runtime["'][^>]*>/i;
  if (metaRe.test(out)) out = out.replace(metaRe, RUNTIME_META);
  else snippet += RUNTIME_META;
  const baseRe = /<base\s[^>]*>/i;
  if (baseRe.test(out)) out = out.replace(baseRe, BASE_TAG);
  else snippet += BASE_TAG;
  return snippet ? insertEarly(out, snippet) : out;
}

function insertBeforeHeadClose(html, snippet) {
  const i = html.search(/<\/head>/i);
  if (i < 0) return insertEarly(html, snippet);
  return html.slice(0, i) + snippet + html.slice(i);
}

/** Replace (or add) a <meta name|property="key" content="…">. */
function setMeta(html, attr, key, content) {
  const tag = `<meta ${attr}="${escapeHtml(key)}" content="${escapeHtml(content)}">`;
  const re = new RegExp(`<meta\\s+[^>]*(?:name|property)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
  return re.test(html) ? html.replace(re, () => tag) : insertBeforeHeadClose(html, tag);
}

function setTitle(html, title) {
  const tag = `<title>${escapeHtml(title)}</title>`;
  return /<title[^>]*>[\s\S]*?<\/title>/i.test(html)
    ? html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, () => tag)
    : insertBeforeHeadClose(html, tag);
}

function setCanonical(html, href) {
  const tag = `<link rel="canonical" href="${escapeHtml(href)}">`;
  const re = /<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*>/i;
  return re.test(html) ? html.replace(re, () => tag) : insertBeforeHeadClose(html, tag);
}

/** JSON for embedding inside <script>: escape </script>, <!-- and line separators. */
function jsonForScript(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function absoluteUrl(siteUrl, url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return siteUrl + (url.startsWith('/') ? url : '/' + url);
}

const SCHEMA_AVAILABILITY = {
  instock: 'https://schema.org/InStock',
  low: 'https://schema.org/LimitedAvailability',
  preorder: 'https://schema.org/PreOrder',
  restocking: 'https://schema.org/BackOrder',
  soldout: 'https://schema.org/OutOfStock',
};

function productDescription(product, settings) {
  const raw = product.description || product.subtitle || settings?.seo?.description || '';
  return truncate(String(raw).replace(/<[^>]+>/g, ' '), 160);
}

function productJsonLd(product, { settings, siteUrl, categories = [] }) {
  const url = `${siteUrl}/products/${encodeURIComponent(product.slug)}`;
  const images = (product.images || []).map((i) => absoluteUrl(siteUrl, i.url)).filter(Boolean);
  const category = categories.find((c) => c.id === product.category);
  const availability = productAvailability(product, settings);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: productDescription(product, settings),
    sku: product.id,
    url,
    brand: { '@type': 'Brand', name: settings?.brand?.name || 'Cola Studio' },
    offers: {
      '@type': 'Offer',
      url,
      price: Number(product.price || 0).toFixed(2),
      priceCurrency: 'CNY',
      availability: SCHEMA_AVAILABILITY[availability] || SCHEMA_AVAILABILITY.soldout,
      itemCondition: 'https://schema.org/NewCondition',
    },
  };
  if (images.length) data.image = images;
  if (category) data.category = category.name;
  if (product.colors?.length) data.color = product.colors.map((c) => c.name).join(', ');
  if (product.materials) data.material = truncate(product.materials, 200);
  return data;
}

/** Inject product-specific SEO into product.html. */
function injectProduct(html, product, { settings, siteUrl, categories }) {
  const brand = settings?.brand?.name || 'Cola Studio';
  const title = `${product.name} — ${brand}`;
  const description = productDescription(product, settings);
  const url = `${siteUrl}/products/${encodeURIComponent(product.slug)}`;
  const image = product.images?.[0]?.url ? absoluteUrl(siteUrl, product.images[0].url) : '';

  let out = setTitle(html, title);
  out = setMeta(out, 'name', 'description', description);
  out = setMeta(out, 'property', 'og:type', 'product');
  out = setMeta(out, 'property', 'og:title', title);
  out = setMeta(out, 'property', 'og:description', description);
  out = setMeta(out, 'property', 'og:url', url);
  if (image) {
    out = setMeta(out, 'property', 'og:image', image);
    out = setMeta(out, 'name', 'twitter:card', 'summary_large_image');
  }
  out = setCanonical(out, url);
  const ld = `<script type="application/ld+json" id="cola-product-jsonld">${jsonForScript(
    productJsonLd(product, { settings, siteUrl, categories })
  )}</script>`;
  return insertBeforeHeadClose(out, ld);
}

const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

function sitemapXml({ siteUrl, pages, products }) {
  const urls = [];
  for (const p of pages) urls.push({ loc: siteUrl + p.path, priority: p.priority, changefreq: p.changefreq });
  for (const p of products) {
    urls.push({
      loc: `${siteUrl}/products/${encodeURIComponent(p.slug)}`,
      lastmod: p.updatedAt && Number.isFinite(Date.parse(p.updatedAt)) ? new Date(p.updatedAt).toISOString().slice(0, 10) : null,
      priority: '0.8',
      changefreq: 'daily',
    });
  }
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${
          u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ''
        }${u.priority ? `<priority>${u.priority}</priority>` : ''}</url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function robotsTxt({ siteUrl }) {
  return ['User-agent: *', 'Disallow: /admin', 'Disallow: /api', 'Allow: /', '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n');
}

/** Version local asset references: assets/…(.js|.css)[?v=x] → ?v=<id> (cache busting per release). */
function versionAssets(html, id) {
  return String(html).replace(/((?:src|href)=["'])((?:\.\.\/|\/)?assets\/[^"'?#]+\.(?:js|css))(?:\?v=[^"'#]*)?(["'])/g, (_, a, file, b) => `${a}${file}?v=${id}${b}`);
}

module.exports = {
  versionAssets,
  injectRuntime,
  injectProduct,
  productJsonLd,
  setMeta,
  setTitle,
  jsonForScript,
  absoluteUrl,
  sitemapXml,
  robotsTxt,
  RUNTIME_META,
  BASE_TAG,
};
