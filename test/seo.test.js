'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const seo = require('../server/lib/seo');

const SITE = 'https://shop.example';
const PUBLIC = path.join(__dirname, '..', 'public');

function db(extra = {}) {
  return {
    settings: {
      brand: { name: 'Cola Studio', tagline: 'International Fashion Studio', email: 'studio@colastudio.com', established: '2019' },
      whatsapp: { enabled: true, number: '8618060779381' },
      social: { weibo: 'https://weibo.com/u/7354109778', yupoo: 'https://colastudio.x.yupoo.com/albums', instagram: '' },
      seo: { title: 'Cola Studio — International Fashion Studio', description: '', pages: {} },
      shipping: { regions: [{ region: 'Europe', time: '7–12 days' }], note: 'Indicative.' },
      ...(extra.settings || {}),
    },
    categories: [{ id: 'tops', name: 'Tops', order: 1, description: '' }],
    products: [
      { id: 'cs-1', slug: 'heavy-hoodie', name: 'Heavy Hoodie', subtitle: '480 g loopback', description: 'Boxy hoodie.', category: 'tops', price: 459, status: 'published', colors: [{ name: 'Black', hex: '#111111' }], sizes: ['M', 'L'], variants: [{ sku: 'a', color: 'Black', size: 'M', stock: 9 }], images: [{ url: '/media/img?u=x', alt: 'Hoodie front' }], updatedAt: '2026-10-20T10:00:00Z' },
      { id: 'cs-2', slug: 'demo-tee', name: 'Demo Tee', price: 199, status: 'published', demo: true, colors: [], sizes: [], variants: [], images: [] },
    ],
    updates: [
      { id: 'wb-1', source: 'weibo', status: 'published', title: 'Sampling | Hoodie', textEnglish: 'Second sample round done.', textOriginal: '第二轮打样完成', publishedAt: '2026-10-21T10:00:00Z', media: [{ type: 'image', url: '/media/weibo?u=y' }], url: 'https://m.weibo.cn/status/1' },
      { id: 'wb-2', source: 'weibo', status: 'pending', title: 'Hidden', textEnglish: 'x', publishedAt: '2026-10-22T10:00:00Z' },
    ],
    ...extra.db,
  };
}

test('every public page gets a real title, description, canonical and one JSON-LD graph', () => {
  for (const route of Object.keys(seo.PAGES)) {
    const p = seo.buildPage({ route, db: db(), siteUrl: SITE, faq: { topics: [{ id: 'a', title: 'A', items: [{ q: 'Q?', a: 'A.' }] }] } });
    assert.ok(p.title.length >= 10 && p.title.length <= 70, `${route}: ${p.title}`);
    assert.ok(p.description.length >= 50 && p.description.length <= 170, `${route}: ${p.description.length}`);
    assert.equal(p.canonical, SITE + route);
    assert.equal(p.robots.startsWith('noindex'), !!seo.PAGES[route].noindex, route);
    const types = p.graph.map((n) => n['@type']);
    assert.ok(types.includes('Organization') && types.includes('WebSite'), route);
  }
  // Legacy seed title is ignored for the homepage in favour of the better built-in one.
  assert.match(seo.buildPage({ route: '/', db: db(), siteUrl: SITE }).title, /Official Website/);
});

test('admin overrides win; organisation lists socials, email and WhatsApp', () => {
  const d = db({ settings: { seo: { title: 'Custom Home', description: 'Custom description that is long enough to be used as the meta description here.', pages: { '/faq': { title: '<b>FAQ</b> custom' } } } } });
  assert.equal(seo.buildPage({ route: '/', db: d, siteUrl: SITE }).title, 'Custom Home');
  assert.equal(seo.buildPage({ route: '/faq', db: d, siteUrl: SITE }).title, 'FAQ custom');
  const org = seo.buildPage({ route: '/', db: db(), siteUrl: SITE }).graph.find((n) => n['@type'] === 'Organization');
  assert.deepEqual(org.sameAs, ['https://weibo.com/u/7354109778', 'https://colastudio.x.yupoo.com/albums']);
  assert.equal(org.contactPoint[0].telephone, '+8618060779381');
  assert.equal(org.foundingDate, '2019');
});

test('product, category, update and FAQ pages carry their own structured data and server-rendered content', () => {
  const d = db();
  const prod = seo.buildPage({ route: '/products/:slug', db: d, siteUrl: SITE, product: d.products[0] });
  assert.equal(prod.title, 'Heavy Hoodie — Tops | Cola Studio');
  assert.equal(prod.ogType, 'product');
  assert.equal(prod.image, SITE + '/media/img?u=x');
  const ld = prod.graph.find((n) => n['@type'] === 'Product');
  assert.equal(ld.offers.priceCurrency, 'CNY');
  assert.equal(ld.offers.availability, 'https://schema.org/InStock');
  assert.match(prod.slots.info, /<h1[^>]*>Heavy Hoodie<\/h1>/);
  assert.match(prod.slots.crumbs, /href="\/products\?category=tops">Tops</);

  const demo = seo.buildPage({ route: '/products/:slug', db: d, siteUrl: SITE, product: d.products[1] });
  assert.equal(demo.robots, seo.ROBOTS_NOINDEX, 'demo products stay out of search results');

  const cat = seo.buildPage({ route: '/products', db: d, siteUrl: SITE, query: { category: 'tops', sort: 'new' } });
  assert.equal(cat.canonical, SITE + '/products?category=tops');
  assert.match(cat.slots.grid, /href="\/products\/heavy-hoodie"/);
  assert.equal(cat.graph.find((n) => n['@type'] === 'ItemList').numberOfItems, 1);

  const post = seo.buildPage({ route: '/updates/:id', db: d, siteUrl: SITE, update: d.updates[0] });
  assert.equal(post.ogType, 'article');
  assert.equal(post.canonical, SITE + '/updates/wb-1');
  const bp = post.graph.find((n) => n['@type'] === 'BlogPosting');
  assert.equal(bp.datePublished, '2026-10-21T10:00:00.000Z');
  assert.equal(bp.isBasedOn, 'https://m.weibo.cn/status/1');
  assert.match(post.slots.timeline, /第二轮打样完成/);

  const list = seo.buildPage({ route: '/updates', db: d, siteUrl: SITE });
  assert.match(list.slots.timeline, /href="\/updates\/wb-1"/);
  assert.doesNotMatch(list.slots.timeline, /wb-2/);

  const faq = seo.buildPage({ route: '/faq', db: d, siteUrl: SITE, faq: JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'faq.json'), 'utf8')) });
  const fp = faq.graph.find((n) => n['@type'] === 'FAQPage');
  assert.ok(fp.mainEntity.length >= 20);
  assert.match(faq.slots['faq-list'], /How do I place an order\?/);

  const how = seo.buildPage({ route: '/how-to-order', db: d, siteUrl: SITE });
  assert.match(how.slots['ship-rows'], /<td>Europe<\/td>/);
});

test('applyPage rewrites the head once, fills slots and makes links pretty', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'products.html'), 'utf8');
  const d = db();
  const out = seo.applyPage(html, seo.buildPage({ route: '/products', db: d, siteUrl: SITE }), d.settings);
  assert.equal((out.match(/<title>/g) || []).length, 1);
  assert.equal((out.match(/<link rel="canonical"/g) || []).length, 1);
  assert.equal((out.match(/name="description"/g) || []).length, 1);
  assert.equal((out.match(/application\/ld\+json/g) || []).length, 1);
  assert.match(out, /<link rel="canonical" href="https:\/\/shop\.example\/products">/);
  assert.match(out, /href="\/products\/heavy-hoodie"/);
  assert.doesNotMatch(out, /href="(index|products|how-to-order)\.html/);
  assert.match(out, /<!--ssr:grid--><article class="pcard"/);
});

test('helpers: verification codes, pretty links, tint, sitemap, robots, feed', () => {
  assert.equal(seo.verification('<meta name="google-site-verification" content="abc_DEF-123" />'), 'abc_DEF-123');
  assert.equal(seo.verification(' xyz '), 'xyz');
  assert.equal(seo.prettyLinks('<a href="product.html?slug=a-b&color=Red">x</a><a href="faq.html#returns">y</a><a href="admin/index.html">z</a>'), '<a href="/products/a-b?color=Red">x</a><a href="/faq#returns">y</a><a href="admin/index.html">z</a>');
  assert.equal(seo.tint('#111111'), '#d7d1c7');
  assert.equal(seo.tint(''), '#EBE4D9');

  const d = db();
  const sm = seo.sitemapXml({ db: d, siteUrl: SITE, pages: ['/', '/products', '/order', '/faq'] });
  assert.match(sm, /<loc>https:\/\/shop\.example\/products\/heavy-hoodie<\/loc><lastmod>2026-10-20<\/lastmod>/);
  assert.match(sm, /<image:loc>https:\/\/shop\.example\/media\/img\?u=x<\/image:loc>/);
  assert.match(sm, /\/updates\/wb-1</);
  assert.doesNotMatch(sm, /demo-tee|\/order<|wb-2/);
  assert.match(seo.robotsTxt({ siteUrl: SITE }), /Sitemap: https:\/\/shop\.example\/sitemap\.xml/);
  const rss = seo.rssXml({ db: d, siteUrl: SITE });
  assert.match(rss, /<title>Sampling \| Hoodie<\/title>/);
  assert.doesNotMatch(rss, /Hidden/);
});
