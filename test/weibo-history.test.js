'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { WeiboService } = require('../server/services/weibo');
const { Store } = require('../server/lib/store');
const { tmpDir, rmrf, fixtureJson, fakeFetch, noSleep, silentLog, FIXTURES } = require('./helpers');

const UID = '1234567890';
const BASE = 5400000000000000n;
const pid = (n) => String(BASE + BigInt(n));

/** One getIndex page with posts n..m (newest first) and the next since_id. */
function page(from, to, sinceId) {
  const cards = [];
  for (let n = from; n >= to; n--) {
    const d = new Date(Date.UTC(2026, 0, 1) + n * 3600e3);
    cards.push({
      card_type: 9,
      mblog: {
        id: pid(n),
        mid: pid(n),
        created_at: d.toUTCString().replace('GMT', '+0000'),
        text: n === 18 ? '转发微博' : `工作室日常 第${n}条`,
        ...(n === 18 ? { retweeted_status: { id: '1', text: 'x' } } : {}),
        user: { id: Number(UID), screen_name: 'ColaStudio' },
      },
    });
  }
  return { ok: 1, data: { cardlistInfo: { since_id: sinceId }, cards } };
}

// 30 posts on three pages: 30–21, 20–11, 10–1 (18 is a plain repost).
const PAGES = { '': page(30, 21, 'S2'), S2: page(20, 11, 'S3'), S3: page(10, 1, undefined) };

function routes(log, opts = {}) {
  return [
    [`m.weibo.cn/u/${UID}`, () => '<html>profile</html>'],
    [(u) => u.includes('getIndex') && !u.includes('containerid'), () => fixtureJson('weibo', 'getindex-uid.json')],
    [
      (u) => u.includes('getIndex') && u.includes('containerid='),
      (url) => {
        const since = new URL(url).searchParams.get('since_id') || '';
        log.push(since);
        if (opts.failOn === since) return new Response('busy', { status: 418 });
        return PAGES[since];
      },
    ],
  ];
}

function setup({ translator, configured = true, autoPublish = true, failOn, requirePhotos = false } = {}) {
  const dir = tmpDir();
  const store = new Store({ dataDir: dir, publicDir: path.join(FIXTURES, 'public'), log: silentLog() }).init();
  store.db.updates = [];
  Object.assign(store.private.weibo, { uid: UID, autoPublish, requirePhotos });
  const pages = [];
  const fetch = fakeFetch(routes(pages, { failOn }));
  const calls = [];
  const tr = translator || {
    configured: () => configured,
    async translatePost(text) {
      calls.push(text);
      return { ok: true, provider: 'test', model: 'm', title: 'Studio | ' + text.slice(-4), category: 'studio', translation: 'EN ' + text, relatedProductIds: [] };
    },
  };
  const svc = new WeiboService({ getConfig: () => store.private.weibo, store, translator: tr, log: silentLog(), fetch, sleep: noSleep, prefetch: false });
  return { dir, store, svc, pages, calls };
}

async function finish(svc) {
  await svc.historyJob;
  return svc.historyStatus();
}

test('history import: pages back with since_id, skips reposts, translates newest first and publishes', async (t) => {
  const { dir, store, svc, pages, calls } = setup();
  t.after(() => rmrf(dir));

  const started = svc.startHistory({ limit: 15 });
  assert.equal(started.state, 'running');
  assert.throws(() => svc.startHistory({}), /already running/);
  const st = await finish(svc);

  assert.equal(st.state, 'done', st.message);
  assert.equal(st.added, 15);
  assert.deepEqual(pages, ['', 'S2']);
  const ids = store.db.updates.map((u) => u.sourceId);
  assert.ok(ids.includes(pid(30)) && ids.includes(pid(15)) && !ids.includes(pid(14)));
  assert.ok(!ids.includes(pid(18)), 'plain repost skipped');
  assert.equal(st.skipped, 1);

  // Stopped halfway through page 2 → the cursor stays on that page.
  assert.equal(store.db.meta.weiboHistory.sinceId, 'S2');
  assert.equal(st.translated, 15);
  assert.equal(st.queued, 0);
  assert.match(calls[0], /第30条/, 'newest first');
  const u = store.db.updates.find((x) => x.sourceId === pid(20));
  assert.equal(u.status, 'published');
  assert.equal(u.textEnglish, 'EN 工作室日常 第20条');
  assert.equal(u.translation.provider, 'test');
  assert.equal(u.translation.queued, undefined);
  assert.equal(u.history, true);

  // The regular fetch now starts after the newest imported post.
  assert.equal(store.private.weibo.lastId, pid(30));

  // Continue: re-reads page 2 (skipping what we have) and goes on to page 3 until the end.
  svc.startHistory({ limit: 100, resume: true });
  const st2 = await finish(svc);
  assert.deepEqual(pages, ['', 'S2', 'S2', 'S3']);
  assert.equal(st2.added, 14); // 14..1
  assert.equal(store.db.updates.length, 29);
  assert.equal(store.db.meta.weiboHistory.complete, true);
  assert.equal(store.db.meta.weiboHistory.sinceId, null);
  assert.equal(store.db.meta.weiboHistory.imported, 29);
  assert.ok(st2.log.some((l) => /oldest post/.test(l)));
});

test('history import without a translation provider: queued as pending, translated later with translateOnly', async (t) => {
  const env = setup({ configured: false });
  t.after(() => rmrf(env.dir));
  env.svc.startHistory({ limit: 12 });
  const st = await finish(env.svc);
  assert.equal(st.added, 12);
  assert.equal(st.queued, 12);
  assert.equal(st.translator, false);
  assert.match(st.message, /Add a translation key/);
  assert.equal(env.calls.length, 0);
  const u = env.store.db.updates[0];
  assert.equal(u.status, 'pending');
  assert.equal(u.translation.queued, true);
  assert.equal(u.textEnglish, u.textOriginal);

  // A key is added → translate the queue only (no Weibo requests).
  env.svc.translator.configured = () => true;
  const before = env.pages.length;
  env.svc.startHistory({ translateOnly: true });
  const st2 = await finish(env.svc);
  assert.equal(env.pages.length, before);
  assert.equal(st2.translated, 12);
  assert.equal(st2.queued, 0);
  assert.match(st2.message, /12 post\(s\) translated/);
  assert.ok(env.store.db.updates.every((x) => x.status === 'published'));
});

test('history import: publishUntranslated, autoPublish off, stop, errors and the regular run deferring', async (t) => {
  const a = setup({ configured: false });
  t.after(() => rmrf(a.dir));
  a.svc.startHistory({ limit: 10, publishUntranslated: true });
  await finish(a.svc);
  assert.ok(a.store.db.updates.length === 10 && a.store.db.updates.every((u) => u.status === 'published' && u.translation.queued));

  // autoPublish off → translated posts still wait for review.
  const b = setup({ autoPublish: false });
  t.after(() => rmrf(b.dir));
  b.svc.startHistory({ limit: 10 });
  const sb = await finish(b.svc);
  assert.equal(sb.translated, 10);
  assert.ok(b.store.db.updates.every((u) => u.status === 'pending' && u.translation.provider === 'test'));

  // Stop right away: nothing is fetched after the current step.
  const c = setup();
  t.after(() => rmrf(c.dir));
  c.svc.startHistory({ limit: 100 });
  c.svc.stopHistory();
  const sc = await finish(c.svc);
  assert.equal(sc.state, 'stopped');
  assert.equal(sc.translated, 0);

  // Weibo refuses page 2 → error is reported, cursor kept for Continue.
  const d = setup({ failOn: 'S2' });
  t.after(() => rmrf(d.dir));
  d.svc.startHistory({ limit: 100 });
  const sd = await finish(d.svc);
  assert.equal(sd.added, 10);
  assert.ok(sd.errors.length >= 1);
  assert.equal(d.store.db.meta.weiboHistory.sinceId, 'S2');
  assert.match(sd.message, /Continue|Done/);

  // While a history import runs, the scheduled fetch steps aside.
  const e = setup();
  t.after(() => rmrf(e.dir));
  e.svc.startHistory({ limit: 10 });
  const r = await e.svc.run();
  assert.equal(r.deferred, true);
  await finish(e.svc);

  // Limits are clamped.
  const f = setup();
  t.after(() => rmrf(f.dir));
  assert.equal(f.svc.startHistory({ limit: 99999 }).limit, 3000);
  await finish(f.svc);
  assert.equal(f.svc.startHistory({}).limit, 100);
  await finish(f.svc);
});

test('history import needs a uid', async (t) => {
  const env = setup();
  t.after(() => rmrf(env.dir));
  env.store.private.weibo.uid = '';
  env.svc.startHistory({ limit: 10 });
  const st = await finish(env.svc);
  assert.equal(st.state, 'error');
  assert.match(st.message, /uid is not configured/);
});

test('posts without photos are skipped by default; reset forgets everything that was imported', async (t) => {
  // Page 3 posts get a photo on even numbers only.
  const withPics = (pg) => ({ ...pg, data: { ...pg.data, cards: pg.data.cards.map((c) => (Number(c.mblog.id.slice(-2)) % 2 === 0 ? { ...c, mblog: { ...c.mblog, pics: [{ large: { url: `https://wx1.sinaimg.cn/large/p${c.mblog.id}.jpg` } }] } } : c)) } });
  const saved = { ...PAGES };
  PAGES[''] = withPics(PAGES['']);
  t.after(() => Object.assign(PAGES, saved));
  const env = setup({ requirePhotos: true });
  t.after(() => rmrf(env.dir));
  env.svc.startHistory({ limit: 10 });
  const st = await finish(env.svc);
  assert.equal(st.added, 5, 'only the five posts with a photo on page 1');
  assert.ok(st.noPhotos >= 5, 'posts without photos skipped');
  assert.ok(env.store.db.updates.every((u) => u.media.length > 0));

  env.store.db.updates.push({ id: 'su-own', source: 'studio', status: 'published', title: 'Own post', publishedAt: new Date().toISOString() });
  env.store.db.meta.weiboDeleted = ['123'];
  const r = env.svc.resetImport({ deletePosts: true });
  assert.equal(r.removed, 5);
  assert.deepEqual(env.store.db.updates.map((u) => u.id), ['su-own']);
  assert.equal(env.store.private.weibo.lastId, null);
  assert.equal(env.store.db.meta.weiboHistory, undefined);
  assert.deepEqual(env.store.db.meta.weiboDeleted, []);
  assert.equal(env.svc.historyStatus().state, 'idle');
});
