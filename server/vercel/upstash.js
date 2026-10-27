'use strict';
/**
 * Minimal Upstash Redis REST client (no dependencies).
 *
 *   const r = createUpstash({ url, token });
 *   await r.cmd('SET', 'k', 'v');
 *   await r.pipeline([['GET', 'a'], ['INCR', 'b']]);   // → [resultA, resultB]
 *
 * Errors from Redis are thrown as Error with .redis = true. Every call has a
 * timeout and one retry on network failures (not on Redis errors).
 */

/** Find the REST credentials in the environment (Upstash direct or Vercel Marketplace names). */
function upstashEnv(env = process.env) {
  const pick = (...names) => names.map((n) => env[n]).find((v) => v && String(v).trim());
  let url = pick('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL');
  let token = pick('UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN');
  if (!url || !token) {
    // Marketplace integrations can add a custom prefix, e.g. STORAGE_KV_REST_API_URL.
    for (const [k, v] of Object.entries(env)) {
      if (!v) continue;
      if (!url && /(KV_REST_API_URL|REDIS_REST_URL)$/.test(k)) url = v;
      if (!token && /(KV_REST_API_TOKEN|REDIS_REST_TOKEN)$/.test(k) && !/READ_ONLY/.test(k)) token = v;
    }
  }
  return url && token ? { url: String(url).trim().replace(/\/+$/, ''), token: String(token).trim() } : null;
}

function createUpstash({ url, token, fetch: fetchFn = globalThis.fetch, timeoutMs = 10000 }) {
  if (!url || !token) throw new Error('Upstash: url and token are required');
  const base = url.replace(/\/+$/, '');
  let commands = 0;

  async function post(path, body, attempt = 0) {
    let res;
    try {
      res = await fetchFn(base + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < 1) return post(path, body, attempt + 1);
      throw new Error(`Upstash unreachable: ${err.message}`);
    }
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Upstash: invalid response (HTTP ${res.status})`);
    }
    if (!res.ok && !Array.isArray(json)) {
      const e = new Error(`Upstash: ${json && json.error ? json.error : 'HTTP ' + res.status}`);
      e.redis = true;
      throw e;
    }
    return json;
  }

  const str = (a) => (typeof a === 'string' ? a : Buffer.isBuffer(a) ? a.toString() : typeof a === 'object' ? JSON.stringify(a) : String(a));

  /** Run one command → its result. */
  async function cmd(...args) {
    commands++;
    const json = await post('', args.map(str));
    if (json.error) {
      const e = new Error(`Redis ${args[0]}: ${json.error}`);
      e.redis = true;
      throw e;
    }
    return json.result;
  }

  /** Run several commands in one round trip (not atomic) → array of results. Throws on the first error. */
  async function pipeline(list) {
    if (!list.length) return [];
    commands += list.length;
    const json = await post('/pipeline', list.map((c) => c.map(str)));
    return json.map((r, i) => {
      if (r && r.error) {
        const e = new Error(`Redis ${list[i][0]}: ${r.error}`);
        e.redis = true;
        throw e;
      }
      return r ? r.result : null;
    });
  }

  /** Like pipeline() but inside MULTI/EXEC (atomic). */
  async function multi(list) {
    if (!list.length) return [];
    commands += list.length;
    const json = await post('/multi-exec', list.map((c) => c.map(str)));
    return json.map((r, i) => {
      if (r && r.error) {
        const e = new Error(`Redis ${list[i][0]}: ${r.error}`);
        e.redis = true;
        throw e;
      }
      return r ? r.result : null;
    });
  }

  /** EVAL a Lua script. */
  function evalScript(script, keys = [], args = []) {
    return cmd('EVAL', script, String(keys.length), ...keys, ...args);
  }

  return { cmd, pipeline, multi, eval: evalScript, stats: () => ({ commands }) };
}

module.exports = { createUpstash, upstashEnv };
