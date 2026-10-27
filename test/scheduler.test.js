'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Scheduler } = require('../server/services/scheduler');
const { refreshRates } = require('../server/services/currency');
const { Store } = require('../server/lib/store');
const { tmpDir, rmrf, fakeFetch, silentLog, FIXTURES } = require('./helpers');

test('scheduler: never overlaps, backs off exponentially on failure, resets on success', async (t) => {
  if (!t.mock.timers) return t.skip('mock timers need Node >= 20.4');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = new Scheduler({ log: silentLog() });
  let runs = 0;
  let active = 0;
  let maxActive = 0;
  let fail = true;
  let release;
  s.add('job', {
    interval: () => 1000,
    initialDelayMs: 0,
    maxBackoffMs: 8000,
    run: async () => {
      runs++;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => (release = r));
      active--;
      if (fail) throw new Error('upstream down');
      return { ok: true };
    },
  });
  s.start();
  const job = s.jobs.get('job');
  const flush = () => new Promise((r) => setImmediate(r));

  t.mock.timers.tick(0);
  await flush();
  assert.equal(runs, 1);
  t.mock.timers.tick(5000); // still running → no second run
  await flush();
  assert.equal(runs, 1);
  release();
  await flush();
  await flush();
  assert.equal(job.failures, 1);

  // next run after 2× interval
  t.mock.timers.tick(1999);
  await flush();
  assert.equal(runs, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(runs, 2);
  fail = false;
  release();
  await flush();
  await flush();
  assert.equal(job.failures, 0);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(runs, 3);
  assert.equal(maxActive, 1);
  release();
  await flush();
  s.stop();
});

test('scheduler: disabled jobs (interval 0) do not run; 409 is not a failure', async (t) => {
  if (!t.mock.timers) return t.skip('mock timers need Node >= 20.4');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = new Scheduler({ log: silentLog() });
  let runs = 0;
  let enabled = false;
  s.add('job', {
    interval: () => (enabled ? 1000 : 0),
    initialDelayMs: 0,
    idlePollMs: 500,
    run: async () => {
      runs++;
      throw Object.assign(new Error('busy'), { status: 409 });
    },
  });
  s.start();
  const flush = () => new Promise((r) => setImmediate(r));
  t.mock.timers.tick(0);
  await flush();
  assert.equal(runs, 0);
  enabled = true;
  t.mock.timers.tick(500);
  await flush();
  await flush();
  assert.equal(runs, 1);
  assert.equal(s.jobs.get('job').failures, 0);
  s.stop();
});

test('currency refresh: only available currencies, daily, fails silently', async (t) => {
  const dir = tmpDir();
  t.after(() => rmrf(dir));
  const store = new Store({ dataDir: dir, publicDir: path.join(FIXTURES, 'public'), log: silentLog() }).init();
  store.db.settings.currency.autoUpdate = true;
  store.db.settings.currency.updatedAt = '2026-10-20T00:00:00Z';
  const fetch = fakeFetch([
    ['open.er-api.com/v6/latest/CNY', () => ({ result: 'success', base_code: 'CNY', rates: { CNY: 1, EUR: 0.1281234567, USD: 0.14, GBP: 0.108, JPY: 21.3 } })],
  ]);
  const now = Date.parse('2026-10-26T12:00:00Z');
  const r = await refreshRates({ store, fetch, log: silentLog(), now });
  assert.deepEqual(r.updated, ['EUR', 'USD', 'GBP']);
  assert.deepEqual(store.db.settings.currency.rates, { CNY: 1, EUR: 0.128123, USD: 0.14, GBP: 0.108 });
  assert.equal(store.db.settings.currency.updatedAt, '2026-10-26T12:00:00.000Z');

  const again = await refreshRates({ store, fetch, log: silentLog(), now: now + 3600e3 });
  assert.equal(again.skipped, 'fresh');
  assert.equal(fetch.calls.length, 1);

  const broken = fakeFetch([['open.er-api.com', () => new Response('nope', { status: 500 })]]);
  const before = { ...store.db.settings.currency.rates };
  const failed = await refreshRates({ store, fetch: broken, log: silentLog(), force: true, now });
  assert.match(failed.error, /500/);
  assert.deepEqual(store.db.settings.currency.rates, before);

  store.db.settings.currency.autoUpdate = false;
  assert.equal((await refreshRates({ store, fetch, log: silentLog(), now: now + 3 * 86400e3 })).skipped, 'autoUpdate disabled');
});
