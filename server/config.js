'use strict';
/**
 * Runtime configuration, derived from environment variables.
 *
 * Integration settings (Weibo, translation, Weidian) primarily live in
 * data/private.json and are editable from the admin panel. Environment
 * variables listed in ENV_OVERRIDES win over the file — handy for secrets
 * managed by the host (Docker secrets, Railway variables, systemd units).
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function bool(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function int(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Private-config paths that can be overridden by env vars.
 * [section, key, ENV_NAME, type]
 */
const ENV_OVERRIDES = [
  ['weibo', 'enabled', 'WEIBO_ENABLED', 'bool'],
  ['weibo', 'uid', 'WEIBO_UID', 'string'],
  ['weibo', 'cookie', 'WEIBO_COOKIE', 'string'],
  ['weibo', 'intervalMinutes', 'WEIBO_INTERVAL_MINUTES', 'number'],
  ['weibo', 'autoPublish', 'WEIBO_AUTO_PUBLISH', 'bool'],
  ['weibo', 'backfill', 'WEIBO_BACKFILL', 'number'],
  ['translation', 'provider', 'TRANSLATION_PROVIDER', 'string'],
  ['translation', 'anthropicKey', 'ANTHROPIC_API_KEY', 'string'],
  ['translation', 'model', 'ANTHROPIC_MODEL', 'string'],
  ['translation', 'deeplKey', 'DEEPL_API_KEY', 'string'],
  ['translation', 'googleKey', 'GOOGLE_TRANSLATE_API_KEY', 'string'],
  ['translation', 'libreUrl', 'LIBRETRANSLATE_URL', 'string'],
  ['translation', 'libreKey', 'LIBRETRANSLATE_API_KEY', 'string'],
  ['weidian', 'enabled', 'WEIDIAN_ENABLED', 'bool'],
  ['weidian', 'provider', 'WEIDIAN_PROVIDER', 'string'],
  ['weidian', 'intervalMinutes', 'WEIDIAN_INTERVAL_MINUTES', 'number'],
  ['weidian', 'appKey', 'WEIDIAN_APP_KEY', 'string'],
  ['weidian', 'appSecret', 'WEIDIAN_APP_SECRET', 'string'],
  ['weidian', 'accessToken', 'WEIDIAN_ACCESS_TOKEN', 'string'],
  ['weidian', 'feedUrl', 'WEIDIAN_FEED_URL', 'string'],
  ['weidian', 'fetchVia', 'WEIDIAN_FETCH_VIA', 'string'],
];

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  // Railway: a volume mounted on the service becomes the data directory automatically.
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH || '';
  const onRailway = !!(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_ENVIRONMENT_NAME);
  // Render sets RENDER=true and RENDER_EXTERNAL_URL; its persistent disk is pointed to with DATA_DIR.
  const onRender = env.RENDER === 'true' || !!env.RENDER_SERVICE_ID;
  const dataDir = path.resolve(ROOT, env.DATA_DIR || volume || 'data');
  const publicDir = path.resolve(ROOT, env.PUBLIC_DIR || 'public');

  const overrides = {};
  for (const [section, key, name, type] of ENV_OVERRIDES) {
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    let value = raw;
    if (type === 'bool') value = bool(raw, false);
    else if (type === 'number') {
      value = Number(raw);
      if (!Number.isFinite(value)) continue;
    }
    (overrides[section] ||= {})[key] = value;
  }

  return {
    root: ROOT,
    production,
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    siteUrl: String(env.SITE_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '') || (onRender && env.RENDER_EXTERNAL_URL) || 'https://colastudio.com').replace(/\/+$/, ''),
    dataDir,
    publicDir,
    /** Admin uploads, served at /uploads/*. Override for PaaS hosts with one persistent disk. */
    uploadsDir: env.UPLOADS_DIR ? path.resolve(ROOT, env.UPLOADS_DIR) : volume || (onRender && env.DATA_DIR) ? path.join(dataDir, 'uploads') : path.join(publicDir, 'uploads'),
    adminPassword: env.ADMIN_PASSWORD || '',
    sessionSecret: env.SESSION_SECRET || '',
    tokenTtlMs: int(env.SESSION_TTL_DAYS, 7) * 24 * 3600 * 1000,
    /** "auto" trusts X-Forwarded-For only from loopback/private peers (typical nginx setup). */
    trustProxy: (env.TRUST_PROXY || (onRailway || onRender ? 'true' : 'auto')).toLowerCase(),
    allowedOrigins: String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    schedulers: !bool(env.DISABLE_SCHEDULERS, false),
    assetMaxAge: int(env.ASSET_MAX_AGE, 7 * 24 * 3600),
    /** Content-Security-Policy for HTML pages: unset = built-in policy, "off" = none, anything else = used verbatim. */
    csp: env.CSP === undefined || env.CSP === '' ? null : env.CSP === 'off' ? '' : env.CSP,
    logRequests: bool(env.LOG_REQUESTS, false),
    logSilent: bool(env.LOG_SILENT, false),
    uploadMaxBytes: 8 * 1024 * 1024,
    videoMaxBytes: int(env.WEIBO_VIDEO_MAX_MB, 60) * 1024 * 1024,
    prefetchMedia: !bool(env.DISABLE_MEDIA_PREFETCH, false),
    weidianUserAgent: env.WEIDIAN_USER_AGENT || '',
    envOverrides: overrides,
  };
}

module.exports = { loadConfig, ENV_OVERRIDES, ROOT, bool, int };
