#!/usr/bin/env node
'use strict';
/**
 * Build the static part of the Vercel deployment.
 *
 *   public/  →  dist/
 *
 *  - every HTML page gets the server-runtime marker + <base href="/">
 *    (the same injection the Node server does at request time)
 *  - ?v=… cache busters on local JS/CSS are replaced by a per-deploy id,
 *    and added where missing, so /assets can be cached as immutable
 *  - public/data (seed only) and public/uploads (Redis on Vercel) are left out
 *
 * Run by Vercel ("buildCommand" in vercel.json); `npm run build:vercel` locally.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { injectRuntime, versionAssets } = require('../server/lib/html');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, process.env.BUILD_OUT || 'dist');
const SKIP = new Set(['data', 'uploads']);

/** Same id at build time and at runtime (VERCEL_GIT_COMMIT_SHA / VERCEL_URL are set in both). */
function buildId(env = process.env) {
  const seed = env.VERCEL_GIT_COMMIT_SHA || env.VERCEL_URL || env.BUILD_ID || String(Date.now());
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 10);
}

function copyDir(src, dst, id, rel = '') {
  fs.mkdirSync(dst, { recursive: true });
  let pages = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (!rel && SKIP.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      pages += copyDir(s, d, id, path.join(rel, entry.name));
    } else if (/\.html?$/i.test(entry.name)) {
      fs.writeFileSync(d, versionAssets(injectRuntime(fs.readFileSync(s, 'utf8')), id));
      pages++;
    } else {
      fs.copyFileSync(s, d);
    }
  }
  return pages;
}

function main() {
  const id = buildId();
  fs.rmSync(OUT, { recursive: true, force: true });
  const pages = copyDir(SRC, OUT, id);
  fs.writeFileSync(path.join(OUT, 'build.json'), JSON.stringify({ id, builtAt: new Date().toISOString() }) + '\n');
  console.log(`build-vercel: ${pages} page(s) → ${path.relative(ROOT, OUT)}/ (asset version ${id})`);
}

if (require.main === module) main();

module.exports = { buildId, versionAssets };
