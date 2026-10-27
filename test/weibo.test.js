'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { cleanText, extractMedia, pickPosts, parseWeiboDate, CookieJar, WeiboService } = require('../server/services/weibo');
const { createTranslator } = require('../server/services/translate');
const { Store } = require('../server/lib/store');
const { tmpDir, rmrf, fixtureJson, fakeFetch, noSleep, silentLog, FIXTURES } = require('./helpers');

const UID = '1234567890';

/* ----------------------------------------------------------- pure helpers */

test('cleanText: <br> → newline, emoticons dropped, entities unescaped, 全文 stripped', () => {
  const raw =
    '第一行<span class="url-icon"><img alt="[心]" src="https://h5.sinaimg.cn/x.png" /></span><br />第二行 &amp; &quot;引号&quot; &#x4E2D;<br/><br/><br/>第三行...<a href="/status/1">全文</a>';
  assert.equal(cleanText(raw), '第一行\n第二行 & "引号" 中\n\n第三行');
});

test('cleanText: removes 网页链接 anchors, keeps mention/hashtag text, strips trailing 查看更多', () => {
  const raw =
    '详情 <a href="https://weibo.cn/sinaurl?u=x"><span class="url-icon"><img src="a.png"></span><span class="surl-text">网页链接</span></a> 找 <a href="/n/someone">@someone</a> <a href="/search"><span class="surl-text">#新品#</span></a> 查看更多';
  assert.equal(cleanText(raw), '详情  找 @someone #新品#');
  assert.equal(cleanText(''), '');
  assert.equal(cleanText(null), '');
});

test('extractMedia: large pics + best video stream + poster', () => {
  const posts = pickPosts(fixtureJson('weibo', 'getindex-posts.json').data);
  const hoodie = posts.find((p) => p.id === '5356857105057064');
  const m1 = extractMedia(hoodie);
  assert.deepEqual(m1.images, ['https://wx2.sinaimg.cn/mw1024/006hoodie01.jpg', 'https://wx2.sinaimg.cn/mw1024/006hoodie02.jpg'], 'site size instead of the original');
  assert.equal(m1.video, null);

  const video = extractMedia(posts.find((p) => p.id === '5356900000000002'));
  assert.deepEqual(video.images, []);
  assert.match(video.video.url, /hd123\.mp4/); // stream_url_hd wins
  assert.equal(video.video.poster, 'https://wx3.sinaimg.cn/orj480/006videoposter.jpg');

  // urls{} fallback when media_info is empty
  const v2 = extractMedia({ page_info: { type: 'video', media_info: {}, urls: { mp4_hd_mp4: 'https://f.video.weibocdn.com/x.mp4' } } });
  assert.equal(v2.video.url, 'https://f.video.weibocdn.com/x.mp4');
});

test('pickPosts: card_type 9 incl. card_group, ignores other cards', () => {
  const posts = pickPosts(fixtureJson('weibo', 'getindex-posts.json').data);
  assert.deepEqual(
    posts.map((p) => p.id),
    ['5000000000000001', '5356857105057064', '5356900000000002', '5356950000000003', '5356960000000004', '5356970000000005']
  );
  assert.deepEqual(pickPosts({}), []);
});

test('parseWeiboDate handles Weibo format and falls back to now', () => {
  assert.equal(parseWeiboDate('Sun Oct 26 10:12:00 +0800 2026'), '2026-10-26T02:12:00.000Z');
  const now = new Date('2026-01-01T00:00:00Z');
  assert.equal(parseWeiboDate('5分钟前', now), now.toISOString());
});

test('CookieJar merges Set-Cookie with the user cookie (user wins), honours deletion', () => {
  const jar = new CookieJar();
  jar.absorb(new Response('', { headers: [['set-cookie', 'A=1; Path=/'], ['set-cookie', 'SUB=visitor; Path=/'], ['set-cookie', 'B=2; Expires=Wed, 21 Oct 2099 07:28:00 GMT']] }));
  assert.equal(jar.header('SUB=mine; X=9'), 'SUB=mine; X=9; A=1; B=2');
  jar.absorb(new Response('', { headers: [['set-cookie', 'A=deleted; Max-Age=0']] }));
  assert.deepEqual(jar.names().sort(), ['B', 'SUB']);
});

/* ---------------------------------------------------------------- service */

function weiboRoutes(overrides = {}) {
  return [
    [
      `m.weibo.cn/u/${UID}`,
      () =>
        new Response('<html><body>profile</body></html>', {
          headers: [
            ['content-type', 'text/html'],
            ['set-cookie', '_T_WM=abc123; Path=/; Domain=.weibo.cn; HttpOnly'],
            ['set-cookie', 'XSRF-TOKEN=tok456; Path=/; Max-Age=1200'],
          ],
        }),
    ],
    [(u) => u.includes('getIndex') && !u.includes('containerid'), overrides.uid || (() => fixtureJson('weibo', 'getindex-uid.json'))],
    [(u) => u.includes('getIndex') && u.includes('containerid='), overrides.posts || (() => fixtureJson('weibo', 'getindex-posts.json'))],
    ['statuses/extend?id=5356857105057064', () => fixtureJson('weibo', 'extend.json')],
  ];
}

function setup({ weibo = {}, translator, routes } = {}) {
  const dir = tmpDir();
  const store = new Store({ dataDir: dir, publicDir: path.join(FIXTURES, 'public'), log: silentLog() }).init();
  Object.assign(store.private.weibo, { uid: UID, backfill: 6, autoPublish: true, requirePhotos: false, ...weibo });
  const fetch = fakeFetch(routes || weiboRoutes());
  const calls = [];
  const tr = translator || {
    async translatePost(text) {
      calls.push(text);
      return { ok: true, provider: 'test', model: 'm', title: 'Production update | Test', category: 'production', translation: `EN:${text.slice(0, 10)}`, relatedProductIds: ['cs-002'] };
    },
  };
  const svc = new WeiboService({ getConfig: () => store.private.weibo, store, translator: tr, log: silentLog(), fetch, sleep: noSleep, prefetch: false });
  return { dir, store, fetch, svc, calls };
}

test('WeiboService first run: warm-up cookies, tabsInfo container, backfill, long text, media, retweets', async (t) => {
  const { dir, store, fetch, svc, calls } = setup();
  t.after(() => rmrf(dir));

  const r = await svc.run();
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.fetched, 6);
  // Newest 6 includes the old pinned post (only 6 posts in total); the trivial "转发微博" repost is skipped.
  assert.equal(r.added, 5);
  assert.equal(r.skipped, 1);

  // Warm-up first, then the uid lookup, then posts via the tabsInfo container id.
  assert.match(fetch.calls[0].url, /m\.weibo\.cn\/u\/1234567890$/);
  const postsCall = fetch.calls.find((c) => c.url.includes('containerid='));
  assert.match(postsCall.url, /containerid=1076031234567890/);
  assert.match(postsCall.headers.cookie, /_T_WM=abc123/);
  assert.equal(postsCall.headers['x-xsrf-token'], 'tok456');
  assert.equal(postsCall.headers['mweibo-pwa'], '1');
  assert.match(postsCall.headers['user-agent'], /iPhone/);

  const db = store.db;
  const hoodie = db.updates.find((u) => u.id === 'wb-5356857105057064');
  assert.ok(hoodie, 'long-text post imported');
  assert.equal(hoodie.source, 'weibo');
  assert.equal(hoodie.url, 'https://m.weibo.cn/status/5356857105057064');
  assert.match(hoodie.textOriginal, /面料：480g 毛圈棉 & 2x2 罗纹\n颜色/); // long text from /statuses/extend, cleaned
  assert.doesNotMatch(hoodie.textOriginal, /<|全文|\[心\]/);
  assert.equal(hoodie.media.length, 2);
  assert.equal(hoodie.media[0].url, `/media/weibo?u=${encodeURIComponent('https://wx2.sinaimg.cn/mw1024/006hoodie01.jpg')}`);
  assert.equal(hoodie.publishedAt, '2026-10-26T02:12:00.000Z');
  assert.equal(hoodie.status, 'published');
  assert.deepEqual(hoodie.relatedProducts, ['cs-002']);
  assert.equal(hoodie.translation.provider, 'test');

  const video = db.updates.find((u) => u.id === 'wb-5356900000000002');
  assert.equal(video.video, null, 'videos are not imported');

  const repost = db.updates.find((u) => u.id === 'wb-5356950000000003');
  assert.equal(repost.retweeted, true);
  assert.equal(repost.media.length, 0, 'media of the retweeted post is not taken');
  assert.doesNotMatch(repost.textOriginal, /手感/); // only own text

  const restock = db.updates.find((u) => u.id === 'wb-5356970000000005');
  assert.equal(restock.textOriginal, '补货通知\n工装夹克 Clay 色 M/L 码今晚八点补货\n\n详情');

  assert.ok(!db.updates.some((u) => u.id === 'wb-5356960000000004'));
  assert.equal(store.private.weibo.lastId, '5356970000000005');
  assert.equal(db.meta.sync.weibo.status, 'ok');
  assert.equal(calls.length, 5);

  // Second run: nothing new.
  const r2 = await svc.run();
  assert.equal(r2.added, 0);
  assert.ok(r2.log.some((l) => /No new posts/.test(l)));
});

test('WeiboService subsequent run imports only newer ids; force re-considers latest n; dedupe by id', async (t) => {
  const posts = fixtureJson('weibo', 'getindex-posts.json');
  const { dir, store, svc } = setup({
    weibo: { lastId: '5356900000000002' },
    routes: weiboRoutes({ posts: () => posts }),
  });
  t.after(() => rmrf(dir));
  const r = await svc.run();
  assert.deepEqual(
    store.db.updates.filter((u) => /^53569/.test(u.sourceId || '')).map((u) => u.sourceId).sort(),
    ['5356950000000003', '5356970000000005']
  );
  assert.equal(r.added, 2);

  const forced = await svc.run({ force: 3 });
  assert.equal(forced.added, 0);
  assert.equal(forced.skipped, 3); // two existing + trivial repost
});

test('WeiboService falls back to 107603{uid} without tabsInfo, and reports ok=0 / non-JSON diagnostics', async (t) => {
  const { dir, svc, fetch } = setup({
    routes: weiboRoutes({ uid: () => ({ ok: 1, data: { userInfo: { id: 1 } } }) }),
  });
  t.after(() => rmrf(dir));
  await svc.run();
  assert.ok(fetch.calls.some((c) => c.url.includes('containerid=1076031234567890')));

  const bad = setup({
    routes: weiboRoutes({
      uid: () => ({ ok: 0, msg: '请先登录' }),
      posts: () => new Response('<html>Sina Visitor System</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    }),
  });
  t.after(() => rmrf(bad.dir));
  const r = await bad.svc.run();
  assert.equal(r.ok, false);
  assert.equal(r.added, 0);
  assert.match(r.errors[0], /no JSON|Could not get valid JSON/);
  assert.ok(r.log.some((l) => /ok=0/.test(l)), 'ok=0 diagnostics logged');
  assert.ok(r.log.some((l) => /Sina Visitor System/.test(l)), 'response snippet logged');
  assert.equal(bad.store.db.meta.sync.weibo.status, 'error');
  assert.equal(bad.store.private.weibo.lastId, null, 'bookmark untouched on failure');
});

test('WeiboService requires a uid and never overlaps runs', async (t) => {
  const { dir, svc, store } = setup({ weibo: { uid: '' } });
  t.after(() => rmrf(dir));
  const r = await svc.run();
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /uid is not configured/);

  store.private.weibo.uid = UID;
  const p1 = svc.run();
  await assert.rejects(() => svc.run(), /already running/);
  await p1;
});

test('WeiboService + real translator (Anthropic mocked): translated + pending when translation fails', async (t) => {
  const products = [{ id: 'cs-002', name: 'Heavyweight Hoodie', subtitle: '480 g loopback cotton' }];
  let n = 0;
  const routes = [
    ...weiboRoutes(),
    [
      'api.anthropic.com/v1/messages',
      (url, init) => {
        n++;
        const body = JSON.parse(init.body);
        assert.equal(init.headers['x-api-key'], 'sk-test');
        assert.equal(init.headers['anthropic-version'], '2023-06-01');
        assert.equal(body.model, 'claude-sonnet-5-5');
        assert.match(body.system, /Cola Studio/);
        assert.match(body.system, /Heavyweight Hoodie/);
        assert.doesNotMatch(body.system, /reproduc|infer it from|Infer the brand/i);
        if (n === 2) return new Response('{"type":"error"}', { status: 529 });
        return {
          model: 'claude-sonnet-5-5',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"title":"Sampling update | Heavyweight Hoodie 🔥","category":"production","translation":"Second sample round done ✨","relatedProductIds":["cs-002","cs-999"]}' }],
        };
      },
    ],
  ];
  const dir = tmpDir();
  t.after(() => rmrf(dir));
  const store = new Store({ dataDir: dir, publicDir: path.join(dir, 'nope'), log: silentLog() }).init();
  store.db.products = products.map((p) => ({ ...p, status: 'published', variants: [] }));
  Object.assign(store.private.weibo, { uid: UID, backfill: 3, autoPublish: true, requirePhotos: false });
  const fetch = fakeFetch(routes);
  const translator = createTranslator({ getConfig: () => ({ provider: 'anthropic', anthropicKey: 'sk-test' }), fetch, log: silentLog() });
  const svc = new WeiboService({ getConfig: () => store.private.weibo, store, translator, log: silentLog(), fetch, sleep: noSleep, prefetch: false });
  const r = await svc.run();
  assert.equal(r.added, 2);
  const [first, second] = store.db.updates.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  assert.equal(first.title, 'Sampling update | Heavyweight Hoodie');
  assert.equal(first.textEnglish, 'Second sample round done');
  assert.deepEqual(first.relatedProducts, ['cs-002']);
  assert.equal(first.status, 'published');
  assert.equal(second.status, 'pending');
  assert.equal(second.translation.provider, 'none');
  assert.equal(second.textEnglish, second.textOriginal);

  // Retranslate the failed one → published.
  const again = await svc.retranslate(second.id);
  assert.equal(again.status, 'published');
  assert.equal(again.translation.provider, 'anthropic');
});
