#!/usr/bin/env node
'use strict';
/**
 * Local imitation of the Vercel deployment (for testing before you push):
 *
 *   npm run vercel:local            → http://localhost:3001
 *
 *  - serves dist/ like Vercel's CDN (cleanUrls, trailingSlash: false, 404.html)
 *  - applies the rewrites + headers from vercel.json
 *  - runs api/index.js for rewritten paths, exactly like the serverless function
 *  - uses Upstash when UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_*) are set
 *    in .env, otherwise an in-memory Redis (data is lost on restart)
 *  - POST /api/cron/tick works with  ?key=<CRON_SECRET>
 *
 * Runs scripts/build-vercel.js first unless --no-build is passed.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadEnvFile } = require('../server/lib/env');

const ROOT = path.resolve(__dirname, '..');
loadEnvFile(path.join(ROOT, '.env'));
if (!process.env.UPSTASH_REDIS_REST_URL && !process.env.KV_REST_API_URL) process.env.COLA_MEMORY_REDIS = '1';
if (!process.env.CRON_SECRET) process.env.CRON_SECRET = 'local-cron-secret';
process.env.VERCEL_URL = process.env.VERCEL_URL || 'local-preview';
process.env.NODE_ENV = process.env.NODE_ENV || 'development'; // dev default admin password when ADMIN_PASSWORD is unset

const args = process.argv.slice(2);
const port = Number((args.find((a) => a.startsWith('--port=')) || '').split('=')[1] || process.env.PORT || 3001);
if (!args.includes('--no-build')) require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-vercel.js')], { stdio: 'inherit', env: process.env });

const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const DIST = path.join(ROOT, vercel.outputDirectory || 'dist');
const fn = require(path.join(ROOT, 'api/index.js'));
const { serveFile, safeJoin, statFile } = require('../server/lib/http');

/** Minimal path-to-regexp for the patterns used in vercel.json (:name, :name*, (regex) groups). */
function compile(source) {
  const names = [];
  let re = '';
  for (let i = 0; i < source.length; ) {
    const c = source[i];
    if (c === ':') {
      const m = /^:([A-Za-z_]\w*)(\*)?/.exec(source.slice(i));
      names.push(m[1]);
      re += m[2] ? '(.*)' : '([^/]+)';
      i += m[0].length;
    } else if (c === '(') {
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === '(') depth++;
        else if (source[j] === ')' && --depth === 0) break;
      }
      re += source.slice(i, j + 1);
      names.push(null);
      i = j + 1;
    } else {
      re += /[.+?^${}|[\]\\]/.test(c) ? '\\' + c : c;
      i++;
    }
  }
  const rx = new RegExp(`^${re}$`);
  return (p) => {
    const m = rx.exec(p);
    if (!m) return null;
    const params = {};
    names.forEach((n, k) => {
      if (n) params[n] = m[k + 1] || '';
    });
    return params;
  };
}

const rewrites = (vercel.rewrites || []).map((r) => ({ match: compile(r.source), destination: r.destination }));
const headerRules = (vercel.headers || []).map((h) => ({ match: compile(h.source), headers: h.headers }));

function applyHeaders(res, p) {
  for (const rule of headerRules) if (rule.match(p)) for (const { key, value } of rule.headers) res.setHeader(key, value);
}

function staticFile(p) {
  const tryFile = (rel) => {
    const f = safeJoin(DIST, rel);
    return f && statFile(f) ? f : null;
  };
  if (p === '/') return tryFile('/index.html');
  return tryFile(p) || tryFile(p + '.html') || tryFile(p + '/index.html');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = decodeURIComponent(url.pathname);
  applyHeaders(res, p);

  // cleanUrls: /about.html → /about ; trailingSlash: false
  if (vercel.cleanUrls && /\.html$/.test(p)) {
    res.writeHead(308, { Location: p.replace(/(\/index)?\.html$/, '') || '/' });
    return res.end();
  }
  if (vercel.trailingSlash === false && p.length > 1 && p.endsWith('/')) {
    res.writeHead(308, { Location: p.replace(/\/+$/, '') + url.search });
    return res.end();
  }

  // 1) filesystem
  const file = p.startsWith('/api/') ? null : staticFile(p);
  if (file) return serveFile(req, res, file, { cacheControl: res.getHeader('Cache-Control') || 'public, max-age=0, must-revalidate' });

  // 2) rewrites
  for (const r of rewrites) {
    const params = r.match(p);
    if (!params) continue;
    let dest = r.destination.replace(/:([A-Za-z_]\w*)\*?/g, (_, n) => params[n] ?? '');
    const d = new URL(dest, 'http://local');
    for (const [k, v] of url.searchParams) if (!d.searchParams.has(k)) d.searchParams.append(k, v);
    req.url = d.pathname + d.search;
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
    return;
  }

  // 3) 404.html
  let body = 'Not found';
  try {
    body = fs.readFileSync(path.join(DIST, '404.html'));
  } catch {
    /* plain text */
  }
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : body);
});

// Cron imitation: call /api/cron/tick every 5 minutes like Vercel Cron (disable with --no-cron).
if (!args.includes('--no-cron')) {
  setInterval(() => {
    http.get({ host: '127.0.0.1', port, path: '/api/cron/tick', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }, (r) => r.resume()).on('error', () => {});
  }, 5 * 60 * 1000).unref();
}

server.listen(port, () => {
  const mode = process.env.COLA_MEMORY_REDIS === '1' ? 'in-memory Redis (not persisted)' : 'Upstash Redis';
  console.log(`Vercel-like preview on http://localhost:${port}  ·  storage: ${mode}`);
});
