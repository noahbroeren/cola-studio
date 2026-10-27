'use strict';
/** Railway defaults (volume, proxy, site URL) and the extended order form fields. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../server/config');
const { versionAssets } = require('../server/lib/html');

test('Railway: volume becomes the data dir, uploads live on it, proxy trusted, site URL from the public domain', () => {
  const c = loadConfig({ RAILWAY_VOLUME_MOUNT_PATH: '/app/data', RAILWAY_PROJECT_ID: 'p', RAILWAY_PUBLIC_DOMAIN: 'cola.up.railway.app' });
  assert.equal(c.dataDir, '/app/data');
  assert.equal(c.uploadsDir, path.join('/app/data', 'uploads'));
  assert.equal(c.trustProxy, 'true');
  assert.equal(c.siteUrl, 'https://cola.up.railway.app');
  // explicit settings still win
  const d = loadConfig({ RAILWAY_VOLUME_MOUNT_PATH: '/app/data', RAILWAY_PROJECT_ID: 'p', SITE_URL: 'https://colastudio.com/', TRUST_PROXY: 'auto', DATA_DIR: '/srv/cola' });
  assert.equal(d.siteUrl, 'https://colastudio.com');
  assert.equal(d.trustProxy, 'auto');
  assert.equal(d.dataDir, '/srv/cola');
  // without Railway nothing changes
  const e = loadConfig({});
  assert.equal(e.trustProxy, 'auto');
  assert.match(e.uploadsDir, /public[\\/]uploads$/);
});

test('Render: DATA_DIR disk holds the uploads, proxy trusted, site URL from RENDER_EXTERNAL_URL until SITE_URL is set', () => {
  const c = loadConfig({ RENDER: 'true', RENDER_EXTERNAL_URL: 'https://cola-studio.onrender.com', DATA_DIR: '/app/data' });
  assert.equal(c.dataDir, '/app/data');
  assert.equal(c.uploadsDir, path.join('/app/data', 'uploads'));
  assert.equal(c.trustProxy, 'true');
  assert.equal(c.siteUrl, 'https://cola-studio.onrender.com');
  const d = loadConfig({ RENDER: 'true', RENDER_EXTERNAL_URL: 'https://cola-studio.onrender.com', SITE_URL: 'https://colastudio.com', DATA_DIR: '/app/data', UPLOADS_DIR: '/srv/up' });
  assert.equal(d.siteUrl, 'https://colastudio.com');
  assert.equal(d.uploadsDir, '/srv/up');
  // render.yaml matches what the server expects
  const yaml = require('node:fs').readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8');
  for (const needle of ['runtime: docker', 'region: frankfurt', 'healthCheckPath: /api/health', 'mountPath: /app/data', 'key: DATA_DIR', 'value: /app/data', 'key: ADMIN_PASSWORD']) assert.ok(yaml.includes(needle), needle);
});

test('asset versioning rewrites local js/css references only', () => {
  const html = '<link href="assets/css/a.css?v=1.0.0"><script src="../assets/js/b.js"></script><img src="assets/img/c.svg">';
  assert.equal(versionAssets(html, 'x1'), '<link href="assets/css/a.css?v=x1"><script src="../assets/js/b.js?v=x1"></script><img src="assets/img/c.svg">');
});

test('orders keep the full customer details (name + country required on the site, rest optional)', async () => {
  const { createVercelApp } = require('../server/vercel/app');
  const { createMemoryRedis } = require('../server/vercel/memory-redis');
  const http = require('node:http');
  const app = createVercelApp({ env: { NODE_ENV: 'production', ADMIN_PASSWORD: 'pw-123456', LOG_SILENT: '1', VERCEL_URL: 't' }, redis: createMemoryRedis() });
  const call = (method, url, body, headers = {}) =>
    new Promise((resolve) => {
      const server = http.createServer((q, s) => app.handle(q, s)).listen(0, () => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request({ port: server.address().port, method, path: url, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, json: JSON.parse(t || '{}') });
          });
        });
        if (data) req.write(data);
        req.end();
      });
    });
  const customer = { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+31 6 1', address: 'Keizersgracht 1', postcode: '1015 AA', city: 'Amsterdam', country: 'Netherlands' };
  const r = await call('POST', '/api/orders', { ref: 'CS-T-1', items: [{ productId: 'cs-001', name: 'Jacket', qty: 1, price: 689 }], customer });
  assert.equal(r.status, 201);
  const login = await call('POST', '/api/admin/login', { password: 'pw-123456' });
  const list = await call('GET', '/api/admin/orders', null, { authorization: `Bearer ${login.json.token}` });
  const o = list.json.orders.find((x) => x.ref === 'CS-T-1');
  for (const [k, v] of Object.entries(customer)) assert.equal(o.customer[k], v, k);
});
