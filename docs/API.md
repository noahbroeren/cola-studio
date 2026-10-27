# Cola Studio — HTTP API

Base: same origin as the site. All responses are JSON unless noted. Errors: `{ "error": "message" }` with a 4xx/5xx status.

## Runtime detection

The server injects `<meta name="cola-runtime" content="server">` and `<base href="/">` into every HTML page it serves. The frontend uses that meta tag to decide between server mode (this API) and static mode (`public/data/*.json`).

## Page routes (server mode)

| Path | File |
|---|---|
| `/` | `public/index.html` |
| `/products` | `public/products.html` (`?category=` supported) |
| `/products/:slug` | `public/product.html` |
| `/updates/:id` | `public/updates.html` rendered for one published update (404 otherwise) |
| `/live-stock` | `public/live-stock.html` |
| `/updates` | `public/updates.html` |
| `/how-to-order` | `public/how-to-order.html` |
| `/order` | `public/order.html` |
| `/about`, `/contact`, `/faq`, `/size-guide`, `/lookbook`, `/brand` | matching `.html` |
| `/admin` | `public/admin/index.html` |
| `/index.html`, `/products.html`, `/about.html` … | 301 → pretty URL (`/product.html?slug=x` → `/products/x`, `/updates.html?post=id` → `/updates/id`) |
| other `*.html` | served with `noindex` |
| unknown | `public/404.html` with status 404 (`noindex`) |
| `/sitemap.xml`, `/robots.txt`, `/updates/feed.xml` | generated (sitemap incl. categories, product photos and updates; RSS of the last 30 updates) |

Every public page goes through `server/lib/seo.js`: title, description, robots, canonical (from `SITE_URL`), Open Graph/Twitter, one JSON-LD `@graph`, server-rendered content in the `<!--ssr:name-->` slots and pretty internal links. Admin overrides: `settings.seo.pages[route] = { title, description }`, `settings.seo.{title,description,image,googleVerification,bingVerification}`, product `seoTitle` / `seoDescription`.

## Media proxy

`GET /media/weibo?u=…` and `GET /media/img?u=…` — cached proxy for Weibo media (`*.sinaimg.cn`, `*.weibocdn.com`) and Weidian product photos (`*.geilicdn.com`). Files are kept in `data/cache/`.

## Public endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ ok, version, demo, time }` |
| GET | `/api/site` | `{ settings, categories }` (public settings only) |
| GET | `/api/products` | `{ products: [...] }` — published only, sorted by `order` |
| GET | `/api/products/:slug` | `{ product, related: [...] }` |
| GET | `/api/inventory` | `{ updatedAt, sync: { at, status, source, message }, products: [ { id, slug, name, category, garment, colors, price, variants:[{sku,color,size,stock,preorder}] } ], events: [last 40 inventoryEvents] }` |
| GET | `/api/updates?limit=&category=&before=` | `{ updates: [...], total }` — published only, pinned first, newest first |
| GET | `/api/updates/:id` | `{ update, newer, older }` — one published update with its neighbours in time (404 otherwise) |
| POST | `/api/contact` | body `{ name, email, topic, message, whatsapp? }` → `{ ok, id }` |
| POST | `/api/orders` | body `{ ref, items:[{productId,sku,name,color,size,qty,price}], customer:{name,email,phone,address,postcode,city,country}, channel:"whatsapp"|"agent", currency }` → `{ ok }` (logs an order intent for the dashboard; the customer still completes on WhatsApp) |
| POST | `/api/notify` | body `{ productId, sku, contact }` → `{ ok }` (restock alert request) |
| GET | `/media/weibo?u=<encoded sinaimg url>` | image bytes (proxied with Weibo referer, cached on disk). Only `*.sinaimg.cn` hosts allowed — plus `*.weibocdn.com` for post videos (signed URLs that expire, so they are downloaded at import time and served from cache; supports HTTP Range for `<video>`) |

## Admin endpoints

Auth: `POST /api/admin/login { password }` → `{ token, expiresAt }`. Send `Authorization: Bearer <token>` on every admin call. Password = env `ADMIN_PASSWORD` (required in production; dev default `colastudio` with a warning in the log).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/me` | token check |
| GET | `/api/admin/dashboard` | `{ counts:{products,published,variants,lowStock,soldOut,updatesPending,messages,orders,notify}, lowStock:[…], recentOrders:[…], recentMessages:[…], sync:{weidian,weibo} }` |
| GET / POST | `/api/admin/products` | list all (incl. drafts) / create (server fills id, slug, timestamps) |
| GET / PUT / DELETE | `/api/admin/products/:id` | read / replace / delete |
| POST | `/api/admin/products/:id/duplicate` | copy as draft |
| POST | `/api/admin/products/bulk` | `{ items:[{ id?, input, row? }], remove?:[ids] }` → spreadsheet / Weidian import. Validates everything first (all-or-nothing, errors name the row), snapshots `pre-import`, writes once → `{ created, updated, removed, backup }`; stock changes logged with source `import` |
| PATCH | `/api/admin/products/:id/stock` | `{ variants:[{sku,stock,preorder?}] }` → logs inventoryEvents (source `admin`) |
| GET / PUT | `/api/admin/categories` | full array replace |
| GET / PUT | `/api/admin/settings` | public settings object replace |
| GET / PUT | `/api/admin/integrations` | private config; secrets returned masked (`"••••abcd"`); sending a masked value back keeps the old secret |
| POST | `/api/admin/upload` | `{ filename, data }` (data = base64 or data URL, max 8 MB, jpg/png/webp/gif/avif/svg) → `{ url }` |
| GET / DELETE | `/api/admin/uploads[/:name]` | list / remove uploaded files |
| GET / POST | `/api/admin/updates` | all updates incl. pending/hidden / create manual post |
| PUT / DELETE | `/api/admin/updates/:id` | edit (title, textEnglish, status, pinned, category, relatedProducts) / delete |
| POST | `/api/admin/updates/bulk` | `{ ids?:[…], fromStatus?, source?, status }` → `{ changed }` (e.g. publish all pending); `{ ids, delete: true }` → `{ deleted }` (Weibo posts are tombstoned) |
| POST | `/api/admin/weibo/reset` | `{ deletePosts?: true }` → `{ removed, backup }` — forget lastId, history position and tombstones (409 while an import runs) |
| GET / POST | `/api/admin/weibo/history` | status / start a background import of older posts: `{ limit?: 100, translate?, resume?, translateOnly?, publishUntranslated? }` (409 while running, 501 on serverless) |
| POST | `/api/admin/weibo/history/stop` | stop after the current step |
| GET | `/api/admin/seo` | built-in page titles/descriptions (placeholders), sitemap/robots/feed URLs, indexed counts |
| POST | `/api/admin/weibo/fetch` | `{ force?: n }` → `{ fetched, added, skipped, errors, log:[…] }` |
| POST | `/api/admin/weibo/retranslate/:id` | re-run translation for one post |
| POST | `/api/admin/translate/test` | `{ text }` → `{ provider, translation }` |
| POST | `/api/admin/weidian/sync` | `{ dryRun?: bool, productId?: id }` → `{ changes:[{productId,sku,from,to}], unmatched:[…], errors:[…], applied }` |
| POST | `/api/admin/weidian/shop` | `{ text }` (shop link) → `{ shopId, items:[{ itemId, name, price, image, stock, hasSku, suggested, existing? }] }` — every product of the shop, for the import picker |
| POST | `/api/admin/weidian/test` | `{ itemId }` (id or link) → raw mapped result for one item, plus `scrape: { sources, images, detailImages, description, notes }` (what an import would take over) |
| POST | `/api/admin/weidian/import` | `{ items: "links/ids" \| [..], links?: [share links], translate?: bool, sizeChart?: bool }` (max 10 per call) → `{ results:[{ itemId, ok, draft?, notes, sources?, sizeChart?, error?, skipped?, existing? }], translated }`. Full scrape: gallery + colour photos, description (translated), detail photos, size chart read by Claude into `measurements` + `sizeChartImage`; requests fall back to the scraping service and Claude web fetch. Nothing is saved — create them with `/products/bulk` |
| GET | `/api/admin/messages`, `/api/admin/orders`, `/api/admin/notify` | stored submissions |
| GET | `/api/admin/logs` | last 300 log lines |
| GET | `/api/admin/export` | full backup JSON (no secrets) |
| POST | `/api/admin/import` | restore a backup (same shape as export) |

## Implementation notes (server)

Clarifications of the shapes the server actually returns — all additive to the tables above.

- **Wrapped responses.** Every list/object endpoint wraps its payload in a named key: `GET /api/admin/products` → `{ products }`, `GET/PUT /api/admin/categories` → `{ categories }`, `GET/PUT /api/admin/settings` → `{ settings }`, `GET /api/admin/updates` → `{ updates }`, `GET /api/admin/uploads` → `{ uploads:[{name,url,size,type,modifiedAt}] }`, `/api/admin/messages|orders|notify` → `{ messages }` / `{ orders }` / `{ notify }` (newest first), `GET /api/admin/logs` → `{ logs:[{at,level,scope,message}] }`. Single items: `{ product }`, `{ update }`. PUT bodies may be sent bare (array / object) or wrapped the same way.
- **Create** endpoints answer `201` (`/api/contact`, `/api/orders`, `/api/notify`, admin product/update create, duplicate, upload). `POST /api/orders` → `{ ok, id, ref }`; `POST /api/notify` → `{ ok }` or `{ ok, duplicate:true }`.
- `PUT /api/admin/products/:id` merges the body onto the stored product (send the full object to replace). Stock changes made through PUT are logged as inventoryEvents too. `PATCH …/stock` → `{ product, changes:[events], unmatched:[skus] }`.
- `GET /api/admin/me` → `{ ok, user, expiresAt, defaultPassword, version }` (`defaultPassword:true` → show a "change ADMIN_PASSWORD" warning).
- `GET/PUT /api/admin/integrations` returns the private config plus `_meta: { envOverrides:[{path, env}], providers, sync, running, scheduler }` (read-only; ignored on PUT). Fields listed in `envOverrides` are set by environment variables and cannot be changed from the panel. Extra private keys beyond DATA_MODEL: `weibo.backfill`, `translation.googleKey`, `weidian.colorAliases|itemUrlTemplate|tokenUrl|apiUrl|apiMethod|apiVersion|delayMs|priceUnit`.
- `POST /api/admin/weibo/fetch` → `{ ok, fetched, added, skipped, errors:[string], log:[string] }` (200 even when Weibo blocks us — check `ok`/`errors`; 409 while a fetch is running).
- `POST /api/admin/weidian/sync` → `{ provider, dryRun, changes:[{productId,sku,from,to,color,size,matchedBy}], infoChanges, mappings, unmatched, errors:[{productId?,itemId?,error}], applied:boolean, changed, items, ok }`.
- `GET /api/inventory`: each variant also has `status` (derived stock status), products include `restockDate`, events include `name, slug, color, size`; only published products are listed.
- `GET /api/updates?before=` accepts an update id or an ISO date; pinned posts only appear on the first page. Weibo items may carry `retweeted:true` and `video:{url,poster,link}`.
- Extra admin routes: `PATCH|DELETE /api/admin/messages/:id` (`{read, archived}`), `/api/admin/orders/:id` (`{status, adminNote}`), `/api/admin/notify/:id` (`{notified}`).
- `POST /api/contact` treats a non-empty `website` field as a honeypot (silently accepted, not stored).
- State-changing requests with an `Origin` header from another site get `403`. Errors are always `{ error }`; `429` responses carry `Retry-After`.
