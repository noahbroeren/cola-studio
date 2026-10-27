'use strict';
/**
 * Boots the real server on a random port with a temp DATA_DIR / PUBLIC_DIR and
 * a fake fetch (no network), then exercises the HTTP surface end to end.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server/app');
const { tmpDir, rmrf, copyDir, fakeFetch, fixtureJson, noSleep, FIXTURES } = require('./helpers');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function request(base, method, urlPath, { body, headers = {}, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, base);
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(
      u,
      { method, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let buf = Buffer.concat(chunks);
          if (!raw && res.headers['content-encoding'] === 'gzip') buf = zlib.gunzipSync(buf);
          const text = buf.toString('utf8');
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json, buf });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function weiboAndFriendsRoutes(counter) {
  return [
    ['m.weibo.cn/u/', () => new Response('<html></html>', { headers: [['set-cookie', '_T_WM=1; Path=/']] })],
    [(u) => u.includes('getIndex') && !u.includes('containerid'), () => fixtureJson('weibo', 'getindex-uid.json')],
    [(u) => u.includes('getIndex') && u.includes('containerid='), () => fixtureJson('weibo', 'getindex-posts.json')],
    ['statuses/extend', () => fixtureJson('weibo', 'extend.json')],
    ['api-free.deepl.com', (u, init) => ({ translations: [{ text: `EN ${JSON.parse(init.body).text[0].length}` }] })],
    [
      'sinaimg.cn',
      () => {
        counter.media++;
        return new Response(Buffer.from(PNG_1PX, 'base64'), { headers: { 'content-type': 'image/png' } });
      },
    ],
  ];
}

test('server integration', async (t) => {
  const dataDir = tmpDir();
  const publicDir = tmpDir();
  copyDir(path.join(FIXTURES, 'public'), publicDir);
  const counter = { media: 0 };
  const app = createApp({
    env: {
      DATA_DIR: dataDir,
      PUBLIC_DIR: publicDir,
      LOG_SILENT: '1',
      DISABLE_SCHEDULERS: '1',
      DISABLE_MEDIA_PREFETCH: '1',
      ADMIN_PASSWORD: 'test-pass',
      SITE_URL: 'https://colastudio.com',
      WEIDIAN_APP_SECRET: 'env-secret-value-1234',
    },
    fetch: fakeFetch(weiboAndFriendsRoutes(counter)),
    sleep: noSleep,
  });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  const get = (p, o) => request(base, 'GET', p, o);
  t.after(async () => {
    await app.close();
    rmrf(dataDir);
    rmrf(publicDir);
  });

  let token;
  const admin = (method, p, body, headers = {}) => request(base, method, p, { body, headers: { authorization: `Bearer ${token}`, ...headers } });

  await t.test('public API: health, site, products, product, inventory, updates', async () => {
    const h = await get('/api/health');
    assert.equal(h.status, 200);
    assert.deepEqual(Object.keys(h.json).sort(), ['demo', 'ok', 'time', 'version']);
    assert.equal(h.json.demo, true);
    assert.match(h.headers['content-security-policy'] || '', /^$/); // CSP only on HTML
    assert.equal(h.headers['x-content-type-options'], 'nosniff');

    const site = await get('/api/site');
    assert.equal(site.json.settings.brand.name, 'Cola Studio');
    assert.deepEqual(site.json.categories.map((c) => c.id), ['outerwear', 'tops']);
    assert.equal(JSON.stringify(site.json).includes('anthropicKey'), false);

    const products = await get('/api/products');
    assert.deepEqual(products.json.products.map((p) => p.id), ['cs-001', 'cs-002'], 'published only, sorted by order');
    assert.ok(products.headers.etag);
    const cached = await get('/api/products', { headers: { 'if-none-match': products.headers.etag } });
    assert.equal(cached.status, 304);

    const one = await get('/api/products/heavyweight-hoodie');
    assert.equal(one.json.product.id, 'cs-002');
    assert.deepEqual(one.json.related.map((p) => p.id), ['cs-001']);
    assert.equal((await get('/api/products/secret-draft-tee')).status, 404);
    assert.equal((await get('/api/products/nope')).json.error, 'Product not found');

    const inv = await get('/api/inventory');
    assert.equal(inv.json.products.length, 2);
    const hoodie = inv.json.products.find((p) => p.id === 'cs-002');
    assert.deepEqual(Object.keys(hoodie.variants[0]).sort(), ['color', 'preorder', 'size', 'sku', 'status', 'stock']);
    assert.deepEqual(hoodie.variants.map((v) => v.status), ['low', 'low', 'preorder', 'instock', 'low', 'low']);
    assert.equal(inv.json.events.length, 2, 'events of draft products hidden');
    assert.equal(inv.json.events[0].sku, 'CS002-WBLK-XXL', 'newest first');
    assert.equal(inv.json.events[0].name, 'Heavyweight Hoodie');
    assert.deepEqual(inv.json.sync, { at: null, status: 'manual', source: 'admin', message: '' });
    assert.ok(inv.json.updatedAt);

    const ups = await get('/api/updates');
    assert.deepEqual(ups.json.updates.map((u) => u.id), ['su-pinned', 'wb-5356000000000003', 'wb-5356000000000001']);
    assert.equal(ups.json.total, 3);
    const page1 = await get('/api/updates?limit=2');
    assert.equal(page1.json.updates.length, 2);
    const page2 = await get(`/api/updates?limit=2&before=${page1.json.updates[1].id}`);
    assert.deepEqual(page2.json.updates.map((u) => u.id), ['wb-5356000000000001']);
    const cat = await get('/api/updates?category=restock');
    assert.deepEqual(cat.json.updates.map((u) => u.id), ['wb-5356000000000003']);
    assert.equal(cat.json.total, 1);
  });

  await t.test('pages: runtime injection, product SEO, 404, redirects, sitemap, robots, static', async () => {
    const home = await get('/');
    assert.equal(home.status, 200);
    assert.match(home.headers['content-type'], /text\/html/);
    assert.match(home.text, /<meta charset="utf-8"><meta name="cola-runtime" content="server"><base href="\/">/);
    assert.equal(home.headers['cache-control'], 'no-cache');
    assert.match(home.headers['content-security-policy'], /default-src 'self'/);

    const page = await get('/products/construction-work-jacket');
    assert.equal(page.status, 200);
    assert.match(page.text, /<title>Construction Work Jacket — Outerwear \| Cola Studio<\/title>/);
    assert.match(page.text, /<meta name="description" content="[^"]*A boxy work jacket cut from 12 oz waxed cotton canvas with triple-stitched seams &amp; a corduroy collar\. &quot;Built to age&quot;\.">/);
    assert.match(page.text, /<link rel="canonical" href="https:\/\/colastudio.com\/products\/construction-work-jacket">/);
    assert.match(page.text, /<meta property="og:url" content="https:\/\/colastudio.com\/products\/construction-work-jacket">/);
    assert.match(page.text, /<meta property="og:image" content="https:\/\/colastudio.com\/uploads\/jacket-front.jpg">/);
    assert.match(page.text, /<meta name="robots" content="index, follow/);
    assert.equal((page.text.match(/cola-runtime/g) || []).length, 1, 'static marker replaced, not duplicated');
    assert.equal((page.text.match(/application\/ld\+json/g) || []).length, 1, 'one JSON-LD block');
    const graph = JSON.parse(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(page.text)[1])['@graph'];
    const ld = graph.find((n) => n['@type'] === 'Product');
    assert.equal(ld.name, 'Construction Work Jacket');
    assert.equal(ld.offers.price, '689.00');
    assert.equal(ld.offers.priceCurrency, 'CNY');
    assert.equal(ld.offers.availability, 'https://schema.org/InStock');
    assert.ok(graph.some((n) => n['@type'] === 'Organization') && graph.some((n) => n['@type'] === 'WebSite'));
    const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList');
    assert.deepEqual(crumbs.itemListElement.map((x) => x.name), ['Home', 'Shop', 'Outerwear', 'Construction Work Jacket']);

    const byId = await get('/products/cs-002');
    assert.equal(byId.status, 301);
    assert.equal(byId.headers.location, '/products/heavyweight-hoodie');
    const hoodie = await get('/products/heavyweight-hoodie');
    assert.match(hoodie.text, /<meta property="og:image" content="https:\/\/colastudio.com\/assets\/brand\/og-image.png">/, 'brand image without product photos');

    // Pretty URLs: static-mode file names redirect once to the canonical address.
    for (const [from, to] of [['/index.html', '/'], ['/products.html?category=tops', '/products?category=tops'], ['/product.html?slug=heavyweight-hoodie&color=Black', '/products/heavyweight-hoodie?color=Black'], ['/updates.html?post=su-pinned', '/updates/su-pinned']]) {
      const r = await get(from);
      assert.equal(r.status, 301, from);
      assert.equal(r.headers.location, to, from);
    }
    // Server-rendered catalogue with crawlable links, category landing pages.
    const shop = await get('/products');
    assert.match(shop.text, /<a href="\/products\/construction-work-jacket">Construction Work Jacket<\/a>/);
    assert.match(shop.text, /<title>Shop the Collection — Cola Studio<\/title>/);
    const outer = await get('/products?category=outerwear&sort=price-asc');
    assert.match(outer.text, /<link rel="canonical" href="https:\/\/colastudio.com\/products\?category=outerwear">/);
    assert.match(outer.text, /<title>Outerwear — Cola Studio<\/title>/);
    assert.doesNotMatch(outer.text, /heavyweight-hoodie"/);

    // One page per studio update + RSS.
    const post = await get('/updates/wb-5356000000000003');
    assert.equal(post.status, 200);
    assert.match(post.text, /<meta property="og:type" content="article">/);
    assert.match(post.text, /<link rel="canonical" href="https:\/\/colastudio.com\/updates\/wb-5356000000000003">/);
    assert.ok(JSON.parse(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(post.text)[1])['@graph'].some((n) => n['@type'] === 'BlogPosting'));
    assert.equal((await get('/updates/wb-5356000000000002')).status, 404, 'pending posts have no page');
    const api1 = await get('/api/updates/wb-5356000000000003');
    assert.equal(api1.json.update.id, 'wb-5356000000000003');
    assert.ok('newer' in api1.json && 'older' in api1.json);
    assert.equal((await get('/api/updates/wb-5356000000000002')).status, 404);
    const feed = await get('/updates/feed.xml');
    assert.match(feed.headers['content-type'], /rss\+xml/);
    assert.match(feed.text, /<link>https:\/\/colastudio.com\/updates\/wb-5356000000000003<\/link>/);
    assert.doesNotMatch(feed.text, /wb-5356000000000002/);

    for (const p of ['/products/secret-draft-tee', '/products/nope', '/definitely-missing', '/missing.css']) {
      const r = await get(p);
      assert.equal(r.status, 404, p);
      assert.match(r.text, /Lost in the studio/);
      assert.match(r.text, /cola-runtime/);
    }
    assert.equal((await get('/about')).status, 404, 'missing page file → 404 page');

    const slash = await get('/products/?category=tops');
    assert.equal(slash.status, 301);
    assert.equal(slash.headers.location, '/products?category=tops');
    assert.equal((await get('/products?category=tops')).status, 200);
    assert.match((await get('/admin')).text, /Admin/);
    assert.match((await get('/admin/')).text, /<base href="\/">/);
    assert.match((await get('/admin/')).text, /<meta name="robots" content="noindex, nofollow">/);
    assert.match((await get('/definitely-missing')).text, /<meta name="robots" content="noindex/);

    const sm = await get('/sitemap.xml');
    assert.match(sm.headers['content-type'], /xml/);
    assert.match(sm.text, /<loc>https:\/\/colastudio.com\/products\/construction-work-jacket<\/loc><lastmod>2026-10-20<\/lastmod>/);
    assert.match(sm.text, /<loc>https:\/\/colastudio.com\/products<\/loc>/);
    assert.match(sm.text, /<image:image><image:loc>https:\/\/colastudio.com\/uploads\/jacket-front.jpg<\/image:loc><\/image:image>/);
    assert.match(sm.text, /<loc>https:\/\/colastudio.com\/updates\/wb-5356000000000003<\/loc>/);
    assert.match(sm.text, /<loc>https:\/\/colastudio.com\/products\?category=outerwear<\/loc>/);
    assert.doesNotMatch(sm.text, /secret-draft-tee|\/admin|\/about|wb-5356000000000002/);
    const robots = await get('/robots.txt');
    assert.match(robots.text, /Disallow: \/admin\nDisallow: \/api\/admin/);
    assert.doesNotMatch(robots.text, /Disallow: \/api\n/, 'public API stays crawlable for rendering');
    assert.match(robots.text, /Sitemap: https:\/\/colastudio.com\/sitemap.xml/);

    const css = await get('/assets/css/site.css', { headers: { 'accept-encoding': 'gzip, br' }, raw: true });
    assert.equal(css.status, 200);
    assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
    assert.equal(css.headers['content-encoding'], 'gzip');
    assert.match(css.headers['cache-control'], /public, max-age=604800/);
    assert.match(zlib.gunzipSync(css.buf).toString(), /fixture stylesheet/);
    assert.equal((await get('/assets/css/site.css', { headers: { 'if-none-match': css.headers.etag } })).status, 304);
    assert.match((await get('/assets/css/site.css?v=3')).headers['cache-control'], /immutable/);
    const range = await get('/assets/css/site.css', { headers: { range: 'bytes=0-9' } });
    assert.equal(range.status, 206);
    assert.equal(range.text.length, 10);
    assert.match((await get('/data/products.json')).headers['cache-control'], /no-cache/);

    for (const p of ['/../package.json', '/%2e%2e/%2e%2e/server.js', '/..%2f..%2fserver.js', '/.env', '/assets/%00x']) {
      const r = await get(p);
      assert.equal(r.status, 404, p);
    }
    assert.equal((await request(base, 'POST', '/about', { body: {} })).status, 405);
  });

  await t.test('admin auth', async () => {
    assert.equal((await get('/api/admin/products')).status, 401);
    assert.equal((await get('/api/admin/products', { headers: { authorization: 'Bearer nope.nope' } })).status, 401);
    const bad = await request(base, 'POST', '/api/admin/login', { body: { password: 'wrong' } });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error, 'Invalid password');
    const ok = await request(base, 'POST', '/api/admin/login', { body: { password: 'test-pass' } });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.token && ok.json.expiresAt);
    token = ok.json.token;
    const me = await admin('GET', '/api/admin/me');
    assert.equal(me.json.ok, true);
    assert.equal(me.json.defaultPassword, false);
    assert.equal(me.headers['cache-control'], 'no-store');
    assert.equal((await request(base, 'POST', '/api/admin/login', { body: '{bad json' })).status, 400);
  });

  await t.test('admin products: create, update, duplicate, stock patch, delete', async () => {
    const list = await admin('GET', '/api/admin/products');
    assert.equal(list.json.products.length, 3, 'includes drafts');

    const created = await admin('POST', '/api/admin/products', {
      name: 'Construction Work Jacket',
      price: 720,
      category: 'outerwear',
      status: 'published',
      colors: [{ name: 'Moss', hex: '#55613F' }],
      variants: [{ color: 'Moss', size: 'M', stock: 6 }, { color: 'Moss', size: 'L', stock: 1 }],
    });
    assert.equal(created.status, 201);
    const p = created.json.product;
    assert.equal(p.id, 'cs-004');
    assert.equal(p.slug, 'construction-work-jacket-2');
    assert.deepEqual(p.variants.map((v) => v.sku), ['CS004-MOSS-M', 'CS004-MOSS-L']);
    assert.ok(p.createdAt && p.updatedAt);
    assert.equal((await admin('POST', '/api/admin/products', { price: 1 })).status, 400);

    const updated = await admin('PUT', `/api/admin/products/${p.id}`, { name: 'Field Jacket', slug: 'field-jacket', subtitle: 'Moss canvas', variants: [{ ...p.variants[0], stock: 4 }, p.variants[1]] });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.product.slug, 'field-jacket');
    assert.equal(updated.json.product.price, 720, 'unspecified fields kept');
    assert.equal(updated.json.product.createdAt, p.createdAt);

    const patched = await admin('PATCH', `/api/admin/products/${p.id}/stock`, { variants: [{ sku: 'CS004-MOSS-L', stock: 0, preorder: true }, { sku: 'NOPE', stock: 1 }] });
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.json.unmatched, ['NOPE']);
    assert.equal(patched.json.changes[0].from, 1);
    assert.equal(patched.json.product.variants[1].preorder, true);
    assert.equal((await admin('PATCH', `/api/admin/products/${p.id}/stock`, { variants: [{ sku: 'CS004-MOSS-M', stock: -1 }] })).status, 400);

    const inv = await get('/api/inventory');
    const evs = inv.json.events.filter((e) => e.productId === p.id);
    assert.deepEqual(evs.map((e) => [e.sku, e.from, e.to, e.source]), [
      ['CS004-MOSS-L', 1, 0, 'admin'],
      ['CS004-MOSS-M', 6, 4, 'admin'],
    ]);

    const dup = await admin('POST', `/api/admin/products/${p.id}/duplicate`);
    assert.equal(dup.status, 201);
    assert.equal(dup.json.product.id, 'cs-005');
    assert.equal(dup.json.product.status, 'draft');
    assert.equal(dup.json.product.variants[0].sku, 'CS005-MOSS-M');

    assert.equal((await admin('DELETE', '/api/admin/products/cs-005')).status, 200);
    assert.equal((await admin('GET', '/api/admin/products/cs-005')).status, 404);
    const again = await admin('POST', '/api/admin/products', { name: 'Next' });
    assert.equal(again.json.product.id, 'cs-006', 'deleted ids are never reused');
    await admin('DELETE', '/api/admin/products/cs-006');

    const page = await get('/products/field-jacket');
    assert.match(page.text, /<title>Field Jacket (— \w+ )?\| Cola Studio<\/title>/);
  });

  await t.test('admin categories, settings, integrations (masked secrets, env overrides)', async () => {
    const cats = await admin('PUT', '/api/admin/categories', [{ name: 'Outerwear', id: 'outerwear', order: 1 }, { name: 'Knitwear' }]);
    assert.deepEqual(cats.json.categories.map((c) => c.id), ['outerwear', 'knitwear']);
    assert.equal((await admin('PUT', '/api/admin/categories', [{ name: 'A' }, { name: 'a' }])).status, 400);

    const s = (await admin('GET', '/api/admin/settings')).json.settings;
    s.announcement.text = 'Hello';
    const put = await admin('PUT', '/api/admin/settings', s);
    assert.equal(put.json.settings.announcement.text, 'Hello');
    assert.equal((await get('/api/site')).json.settings.announcement.text, 'Hello');
    assert.equal((await admin('PUT', '/api/admin/settings', { ...s, currency: { ...s.currency, rates: { EUR: 'x' } } })).status, 400);

    const put1 = await admin('PUT', '/api/admin/integrations', { translation: { anthropicKey: 'sk-ant-supersecret-9876', provider: 'anthropic' } });
    assert.equal(put1.status, 200);
    assert.equal(put1.json.translation.anthropicKey, '••••9876');
    assert.equal(put1.json.weidian.appSecret, '••••1234', 'env value shown masked');
    assert.ok(put1.json._meta.envOverrides.some((o) => o.path === 'weidian.appSecret' && o.env === 'WEIDIAN_APP_SECRET'));
    const put2 = await admin('PUT', '/api/admin/integrations', { ...put1.json, translation: { ...put1.json.translation, model: 'claude-x' } });
    assert.equal(put2.status, 200);
    const priv = JSON.parse(fs.readFileSync(path.join(dataDir, 'private.json'), 'utf8'));
    assert.equal(priv.translation.anthropicKey, 'sk-ant-supersecret-9876', 'masked value kept the old secret');
    assert.equal(priv.translation.model, 'claude-x');
    assert.equal(priv._meta, undefined);
    assert.equal((await admin('PUT', '/api/admin/integrations', { weidian: { provider: 'magic' } })).status, 400);
    const raw = (await admin('GET', '/api/admin/integrations')).text;
    assert.doesNotMatch(raw, /supersecret|env-secret-value/);
  });

  await t.test('uploads', async () => {
    const up = await admin('POST', '/api/admin/upload', { filename: 'Look 01.png', data: `data:image/png;base64,${PNG_1PX}` });
    assert.equal(up.status, 201);
    assert.match(up.json.url, /^\/uploads\/look-01-[0-9a-f]{10}\.png$/);
    const img = await get(up.json.url);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.match(img.headers['cache-control'], /immutable/);
    const list = await admin('GET', '/api/admin/uploads');
    assert.ok(list.json.uploads.some((u) => u.url === up.json.url));
    assert.equal((await admin('POST', '/api/admin/upload', { filename: 'x.svg', data: Buffer.from('<svg><script>1</script></svg>').toString('base64') })).status, 400);
    assert.equal((await admin('DELETE', `/api/admin/uploads/${up.json.name}`)).status, 200);
    assert.equal((await get(up.json.url)).status, 404);
    assert.equal((await admin('DELETE', '/api/admin/uploads/..%2Fdb.json')).status, 400);
  });

  await t.test('contact, orders, notify → admin lists + dashboard', async () => {
    const c = await request(base, 'POST', '/api/contact', { body: { name: 'Ada', email: 'ada@example.com', topic: 'Sizing', message: 'Does the jacket run large?' } });
    assert.equal(c.status, 201);
    assert.match(c.json.id, /^msg-/);
    assert.equal((await request(base, 'POST', '/api/contact', { body: { name: 'Ada', email: 'nope', message: 'x' } })).status, 400);
    const hp = await request(base, 'POST', '/api/contact', { body: { name: 'Bot', email: 'b@b.co', message: 'spam', website: 'http://spam' } });
    assert.equal(hp.json.ok, true);

    const o = await request(base, 'POST', '/api/orders', {
      body: { ref: 'CS-TEST-1', items: [{ productId: 'cs-001', sku: 'CS001-CLAY-M', name: 'Construction Work Jacket', color: 'Clay', size: 'M', qty: 2, price: 689 }], customer: { name: 'Ada', country: 'NL', contact: '+31 6' }, channel: 'whatsapp', currency: 'EUR' },
    });
    assert.equal(o.status, 201);
    assert.equal(o.json.ok, true);
    assert.equal((await request(base, 'POST', '/api/orders', { body: { items: [] } })).status, 400);

    const n = await request(base, 'POST', '/api/notify', { body: { productId: 'cs-001', sku: 'CS001-OFFW-L', contact: 'ada@example.com' } });
    assert.equal(n.status, 201);
    const dup = await request(base, 'POST', '/api/notify', { body: { productId: 'cs-001', sku: 'CS001-OFFW-L', contact: 'ADA@example.com' } });
    assert.equal(dup.json.duplicate, true);
    assert.equal((await request(base, 'POST', '/api/notify', { body: { productId: 'cs-003', sku: 'CS003-OS', contact: 'x@y.z' } })).status, 404, 'draft products cannot be subscribed');

    const msgs = await admin('GET', '/api/admin/messages');
    assert.equal(msgs.json.messages.length, 1);
    assert.equal(msgs.json.messages[0].message, 'Does the jacket run large?');
    const orders = await admin('GET', '/api/admin/orders');
    assert.equal(orders.json.orders[0].ref, 'CS-TEST-1');
    assert.equal(orders.json.orders[0].totalCNY, 1378);
    const notify = await admin('GET', '/api/admin/notify');
    assert.equal(notify.json.notify.length, 1);
    const marked = await admin('PATCH', `/api/admin/messages/${msgs.json.messages[0].id}`, { read: true });
    assert.equal(marked.json.item.read, true);

    const dash = await admin('GET', '/api/admin/dashboard');
    assert.equal(dash.json.counts.messages, 1);
    assert.equal(dash.json.counts.orders, 1);
    assert.equal(dash.json.counts.notify, 1);
    assert.equal(dash.json.counts.updatesPending, 1);
    assert.ok(dash.json.counts.lowStock > 0 && dash.json.counts.soldOut > 0);
    assert.ok(Array.isArray(dash.json.lowStock) && dash.json.lowStock[0].stock === 0);
    assert.equal(dash.json.recentOrders[0].ref, 'CS-TEST-1');
    assert.deepEqual(Object.keys(dash.json.sync).sort(), ['weibo', 'weidian']);

    // CSRF guard: cross-site Origin rejected, same-origin accepted
    const evil = await request(base, 'POST', '/api/contact', { body: { name: 'x', email: 'x@y.co', message: 'hi' }, headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    const same = await request(base, 'POST', '/api/contact', { body: { name: 'x', email: 'x@y.co', message: 'hi' }, headers: { origin: base } });
    assert.equal(same.status, 201);
  });

  await t.test('updates admin + weibo fetch + translate test + media proxy', async () => {
    const created = await admin('POST', '/api/admin/updates', { title: 'Studio update | New Space', textEnglish: 'We moved.', category: 'studio', pinned: false });
    assert.equal(created.status, 201);
    assert.match(created.json.update.id, /^su-/);
    const edited = await admin('PUT', `/api/admin/updates/${created.json.update.id}`, { status: 'hidden', relatedProducts: ['cs-001', 'cs-999'] });
    assert.equal(edited.json.update.status, 'hidden');
    assert.deepEqual(edited.json.update.relatedProducts, ['cs-001']);
    assert.equal((await admin('PUT', `/api/admin/updates/${created.json.update.id}`, { category: 'merch' })).status, 400);
    assert.ok(!(await get('/api/updates')).json.updates.some((u) => u.id === created.json.update.id));

    await admin('PUT', '/api/admin/integrations', { weibo: { uid: '' } }); // default is Cola Studio's account
    const noUid = await admin('POST', '/api/admin/weibo/fetch', {});
    assert.equal(noUid.status, 200);
    assert.equal(noUid.json.ok, false);
    assert.match(noUid.json.errors[0], /uid/);

    await admin('PUT', '/api/admin/integrations', { weibo: { uid: '1234567890', backfill: 3 }, translation: { provider: 'deepl', deeplKey: 'key:fx' } });
    const fetched = await admin('POST', '/api/admin/weibo/fetch', {});
    assert.equal(fetched.status, 200, fetched.text);
    assert.equal(fetched.json.added, 2);
    assert.ok(Array.isArray(fetched.json.log) && fetched.json.log.length > 3);
    const pub = await get('/api/updates');
    const wb = pub.json.updates.find((u) => u.id === 'wb-5356970000000005');
    assert.ok(wb, 'imported post is published');
    assert.equal(wb.category, 'restock');
    assert.match(wb.textEnglish, /^EN \d+$/);
    assert.equal(wb.translation.provider, 'deepl');

    const re = await admin('POST', '/api/admin/weibo/retranslate/wb-5356970000000005');
    assert.equal(re.json.update.translation.provider, 'deepl');
    assert.equal((await admin('POST', '/api/admin/weibo/retranslate/nope')).status, 404);

    const tt = await admin('POST', '/api/admin/translate/test', { text: '新品预售' });
    assert.equal(tt.json.provider, 'deepl');
    assert.equal(tt.json.translation, 'EN 4');
    assert.equal(tt.json.category, 'drop');

    // Deleting a Weibo update tombstones it so a normal fetch does not bring it back.
    assert.equal((await admin('DELETE', '/api/admin/updates/wb-5356970000000005')).status, 200);
    await admin('PUT', '/api/admin/integrations', { weibo: { lastId: null } });
    const refetch = await admin('POST', '/api/admin/weibo/fetch', {});
    assert.ok(!(await admin('GET', '/api/admin/updates')).json.updates.some((u) => u.id === 'wb-5356970000000005'));
    assert.ok(refetch.json.skipped >= 1);

    // Older posts: background history import with status polling.
    const hs0 = await admin('GET', '/api/admin/weibo/history');
    assert.equal(hs0.status, 200);
    assert.equal(hs0.json.translator, true);
    const hs = await admin('POST', '/api/admin/weibo/history', { limit: 50 });
    assert.equal(hs.status, 200, hs.text);
    assert.equal(hs.json.limit, 50);
    let status = hs.json;
    for (let i = 0; i < 100 && status.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 10));
      status = (await admin('GET', '/api/admin/weibo/history')).json;
    }
    assert.equal(status.state, 'done', status.message);
    assert.equal(status.queued, 0);
    assert.ok(status.cursor && status.cursor.at);
    assert.equal((await admin('POST', '/api/admin/weibo/history/stop')).json.state, 'done');
    assert.equal((await request(base, 'GET', '/api/admin/weibo/history')).status, 401);

    // Bulk status change (Publish all pending).
    const ups = (await admin('GET', '/api/admin/updates')).json.updates;
    const wbIds = ups.filter((u) => u.source === 'weibo').map((u) => u.id);
    const hid = await admin('POST', '/api/admin/updates/bulk', { ids: wbIds.slice(0, 2), status: 'pending' });
    assert.deepEqual(hid.json, { ok: true, changed: 2 });
    const pubAll = await admin('POST', '/api/admin/updates/bulk', { fromStatus: 'pending', source: 'weibo', status: 'published' });
    assert.ok(pubAll.json.changed >= 2);
    assert.ok(!(await admin('GET', '/api/admin/updates')).json.updates.some((u) => u.source === 'weibo' && u.status === 'pending'));
    assert.equal((await admin('POST', '/api/admin/updates/bulk', { status: 'nope', fromStatus: 'pending' })).status, 400);
    assert.equal((await admin('POST', '/api/admin/updates/bulk', { status: 'published' })).status, 400);

    const imgUrl = 'https://wx2.sinaimg.cn/large/006hoodie01.jpg';
    const m1 = await get(`/media/weibo?u=${encodeURIComponent(imgUrl)}`);
    assert.equal(m1.status, 200);
    assert.equal(m1.headers['content-type'], 'image/jpeg'); // by cached file extension
    assert.match(m1.headers['cache-control'], /max-age=31536000/);
    const m2 = await get(`/media/weibo?u=${encodeURIComponent(imgUrl)}`);
    assert.equal(m2.status, 200);
    assert.equal(counter.media, 1, 'second request served from disk cache');
    assert.equal((await get(`/media/weibo?u=${encodeURIComponent('https://evil.example/x.jpg')}`)).status, 400);
    assert.equal((await get('/media/weibo?u=http%3A%2F%2Fsinaimg.cn.evil.com%2Fx.jpg')).status, 400);
  });

  await t.test('weidian sync + test via admin (mock provider)', async () => {
    await admin('PUT', '/api/admin/integrations', { weidian: { provider: 'mock' } });
    const dry = await admin('POST', '/api/admin/weidian/sync', { dryRun: true });
    assert.equal(dry.status, 200);
    assert.equal(dry.json.applied, false);
    assert.ok(Array.isArray(dry.json.changes) && Array.isArray(dry.json.unmatched) && Array.isArray(dry.json.errors));
    const real = await admin('POST', '/api/admin/weidian/sync', { productId: 'cs-002' });
    assert.equal(real.json.applied, true);
    const inv = await get('/api/inventory');
    assert.equal(inv.json.sync.source, 'mock');
    assert.equal(inv.json.sync.status, 'ok');
    const tst = await admin('POST', '/api/admin/weidian/test', { itemId: '7781234567' });
    assert.equal(tst.status, 200);
    assert.equal(tst.json.product.id, 'cs-002');
    assert.equal(tst.json.matches.length, 6);
    assert.equal((await admin('POST', '/api/admin/weidian/test', {})).status, 400);
  });

  await t.test('logs, export, import', async () => {
    const logs = await admin('GET', '/api/admin/logs');
    assert.ok(Array.isArray(logs.json.logs));

    const exp = await admin('GET', '/api/admin/export');
    assert.match(exp.headers['content-disposition'], /attachment; filename="cola-studio-backup-\d{4}-\d{2}-\d{2}\.json"/);
    assert.equal(exp.json.format, 'cola-studio-backup');
    assert.doesNotMatch(exp.text, /supersecret|deeplKey|appSecret/);
    const backup = exp.json;

    await admin('DELETE', '/api/admin/products/cs-001');
    assert.equal((await get('/api/products/construction-work-jacket')).status, 404);
    const imp = await admin('POST', '/api/admin/import', backup);
    assert.equal(imp.status, 200, imp.text);
    assert.equal(imp.json.imported.products, backup.products.length);
    assert.match(imp.json.backup, /pre-import/);
    assert.equal((await get('/api/products/construction-work-jacket')).status, 200);
    assert.equal((await admin('POST', '/api/admin/import', { foo: 1 })).status, 400);
    assert.equal((await admin('POST', '/api/admin/import', { products: {} })).status, 400);
    const created = await admin('POST', '/api/admin/products', { name: 'After import' });
    assert.equal(created.json.product.id, 'cs-007', 'id sequence survives import');
  });

  await t.test('API 404/405 and login rate limit', async () => {
    assert.equal((await get('/api/nope')).status, 404);
    const m = await request(base, 'DELETE', '/api/products');
    assert.equal(m.status, 405);
    assert.equal(m.headers.allow, 'GET');
    let last;
    for (let i = 0; i < 11; i++) last = await request(base, 'POST', '/api/admin/login', { body: { password: 'wrong' } });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers['retry-after']) > 0);
  });

  await t.test('db.json persisted on close-able store', async () => {
    app.store.flush();
    const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
    assert.ok(db.products.some((p) => p.name === 'After import'));
  });
});

test('production without ADMIN_PASSWORD disables admin login', async (t) => {
  const dataDir = tmpDir();
  const app = createApp({
    env: { NODE_ENV: 'production', DATA_DIR: dataDir, PUBLIC_DIR: path.join(FIXTURES, 'public'), LOG_SILENT: '1', DISABLE_SCHEDULERS: '1' },
    fetch: fakeFetch([]),
  });
  const addr = await app.listen(0, '127.0.0.1');
  t.after(async () => {
    await app.close();
    rmrf(dataDir);
  });
  const r = await request(`http://127.0.0.1:${addr.port}`, 'POST', '/api/admin/login', { body: { password: 'colastudio' } });
  assert.equal(r.status, 503);
});
