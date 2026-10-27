'use strict';
/**
 * In-memory stand-in for the Upstash client (same cmd/pipeline/multi/eval
 * interface). Supports exactly the commands the Vercel adapter uses. Used by
 * `npm run vercel:local` when no Upstash credentials are set, and by tests.
 * Data is lost when the process exits.
 */
const { ALL_SCRIPTS } = require('./lua');

function createMemoryRedis({ now = () => Date.now() } = {}) {
  const kv = new Map(); // key → { v, exp }
  let commands = 0;

  function live(key) {
    const e = kv.get(key);
    if (!e) return null;
    if (e.exp && e.exp <= now()) {
      kv.delete(key);
      return null;
    }
    return e;
  }

  const r = {
    get(key) {
      const e = live(key);
      if (!e) return null;
      if (typeof e.v !== 'string') throw new Error('WRONGTYPE');
      return e.v;
    },
    set(key, v, exp = 0) {
      kv.set(key, { v: String(v), exp });
    },
    incr(key) {
      const e = live(key);
      const n = (e ? Number(e.v) : 0) + 1;
      if (!Number.isFinite(n)) throw new Error('ERR value is not an integer');
      kv.set(key, { v: String(n), exp: e ? e.exp : 0 });
      return n;
    },
    del(...keys) {
      let n = 0;
      for (const k of keys) if (live(k) && kv.delete(k)) n++;
      return n;
    },
    pexpire(key, ms) {
      const e = live(key);
      if (!e) return 0;
      e.exp = now() + Number(ms);
      return 1;
    },
    pttl(key) {
      const e = live(key);
      if (!e) return -2;
      return e.exp ? Math.max(0, e.exp - now()) : -1;
    },
    hash(key, create) {
      const e = live(key);
      if (e) {
        if (!(e.v instanceof Map)) throw new Error('WRONGTYPE');
        return e.v;
      }
      if (!create) return null;
      const m = new Map();
      kv.set(key, { v: m, exp: 0 });
      return m;
    },
    list(key, create) {
      const e = live(key);
      if (e) {
        if (!Array.isArray(e.v)) throw new Error('WRONGTYPE');
        return e.v;
      }
      if (!create) return null;
      const l = [];
      kv.set(key, { v: l, exp: 0 });
      return l;
    },
  };

  const range = (len, start, stop) => {
    let s = Number(start);
    let e = Number(stop);
    if (s < 0) s = Math.max(0, len + s);
    if (e < 0) e = len + e;
    return [s, Math.min(e, len - 1)];
  };

  function exec(args) {
    commands++;
    const [name, ...a] = args.map(String);
    switch (name.toUpperCase()) {
      case 'PING':
        return 'PONG';
      case 'GET':
        return r.get(a[0]);
      case 'MGET':
        return a.map((k) => {
          const e = live(k);
          return e && typeof e.v === 'string' ? e.v : null;
        });
      case 'SET': {
        const [key, value, ...opts] = a;
        let nx = false;
        let exp = 0;
        for (let i = 0; i < opts.length; i++) {
          const o = opts[i].toUpperCase();
          if (o === 'NX') nx = true;
          else if (o === 'PX') exp = now() + Number(opts[++i]);
          else if (o === 'EX') exp = now() + Number(opts[++i]) * 1000;
        }
        if (nx && live(key)) return null;
        r.set(key, value, exp);
        return 'OK';
      }
      case 'DEL':
        return r.del(...a);
      case 'EXISTS':
        return a.filter((k) => live(k)).length;
      case 'INCR':
        return r.incr(a[0]);
      case 'PEXPIRE':
        return r.pexpire(a[0], a[1]);
      case 'PTTL':
        return r.pttl(a[0]);
      case 'HSET': {
        const h = r.hash(a[0], true);
        let added = 0;
        for (let i = 1; i < a.length; i += 2) {
          if (!h.has(a[i])) added++;
          h.set(a[i], a[i + 1]);
        }
        return added;
      }
      case 'HGETALL': {
        const h = r.hash(a[0], false);
        return h ? [...h.entries()].flat() : [];
      }
      case 'HDEL': {
        const h = r.hash(a[0], false);
        if (!h) return 0;
        let n = 0;
        for (const f of a.slice(1)) if (h.delete(f)) n++;
        return n;
      }
      case 'LPUSH': {
        const l = r.list(a[0], true);
        for (const v of a.slice(1)) l.unshift(v);
        return l.length;
      }
      case 'LRANGE': {
        const l = r.list(a[0], false);
        if (!l) return [];
        const [s, e] = range(l.length, a[1], a[2]);
        return e < s ? [] : l.slice(s, e + 1);
      }
      case 'LTRIM': {
        const l = r.list(a[0], false);
        if (!l) return 'OK';
        const [s, e] = range(l.length, a[1], a[2]);
        const keep = e < s ? [] : l.slice(s, e + 1);
        l.length = 0;
        l.push(...keep);
        return 'OK';
      }
      case 'FLUSHALL':
        kv.clear();
        return 'OK';
      case 'EVAL': {
        const [script, numkeys, ...rest] = a;
        const n = Number(numkeys);
        const s = ALL_SCRIPTS.find((x) => x.lua === script);
        if (!s) throw new Error('memory-redis: unknown script');
        return s.js(rest.slice(0, n), rest.slice(n), r);
      }
      default:
        throw new Error(`memory-redis: unsupported command ${name}`);
    }
  }

  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

  return {
    kind: 'memory',
    async cmd(...args) {
      return clone(exec(args));
    },
    async pipeline(list) {
      return list.map((c) => clone(exec(c)));
    },
    async multi(list) {
      return list.map((c) => clone(exec(c)));
    },
    async eval(script, keys = [], args = []) {
      return clone(exec(['EVAL', script, String(keys.length), ...keys, ...args]));
    },
    /** Test helper: raw access. */
    exec,
    keys: () => [...kv.keys()].filter((k) => live(k)),
    stats: () => ({ commands }),
  };
}

module.exports = { createMemoryRedis };
