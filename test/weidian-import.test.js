'use strict';
/** Import from Weidian (links → drafts) and the spreadsheet bulk endpoint, end to end. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const path = require('node:path');
const { createApp } = require('../server/app');
const { extractItemIds, splitSkuTitle, sizeToken, sortSizes, cleanTitle } = require('../server/services/weidian-import');
const { DEFAULT_SIZE_ALIASES: SA, DEFAULT_COLOR_ALIASES: CA } = require('../server/services/weidian');
const { tmpDir, rmrf, copyDir, fakeFetch, fixtureJson, noSleep, FIXTURES } = require('./helpers');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function request(base, method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(new URL(urlPath, base), { method, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        if (res.headers['content-encoding'] === 'gzip') buf = zlib.gunzipSync(buf);
        let json;
        try {
          json = JSON.parse(buf.toString('utf8'));
        } catch {
          /* binary */
        }
        resolve({ status: res.statusCode, headers: res.headers, json, buf });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('item ids are found in links, JSON and plain numbers', () => {
  assert.deepEqual(
    extractItemIds('https://weidian.com/item.html?itemID=7781234567&wfr=c\nhttps://shop1.v.weidian.com/item.html?itemID=6660001112 {"itemId":"5550001113"} 7781234567 itemID%3D4440001114 order 12'),
    ['7781234567', '6660001112', '5550001113', '4440001114']
  );
  assert.deepEqual(extractItemIds(['7781234567', 'x']), ['7781234567']);
});

test('SKU titles split into colour + size in the usual Weidian spellings', () => {
  const o = { sizeAliases: SA, colorAliases: CA };
  const cases = {
    '黑色;M': ['Black', 'M'],
    '颜色:黑色;尺码:均码': ['Black', 'OS'],
    'Washed Black / XL': ['Washed Black', 'XL'],
    'Off-White-M': ['Off-White', 'M'],
    '黑色 M码': ['Black', 'M'],
    '灰色;XL(建议160-180斤)': ['Grey', 'XL'],
    '藏青;S/M': ['Navy', 'S/M'],
    黑色: ['Black', 'OS'],
    L: ['Default', 'L'],
  };
  for (const [t, [color, size]] of Object.entries(cases)) {
    const r = splitSkuTitle(t, o);
    assert.equal(r.color, color, t);
    assert.equal(r.size, size, t);
  }
  assert.equal(sizeToken('2XL', SA), 'XXL');
  assert.equal(sizeToken('3XL 定制', SA), 'XXXL');
  assert.equal(sizeToken('黑色', SA), null);
  assert.deepEqual(sortSizes(['XL', 'S', 'XXL', 'M']), ['S', 'M', 'XL', 'XXL']);
  assert.equal(cleanTitle('【新品】 Cola Studio 卫衣  [预售]'), 'Cola Studio 卫衣');
});

test('Weidian import + bulk create through the admin API', async (t) => {
  const dataDir = tmpDir();
  const publicDir = tmpDir();
  copyDir(path.join(FIXTURES, 'public'), publicDir);
  let translateCalls = 0;
  const routes = [
    [(u) => u.startsWith('https://thor.weidian.com/') && decodeURIComponent(u).includes('7781239999'), () => fixtureJson('weidian', 'thor-item.json')],
    [(u) => u.startsWith('https://thor.weidian.com/') && decodeURIComponent(u).includes('1000000001'), () => ({ status: { code: 0 }, result: { itemTitle: 'Empty', skuInfos: [] } })],
    [
      'api.anthropic.com',
      (u, init) => {
        translateCalls++;
        const input = JSON.parse(JSON.parse(init.body).messages[0].content);
        const map = { 陶土色: 'Clay' };
        const out = input.map((s) => (map[s] ? map[s] : /卫衣/.test(s) ? 'Cola Studio Heavyweight Hoodie 480g Terry' : s));
        return { model: 'test', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    ],
    ['geilicdn.com', () => new Response(Buffer.from(PNG_1PX, 'base64'), { headers: { 'content-type': 'image/png' } })],
  ];
  const app = createApp({
    env: { DATA_DIR: dataDir, PUBLIC_DIR: publicDir, LOG_SILENT: '1', DISABLE_SCHEDULERS: '1', DISABLE_MEDIA_PREFETCH: '1', ADMIN_PASSWORD: 'test-pass', ANTHROPIC_API_KEY: 'sk-test', TRANSLATION_PROVIDER: 'anthropic' },
    fetch: fakeFetch(routes),
    sleep: noSleep,
  });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  t.after(async () => {
    await app.close();
    rmrf(dataDir);
    rmrf(publicDir);
  });
  const login = await request(base, 'POST', '/api/admin/login', { body: { password: 'test-pass' } });
  const auth = { authorization: `Bearer ${login.json.token}` };
  const admin = (method, p, body) => request(base, method, p, { body, headers: auth });

  // 1) preview: one good item, one without SKUs
  const r = await admin('POST', '/api/admin/weidian/import', { items: 'https://weidian.com/item.html?itemID=7781239999\n1000000001' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.translated, true);
  assert.equal(translateCalls, 1, 'one translation call per batch');
  const [good, bad] = r.json.results;
  assert.equal(bad.ok, false);
  assert.match(bad.error, /no colours\/sizes/);
  const d = good.draft;
  assert.equal(d.name, 'Cola Studio Heavyweight Hoodie 480g Terry');
  assert.equal(d.status, 'draft');
  assert.equal(d.price, 499);
  assert.deepEqual(d.colors.map((c) => c.name), ['Black', 'Clay']);
  assert.deepEqual(d.sizes, ['M', 'L', 'XXL', 'XXXL']);
  assert.equal(d.variants.find((v) => v.color === 'Clay' && v.size === 'M').stock, 9);
  assert.equal(d.variants.find((v) => v.color === 'Clay' && v.size === 'M').weidianSkuId, '90004');
  assert.equal(d.weidian.itemId, '7781239999');
  assert.equal(d.weidian.syncEnabled, true);
  assert.match(d.images[0].url, /^\/media\/img\?u=https%3A%2F%2Fsi\.geilicdn\.com/);
  assert.equal(d.garment, 'hoodie');

  // 2) create through the bulk endpoint (nothing saved by the preview)
  const before = (await admin('GET', '/api/admin/products')).json.products.length;
  const bulk = await admin('POST', '/api/admin/products/bulk', { items: [{ input: d, row: 1 }] });
  assert.equal(bulk.status, 200, JSON.stringify(bulk.json));
  assert.equal(bulk.json.created.length, 1);
  assert.ok(bulk.json.backup, 'a backup snapshot is made first');
  const created = (await admin('GET', `/api/admin/products/${bulk.json.created[0]}`)).json.product;
  assert.equal(created.variants.length, 8);
  assert.ok(created.variants.every((v) => v.sku), 'SKUs generated');
  assert.equal((await admin('GET', '/api/admin/products')).json.products.length, before + 1);

  // 3) the same link again is skipped as "already on the site"
  const again = await admin('POST', '/api/admin/weidian/import', { items: ['7781239999'] });
  assert.equal(again.json.results[0].skipped, true);
  assert.equal(again.json.results[0].existing.id, created.id);

  // 4) photos come through the media proxy
  const img = await request(base, 'GET', d.images[0].url);
  assert.equal(img.status, 200);
  assert.match(img.headers['content-type'], /^image\//);

  // 5) bulk is all-or-nothing: one bad item → 400 with the row, nothing changed
  const fail = await admin('POST', '/api/admin/products/bulk', { items: [{ id: created.id, input: { name: 'Renamed' }, row: 2 }, { input: { name: '' }, row: 3 }] });
  assert.equal(fail.status, 400);
  assert.match(fail.json.error, /Row 3: name is required/);
  assert.equal((await admin('GET', `/api/admin/products/${created.id}`)).json.product.name, created.name);

  // 6) update + remove in one batch, stock change logged as an import event
  const others = (await admin('GET', '/api/admin/products')).json.products.filter((p) => p.id !== created.id);
  const v0 = created.variants[0];
  const upd = await admin('POST', '/api/admin/products/bulk', {
    items: [{ id: created.id, input: { name: 'Heavyweight Hoodie', variants: created.variants.map((v) => (v.sku === v0.sku ? { ...v, stock: 42 } : v)) } }],
    remove: [others[0].id],
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.removed, 1);
  const after = (await admin('GET', '/api/admin/products')).json.products;
  assert.equal(after.length, before);
  assert.equal(after.find((p) => p.id === created.id).variants.find((v) => v.sku === v0.sku).stock, 42);

  // 7) json-feed provider cannot import
  await admin('PUT', '/api/admin/integrations', { weidian: { provider: 'json-feed' } });
  const nope = await admin('POST', '/api/admin/weidian/import', { items: ['7781239999'] });
  assert.equal(nope.status, 400);
  assert.match(nope.json.error, /Public item page/);
});
