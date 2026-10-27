'use strict';
/**
 * JSON document store.
 *
 *   data/db.json        { settings, categories, products, updates, inventoryEvents,
 *                         messages, orders, notify, meta }
 *   data/private.json   secrets + integration config (never sent to browsers)
 *   data/backups/       daily snapshots (+ pre-import snapshots), newest 10 kept
 *
 * Writes are debounced and atomic (tmp file + fsync + rename). On first boot
 * the db is seeded from public/data/*.json; missing/broken seed files are
 * tolerated and replaced by sensible defaults.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isObj, withDefaults, clone, readJsonFile, writeFileAtomic, compareIds } = require('./util');
const { ensureProductShape } = require('./products');
const { stockStatus, productAvailability, totalStock } = require('./stock');

const LIMITS = { inventoryEvents: 2000, messages: 5000, orders: 5000, notify: 5000, updates: 3000 };

const DEMO_WHATSAPP = '31600000000'; // placeholder number of the first demo seed
const DEFAULT_SETTINGS = {
  demo: false,
  brand: {
    name: 'Cola Studio',
    tagline: 'International Fashion Studio',
    domain: 'colastudio.com',
    email: 'studio@colastudio.com',
    established: '',
  },
  announcement: { enabled: false, text: '', link: '' },
  currency: {
    base: 'CNY',
    default: 'EUR',
    available: ['CNY', 'EUR', 'USD', 'GBP'],
    rates: { CNY: 1, EUR: 0.128, USD: 0.139, GBP: 0.107 },
    autoUpdate: true,
    updatedAt: null,
  },
  inventory: { lowStockThreshold: 5, refreshSeconds: 30 },
  whatsapp: { number: '', enabled: true, greeting: 'Hello Cola Studio', orderPrefix: 'CS' },
  agents: [],
  weidian: { shopUrl: '', itemUrlTemplate: 'https://weidian.com/item.html?itemID={itemId}' },
  social: { instagram: '', weibo: '', tiktok: '', whatsappChannel: '', discord: '', xiaohongshu: '', yupoo: '' },
  socialIcons: {}, // optional uploaded logos per social channel (contact page)
  nextDrop: { enabled: false, title: '', subtitle: '', date: null },
  shipping: { regions: [], note: '' },
  // Empty = the built-in copy in server/lib/seo.js. pages: { '/products': { title, description }, … }
  seo: { title: '', description: '', image: '', googleVerification: '', bingVerification: '', pages: {} },
};

const DEFAULT_PUBLIC_ITEM_URL = 'https://thor.weidian.com/detail/getItemSkuInfo/1.0?param={param}';
const DEFAULT_TOKEN_URL =
  'https://oauth.open.weidian.com/token?grant_type=client_credential&appkey={appKey}&secret={appSecret}';

const DEFAULT_PRIVATE = {
  // Cola Studio's Weibo account (https://weibo.com/u/7354109778) — change in the admin or with WEIBO_UID.
  weibo: { enabled: true, uid: '7354109778', cookie: '', intervalMinutes: 15, autoPublish: true, backfill: 6, lastId: null },
  translation: {
    provider: 'anthropic',
    anthropicKey: '',
    model: 'claude-sonnet-5-5',
    deeplKey: '',
    googleKey: '',
    libreUrl: '',
    libreKey: '',
    glossary: '',
  },
  weidian: {
    enabled: false,
    provider: 'public-item',
    intervalMinutes: 10,
    appKey: '',
    appSecret: '',
    accessToken: '',
    feedUrl: '',
    sizeAliases: {},
    colorAliases: {},
    itemUrlTemplate: DEFAULT_PUBLIC_ITEM_URL,
    tokenUrl: DEFAULT_TOKEN_URL,
    apiUrl: 'https://api.vdian.com/api',
    apiMethod: 'vdian.item.get',
    apiVersion: '1.0',
    delayMs: 1500,
    priceUnit: 'auto',
    fetchVia: '', // optional scraping-service URL (with API key) for the public-item provider
    claudeFetch: true, // imports: when Weidian blocks the server, fetch through Claude (needs the Anthropic key)
  },
};

const SEED_FILES = {
  settings: 'settings.json',
  categories: 'categories.json',
  products: 'products.json',
  updates: 'updates.json',
  inventoryEvents: 'inventory-events.json',
};

/** Accept either a bare array or { key: [...] } / { items: [...] } wrappers. */
function asArray(v, key) {
  if (Array.isArray(v)) return v;
  if (isObj(v)) {
    for (const k of [key, 'items', 'data', 'events']) if (Array.isArray(v[k])) return v[k];
  }
  return [];
}

const byAt = (a, b) => String(a.at || '').localeCompare(String(b.at || ''));

/** Repair any db-shaped object so the rest of the app can rely on types. */
function normalizeDb(raw) {
  const db = isObj(raw) ? raw : {};
  const out = {
    settings: withDefaults(isObj(db.settings) ? db.settings : {}, DEFAULT_SETTINGS),
    categories: asArray(db.categories, 'categories').filter(isObj),
    products: asArray(db.products, 'products')
      .map((p, i) => ensureProductShape(p, i))
      .filter(Boolean),
    updates: asArray(db.updates, 'updates').filter((u) => isObj(u) && u.id),
    inventoryEvents: asArray(db.inventoryEvents, 'inventoryEvents').filter(isObj).sort(byAt),
    messages: asArray(db.messages, 'messages').filter(isObj),
    orders: asArray(db.orders, 'orders').filter(isObj),
    notify: asArray(db.notify, 'notify').filter(isObj),
    meta: isObj(db.meta) ? db.meta : {},
  };
  out.meta = {
    version: 1,
    createdAt: new Date().toISOString(),
    productSeq: 0,
    weiboDeleted: [],
    ...out.meta,
    sync: { weidian: null, weibo: null, currency: null, ...(isObj(out.meta.sync) ? out.meta.sync : {}) },
  };
  // Dedupe product ids / slugs defensively (bad imports).
  const ids = new Set();
  out.products = out.products.filter((p) => (ids.has(p.id) ? false : ids.add(p.id)));
  if (out.inventoryEvents.length > LIMITS.inventoryEvents) {
    out.inventoryEvents = out.inventoryEvents.slice(-LIMITS.inventoryEvents);
  }
  return out;
}

class Store {
  constructor({ dataDir, publicDir, log, saveDelayMs = 250, keepBackups = 10 }) {
    this.dataDir = dataDir;
    this.publicDir = publicDir;
    this.log = log || { info() {}, warn() {}, error() {} };
    this.saveDelayMs = saveDelayMs;
    this.keepBackups = keepBackups;
    this.dbFile = path.join(dataDir, 'db.json');
    this.privateFile = path.join(dataDir, 'private.json');
    this.backupDir = path.join(dataDir, 'backups');
    this.timer = null;
    this.dirty = false;
    this.lastBackupDay = null;
    this.data = null;
    this.private = null;
  }

  /* ---------------------------------------------------------------- init */

  init() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });

    if (fs.existsSync(this.dbFile)) {
      const raw = readJsonFile(this.dbFile, undefined);
      if (raw === undefined) {
        // Corrupt db.json: keep it aside and recover from the newest backup.
        const aside = `${this.dbFile}.corrupt-${Date.now()}`;
        fs.renameSync(this.dbFile, aside);
        this.log.error(`db.json was unreadable — moved to ${path.basename(aside)}`);
        const backup = this.latestBackup();
        if (backup) {
          this.data = normalizeDb(readJsonFile(backup, {}));
          this.log.warn(`Restored database from backup ${path.basename(backup)}`);
        } else {
          this.data = this.seed();
        }
        this.writeNow();
      } else {
        this.data = normalizeDb(raw);
        this.applySeedFixes();
      }
    } else {
      this.data = this.seed();
      this.writeNow();
    }

    const priv = readJsonFile(this.privateFile, null);
    this.private = this.normalizePrivate(priv);
    if (!priv) this.savePrivate();

    this.dailyBackup();
    return this;
  }

  /**
   * Older seeds shipped a placeholder WhatsApp number. When the live db still
   * has that placeholder (or nothing) and public/data/settings.json now has the
   * studio's real number, take it over once.
   */
  applySeedFixes() {
    const wa = this.data && this.data.settings && this.data.settings.whatsapp;
    if (!wa || (wa.number && String(wa.number) !== DEMO_WHATSAPP)) return;
    const seed = readJsonFile(path.join(this.publicDir, 'data', 'settings.json'), null);
    const n = seed && seed.whatsapp ? String(seed.whatsapp.number || '') : '';
    if (!/^\d{7,15}$/.test(n) || n === DEMO_WHATSAPP) return;
    wa.number = n;
    this.log.info(`WhatsApp number taken over from public/data/settings.json (+${n})`);
    this.writeNow();
  }

  /** Build a fresh db from public/data/*.json (tolerant of missing files). */
  seed() {
    const dir = path.join(this.publicDir, 'data');
    const seed = {};
    const found = [];
    for (const [key, file] of Object.entries(SEED_FILES)) {
      const v = readJsonFile(path.join(dir, file), undefined);
      if (v === undefined) continue;
      found.push(file);
      seed[key] = key === 'settings' ? v : asArray(v, key === 'inventoryEvents' ? 'events' : key);
    }
    const db = normalizeDb(seed);
    db.meta.seededFrom = found;
    db.meta.seededAt = new Date().toISOString();
    if (found.length) this.log.info(`Seeded database from public/data (${found.join(', ')})`);
    else this.log.warn('No seed files found in public/data — starting with an empty catalogue');
    return db;
  }

  normalizePrivate(priv) {
    const p = isObj(priv) ? priv : {};
    const out = {};
    for (const [section, defaults] of Object.entries(DEFAULT_PRIVATE)) {
      out[section] = withDefaults(isObj(p[section]) ? p[section] : {}, defaults);
    }
    return out;
  }

  /* --------------------------------------------------------------- access */

  get db() {
    return this.data;
  }

  /** Effective private config = private.json overlaid with env overrides (env wins). */
  effectivePrivate(envOverrides = {}) {
    const out = clone(this.private);
    for (const [section, values] of Object.entries(envOverrides || {})) {
      out[section] = { ...(out[section] || {}), ...values };
    }
    return out;
  }

  /* --------------------------------------------------------------- writes */

  /** Schedule a debounced write. */
  save() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.saveDelayMs);
    if (this.timer.unref) this.timer.unref();
  }

  /** Write immediately if there are pending changes. */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.writeNow();
  }

  writeNow() {
    try {
      this.data.meta.savedAt = new Date().toISOString();
      writeFileAtomic(this.dbFile, JSON.stringify(this.data, null, 1));
      this.dirty = false;
      this.dailyBackup();
    } catch (err) {
      this.log.error(`Failed to write db.json: ${err.message}`);
    }
  }

  savePrivate() {
    writeFileAtomic(this.privateFile, JSON.stringify(this.private, null, 2), { mode: 0o600 });
  }

  /* -------------------------------------------------------------- backups */

  listBackups() {
    try {
      return fs
        .readdirSync(this.backupDir)
        .filter((f) => /^db-.*\.json$/.test(f))
        .sort();
    } catch {
      return [];
    }
  }

  latestBackup() {
    const list = this.listBackups();
    return list.length ? path.join(this.backupDir, list[list.length - 1]) : null;
  }

  /** One snapshot per calendar day (UTC), written on the first save of the day. */
  dailyBackup() {
    const day = new Date().toISOString().slice(0, 10);
    if (this.lastBackupDay === day) return;
    const file = path.join(this.backupDir, `db-${day}.json`);
    if (!fs.existsSync(file)) this.snapshot(null, file);
    this.lastBackupDay = day;
  }

  /** Write a snapshot now (e.g. before an import). Returns the file name. */
  snapshot(reason, file) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = file || path.join(this.backupDir, `db-${stamp}${reason ? '-' + reason.replace(/[^a-z0-9-]/gi, '') : ''}.json`);
      writeFileAtomic(target, JSON.stringify(this.data));
      this.pruneBackups();
      return path.basename(target);
    } catch (err) {
      this.log.warn(`Backup failed: ${err.message}`);
      return null;
    }
  }

  pruneBackups() {
    const list = this.listBackups();
    // Sort by mtime so dated and timestamped names interleave correctly.
    const withTime = list
      .map((f) => {
        try {
          return { f, t: fs.statSync(path.join(this.backupDir, f)).mtimeMs };
        } catch {
          return { f, t: 0 };
        }
      })
      .sort((a, b) => a.t - b.t || a.f.localeCompare(b.f));
    for (const { f } of withTime.slice(0, Math.max(0, withTime.length - this.keepBackups))) {
      try {
        fs.unlinkSync(path.join(this.backupDir, f));
      } catch {
        /* ignore */
      }
    }
  }

  /* -------------------------------------------------------------- helpers */

  findProduct(idOrSlug) {
    return this.data.products.find((p) => p.id === idOrSlug) || this.data.products.find((p) => p.slug === idOrSlug) || null;
  }

  /** Append inventory events (oldest → newest) and cap the log. */
  addInventoryEvents(events) {
    if (!events.length) return;
    this.data.inventoryEvents.push(...events);
    const over = this.data.inventoryEvents.length - LIMITS.inventoryEvents;
    if (over > 0) this.data.inventoryEvents.splice(0, over);
  }

  /** Push to a capped collection (messages/orders/notify). */
  pushCapped(collection, item) {
    const list = this.data[collection];
    list.push(item);
    const max = LIMITS[collection] || 5000;
    if (list.length > max) list.splice(0, list.length - max);
  }

  /** Sorted copy of updates: pinned first, newest first. */
  sortedUpdates(list = this.data.updates) {
    const ts = (v) => {
      const t = Date.parse(v || '');
      return Number.isFinite(t) ? t : 0;
    };
    return [...list].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      const t = ts(b.publishedAt) - ts(a.publishedAt);
      if (t) return t;
      return compareIds(b.sourceId || 0, a.sourceId || 0);
    });
  }

  close() {
    this.flush();
  }
}

/** Generate (once) and persist a session secret in data/ when SESSION_SECRET is not set. */
function loadOrCreateSecret(dataDir) {
  const file = path.join(dataDir, 'session-secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch {
    /* create below */
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  writeFileAtomic(file, secret + '\n', { mode: 0o600 });
  return secret;
}

module.exports = {
  Store,
  normalizeDb,
  loadOrCreateSecret,
  DEFAULT_SETTINGS,
  DEFAULT_PRIVATE,
  LIMITS,
  stockStatus,
  productAvailability,
  totalStock,
};
