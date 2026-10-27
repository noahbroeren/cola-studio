'use strict';
/**
 * Weibo → Studio Updates importer.
 *
 * Node port of the fetching logic of the Python Weibo→Discord bot (main.py):
 *   1. warm-up GET https://m.weibo.cn/u/{uid} to collect visitor cookies
 *   2. container id via getIndex?type=uid&value={uid} → tabsInfo (fallback 107603{uid})
 *   3. posts via getIndex?…&containerid=…  → cards with card_type 9
 *   4. long posts via https://m.weibo.cn/statuses/extend?id=…
 *   5. HTML → text cleanup, media extraction (pics + page_info video)
 *
 * Differences from the bot: on the very first run we import the latest
 * `backfill` posts (default 6) so the site has some history; afterwards only
 * ids newer than lastId. Every post is deduped by id, translated, and stored as
 * an `updates` item. Media URLs point at our /media/weibo proxy.
 */
const { compareIds, sleep: realSleep } = require('../lib/util');
const { decodeEntities, categorize, CATEGORY_LABELS } = require('./translate');
const { MediaCache, allowedMediaUrl, MOBILE_UA } = require('./media');

const WEIBO_HEADERS = {
  'User-Agent': MOBILE_UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'X-Requested-With': 'XMLHttpRequest',
  'MWeibo-Pwa': '1',
  Referer: 'https://m.weibo.cn/',
};

/* ------------------------------------------------------------------------ */
/* Cookie jar                                                                 */
/* ------------------------------------------------------------------------ */

function splitSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  if (!raw) return [];
  // Split on commas that start a new "name=" pair (Expires dates contain commas).
  return raw.split(/,(?=\s*[A-Za-z0-9_\-.]+=)/);
}

function parseCookieString(str) {
  const map = new Map();
  for (const part of String(str || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    map.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return map;
}

class CookieJar {
  constructor() {
    this.map = new Map();
  }
  absorb(res) {
    for (const line of splitSetCookie(res.headers)) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      if (i <= 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired =
        value === '' ||
        value === 'deleted' ||
        attrs.some((a) => /^\s*max-age\s*=\s*(0|-\d+)\s*$/i.test(a)) ||
        attrs.some((a) => {
          const m = /^\s*expires\s*=\s*(.+)$/i.exec(a);
          return m && Date.parse(m[1]) < Date.now();
        });
      if (expired) this.map.delete(name);
      else this.map.set(name, value);
    }
  }
  names() {
    return [...this.map.keys()];
  }
  get(name) {
    return this.map.get(name);
  }
  /** Cookie header: the user's own cookie first, jar cookies for names it does not define. */
  header(userCookie) {
    const merged = parseCookieString(userCookie);
    for (const [k, v] of this.map) if (!merged.has(k)) merged.set(k, v);
    return [...merged].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/* ------------------------------------------------------------------------ */
/* Parsing helpers (pure — unit tested)                                       */
/* ------------------------------------------------------------------------ */

/** Weibo HTML → plain text (port of clean_text with the extra cleanup steps). */
function cleanText(raw) {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div)>/gi, '\n');
  s = s.replace(/<img\b[^>]*>/gi, ''); // emoticons ([哈哈] etc.) and link icons
  // Drop "网页链接" (web link) anchors entirely.
  s = s.replace(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*?网页链接(?:(?!<\/a>)[\s\S])*?<\/a>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/网页链接/g, '');
  s = s.replace(/[​‌﻿]/g, '');
  s = s.replace(/\s*(\.\.\.|…)?\s*(全文|查看更多)\s*$/, '');
  s = s
    .split('\n')
    .map((l) => l.replace(/[ \t ]+$/g, '').replace(/^[ \t ]+/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** → { images: [url], video: { url, poster } | null } (port of extract_media). */
function extractMedia(mblog) {
  const images = [];
  const pics = Array.isArray(mblog?.pics) ? mblog.pics : mblog?.pics && typeof mblog.pics === 'object' ? Object.values(mblog.pics) : [];
  for (const pic of pics) {
    const url = pic?.large?.url || pic?.url;
    if (url) images.push(url);
  }
  let video = null;
  const pi = mblog?.page_info;
  if (pi && pi.type === 'video') {
    const mi = pi.media_info || {};
    let url = null;
    for (const k of ['stream_url_hd', 'mp4_hd_url', 'stream_url', 'mp4_sd_url']) {
      if (mi[k]) {
        url = mi[k];
        break;
      }
    }
    if (!url && pi.urls && typeof pi.urls === 'object') {
      for (const k of ['mp4_720p_mp4', 'mp4_hd_mp4', 'mp4_ld_mp4']) {
        if (pi.urls[k]) {
          url = pi.urls[k];
          break;
        }
      }
    }
    if (url) video = { url, poster: pi.page_pic?.url || null };
  }
  return { images, video };
}

/** mblogs from a getIndex payload: card_type 9 (also inside card_group). */
function pickPosts(payload) {
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  const out = [];
  for (const c of cards) {
    if (Number(c?.card_type) === 9 && c.mblog) out.push(c.mblog);
    else if (Array.isArray(c?.card_group)) {
      for (const g of c.card_group) if (Number(g?.card_type) === 9 && g.mblog) out.push(g.mblog);
    }
  }
  return out;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** "Sun Oct 26 10:12:00 +0800 2026" → ISO; relative/unknown formats → `now`. */
function parseWeiboDate(s, now = new Date()) {
  const m = /^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/.exec(String(s || '').trim());
  if (m && MONTHS[m[1]] !== undefined) {
    const offset = (m[6] === '-' ? -1 : 1) * (Number(m[7]) * 60 + Number(m[8]));
    const utc = Date.UTC(Number(m[9]), MONTHS[m[1]], Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) - offset * 60000;
    return new Date(utc).toISOString();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : now.toISOString();
}

const isTrivialRepost = (text) => !text || /^(转发微博|Repost|轉發微博)$/i.test(text.trim());

/* ------------------------------------------------------------------------ */
/* Service                                                                    */
/* ------------------------------------------------------------------------ */

class WeiboService {
  /**
   * @param {object} o
   * @param {() => object} o.getConfig   effective private.weibo config
   * @param {object} o.store             Store
   * @param {object} o.translator        { translatePost }
   * @param {object} [o.media]           MediaCache (for prefetch)
   */
  constructor({ getConfig, store, translator, media, log, fetch: fetchFn = globalThis.fetch, sleep = realSleep, prefetch = true }) {
    this.getConfig = getConfig;
    this.store = store;
    this.translator = translator;
    this.media = media;
    this.log = log || { info() {}, warn() {}, error() {}, capture: () => this.log };
    this.fetch = fetchFn;
    this.sleep = sleep;
    this.prefetchEnabled = prefetch;
    this.running = null;
    this.pending = Promise.resolve();
    this.jar = new CookieJar();
  }

  get busy() {
    return !!this.running;
  }

  /** Resolves when background media prefetching is done (tests / shutdown). */
  idle() {
    return this.pending;
  }

  /* --------------------------------------------------------------- HTTP */

  async request(url, { headers = {}, log } = {}) {
    const cfg = this.getConfig() || {};
    let current = url;
    for (let hop = 0; hop < 6; hop++) {
      const h = { ...WEIBO_HEADERS, ...headers };
      for (const k of Object.keys(h)) if (h[k] === undefined || h[k] === null) delete h[k];
      const cookie = this.jar.header(cfg.cookie);
      if (cookie) h.Cookie = cookie;
      const xsrf = this.jar.get('XSRF-TOKEN');
      if (xsrf && h['X-Requested-With']) h['X-XSRF-TOKEN'] = xsrf;
      const res = await this.fetch(current, { headers: h, redirect: 'manual', signal: AbortSignal.timeout(25000) });
      this.jar.absorb(res);
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        const next = new URL(loc, current);
        if (!/(^|\.)(weibo\.(cn|com)|sina\.(cn|com\.cn))$/i.test(next.hostname)) {
          if (log) log.warn(`not following redirect to ${next.hostname}`);
          return res;
        }
        current = next.href;
        continue;
      }
      return res;
    }
    throw new Error('too many redirects');
  }

  /** Warm-up: fetch the profile page so Weibo hands out visitor cookies. */
  async warmUp(uid, log) {
    try {
      const res = await this.request(`https://m.weibo.cn/u/${encodeURIComponent(uid)}`, {
        headers: { Accept: 'text/html,application/xhtml+xml', 'X-Requested-With': undefined, 'MWeibo-Pwa': undefined },
        log,
      });
      try {
        await res.text();
      } catch {
        /* drain */
      }
      log.info(`Warm-up done (HTTP ${res.status}). Cookies: ${this.jar.names().join(', ') || '(none)'}`);
    } catch (err) {
      log.warn(`Warm-up failed (${err.message}); trying anyway.`);
    }
  }

  /** getIndex call with retries + diagnostics (port of weibo_api). */
  async api(params, log, attempts = 3) {
    const cfg = this.getConfig() || {};
    const qs = new URLSearchParams(params).toString();
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let res;
      let text;
      try {
        res = await this.request(`https://m.weibo.cn/api/container/getIndex?${qs}`, {
          headers: { Referer: `https://m.weibo.cn/u/${encodeURIComponent(cfg.uid || '')}` },
          log,
        });
        text = await res.text();
      } catch (err) {
        lastError = `network error: ${err.message}`;
        log.warn(`attempt ${attempt}/${attempts} failed (${lastError})`);
        if (attempt < attempts) await this.sleep(attempt * 3000);
        continue;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        const snippet = String(text || '').slice(0, 300).replace(/\s+/g, ' ');
        lastError = `HTTP ${res.status}, content-type '${res.headers.get('content-type') || ''}'. Response started with: ${JSON.stringify(snippet)}`;
        log.warn(`attempt ${attempt}/${attempts}: no JSON returned. ${lastError}`);
        if (attempt < attempts) await this.sleep(attempt * 3000);
        continue;
      }
      if (data && (data.ok === 0 || data.ok === '0')) {
        lastError = `Weibo returned ok=0: ${JSON.stringify(data.msg ?? '')}`;
        log.warn(`attempt ${attempt}/${attempts}: ${lastError}`);
        if (attempt < attempts) await this.sleep(attempt * 3000);
        continue;
      }
      return data || {};
    }
    throw new Error(
      `Could not get valid JSON from Weibo after ${attempts} attempts. Last problem: ${lastError}. ` +
        'Most likely cause: Weibo blocks this server IP (datacenter ranges) or requires a logged-in session — ' +
        'set the Weibo cookie in Admin → Integrations (see docs/BACKEND.md).'
    );
  }

  async getContainerId(uid, log) {
    try {
      const data = await this.api({ type: 'uid', value: uid }, log);
      const tabs = data?.data?.tabsInfo?.tabs;
      const list = Array.isArray(tabs) ? tabs : tabs && typeof tabs === 'object' ? Object.values(tabs) : [];
      const weibo = list.find((t) => t && t.tab_type === 'weibo' && t.containerid);
      if (weibo) return String(weibo.containerid);
      if (list[0]?.containerid) return String(list[0].containerid);
      log.info('No tabsInfo found; falling back to the standard container id.');
    } catch (err) {
      log.warn(`Container lookup failed (${err.message}); falling back to the standard container id.`);
    }
    return `107603${uid}`;
  }

  async getPosts(uid, containerid, log, extra = {}) {
    const data = await this.api({ type: 'uid', value: uid, containerid, ...extra }, log);
    const payload = (data && data.data) || {};
    const posts = pickPosts(payload);
    if (!posts.length) {
      const cards = Array.isArray(payload.cards) ? payload.cards : [];
      log.warn('Diagnosis: no posts in the response.');
      log.info(`- keys in data: ${Object.keys(payload).sort().join(', ') || '(none)'}`);
      log.info(`- number of cards: ${cards.length}`);
      if (cards.length) log.info(`- card_types found: ${[...new Set(cards.map((c) => c?.card_type))].join(', ')}`);
      if (payload.cardlistInfo) log.info(`- cardlistInfo total: ${payload.cardlistInfo.total}`);
      if (!payload.userInfo && !payload.tabsInfo) {
        log.warn('- No userInfo/tabsInfo: Weibo treats us as a logged-out visitor. Set the Weibo cookie (docs/BACKEND.md).');
      } else {
        log.info('- Profile data is present; the account may have no public posts on this page.');
      }
    }
    return { posts, sinceId: payload?.cardlistInfo?.since_id };
  }

  /** Full text for truncated posts (port of get_full_text). */
  async getFullText(mblog, log) {
    const raw = mblog?.text || '';
    if (mblog?.isLongText || raw.includes('全文')) {
      try {
        const res = await this.request(`https://m.weibo.cn/statuses/extend?id=${encodeURIComponent(mblog.id)}`, { log });
        if (res.status === 200) {
          const json = JSON.parse(await res.text());
          const long = json?.data?.longTextContent;
          if (long) return long;
        }
      } catch (err) {
        log.warn(`long text for ${mblog.id} unavailable (${err.message}); using the short version`);
      }
    }
    return raw;
  }

  /* ---------------------------------------------------------------- run */

  /**
   * Fetch new posts. → { ok, fetched, added, skipped, errors, log }
   * Never throws for upstream problems; they are reported in `errors`.
   */
  async run({ force = 0, trigger = 'manual' } = {}) {
    if (this.history && this.history.state === 'running') {
      // The history import already talks to Weibo; the regular fetch waits for the next tick.
      return { ok: true, fetched: 0, added: 0, skipped: 0, errors: [], log: ['History import running — regular fetch skipped.'], deferred: true };
    }
    if (this.running) {
      const err = new Error('A Weibo fetch is already running');
      err.status = 409;
      throw err;
    }
    this.running = this._run(Math.max(0, Math.min(50, Number(force) || 0)), trigger).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async _run(force, trigger) {
    const lines = [];
    const log = this.log.capture ? this.log.capture(lines, 'weibo') : this.log;
    const result = { ok: true, fetched: 0, added: 0, skipped: 0, errors: [], log: lines };
    const cfg = this.getConfig() || {};
    const db = this.store.db;
    const uid = String(cfg.uid || '').trim();

    try {
      if (!uid) throw new Error('Weibo uid is not configured (Admin → Integrations or WEIBO_UID)');
      log.info(`Fetching Weibo posts for uid ${uid} (${trigger}${force ? `, force=${force}` : ''})`);

      await this.warmUp(uid, log);
      const containerid = await this.getContainerId(uid, log);
      log.info(`Container id: ${containerid}`);
      let { posts, sinceId } = await this.getPosts(uid, containerid, log);

      const lastId = cfg.lastId ? String(cfg.lastId) : null;
      const want = force || (lastId ? 0 : Math.max(0, Number(cfg.backfill ?? 6)));
      if (want > posts.length && posts.length) {
        // One extra page when a backfill/force asks for more than page 1 holds.
        try {
          await this.sleep(1500);
          const more = await this.getPosts(uid, containerid, log, sinceId ? { since_id: sinceId } : { page: 2 });
          const seen = new Set(posts.map((p) => String(p.id)));
          posts = posts.concat(more.posts.filter((p) => !seen.has(String(p.id))));
        } catch (err) {
          log.warn(`second page unavailable: ${err.message}`);
        }
      }

      posts = posts.filter((p) => p && p.id != null).sort((a, b) => compareIds(a.id, b.id)); // oldest first
      result.fetched = posts.length;
      log.info(`${posts.length} post(s) fetched.`);
      if (!posts.length) {
        log.warn(
          'No posts found. Weibo answered, but without usable posts. The uid/container id may be wrong, ' +
            'or Weibo only serves posts to logged-in sessions (see docs/BACKEND.md: Weibo cookie).'
        );
        this.finish(result, { lastId, uid });
        return result;
      }

      let selection;
      if (force > 0) {
        selection = posts.slice(-force);
        log.info(`force=${force}: considering the newest ${selection.length} post(s) regardless of saved state.`);
      } else if (!lastId) {
        selection = want > 0 ? posts.slice(-want) : [];
        log.info(`First run: importing the newest ${selection.length} post(s) as history.`);
      } else {
        selection = posts.filter((p) => compareIds(p.id, lastId) > 0);
        if (!selection.length) log.info('No new posts since the previous run.');
      }

      const existing = new Set(db.updates.filter((u) => u.source === 'weibo').map((u) => String(u.sourceId)));
      const deleted = new Set((db.meta.weiboDeleted || []).map(String));
      const products = db.products.filter((p) => p.status !== 'archived');
      const prefetch = [];

      for (const post of selection) {
        const pid = String(post.id);
        if (existing.has(pid) || (deleted.has(pid) && !force)) {
          result.skipped++;
          continue;
        }
        try {
          const own = cleanText(await this.getFullText(post, log));
          const retweeted = !!post.retweeted_status;
          if (retweeted && isTrivialRepost(own)) {
            log.info(`Skipping repost ${pid} without own text.`);
            result.skipped++;
            continue;
          }
          const media = extractMedia(post);
          const tr = await this.translator.translatePost(own, { products });
          const update = this.buildUpdate(post, own, media, tr, cfg);
          db.updates.push(update);
          existing.add(pid);
          if (deleted.has(pid)) db.meta.weiboDeleted = db.meta.weiboDeleted.filter((x) => String(x) !== pid);
          result.added++;
          log.info(`Added ${update.id} — "${update.title}" (${update.status}${tr.ok ? '' : ', translation failed: ' + tr.error})`);
          prefetch.push(...media.images);
          if (media.video) prefetch.push(media.video.url, ...(media.video.poster ? [media.video.poster] : []));
          await this.sleep(800);
        } catch (err) {
          result.errors.push(`post ${pid}: ${err.message}`);
          log.error(`post ${pid} failed: ${err.message}`);
        }
      }

      // Move the bookmark to the newest post we have seen.
      const newest = String(posts[posts.length - 1].id);
      const newLast = !lastId || compareIds(newest, lastId) > 0 ? newest : lastId;
      this.finish(result, { lastId: newLast, uid });

      if (prefetch.length && this.media && this.prefetchEnabled) {
        const urls = prefetch.filter((u) => allowedMediaUrl(u));
        this.pending = this.pending.then(() => this.media.prefetch(urls)).catch(() => {});
      }
      log.info(`Done. ${result.added} new post(s), ${result.skipped} skipped.`);
    } catch (err) {
      result.ok = false;
      result.errors.push(err.message);
      log.error(err.message);
      this.finish(result, { lastId: cfg.lastId ?? null, uid, error: err.message });
    }
    return result;
  }

  /* ------------------------------------------------------ history import */

  /**
   * Import older posts page by page (newest → oldest) in the background.
   * Phase 1 stores every post as `pending` with its Chinese text (fast, a few
   * seconds per page). Phase 2 translates the queued posts, newest first, and
   * publishes them when auto-publish is on. A cursor in db.meta.weiboHistory
   * lets a stopped or failed import continue where it left off.
   * opts: { limit, translate, resume, translateOnly, publishUntranslated }
   */
  startHistory(opts = {}) {
    if (this.history && this.history.state === 'running') throw Object.assign(new Error('A history import is already running'), { status: 409 });
    if (this.running) throw Object.assign(new Error('A Weibo fetch is running right now — try again in a minute'), { status: 409 });
    const cursor = this.store.db.meta.weiboHistory || null;
    const h = {
      state: 'running',
      phase: opts.translateOnly ? 'translate' : 'fetch',
      limit: Math.max(10, Math.min(3000, Math.round(Number(opts.limit) || 100))),
      translate: opts.translate !== false,
      publishUntranslated: !!opts.publishUntranslated,
      translateOnly: !!opts.translateOnly,
      resumeFrom: opts.resume && cursor && cursor.sinceId ? String(cursor.sinceId) : null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      pages: 0,
      seen: 0,
      added: 0,
      skipped: 0,
      toTranslate: 0,
      translated: 0,
      translationFailed: 0,
      errors: [],
      log: [],
      message: 'Starting…',
      stop: false,
    };
    this.history = h;
    this.historyJob = this._history(h)
      .catch((err) => {
        h.errors.push(err.message);
        h.state = 'error';
        h.message = err.message;
      })
      .finally(() => {
        if (h.state === 'running') h.state = h.stop ? 'stopped' : 'done';
        h.finishedAt = new Date().toISOString();
        try {
          this.store.save();
        } catch {
          /* reported on the next save */
        }
      });
    return this.historyStatus();
  }

  stopHistory() {
    if (this.history && this.history.state === 'running') {
      this.history.stop = true;
      this.history.message = 'Stopping after the current step…';
    }
    return this.historyStatus();
  }

  historyStatus() {
    const db = this.store.db;
    const queued = db.updates.filter((u) => u.source === 'weibo' && u.translation && u.translation.queued).length;
    const weibo = db.updates.filter((u) => u.source === 'weibo').length;
    const base = { cursor: db.meta.weiboHistory || null, queued, weiboPosts: weibo, translator: !!(this.translator && this.translator.configured && this.translator.configured()) };
    if (!this.history) return { state: 'idle', ...base };
    const { stop, log, ...rest } = this.history; // eslint-disable-line no-unused-vars
    return { ...rest, log: log.slice(-40), ...base };
  }

  async _history(h) {
    const log = this.log.capture ? this.log.capture(h.log, 'weibo') : this.log;
    const cfg = this.getConfig() || {};
    const db = this.store.db;
    const uid = String(cfg.uid || '').trim();
    if (!uid) throw new Error('Weibo uid is not configured (Admin → Integrations or WEIBO_UID)');

    if (!h.translateOnly) {
      log.info(`History import for uid ${uid}: up to ${h.limit} posts${h.resumeFrom ? ', continuing from the saved position' : ''}.`);
      h.message = 'Connecting to Weibo…';
      await this.warmUp(uid, log);
      const containerid = await this.getContainerId(uid, log);
      const existing = new Set(db.updates.filter((u) => u.source === 'weibo').map((u) => String(u.sourceId)));
      const deleted = new Set((db.meta.weiboDeleted || []).map(String));
      let sinceId = h.resumeFrom;
      let newest = null;
      let emptyPages = 0;
      const prev = db.meta.weiboHistory || {};
      // `limit` counts *new* posts. Posts already on the site are skipped and
      // don't count, so a page cap keeps a fully imported account from being
      // paged through forever.
      const maxPages = Math.ceil(h.limit / 5) + 50;
      while (h.added < h.limit && !h.stop) {
        if (h.pages >= maxPages) {
          log.warn(`Stopped after ${h.pages} pages; press Continue to read further back.`);
          break;
        }
        let page;
        try {
          page = await this.getPosts(uid, containerid, log, sinceId ? { since_id: sinceId } : {});
        } catch (err) {
          h.errors.push(err.message);
          log.error(`Page ${h.pages + 1} failed: ${err.message}`);
          h.message = 'Weibo stopped answering. Wait a while (or set the Weibo cookie) and press Continue.';
          break;
        }
        h.pages++;
        const posts = page.posts.filter((p) => p && p.id != null);
        if (!posts.length) {
          if (++emptyPages >= 2 || !page.sinceId) {
            log.info('Weibo returned no older posts.');
            break;
          }
        } else emptyPages = 0;
        let processedAll = true;
        for (const post of posts) {
          if (h.added >= h.limit || h.stop) {
            processedAll = false;
            break;
          }
          const pid = String(post.id);
          if (!newest || compareIds(pid, newest) > 0) newest = pid;
          h.seen++;
          if (existing.has(pid) || deleted.has(pid)) {
            h.skipped++;
            continue;
          }
          try {
            const raw = post.isLongText || String(post.text || '').includes('全文');
            const own = cleanText(await this.getFullText(post, log));
            if (raw) await this.sleep(700);
            if (post.retweeted_status && isTrivialRepost(own)) {
              h.skipped++;
              continue;
            }
            const media = extractMedia(post);
            const category = categorize(own);
            const tr = { ok: false, provider: 'none', model: null, title: CATEGORY_LABELS[category], category, translation: own, relatedProductIds: [] };
            const update = this.buildUpdate(post, own, media, tr, cfg);
            update.translation = { provider: 'none', model: null, edited: false, queued: true };
            update.status = h.publishUntranslated ? 'published' : 'pending';
            update.history = true;
            db.updates.push(update);
            existing.add(pid);
            h.added++;
          } catch (err) {
            h.errors.push(`post ${pid}: ${err.message}`);
          }
        }
        const next = page.sinceId ? String(page.sinceId) : null;
        const last = processedAll && (!next || next === sinceId);
        // Stopped halfway through a page? Then Continue re-reads this page (the
        // posts we already have are skipped) instead of jumping past the rest.
        db.meta.weiboHistory = {
          sinceId: last ? null : processedAll ? next : sinceId,
          at: new Date().toISOString(),
          imported: (Number(prev.imported) || 0) + h.added,
          pages: (Number(prev.pages) || 0) + h.pages,
          ...(last ? { complete: true } : {}),
        };
        this.store.save();
        h.message = `Page ${h.pages}: ${h.added} new post(s), ${h.skipped} skipped (already on the site or plain reposts).`;
        if (last) {
          log.info('Reached the oldest post Weibo serves.');
          break;
        }
        if (!processedAll) break;
        sinceId = next;
        if (h.added < h.limit && !h.stop) await this.sleep(2500 + Math.round(Math.random() * 1500));
      }
      // Keep the regular fetch from re-importing what we just stored.
      if (newest) {
        const priv = this.store.private;
        if (!priv.weibo.lastId || compareIds(newest, priv.weibo.lastId) > 0) {
          priv.weibo.lastId = newest;
          try {
            this.store.savePrivate();
          } catch (err) {
            h.errors.push(`could not save lastId: ${err.message}`);
          }
        }
      }
      log.info(`Fetch phase done: ${h.added} new post(s) from ${h.pages} page(s), ${h.skipped} skipped.`);
    }

    // ---- phase 2: translate the queue (newest first)
    if (h.stop) return;
    if (!h.translate) {
      h.message = `Imported ${h.added} post(s) without translation.`;
      return;
    }
    if (!this.translator || !this.translator.configured || !this.translator.configured()) {
      h.message = `Imported ${h.added} post(s). Add a translation key under Translation, then press “Translate queued posts”.`;
      log.warn('No translation provider configured — posts stay queued.');
      return;
    }
    h.phase = 'translate';
    const queue = db.updates
      .filter((u) => u.source === 'weibo' && u.translation && u.translation.queued)
      .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
    h.toTranslate = queue.length;
    const products = db.products.filter((p) => p.status !== 'archived');
    let i = 0;
    let streak = 0;
    let lastError = '';
    const worker = async () => {
      while (i < queue.length && !h.stop) {
        const u = queue[i++];
        const tr = await this.translator.translatePost(u.textOriginal || '', { products });
        if (!db.updates.includes(u)) continue; // deleted meanwhile
        if (tr.ok) {
          streak = 0;
          u.title = tr.title;
          u.category = tr.category;
          u.textEnglish = tr.translation;
          u.relatedProducts = tr.relatedProductIds || [];
          u.translation = { provider: tr.provider, model: tr.model || null, edited: false };
          if (u.status === 'pending' && cfg.autoPublish !== false) u.status = 'published';
          h.translated++;
        } else {
          h.translationFailed++;
          lastError = tr.error || 'translation failed';
          if (++streak >= 5) {
            h.stop = true;
            h.errors.push(`Translation keeps failing (${lastError}) — stopped. Check the key and press “Translate queued posts”.`);
          }
        }
        if ((h.translated + h.translationFailed) % 10 === 0) this.store.save();
        h.message = `Translating: ${h.translated} of ${h.toTranslate} done${h.translationFailed ? `, ${h.translationFailed} failed` : ''}.`;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    this.store.save();
    if (!h.stop) {
      const failed = h.translationFailed ? `, ${h.translationFailed} could not be translated` : '';
      h.message = h.translateOnly
        ? h.toTranslate
          ? `Done: ${h.translated} post(s) translated${failed}.`
          : 'No posts were waiting for translation.'
        : `Done: ${h.added} new post(s), ${h.translated} translated${failed}.`;
    }
    else if (h.errors.length) h.message = h.errors[h.errors.length - 1];
    log.info(h.message);
  }

  finish(result, { lastId, uid, error }) {
    const priv = this.store.private;
    if (lastId && priv.weibo.lastId !== lastId) {
      priv.weibo.lastId = lastId;
      try {
        this.store.savePrivate();
      } catch (err) {
        result.errors.push(`could not save lastId: ${err.message}`);
      }
    }
    this.store.db.meta.sync.weibo = {
      at: new Date().toISOString(),
      status: error ? 'error' : result.errors.length ? 'partial' : 'ok',
      message: error || (result.errors.length ? result.errors.join('; ').slice(0, 500) : `${result.added} new, ${result.fetched} fetched`),
      fetched: result.fetched,
      added: result.added,
      uid,
      lastId: lastId || null,
    };
    this.store.save();
  }

  buildUpdate(post, text, media, tr, cfg) {
    const id = String(post.id);
    const statusUrl = `https://m.weibo.cn/status/${id}`;
    const proxy = (u) => (allowedMediaUrl(u) ? MediaCache.proxyUrl(u) : null);
    const now = new Date().toISOString();
    const video = media.video && proxy(media.video.url)
      ? { url: proxy(media.video.url), poster: media.video.poster ? proxy(media.video.poster) : null, link: statusUrl }
      : null;
    return {
      id: `wb-${id}`,
      source: 'weibo',
      sourceId: id,
      url: statusUrl,
      title: tr.title,
      category: tr.category,
      textOriginal: text,
      textEnglish: tr.translation,
      media: media.images.map(proxy).filter(Boolean).map((url) => ({ type: 'image', url })),
      video,
      publishedAt: parseWeiboDate(post.created_at),
      fetchedAt: now,
      status: tr.ok && cfg.autoPublish !== false ? 'published' : 'pending',
      pinned: false,
      translation: { provider: tr.provider, model: tr.model || null, edited: false, ...(tr.error ? { error: tr.error } : {}) },
      relatedProducts: tr.relatedProductIds || [],
      retweeted: !!post.retweeted_status,
    };
  }

  /** Re-run translation for one stored update. → updated item */
  async retranslate(id) {
    const db = this.store.db;
    const update = db.updates.find((u) => u.id === id);
    if (!update) return null;
    const cfg = this.getConfig() || {};
    const products = db.products.filter((p) => p.status !== 'archived');
    const tr = await this.translator.translatePost(update.textOriginal || '', { products });
    const wasFailed = !!update.translation?.error;
    update.title = tr.title;
    update.category = tr.category;
    update.textEnglish = tr.translation;
    update.relatedProducts = tr.relatedProductIds || [];
    update.translation = { provider: tr.provider, model: tr.model || null, edited: false, ...(tr.error ? { error: tr.error } : {}) };
    if (tr.ok && wasFailed && update.status === 'pending' && cfg.autoPublish !== false) update.status = 'published';
    update.updatedAt = new Date().toISOString();
    this.store.save();
    return update;
  }
}

module.exports = {
  WeiboService,
  CookieJar,
  cleanText,
  extractMedia,
  pickPosts,
  parseWeiboDate,
  WEIBO_HEADERS,
};
