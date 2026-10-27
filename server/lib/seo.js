'use strict';
/**
 * Search-engine layer for server mode. For every HTML page it sets:
 *  - <title>, meta description, robots, canonical (absolute, from SITE_URL)
 *  - Open Graph + Twitter cards (page-specific image where possible)
 *  - one JSON-LD @graph: Organization, WebSite (+ search), WebPage, BreadcrumbList
 *    and per page Product / ItemList / FAQPage / Blog / BlogPosting
 *  - server-rendered content inside <!--ssr:name--> … <!--/ssr:name--> markers,
 *    so crawlers and link previews see real text and links before any JavaScript
 *  - pretty internal links (products.html → /products)
 * Page titles and descriptions can be overridden in Admin → Settings → SEO.
 */
const { escapeHtml: esc, truncate } = require('./util');
const { productAvailability } = require('./stock');

/* ------------------------------------------------------------------ pages */

/** Built-in titles and descriptions. {brand} is replaced by the brand name. */
const PAGES = {
  '/': {
    file: 'index.html',
    title: '{brand} — Official Website · International Fashion Studio',
    description: 'Official {brand} website. Shop garments designed and produced in-house, check live stock per size and order worldwide via WhatsApp, Weidian or your agent.',
    type: 'WebPage',
    label: 'Home',
    priority: '1.0',
    changefreq: 'daily',
  },
  '/products': {
    file: 'products.html',
    title: 'Shop the Collection — {brand}',
    description: 'Every {brand} piece in one place, with prices, live stock per size and colour, and worldwide ordering via WhatsApp, Weidian or your agent.',
    type: 'CollectionPage',
    label: 'Shop',
    priority: '0.9',
    changefreq: 'daily',
  },
  '/live-stock': {
    file: 'live-stock.html',
    title: 'Live Stock — Every Size & Colour | {brand}',
    description: 'Real-time stock for every {brand} size and colour, synced with the official Weidian store. See what is in stock, low, on pre-order or restocking.',
    type: 'WebPage',
    label: 'Live stock',
    priority: '0.8',
    changefreq: 'hourly',
  },
  '/updates': {
    file: 'updates.html',
    title: 'Studio Updates — News, Drops & Restocks | {brand}',
    description: 'Production notes, new drops and restocks from the {brand} Weibo, translated into English. Follow what the studio is working on.',
    type: 'CollectionPage',
    label: 'Studio updates',
    priority: '0.8',
    changefreq: 'daily',
  },
  '/how-to-order': {
    file: 'how-to-order.html',
    title: 'How to Order — WhatsApp, Weidian & Agents | {brand}',
    description: 'How to order from {brand}: directly on WhatsApp, in the Weidian store or through your buying agent. Payment, shipping times and every step explained.',
    type: 'WebPage',
    label: 'How to order',
    priority: '0.7',
    changefreq: 'monthly',
  },
  '/about': {
    file: 'about.html',
    title: 'About {brand} — Design, Production & Craftsmanship',
    description: '{brand} is an international fashion studio that designs, patterns and produces its garments in small runs, with obsessive attention to fabric and construction.',
    type: 'AboutPage',
    label: 'About',
    priority: '0.6',
    changefreq: 'monthly',
  },
  '/contact': {
    file: 'contact.html',
    title: 'Contact {brand} — WhatsApp, Email & Socials',
    description: 'Questions about an order, sizing, collaborations or press? Reach {brand} on WhatsApp or by email, or follow the studio on its social channels.',
    type: 'ContactPage',
    label: 'Contact',
    priority: '0.6',
    changefreq: 'monthly',
  },
  '/faq': {
    file: 'faq.html',
    title: 'FAQ — Ordering, Agents, Shipping & Sizing | {brand}',
    description: 'Answers about ordering from {brand}: WhatsApp orders, buying agents, payment, worldwide shipping, sizing, returns and restocks.',
    type: 'FAQPage',
    label: 'FAQ',
    priority: '0.6',
    changefreq: 'monthly',
  },
  '/size-guide': {
    file: 'size-guide.html',
    title: 'Size Guide & Fit Finder — {brand}',
    description: 'Garment measurements for every {brand} fit, how to measure yourself, and a fit finder that suggests your size.',
    type: 'WebPage',
    label: 'Size guide',
    priority: '0.6',
    changefreq: 'monthly',
  },
  '/lookbook': {
    file: 'lookbook.html',
    title: 'Lookbook — {brand}',
    description: 'Complete looks styled from the current {brand} collection.',
    type: 'CollectionPage',
    label: 'Lookbook',
    priority: '0.5',
    changefreq: 'monthly',
  },
  '/brand': {
    file: 'brand.html',
    title: 'Brand & Logo — {brand}',
    description: 'The {brand} mark, its construction, logo variants, colours and typography.',
    type: 'WebPage',
    label: 'Brand',
    priority: '0.3',
    changefreq: 'yearly',
  },
  '/order': {
    file: 'order.html',
    title: 'Your Order — {brand}',
    description: 'Review your order list and send it to the studio in one pre-filled WhatsApp message.',
    type: 'WebPage',
    label: 'Your order',
    noindex: true,
  },
};

/** Pages an owner may retitle in the admin (in this order). */
const EDITABLE_PAGES = ['/', '/products', '/live-stock', '/updates', '/how-to-order', '/about', '/contact', '/faq', '/size-guide', '/lookbook'];

// Earlier seeds shipped these as "default SEO" — treat them as unset so the better built-in copy applies.
const LEGACY_SEO = new Set([
  'Cola Studio — International Fashion Studio',
  'Cola Studio is an international fashion studio focused on design, production and craftsmanship.',
  'Cola Studio designs and produces garments with obsessive attention to construction, fabric and craftsmanship. Live stock, studio updates and worldwide ordering.',
]);

const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const ROBOTS_NOINDEX = 'noindex, follow';

/* ---------------------------------------------------------------- helpers */

const brandOf = (settings) => (settings && settings.brand && settings.brand.name) || 'Cola Studio';
const fill = (tpl, settings) => String(tpl || '').replace(/\{brand\}/g, brandOf(settings));
const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tsOf = (v) => {
  const t = Date.parse(v || '');
  return Number.isFinite(t) ? t : 0;
};
const isoDate = (v) => (tsOf(v) ? new Date(v).toISOString() : undefined);

function abs(siteUrl, url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return 'https:' + url;
  return siteUrl + (url.startsWith('/') ? url : '/' + url);
}

function productUrl(p) {
  return `/products/${encodeURIComponent(p.slug)}`;
}
function updateUrl(u) {
  return `/updates/${encodeURIComponent(u.id)}`;
}

function photos(p) {
  return (p.images || []).filter((im) => im && im.url);
}

function formatCny(n) {
  const v = Math.round(Number(n) || 0);
  return '¥' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Same colour maths as public/assets/js/core/media.js → tint(), so the server
// placeholder frame matches the card the browser renders a moment later.
function hexRgb(h) {
  let s = String(h || '').replace('#', '');
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
function tint(hex) {
  const c = hexRgb(hex);
  if (!c) return '#EBE4D9';
  const lin = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const l = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const [base, t] = l > 0.6 ? ['#E4DCCF', 0.18] : ['#EDE6DB', 0.1];
  const b = hexRgb(base);
  return '#' + b.map((v, i) => Math.round(v + (c[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function socialLinks(settings) {
  const so = (settings && settings.social) || {};
  return Object.values(so)
    .map((v) => String(v || '').trim())
    .filter((v) => /^https?:\/\//i.test(v));
}

/** Title/description for a route: admin override → (home) legacy default fields → built-in. */
function pageText(route, settings) {
  const def = PAGES[route] || {};
  const seo = (settings && settings.seo) || {};
  const over = (seo.pages && seo.pages[route]) || {};
  let title = clean(over.title).slice(0, 120);
  let description = clean(over.description).slice(0, 320);
  if (route === '/') {
    if (!title && seo.title && !LEGACY_SEO.has(seo.title)) title = clean(seo.title);
    if (!description && seo.description && !LEGACY_SEO.has(seo.description)) description = clean(seo.description);
  }
  return {
    title: fill(title || def.title || '{brand}', settings),
    description: truncate(fill(description || def.description || '', settings), 170),
  };
}

/* ------------------------------------------------------------ head editing */

function insertBeforeHeadClose(html, snippet) {
  const i = html.search(/<\/head>/i);
  return i < 0 ? snippet + html : html.slice(0, i) + snippet + html.slice(i);
}
function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function setMeta(html, attr, key, content) {
  const re = new RegExp(`<meta\\s+[^>]*(?:name|property)\\s*=\\s*["']${reEscape(key)}["'][^>]*>\\s*`, 'gi');
  const stripped = html.replace(re, '');
  if (content === null || content === undefined || content === '') return stripped;
  return insertBeforeHeadClose(stripped, `<meta ${attr}="${esc(key)}" content="${esc(content)}">\n`);
}
function setLink(html, rel, href, extra = '') {
  const re = new RegExp(`<link\\s+[^>]*rel\\s*=\\s*["']${reEscape(rel)}["'][^>]*>\\s*`, 'gi');
  const stripped = html.replace(re, '');
  if (!href) return stripped;
  return insertBeforeHeadClose(stripped, `<link rel="${rel}" href="${esc(href)}"${extra}>\n`);
}
function setTitle(html, title) {
  const tag = `<title>${esc(title)}</title>`;
  return /<title[^>]*>[\s\S]*?<\/title>/i.test(html) ? html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, () => tag) : insertBeforeHeadClose(html, tag + '\n');
}
/** JSON for embedding inside <script>. */
function jsonForScript(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Replace the content between <!--ssr:name--> and <!--/ssr:name-->. */
function fillSlot(html, name, content) {
  const re = new RegExp(`(<!--ssr:${reEscape(name)}-->)[\\s\\S]*?(<!--/ssr:${reEscape(name)}-->)`);
  return re.test(html) ? html.replace(re, (_, a, b) => a + content + b) : html;
}

const PRETTY = { index: '/', products: '/products', 'live-stock': '/live-stock', updates: '/updates', 'how-to-order': '/how-to-order', order: '/order', about: '/about', contact: '/contact', faq: '/faq', 'size-guide': '/size-guide', lookbook: '/lookbook', brand: '/brand' };

/** products.html → /products, product.html?slug=x → /products/x (static-mode links in the page fragments). */
function prettyLinks(html) {
  return html
    .replace(/(\shref=")product\.html\?slug=([^"&#]+)([^"]*)"/g, (_, a, slug, rest) => `${a}/products/${slug}${rest.replace(/^&/, '?')}"`)
    .replace(/(\shref=")([a-z-]+)\.html([?#][^"]*)?"/g, (m, a, name, rest) => (PRETTY[name] ? `${a}${PRETTY[name]}${rest || ''}"` : m));
}

/* -------------------------------------------------------------- JSON-LD */

function organization(ctx) {
  const { settings, siteUrl } = ctx;
  const b = (settings && settings.brand) || {};
  const wa = settings && settings.whatsapp && settings.whatsapp.enabled !== false && /^\d{7,15}$/.test(String(settings.whatsapp.number || '')) ? settings.whatsapp.number : '';
  const org = {
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: brandOf(settings),
    url: `${siteUrl}/`,
    logo: { '@type': 'ImageObject', url: `${siteUrl}/assets/brand/icon-512.png`, width: 512, height: 512 },
    image: `${siteUrl}/assets/brand/og-image.png`,
  };
  if (b.tagline) org.slogan = b.tagline;
  if (b.tagline) org.description = `${brandOf(settings)} — ${b.tagline}.`;
  if (b.email) org.email = b.email;
  if (b.established && /^\d{4}$/.test(String(b.established))) org.foundingDate = String(b.established);
  const same = socialLinks(settings);
  if (same.length) org.sameAs = same;
  const cp = { '@type': 'ContactPoint', contactType: 'customer service', availableLanguage: ['English', 'Chinese'], url: `${siteUrl}/contact` };
  if (b.email) cp.email = b.email;
  if (wa) cp.telephone = '+' + wa;
  org.contactPoint = [cp];
  return org;
}

function website(ctx) {
  const { settings, siteUrl } = ctx;
  return {
    '@type': 'WebSite',
    '@id': `${siteUrl}/#website`,
    url: `${siteUrl}/`,
    name: brandOf(settings),
    inLanguage: 'en',
    publisher: { '@id': `${siteUrl}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/products?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

function breadcrumb(ctx, url, trail) {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, ...(t.url ? { item: abs(ctx.siteUrl, t.url) } : {}) })),
  };
}

function webPage(ctx, { url, type, title, description, image, trail, extra }) {
  const { siteUrl } = ctx;
  const page = {
    '@type': type || 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: title,
    description,
    inLanguage: 'en',
    isPartOf: { '@id': `${siteUrl}/#website` },
    about: { '@id': `${siteUrl}/#organization` },
  };
  if (image) page.primaryImageOfPage = { '@type': 'ImageObject', url: image };
  if (trail && trail.length > 1) page.breadcrumb = { '@id': `${url}#breadcrumb` };
  return Object.assign(page, extra || {});
}

const SCHEMA_AVAILABILITY = {
  instock: 'https://schema.org/InStock',
  low: 'https://schema.org/LimitedAvailability',
  preorder: 'https://schema.org/PreOrder',
  restocking: 'https://schema.org/BackOrder',
  soldout: 'https://schema.org/OutOfStock',
};

function productDescription(p, settings) {
  const parts = [];
  if (p.subtitle) parts.push(clean(p.subtitle).replace(/[.\s]+$/, '') + '.');
  if (p.description) parts.push(clean(p.description));
  const text = parts.join(' ') || pageText('/products', settings).description;
  return truncate(text, 165);
}

function productLd(p, ctx) {
  const { settings, siteUrl, categories } = ctx;
  const url = abs(siteUrl, productUrl(p));
  const images = photos(p).map((im) => abs(siteUrl, im.url));
  const cat = (categories || []).find((c) => c.id === p.category);
  const availability = productAvailability(p, settings);
  const ld = {
    '@type': 'Product',
    '@id': `${url}#product`,
    name: p.name,
    description: productDescription(p, settings),
    sku: p.id,
    url,
    brand: { '@type': 'Brand', name: brandOf(settings) },
    manufacturer: { '@id': `${siteUrl}/#organization` },
    offers: {
      '@type': 'Offer',
      url,
      price: Number(p.price || 0).toFixed(2),
      priceCurrency: 'CNY',
      availability: SCHEMA_AVAILABILITY[availability] || SCHEMA_AVAILABILITY.soldout,
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': `${siteUrl}/#organization` },
    },
  };
  if (images.length) ld.image = images;
  if (cat) ld.category = cat.name;
  if ((p.colors || []).length) ld.color = p.colors.map((c) => c.name).join(', ');
  if (p.materials) ld.material = truncate(p.materials, 200);
  if ((p.sizes || []).length) ld.size = p.sizes.join(', ');
  if (p.compareAt && Number(p.compareAt) > Number(p.price)) {
    ld.offers.priceSpecification = { '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/StrikethroughPrice', price: Number(p.compareAt).toFixed(2), priceCurrency: 'CNY' };
  }
  return ld;
}

function itemList(ctx, url, products) {
  return {
    '@type': 'ItemList',
    '@id': `${url}#items`,
    numberOfItems: products.length,
    itemListElement: products.slice(0, 100).map((p, i) => {
      const img = photos(p)[0];
      return { '@type': 'ListItem', position: i + 1, url: abs(ctx.siteUrl, productUrl(p)), name: p.name, ...(img ? { image: abs(ctx.siteUrl, img.url) } : {}) };
    }),
  };
}

function postText(u) {
  return clean(u.textEnglish || u.textOriginal || '');
}
function postImage(u, siteUrl) {
  const m = (u.media || []).find((x) => x && x.type === 'image' && x.url);
  if (m) return abs(siteUrl, m.url);
  if (u.video && u.video.poster) return abs(siteUrl, u.video.poster);
  return '';
}
function postTitle(u) {
  return clean(u.title) || truncate(postText(u), 70) || 'Studio update';
}

function blogPosting(u, ctx, { full } = {}) {
  const { siteUrl } = ctx;
  const url = abs(siteUrl, updateUrl(u));
  const img = postImage(u, siteUrl);
  const ld = {
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    headline: truncate(postTitle(u), 110),
    url,
    datePublished: isoDate(u.publishedAt),
    dateModified: isoDate(u.updatedAt || u.publishedAt),
    author: { '@id': `${siteUrl}/#organization` },
    publisher: { '@id': `${siteUrl}/#organization` },
    inLanguage: 'en',
    mainEntityOfPage: { '@id': `${url}#webpage` },
  };
  if (img) ld.image = [img];
  if (u.category) ld.articleSection = u.category;
  if (full) {
    ld.articleBody = postText(u);
    ld.description = truncate(postText(u), 160);
    if (u.url && /^https?:\/\//.test(u.url) && !u.demo) ld.isBasedOn = u.url;
    if (u.textOriginal && u.source === 'weibo') ld.translationOfWork = { '@type': 'CreativeWork', inLanguage: 'zh', ...(u.url && !u.demo ? { url: u.url } : {}) };
  }
  return ld;
}

/* ------------------------------------------------------- server rendering */

function cardHtml(p) {
  const img = photos(p)[0];
  const color = (p.colors || [])[0];
  return (
    `<article class="pcard" data-pid="${esc(p.id)}"><div class="pcard__media" style="--tint:${tint(color && color.hex)}">` +
    (img ? `<div class="pcard__img pcard__img--main"><img src="${esc(img.url)}" alt="${esc(img.alt || p.name)}" loading="lazy" decoding="async"></div>` : '') +
    `</div><div class="pcard__info"><div class="pcard__row"><h3 class="pcard__name"><a href="${productUrl(p)}">${esc(p.name)}</a></h3>` +
    `<span class="pcard__price"><span class="price" data-price="${Number(p.price) || 0}">${formatCny(p.price)}</span></span></div>` +
    (p.subtitle ? `<p class="pcard__sub">${esc(p.subtitle)}</p>` : '') +
    `</div></article>`
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function paragraphs(text) {
  return '<p>' + esc(text).replace(/\n+/g, '</p><p>') + '</p>';
}

function postHtml(u, { single } = {}) {
  const d = new Date(tsOf(u.publishedAt) || Date.now());
  const text = u.textEnglish || u.textOriginal || '';
  const imgs = (u.media || []).filter((m) => m && m.type === 'image' && m.url).slice(0, single ? 9 : 3);
  const isWeibo = u.source === 'weibo';
  return (
    `<li class="tl-item${u.pinned ? ' is-pinned' : ''}" id="${esc(u.id)}">` +
    `<div class="tl-date"><span class="tl-date__day">${String(d.getUTCDate()).padStart(2, '0')}</span><span class="tl-date__mon">${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}</span></div>` +
    `<article class="tl-card"><header class="tl-card__head"><div class="row row--wrap"><span class="cat-chip cat-${esc(u.category || 'studio')}">${esc(u.category || 'update')}</span>` +
    `<time class="tiny subtle" datetime="${esc(isoDate(u.publishedAt) || '')}">${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}</time></div></header>` +
    (single ? '' : `<h2 class="tl-card__title"><a href="${updateUrl(u)}">${esc(postTitle(u))}</a></h2>`) +
    `<div class="tl-text"><div class="tl-en">${paragraphs(text)}</div>` +
    (single && u.textOriginal && isWeibo ? `<div class="tl-zh zh" lang="zh"><span class="tl-zh__lbl">原文 · Original</span>${paragraphs(u.textOriginal)}</div>` : '') +
    `</div>` +
    (imgs.length
      ? `<div class="tl-media" style="--m:${Math.min(imgs.length, 3)}">` +
        imgs.map((m, i) => `<span class="tl-media__item"><img src="${esc(m.url)}" alt="${esc(m.caption || `${postTitle(u)} — image ${i + 1}`)}" loading="lazy" decoding="async"></span>`).join('') +
        `</div>`
      : '') +
    `<footer class="tl-card__foot"><span class="tiny subtle">${isWeibo ? 'Translated from Chinese' : 'From the studio'}</span>` +
    (single ? '' : `<a class="link link--quiet tiny" href="${updateUrl(u)}">Read the post</a>`) +
    `</footer></article></li>`
  );
}

function crumbsHtml(trail) {
  return trail
    .map((t, i) => (i === trail.length - 1 && !t.link ? `<span>${esc(t.name)}</span>` : `<a href="${esc(t.url)}">${esc(t.name)}</a>`))
    .join('<span aria-hidden="true">/</span>');
}

function faqHtml(faq) {
  const topics = (faq && faq.topics) || [];
  const nav = topics.map((c, i) => `<a href="#${esc(c.id)}" data-faq-link="${esc(c.id)}"${i ? '' : ' class="is-on"'}><span class="index">0${i + 1}</span>${esc(c.title)}</a>`).join('');
  const list = topics
    .map(
      (c, i) =>
        `<section class="faq-cat" id="${esc(c.id)}" data-faq-cat><h2 class="h3"><span class="index">0${i + 1}</span> ${esc(c.title)}</h2><div class="acc mt-3" data-acc>` +
        (c.items || [])
          .map((q) => `<div class="acc__item" data-q="${esc((q.q + ' ' + q.a).toLowerCase())}"><button class="acc__btn" type="button"><span>${esc(q.q)}</span><span class="acc__plus" aria-hidden="true"></span></button><div class="acc__panel"><div><div class="acc__content">${esc(q.a)}</div></div></div></div>`)
          .join('') +
        `</div></section>`
    )
    .join('');
  const count = topics.reduce((a, c) => a + (c.items || []).length, 0);
  return { nav, list, count: `${count} questions in ${topics.length} topics` };
}

/* --------------------------------------------------------------- builder */

function visibleProducts(db) {
  const list = db.products.filter((p) => p.status === 'published');
  return list.sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name)));
}
/** Demo content steps aside for search engines as soon as there is real content. */
function indexableProducts(db) {
  return visibleProducts(db).filter((p) => !p.demo);
}
function visibleUpdates(db) {
  let list = db.updates.filter((u) => u.status === 'published');
  if (list.some((u) => !u.demo)) list = list.filter((u) => !u.demo);
  return list.sort((a, b) => (!!b.pinned !== !!a.pinned ? (b.pinned ? 1 : -1) : tsOf(b.publishedAt) - tsOf(a.publishedAt)));
}

/**
 * Work out everything search engines need for one request.
 * ctx: { route, db, siteUrl, query, product?, update?, faq? }
 * Returns { title, description, canonical, robots, ogType, image, imageAlt, graph, slots, head }.
 */
function buildPage(ctx) {
  const { route, db, siteUrl, query = {} } = ctx;
  const settings = db.settings || {};
  const categories = [...(db.categories || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const c2 = { ...ctx, settings, categories };
  const def = PAGES[route] || PAGES['/'];
  const home = { name: 'Home', url: '/' };
  let { title, description } = pageText(route, settings);
  let path = route;
  let type = def.type;
  let robots = def.noindex ? ROBOTS_NOINDEX : ROBOTS_INDEX;
  let ogType = 'website';
  let image = '';
  let imageAlt = '';
  let trail = route === '/' ? [home] : [home, { name: def.label || title, url: route }];
  const extraGraph = [];
  const slots = {};
  const head = [];
  let pageExtra = null;
  const brand = brandOf(settings);

  if (route === '/') {
    const list = visibleProducts(db);
    const picks = list.filter((p) => p.featured).concat(list.filter((p) => !p.featured)).slice(0, 8);
    if (picks.length) slots.featured = picks.map(cardHtml).join('');
    const ups = visibleUpdates(db).slice(0, 3);
    if (ups.length) {
      slots.updates = ups
        .map((u) => `<article class="ucard"><div class="ucard__body"><time class="tiny subtle" datetime="${esc(isoDate(u.publishedAt) || '')}">${esc(new Date(tsOf(u.publishedAt)).toISOString().slice(0, 10))}</time><h3 class="ucard__title"><a href="${updateUrl(u)}">${esc(postTitle(u))}</a></h3><p class="ucard__text">${esc(truncate(postText(u), 220))}</p></div></article>`)
        .join('');
    }
    head.push(`<link rel="alternate" type="application/rss+xml" title="${esc(brand)} — Studio updates" href="${siteUrl}/updates/feed.xml">`);
  }

  if (route === '/products') {
    const all = visibleProducts(db);
    const cat = query.category ? categories.find((c) => c.id === query.category) : null;
    let list = all;
    if (cat) {
      list = all.filter((p) => p.category === cat.id);
      path = `/products?category=${encodeURIComponent(cat.id)}`;
      const over = settings.seo && settings.seo.pages && settings.seo.pages[`/products?category=${cat.id}`];
      title = clean(over && over.title) || `${cat.name} — ${brand}`;
      description = truncate(clean(over && over.description) || clean(cat.description) || `Shop ${cat.name.toLowerCase()} by ${brand}: designed and produced in-house, with live stock per size and colour and worldwide ordering.`, 170);
      trail = [home, { name: 'Shop', url: '/products' }, { name: cat.name, url: path }];
      slots['cat-title'] = esc(cat.name);
      slots.crumb = esc(cat.name);
    }
    // Filtered/sorted/search views keep the canonical of the (category) page, so they never compete with it.
    slots.grid = list.length ? list.map(cardHtml).join('') : '';
    slots.total = String(list.length);
    const listed = list.filter((p) => !p.demo);
    if (listed.length) {
      extraGraph.push(itemList(c2, abs(siteUrl, path), listed));
      pageExtra = { mainEntity: { '@id': `${abs(siteUrl, path)}#items` } };
    }
    const img = listed.map((p) => photos(p)[0]).find(Boolean);
    if (img) image = abs(siteUrl, img.url);
  }

  if (route === '/products/:slug' && ctx.product) {
    const p = ctx.product;
    const cat = categories.find((c) => c.id === p.category);
    path = productUrl(p);
    const over = (settings.seo && settings.seo.pages && settings.seo.pages[path]) || {};
    const t1 = cat ? `${p.name} — ${cat.name} | ${brand}` : `${p.name} | ${brand}`;
    title = clean(p.seoTitle) || clean(over.title) || (t1.length <= 65 ? t1 : `${p.name} | ${brand}`);
    description = truncate(clean(p.seoDescription) || clean(over.description) || productDescription(p, settings), 170);
    type = 'ItemPage';
    ogType = 'product';
    trail = [home, { name: 'Shop', url: '/products' }];
    if (cat) trail.push({ name: cat.name, url: `/products?category=${encodeURIComponent(cat.id)}` });
    trail.push({ name: p.name, url: path });
    const img = photos(p)[0];
    if (img) {
      image = abs(siteUrl, img.url);
      imageAlt = img.alt || p.name;
      head.push(`<link rel="preload" as="image" href="${esc(img.url)}" fetchpriority="high">`);
    }
    if (p.demo) robots = ROBOTS_NOINDEX;
    extraGraph.push(productLd(p, c2));
    pageExtra = { mainEntity: { '@id': `${abs(siteUrl, path)}#product` } };
    head.push(`<meta property="product:price:amount" content="${Number(p.price || 0).toFixed(2)}">`, '<meta property="product:price:currency" content="CNY">');
    slots.crumbs = crumbsHtml(trail);
    slots.gallery = img
      ? `<div class="gal"><figure class="gal__item gal__item--photo gal__item--lead"><div class="gal__frame"><img src="${esc(img.url)}" alt="${esc(img.alt || p.name)}" fetchpriority="high"></div></figure></div>`
      : `<div class="skeleton" style="aspect-ratio:4/5"></div>`;
    slots.info =
      `<h1 class="h2 pdp__name">${esc(p.name)}</h1>` +
      (p.subtitle ? `<p class="pdp__sub">${esc(p.subtitle)}</p>` : '') +
      `<div class="pdp__price"><span class="pdp__price-main"><span class="price" data-price="${Number(p.price) || 0}">${formatCny(p.price)}</span></span></div>` +
      (p.description ? `<div class="prose mt-3">${paragraphs(p.description)}</div>` : '') +
      ((p.details || []).length ? `<ul class="bullets mt-3">${p.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '') +
      (p.materials ? `<p class="mt-2"><b>${esc(p.materials)}</b></p>` : '') +
      ((p.colors || []).length ? `<p class="small muted mt-2">Colours: ${esc(p.colors.map((c) => c.name).join(', '))}</p>` : '') +
      ((p.sizes || []).length ? `<p class="small muted">Sizes: ${esc(p.sizes.join(', '))}</p>` : '');
  }

  if (route === '/updates' || route === '/updates/:id') {
    head.push(`<link rel="alternate" type="application/rss+xml" title="${esc(brand)} — Studio updates" href="${siteUrl}/updates/feed.xml">`);
  }
  if (route === '/updates') {
    const list = visibleUpdates(db);
    const first = list.slice(0, 6);
    if (first.length) slots.timeline = first.map((u) => postHtml(u)).join('');
    const real = list.filter((u) => !u.demo).slice(0, 20);
    if (real.length) {
      extraGraph.push({
        '@type': 'Blog',
        '@id': `${siteUrl}/updates#blog`,
        name: `${brand} — Studio updates`,
        url: `${siteUrl}/updates`,
        publisher: { '@id': `${siteUrl}/#organization` },
        inLanguage: 'en',
        blogPost: real.map((u) => blogPosting(u, c2)),
      });
      pageExtra = { mainEntity: { '@id': `${siteUrl}/updates#blog` } };
    }
    const img = list.map((u) => postImage(u, siteUrl)).find(Boolean);
    if (img) image = img;
  }

  if (route === '/updates/:id' && ctx.update) {
    const u = ctx.update;
    path = updateUrl(u);
    const t = postTitle(u);
    title = `${t} — Studio Updates | ${brand}`;
    if (title.length > 70) title = `${truncate(t, 70 - brand.length - 3)} | ${brand}`;
    description = truncate(postText(u), 165) || pageText('/updates', settings).description;
    type = 'WebPage';
    ogType = 'article';
    trail = [home, { name: 'Studio updates', url: '/updates' }, { name: truncate(t, 60), url: path }];
    image = postImage(u, siteUrl);
    if (image) imageAlt = t;
    if (u.demo) robots = ROBOTS_NOINDEX;
    extraGraph.push(blogPosting(u, c2, { full: true }));
    pageExtra = { mainEntity: { '@id': `${abs(siteUrl, path)}#article` } };
    if (isoDate(u.publishedAt)) head.push(`<meta property="article:published_time" content="${isoDate(u.publishedAt)}">`);
    if (isoDate(u.updatedAt)) head.push(`<meta property="article:modified_time" content="${isoDate(u.updatedAt)}">`);
    if (u.category) head.push(`<meta property="article:section" content="${esc(u.category)}">`);
    slots.crumbs = crumbsHtml(trail);
    slots.h1 = `<span class="post-title">${esc(t)}</span>`;
    slots.lead = `<time datetime="${esc(isoDate(u.publishedAt) || '')}">${new Date(tsOf(u.publishedAt) || Date.now()).toUTCString().slice(5, 16)}</time> · ${u.source === 'weibo' ? 'From the studio’s Weibo, translated into English.' : 'From the studio.'}`;
    slots.timeline = postHtml(u, { single: true });
    slots.more = `<a class="btn btn--ghost" href="/updates">All studio updates</a>`;
  }

  if (route === '/faq' && ctx.faq) {
    const f = faqHtml(ctx.faq);
    slots['faq-nav'] = f.nav;
    slots['faq-list'] = f.list;
    slots['faq-count'] = esc(f.count);
    const qs = (ctx.faq.topics || []).flatMap((c) => c.items || []);
    if (qs.length) pageExtra = { mainEntity: qs.map((q) => ({ '@type': 'Question', name: q.q, acceptedAnswer: { '@type': 'Answer', text: q.a } })) };
  }

  if (route === '/how-to-order') {
    const sh = settings.shipping || {};
    if ((sh.regions || []).length) slots['ship-rows'] = sh.regions.map((r) => `<tr><td>${esc(r.region)}</td><td class="ta-r">${esc(r.time)}</td></tr>`).join('');
    if (sh.note) slots['ship-note'] = esc(sh.note);
  }

  const canonical = abs(siteUrl, path);
  if (!image) {
    image = abs(siteUrl, (settings.seo && settings.seo.image) || '/assets/brand/og-image.png');
    imageAlt = imageAlt || `${brand} — ${(settings.brand && settings.brand.tagline) || 'International Fashion Studio'}`;
  }
  const graph = [organization(c2), website(c2), webPage(c2, { url: canonical, type, title, description, image, trail, extra: pageExtra })];
  if (trail.length > 1) graph.push(breadcrumb(c2, canonical, trail));
  graph.push(...extraGraph);

  return { title, description, canonical, robots, ogType, image, imageAlt, graph, slots, head };
}

/** Write the result of buildPage() into an HTML document. */
function applyPage(html, page, settings) {
  const brand = brandOf(settings);
  const seo = (settings && settings.seo) || {};
  let out = setTitle(html, page.title);
  out = setMeta(out, 'name', 'description', page.description);
  out = setMeta(out, 'name', 'robots', page.robots);
  out = setLink(out, 'canonical', page.robots === ROBOTS_NOINDEX ? '' : page.canonical);
  out = setMeta(out, 'property', 'og:type', page.ogType);
  out = setMeta(out, 'property', 'og:site_name', brand);
  out = setMeta(out, 'property', 'og:locale', 'en_GB');
  out = setMeta(out, 'property', 'og:title', page.title);
  out = setMeta(out, 'property', 'og:description', page.description);
  out = setMeta(out, 'property', 'og:url', page.canonical);
  out = setMeta(out, 'property', 'og:image', page.image);
  out = setMeta(out, 'property', 'og:image:alt', page.imageAlt || page.title);
  out = setMeta(out, 'name', 'twitter:card', 'summary_large_image');
  out = setMeta(out, 'name', 'twitter:title', page.title);
  out = setMeta(out, 'name', 'twitter:description', page.description);
  out = setMeta(out, 'name', 'twitter:image', page.image);
  out = setMeta(out, 'name', 'google-site-verification', verification(seo.googleVerification));
  out = setMeta(out, 'name', 'msvalidate.01', verification(seo.bingVerification));
  out = out.replace(/<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>\s*/gi, '');
  const ld = `<script type="application/ld+json" id="cola-jsonld">${jsonForScript({ '@context': 'https://schema.org', '@graph': page.graph })}</script>\n`;
  out = insertBeforeHeadClose(out, (page.head || []).map((h) => h + '\n').join('') + ld);
  for (const [name, content] of Object.entries(page.slots || {})) out = fillSlot(out, name, content);
  return prettyLinks(out);
}

/** Accepts the bare code or the whole <meta …content="code"> tag people paste. */
function verification(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = /content\s*=\s*["']([^"']+)["']/i.exec(s);
  return (m ? m[1] : s).replace(/[^A-Za-z0-9_\-.:=+/]/g, '').slice(0, 200);
}

/* --------------------------------------------------------- sitemap / feed */

const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const day = (v) => (tsOf(v) ? new Date(v).toISOString().slice(0, 10) : null);

function sitemapXml({ db, siteUrl, pages }) {
  const products = indexableProducts(db);
  const updates = visibleUpdates(db).filter((u) => !u.demo);
  const categories = [...(db.categories || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const newest = (list, key = 'updatedAt') => list.reduce((m, x) => (tsOf(x[key]) > tsOf(m) ? x[key] : m), null);
  const urls = [];
  for (const route of pages) {
    const d = PAGES[route];
    if (!d || d.noindex) continue;
    const lastmod = route === '/products' || route === '/' ? day(newest(products)) : route === '/updates' ? day(newest(updates, 'publishedAt')) : route === '/live-stock' ? day(newest(products)) : null;
    urls.push({ loc: abs(siteUrl, route), lastmod, changefreq: d.changefreq, priority: d.priority });
  }
  for (const c of categories) {
    const inCat = products.filter((p) => p.category === c.id);
    if (!inCat.length) continue;
    urls.push({ loc: `${siteUrl}/products?category=${encodeURIComponent(c.id)}`, lastmod: day(newest(inCat)), changefreq: 'daily', priority: '0.8' });
  }
  for (const p of products) {
    urls.push({
      loc: abs(siteUrl, productUrl(p)),
      lastmod: day(p.updatedAt),
      changefreq: 'daily',
      priority: '0.8',
      images: photos(p).slice(0, 10).map((im) => ({ loc: abs(siteUrl, im.url), title: im.alt || p.name })),
    });
  }
  for (const u of updates.slice(0, 2000)) {
    const img = postImage(u, siteUrl);
    urls.push({ loc: abs(siteUrl, updateUrl(u)), lastmod: day(u.updatedAt || u.publishedAt), changefreq: 'monthly', priority: '0.5', images: img ? [{ loc: img, title: postTitle(u) }] : [] });
  }
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ''}${u.priority ? `<priority>${u.priority}</priority>` : ''}` +
        (u.images || []).map((im) => `<image:image><image:loc>${xmlEscape(im.loc)}</image:loc></image:image>`).join('') +
        `</url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`;
}

// Public JSON (/api/*) and media must stay crawlable: Google renders the pages
// with JavaScript and needs those requests to see products and posts.
function robotsTxt({ siteUrl }) {
  return ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api/admin', 'Disallow: /order', '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n');
}

function rssXml({ db, siteUrl }) {
  const settings = db.settings || {};
  const brand = brandOf(settings);
  const items = visibleUpdates(db)
    .filter((u) => !u.demo)
    .sort((a, b) => tsOf(b.publishedAt) - tsOf(a.publishedAt))
    .slice(0, 30);
  const body = items
    .map((u) => {
      const link = abs(siteUrl, updateUrl(u));
      const img = postImage(u, siteUrl);
      return (
        `  <item><title>${xmlEscape(postTitle(u))}</title><link>${xmlEscape(link)}</link><guid isPermaLink="true">${xmlEscape(link)}</guid>` +
        (tsOf(u.publishedAt) ? `<pubDate>${new Date(u.publishedAt).toUTCString()}</pubDate>` : '') +
        (u.category ? `<category>${xmlEscape(u.category)}</category>` : '') +
        `<description>${xmlEscape(truncate(postText(u), 500))}</description>` +
        (img ? `<enclosure url="${xmlEscape(img)}" type="image/jpeg" length="0"/>` : '') +
        `</item>`
      );
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n` +
    `  <title>${xmlEscape(brand)} — Studio updates</title>\n  <link>${xmlEscape(siteUrl)}/updates</link>\n` +
    `  <atom:link href="${xmlEscape(siteUrl)}/updates/feed.xml" rel="self" type="application/rss+xml"/>\n` +
    `  <description>${xmlEscape(pageText('/updates', settings).description)}</description>\n  <language>en</language>\n` +
    (items[0] && tsOf(items[0].publishedAt) ? `  <lastBuildDate>${new Date(items[0].publishedAt).toUTCString()}</lastBuildDate>\n` : '') +
    `${body}\n</channel>\n</rss>\n`
  );
}

module.exports = {
  PAGES,
  EDITABLE_PAGES,
  ROBOTS_INDEX,
  ROBOTS_NOINDEX,
  buildPage,
  applyPage,
  pageText,
  prettyLinks,
  fillSlot,
  sitemapXml,
  robotsTxt,
  rssXml,
  verification,
  visibleUpdates,
  indexableProducts,
  productUrl,
  updateUrl,
  tint,
};
