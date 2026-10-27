'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAuth } = require('../server/lib/auth');
const { createRateLimiter } = require('../server/lib/ratelimit');
const { Router, safeJoin, parseCookies, serializeCookie, clientIp } = require('../server/lib/http');
const { injectRuntime, injectProduct, jsonForScript, sitemapXml } = require('../server/lib/html');
const { sniff, svgProblem, saveUpload, decodeData } = require('../server/lib/uploads');
const { tmpDir, rmrf } = require('./helpers');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('auth tokens: issue, verify, tamper, expiry, password rotation', () => {
  let now = 1_700_000_000_000;
  const auth = createAuth({ secret: 's'.repeat(40), password: 'pw', ttlMs: 1000, now: () => now });
  const { token, expiresAt } = auth.issue();
  assert.equal(expiresAt, new Date(now + 1000).toISOString());
  assert.equal(auth.verify(token).sub, 'admin');
  assert.equal(auth.fromRequest({ headers: { authorization: `Bearer ${token}` } }).sub, 'admin');
  assert.equal(auth.fromRequest({ headers: {} }), null);

  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'admin', iat: now, exp: now + 1e9 })).toString('base64url');
  assert.equal(auth.verify(`${forged}.${sig}`), null);
  assert.equal(auth.verify(`${body}.${sig.slice(0, -2)}xx`), null);
  assert.equal(auth.verify('garbage'), null);

  const rotated = createAuth({ secret: 's'.repeat(40), password: 'new', ttlMs: 1000, now: () => now });
  assert.equal(rotated.verify(token), null, 'changing the password invalidates tokens');

  now += 1001;
  assert.equal(auth.verify(token), null, 'expired');

  assert.equal(auth.checkPassword('pw'), true);
  assert.equal(auth.checkPassword('pw '), false);
  assert.equal(auth.checkPassword(''), false);
  assert.equal(auth.checkPassword(undefined), false);
});

test('rate limiter', () => {
  let t = 0;
  const rl = createRateLimiter({ windowMs: 1000, max: 2, now: () => t });
  assert.equal(rl.hit('ip').allowed, true);
  assert.equal(rl.hit('ip').allowed, true);
  const third = rl.hit('ip');
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfter, 1);
  assert.equal(rl.hit('other').allowed, true);
  t = 1001;
  assert.equal(rl.hit('ip').allowed, true);
});

test('router params, 405 detection, trailing slash', () => {
  const r = new Router();
  r.get('/api/products/:slug', () => 1);
  r.patch('/api/admin/products/:id/stock', () => 2);
  assert.deepEqual(r.match('GET', '/api/products/caf%C3%A9').params, { slug: 'café' });
  assert.ok(r.match('HEAD', '/api/products/x').route);
  assert.ok(r.match('GET', '/api/products/x/').route);
  assert.deepEqual(r.match('POST', '/api/products/x').allowed, ['GET']);
  assert.equal(r.match('GET', '/api/nope'), null);
  assert.equal(r.match('PATCH', '/api/admin/products/cs-001/stock').params.id, 'cs-001');
});

test('safeJoin blocks traversal, encoded separators, NUL and dotfiles', () => {
  const root = path.resolve('/srv/public');
  assert.equal(safeJoin(root, '/assets/a.css'), path.join(root, 'assets/a.css'));
  for (const bad of ['/../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/assets/..%2f..%2fserver.js', '/a%00.html', '/.env', '/assets/.git/config', '/..\\..\\x', '/%E0%A4%A']) {
    assert.equal(safeJoin(root, bad), null, bad);
  }
  assert.equal(safeJoin(root, '/.well-known/security.txt'), path.join(root, '.well-known/security.txt'));
});

test('cookies + client ip', () => {
  assert.deepEqual(parseCookies('a=1; b=hello%20world; a=2; c="q"'), { a: '1', b: 'hello world', c: 'q' });
  assert.match(serializeCookie('t', 'v', { maxAge: 60, secure: true }), /^t=v; Max-Age=60; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  const req = (remote, headers = {}) => ({ socket: { remoteAddress: remote }, headers });
  assert.equal(clientIp(req('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' })), '203.0.113.9', 'public peer: XFF ignored');
  assert.equal(clientIp(req('127.0.0.1', { 'x-forwarded-for': '6.6.6.6, 198.51.100.7' })), '198.51.100.7', 'right-most public entry');
  assert.equal(clientIp(req('::ffff:127.0.0.1', { 'x-real-ip': '198.51.100.8' })), '198.51.100.8');
  assert.equal(clientIp(req('127.0.0.1', { 'x-forwarded-for': '6.6.6.6' }), 'false'), '127.0.0.1');
});

test('injectRuntime: after charset meta, replaces existing marker/base, works without head', () => {
  const html = '<!doctype html><html><head>\n<meta charset="utf-8">\n<title>x</title></head><body></body></html>';
  const out = injectRuntime(html);
  assert.match(out, /<meta charset="utf-8"><meta name="cola-runtime" content="server"><base href="\/">\n<title>/);
  const replaced = injectRuntime('<html><head><meta name="cola-runtime" content="static"><base href="/x/"></head></html>');
  assert.equal((replaced.match(/cola-runtime/g) || []).length, 1);
  assert.match(replaced, /content="server"/);
  assert.match(replaced, /<base href="\/">/);
  assert.match(injectRuntime('<head><title>t</title></head>'), /^<head><meta name="cola-runtime" content="server"><base href="\/"><title>/);
  assert.match(injectRuntime('<p>hi</p>'), /^<meta name="cola-runtime"/);
});

test('injectProduct: title/description/OG/canonical/JSON-LD with escaping', () => {
  const html = '<html><head><meta charset="utf-8"><title>Product</title><meta name="description" content="generic"><meta property="og:title" content="x"></head><body></body></html>';
  const product = {
    id: 'cs-009',
    slug: 'test-tee',
    name: 'Test "Tee" </script>',
    description: 'Soft & heavy. '.repeat(30),
    price: 259,
    category: 'tops',
    images: [{ url: '/uploads/tee.jpg' }],
    variants: [{ stock: 0, preorder: true }],
  };
  const out = injectProduct(injectRuntime(html), product, { settings: { brand: { name: 'Cola Studio' } }, siteUrl: 'https://colastudio.com', categories: [{ id: 'tops', name: 'Tops' }] });
  assert.match(out, /<title>Test &quot;Tee&quot; &lt;\/script&gt; — Cola Studio<\/title>/);
  assert.equal((out.match(/<title>/g) || []).length, 1);
  assert.equal((out.match(/og:title/g) || []).length, 1);
  assert.match(out, /<meta property="og:image" content="https:\/\/colastudio.com\/uploads\/tee.jpg">/);
  assert.match(out, /<link rel="canonical" href="https:\/\/colastudio.com\/products\/test-tee">/);
  const desc = /<meta name="description" content="([^"]*)">/.exec(out)[1].replace(/&amp;/g, '&');
  assert.ok(desc.length <= 170 && desc.endsWith('…'));
  const ld = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(out)[1];
  assert.doesNotMatch(ld, /<\/script/i);
  const data = JSON.parse(ld);
  assert.equal(data['@type'], 'Product');
  assert.equal(data.offers.availability, 'https://schema.org/PreOrder');
  assert.equal(data.offers.priceCurrency, 'CNY');
  assert.equal(data.sku, 'cs-009');
  assert.equal(data.category, 'Tops');
  assert.equal(jsonForScript({ a: '</script><!--' }), '{"a":"\\u003c/script\\u003e\\u003c!--"}');
  assert.match(sitemapXml({ siteUrl: 'https://x.com', pages: [{ path: '/' }], products: [{ slug: 'a&b', updatedAt: '2026-10-01T00:00:00Z' }] }), /<loc>https:\/\/x.com\/products\/a%26b<\/loc><lastmod>2026-10-01<\/lastmod>/);
});

test('uploads: magic-byte sniffing, SVG scanning, content-addressed names, size limit', (t) => {
  assert.equal(sniff(Buffer.from(PNG_1PX, 'base64')), 'png');
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'jpg');
  assert.equal(sniff(Buffer.from('GIF89a......')), 'gif');
  assert.equal(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'webp');
  const avif = Buffer.alloc(32);
  avif.writeUInt32BE(28, 0);
  avif.write('ftypavif', 4);
  assert.equal(sniff(avif), 'avif');
  assert.equal(sniff(Buffer.from('<?xml version="1.0"?>\n<!-- hi --><svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(sniff(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(sniff(Buffer.from('MZ\x90\x00')), null);

  assert.match(svgProblem(Buffer.from('<svg><script>alert(1)</script></svg>')), /script/);
  assert.match(svgProblem(Buffer.from('<svg><rect onload="x()"/></svg>')), /event handler/);
  assert.match(svgProblem(Buffer.from('<svg><a href="javascript:alert(1)"><text>x</text></a></svg>')), /javascript/);
  assert.match(svgProblem(Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>')), /entity/);
  assert.equal(svgProblem(Buffer.from('<svg viewBox="0 0 10 10"><path d="M0 0h10"/></svg>')), null);

  assert.equal(decodeData(`data:image/png;base64,${PNG_1PX}`).length, decodeData(PNG_1PX).length);
  assert.throws(() => decodeData('not base64!!'), /valid base64/);

  const dir = tmpDir();
  t.after(() => rmrf(dir));
  const r = saveUpload({ filename: '../../Front View (1).PNG', data: `data:image/png;base64,${PNG_1PX}` }, { dir });
  assert.match(r.url, /^\/uploads\/front-view-1-[0-9a-f]{10}\.png$/);
  assert.equal(r.type, 'image/png');
  assert.ok(fs.existsSync(path.join(dir, r.name)));
  assert.equal(saveUpload({ filename: 'Front View (1).png', data: PNG_1PX }, { dir }).name, r.name, 'idempotent');
  assert.throws(() => saveUpload({ filename: 'x.png', data: PNG_1PX }, { dir, maxBytes: 10 }), /too large/);
  assert.throws(() => saveUpload({ filename: 'evil.svg', data: Buffer.from('<svg onload="x()"></svg>').toString('base64') }, { dir }), /Rejected SVG/);
  assert.throws(() => saveUpload({ filename: 'x.png', data: Buffer.from('hello').toString('base64') }, { dir }), /Unsupported file type/);
});
