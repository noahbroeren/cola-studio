#!/usr/bin/env node
/**
 * Renders the share images (Open Graph, 1200×630) for every page except
 * product and studio-update pages, which use their own photos.
 *
 *   node tools/build-og.js            → public/assets/brand/og/<page>.png
 *
 * Needs Playwright with Chromium (a dev tool only — the site itself does not
 * depend on it). Run it again after changing the copy below.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'assets', 'brand', 'og');
const FONTS = path.join(ROOT, 'public', 'assets', 'fonts');
const ENGRAVINGS = path.join(ROOT, 'public', 'assets', 'img', 'engravings');

/** name → copy and artwork. art: an engraving name, 'mono' (the monogram) or 'stock' (a stock board). */
const PAGES = {
  products: { eyebrow: 'The collection', thin: 'Every piece,', bold: 'in one place.', sub: 'Prices, live stock per size and worldwide ordering.', art: 'dressform' },
  'live-stock': { eyebrow: 'Live stock', thin: 'Every size,', bold: 'in real time.', sub: 'Stock per size and colour, synced with the Weidian store.', art: 'stock' },
  updates: { eyebrow: 'Studio updates', thin: 'From the', bold: 'studio floor.', sub: 'Drops, restocks and production notes from our Weibo.', art: 'machine' },
  'how-to-order': { eyebrow: 'How to order', thin: 'Order in', bold: 'three steps.', sub: 'WhatsApp, Weidian or your buying agent — shipped worldwide.', art: 'shears' },
  about: { eyebrow: 'About the studio', thin: 'An international', bold: 'fashion studio.', sub: 'Designed, cut and sewn in small runs.', art: 'thimble' },
  contact: { eyebrow: 'Contact', thin: 'Let’s', bold: 'talk.', sub: 'WhatsApp, Discord or email — the studio replies fast.', art: 'pincushion' },
  faq: { eyebrow: 'FAQ', thin: 'Questions,', bold: 'answered.', sub: 'Ordering, payment, shipping, sizing and returns.', art: 'spool' },
  'size-guide': { eyebrow: 'Size guide', thin: 'Find your', bold: 'size.', sub: 'Garment measurements and a fit finder for every piece.', art: 'dressform' },
  lookbook: { eyebrow: 'Lookbook', thin: 'Complete', bold: 'looks.', sub: 'Styled from the current collection.', art: 'spool' },
  brand: { eyebrow: 'Brand', thin: 'The', bold: 'mark.', sub: 'Logo, colours and typography of the studio.', art: 'mono' },
  order: { eyebrow: 'Your order', thin: 'One list,', bold: 'one message.', sub: 'Sent to the studio on WhatsApp — we confirm the rest.', art: 'shears' },
};

const MONO = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'brand', 'monogram.svg'), 'utf8')
  .replace(/color="[^"]*"/, '').replace(/style="[^"]*"/, '').replace('<svg ', '<svg class="mono" ');

function stockBoard() {
  // 6 sizes × 4 colours of little cells: filled = in stock, hatched = sold out
  const rows = [[1, 1, 1, 0, 1, 1], [1, 0, 1, 1, 1, 0], [0, 0, 1, 1, 1, 1], [1, 1, 1, 1, 0, 1]];
  return '<div class="board">' + ['S', 'M', 'L', 'XL', 'XXL', '3XL'].map((s) => `<span class="h">${s}</span>`).join('') +
    rows.map((r) => r.map((v) => `<span class="c ${v ? 'in' : 'out'}"></span>`).join('')).join('') + '</div>';
}

function html(p) {
  // fonts and engravings are inlined as data URIs (a page set with setContent cannot read file:// URLs)
  const data = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
  const font = (w, file, style = 'normal') => `@font-face{font-family:P;font-weight:${w};font-style:${style};src:url('${data(path.join(FONTS, file), 'font/ttf')}')}`;
  const art = p.art === 'mono' ? MONO : p.art === 'stock' ? stockBoard() : `<div class="eng" style="--m:url('${data(path.join(ENGRAVINGS, p.art + '.svg'), 'image/svg+xml')}')"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${font(300, 'Poppins-Light.ttf')}${font(400, 'Poppins-Regular.ttf')}${font(500, 'Poppins-Medium.ttf')}${font(700, 'Poppins-Bold.ttf')}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden}
body{font-family:P,sans-serif;background:#130D0A;color:#F3EEE6;position:relative;
  background-image:repeating-linear-gradient(90deg,rgba(243,238,230,.035) 0 1px,transparent 1px 100px)}
.seam{position:absolute;inset:22px;border:1px dashed rgba(243,238,230,.16)}
.txt{position:absolute;left:84px;top:96px;width:640px}
.eyebrow{display:flex;align-items:center;gap:14px;font-size:17px;font-weight:500;letter-spacing:.28em;text-transform:uppercase;color:#C07A42}
.eyebrow:before{content:"";width:34px;height:1px;background:#C07A42}
h1{margin-top:30px;font-size:88px;line-height:.98;letter-spacing:-.045em;font-weight:300}
h1 b{display:block;font-weight:700}
.sub{margin-top:28px;font-size:25px;line-height:1.45;font-weight:300;color:#BFB4A6;max-width:600px}
.foot{position:absolute;left:84px;bottom:68px;display:flex;align-items:center;gap:26px;font-size:17px;letter-spacing:.24em;text-transform:uppercase}
.foot b{font-weight:700}.foot span{font-weight:400}.foot i{font-style:normal;color:#8C8176;letter-spacing:.12em}
.art{position:absolute;right:70px;top:50%;transform:translateY(-50%);width:360px;height:420px;display:grid;place-items:center}
.eng{width:100%;height:100%;background:#C07A42;-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat}
.mono{width:340px;height:340px;color:#F3EEE6}
.board{display:grid;grid-template-columns:repeat(6,46px);gap:8px;align-items:center}
.board .h{font-size:15px;font-weight:500;text-align:center;color:#BFB4A6;letter-spacing:.04em;padding-bottom:6px}
.board .c{height:46px;border-bottom:3px solid #C07A42}
.board .in{background:rgba(192,122,66,.28)}
.board .out{border-bottom-color:rgba(243,238,230,.25);background:repeating-linear-gradient(135deg,rgba(243,238,230,.12) 0 5px,transparent 5px 10px)}
</style></head><body><div class="seam"></div>
<div class="txt"><p class="eyebrow">${p.eyebrow}</p><h1>${p.thin}<b>${p.bold}</b></h1><p class="sub">${p.sub}</p></div>
<div class="foot"><span><b>Cola</b> Studio</span><i>colastudio.com</i></div>
<div class="art">${art}</div>
</body></html>`;
}

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    console.error('Playwright is needed for this tool: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const only = process.argv.slice(2);
  for (const [name, p] of Object.entries(PAGES)) {
    if (only.length && !only.includes(name)) continue;
    await page.setContent(html(p), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('og/' + name + '.png');
  }
  await browser.close();
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });
module.exports = { PAGES };
