'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store, stockStatus, productAvailability, loadOrCreateSecret } = require('../server/lib/store');
const { parseEnv } = require('../server/lib/env');
const { normalizeProduct, nextProductId, remapSku } = require('../server/lib/products');
const { tmpDir, rmrf, silentLog, FIXTURES, copyDir } = require('./helpers');

test('seeds db.json from public/data on first boot and creates private.json with defaults', (t) => {
  const dir = tmpDir();
  t.after(() => rmrf(dir));
  const store = new Store({ dataDir: dir, publicDir: path.join(FIXTURES, 'public'), log: silentLog() }).init();
  const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.equal(db.products.length, 3);
  assert.equal(db.categories.length, 2);
  assert.equal(db.updates.length, 4);
  assert.equal(db.settings.brand.name, 'Cola Studio');
  assert.deepEqual(db.settings.social, { instagram: '', weibo: '', tiktok: '', whatsappChannel: '', discord: '', xiaohongshu: '', yupoo: '' }, 'missing keys filled from defaults');
  assert.deepEqual(db.messages, []);
  assert.deepEqual(db.meta.seededFrom.sort(), ['categories.json', 'inventory-events.json', 'products.json', 'settings.json', 'updates.json']);
  // inventory events sorted oldest → newest
  assert.deepEqual(db.inventoryEvents.map((e) => e.at), ['2026-10-24T09:00:00Z', '2026-10-24T10:00:00Z', '2026-10-25T09:00:00Z']);

  const priv = JSON.parse(fs.readFileSync(path.join(dir, 'private.json'), 'utf8'));
  assert.equal(priv.weibo.backfill, 6);
  assert.equal(priv.translation.model, 'claude-sonnet-5-5');
  assert.equal(priv.weidian.provider, 'public-item');
  assert.equal(fs.statSync(path.join(dir, 'private.json')).mode & 0o777, 0o600);
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)), 'daily backup written');

  // Second boot reads db.json instead of reseeding
  store.db.products[0].name = 'Changed';
  store.writeNow();
  const again = new Store({ dataDir: dir, publicDir: path.join(FIXTURES, 'public'), log: silentLog() }).init();
  assert.equal(again.db.products[0].name, 'Changed');
});

test('placeholder WhatsApp number is replaced by the seed number once; real numbers are kept', (t) => {
  const dir = tmpDir();
  const pub = tmpDir();
  t.after(() => {
    rmrf(dir);
    rmrf(pub);
  });
  copyDir(path.join(FIXTURES, 'public'), pub);
  const store = new Store({ dataDir: dir, publicDir: pub, log: silentLog() }).init();
  assert.equal(store.db.settings.whatsapp.number, '31600000000', 'fixture seed has the placeholder');
  // The repo's settings.json now carries the studio's real number.
  const file = path.join(pub, 'data', 'settings.json');
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  seed.whatsapp.number = '8618060779381';
  fs.writeFileSync(file, JSON.stringify(seed));
  const again = new Store({ dataDir: dir, publicDir: pub, log: silentLog() }).init();
  assert.equal(again.db.settings.whatsapp.number, '8618060779381');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).settings.whatsapp.number, '8618060779381', 'written to disk');
  // A number the owner typed is never overwritten.
  again.db.settings.whatsapp.number = '31612345678';
  again.writeNow();
  assert.equal(new Store({ dataDir: dir, publicDir: pub, log: silentLog() }).init().db.settings.whatsapp.number, '31612345678');
});

test('seeding tolerates missing and broken seed files', (t) => {
  const dir = tmpDir();
  const pub = tmpDir();
  t.after(() => {
    rmrf(dir);
    rmrf(pub);
  });
  fs.mkdirSync(path.join(pub, 'data'));
  fs.writeFileSync(path.join(pub, 'data', 'products.json'), '{ not json');
  fs.writeFileSync(path.join(pub, 'data', 'updates.json'), JSON.stringify({ updates: [{ id: 'su-1', title: 'x' }] }));
  const store = new Store({ dataDir: dir, publicDir: pub, log: silentLog() }).init();
  assert.deepEqual(store.db.products, []);
  assert.equal(store.db.updates.length, 1);
  assert.equal(store.db.settings.currency.base, 'CNY');
});

test('debounced atomic writes leave no temp files; corrupt db.json recovers from backup', async (t) => {
  const dir = tmpDir();
  t.after(() => rmrf(dir));
  const store = new Store({ dataDir: dir, publicDir: path.join(FIXTURES, 'public'), log: silentLog(), saveDelayMs: 20 }).init();
  for (let i = 0; i < 50; i++) {
    store.db.messages.push({ id: `m${i}` });
    store.save();
  }
  await new Promise((r) => setTimeout(r, 80));
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.equal(onDisk.messages.length, 50);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);

  fs.writeFileSync(path.join(dir, 'db.json'), '{"truncated": ');
  const recovered = new Store({ dataDir: dir, publicDir: path.join(FIXTURES, 'public'), log: silentLog() }).init();
  assert.equal(recovered.db.products.length, 3, 'restored from the daily backup');
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('db.json.corrupt-')));
});

test('backups are pruned to the newest 10', (t) => {
  const dir = tmpDir();
  t.after(() => rmrf(dir));
  const store = new Store({ dataDir: dir, publicDir: path.join(FIXTURES, 'public'), log: silentLog() }).init();
  for (let i = 0; i < 14; i++) store.snapshot(`test${i}`);
  assert.equal(store.listBackups().length, 10);
});

test('inventory events are capped at 2000; env overrides win over private.json', (t) => {
  const dir = tmpDir();
  t.after(() => rmrf(dir));
  const store = new Store({ dataDir: dir, publicDir: path.join(FIXTURES, 'public'), log: silentLog() }).init();
  store.addInventoryEvents(Array.from({ length: 2500 }, (_, i) => ({ at: String(i), productId: 'x', sku: 'y', from: 0, to: i, source: 'admin' })));
  assert.equal(store.db.inventoryEvents.length, 2000);
  assert.equal(store.db.inventoryEvents.at(-1).to, 2499);
  store.private.translation.anthropicKey = 'from-file';
  const eff = store.effectivePrivate({ translation: { anthropicKey: 'from-env' } });
  assert.equal(eff.translation.anthropicKey, 'from-env');
  assert.equal(store.private.translation.anthropicKey, 'from-file');
});

test('stockStatus follows DATA_MODEL exactly', () => {
  const settings = { inventory: { lowStockThreshold: 5 } };
  assert.equal(stockStatus({ stock: 0, preorder: true }, {}, settings), 'preorder');
  assert.equal(stockStatus({ stock: 0 }, {}, settings), 'soldout');
  assert.equal(stockStatus({ stock: 0 }, { restockDate: '2026-11-01' }, settings), 'restocking');
  assert.equal(stockStatus({ stock: 5 }, {}, settings), 'low');
  assert.equal(stockStatus({ stock: 6 }, {}, settings), 'instock');
  assert.equal(stockStatus({ stock: 3 }, {}, { inventory: { lowStockThreshold: 2 } }), 'instock');
  assert.equal(productAvailability({ variants: [{ stock: 0 }, { stock: 2 }] }, settings), 'low');
});

test('session secret is generated once and persisted', (t) => {
  const dir = tmpDir();
  t.after(() => rmrf(dir));
  const a = loadOrCreateSecret(dir);
  assert.ok(a.length >= 32);
  assert.equal(loadOrCreateSecret(dir), a);
});

test('product normalisation: ids never reused, unique slugs, variants consistent', () => {
  const products = [
    { id: 'cs-001', slug: 'work-jacket', name: 'Work Jacket' },
    { id: 'cs-007', slug: 'tee', name: 'Tee' },
  ];
  assert.deepEqual(nextProductId(products, 3), { id: 'cs-008', seq: 8 });
  assert.deepEqual(nextProductId(products, 12), { id: 'cs-013', seq: 13 });
  const p = normalizeProduct(
    {
      name: 'Work Jacket',
      price: '689',
      variants: [
        { color: 'Washed Black', size: 'M', stock: '3' },
        { sku: 'X', color: 'Clay', size: 'L', stock: -4 },
        { sku: 'X', color: 'Clay', size: 'XL', stock: 2.7 },
      ],
      colors: ['Clay'],
      images: ['javascript:alert(1)', { url: '/uploads/a.jpg' }],
      _internal: 1,
    },
    { products, nextId: 'cs-008', now: '2026-10-26T00:00:00.000Z' }
  );
  assert.equal(p.id, 'cs-008');
  assert.equal(p.slug, 'work-jacket-2');
  assert.equal(p.price, 689);
  assert.equal(p.status, 'draft');
  assert.deepEqual(p.variants.map((v) => [v.sku, v.stock]), [
    ['CS008-WASHED-M', 3],
    ['X', 0],
    ['X-2', 2],
  ]);
  assert.deepEqual(p.colors.map((c) => c.name), ['Clay', 'Washed Black']);
  assert.deepEqual(p.sizes, ['M', 'L', 'XL']);
  assert.deepEqual(p.images.map((i) => i.url), ['/uploads/a.jpg']);
  assert.equal(p._internal, undefined);
  assert.equal(p.order, 10);
  assert.throws(() => normalizeProduct({ name: '' }, { products, nextId: 'cs-009' }), /name is required/);
  assert.throws(() => normalizeProduct({ name: 'x', price: 'abc' }, { products, nextId: 'cs-009' }), /price must be a number/);
  assert.throws(() => normalizeProduct({ name: 'x', status: 'live' }, { products, nextId: 'cs-009' }), /status must be one of/);
  assert.equal(remapSku('CS001-CLAY-S', 'cs-001', 'cs-014'), 'CS014-CLAY-S');
});

test('.env parser', () => {
  const env = parseEnv('# c\nA=1\nexport B="two words" # x\nC=\'lit $x\'\nD=plain # comment\nE="multi\\nline"\n bad line\n');
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'lit $x', D: 'plain', E: 'multi\nline' });
});

test('copyDir helper works (sanity)', (t) => {
  const d = tmpDir();
  t.after(() => rmrf(d));
  copyDir(path.join(FIXTURES, 'public'), d);
  assert.ok(fs.existsSync(path.join(d, 'data', 'products.json')));
});
