'use strict';
/** Shared test helpers: temp dirs, fixture loading and a scriptable fake fetch. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURES = path.join(__dirname, 'fixtures');

function tmpDir(prefix = 'cola-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const fixture = (...p) => fs.readFileSync(path.join(FIXTURES, ...p), 'utf8');
const fixtureJson = (...p) => JSON.parse(fixture(...p));

/**
 * Fake fetch driven by a list of [matcher, responder] routes.
 * matcher: string (substring of URL), RegExp, or (url, init) => bool
 * responder: (url, init, call) => Response | object (JSON) | string
 * Unmatched requests throw (so nothing ever reaches the network).
 */
function fakeFetch(routes = []) {
  const calls = [];
  const fn = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
    const call = { url, method: (init.method || 'GET').toUpperCase(), headers, body: init.body };
    calls.push(call);
    for (const [match, respond] of routes) {
      const ok = typeof match === 'string' ? url.includes(match) : match instanceof RegExp ? match.test(url) : match(url, init);
      if (!ok) continue;
      const r = await respond(url, init, call);
      if (r instanceof Response) return r;
      if (typeof r === 'string') return new Response(r, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
    throw new Error(`fakeFetch: unexpected request to ${url}`);
  };
  fn.calls = calls;
  fn.routes = routes;
  return fn;
}

const noSleep = async () => {};
const silentLog = () => {
  const make = () => ({ debug() {}, info() {}, warn() {}, error() {}, child: make, capture: (lines) => captureLog(lines), lines: () => [] });
  return make();
};
function captureLog(lines) {
  const push = (level) => (...a) => lines.push(`${level === 'info' ? '' : level.toUpperCase() + ': '}${a.join(' ')}`);
  return { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error'), child: () => captureLog(lines), capture: (l) => captureLog(l) };
}

module.exports = { FIXTURES, tmpDir, rmrf, copyDir, fixture, fixtureJson, fakeFetch, noSleep, silentLog };
