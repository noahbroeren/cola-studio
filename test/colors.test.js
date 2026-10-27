'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/assets/js/core/colors.js');

test('colour names → swatches (English, compound, Chinese, two-tone)', () => {
  assert.equal(C.infer('Black').hex, '#161514');
  assert.equal(C.infer('Haze Blue').hex, '#8FA3B8');
  assert.ok(C.infer('Brick Red').hex.startsWith('#A'));
  assert.deepEqual(C.infer('Black and White'), { hex: '#161514', hex2: '#F4F2EE' });
  assert.deepEqual(C.infer('黑白'), { hex: '#161514', hex2: '#F4F2EE' });
  assert.equal(C.infer('军绿色').hex, '#4E5332');
  assert.equal(C.infer('With Label Black (label-free version has no LP neck label)').hex, '#161514');
  for (const n of ['Default', 'Original Length', 'Japanese Fabric', 'Custom Without Pearls']) assert.equal(C.infer(n), null, n);
});

test('resolve keeps chosen colours, replaces the old placeholder grey, flags non-colours', () => {
  assert.deepEqual(C.resolve({ name: 'Navy', hex: '#123456' }), { hex: '#123456', hex2: '', real: true });
  assert.equal(C.resolve({ name: 'Haze Blue', hex: '#9A948E' }).hex, '#8FA3B8');
  assert.equal(C.resolve({ name: 'Default', hex: '#9A948E' }).real, false);
  assert.equal(C.label('Without Label Ebony (label-free version)'), 'Without Label Ebony');
});

test('colour families for the shop filter', () => {
  assert.deepEqual(C.families({ name: 'Black and White' }), ['Black', 'White']);
  assert.deepEqual(C.families({ name: 'Navy' }), ['Blue']);
  assert.deepEqual(C.families({ name: 'Khaki' }), ['Beige']);
  assert.deepEqual(C.families({ name: 'Olive' }), ['Green']);
  assert.deepEqual(C.families({ name: 'Default' }), []);
});
