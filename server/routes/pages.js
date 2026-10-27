'use strict';
/**
 * Page routes + static files (see docs/API.md → "Page routes").
 * Every HTML document gets the runtime marker and <base href="/">, and every
 * public page its search-engine layer from lib/seo.js (title, description,
 * canonical, Open Graph, JSON-LD, server-rendered content, pretty links).
 */
const fs = require('node:fs');
const path = require('node:path');
const { respond, serveFile, safeJoin, statFile, redirect, HTML_CSP } = require('../lib/http');
const { injectRuntime } = require('../lib/html');
const seo = require('../lib/seo');
const { publishedProducts } = require('./public');

const PAGE_ROUTES = {
  '/': 'index.html',
  '/products': 'products.html',
  '/live-stock': 'live-stock.html',
  '/updates': 'updates.html',
  '/how-to-order': 'how-to-order.html',
  '/order': 'order.html',
  '/about': 'about.html',
  '/contact': 'contact.html',
  '/faq': 'faq.html',
  '/size-guide': 'size-guide.html',
  '/lookbook': 'lookbook.html',
  '/brand': 'brand.html',
  '/admin': 'admin/index.html',
};

// Static-mode file names → pretty URLs (301), so every page has exactly one address.
const HTML_ALIASES = Object.fromEntries(Object.entries(PAGE_ROUTES).filter(([p]) => p !== '/admin').map(([p, f]) => ['/' + f, p]));

const FALLBACK_404 =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found — Cola Studio</title></head><body style="font-family:system-ui,sans-serif;padding:4rem 1.5rem;text-align:center;background:#F3EEE6;color:#130D0A"><h1 style="font-weight:300">Page not found</h1><p><a href="/" style="color:inherit">Back to Cola Studio</a></p></body></html>';

function createPages(app) {
  const { config, store } = app;
  const publicDir = config.publicDir;
  const cache = new Map(); // file → { mtimeMs, size, html }

  function readHtml(file) {
    const st = statFile(file);
    if (!st) return null;
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.html;
    try {
      const html = fs.readFileSync(file, 'utf8');
      cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, html });
      return html;
    } catch {
      return null;
    }
  }

  const csp = config.csp === null || config.csp === undefined ? HTML_CSP : config.csp;

  function sendHtml(ctx, html, status = 200) {
    respond(ctx.req, ctx.res, {
      status,
      body: html,
      type: 'text/html; charset=utf-8',
      etag: status === 200,
      cacheControl: status === 200 && config.pageCacheControl ? config.pageCacheControl : 'no-cache',
      headers: csp ? { 'Content-Security-Policy': csp } : {},
    });
    return true;
  }

  let faqCache = null;
  function faqData() {
    const file = path.join(publicDir, 'data', 'faq.json');
    const st = statFile(file);
    if (!st) return null;
    if (faqCache && faqCache.mtimeMs === st.mtimeMs) return faqCache.data;
    try {
      faqCache = { mtimeMs: st.mtimeMs, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      faqCache = { mtimeMs: st.mtimeMs, data: null };
    }
    return faqCache.data;
  }

  /** SEO layer for a public route ('/', '/products', '/products/:slug', '/updates/:id', …). */
  function seoTransform(ctx, route, extra = {}) {
    return (html) => {
      try {
        const page = seo.buildPage({ route, db: store.db, siteUrl: config.siteUrl, query: ctx.query || {}, faq: route === '/faq' ? faqData() : null, ...extra });
        return seo.applyPage(html, page, store.db.settings);
      } catch (err) {
        (app.log || console).error(`SEO for ${ctx.path} failed: ${err.message}`);
        return seo.prettyLinks(html);
      }
    };
  }

  function sendPage(ctx, file, { status = 200, transform, route } = {}) {
    const html = readHtml(file);
    if (html == null) return false;
    let out = injectRuntime(html);
    if (route) out = seoTransform(ctx, route)(out);
    if (transform) out = transform(out);
    if (typeof config.htmlTransform === 'function') out = config.htmlTransform(out);
    return sendHtml(ctx, out, status);
  }

  const noindex = (html) => seo.prettyLinks(html.replace(/<meta\s+name="robots"[^>]*>\s*/gi, '').replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '').replace(/<\/head>/i, '<meta name="robots" content="noindex, nofollow">\n</head>'));

  function notFound(ctx) {
    if (!sendPage(ctx, path.join(publicDir, '404.html'), { status: 404, transform: noindex })) sendHtml(ctx, injectRuntime(FALLBACK_404), 404);
  }

  function cacheControlFor(urlPath, query) {
    if (urlPath.startsWith('/assets/fonts/')) return 'public, max-age=31536000, immutable';
    if (urlPath.startsWith('/assets/')) return query && query.v ? 'public, max-age=31536000, immutable' : `public, max-age=${config.assetMaxAge}`;
    if (/\.(json|webmanifest|xml|txt)$/i.test(urlPath)) return 'no-cache';
    return 'public, max-age=3600';
  }

  function productPage(ctx, slug) {
    const d = store.db;
    const list = publishedProducts(d);
    const product = list.find((p) => p.slug === slug) || list.find((p) => p.id === slug);
    if (!product) return notFound(ctx);
    if (product.slug !== slug) return redirect(ctx.res, `/products/${encodeURIComponent(product.slug)}` + (ctx.url.search || ''), 301);
    const ok = sendPage(ctx, path.join(publicDir, 'product.html'), { transform: seoTransform(ctx, '/products/:slug', { product }) });
    if (!ok) notFound(ctx);
  }

  /** One studio update on its own URL (/updates/:id) — rendered from updates.html. */
  function updatePage(ctx, id) {
    const update = store.db.updates.find((u) => u.id === id && u.status === 'published');
    if (!update) return notFound(ctx);
    const ok = sendPage(ctx, path.join(publicDir, 'updates.html'), { transform: seoTransform(ctx, '/updates/:id', { update }) });
    if (!ok) notFound(ctx);
  }

  function xml(ctx, body, type = 'application/xml; charset=utf-8') {
    respond(ctx.req, ctx.res, { body, type, cacheControl: 'public, max-age=900', etag: true });
    return true;
  }

  function sitemap(ctx) {
    const pages = Object.entries(PAGE_ROUTES)
      .filter(([p, file]) => p !== '/admin' && statFile(path.join(publicDir, file)))
      .map(([p]) => p);
    return xml(ctx, seo.sitemapXml({ db: store.db, siteUrl: config.siteUrl, pages }));
  }

  async function handle(ctx) {
    const { req, res } = ctx;
    const p = ctx.path;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Method not allowed');
    }

    if (p === '/robots.txt') {
      return respond(req, res, { body: seo.robotsTxt({ siteUrl: config.siteUrl }), type: 'text/plain; charset=utf-8', cacheControl: 'public, max-age=3600' });
    }
    if (p === '/sitemap.xml') return sitemap(ctx);
    if (p === '/updates/feed.xml') return xml(ctx, seo.rssXml({ db: store.db, siteUrl: config.siteUrl }), 'application/rss+xml; charset=utf-8');

    // products.html, about.html … (static-mode addresses) → one canonical pretty URL
    if (HTML_ALIASES[p] || p === '/index.html' || p === '/product.html') {
      const q = new URLSearchParams(ctx.url.search || '');
      if (p === '/product.html' && q.get('slug')) {
        const slug = q.get('slug');
        q.delete('slug');
        const rest = q.toString();
        return redirect(res, `/products/${encodeURIComponent(slug)}${rest ? '?' + rest : ''}`, 301);
      }
      if (p === '/updates.html' && q.get('post')) return redirect(res, `/updates/${encodeURIComponent(q.get('post'))}`, 301);
      if (p === '/product.html') return redirect(res, '/products', 301);
      return redirect(res, (p === '/index.html' ? '/' : HTML_ALIASES[p]) + (ctx.url.search || ''), 301);
    }

    // Pretty URLs without trailing slash (except "/" and "/admin/").
    if (p.length > 1 && p.endsWith('/') && p !== '/admin/') {
      const trimmed = p.replace(/\/+$/, '');
      if (PAGE_ROUTES[trimmed] || /^\/(products|updates)\/[^/]+$/.test(trimmed)) return redirect(res, trimmed + (ctx.url.search || ''), 301);
    }
    if (p === '/admin/' || p === '/admin') return sendPage(ctx, path.join(publicDir, 'admin/index.html'), { transform: noindex }) || notFound(ctx);
    if (PAGE_ROUTES[p]) return sendPage(ctx, path.join(publicDir, PAGE_ROUTES[p]), { route: p }) || notFound(ctx);

    const um = /^\/updates\/([^/]+)$/.exec(p);
    if (um) {
      let id;
      try {
        id = decodeURIComponent(um[1]);
      } catch {
        return notFound(ctx);
      }
      return updatePage(ctx, id);
    }

    const m = /^\/products\/([^/]+)$/.exec(p);
    if (m) {
      let slug;
      try {
        slug = decodeURIComponent(m[1]);
      } catch {
        return notFound(ctx);
      }
      return productPage(ctx, slug);
    }

    // Admin uploads (may live outside public/ when UPLOADS_DIR is set)
    if (p.startsWith('/uploads/')) {
      const upload = safeJoin(config.uploadsDir, p.slice('/uploads'.length));
      const ust = upload && statFile(upload);
      if (!ust) return notFound(ctx);
      const headers = /\.svg$/i.test(p)
        ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" } // defence in depth
        : {};
      return serveFile(req, res, upload, { cacheControl: 'public, max-age=31536000, immutable', stat: ust, headers });
    }

    // Static files
    const file = safeJoin(publicDir, p);
    if (!file) return notFound(ctx);
    const st = statFile(file);
    if (!st) {
      try {
        if (fs.statSync(file).isDirectory()) {
          const index = path.join(file, 'index.html');
          if (statFile(index)) {
            if (!p.endsWith('/')) return redirect(res, p + '/' + (ctx.url.search || ''), 301);
            return sendPage(ctx, index);
          }
        }
      } catch {
        /* not found */
      }
      return notFound(ctx);
    }
    if (/\.html?$/i.test(file)) return sendPage(ctx, file, { transform: noindex }) || notFound(ctx);

    serveFile(req, res, file, { cacheControl: cacheControlFor(p, ctx.query), stat: st });
  }

  return { handle, notFound, PAGE_ROUTES };
}

module.exports = { createPages, PAGE_ROUTES };
