'use strict';
/**
 * Upstash/Redis-backed store for serverless hosting (Vercel).
 *
 * Same interface as the disk Store (store.db, store.private, save(),
 * savePrivate(), snapshot(), findProduct(), …) but scoped to ONE request:
 *
 *   const store = new RedisStore({ redis, publicDir, log });
 *   await store.load(['settings', 'products', 'meta', 'private']);
 *   …route handler mutates store.db…
 *   await store.commit();      // writes only the collections that changed
 *
 * Every collection lives in its own key (cola:c:<name>) next to a revision
 * counter (cola:r:<name>). commit() writes all changed collections in one
 * Lua script that first checks the revisions (compare-and-set). When another
 * instance wrote the same collection in the meantime the remote version is
 * re-read and both changes are merged (see merge.js), then retried.
 *
 * Accessing a collection that was not loaded throws, so a missing entry in
 * the route → collection map fails loudly instead of silently writing [].
 */
const { Store, normalizeDb, LIMITS } = require('../lib/store');
const { merge3 } = require('./merge');
const { CAS, SEED } = require('./lua');

const DB_KEYS = ['settings', 'categories', 'products', 'updates', 'inventoryEvents', 'messages', 'orders', 'notify', 'meta'];
const ALL = [...DB_KEYS, 'private'];
const KEEP_BACKUPS = 7;

class RedisStore extends Store {
  /**
   * @param {object} o
   * @param {object} o.redis      client from upstash.js
   * @param {string} o.publicDir  for seeding from public/data on first use
   * @param {object} [o.log]
   * @param {string} [o.prefix]   key prefix (default "cola:")
   * @param {Function} [o.onCommit] async hook after a successful commit (log flushing)
   */
  constructor({ redis, publicDir, log, prefix = 'cola:', onCommit }) {
    super({ dataDir: '/tmp/cola-unused', publicDir, log });
    this.redis = redis;
    this.prefix = prefix;
    this.onCommit = onCommit || null;
    this.loaded = new Set();
    this.original = {}; // name → JSON string as loaded (after normalisation)
    this.rev = {}; // name → revision string
    this.pendingBackups = [];
    this.data = guard({}, this.loaded);
    this.private = null;
  }

  dataKey(name) {
    return `${this.prefix}c:${name}`;
  }

  revKey(name) {
    return `${this.prefix}r:${name}`;
  }

  /** Load collections ('all' or a list). Private config is always loaded (small). */
  async load(names = 'all') {
    const want = names === 'all' ? ALL : [...new Set([...names, 'private'])].filter((n) => ALL.includes(n));
    if (!want.length) return this;
    const keys = [...want.map((n) => this.dataKey(n)), ...want.map((n) => this.revKey(n))];
    let values = await this.redis.cmd('MGET', ...keys);
    const metaIdx = want.indexOf('meta');
    if (metaIdx >= 0 && values[metaIdx] == null) {
      await this.seedRedis();
      values = await this.redis.cmd('MGET', ...keys);
    }
    const raw = {};
    want.forEach((n, i) => {
      const v = values[i];
      let parsed;
      if (v != null) {
        try {
          parsed = JSON.parse(v);
        } catch {
          this.log.error(`Redis key ${this.dataKey(n)} holds invalid JSON — using defaults`);
        }
      }
      raw[n] = parsed;
      this.rev[n] = values[want.length + i] == null ? '0' : String(values[want.length + i]);
    });

    const dbNames = want.filter((n) => n !== 'private');
    const full = normalizeDb(Object.fromEntries(dbNames.map((n) => [n, raw[n]])));
    const target = {};
    for (const n of dbNames) {
      target[n] = full[n];
      this.loaded.add(n);
      this.original[n] = JSON.stringify(full[n]);
    }
    this.data = guard(target, this.loaded);
    this.private = this.normalizePrivate(raw.private);
    this.loaded.add('private');
    this.original.private = raw.private === undefined ? 'null' : JSON.stringify(this.private);
    return this;
  }

  /** Write the seed (public/data/*.json) when Redis is empty. */
  async seedRedis() {
    const db = this.seed();
    const names = [...DB_KEYS, 'private'];
    const values = names.map((n) => JSON.stringify(n === 'private' ? this.normalizePrivate({}) : db[n]));
    const keys = [...names.map((n) => this.dataKey(n)), ...names.map((n) => this.revKey(n))];
    // KEYS[1] must be the meta key for the EXISTS check.
    const order = [names.indexOf('meta'), ...names.map((_, i) => i).filter((i) => names[i] !== 'meta')];
    const k1 = order.map((i) => keys[i]);
    const k2 = order.map((i) => keys[names.length + i]);
    const seeded = await this.redis.eval(SEED.lua, [...k1, ...k2], order.map((i) => values[i]));
    if (Number(seeded) === 1) this.log.info('Redis was empty — seeded the database from public/data');
  }

  /* --------------------------------------------------------- persistence */

  save() {
    /* changes are detected at commit() */
  }

  savePrivate() {
    /* changes are detected at commit() */
  }

  flush() {}

  close() {}

  init() {
    throw new Error('RedisStore: use await store.load() instead of init()');
  }

  dailyBackup() {}

  /** Queue a snapshot of the current state; written during commit(). Returns the backup name. */
  snapshot(reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `db-${stamp}${reason ? '-' + String(reason).replace(/[^a-z0-9-]/gi, '') : ''}`;
    try {
      this.pendingBackups.push({ name, json: JSON.stringify(this.data) });
    } catch (err) {
      this.log.warn(`Backup failed: ${err.message}`);
      return null;
    }
    return name;
  }

  current(name) {
    return name === 'private' ? this.private : this.data[name];
  }

  changedNames() {
    const out = [];
    for (const n of this.loaded) {
      const cur = this.current(n);
      if (cur === undefined) continue;
      const s = JSON.stringify(cur);
      if (s !== this.original[n]) out.push([n, s]);
    }
    return out;
  }

  /** Persist changed collections (CAS + merge on conflict). → names written */
  async commit({ attempts = 6 } = {}) {
    let written = [];
    for (let attempt = 1; ; attempt++) {
      const changed = this.changedNames();
      if (!changed.length) break;
      const names = changed.map(([n]) => n);
      const keys = [...names.map((n) => this.dataKey(n)), ...names.map((n) => this.revKey(n))];
      const args = [];
      for (const [n, s] of changed) args.push(this.rev[n], s);
      const res = await this.redis.eval(CAS.lua, keys, args);
      if (Array.isArray(res) && Number(res[0]) === 1) {
        for (const [n, s] of changed) {
          this.original[n] = s;
          this.rev[n] = String(Number(this.rev[n]) + 1);
        }
        written = names;
        break;
      }
      if (attempt >= attempts) throw new Error(`Could not save (${names.join(', ')}) — too many concurrent changes, please retry`);
      await this.mergeRemote(names);
    }
    await this.writeBackups();
    if (this.onCommit) {
      try {
        await this.onCommit();
      } catch {
        /* logging must never break a request */
      }
    }
    return written;
  }

  /** Re-read the given collections and merge our changes onto them. */
  async mergeRemote(names) {
    const keys = [...names.map((n) => this.dataKey(n)), ...names.map((n) => this.revKey(n))];
    const values = await this.redis.cmd('MGET', ...keys);
    names.forEach((n, i) => {
      const remoteStr = values[i];
      const remoteRev = values[names.length + i] == null ? '0' : String(values[names.length + i]);
      if (remoteRev === this.rev[n]) return; // this one was not the conflict
      let theirs;
      try {
        theirs = remoteStr == null ? undefined : JSON.parse(remoteStr);
      } catch {
        theirs = undefined;
      }
      const base = JSON.parse(this.original[n]);
      const ours = this.current(n);
      let merged = theirs === undefined ? ours : merge3(base, ours, theirs);
      if (LIMITS[n] && Array.isArray(merged) && merged.length > LIMITS[n]) merged = merged.slice(-LIMITS[n]);
      if (n === 'inventoryEvents' && Array.isArray(merged)) merged.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      if (n === 'private') this.private = merged;
      else this.data[n] = merged;
      this.original[n] = remoteStr == null ? 'null' : JSON.stringify(theirs);
      this.rev[n] = remoteRev;
      this.log.info(`merged concurrent changes to "${n}"`);
    });
  }

  async writeBackups() {
    if (!this.pendingBackups.length) return;
    const list = this.pendingBackups.splice(0);
    const listKey = `${this.prefix}backups`;
    const cmds = [];
    for (const b of list) {
      cmds.push(['SET', `${this.prefix}backup:${b.name}`, b.json], ['LPUSH', listKey, b.name]);
    }
    cmds.push(['LRANGE', listKey, String(KEEP_BACKUPS), '-1']);
    try {
      const res = await this.redis.pipeline(cmds);
      const old = res[res.length - 1] || [];
      if (old.length) await this.redis.pipeline([['DEL', ...old.map((n) => `${this.prefix}backup:${n}`)], ['LTRIM', listKey, '0', String(KEEP_BACKUPS - 1)]]);
    } catch (err) {
      this.log.warn(`Backup failed: ${err.message}`);
    }
  }

  /** Names of stored backups, newest first. */
  async listBackups() {
    return (await this.redis.cmd('LRANGE', `${this.prefix}backups`, '0', '-1')) || [];
  }
}

/** Throw on access to db collections that were not loaded for this request. */
function guard(target, loaded) {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === 'string' && DB_KEYS.includes(prop) && !loaded.has(prop)) {
        throw new Error(`RedisStore: collection "${prop}" was not loaded for this request`);
      }
      return Reflect.get(t, prop, receiver);
    },
  });
}

module.exports = { RedisStore, DB_KEYS, ALL };
