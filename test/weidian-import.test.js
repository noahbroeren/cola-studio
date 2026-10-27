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
  let descCalls = 0;
  let visionCalls = 0;
  let claudeFetches = 0;
  const claudeUrls = [];
  const routes = [
    [
      (u) => u.includes('getDetailDesc') && decodeURIComponent(u).includes('7781239999'),
      () => ({
        status: { code: 0, message: 'OK' },
        result: {
          item_detail: {
            desc_content: [
              { type: 1, text: '面料：480g 毛圈棉\n宽松版型' },
              { type: 2, url: 'https://si.geilicdn.com/weidian1234567-desc01_790_1100.jpg?w=750' },
              { type: 2, url: 'https://si.geilicdn.com/weidian1234567-sizechart_790_900.jpg' },
            ],
          },
        },
      }),
    ],
    [(u) => u.includes('getDetailDesc'), () => new Response('blocked', { status: 403 })],
    [
      (u) => u.includes('weidian.com/item.html') && u.includes('7781239999'),
      () =>
        '<html><head><title>Cola Studio 重磅连帽卫衣 - 微店</title></head><body><script>window.__DATA__ = {"itemInfo":{"itemName":"Cola Studio 重磅连帽卫衣","imgs":["https:\\/\\/si.geilicdn.com\\/weidian1234567-g1_1080_1080.jpg","//si.geilicdn.com/weidian1234567-g2_1080_1080.jpg.webp?w=750&h=750&cp=1"]}};</script>' +
        '<img src="https://si.geilicdn.com/hz_img_icon_42_42_unadjust.png"><img src="https://si.geilicdn.com/weidian9999999-other-shop_800_800.jpg"></body></html>',
    ],
    [(u) => u.includes('weidian.com/item.html'), () => new Response('captcha', { status: 200 })],
    [(u) => u.startsWith('https://thor.weidian.com/') && decodeURIComponent(u).includes('7781239999'), () => fixtureJson('weidian', 'thor-item.json')],
    [(u) => u.startsWith('https://thor.weidian.com/') && decodeURIComponent(u).includes('1000000001'), () => ({ status: { code: 9, message: '商品不存在' }, result: null })],
    [(u) => u.startsWith('https://thor.weidian.com/') && decodeURIComponent(u).includes('2000000002'), () => ({ status: { code: 0 }, result: { itemId: '2000000002', itemTitle: '军绿色帆布托特包', itemMainPic: 'https://si.geilicdn.com/wdseller1234567-tote_1080_1080.jpg', itemDiscountLowPrice: 19900, itemStock: 999999999 } })],
    [
      'api.anthropic.com',
      (u, init) => {
        const body = JSON.parse(init.body);
        if (body.tools) {
          claudeFetches++;
          claudeUrls.push(decodeURIComponent(/https:\/\/\S+/.exec(body.messages[0].content)[0]));
          return { content: [{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } }] };
        }
        if (Array.isArray(body.messages[0].content)) {
          visionCalls++;
          const imgs = body.messages[0].content.filter((x) => x.type === 'image');
          assert.ok(imgs.length >= 2 && imgs.every((x) => x.source.type === 'base64'));
          return { content: [{ type: 'text', text: JSON.stringify({ index: 1, unit: 'cm', columns: ['Length', 'Chest'], rows: [{ size: 'M', values: ['70', '120'] }, { size: '2XL', values: ['74', 128] }] }) }] };
        }
        if (/product descriptions/.test(body.system)) {
          // describeProduct: house structure, from the seller's notes
          descCalls++;
          const input = JSON.parse(body.messages[0].content);
          assert.ok(input.notes.some((l) => /面料/.test(l)), 'seller notes are sent');
          assert.match(body.system, /\*\*Fabric:\*\*/);
          assert.doesNotMatch(body.system, /\*\*Care:\*\*/, 'no care line in the structure');
          return { content: [{ type: 'text', text: 'Heavyweight hoodie in a dense loopback terry.\n\n**Fabric:** 480 g loopback cotton\n**Fit:** Relaxed' }] };
        }
        if (/description/.test(body.system)) {
          const lines = JSON.parse(body.messages[0].content);
          return { content: [{ type: 'text', text: JSON.stringify(lines.map((l) => (/面料/.test(l) ? 'Fabric: 480 g loopback cotton' : 'Relaxed fit'))) }] };
        }
        translateCalls++;
        const input = JSON.parse(body.messages[0].content);
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
  const r = await admin('POST', '/api/admin/weidian/import', { items: 'https://weidian.com/item.html?itemID=7781239999\n1000000001\n2000000002' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.translated, true);
  assert.equal(translateCalls, 1, 'one translation call per batch');
  const [good, bad] = r.json.results;
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Weidian error 9/);
  // An item without colour/size options becomes one variant; the colour comes from the title; stock is capped.
  const single = r.json.results[2].draft;
  assert.deepEqual(single.sizes, ['OS']);
  assert.deepEqual(single.colors.map((c) => c.name), ['Olive']);
  assert.equal(single.variants[0].stock, 999);
  assert.equal(single.price, 199);
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

  // Full scrape: gallery from the item page, colour photos, description + detail photos, size chart.
  const urls = d.images.map((im) => decodeURIComponent(im.url.replace('/media/img?u=', '')));
  assert.deepEqual(urls.slice(0, 3), ['https://si.geilicdn.com/weidian1234567-g1_1080_1080.jpg', 'https://si.geilicdn.com/weidian1234567-g2_1080_1080.jpg', 'https://si.geilicdn.com/pcitem1234-main.jpg']);
  assert.ok(!urls.some((u) => /icon|other-shop/.test(u)), 'no icons or other shops’ pictures');
  assert.equal(d.images.find((im) => /clay\.jpg/.test(im.url)).color, 'Clay', 'colour photo tagged (after translation)');
  assert.equal(d.description, 'Heavyweight hoodie in a dense loopback terry.\n\n**Fabric:** 480 g loopback cotton\n**Fit:** Relaxed');
  assert.equal(d.descriptionOriginal, '面料：480g 毛圈棉\n宽松版型', 'seller text kept for later rewrites');
  assert.equal(descCalls, 1);
  assert.equal(visionCalls, 1);
  assert.match(decodeURIComponent(d.sizeChartImage), /sizechart_790_900\.jpg$/);
  assert.equal(d.detailImages[0].url, d.sizeChartImage, 'size chart first among the detail photos');
  assert.equal(d.detailImages.length, 2);
  assert.deepEqual(d.measurements, { unit: 'cm', columns: ['Length', 'Chest'], rows: [{ size: 'M', values: ['70', '120'] }, { size: 'XXL', values: ['74', '128'] }] });
  assert.equal(good.sizeChart, true);
  assert.match(good.sources.description, /^direct · 2 photo/);
  assert.match(good.sources.page, /^direct · 2 gallery/);
  assert.ok(claudeFetches >= 1);
  assert.ok(!claudeUrls.some((u) => u.includes('7781239999')), 'Claude fetch only when a direct request fails');
  assert.ok(claudeUrls.some((u) => u.includes('1000000001')));

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

  // 2b) "Rewrite descriptions" works from the seller's original text; a dry run changes nothing
  assert.equal(created.descriptionOriginal, '面料：480g 毛圈棉\n宽松版型');
  const dry = await admin('POST', '/api/admin/products/describe', { ids: [created.id], dryRun: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  assert.deepEqual(dry.json.updated, []);
  assert.match(dry.json.results[0].description, /^Heavyweight hoodie/);
  const rw = await admin('POST', '/api/admin/products/describe', { ids: [created.id, 'CS-404'] });
  assert.deepEqual(rw.json.updated, [created.id]);
  assert.equal(descCalls, 3);
  assert.match((await admin('GET', `/api/admin/products/${created.id}`)).json.product.description, /\*\*Fabric:\*\* 480 g loopback cotton/);

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
