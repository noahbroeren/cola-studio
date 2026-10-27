# Cola Studio — Data model

All content lives in JSON. There are two places it can come from:

| Mode | Where data lives | Who writes it |
|---|---|---|
| **Server mode** (`node server.js`) | `data/db.json` (seeded from `public/data/*.json` on first boot) + `data/private.json` (secrets) | Admin panel via `/api/admin/*`, Weidian sync, Weibo fetcher |
| **Static mode** (any static host / preview) | `public/data/*.json` + optional localStorage overlay written by the admin panel in demo mode | Admin panel (browser-only, exportable as JSON) |

Prices are stored in **CNY** (Weidian's currency). The frontend converts for display using `settings.currency.rates`.

---

## `settings` (public) — `public/data/settings.json`

```jsonc
{
  "demo": true,                       // shows "demo catalogue" markers site-wide
  "brand": {
    "name": "Cola Studio",
    "tagline": "International Fashion Studio",
    "domain": "colastudio.com",
    "email": "studio@colastudio.com",
    "established": "2019"
  },
  "announcement": { "enabled": true, "text": "…", "link": "live-stock" },
  "currency": {
    "base": "CNY",
    "default": "EUR",
    "available": ["CNY", "EUR", "USD", "GBP"],
    "rates": { "CNY": 1, "EUR": 0.128, "USD": 0.139, "GBP": 0.107 },  // 1 CNY = x
    "autoUpdate": true,
    "updatedAt": "2026-10-26T08:00:00Z"
  },
  "inventory": { "lowStockThreshold": 5, "refreshSeconds": 30 },
  "whatsapp": {
    "number": "31600000000",          // international format, digits only
    "enabled": true,
    "greeting": "Hello Cola Studio",
    "orderPrefix": "CS"
  },
  "agents": [
    { "id": "agent-1", "name": "Agent One", "enabled": true,
      "urlTemplate": "",               // e.g. "https://agent.example/item?url={weidianUrl}" — placeholders: {weidianUrl} {itemId} {slug} {name}
      "description": "…", "recommended": true }
  ],
  "weidian": {
    "shopUrl": "",
    "itemUrlTemplate": "https://weidian.com/item.html?itemID={itemId}"
  },
  "social": { "instagram": "", "weibo": "", "tiktok": "", "whatsappChannel": "", "discord": "", "xiaohongshu": "" },
  "nextDrop": { "enabled": true, "title": "…", "subtitle": "…", "date": "2026-11-14T12:00:00+01:00" },
  "shipping": { "regions": [ { "region": "Europe", "time": "7–12 days" } ], "note": "…" },
  "seo": { "title": "…", "description": "…" }
}
```

## `categories` — `public/data/categories.json`

```jsonc
[ { "id": "outerwear", "name": "Outerwear", "description": "…", "order": 1 } ]
```

## `products` — `public/data/products.json`

```jsonc
{
  "id": "cs-001",                      // stable id, never reused
  "slug": "construction-work-jacket", // URL: /products/construction-work-jacket
  "name": "Construction Work Jacket",
  "subtitle": "12 oz waxed cotton canvas",
  "category": "outerwear",            // categories[].id
  "collection": "Vol. 03 — Construction",
  "season": "AW26",
  "price": 689,                        // CNY
  "compareAt": null,                   // CNY, optional (shows strike-through)
  "status": "published",              // published | draft | archived
  "badges": ["new"],                  // new | bestseller | limited | restock | preorder
  "featured": true,
  "order": 10,                         // manual sort weight (lower first)
  "garment": "workjacket",            // placeholder illustration type (used when images[] is empty)
  "print": null,                       // optional illustration detail: null | "monogram" | "pocket"
  "demo": true,                        // demo product marker (shown as "· Demo" while settings.demo is on)
  "colors": [ { "name": "Clay", "hex": "#B07A57" } ],
  "sizes": ["S", "M", "L", "XL"],
  "variants": [
    { "sku": "CS001-CLAY-S", "color": "Clay", "size": "S", "stock": 4,
      "preorder": false, "weidianSkuId": "" }
  ],
  "images": [ { "url": "/uploads/x.jpg", "alt": "…", "color": "Clay" } ],   // empty → generated illustration
  "description": "Intro…\n\n**Fabric:** …\n**Fit:** …\n**Details:** …",  // **bold** and "- " bullets are rendered
  "descriptionOriginal": "…",         // seller text (Weidian) the description was written from
  "details": ["…"],                   // shown as a "Details:" line when the description has none
  "materials": "…",                   // shown as a "Fabric:" line when the description has none
  "care": ["…"],                      // kept for older data, no longer shown on the site
  "fit": "…",
  "measurements": { "unit": "cm", "columns": ["Chest", "Length"], "rows": [ { "size": "S", "values": [58, 70] } ] },
  "detailImages": [ { "url": "/media/img?u=…" } ],   // thumbnail grid on the product page
  "sizeChartImage": "",               // shown only when there is no measurements table
  "leadTime": "Ships in 3–5 working days",
  "restockDate": null,                 // ISO date when sold out but coming back
  "weidian": { "itemId": "", "url": "", "syncEnabled": false, "lastSyncedAt": null },
  "agentLinks": { "agent-1": "" },    // per-product override of the agent urlTemplate
  "tags": ["…"],
  "weightKg": 1.2,
  "createdAt": "…", "updatedAt": "…"
}
```

**Stock status** (derived, never stored):
`variant.preorder` → `preorder`; `stock == 0` → `soldout` (or `restocking` when `product.restockDate` is set); `stock <= settings.inventory.lowStockThreshold` → `low`; else `instock`.

## `updates` (Studio Updates / Weibo) — `public/data/updates.json`

```jsonc
{
  "id": "wb-5356857105057064",        // "wb-<weibo id>" or "su-<random>" for manual posts
  "source": "weibo",                  // weibo | studio
  "sourceId": "5356857105057064",
  "url": "https://m.weibo.cn/status/5356857105057064",
  "title": "Sampling update | Heavyweight Hoodie",
  "category": "production",           // production | drop | restock | studio | notice
  "textOriginal": "中文原文…",
  "textEnglish": "English translation…",
  "media": [
    { "type": "image", "url": "/media/weibo?u=…" },
    { "type": "illustration", "garment": "hoodie", "color": "#2B2724", "caption": "…" }  // demo only
  ],
  "video": null,                       // not imported any more (Weibo videos were slow and expire)
  "publishedAt": "…", "fetchedAt": "…",
  "status": "published",              // published | pending | hidden
  "pinned": false,
  "translation": { "provider": "anthropic", "model": "claude-sonnet-5-5", "edited": false },
  "relatedProducts": ["cs-006"]
}
```

## `inventoryEvents` — `public/data/inventory-events.json`

```jsonc
{ "at": "…", "productId": "cs-006", "sku": "CS006-WBLK-M", "from": 3, "to": 0, "source": "weidian" }   // source: weidian | admin | order
```

## Static-mode overlay — `localStorage["cola.overlay.v1"]`

In static mode (no server) the admin panel saves edits to this localStorage key, and the public site's data layer
reads it **in place of** the JSON files when a key is present. This makes demo edits visible on the public site in the
same browser. Shape: `{ "products"?: [...], "categories"?: [...], "settings"?: {...}, "updates"?: [...], "updatedAt": "…" }`.
The admin panel can export each collection as a JSON file to replace `public/data/*.json` on a static host.

## Private config (server only) — `data/private.json`

Never sent to the browser. Editable in the admin panel (secrets shown masked) or via environment variables (env wins).

```jsonc
{
  "weibo": { "enabled": false, "uid": "", "cookie": "", "intervalMinutes": 15, "autoPublish": true, "lastId": null },
  "translation": { "provider": "anthropic", "anthropicKey": "", "model": "claude-sonnet-5-5",
                   "deeplKey": "", "libreUrl": "", "libreKey": "", "glossary": "" },
  "weidian": { "enabled": false, "provider": "public-item", "intervalMinutes": 10,
               "appKey": "", "appSecret": "", "accessToken": "", "feedUrl": "", "sizeAliases": {} }
}
```
