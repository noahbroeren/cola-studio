'use strict';
/**
 * Lua scripts used against Upstash, each with an equivalent JS version that
 * the in-memory Redis (memory-redis.js) runs for local development and tests.
 */

/** Compare-and-set several collections at once. KEYS = data keys…, revision keys…; ARGV = rev1, value1, rev2, value2… */
const CAS = {
  lua: `local n = #KEYS / 2
for i = 1, n do
  local cur = redis.call('GET', KEYS[n + i]) or '0'
  if cur ~= ARGV[i * 2 - 1] then return {0, i} end
end
for i = 1, n do
  redis.call('SET', KEYS[i], ARGV[i * 2])
  redis.call('INCR', KEYS[n + i])
end
return {1}`,
  js(keys, args, r) {
    const n = keys.length / 2;
    for (let i = 0; i < n; i++) {
      const cur = r.get(keys[n + i]) ?? '0';
      if (cur !== args[i * 2]) return [0, i + 1];
    }
    for (let i = 0; i < n; i++) {
      r.set(keys[i], args[i * 2 + 1]);
      r.incr(keys[n + i]);
    }
    return [1];
  },
};

/** Seed when empty. KEYS[1] = meta data key; KEYS = data keys…, revision keys…; ARGV = values. */
const SEED = {
  lua: `if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
local n = #KEYS / 2
for i = 1, n do
  redis.call('SET', KEYS[i], ARGV[i])
  redis.call('SET', KEYS[n + i], '1')
end
return 1`,
  js(keys, args, r) {
    if (r.get(keys[0]) != null) return 0;
    const n = keys.length / 2;
    for (let i = 0; i < n; i++) {
      r.set(keys[i], args[i]);
      r.set(keys[n + i], '1');
    }
    return 1;
  },
};

/** Fixed-window counter. → {count, pttl} */
const RATE = {
  lua: `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) t = tonumber(ARGV[1]) end
return {c, t}`,
  js(keys, args, r) {
    const c = r.incr(keys[0]);
    if (c === 1) r.pexpire(keys[0], Number(args[0]));
    let t = r.pttl(keys[0]);
    if (t < 0) {
      r.pexpire(keys[0], Number(args[0]));
      t = Number(args[0]);
    }
    return [c, t];
  },
};

/** Release a lock only if we still own it. */
const UNLOCK = {
  lua: `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
  js(keys, args, r) {
    if (r.get(keys[0]) === args[0]) return r.del(keys[0]);
    return 0;
  },
};

module.exports = { CAS, SEED, RATE, UNLOCK, ALL_SCRIPTS: [CAS, SEED, RATE, UNLOCK] };
