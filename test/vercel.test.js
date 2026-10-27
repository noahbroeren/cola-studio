'use strict';
/**
 * Vercel + Upstash adapter: merge logic, Redis store (CAS + merge), the REST
 * client against a fake Upstash HTTP server, and the function end to end.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const path = require('node:path');
const { merge3, deepEqual } = require('../server/vercel/merge');
const { createMemoryRedis } = require('../server/vercel/memory-redis');
const { createUpstash, upstashEnv } = require('../server/vercel/upstash');
const { RedisStore } = require('../server/vercel/redis-store');
const { createVercelApp, collectionsFor } = require('../server/vercel/app');
const { versionAssets } = require('../scripts/build-vercel');
const { fakeFetch } = require('./helpers');

const PUBLIC = path.join(__dirname, '..', 'public');
const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent; }, capture() { return silent; }, lines: () => [] };

/* ------------------------------------------------------------------ merge */

test('merge3: one-sided changes, keyed arrays, sets', () => {
  assert.deepEqual(merge3({ a: 1 }, { a: 2 }, { a: 1 }), { a: 2 });
  assert.deepEqual(merge3({ a: 1 }, { a: 1 }, { a: 3 }), { a: 3 });
  assert.deepEqual(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 5 }), { a: 2, b: 5 });
  // both appended to an id-keyed list, one renamed an item, the other deleted one
  const base = [{ id: 'a', n: 1 }, { id: 'b', n: 1 }];
  const ours = [{ id: 'a', n: 2 }, { id: 'b', n: 1 }, { id: 'c', n: 1 }];
  const theirs = [{ id: 'a', n: 1 }, { id: 'd', n: 1 }];
  assert.deepEqual(merge3(base, ours, theirs), [{ id: 'a', n: 2 }, { id: 'd', n: 1 }, { id: 'c', n: 1 }]);
  // sku-keyed variants merge per field
  const vb = [{ sku: 'x', stock: 1, price: 10 }];
  assert.deepEqual(merge3(vb, [{ sku: 'x', stock: 5, price: 10 }], [{ sku: 'x', stock: 1, price: 12 }]), [{ sku: 'x', stock: 5, price: 12 }]);
  // append-only log without ids
  assert.deepEqual(merge3([{ at: 1 }], [{ at: 1 }, { at: 2 }], [{ at: 1 }, { at: 3 }]), [{ at: 1 }, { at: 3 }, { at: 2 }]);
  assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!deepEqual({ a: 1 }, { a: 1, b: undefined }));
});

/* ------------------------------------------------------------------ store */

test('RedisStore seeds an empty database from public/data and loads subsets', async () => {
  const redis = createMemoryRedis();
  const s = await new RedisStore({ redis, publicDir: PUBLIC, log: silent }).load(['settings', 'products', 'meta']);
  assert.ok(s.db.products.length > 5, 'seeded products');
  assert.equal(s.db.settings.brand.name, 'Cola Studio');
  assert.throws(() => s.db.updates, /not loaded/);
  assert.ok(s.private.weibo, 'private config loaded');
  assert.deepEqual(await s.commit(), [], 'nothing changed → nothing written');
  assert.ok(redis.keys().includes('cola:c:updates'), 'all collections were seeded');
});

test('RedisStore commit writes only changed collections and merges concurrent writers', async () => {
  const redis = createMemoryRedis();
  const load = (names) => new RedisStore({ redis, publicDir: PUBLIC, log: silent }).load(names);
  await load('all');

  const a = await load(['products', 'orders', 'meta']);
  const b = await load(['products', 'orders', 'meta']);
  const pid = a.db.products[0].id;
  a.db.products[0].name = 'Renamed by A';
  a.pushCapped('orders', { id: 'ord-a', ref: 'A' });
  b.db.products[0].variants[0].stock = 77;
  b.pushCapped('orders', { id: 'ord-b', ref: 'B' });

  assert.deepEqual((await a.commit()).sort(), ['orders', 'products']);
  assert.deepEqual((await b.commit()).sort(), ['orders', 'products']); // conflict → merged

  const c = await load(['products', 'orders', 'meta']);
  const p = c.findProduct(pid);
  assert.equal(p.name, 'Renamed by A');
  assert.equal(p.variants[0].stock, 77);
  assert.deepEqual(c.db.orders.map((o) => o.id).sort(), ['ord-a', 'ord-b']);
});

test('RedisStore snapshot() writes a backup during commit', async () => {
  const redis = createMemoryRedis();
  const s = await new RedisStore({ redis, publicDir: PUBLIC, log: silent }).load('all');
  const name = s.snapshot('pre-import');
  await s.commit();
  assert.deepEqual(await s.listBackups(), [name]);
  const json = JSON.parse(await redis.cmd('GET', `cola:backup:${name}`));
  assert.ok(Array.isArray(json.products));
});

/* ----------------------------------------------------- upstash REST client */

function fakeUpstashServer(token) {
  const mem = createMemoryRedis();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized' }));
      }
      const parsed = JSON.parse(body);
      const run = (c) => {
        try {
          return { result: mem.exec(c) };
        } catch (e) {
          return { error: e.message };
        }
      };
      const out = req.url === '/pipeline' || req.url === '/multi-exec' ? parsed.map(run) : run(parsed);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, mem, url: `http://127.0.0.1:${server.address().port}` })));
}

test('Upstash REST client: commands, pipeline, eval and errors', async (t) => {
  const { server, url } = await fakeUpstashServer('tok');
  t.after(() => server.close());
  const r = createUpstash({ url, token: 'tok' });
  assert.equal(await r.cmd('SET', 'k', 'v'), 'OK');
  assert.equal(await r.cmd('GET', 'k'), 'v');
  assert.deepEqual(await r.pipeline([['INCR', 'n'], ['INCR', 'n'], ['GET', 'n']]), [1, 2, '2']);
  await assert.rejects(r.cmd('NOPE'), /unsupported/);
  await assert.rejects(createUpstash({ url, token: 'bad' }).cmd('GET', 'k'), /Unauthorized/);
  // the store works over REST too
  const s = await new RedisStore({ redis: r, publicDir: PUBLIC, log: silent }).load(['products', 'meta']);
  s.db.products[0].name = 'Over REST';
  assert.deepEqual(await s.commit(), ['products']);
  const again = await new RedisStore({ redis: r, publicDir: PUBLIC, log: silent }).load(['products', 'meta']);
  assert.equal(again.db.products[0].name, 'Over REST');
});

test('upstashEnv finds direct, Marketplace and prefixed variable names', () => {
  assert.deepEqual(upstashEnv({ UPSTASH_REDIS_REST_URL: 'https://a.upstash.io/', UPSTASH_REDIS_REST_TOKEN: 't' }), { url: 'https://a.upstash.io', token: 't' });
  assert.deepEqual(upstashEnv({ KV_REST_API_URL: 'https://b', KV_REST_API_TOKEN: 'u' }), { url: 'https://b', token: 'u' });
  assert.deepEqual(upstashEnv({ STORAGE_KV_REST_API_URL: 'https://c', STORAGE_KV_REST_API_READ_ONLY_TOKEN: 'ro', STORAGE_KV_REST_API_TOKEN: 'rw' }), { url: 'https://c', token: 'rw' });
  assert.equal(upstashEnv({}), null);
});

/* --------------------------------------------------------------- function */

function call(app, method, url, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => app.handle(req, res));
    server.listen(0, '127.0.0.1', () => {
      const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      const req = http.request(
        { host: '127.0.0.1', port: server.address().port, method, path: url, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers } },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            server.close();
            let buf = Buffer.concat(chunks);
            if (res.headers['content-encoding'] === 'gzip') buf = zlib.gunzipSync(buf);
            const text = buf.toString('utf8');
            let json = null;
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
  });
}

function makeApp(extraEnv = {}, fetch = fakeFetch([])) {
  const redis = createMemoryRedis();
  const env = { NODE_ENV: 'production', ADMIN_PASSWORD: 'secret-pass', CRON_SECRET: 'cron-123', LOG_SILENT: '1', VERCEL_URL: 'test.vercel.app', ...extraEnv };
  return { app: createVercelApp({ env, redis, fetch }), redis };
}

test('collectionsFor maps routes to the collections they need', () => {
  assert.deepEqual(collectionsFor('/media/weibo'), []);
  assert.equal(collectionsFor('/api/admin/export'), 'all');
  assert.ok(collectionsFor('/api/updates').includes('updates'));
  assert.ok(!collectionsFor('/api/products').includes('updates'));
  assert.ok(collectionsFor('/api/admin/orders/x').includes('orders'));
});

test('function: rewritten URLs, public API with CDN caching, product SEO page', async () => {
  const { app } = makeApp();
  const health = await call(app, 'GET', '/api/index?__route=/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  const products = await call(app, 'GET', '/api/index?__route=/api/products');
  assert.match(products.headers['cache-control'], /s-maxage=\d+/);
  const slug = products.json.products[0].slug;
  const page = await call(app, 'GET', `/api/index?__route=/products/${slug}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /application\/ld\+json/);
  assert.match(page.text, /core\/util\.js\?v=[0-9a-f]{10}/, 'asset version applied');
  const missing = await call(app, 'GET', '/api/index?__route=/products/does-not-exist');
  assert.equal(missing.status, 404);
  const updates = await call(app, 'GET', '/api/updates?limit=2'); // direct path works too
  assert.equal(updates.status, 200);
  assert.ok(updates.json.updates.length <= 2);
});

test('function: admin login, edit, rate limit and uploads stored in Redis', async () => {
  const { app } = makeApp();
  const bad = await call(app, 'POST', '/api/admin/login', { body: { password: 'nope' } });
  assert.equal(bad.status, 401);
  const ok = await call(app, 'POST', '/api/admin/login', { body: { password: 'secret-pass' } });
  assert.equal(ok.status, 200);
  const auth = { authorization: `Bearer ${ok.json.token}` };

  const p = (await call(app, 'GET', '/api/admin/products/cs-001', { headers: auth })).json.product;
  p.name = 'Edited on Vercel';
  assert.equal((await call(app, 'PUT', '/api/admin/products/cs-001', { headers: auth, body: p })).status, 200);
  const pub = await call(app, 'GET', `/api/products/${p.slug}`);
  assert.equal(pub.json.product.name, 'Edited on Vercel');

  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const up = await call(app, 'POST', '/api/admin/upload', { headers: auth, body: { filename: 'Dot.png', data: png } });
  assert.equal(up.status, 201);
  const file = await call(app, 'GET', up.json.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers['content-type'], 'image/png');
  assert.match(file.headers['cache-control'], /immutable/);
  assert.equal((await call(app, 'GET', '/api/admin/uploads', { headers: auth })).json.uploads.length, 1);
  assert.equal((await call(app, 'DELETE', `/api/admin/uploads/${up.json.name}`, { headers: auth })).status, 200);
  assert.equal((await call(app, 'GET', up.json.url)).status, 404);

  // logs are persisted to Redis and readable from the admin
  const logs = await call(app, 'GET', '/api/admin/logs', { headers: auth });
  assert.ok(logs.json.logs.some((l) => /upload saved/.test(l.message)));

  // login limiter (10 per 15 min, shared through Redis)
  let last;
  for (let i = 0; i < 11; i++) last = await call(app, 'POST', '/api/admin/login', { body: { password: 'wrong' }, headers: { 'x-forwarded-for': '9.9.9.9' } });
  assert.equal(last.status, 429);
});

test('function: cron requires CRON_SECRET and runs due jobs', async () => {
  const fetch = fakeFetch([['open.er-api.com', () => ({ result: 'success', rates: { EUR: 0.13, USD: 0.14, GBP: 0.11 } })]]);
  const { app, redis } = makeApp({}, fetch);
  assert.equal((await call(app, 'GET', '/api/cron/tick')).status, 401);
  assert.equal((await call(app, 'GET', '/api/cron/tick?key=wrong')).status, 401);
  const r = await call(app, 'GET', '/api/index?__route=/api/cron/tick', { headers: { authorization: 'Bearer cron-123' } });
  assert.equal(r.status, 200);
  assert.ok(r.json.ran.includes('backup'));
  assert.ok(r.json.ran.includes('currency'));
  const site = await call(app, 'GET', '/api/site');
  assert.equal(site.json.settings.currency.rates.EUR, 0.13);
  assert.equal((await redis.cmd('LRANGE', 'cola:backups', '0', '-1')).length, 1);
  // second tick the same day: nothing due
  const again = await call(app, 'GET', '/api/cron/tick?key=cron-123');
  assert.deepEqual(again.json.ran, []);
});

test('function: Weibo media passthrough with clamped ranges', async () => {
  const fetch = fakeFetch([
    [
      'weibocdn.com',
      (url, init) => {
        const range = new Headers(init.headers).get('range');
        assert.equal(range, `bytes=0-${4 * 1024 * 1024 - 1}`);
        return new Response(Buffer.alloc(10), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-9/100' } });
      },
    ],
    ['sinaimg.cn', (url, init) => {
      assert.equal(new Headers(init.headers).get('referer'), 'https://m.weibo.cn/');
      return new Response(Buffer.from('img'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }],
  ]);
  const { app } = makeApp({}, fetch);
  const img = await call(app, 'GET', '/media/weibo?u=' + encodeURIComponent('https://wx1.sinaimg.cn/large/abc.jpg'));
  assert.equal(img.status, 200);
  assert.match(img.headers['cache-control'], /s-maxage/);
  const vid = await call(app, 'GET', '/media/weibo?u=' + encodeURIComponent('https://f.video.weibocdn.com/o0/abc.mp4'), { headers: { range: 'bytes=0-' } });
  assert.equal(vid.status, 206);
  assert.equal(vid.headers['content-range'], 'bytes 0-9/100');
  assert.equal((await call(app, 'GET', '/media/weibo?u=' + encodeURIComponent('https://evil.example.com/x.jpg'))).status, 400);
});

test('function: clear error when Upstash is not connected', async () => {
  const app = createVercelApp({ env: { NODE_ENV: 'production', LOG_SILENT: '1' } });
  const r = await call(app, 'GET', '/api/health');
  assert.equal(r.status, 503);
  assert.match(r.json.error, /Upstash/);
});

test('build: asset references get a per-deploy version', () => {
  const html = '<script src="assets/js/a.js?v=1.0.0"></script><link href="../assets/css/b.css"><img src="assets/img/x.png">';
  assert.equal(versionAssets(html, 'abc'), '<script src="assets/js/a.js?v=abc"></script><link href="../assets/css/b.css?v=abc"><img src="assets/img/x.png">');
});

test('function: cron fetches Weibo (env-configured) into updates, translation off', async () => {
  const { fixtureJson } = require('./helpers');
  const UID = '1234567890';
  const fetch = fakeFetch([
    [`m.weibo.cn/u/${UID}`, () => new Response('<html></html>', { headers: { 'content-type': 'text/html', 'set-cookie': '_T_WM=abc; Path=/' } })],
    [(u) => u.includes('getIndex') && !u.includes('containerid'), () => fixtureJson('weibo', 'getindex-uid.json')],
    [(u) => u.includes('getIndex') && u.includes('containerid='), () => fixtureJson('weibo', 'getindex-posts.json')],
    ['statuses/extend', () => fixtureJson('weibo', 'extend.json')],
    ['open.er-api.com', () => ({ result: 'success', rates: { EUR: 0.13 } })],
  ]);
  const { app } = makeApp({ WEIBO_ENABLED: 'true', WEIBO_UID: UID, TRANSLATION_PROVIDER: 'none' }, fetch);
  const before = (await call(app, 'GET', '/api/updates?limit=100')).json.total;
  const r = await call(app, 'GET', '/api/cron/tick', { headers: { authorization: 'Bearer cron-123' } });
  assert.ok(r.json.ran.includes('weibo'), JSON.stringify(r.json));
  assert.ok(r.json.results.weibo.added > 0, JSON.stringify(r.json.results.weibo));
  const ok = await call(app, 'POST', '/api/admin/login', { body: { password: 'secret-pass' } });
  const admin = await call(app, 'GET', '/api/admin/updates', { headers: { authorization: `Bearer ${ok.json.token}` } });
  assert.ok(admin.json.updates.length >= before + r.json.results.weibo.added);
  assert.ok(admin.json.updates.some((u) => u.source === 'weibo' && /\/media\/weibo\?u=/.test(JSON.stringify(u.media || []))));
  // a second tick right away: weibo not due again
  const again = await call(app, 'GET', '/api/cron/tick', { headers: { authorization: 'Bearer cron-123' } });
  assert.ok(!again.json.ran.includes('weibo'));
});

test('function: demo content can be removed; demo posts hide once real posts exist', async () => {
  const { app } = makeApp();
  const ok = await call(app, 'POST', '/api/admin/login', { body: { password: 'secret-pass' } });
  const auth = { authorization: `Bearer ${ok.json.token}` };
  const counts = (await call(app, 'GET', '/api/admin/demo', { headers: auth })).json;
  assert.ok(counts.products > 0 && counts.updates > 0 && counts.demoMode);

  // a real post makes the demo posts step aside on the public API
  const created = await call(app, 'POST', '/api/admin/updates', { headers: auth, body: { title: 'Real post', textEnglish: 'Hello', category: 'studio' } });
  assert.equal(created.status, 201);
  const pub = (await call(app, 'GET', '/api/updates?limit=50')).json;
  assert.deepEqual(pub.updates.map((u) => u.id), [created.json.update.id]);

  const cleared = await call(app, 'POST', '/api/admin/demo/clear', { headers: auth, body: {} });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.products, 0);
  assert.equal(cleared.json.demoMode, false);
  assert.equal((await call(app, 'GET', '/api/products')).json.products.length, 0);
  assert.equal((await call(app, 'GET', '/api/site')).json.settings.demo, false);
});
