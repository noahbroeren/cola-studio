'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  WeidianService,
  parseItemResponse,
  parseFeed,
  matchSkus,
  matchByTitle,
  toYuan,
} = require('../server/services/weidian');
const { Store } = require('../server/lib/store');
const { tmpDir, rmrf, fixtureJson, fixture, fakeFetch, noSleep, silentLog, FIXTURES } = require('./helpers');

const HOODIE = {
  id: 'cs-002',
  variants: [
    { sku: 'CS002-WBLK-M', color: 'Washed Black', size: 'M', stock: 3, weidianSkuId: '90001' },
    { sku: 'CS002-WBLK-L', color: 'Washed Black', size: 'L', stock: 2, weidianSkuId: '' },
    { sku: 'CS002-WBLK-XXL', color: 'Washed Black', size: 'XXL', stock: 0, weidianSkuId: '' },
    { sku: 'CS002-CLAY-M', color: 'Clay', size: 'M', stock: 12, weidianSkuId: '' },
    { sku: 'CS002-CLAY-L', color: 'Clay', size: 'L', stock: 3, weidianSkuId: '' },
    { sku: 'CS002-CLAY-XXL', color: 'Clay', size: 'XXL', stock: 1, weidianSkuId: '' },
  ],
};

test('tolerant parser: thor-style response (nested skuInfo, prices in fen)', () => {
  const item = parseItemResponse(fixtureJson('weidian', 'thor-item.json'));
  assert.equal(item.title, 'Cola Studio 重磅连帽卫衣 480g毛圈');
  assert.equal(item.price, 499);
  assert.deepEqual(item.images, ['https://si.geilicdn.com/pcitem1234-main.jpg?w=750&h=750']);
  assert.equal(item.skus.length, 7);
  assert.deepEqual(item.skus[0], { skuId: '90001', sku: '', title: '黑色;M', stock: 7, price: 499 });
});

test('tolerant parser: open-api style (string numbers, yuan prices) and attrIds-only titles', () => {
  const item = parseItemResponse(fixtureJson('weidian', 'openapi-item.json'));
  assert.equal(item.title, 'Construction Work Jacket 工装夹克');
  assert.equal(item.price, 689);
  assert.equal(item.images.length, 2);
  assert.deepEqual(item.skus.map((s) => [s.skuId, s.title, s.stock, s.sku]), [
    ['3301', 'Clay / S', 2, ''],
    ['3302', 'Clay / M', 5, 'CS001-CLAY-M'],
    ['3303', 'Off-White-L', 4, ''],
  ]);

  // Titles rebuilt from attrIds + attrList when the SKU has no title; deep nesting; unknown wrapper keys.
  const weird = {
    code: 0,
    payload: {
      deep: {
        attrs: [{ attrTitle: '颜色', attrValues: [{ attrId: 1, attrValue: 'Clay' }] }, { attrTitle: '尺码', attrValues: [{ attrId: 7, attrValue: 'L' }] }],
        skuList: [{ skuId: 55, attrIds: [1, 7], quantity: '6', salePrice: '499.00' }],
      },
    },
  };
  assert.deepEqual(parseItemResponse(weird).skus, [{ skuId: '55', sku: '', title: 'Clay;L', stock: 6, price: 499 }]);

  assert.throws(() => parseItemResponse({ status: { code: 2, message: '商品不存在' } }), /商品不存在/);
  assert.throws(() => parseItemResponse({ status: { status_code: 10013, status_reason: 'token invalid' } }), /token invalid/);
});

test('toYuan auto/cent/yuan', () => {
  assert.equal(toYuan(49900), 499);
  assert.equal(toYuan('689.00'), 689);
  assert.equal(toYuan(689, 'yuan'), 689);
  assert.equal(toYuan('68900', 'cent'), 689);
  assert.equal(toYuan(null), null);
});

test('matching order: weidianSkuId → exact sku → parsed title with aliases', () => {
  const skus = parseItemResponse(fixtureJson('weidian', 'thor-item.json')).skus;
  const { matches, unmatched } = matchSkus(HOODIE, skus, { colorAliases: { 陶土色: 'Clay' }, sizeAliases: {} });
  const bySku = Object.fromEntries(matches.map((m) => [m.variant.sku, [m.sku.stock, m.by]]));
  assert.deepEqual(bySku['CS002-WBLK-M'], [7, 'weidianSkuId']);
  assert.deepEqual(bySku['CS002-WBLK-L'], [0, 'title']); // 黑色 → Black ⊂ Washed Black
  assert.deepEqual(bySku['CS002-WBLK-XXL'], [4, 'title']); // 2XL → XXL (built-in alias)
  assert.deepEqual(bySku['CS002-CLAY-M'], [9, 'title']); // custom colour alias
  assert.equal(matches.length, 6);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].title, '陶土色;3XL 定制');

  const jacket = {
    variants: [
      { sku: 'CS001-CLAY-S', color: 'Clay', size: 'S' },
      { sku: 'CS001-CLAY-M', color: 'Clay', size: 'M' },
      { sku: 'CS001-OFFW-L', color: 'Off-White', size: 'L' },
    ],
  };
  const r = matchSkus(jacket, parseItemResponse(fixtureJson('weidian', 'openapi-item.json')).skus);
  assert.deepEqual(r.matches.map((m) => [m.variant.sku, m.by]), [
    ['CS001-CLAY-S', 'title'],
    ['CS001-CLAY-M', 'sku'],
    ['CS001-OFFW-L', 'title'],
  ]);
});

test('matchByTitle formats: "颜色:x;尺码:y", "Color - Size", single-size products, ambiguity', () => {
  const v = [
    { sku: 'A', color: 'Off White', size: 'OS' },
    { sku: 'B', color: 'Black', size: 'OS' },
  ];
  const aliases = { sizeAliases: { 均码: 'OS' }, colorAliases: { 黑色: 'Black' } };
  assert.equal(matchByTitle(v, '颜色:黑色;尺码:均码', aliases).sku, 'B');
  assert.equal(matchByTitle(v, 'Off-White - OS', aliases).sku, 'A');
  assert.equal(matchByTitle(v, '黑色', aliases).sku, 'B'); // one size → colour alone is enough
  const sizes = [
    { sku: 'S1', color: 'Navy', size: 'S' },
    { sku: 'M1', color: 'Navy', size: 'M' },
  ];
  assert.equal(matchByTitle(sizes, 'M', aliases).sku, 'M1'); // one colour → size alone
  assert.equal(matchByTitle(v, 'OS', aliases), null); // ambiguous
});

function setupService({ provider = 'public-item', routes = [], cfg = {} } = {}) {
  const dir = tmpDir();
  const store = new Store({ dataDir: dir, publicDir: path.join(FIXTURES, 'public'), log: silentLog() }).init();
  Object.assign(store.private.weidian, { provider, delayMs: 0, colorAliases: { 陶土色: 'Clay' }, ...cfg });
  const fetch = fakeFetch(routes);
  const svc = new WeidianService({ getConfig: () => store.private.weidian, store, log: silentLog(), fetch, sleep: noSleep, now: () => Date.parse('2026-10-26T12:00:00Z') });
  return { dir, store, fetch, svc };
}

test('public-item sync: dry run reports a diff without writing, then applies with events + mappings', async (t) => {
  const routes = [
    [
      (u) => u.startsWith('https://thor.weidian.com/detail/getItemSkuInfo/1.0?param=') && decodeURIComponent(u).includes('"itemId":"7781234567"'),
      (u, init) => {
        assert.equal(init.headers.Referer, 'https://weidian.com/');
        assert.match(init.headers['User-Agent'], /iPhone/);
        return fixtureJson('weidian', 'thor-item.json');
      },
    ],
    [(u) => decodeURIComponent(u).includes('"itemId":"6660001112"'), () => ({ status: { code: 0 }, result: { skuInfos: [{ skuInfo: { id: 1, title: 'Clay;S', stock: 4 } }] } })],
  ];
  const { dir, store, svc } = setupService({ routes });
  t.after(() => rmrf(dir));
  const before = JSON.stringify(store.db.products);
  const eventsBefore = store.db.inventoryEvents.length;

  const dry = await svc.sync({ dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.applied, false);
  assert.deepEqual(dry.errors, []);
  assert.equal(dry.items, 2);
  const diff = Object.fromEntries(dry.changes.map((c) => [c.sku, [c.from, c.to]]));
  assert.deepEqual(diff, {
    'CS002-WBLK-M': [3, 7],
    'CS002-WBLK-L': [2, 0],
    'CS002-WBLK-XXL': [0, 4],
    'CS002-CLAY-M': [12, 9],
    'CS002-CLAY-XXL': [1, 0],
  });
  assert.equal(dry.unmatched.length, 1);
  assert.equal(dry.unmatched[0].productId, 'cs-002');
  assert.equal(JSON.stringify(store.db.products), before, 'dry run must not modify products');
  assert.equal(store.db.inventoryEvents.length, eventsBefore);

  const real = await svc.sync();
  assert.equal(real.applied, true);
  assert.equal(real.changed, 5);
  const hoodie = store.db.products.find((p) => p.id === 'cs-002');
  assert.equal(hoodie.variants.find((v) => v.sku === 'CS002-WBLK-M').stock, 7);
  assert.equal(hoodie.variants.find((v) => v.sku === 'CS002-CLAY-M').weidianSkuId, '90004', 'mapping learned');
  assert.equal(hoodie.weidian.lastSyncedAt, '2026-10-26T12:00:00.000Z');
  const newEvents = store.db.inventoryEvents.slice(eventsBefore);
  assert.equal(newEvents.length, 5);
  assert.ok(newEvents.every((e) => e.source === 'weidian'));
  assert.equal(store.db.meta.sync.weidian.status, 'ok');
  assert.equal(store.db.meta.sync.weidian.source, 'public-item');
  assert.equal(store.db.meta.sync.weidian.changed, 5);

  // Second pass: no further changes.
  const again = await svc.sync({ dryRun: true });
  assert.equal(again.changes.length, 0);
});

test('sync records per-item errors and syncInfo price/images only when enabled', async (t) => {
  const routes = [
    [(u) => decodeURIComponent(u).includes('7781234567'), () => new Response('<html>blocked</html>', { status: 200 })],
    [(u) => decodeURIComponent(u).includes('6660001112'), () => fixtureJson('weidian', 'openapi-item.json')],
  ];
  const { dir, store, svc } = setupService({ routes, cfg: { priceUnit: 'yuan' } });
  t.after(() => rmrf(dir));
  store.db.products.find((p) => p.id === 'cs-001').weidian.syncInfo = true;
  store.db.products.find((p) => p.id === 'cs-001').price = 650;
  const r = await svc.sync({ dryRun: true });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].error, /non-JSON/);
  assert.deepEqual(r.infoChanges.find((c) => c.field === 'price'), { productId: 'cs-001', field: 'price', from: 650, to: 689 });
  assert.ok(r.infoChanges.find((c) => c.field === 'weidian.title'));
  assert.ok(!r.infoChanges.find((c) => c.field === 'images'), 'product already has images');
  const applied = await svc.sync();
  assert.equal(store.db.products.find((p) => p.id === 'cs-001').price, 689);
  assert.equal(store.db.meta.sync.weidian.status, 'partial');
  assert.equal(applied.ok, true);
});

test('open-api provider: token fetched once and cached, item call with public/param', async (t) => {
  let tokenCalls = 0;
  const routes = [
    [
      'oauth.open.weidian.com/token',
      (u) => {
        tokenCalls++;
        assert.match(u, /appkey=AK&secret=SECRET/);
        return { status: { status_code: 0 }, result: { access_token: 'tok-1', expire_in: 7200 } };
      },
    ],
    [
      'api.vdian.com/api',
      (u) => {
        const q = new URL(u).searchParams;
        const pub = JSON.parse(q.get('public'));
        assert.equal(pub.method, 'vdian.item.get');
        assert.equal(pub.access_token, 'tok-1');
        assert.ok(JSON.parse(q.get('param')).itemid);
        return fixtureJson('weidian', 'openapi-item.json');
      },
    ],
  ];
  const { dir, svc } = setupService({ provider: 'open-api', routes, cfg: { appKey: 'AK', appSecret: 'SECRET' } });
  t.after(() => rmrf(dir));
  const r = await svc.sync({ dryRun: true });
  assert.equal(r.errors.length, 0);
  assert.equal(tokenCalls, 1);
  const test1 = await svc.test('6660001112');
  assert.equal(test1.product.id, 'cs-001');
  assert.equal(test1.matches.length, 3);
  assert.equal(tokenCalls, 1, 'token cached');
});

test('json-feed provider (CSV and JSON) + feed parser', async (t) => {
  const csv = 'productId;sku;stock\ncs-001;CS001-CLAY-S;1\ncs-001;CS001-OFFW-L;"5"\nghost;X;3\n';
  const rows = parseFeed(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], { productId: 'cs-001', sku: 'CS001-OFFW-L', stock: '5' });
  assert.deepEqual(parseFeed('{"rows":[{"slug":"heavyweight-hoodie","Color":"Clay","Size":"L","Stock":8}]}')[0], {
    slug: 'heavyweight-hoodie',
    color: 'Clay',
    size: 'L',
    stock: 8,
  });

  const { dir, store, svc } = setupService({ provider: 'json-feed', cfg: { feedUrl: 'https://sheet.example/feed.csv' }, routes: [['sheet.example', () => new Response(csv)]] });
  t.after(() => rmrf(dir));
  const r = await svc.sync();
  assert.deepEqual(r.changes.map((c) => [c.sku, c.from, c.to]), [
    ['CS001-CLAY-S', 4, 1],
    ['CS001-OFFW-L', 0, 5],
  ]);
  assert.equal(r.unmatched[0].reason, 'no product for this row');
  assert.equal(store.db.products[0].variants[0].stock, 1);
});

test('mock provider is deterministic for a given time slot', async (t) => {
  const a = setupService({ provider: 'mock' });
  const b = setupService({ provider: 'mock' });
  t.after(() => {
    rmrf(a.dir);
    rmrf(b.dir);
  });
  const ra = await a.svc.sync({ dryRun: true });
  const rb = await b.svc.sync({ dryRun: true });
  assert.deepEqual(ra.changes, rb.changes);
  assert.ok(ra.items >= 2);
  assert.equal(ra.unmatched.length, 0);
  await assert.rejects(Promise.all([a.svc.sync(), a.svc.sync()]), /already running/);
});

test('fixture files are valid', () => {
  assert.ok(fixture('weidian', 'thor-item.json').length > 100);
});

test('public-item can go through a scraping service (fetchVia) without changing the parsing', async (t) => {
  const { viaService } = require('../server/services/weidian');
  assert.equal(viaService('', 'https://thor.weidian.com/x?a=1'), 'https://thor.weidian.com/x?a=1');
  assert.equal(viaService('https://api.scraperapi.com/?api_key=K&url={url}', 'https://thor.weidian.com/x?a=1'), 'https://api.scraperapi.com/?api_key=K&url=' + encodeURIComponent('https://thor.weidian.com/x?a=1'));
  assert.equal(viaService('https://proxy.example/fetch?u=', 'https://w/x'), 'https://proxy.example/fetch?u=' + encodeURIComponent('https://w/x'));
  assert.throws(() => viaService('http://insecure/?url={url}', 'https://w/x'), /https/);
  const routes = [
    [
      (u) => u.startsWith('https://api.scraperapi.com/?api_key=SECRET&url=') && decodeURIComponent(decodeURIComponent(u)).includes('"itemId":"7781234567"'),
      () => fixtureJson('weidian', 'thor-item.json'),
    ],
  ];
  const { dir, svc } = setupService({ routes, cfg: { fetchVia: 'https://api.scraperapi.com/?api_key=SECRET&url={url}' } });
  t.after(() => rmrf(dir));
  const { item } = await svc.fetchItem('7781234567');
  assert.ok(item.skus.length > 0);
});
