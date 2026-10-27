'use strict';
/** Spreadsheet import/export of products (public/assets/js/admin/{xlsx,product-sheet}.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../public/assets/js/admin/xlsx.js');
const PS = require('../public/assets/js/admin/product-sheet.js');

const products = require('../public/data/products.json');
const categories = require('../public/data/categories.json');
const settings = require('../public/data/settings.json');
const ctx = { products, categories, settings };
const clone = (o) => JSON.parse(JSON.stringify(o));

async function roundtrip(book) {
  return X.readXlsx(X.writeXlsx(book));
}
const sheet = (book, name) => book.sheets.find((s) => s.name === name);
const header = (s) => s.rows[0].map((h) => String(h).replace(/ \*$/, ''));

test('xlsx: written workbooks read back identically (strings, numbers, unicode, newlines)', async () => {
  const book = { sheets: [{ name: 'A', rows: [['ID', 'Name'], ['cs-1', 'Jas — 黑色 & “quotes” <b>\nline 2'], [null, 12.5]] }] };
  const r = await roundtrip(book);
  assert.deepEqual(r.sheets[0].rows, [['ID', 'Name'], ['cs-1', 'Jas — 黑色 & “quotes” <b>\nline 2'], [null, 12.5]]);
  assert.equal(X.colName(27), 'AB');
  assert.equal(X.colIndex('AB'), 27);
});

test('xlsx: deflated archives are read too (as saved by Excel/Sheets)', async () => {
  const zlib = require('node:zlib');
  const stored = X.writeXlsx({ sheets: [{ name: 'Products', rows: [['Name', 'Price'], ['Tee', 199]] }] });
  // Re-pack every entry with deflate to mimic a real Excel file.
  const files = X.unzip(stored);
  const entries = [];
  for (const [name, get] of files) entries.push({ name, data: Buffer.from(await get()) });
  const parts = [];
  const central = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const comp = zlib.deflateRawSync(e.data);
    const crc = X.crc32(new Uint8Array(e.data));
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  const r = await X.readXlsx(new Uint8Array(Buffer.concat([...parts, cd, end])));
  assert.deepEqual(r.sheets[0].rows, [['Name', 'Price'], ['Tee', 199]]);
});

test('csv: delimiter detection, quotes, BOM and sep= hint', () => {
  assert.deepEqual(X.parseCsv('﻿Name;Price\n"A; b";"1,5"\r\n'), [['Name', 'Price'], ['A; b', '1,5']]);
  assert.deepEqual(X.parseCsv('sep=,\nName,Notes\nA,"x ""q""\nnext"\n'), [['Name', 'Notes'], ['A', 'x "q"\nnext']]);
  assert.deepEqual(X.parseCsv('Name\tPrice\nTee\t199'), [['Name', 'Price'], ['Tee', '199']]);
});

test('numbers and yes/no parse in common spellings', () => {
  assert.equal(PS.num('689'), 689);
  assert.equal(PS.num('¥ 1.299,50'), 1299.5);
  assert.equal(PS.num('1,299.5'), 1299.5);
  assert.equal(PS.num('12,50'), 12.5);
  assert.equal(PS.num('1,299'), 1299);
  assert.equal(PS.num(''), null);
  assert.ok(Number.isNaN(PS.num('abc')));
  assert.equal(PS.yesNo('Ja'), true);
  assert.equal(PS.yesNo('no'), false);
  assert.equal(PS.yesNo(''), null);
  assert.equal(PS.yesNo('maybe'), undefined);
  assert.deepEqual(PS.parseColor('Clay #ae7658'), { name: 'Clay', hex: '#AE7658' });
  assert.deepEqual(PS.parseColor('Washed Black (#333)'), { name: 'Washed Black', hex: '#333' });
});

test('export → import without edits changes nothing', async () => {
  const r = PS.parse(await roundtrip(PS.build(ctx, {})), ctx);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.items.length, 0);
  assert.equal(r.counts.unchanged, products.length);
  assert.equal(r.missing.length, 0);
});

test('the empty template has example rows that are ignored on import', async () => {
  const book = PS.build(ctx, { template: true });
  assert.deepEqual(book.sheets.map((s) => s.name), ['How to fill in', 'Products', 'Stock', 'Lists']);
  const r = PS.parse(await roundtrip(book), ctx);
  assert.equal(r.items.length, 0);
  assert.equal(r.counts.examples, 3);
  assert.deepEqual(r.errors, []);
});

test('edited rows, new rows and stock rows become a clear import plan', async () => {
  const book = await roundtrip(PS.build(ctx, {}));
  const ps = sheet(book, 'Products');
  const st = sheet(book, 'Stock');
  const H = header(ps);
  const c = (k) => H.indexOf(k);
  // 1) change the price of the first product
  ps.rows[1][c('Price (CNY)')] = '749';
  // 2) a new product without ID, hex-less colours, Dutch price notation, unknown badge
  const row = [];
  row[c('Name')] = 'Garment-Dyed Overshirt';
  row[c('Status')] = 'published';
  row[c('Category')] = 'Shirts';
  row[c('Price (CNY)')] = '¥ 1.099,00';
  row[c('Colours')] = 'Black, Sage, Peacock';
  row[c('Sizes')] = 'S, M, L';
  row[c('Badges')] = 'new, hot';
  row[c('Details')] = '• Garment dyed\n• Corozo buttons';
  row[c('Weidian item ID')] = 7234567890;
  row[c('Weidian stock sync')] = 'yes';
  ps.rows.push(row);
  // 3) a row with a bad price is skipped, the rest still imports
  const badRow = [];
  badRow[c('Name')] = 'Broken Row';
  badRow[c('Price (CNY)')] = 'call us';
  ps.rows.push(badRow);
  // stock for the new product (by name) and a new size for an existing one (by ID)
  st.rows.push([null, 'Garment-Dyed Overshirt', 'black', 'M', 4, 'no']);
  st.rows.push([null, 'Garment-Dyed Overshirt', 'Sage', 'L', '2']);
  const first = products.slice().sort((a, b) => a.order - b.order)[0];

  const r = PS.parse(book, ctx);
  assert.equal(r.counts.create, 1);
  assert.equal(r.counts.update, 1);
  assert.equal(r.counts.skipped, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].msg, /Price “call us” is not a number/);

  const upd = r.items.find((i) => i.action === 'update');
  assert.equal(upd.id, first.id);
  assert.deepEqual(upd.changes, ['price']);
  assert.equal(upd.input.price, 749);

  const created = r.items.find((i) => i.action === 'create');
  assert.equal(created.input.price, 1099);
  assert.equal(created.input.category, 'shirts');
  assert.equal(created.input.status, 'published');
  assert.deepEqual(created.input.badges, ['new']);
  assert.deepEqual(created.input.details, ['Garment dyed', 'Corozo buttons']);
  assert.equal(created.input.weidian.itemId, '7234567890');
  assert.equal(created.input.weidian.syncEnabled, true);
  assert.equal(created.input.garment, 'shirt');
  assert.deepEqual(created.input.colors.map((x) => x.name), ['Black', 'Sage', 'Peacock']);
  assert.equal(created.input.colors[0].hex, PS.COLOR_HEX.black);
  assert.equal(created.input.variants.length, 9);
  const v = (col, size) => created.input.variants.find((x) => x.color === col && x.size === size);
  assert.equal(v('Black', 'M').stock, 4);
  assert.equal(v('Sage', 'L').stock, 2);
  assert.equal(v('Peacock', 'S').stock, 0);
  assert.ok(r.warnings.some((w) => /Badge “hot”/.test(w.msg)));
  assert.ok(r.warnings.some((w) => /Colour “Peacock” has no #hex/.test(w.msg)));
});

test('rows without ID match existing products by name; stock-only sheets update stock', async () => {
  const p = products[3];
  const book = {
    sheets: [
      { name: 'Products', rows: [['Name', 'Price (CNY)'], [p.name.toUpperCase(), p.price]] },
      { name: 'Stock', rows: [['Product name', 'Colour', 'Size', 'Stock'], [p.name, p.variants[0].color, p.variants[0].size, 77]] },
    ],
  };
  const r = PS.parse(book, ctx);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].matched, 'name');
  assert.equal(r.items[0].id, p.id);
  assert.deepEqual(r.items[0].changes, ['stock']);
  const v = r.items[0].input.variants.find((x) => x.color === p.variants[0].color && x.size === p.variants[0].size);
  assert.equal(v.stock, 77);
  assert.equal(v.sku, p.variants[0].sku, 'existing SKU is kept');
  assert.equal(r.items[0].input.variants.length, p.variants.length, 'other variants keep their stock');

  const only = PS.parse({ sheets: [{ name: 'Stock', rows: [['Product ID', 'Colour', 'Size', 'Stock'], [p.id, p.variants[1].color, p.variants[1].size, 3]] }] }, ctx);
  assert.equal(only.items.length, 1);
  assert.equal(only.items[0].stockOnly, true);
  assert.equal(only.missing.length, 0, 'a stock-only file never proposes deletions');
});

test('a plain CSV with Dutch headers imports as products', () => {
  const rows = X.parseCsv('Naam;Prijs;Kleuren;Maten;Categorie\nLinen Shirt;459;Ecru #E8E0CC;S, M;shirts\n');
  const r = PS.parse({ sheets: [{ name: 'producten', rows }] }, ctx);
  assert.equal(r.counts.create, 1);
  const i = r.items[0].input;
  assert.equal(i.price, 459);
  assert.equal(i.status, 'draft');
  assert.equal(i.colors[0].hex, '#E8E0CC');
  assert.equal(i.variants.length, 2);
  assert.equal(r.missing.length, products.length, 'products not in the file are listed (only removed when asked)');
});

test('uploaded photos survive export/import as placeholders', async () => {
  const list = clone(products);
  list[0].images = [{ url: 'data:image/png;base64,AAAA', alt: 'front', color: 'Clay' }, { url: '/uploads/back.jpg', alt: 'back', color: '' }];
  const c2 = { products: list, categories, settings };
  const book = await roundtrip(PS.build(c2, {}));
  const ps = sheet(book, 'Products');
  const col = header(ps).indexOf('Photo URLs');
  assert.equal(ps.rows[1][col], PS.UPLOADED + '\n/uploads/back.jpg');
  const r = PS.parse(book, c2);
  assert.equal(r.items.length, 0);
});
