'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deep merge `src` into a copy of `base`. Arrays and primitives in src replace. */
function deepMerge(base, src) {
  if (!isObj(base)) return src === undefined ? base : clone(src);
  if (!isObj(src)) return src === undefined ? clone(base) : clone(src);
  const out = clone(base);
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : clone(v);
  }
  return out;
}

/** Fill missing keys of `obj` from `defaults` (recursively), without replacing existing values. */
function withDefaults(obj, defaults) {
  if (!isObj(obj)) return clone(defaults);
  const out = { ...obj };
  for (const [k, v] of Object.entries(defaults)) {
    if (out[k] === undefined) out[k] = clone(v);
    else if (isObj(v) && isObj(out[k])) out[k] = withDefaults(out[k], v);
  }
  return out;
}

function clone(v) {
  return v === undefined ? undefined : structuredClone(v);
}

function slugify(input, max = 80) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Returns `base` or `base-2`, `base-3`… so that `taken(slug)` is false. */
function uniqueSlug(base, taken) {
  const root = base || 'item';
  if (!taken(root)) return root;
  for (let i = 2; i < 10000; i++) {
    const s = `${root}-${i}`;
    if (!taken(s)) return s;
  }
  return `${root}-${crypto.randomBytes(3).toString('hex')}`;
}

function randomId(prefix, bytes = 5) {
  return `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(bytes).toString('hex')}`;
}

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function toNumber(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function toInt(v, fallback = 0) {
  const n = toNumber(v, null);
  return n === null ? fallback : Math.trunc(n);
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function toBool(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function str(v, max = 10000) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max);
}

function truncate(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, '') + '…';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Atomic write: write to a temp file in the same directory, fsync, then rename
 * over the target. A crash mid-write never leaves a half-written file.
 */
function writeFileAtomic(file, data, { mode } = {}) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeFileSync(fd, data);
    try {
      fs.fsyncSync(fd);
    } catch {
      /* fsync unsupported on some filesystems — ignore */
    }
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** Compare two ids that may exceed Number.MAX_SAFE_INTEGER (Weibo ids). */
function compareIds(a, b) {
  try {
    const x = BigInt(String(a));
    const y = BigInt(String(b));
    return x < y ? -1 : x > y ? 1 : 0;
  } catch {
    return String(a).localeCompare(String(b));
  }
}

module.exports = {
  isObj,
  deepMerge,
  withDefaults,
  clone,
  slugify,
  uniqueSlug,
  randomId,
  sha1,
  sha256,
  toNumber,
  toInt,
  toBool,
  clamp,
  str,
  truncate,
  escapeHtml,
  sleep,
  readJsonFile,
  writeFileAtomic,
  compareIds,
};
