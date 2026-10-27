#!/usr/bin/env node
'use strict';
/**
 * Assembles public/*.html from tools/pages/<name>.html (the <main> markup) and
 * the shared <head>. Run after editing a fragment:  npm run build:pages
 *
 * Titles and descriptions come from server/lib/seo.js (PAGES), the same copy
 * the server uses — the server additionally rewrites the head per request
 * (canonical from SITE_URL, admin overrides, product/post data, JSON-LD) and
 * fills the <!--ssr:…--> slots with real content.
 */
const fs = require('node:fs');
const path = require('node:path');
const { PAGES } = require('../server/lib/seo');

const SRC = path.join(__dirname, 'pages');
const OUT = path.join(__dirname, '..', 'public');
const V = require('../package.json').version;
const SITE = 'https://colastudio.com';
const BRAND = 'Cola Studio';

const FILES = {
  index: { page: 'home', route: '/', js: 'home' },
  products: { page: 'products', route: '/products', js: 'products' },
  product: { page: 'product', route: '/products', js: 'product', title: 'Product — {brand}', desc: 'Designed and produced by {brand}.' },
  'live-stock': { page: 'live-stock', route: '/live-stock', js: 'live-stock' },
  updates: { page: 'updates', route: '/updates', js: 'updates' },
  'how-to-order': { page: 'how-to-order', route: '/how-to-order', js: 'how-to-order' },
  order: { page: 'order', route: '/order', js: 'order' },
  about: { page: 'about', route: '/about', js: 'about' },
  contact: { page: 'contact', route: '/contact', js: 'contact' },
  faq: { page: 'faq', route: '/faq', js: 'faq' },
  'size-guide': { page: 'size-guide', route: '/size-guide', js: 'size-guide' },
  lookbook: { page: 'lookbook', route: '/lookbook', js: 'lookbook' },
  brand: { page: 'brand', route: '/brand', js: 'brand' },
  '404': { page: 'notfound', route: '/404', js: 'notfound', title: 'Page not found — {brand}', desc: 'This page does not exist.', noindex: true },
};
const CORE = ['util', 'data', 'brand', 'media', 'cart', 'ui', 'components', 'layout'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fill = (s) => String(s || '').replace(/\{brand\}/g, BRAND);

function jsonLd(route, title, desc, noindex) {
  if (noindex) return '';
  const url = SITE + route;
  const def = PAGES[route] || {};
  const graph = [
    { '@type': 'Organization', '@id': `${SITE}/#organization`, name: BRAND, url: `${SITE}/`, logo: `${SITE}/assets/brand/icon-512.png` },
    { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: BRAND, inLanguage: 'en', publisher: { '@id': `${SITE}/#organization` } },
    { '@type': def.type || 'WebPage', '@id': `${url}#webpage`, url, name: title, description: desc, inLanguage: 'en', isPartOf: { '@id': `${SITE}/#website` } },
  ];
  if (route !== '/') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: def.label || title, item: url },
      ],
    });
  }
  return `  <script type="application/ld+json" id="cola-jsonld">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>\n`;
}

let n = 0;
for (const [name, m] of Object.entries(FILES)) {
  const file = path.join(SRC, name + '.html');
  if (!fs.existsSync(file)) {
    console.log('skip (no fragment):', name);
    continue;
  }
  const def = PAGES[m.route] || {};
  const title = fill(m.title || def.title);
  const desc = fill(m.desc || def.description);
  const noindex = !!(m.noindex || def.noindex);
  const url = SITE + m.route;
  const main = fs.readFileSync(file, 'utf8').trim();
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}">
${noindex ? '' : `  <link rel="canonical" href="${url}">\n`}  <meta name="theme-color" content="#130D0A">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${BRAND}">
  <meta property="og:locale" content="en_GB">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/assets/brand/og-image.png">
  <meta property="og:image:alt" content="${BRAND} — International Fashion Studio">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${SITE}/assets/brand/og-image.png">
  <link rel="icon" href="assets/brand/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="assets/brand/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="assets/brand/apple-touch-icon.png">
  <link rel="manifest" href="site.webmanifest">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,200;1,300;1,400&display=swap">
  <link rel="stylesheet" href="assets/css/tokens.css?v=${V}">
  <link rel="stylesheet" href="assets/css/base.css?v=${V}">
  <link rel="stylesheet" href="assets/css/components.css?v=${V}">
  <link rel="stylesheet" href="assets/css/pages.css?v=${V}">
${jsonLd(m.route, title, desc, noindex)}</head>
<body data-page="${m.page}" class="page-${m.page}">
  <a class="skip-link" href="#main">Skip to content</a>
${main}
  <div data-footer></div>
  <noscript><p class="container" style="padding:2rem 0">This site works best with JavaScript enabled. You can still reach us on WhatsApp or by email.</p></noscript>
  <script src="assets/js/garments.js?v=${V}"></script>
${CORE.map((c) => `  <script src="assets/js/core/${c}.js?v=${V}"></script>`).join('\n')}
  <script src="assets/js/pages/${m.js}.js?v=${V}"></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, name + '.html'), html);
  n++;
}
console.log(`wrote ${n} pages to public/ (v${V})`);
