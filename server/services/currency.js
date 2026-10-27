'use strict';
/**
 * Daily exchange-rate refresh (CNY base) from open.er-api.com. Only the
 * currencies listed in settings.currency.available are updated. Failures are
 * logged and otherwise ignored — the last known rates stay in place.
 */
const RATES_URL = 'https://open.er-api.com/v6/latest/CNY';
const DAY = 24 * 3600 * 1000;

async function refreshRates({ store, fetch: fetchFn = globalThis.fetch, log, force = false, now = Date.now() }) {
  const cur = store.db.settings.currency || {};
  if (!cur.autoUpdate && !force) return { skipped: 'autoUpdate disabled' };
  const last = Date.parse(cur.updatedAt || '');
  if (!force && Number.isFinite(last) && now - last < DAY - 10 * 60 * 1000) return { skipped: 'fresh' };
  try {
    const res = await fetchFn(RATES_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.result && json.result !== 'success') throw new Error(`API result: ${json.result}`);
    const rates = json.rates || {};
    const available = Array.isArray(cur.available) && cur.available.length ? cur.available : Object.keys(cur.rates || {});
    const next = { ...(cur.rates || {}) };
    const updated = [];
    for (const code of available) {
      if (code === 'CNY') {
        next.CNY = 1;
        continue;
      }
      const r = Number(rates[code]);
      if (Number.isFinite(r) && r > 0) {
        next[code] = Math.round(r * 1e6) / 1e6;
        updated.push(code);
      }
    }
    if (!updated.length) throw new Error('no usable rates in response');
    store.db.settings.currency = { ...cur, rates: next, updatedAt: new Date(now).toISOString() };
    store.db.meta.sync.currency = { at: new Date(now).toISOString(), status: 'ok', message: updated.join(', ') };
    store.save();
    log?.info(`exchange rates updated (${updated.join(', ')})`);
    return { updated };
  } catch (err) {
    store.db.meta.sync.currency = { at: new Date(now).toISOString(), status: 'error', message: err.message };
    log?.warn(`exchange-rate update failed: ${err.message}`);
    return { error: err.message };
  }
}

module.exports = { refreshRates, RATES_URL };
