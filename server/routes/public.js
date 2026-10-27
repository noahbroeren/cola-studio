'use strict';
/** Public JSON API (see docs/API.md → "Public endpoints"). */
const { HttpError } = require('../lib/http');
const { isObj, clone, str, toInt, toNumber, clamp, randomId } = require('../lib/util');
const { stockStatus } = require('../lib/stock');

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

function byOrder(a, b) {
  return (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name || '').localeCompare(String(b.name || ''));
}

function publishedProducts(db) {
  return db.products.filter((p) => p.status === 'published').sort(byOrder);
}

function sortedCategories(db) {
  return [...db.categories].sort(byOrder);
}

/** Settings are public by definition; drop underscore-prefixed internals just in case. */
function publicSettings(settings) {
  const out = clone(settings);
  for (const k of Object.keys(out)) if (k.startsWith('_')) delete out[k];
  return out;
}

function publicUpdate(u) {
  const out = { ...u };
  if (isObj(out.translation)) {
    const { error, ...rest } = out.translation; // eslint-disable-line no-unused-vars
    out.translation = rest;
  }
  return out;
}

const ts = (v) => {
  const t = Date.parse(v || '');
  return Number.isFinite(t) ? t : 0;
};

function registerPublic(router, app) {
  const { store, version, limiters, log } = app;
  const db = () => store.db;

  async function limit(ctx, name) {
    const r = await limiters.publicPost.hit(`${name}:${ctx.ip}`);
    if (!r.allowed) throw new HttpError(429, 'Too many requests — please try again later', { retryAfter: r.retryAfter });
  }

  router.get('/api/health', () => ({
    ok: true,
    version,
    demo: !!db().settings.demo,
    time: new Date().toISOString(),
  }));

  router.get('/api/site', () => ({ settings: publicSettings(db().settings), categories: sortedCategories(db()) }), { publicCache: true });

  router.get('/api/products', () => ({ products: publishedProducts(db()) }), { publicCache: true });

  router.get(
    '/api/products/:slug',
    (ctx) => {
      const list = publishedProducts(db());
      const product = list.find((p) => p.slug === ctx.params.slug) || list.find((p) => p.id === ctx.params.slug);
      if (!product) throw new HttpError(404, 'Product not found');
      const sameCat = list.filter((p) => p.id !== product.id && p.category === product.category);
      const others = list.filter((p) => p.id !== product.id && p.category !== product.category).sort((a, b) => !!b.featured - !!a.featured);
      return { product, related: [...sameCat, ...others].slice(0, 4) };
    },
    { publicCache: true }
  );

  router.get(
    '/api/inventory',
    () => {
      const d = db();
      const settings = d.settings;
      const products = publishedProducts(d);
      const byId = new Map(products.map((p) => [p.id, p]));
      const sync = d.meta.sync?.weidian;
      const events = d.inventoryEvents
        .filter((e) => byId.has(e.productId))
        .slice(-40)
        .reverse()
        .map((e) => {
          const p = byId.get(e.productId);
          const v = p.variants.find((x) => x.sku === e.sku);
          return { ...e, name: p.name, slug: p.slug, color: v?.color || '', size: v?.size || '' };
        });
      const updatedAt = Math.max(ts(sync?.at), ts(events[0]?.at), ...products.map((p) => ts(p.updatedAt)), 0);
      return {
        updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
        sync: {
          at: sync?.at || null,
          status: sync?.status || 'manual',
          source: sync?.source || 'admin',
          message: sync?.message || '',
        },
        products: products.map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          category: p.category,
          garment: p.garment,
          colors: p.colors,
          price: p.price,
          restockDate: p.restockDate || null,
          variants: p.variants.map((v) => ({
            sku: v.sku,
            color: v.color,
            size: v.size,
            stock: v.stock,
            preorder: !!v.preorder,
            status: stockStatus(v, p, settings),
          })),
        })),
        events,
      };
    },
    { publicCache: true }
  );

  router.get(
    '/api/updates',
    (ctx) => {
      const q = ctx.query;
      const lim = clamp(toInt(q.limit, 20), 1, 100);
      let list = db().updates.filter((u) => u.status === 'published');
      // Demo posts step aside automatically as soon as real (e.g. Weibo) posts exist.
      if (list.some((u) => !u.demo)) list = list.filter((u) => !u.demo);
      if (q.category) list = list.filter((u) => u.category === q.category);
      const total = list.length;
      let sorted = store.sortedUpdates(list);
      if (q.before) {
        const ref = db().updates.find((u) => u.id === q.before);
        const before = ts(ref ? ref.publishedAt : q.before);
        // Pinned posts are always on the first page, so later pages skip them.
        if (before) sorted = sorted.filter((u) => !u.pinned && ts(u.publishedAt) < before);
      }
      return { updates: sorted.slice(0, lim).map(publicUpdate), total };
    },
    { publicCache: true }
  );

  router.post('/api/contact', async (ctx) => {
    await limit(ctx, 'contact');
    const b = await ctx.body();
    if (!isObj(b)) throw new HttpError(400, 'Expected a JSON object');
    if (b.website || b.hp) return { ok: true, id: randomId('msg') }; // honeypot: pretend success
    const name = str(b.name, 200).trim();
    const email = str(b.email, 300).trim();
    const whatsapp = str(b.whatsapp, 60).trim();
    const topic = str(b.topic, 120).trim();
    const message = str(b.message, 10000).trim();
    if (!name) throw new HttpError(400, 'name is required');
    if (name.length > 120) throw new HttpError(400, 'name is too long');
    if (!EMAIL_RE.test(email) && !(whatsapp && !email)) throw new HttpError(400, 'a valid email address is required');
    if (!message) throw new HttpError(400, 'message is required');
    if (message.length > 5000) throw new HttpError(400, 'message is too long (max 5000 characters)');
    const msg = { id: randomId('msg'), name, email, topic, message, whatsapp, createdAt: new Date().toISOString(), read: false };
    store.pushCapped('messages', msg);
    store.save();
    log.info(`new contact message ${msg.id} (${topic || 'no topic'})`);
    ctx.status = 201;
    return { ok: true, id: msg.id };
  });

  router.post('/api/orders', async (ctx) => {
    await limit(ctx, 'orders');
    const b = await ctx.body();
    if (!isObj(b)) throw new HttpError(400, 'Expected a JSON object');
    if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'items must be a non-empty array');
    if (b.items.length > 50) throw new HttpError(400, 'too many items (max 50)');
    const d = db();
    let totalCNY = 0;
    const items = b.items.map((it, i) => {
      if (!isObj(it)) throw new HttpError(400, `items[${i}] must be an object`);
      const qty = toInt(it.qty, 1);
      if (qty < 1 || qty > 999) throw new HttpError(400, `items[${i}].qty must be between 1 and 999`);
      const productId = str(it.productId, 40);
      const product = d.products.find((p) => p.id === productId);
      if (product) totalCNY += (Number(product.price) || 0) * qty;
      return {
        productId,
        sku: str(it.sku, 80),
        name: str(it.name, 200) || product?.name || '',
        color: str(it.color, 80),
        size: str(it.size, 40),
        qty,
        price: toNumber(it.price, null),
        known: !!product,
      };
    });
    const c = isObj(b.customer) ? b.customer : {};
    const channel = ['whatsapp', 'agent'].includes(b.channel) ? b.channel : 'whatsapp';
    const order = {
      id: randomId('ord'),
      ref: str(b.ref, 60).trim() || `${d.settings.whatsapp?.orderPrefix || 'CS'}-${Date.now().toString(36).toUpperCase()}`,
      items,
      customer: {
        name: str(c.name, 120),
        email: str(c.email, 200),
        phone: str(c.phone, 60),
        address: str(c.address, 300),
        postcode: str(c.postcode, 30),
        city: str(c.city, 120),
        country: str(c.country, 80),
        // legacy single contact field (older clients)
        contact: str(c.contact, 200) || [str(c.phone, 60), str(c.email, 200)].filter(Boolean).join(' · '),
      },
      channel,
      agentId: str(b.agentId, 60),
      currency: str(b.currency, 8).toUpperCase() || 'CNY',
      note: str(b.note, 2000),
      totalCNY: Math.round(totalCNY * 100) / 100,
      status: 'new',
      createdAt: new Date().toISOString(),
    };
    store.pushCapped('orders', order);
    store.save();
    log.info(`order intent ${order.ref} (${items.length} item(s), ${channel})`);
    ctx.status = 201;
    return { ok: true, id: order.id, ref: order.ref };
  });

  router.post('/api/notify', async (ctx) => {
    await limit(ctx, 'notify');
    const b = await ctx.body();
    if (!isObj(b)) throw new HttpError(400, 'Expected a JSON object');
    const product = publishedProducts(db()).find((p) => p.id === str(b.productId, 40));
    if (!product) throw new HttpError(404, 'Unknown product');
    const sku = str(b.sku, 80).trim();
    if (sku && !product.variants.some((v) => v.sku === sku)) throw new HttpError(400, 'Unknown sku for this product');
    const contact = str(b.contact, 300).trim();
    if (contact.length < 3 || contact.length > 200) throw new HttpError(400, 'contact is required (email or WhatsApp number)');
    const dup = db().notify.find(
      (n) => n.productId === product.id && n.sku === sku && String(n.contact).toLowerCase() === contact.toLowerCase() && !n.notifiedAt
    );
    if (dup) return { ok: true, duplicate: true };
    store.pushCapped('notify', { id: randomId('ntf'), productId: product.id, sku, contact, createdAt: new Date().toISOString(), notifiedAt: null });
    store.save();
    ctx.status = 201;
    return { ok: true };
  });
}

module.exports = { registerPublic, publishedProducts, sortedCategories, publicSettings, byOrder };
