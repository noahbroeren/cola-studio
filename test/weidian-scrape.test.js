'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const scrape = require('../server/services/weidian-scrape');
const { WeidianService } = require('../server/services/weidian');
const { createTranslator } = require('../server/services/translate');
const { fakeFetch, silentLog } = require('./helpers');

test('image URLs: cleaned, sized, deduplicated, icons and scripts dropped', () => {
  assert.equal(scrape.cleanImageUrl('//si.geilicdn.com/weidian123-abc_1080_1080.jpg.webp?w=750&h=750&cp=1'), 'https://si.geilicdn.com/weidian123-abc_1080_1080.jpg');
  assert.equal(scrape.cleanImageUrl('https:\\/\\/si.geilicdn.com\\/x_800_800.png'), 'https://si.geilicdn.com/x_800_800.png');
  assert.equal(scrape.cleanImageUrl('https://s.geilicdn.com/node/app.js'), '');
  assert.equal(scrape.cleanImageUrl('javascript:alert(1)'), '');
  assert.deepEqual(scrape.imageDims('https://si.geilicdn.com/a_790_4200.jpg'), { w: 790, h: 4200 });
  assert.equal(scrape.isLong('https://si.geilicdn.com/a_790_4200.jpg'), true);
  assert.equal(scrape.sellerOf('https://si.geilicdn.com/bj-vshop-973365404-1540477335945-383425165_984_984.jpg'), '9733654');
  assert.equal(scrape.sellerOf('https://si.geilicdn.com/pcitem902045282637-3c48_640_640.png'), scrape.sellerOf('https://si.geilicdn.com/wdseller902045282507-5365_1024_1536.jpg'));
  const list = scrape.collectImages('a "https://si.geilicdn.com/p1_800_800.jpg" b //si.geilicdn.com/p1_800_800.jpg.webp?w=30 c https:\\u002F\\u002Fsi.geilicdn.com\\u002Fp2_800_800.jpg d https://si.geilicdn.com/hz_img_icon_42_42_unadjust.png');
  assert.deepEqual(list, ['https://si.geilicdn.com/p1_800_800.jpg', 'https://si.geilicdn.com/p2_800_800.jpg']);
});

test('description and item page parsers', () => {
  const d = scrape.parseDetailDesc({
    status: { code: 0, message: 'OK' },
    result: { item_detail: { desc_content: [{ type: 1, text: '<p>面料：棉</p><p>版型宽松</p>' }, { type: 2, url: '//si.geilicdn.com/d1_790_1200.jpg' }, { type: 2, url: 'https://si.geilicdn.com/d2_790_1000.jpg' }] } },
  });
  assert.equal(d.text, '面料：棉\n版型宽松');
  assert.deepEqual(d.images, ['https://si.geilicdn.com/d1_790_1200.jpg', 'https://si.geilicdn.com/d2_790_1000.jpg']);
  assert.throws(() => scrape.parseDetailDesc({ status: { code: 2, message: 'busy' } }), /Weidian error 2/);

  const html =
    '<html><head><meta property="og:title" content="重磅卫衣 - 微店"><meta name="description" content="好衣服"></head><body>' +
    '<div id="app" data-obj="{&quot;item&quot;:{&quot;itemName&quot;:&quot;重磅卫衣&quot;,&quot;headImgs&quot;:[&quot;//si.geilicdn.com/weidian5-g1_1080_1080.jpg&quot;,{&quot;url&quot;:&quot;https://si.geilicdn.com/weidian5-g2_1080_1440.jpg&quot;}],&quot;detail&quot;:{&quot;imgs&quot;:[&quot;https://si.geilicdn.com/weidian5-d1_790_2000.jpg&quot;]}}}"></div>' +
    '<script>var other = {"recommend":{"imgs":["https://si.geilicdn.com/weidian9-x_800_800.jpg"]}};</script></body></html>';
  const p = scrape.parseItemPage(html);
  assert.equal(p.title, '重磅卫衣');
  assert.equal(p.description, '好衣服');
  assert.deepEqual(p.gallery, ['https://si.geilicdn.com/weidian5-g1_1080_1080.jpg', 'https://si.geilicdn.com/weidian5-g2_1080_1440.jpg']);
  assert.deepEqual(p.detail, ['https://si.geilicdn.com/weidian5-d1_790_2000.jpg']);
  assert.ok(p.all.includes('https://si.geilicdn.com/weidian9-x_800_800.jpg'));

  assert.deepEqual(scrape.colorImages({ attrList: [{ attrTitle: '颜色', attrValues: [{ attrValue: '黑色', img: 'https://si.geilicdn.com/b_800_800.jpg?w=1' }, { attrValue: 'M' }] }] }), { 黑色: 'https://si.geilicdn.com/b_800_800.jpg' });
  assert.equal(scrape.jsonBlobs('window.a = {"x":"}{","y":[1,2]}; f({"z":1}); var c = {notjson: 1};').length, 2);
});

test('Claude web fetch returns the fetched text; errors are reported', async () => {
  let body;
  const fetch = fakeFetch([
    [
      'api.anthropic.com',
      (u, init) => {
        body = JSON.parse(init.body);
        const url = /https:\/\/\S+/.exec(body.messages[0].content)[0];
        if (url.includes('blocked')) return { content: [{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } }] };
        return {
          content: [
            { type: 'server_tool_use', name: 'web_fetch', input: { url } },
            { type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '{"status":{"code":0},"result":{"ok":1}}' } } } },
            { type: 'text', text: 'done' },
          ],
        };
      },
    ],
  ]);
  const text = await scrape.claudeFetch(fetch, 'https://thor.weidian.com/x?param=1', { key: 'sk-1', model: 'claude-test' });
  assert.equal(JSON.parse(text).result.ok, 1);
  assert.equal(body.tools[0].type, 'web_fetch_20250910');
  assert.equal(body.model, 'claude-test');
  assert.equal(fetch.calls[0].headers['x-api-key'], 'sk-1');
  await assert.rejects(() => scrape.claudeFetch(fetch, 'https://blocked.example/x', { key: 'sk-1' }), /url_not_accessible/);
  await assert.rejects(() => scrape.claudeFetch(fetch, 'https://x.example', {}), /no Anthropic key/);
});

test('fetch chain: direct → scraping service → Claude, with validation', async () => {
  const fetch = fakeFetch([
    [(u) => u.startsWith('https://thor.weidian.com/'), () => '<html>slider captcha</html>'],
    [(u) => u.startsWith('https://scraper.example/'), () => new Response('quota', { status: 429 })],
    ['api.anthropic.com', () => ({ content: [{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', content: { type: 'document', source: { type: 'text', data: '{"status":{"code":0},"result":{"v":2}}' } } } }] })],
  ]);
  const svc = new WeidianService({ getConfig: () => ({}), store: { db: { products: [] } }, log: silentLog(), fetch });
  const json = (t) => JSON.parse(t);
  const r = await scrape.fetchChain(svc, 'https://thor.weidian.com/a', { cfg: { fetchVia: 'https://scraper.example/?url={url}' }, claude: { key: 'k' }, check: json });
  assert.equal(r.via, 'Claude');
  assert.equal(r.value.result.v, 2);
  await assert.rejects(() => scrape.fetchChain(svc, 'https://thor.weidian.com/a', { check: json }), /direct: Unexpected token|direct: .*JSON/);
  const both = await scrape.fetchChain(svc, 'https://thor.weidian.com/a', { cfg: { fetchVia: 'https://scraper.example/?url={url}' }, check: json }).catch((e) => e.message);
  assert.match(both, /direct: .* · scraping service: HTTP 429/);
});

test('share links are followed to the product; size chart reader parses Claude output', async () => {
  assert.deepEqual(scrape.shortLinks('see https://k.youshop10.com/AbC12 and https://weidian.com/item.html?itemID=1'), ['https://k.youshop10.com/AbC12']);
  const fetch = async () => ({ url: 'https://weidian.com/item.html?itemID=7781230000&spider=1', text: async () => '' });
  assert.equal(await scrape.resolveShortLink(fetch, 'https://k.youshop10.com/AbC12'), '7781230000');
  const fetch2 = async () => ({ url: 'https://weidian.com/?userid=1', text: async () => '<a href="x?itemId=5550001112">' });
  assert.equal(await scrape.resolveShortLink(fetch2, 'https://k.youshop10.com/x'), '5550001112');

  const tr = createTranslator({
    getConfig: () => ({ provider: 'deepl', deeplKey: 'd', anthropicKey: 'sk-a', model: 'm' }),
    fetch: fakeFetch([['api.anthropic.com', () => ({ content: [{ type: 'text', text: '```json\n{"index": 1, "unit": "cm", "columns": ["Length", "Chest"], "rows": [{"size": "M", "values": [70, "120"]}, {"size": "L", "values": ["72"]}]}\n```' }] })]]),
    log: silentLog(),
  });
  assert.deepEqual(tr.claudeConfig(), { key: 'sk-a', model: 'm' });
  const chart = await tr.readSizeChart([{ data: 'AA', mediaType: 'image/png' }, { data: 'BB', mediaType: 'image/jpeg' }], { sizes: ['M', 'L'] });
  assert.deepEqual(chart, { index: 1, unit: 'cm', columns: ['Length', 'Chest'], rows: [{ size: 'M', values: ['70', '120'] }, { size: 'L', values: ['72', ''] }] });
  const none = createTranslator({ getConfig: () => ({ provider: 'anthropic', anthropicKey: 'k' }), fetch: fakeFetch([['api.anthropic.com', () => ({ content: [{ type: 'text', text: '{"index": null}' }] })]]), log: silentLog() });
  assert.equal(await none.readSizeChart([{ data: 'AA' }]), null);
  assert.equal(createTranslator({ getConfig: () => ({ provider: 'deepl', deeplKey: 'x' }), log: silentLog() }).claudeConfig(), null);
});

test('live-shaped Weidian data: numeric entities in data-obj, folded shop notices, shop list, stock cap', async () => {
  const inject = JSON.stringify({ status: { code: 0 }, result: { default_model: { item_info: { item_name: 'Universal link', imgs: ['https://si.geilicdn.com/wdseller902045282414-a_1424_1780.jpg', 'https://si.geilicdn.com/wdseller902045282414-b_1320_1650.jpg'] } } } }).replace(/"/g, '&#34;');
  const page = scrape.parseItemPage(`<html><script crossorigin="anonymous" id="__rocker-render-inject__" data-obj="${inject}"></script><img src="https://si.geilicdn.com/img-73f4-unadjust_550_200.png"></html>`);
  assert.equal(page.title, 'Universal link');
  assert.equal(page.gallery.length, 2);

  const d = scrape.parseDetailDesc({ status: { code: 0 }, result: { item_detail: { desc_content: [{ text: '面料', type: 1 }, { type: 2, url: 'https://si.geilicdn.com/wdseller9-d_1024_1536.jpg' }, { defaultFold: true, text: '购前说明', type: 10000, url: 'https://si.geilicdn.com/img-7913-unadjust_2250_4929.png' }] } } });
  assert.equal(d.text, '面料');
  assert.deepEqual(d.images, ['https://si.geilicdn.com/wdseller9-d_1024_1536.jpg']);

  const { capStock, parseItemResponse } = require('../server/services/weidian');
  assert.equal(capStock(999999999), 999);
  assert.equal(parseItemResponse({ status: { code: 0 }, result: { itemTitle: 'x', itemStock: 999999999 } }).stock, 999);

  assert.deepEqual(scrape.shopIds('https://shop1785487515.v.weidian.com/?userid=1785487515&spider_token=8bea\nhttps://shop1785487515.v.weidian.com/item.html?itemID=7696749159'), ['1785487515']);
  assert.deepEqual(scrape.shopIds('https://shop1785487515.v.weidian.com/item.html?itemID=7696749159'), []);
  const pages = [];
  const fetch = fakeFetch([
    [
      'shopDetail.tab.getItemList',
      (u) => {
        const p = JSON.parse(new URL(u).searchParams.get('param'));
        pages.push(p.offset);
        const n = p.offset === 0 ? 20 : 3;
        return { status: { code: 0 }, result: { hasData: true, itemList: Array.from({ length: n }, (_, i) => ({ itemId: String(7700000000 + p.offset + i), itemName: i === 1 && p.offset === 0 ? '万用补差链接' : 'Cola出品-T恤 ' + i, price: i === 2 && p.offset === 0 ? '99999' : '168', stock: 999999999, itemImg: 'https://si.geilicdn.com/wdseller9-x_800_800.jpg?w=1', hasSku: true })) } };
      },
    ],
  ]);
  const svc = new WeidianService({ getConfig: () => ({}), store: { db: { products: [] } }, log: silentLog(), fetch });
  const items = await scrape.listShopItems(svc, '1785487515', { sleep: async () => {} });
  assert.deepEqual(pages, [0, 20]);
  assert.equal(items.length, 23);
  assert.equal(items.filter((i) => !i.suggested).length, 2, 'fee link and in-development price not ticked');
  assert.equal(items[0].stock, 999);
  assert.equal(items[0].image, 'https://si.geilicdn.com/wdseller9-x_800_800.jpg');
});
