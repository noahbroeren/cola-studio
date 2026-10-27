#!/usr/bin/env node
'use strict';
/**
 * Writes the product spreadsheet without opening the admin.
 *   node scripts/products-template.js                 → cola-studio-products-template.xlsx (empty, with examples)
 *   node scripts/products-template.js --export [db]   → all products from data/db.json (or public/data) as .xlsx
 *   node scripts/products-template.js --out file.xlsx
 * Uses the same code as Admin → Products → Import / export.
 */
const fs = require('node:fs');
const path = require('node:path');
const X = require('../public/assets/js/admin/xlsx.js');
const PS = require('../public/assets/js/admin/product-sheet.js');

const args = process.argv.slice(2);
const exp = args.includes('--export');
const outIdx = args.indexOf('--out');
const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

let products = [];
let categories = read(path.join(ROOT, 'public/data/categories.json'));
let settings = read(path.join(ROOT, 'public/data/settings.json'));
if (exp) {
  const dbFile = args.find((a) => a.endsWith('.json')) || path.join(ROOT, 'data/db.json');
  if (fs.existsSync(dbFile)) {
    const db = read(dbFile);
    products = db.products || [];
    categories = db.categories || categories;
    settings = db.settings || settings;
  } else products = read(path.join(ROOT, 'public/data/products.json'));
}
const out = outIdx >= 0 ? args[outIdx + 1] : exp ? `cola-studio-products-${new Date().toISOString().slice(0, 10)}.xlsx` : 'cola-studio-products-template.xlsx';
fs.writeFileSync(out, X.writeXlsx(PS.build({ products, categories, settings }, { template: !exp })));
console.log(`wrote ${out}${exp ? ` (${products.length} products)` : ''}`);
