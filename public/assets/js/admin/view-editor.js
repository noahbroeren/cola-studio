/* ==========================================================================
   Cola Studio — Admin · Product editor
   Sections with a sticky section nav, a live preview card and a sticky save
   bar. Colours × sizes drive an auto-generated variant matrix that keeps
   existing stock; destructive structure changes always ask first.
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;

  const SECTIONS = [
    { id: 'basics', label: 'Basics' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'story', label: 'Story & details' },
    { id: 'options', label: 'Colours & sizes' },
    { id: 'variants', label: 'Variants & stock' },
    { id: 'images', label: 'Images' },
    { id: 'measurements', label: 'Size chart' },
    { id: 'links', label: 'Ordering links' },
  ];

  const GARMENT_BY_CATEGORY = { outerwear: 'workjacket', hoodies: 'hoodie', tees: 'tee', knitwear: 'knit', shirts: 'shirt', trousers: 'trousers', accessories: 'cap' };
  const BOTTOMS = ['sweatpants', 'trousers', 'jeans', 'cargo', 'shorts'];
  const ACCESSORIES = ['cap', 'beanie', 'tote', 'crossbody', 'socks'];
  const DESC_SOFT_MAX = 600;

  let keySeq = 0;
  const newKey = () => 'k' + ++keySeq;

  function blankProduct(categories, query, products) {
    const cat = (query && query.category) || (categories[0] && categories[0].id) || '';
    const maxOrder = products.reduce((m, p) => Math.max(m, Number(p.order) || 0), 0);
    return {
      name: '',
      slug: '',
      subtitle: '',
      category: cat,
      collection: '',
      season: '',
      price: 0,
      compareAt: null,
      status: 'draft',
      badges: [],
      featured: false,
      order: maxOrder + 10,
      garment: GARMENT_BY_CATEGORY[cat] || 'tee',
      print: null,
      colors: [{ name: 'Black', hex: '#1E1B1A' }],
      sizes: ['S', 'M', 'L', 'XL'],
      variants: [],
      images: [],
      description: '',
      details: [],
      materials: '',
      care: [],
      fit: '',
      measurements: null,
      leadTime: 'Ships in 3–5 working days',
      restockDate: null,
      weidian: { itemId: '', url: '', syncEnabled: false, syncInfo: false, lastSyncedAt: null },
      agentLinks: {},
      tags: [],
      weightKg: null,
    };
  }

  function measureTemplate(garment, sizes) {
    let columns = ['Chest (½)', 'Length', 'Shoulder', 'Sleeve'];
    if (BOTTOMS.includes(garment)) columns = garment === 'shorts' ? ['Waist (½)', 'Hip (½)', 'Inseam', 'Leg opening'] : ['Waist (½)', 'Hip (½)', 'Rise', 'Inseam', 'Leg opening'];
    else if (ACCESSORIES.includes(garment)) columns = garment === 'tote' || garment === 'crossbody' ? ['Width', 'Height', 'Depth', 'Strap drop'] : ['Circumference', 'Height'];
    return { unit: 'cm', columns, rows: (sizes.length ? sizes : ['OS']).map((s) => ({ size: s, values: columns.map(() => '') })) };
  }

  A.views.editor = {
    title: 'Product',
    skeleton: 'form',
    async render(root, params, ctx) {
      const isNew = params.id === 'new';
      const [settings, categories, products] = await Promise.all([A.data.getSettings(), A.data.getCategories(), A.data.getProducts()]);
      let product;
      if (isNew) product = blankProduct(categories, ctx.query, products);
      else product = products.find((p) => p.id === params.id) || (await A.data.getProduct(params.id));
      if (ctx.stale()) return null;
      return createEditor(root, { product, isNew, settings, categories, products, ctx });
    },
  };

  /* ====================================================================== */

  function createEditor(root, init) {
    const settings = init.settings;
    const categories = init.categories;
    let allProducts = init.products;
    let isNew = init.isNew;
    let p = null; // working copy
    let baseline = '';
    let slugTouched = false;
    let predictedId = '';
    const advOpen = new Set();
    let advAll = false;
    const measureCache = {};
    let previewColor = null;
    let leaving = false;
    let saving = false;
    let observer = null;
    let sortables = [];
    const errors = new Map(); // sectionId → message

    /* ------------------------------------------------------------ helpers */

    function nextIdGuess() {
      let max = 0;
      for (const x of allProducts) {
        const m = /^cs-(\d+)$/i.exec(x.id || '');
        if (m) max = Math.max(max, Number(m[1]));
      }
      return 'cs-' + String(max + 1).padStart(3, '0');
    }
    const skuId = () => p.id || predictedId;

    function colorCodes() {
      const taken = new Set();
      const map = new Map();
      for (const c of p.colors) {
        const code = A.colorCode(c.name, taken);
        taken.add(code);
        map.set(c._k, code);
      }
      return map;
    }
    function autoSku(ck, size) {
      const codes = colorCodes();
      return A.genSku(skuId(), ck ? codes.get(ck) : '', size);
    }

    function prepare(src) {
      const x = A.clone(src);
      x.colors = Array.isArray(x.colors) ? x.colors : [];
      x.sizes = Array.isArray(x.sizes) ? x.sizes.map(String) : [];
      x.variants = Array.isArray(x.variants) ? x.variants : [];
      x.images = Array.isArray(x.images) ? x.images : [];
      x.details = Array.isArray(x.details) ? x.details : [];
      x.care = Array.isArray(x.care) ? x.care : [];
      x.tags = Array.isArray(x.tags) ? x.tags : [];
      x.badges = Array.isArray(x.badges) ? x.badges : [];
      x.weidian = Object.assign({ itemId: '', url: '', syncEnabled: false, syncInfo: false, lastSyncedAt: null }, A.isObj(x.weidian) ? x.weidian : {});
      x.agentLinks = A.isObj(x.agentLinks) ? x.agentLinks : {};
      if (x.print === undefined) x.print = null;
      if (x.compareAt === undefined) x.compareAt = null;
      if (x.restockDate === undefined) x.restockDate = null;
      x.colors.forEach((c) => {
        c._k = newKey();
        if (c.hex == null) c.hex = '';
      });
      for (const v of x.variants) {
        const c = x.colors.find((cc) => String(cc.name).toLowerCase() === String(v.color || '').toLowerCase());
        v._ck = c ? c._k : v.color ? null : x.colors.length ? null : '';
        if (!v.color && !x.colors.length) v._ck = '';
      }
      return x;
    }

    function markAutoSkus() {
      for (const v of p.variants) {
        if (v._ck === null) continue;
        v._auto = v.sku === autoSku(v._ck, v.size) || !v.sku;
      }
    }

    /** Variants ordered by colour order then size order (orphans last). */
    function orderedVariants() {
      const ci = new Map(p.colors.map((c, i) => [c._k, i]));
      const si = new Map(p.sizes.map((s, i) => [s, i]));
      return p.variants.slice().sort((a, b) => {
        const ca = a._ck === null ? 1e6 : ci.has(a._ck) ? ci.get(a._ck) : -1;
        const cb = b._ck === null ? 1e6 : ci.has(b._ck) ? ci.get(b._ck) : -1;
        if (ca !== cb) return ca - cb;
        return (si.has(a.size) ? si.get(a.size) : 1e6) - (si.has(b.size) ? si.get(b.size) : 1e6);
      });
    }

    function serialize() {
      const out = A.stripPrivate(Object.assign({}, p, { variants: orderedVariants() }));
      return out;
    }
    const snapshot = () => JSON.stringify(serialize());

    function colorKeys() {
      return p.colors.length ? p.colors.map((c) => c._k) : [''];
    }
    function sizeList() {
      return p.sizes.length ? p.sizes : [''];
    }
    function findVariant(ck, size) {
      return p.variants.find((v) => v._ck === ck && String(v.size) === String(size));
    }
    function colorOf(ck) {
      return p.colors.find((c) => c._k === ck) || null;
    }

    /** Ensure every colour × size has a variant; keeps existing stock. */
    function syncVariants() {
      if (!p.colors.length && !p.sizes.length) return;
      for (const ck of colorKeys()) {
        for (const size of sizeList()) {
          if (findVariant(ck, size)) continue;
          const c = colorOf(ck);
          p.variants.push({ sku: autoSku(ck, size), color: c ? c.name : '', size: size, stock: 0, preorder: false, weidianSkuId: '', _ck: ck, _auto: true });
        }
      }
    }
    function orphans() {
      const cks = new Set(colorKeys());
      const sz = new Set(sizeList().map(String));
      return p.variants.filter((v) => v._ck === null || !cks.has(v._ck) || !sz.has(String(v.size)));
    }
    const units = (list) => list.reduce((n, v) => n + (Number(v.stock) || 0), 0);

    function regenAutoSkus() {
      for (const v of p.variants) if (v._auto && v._ck !== null) v.sku = autoSku(v._ck, v.size);
    }

    /* --------------------------------------------------------- skeleton */

    function shell() {
      root.innerHTML =
        '<header class="page-head"><div class="page-head__text">' +
        '<a class="crumb" href="' + A.href('/products') + '">' + icon('chevronLeft', 14) + 'Products</a>' +
        '<div class="title-row"><h1 data-title></h1><span data-status-pill></span></div>' +
        '<p class="lead" data-lead></p></div>' +
        '<div class="page-actions" data-head-actions></div></header>' +
        '<div class="editor">' +
        '<nav class="secnav" aria-label="Sections">' +
        SECTIONS.map((s) => '<a class="secnav__link" href="' + A.href('/products/' + (p.id || 'new') + '?section=' + s.id) + '" data-goto="' + s.id + '"><span>' + esc(s.label) + '</span><i class="secnav__flag" data-flag="' + s.id + '" hidden></i></a>').join('') +
        '<a class="secnav__link secnav__link--preview" href="#" data-goto="preview"><span>Preview</span></a>' +
        '<div class="secnav__meta" data-meta></div>' +
        '</nav>' +
        '<form class="ed-main" novalidate autocomplete="off">' +
        SECTIONS.map(
          (s) =>
            '<section class="card ed-section" id="sec-' + s.id + '" data-sec="' + s.id + '" aria-labelledby="h-' + s.id + '">' +
            '<div class="ed-section__head"><div><h2 id="h-' + s.id + '">' + esc(s.label) + '</h2><p data-desc></p></div><div class="row" data-head></div></div>' +
            '<div class="ed-section__body" data-body></div></section>'
        ).join('') +
        '</form>' +
        '<aside class="preview" id="sec-preview" aria-label="Live preview"></aside>' +
        '</div>' +
        '<div class="savebar" data-savebar></div>';
    }

    const body = (id) => root.querySelector('[data-sec="' + id + '"] [data-body]');
    const head = (id) => root.querySelector('[data-sec="' + id + '"] [data-head]');
    const desc = (id, text) => {
      root.querySelector('[data-sec="' + id + '"] [data-desc]').textContent = text;
    };

    /* ----------------------------------------------------------- header */

    function renderHeader() {
      const h1 = root.querySelector('[data-title]');
      h1.innerHTML = p.name ? '<b>' + esc(p.name) + '</b>' : isNew ? '<b>New</b> <span>product</span>' : '<b>Untitled</b>';
      root.querySelector('[data-status-pill]').innerHTML = isNew ? '<span class="pill pill--outline">Not saved</span>' : A.statusPill(p.status);
      root.querySelector('[data-lead]').innerHTML = isNew
        ? 'Fill in the basics, then set colours and sizes — the variant matrix builds itself.'
        : esc(p.id) + ' · created ' + esc(A.date(p.createdAt)) + ' · updated ' + esc(A.ago(p.updatedAt));
      root.querySelector('[data-head-actions]').innerHTML = isNew
        ? '<a class="btn btn--ghost" href="' + A.href('/products') + '">Cancel</a>'
        : '<button type="button" class="btn btn--secondary" data-act="view"><span>View<span class="hide-sm">&nbsp;on site</span></span>' + icon('external', 15) + '</button>' +
          '<button type="button" class="btn btn--secondary" data-act="duplicate">' + icon('copy', 16) + 'Duplicate</button>' +
          '<button type="button" class="btn btn--danger" data-act="delete">' + icon('trash', 16) + 'Delete</button>';
      ctxSetTitle();
      const meta = root.querySelector('[data-meta]');
      meta.innerHTML = isNew ? 'New product' : esc(p.id) + '<br>' + esc(A.plural(p.variants.length, 'variant')) + ' · ' + esc(A.plural(p.images.length, 'image'));
    }
    function ctxSetTitle() {
      init.ctx.setTitle((p.name || (isNew ? 'New product' : 'Product')) + ' · Products');
    }

    /* ----------------------------------------------------------- basics */

    function renderBasics() {
      desc('basics', 'Name, URL, where it sits in the catalogue and how it is labelled.');
      const collections = Array.from(new Set(allProducts.map((x) => x.collection).filter(Boolean)));
      const seasons = Array.from(new Set(allProducts.map((x) => x.season).filter(Boolean)));
      body('basics').innerHTML =
        '<div class="form-grid">' +
        ui.field('Name', '<input class="input input--lg" id="f-name" data-f="name" value="' + esc(p.name) + '" placeholder="e.g. Construction Work Jacket" maxlength="200" required>', { cls: 'span-2', for: 'f-name' }) +
        ui.field(
          'URL slug',
          '<div class="slug-row"><div class="ig"><span class="ig__pre">/products/</span><input class="input" id="f-slug" data-f="slug" value="' + esc(p.slug) + '" placeholder="generated-from-name" spellcheck="false"></div>' +
            '<button type="button" class="btn btn--secondary" data-act="slug-regen" title="Generate from name" aria-label="Generate slug from name">' + icon('refresh', 15) + '<span class="hide-sm">From name</span></button></div>',
          { cls: 'span-2', for: 'f-slug', hint: isNew ? 'Follows the name until you edit it. Lowercase letters, numbers and dashes.' : 'Changing the slug changes the product URL — existing links will stop working.' }
        ) +
        ui.field('Subtitle', '<input class="input" id="f-subtitle" data-f="subtitle" value="' + esc(p.subtitle) + '" placeholder="e.g. 12 oz waxed cotton canvas" maxlength="300">', { cls: 'span-2', for: 'f-subtitle' }) +
        ui.field('Category', '<select class="input" id="f-category" data-f="category"><option value="">No category</option>' + ui.options(categories.map((c) => ({ value: c.id, label: c.name })), p.category) + (p.category && !categories.some((c) => c.id === p.category) ? '<option value="' + esc(p.category) + '" selected>' + esc(p.category) + ' (missing)</option>' : '') + '</select>', { for: 'f-category' }) +
        ui.field('Collection', '<input class="input" id="f-collection" data-f="collection" value="' + esc(p.collection) + '" list="dl-collections" placeholder="e.g. Vol. 03 — Construction"><datalist id="dl-collections">' + collections.map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist>', { for: 'f-collection' }) +
        ui.field('Season', '<input class="input" id="f-season" data-f="season" value="' + esc(p.season) + '" list="dl-seasons" placeholder="e.g. AW26"><datalist id="dl-seasons">' + seasons.map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist>', { for: 'f-season' }) +
        ui.field('Sort order', '<input class="input input--num" id="f-order" type="number" step="1" data-f="order" data-type="num" value="' + esc(p.order == null ? '' : p.order) + '">', { for: 'f-order', hint: 'Lower numbers appear first.' }) +
        ui.field('Status', ui.segmented('status', [{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }], p.status, 'data-f-radio="status" aria-label="Status"'), {
          hint: p.status === 'published' ? 'Visible on the site.' : p.status === 'draft' ? 'Hidden from the site until you publish.' : 'Hidden from the site and from stock counts.',
          attrs: 'data-status-field',
        }) +
        '<div class="field" style="align-self:center">' + ui.toggle('data-f="featured" data-type="bool"', !!p.featured, 'Featured', 'Highlight on the homepage') + '</div>' +
        ui.field('Badges', '<div class="chips" role="group" aria-label="Badges">' + A.BADGES.map((b) => '<button type="button" class="chip" data-badge="' + b + '" aria-pressed="' + (p.badges.includes(b) ? 'true' : 'false') + '">' + esc(A.BADGE_LABEL[b]) + '</button>').join('') + '</div>', { cls: 'span-2' }) +
        '</div>';
    }

    /* ---------------------------------------------------------- pricing */

    function renderPricing() {
      desc('pricing', 'Prices are stored in CNY, exactly as on Weidian. Visitors see them converted.');
      body('pricing').innerHTML =
        '<div class="form-grid">' +
        ui.field('Price', '<div class="ig"><span class="ig__pre">¥ CNY</span><input class="input input--num" id="f-price" type="number" min="0" step="1" inputmode="decimal" data-f="price" data-type="num" value="' + esc(p.price == null ? '' : p.price) + '"></div>', { for: 'f-price' }) +
        ui.field('Compare-at price', '<div class="ig"><span class="ig__pre">¥ CNY</span><input class="input input--num" id="f-compare" type="number" min="0" step="1" inputmode="decimal" data-f="compareAt" data-type="nnum" value="' + esc(p.compareAt == null ? '' : p.compareAt) + '" placeholder="Optional"></div>', { for: 'f-compare', hint: '<span data-compare-hint>Shown struck through next to the price.</span>' }) +
        '</div><div class="conv" data-conv></div>';
      renderConv();
    }
    function renderConv() {
      const el = root.querySelector('[data-conv]');
      if (!el) return;
      const cur = settings.currency || {};
      const list = (cur.available || ['CNY', 'EUR', 'USD', 'GBP']).filter((c) => c !== 'CNY');
      el.innerHTML = list
        .map((c) => {
          const v = A.convert(Number(p.price) || 0, c, settings);
          const was = p.compareAt ? A.convert(Number(p.compareAt), c, settings) : null;
          return (
            '<div class="conv__cell' + (c === cur.default ? ' is-default' : '') + '"><div class="conv__cur">' + esc(c) + '</div>' +
            '<div class="conv__val">' + (v == null ? '<span class="faint small">No rate</span>' : esc(A.money(v, c))) + (was != null && p.compareAt > p.price ? '<span class="conv__was">' + esc(A.money(was, c)) + '</span>' : '') + '</div></div>'
          );
        })
        .join('') +
        '<div class="conv__cell"><div class="conv__cur">Rates</div><div class="small muted" style="margin-top:6px">' + esc(cur.updatedAt ? 'Updated ' + A.ago(cur.updatedAt) : 'Set in Settings') + ' · <a href="' + A.href('/settings?section=currency') + '">Edit</a></div></div>';
      const hint = root.querySelector('[data-compare-hint]');
      if (hint) {
        const bad = p.compareAt != null && Number(p.compareAt) <= Number(p.price);
        hint.textContent = bad ? 'Should be higher than the price, or it will not show as a discount.' : p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) + '% off — shown struck through next to the price.' : 'Shown struck through next to the price.';
        hint.closest('.hint').classList.toggle('hint--error', bad);
      }
    }

    /* ------------------------------------------------------------ story */

    function repList(key, placeholder, addLabel) {
      const items = p[key];
      return (
        '<div class="rep" data-rep="' + key + '">' +
        (items.length
          ? items
              .map(
                (v, i) =>
                  '<div class="rep__row" data-sort-id="' + i + '"><button type="button" class="handle" aria-label="Drag to reorder" tabindex="-1">' + icon('grip', 16) + '</button>' +
                  '<input class="input" data-list="' + key + '" data-i="' + i + '" value="' + esc(v) + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(key) + ' ' + (i + 1) + '">' +
                  '<button type="button" class="icon-btn icon-btn--sm" data-act="rep-up" data-key="' + key + '" data-i="' + i + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + icon('arrowUp', 15) + '</button>' +
                  '<button type="button" class="icon-btn icon-btn--sm" data-act="rep-down" data-key="' + key + '" data-i="' + i + '" aria-label="Move down"' + (i === items.length - 1 ? ' disabled' : '') + '>' + icon('arrowDown', 15) + '</button>' +
                  '<button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="rep-del" data-key="' + key + '" data-i="' + i + '" aria-label="Remove">' + icon('x', 15) + '</button></div>'
              )
              .join('')
          : '<div class="rep__empty">Nothing yet.</div>') +
        '</div><button type="button" class="btn btn--sm btn--secondary rep__add" data-act="rep-add" data-key="' + key + '">' + icon('plus', 15) + esc(addLabel) + '</button>'
      );
    }

    function renderStory() {
      desc('story', 'What customers read on the product page.');
      const len = (p.description || '').length;
      body('story').innerHTML =
        '<div class="form-grid">' +
        ui.field('Description', '<textarea class="input" id="f-desc" data-f="description" rows="6" placeholder="Construction, fabric, how it wears…">' + esc(p.description) + '</textarea>', {
          cls: 'span-2',
          for: 'f-desc',
          aside: '<span data-desc-count class="' + (len > DESC_SOFT_MAX ? 'is-over' : '') + '">' + len + ' / ' + DESC_SOFT_MAX + '</span>',
          hint: 'Format: a short introduction, an empty line, then lines like <code>**Fabric:** 240 g cotton</code>. <code>**bold**</code> and lines starting with <code>- </code> (bullets) are shown as such.' + (A.data.mode === 'server' ? ' <button type="button" class="link-btn" data-act="describe">' + icon('wand', 13) + ' Rewrite with Claude</button>' : ''),
        }) +
        '<div class="field span-2"><div class="label">Details</div><div data-rep-host="details">' + repList('details', 'e.g. Triple-needle felled seams', 'Add detail') + '</div><p class="hint">Shown as a <b>Details:</b> line under the description when it has none of its own.</p></div>' +
        ui.field('Materials', '<textarea class="input" id="f-materials" data-f="materials" rows="2" style="min-height:64px" placeholder="e.g. 100% cotton canvas, 12 oz">' + esc(p.materials) + '</textarea>', { cls: 'span-2', for: 'f-materials', hint: 'Shown as a <b>Fabric:</b> line when the description has none of its own.' }) +
        ui.field('Fit', '<textarea class="input" id="f-fit" data-f="fit" rows="2" style="min-height:64px" placeholder="e.g. Boxy and slightly cropped. Take your usual size.">' + esc(p.fit) + '</textarea>', { cls: 'span-2', for: 'f-fit' }) +
        ui.field('Lead time', '<input class="input" id="f-lead" data-f="leadTime" value="' + esc(p.leadTime) + '" placeholder="e.g. Ships in 3–5 working days">', { for: 'f-lead' }) +
        ui.field('Restock date', '<input class="input" id="f-restock" type="date" data-f="restockDate" data-type="date" value="' + esc(p.restockDate ? String(p.restockDate).slice(0, 10) : '') + '">', { for: 'f-restock', hint: 'Sold-out sizes show “Restocking” with this date.' }) +
        ui.field('Tags', '<div class="chip-input" data-tags>' + p.tags.map((t, i) => '<span class="chip chip--tag">' + esc(t) + '<button type="button" class="chip__x" data-act="tag-del" data-i="' + i + '" aria-label="Remove tag ' + esc(t) + '">' + icon('x', 12) + '</button></span>').join('') + '<input data-tag-input placeholder="' + (p.tags.length ? 'Add tag' : 'Type a tag and press Enter') + '" aria-label="Add tag"></div>', { hint: 'Used for search and related products.' }) +
        ui.field('Weight', '<div class="ig"><input class="input input--num" id="f-weight" type="number" min="0" step="0.05" data-f="weightKg" data-type="nnum" value="' + esc(p.weightKg == null ? '' : p.weightKg) + '" placeholder="—"><span class="ig__post">kg</span></div>', { for: 'f-weight', hint: 'Helps agents estimate shipping.' }) +
        '<div class="field span-2"><details class="adv"' + (p.seoTitle || p.seoDescription ? ' open' : '') + '><summary>' + icon('chevronRight', 14) + 'Search engines (optional)</summary><div class="adv__body form-grid">' +
        ui.field('Search title', '<input class="input" id="f-seo-title" data-f="seoTitle" maxlength="120" value="' + esc(p.seoTitle || '') + '" placeholder="' + esc(seoTitleDefault()) + '">', { cls: 'span-2', for: 'f-seo-title', aside: '<span data-seo-count="seoTitle">' + (p.seoTitle || '').length + ' / 60</span>', hint: 'Leave empty to use the product name, category and studio name.' }) +
        ui.field('Search description', '<textarea class="input" id="f-seo-desc" data-f="seoDescription" rows="2" maxlength="320" style="min-height:64px" placeholder="' + esc(seoDescDefault()) + '">' + esc(p.seoDescription || '') + '</textarea>', { cls: 'span-2', for: 'f-seo-desc', aside: '<span data-seo-count="seoDescription">' + (p.seoDescription || '').length + ' / 160</span>', hint: 'Leave empty to use the subtitle and description.' }) +
        '<div class="field span-2"><div class="label">Google preview</div><div class="example serp" data-seo-serp>' + serpHtml() + '</div></div>' +
        '</div></details></div>' +
        '</div>';
      ['details', 'care'].forEach((key) => attachRepSortable(key));
    }
    function seoTitleDefault() {
      const cat = (categories || []).find((c) => c.id === p.category);
      const brand = (init.settings && init.settings.brand && init.settings.brand.name) || 'Cola Studio';
      const t = cat ? (p.name || 'Product') + ' — ' + cat.name + ' | ' + brand : (p.name || 'Product') + ' | ' + brand;
      return t.length <= 65 ? t : (p.name || 'Product') + ' | ' + brand;
    }
    function seoDescDefault() {
      const parts = [];
      if (p.subtitle) parts.push(String(p.subtitle).trim().replace(/[.\s]+$/, '') + '.');
      if (p.description) parts.push(String(p.description).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^\s*[-•·]\s+/gm, '').replace(/\s+/g, ' ').trim());
      const t = parts.join(' ');
      return t.length > 160 ? t.slice(0, 157).replace(/\s+\S*$/, '') + '…' : t;
    }
    function serpHtml() {
      const title = (p.seoTitle || seoTitleDefault()).slice(0, 70);
      const d = p.seoDescription || seoDescDefault() || 'Add a description so search engines have something to show.';
      return '<div class="serp__title">' + esc(title) + '</div><div class="serp__url">' + esc((init.settings && init.settings.brand && init.settings.brand.domain) || 'colastudio.com') + ' › products › ' + esc(p.slug || 'new-product') + '</div><div class="serp__desc">' + esc(d.length > 165 ? d.slice(0, 162) + '…' : d) + '</div>';
    }
    function attachRepSortable(key) {
      const host = root.querySelector('[data-rep="' + key + '"]');
      if (!host) return;
      sortables.push(
        ui.sortable(host, {
          items: '.rep__row',
          handle: '.handle',
          axis: 'y',
          onEnd(order) {
            p[key] = order.map((i) => p[key][Number(i)]);
            rerenderRep(key);
            changed();
          },
        })
      );
    }
    function rerenderRep(key) {
      const host = root.querySelector('[data-rep-host="' + key + '"]');
      host.innerHTML = repList(key, key === 'details' ? 'e.g. Triple-needle felled seams' : 'e.g. Cold hand wash only', key === 'details' ? 'Add detail' : 'Add care line');
      attachRepSortable(key);
    }
    function rerenderTags() {
      const host = root.querySelector('[data-tags]');
      const focus = document.activeElement && document.activeElement.matches('[data-tag-input]');
      host.innerHTML = p.tags.map((t, i) => '<span class="chip chip--tag">' + esc(t) + '<button type="button" class="chip__x" data-act="tag-del" data-i="' + i + '" aria-label="Remove tag ' + esc(t) + '">' + icon('x', 12) + '</button></span>').join('') + '<input data-tag-input placeholder="' + (p.tags.length ? 'Add tag' : 'Type a tag and press Enter') + '" aria-label="Add tag">';
      if (focus) host.querySelector('[data-tag-input]').focus();
    }

    /* ---------------------------------------------------------- options */

    function renderOptions() {
      desc('options', 'Every colour × size becomes a variant with its own stock.');
      body('options').innerHTML =
        '<div class="ed-sub__title mt-0">Colours <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:400">' + esc(A.plural(p.colors.length, 'colour')) + '</span></div>' +
        '<div class="rep" data-colors>' +
        (p.colors.length
          ? p.colors
              .map((c) => {
                const vs = p.variants.filter((v) => v._ck === c._k);
                return (
                  '<div class="color-row" data-sort-id="' + c._k + '"><button type="button" class="handle" aria-label="Drag to reorder" tabindex="-1">' + icon('grip', 16) + '</button>' +
                  '<input type="color" class="color-input" data-color="hex-pick" data-k="' + c._k + '" value="' + esc(/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#8F857A') + '" aria-label="Colour swatch for ' + esc(c.name || 'colour') + '">' +
                  '<input class="input" data-color="name" data-k="' + c._k + '" value="' + esc(c.name) + '" placeholder="Colour name" aria-label="Colour name">' +
                  '<input class="input mono color-hex" data-color="hex" data-k="' + c._k + '" value="' + esc(c.hex) + '" placeholder="#000000" maxlength="9" aria-label="Hex value">' +
                  '<div class="row" style="gap:2px"><span class="count">' + esc(A.plural(units(vs), 'unit')) + '</span>' +
                  '<button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="color-del" data-k="' + c._k + '" aria-label="Remove colour ' + esc(c.name) + '">' + icon('trash', 15) + '</button></div></div>'
                );
              })
              .join('')
          : '<div class="rep__empty">No colours — variants are by size only.</div>') +
        '</div><button type="button" class="btn btn--sm btn--secondary rep__add" data-act="color-add">' + icon('plus', 15) + 'Add colour</button>' +
        '<div class="ed-sub"><div class="ed-sub__title">Sizes <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:400">Drag to reorder</span></div>' +
        '<div class="chip-input" data-sizes>' +
        p.sizes.map((s) => '<span class="chip chip--tag chip--sortable" data-sort-id="' + esc(s) + '">' + esc(s) + '<button type="button" class="chip__x" data-act="size-del" data-size="' + esc(s) + '" aria-label="Remove size ' + esc(s) + '">' + icon('x', 12) + '</button></span>').join('') +
        '<input data-size-input placeholder="' + (p.sizes.length ? 'Add size' : 'Type a size and press Enter') + '" aria-label="Add size" maxlength="40"></div>' +
        '<div class="size-presets"><span class="faint">Presets</span>' + A.SIZE_PRESETS.map((s) => '<button type="button" class="chip" data-act="size-preset" data-preset="' + s.id + '">' + esc(s.label) + '</button>').join('') + '</div></div>';

      sortables.push(
        ui.sortable(root.querySelector('[data-colors]'), {
          items: '.color-row',
          handle: '.handle',
          axis: 'y',
          onEnd(order) {
            p.colors = order.map((k) => p.colors.find((c) => c._k === k));
            regenAutoSkus();
            renderOptions();
            renderVariants();
            renderImages();
            changed();
          },
        })
      );
      sortables.push(
        ui.sortable(root.querySelector('[data-sizes]'), {
          items: '.chip--sortable',
          handle: '.chip--sortable',
          onEnd(order) {
            p.sizes = order;
            renderOptions();
            renderVariants();
            syncMeasureRows();
            renderMeasure();
            changed();
          },
        })
      );
    }

    async function addSize(raw) {
      const s = String(raw || '').trim().slice(0, 40);
      if (!s) return;
      if (p.sizes.some((x) => x.toLowerCase() === s.toLowerCase())) return ui.toast('Size “' + s + '” already exists', { type: 'info' });
      const wasEmpty = !p.sizes.length;
      p.sizes.push(s);
      if (wasEmpty) {
        for (const v of p.variants) {
          if (v.size !== '') continue;
          v.size = s;
          if (v._auto) v.sku = autoSku(v._ck, s);
        }
      }
      afterStructure();
      const inp = root.querySelector('[data-size-input]');
      if (inp) inp.focus();
    }

    async function removeSizes(list, opts) {
      const doomed = p.variants.filter((v) => list.includes(String(v.size)));
      const u = units(doomed);
      if (doomed.length && (u > 0 || (!isNew && !(opts && opts.silent)))) {
        const ok = await ui.confirm({
          title: list.length === 1 ? 'Remove size ' + list[0] + '?' : 'Remove ' + list.length + ' sizes?',
          body: 'This also deletes ' + esc(A.plural(doomed.length, 'variant')) + (u ? ' holding <b>' + esc(A.plural(u, 'unit')) + '</b> of stock' : '') + '. You can still discard your changes before saving.',
          confirmText: 'Remove',
          danger: true,
        });
        if (!ok) return false;
      }
      p.sizes = p.sizes.filter((s) => !list.includes(s));
      p.variants = p.variants.filter((v) => !list.includes(String(v.size)));
      if (!p.sizes.length) p.variants.forEach((v) => (v.size = ''));
      return true;
    }

    async function applyPreset(id) {
      const preset = A.SIZE_PRESETS.find((x) => x.id === id);
      if (!preset) return;
      const remove = p.sizes.filter((s) => !preset.sizes.includes(s));
      if (remove.length && !(await removeSizes(remove))) return;
      const wasEmpty = !p.sizes.length;
      const keep = preset.sizes.filter((s) => !p.sizes.includes(s));
      p.sizes = preset.sizes.slice();
      if (wasEmpty && keep.length) p.variants.forEach((v) => v.size === '' && (v.size = preset.sizes[0]));
      afterStructure();
    }

    function addColor() {
      const wasEmpty = !p.colors.length;
      const used = new Set(p.colors.map((c) => c.name.toLowerCase()));
      let name = 'New colour';
      for (let i = 2; used.has(name.toLowerCase()); i++) name = 'New colour ' + i;
      const c = { name, hex: '#8F857A', _k: newKey() };
      p.colors.push(c);
      if (wasEmpty) p.variants.forEach((v) => {
        if (v._ck === '') {
          v._ck = c._k;
          v.color = c.name;
        }
      });
      afterStructure();
      const inp = root.querySelector('[data-color="name"][data-k="' + c._k + '"]');
      if (inp) {
        inp.focus();
        inp.select();
      }
    }

    async function removeColor(k) {
      const c = colorOf(k);
      if (!c) return;
      const doomed = p.variants.filter((v) => v._ck === k);
      const u = units(doomed);
      if (doomed.length && (u > 0 || !isNew)) {
        const ok = await ui.confirm({
          title: 'Remove colour “' + c.name + '”?',
          body: 'This also deletes ' + esc(A.plural(doomed.length, 'variant')) + (u ? ' holding <b>' + esc(A.plural(u, 'unit')) + '</b> of stock' : '') + '. Images assigned to this colour are kept. You can still discard before saving.',
          confirmText: 'Remove colour',
          danger: true,
        });
        if (!ok) return;
      }
      p.colors = p.colors.filter((x) => x._k !== k);
      p.variants = p.variants.filter((v) => v._ck !== k);
      p.images.forEach((img) => img.color === c.name && (img.color = ''));
      if (previewColor === k) previewColor = null;
      regenAutoSkus();
      afterStructure();
    }

    function afterStructure() {
      syncVariants();
      syncMeasureRows();
      renderOptions();
      renderVariants();
      renderImages();
      renderMeasure();
      changed();
    }

    /* --------------------------------------------------------- variants */

    function renderVariants() {
      desc('variants', 'Stock per colour and size. Expand a row for SKUs, Weidian SKU ids and pre-order.');
      const total = units(p.variants);
      const headEl = head('variants');
      if (headEl.dataset.state !== String(advAll)) {
        headEl.dataset.state = String(advAll);
        headEl.innerHTML = '<button type="button" class="btn btn--sm btn--ghost" data-act="adv-all" aria-pressed="' + advAll + '">' + icon(advAll ? 'chevronDown' : 'chevronRight', 15) + (advAll ? 'Hide' : 'Show') + ' SKUs</button>';
      }
      if (!p.colors.length && !p.sizes.length) {
        body('variants').innerHTML = ui.empty({ icon: 'inventory', title: 'No variants yet', body: 'Add at least one colour or size above and the matrix appears here.', compact: true });
        return;
      }
      const cks = colorKeys();
      const sizes = sizeList();
      const st = (v) => A.stockStatus(v, p, settings);
      let html =
        '<div class="matrix-tools">' +
        '<label class="small muted" for="mx-set">Set all to</label><input class="input" id="mx-set" type="number" min="0" step="1" value="0" data-bulk-val="set"><button type="button" class="btn btn--sm btn--secondary" data-act="mx-set">Apply</button>' +
        '<span class="matrix-tools__sep" aria-hidden="true"></span>' +
        '<label class="small muted" for="mx-add">Add</label><input class="input" id="mx-add" type="number" step="1" value="5" data-bulk-val="add"><button type="button" class="btn btn--sm btn--secondary" data-act="mx-add">to all</button>' +
        '<span class="sp"></span><span class="small muted" data-mx-summary></span></div>' +
        '<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="mx-color" scope="col">' + (p.colors.length ? 'Colour' : 'Variant') + '</th>' +
        sizes.map((s) => '<th scope="col">' + esc(s || 'One size') + '</th>').join('') +
        '<th scope="col">Total</th></tr></thead><tbody>';
      for (const ck of cks) {
        const c = colorOf(ck);
        const open = advAll || advOpen.has(ck);
        const rowVs = sizes.map((s) => findVariant(ck, s));
        html +=
          '<tr><th class="mx-color" scope="row"><div class="mx-color__inner">' + (c ? '<span class="swatch swatch--lg" style="background:' + esc(c.hex || '#DDD3C4') + '"></span><span class="mx-color__name">' + esc(c.name || 'Unnamed') + '</span>' : '<span class="mx-color__name muted">All</span>') +
          '<button type="button" class="icon-btn icon-btn--sm mx-adv-btn" data-act="adv-toggle" data-ck="' + esc(ck) + '" aria-expanded="' + open + '" aria-label="Advanced fields for ' + esc(c ? c.name : 'variants') + '" title="SKUs, Weidian ids, pre-order">' + icon('chevronDown', 15) + '</button></div></th>' +
          rowVs
            .map((v) => {
              if (!v) return '<td>—</td>';
              const s = st(v);
              return '<td class="mx-cell mx-cell--' + s + '" data-cell="' + esc(v.sku) + '"><input class="mx-stock" type="number" min="0" step="1" inputmode="numeric" data-mx="stock" data-ck="' + esc(ck) + '" data-size="' + esc(v.size) + '" value="' + esc(v.stock) + '" aria-label="Stock ' + esc((c ? c.name + ' ' : '') + (v.size || '')) + '" title="' + esc(A.STOCK_LABEL[s]) + '"></td>';
            })
            .join('') +
          '<td class="mx-total" data-rowtotal="' + esc(ck) + '">' + units(rowVs.filter(Boolean)) + '</td></tr>';
        if (open) {
          html +=
            '<tr class="mx-adv"><th scope="row"><span class="mx-adv__label">SKU</span><span class="mx-adv__label" style="margin-top:20px">Weidian SKU id</span></th>' +
            rowVs
              .map((v) =>
                v
                  ? '<td><input class="input" data-mx="sku" data-ck="' + esc(ck) + '" data-size="' + esc(v.size) + '" value="' + esc(v.sku) + '" aria-label="SKU" spellcheck="false">' +
                    '<input class="input" style="margin-top:6px" data-mx="wsku" data-ck="' + esc(ck) + '" data-size="' + esc(v.size) + '" value="' + esc(v.weidianSkuId || '') + '" placeholder="—" aria-label="Weidian SKU id" spellcheck="false">' +
                    '<label class="mx-adv__pre"><input type="checkbox" class="check" data-mx="pre" data-ck="' + esc(ck) + '" data-size="' + esc(v.size) + '"' + (v.preorder ? ' checked' : '') + '>Pre-order</label></td>'
                  : '<td></td>'
              )
              .join('') +
            '<td><button type="button" class="link-btn" data-act="sku-regen" data-ck="' + esc(ck) + '">Reset SKUs</button></td></tr>';
        }
      }
      html += '</tbody><tfoot><tr><th class="mx-color" scope="row">Total</th>' + sizes.map((s) => '<td data-coltotal="' + esc(s) + '">' + units(p.variants.filter((v) => cks.includes(v._ck) && String(v.size) === String(s))) + '</td>').join('') + '<td data-grandtotal>' + total + '</td></tr></tfoot></table></div>';

      const orph = orphans();
      if (orph.length) {
        html +=
          '<div class="note note--warn orphans">' + icon('alert', 16) + '<div><p><b>' + esc(A.plural(orph.length, 'variant')) + ' outside the matrix</b> (' + esc(A.plural(units(orph), 'unit')) + '): ' +
          esc(orph.slice(0, 6).map((v) => [v.color, v.size].filter(Boolean).join(' / ') + ' (' + v.sku + ')').join(', ') + (orph.length > 6 ? '…' : '')) +
          '. They are kept until you remove them.</p><p style="margin-top:8px"><button type="button" class="btn btn--sm btn--secondary" data-act="orphans-del">Remove ' + esc(A.plural(orph.length, 'orphan variant')) + '</button></p></div></div>';
      }
      body('variants').innerHTML = html;
      updateMatrixSummary();
    }

    function updateMatrixSummary() {
      const el = root.querySelector('[data-mx-summary]');
      if (!el) return;
      const sts = p.variants.map((v) => A.stockStatus(v, p, settings));
      const n = (s) => sts.filter((x) => x === s).length;
      const parts = [A.plural(p.variants.length, 'variant'), A.num(units(p.variants)) + ' units'];
      if (n('low')) parts.push(n('low') + ' low');
      if (n('soldout') + n('restocking')) parts.push(n('soldout') + n('restocking') + ' sold out');
      if (n('preorder')) parts.push(n('preorder') + ' pre-order');
      el.textContent = parts.join(' · ');
    }

    function updateMatrixTotals() {
      const cks = colorKeys();
      for (const ck of cks) {
        const el = root.querySelector('[data-rowtotal="' + CSS.escape(ck) + '"]');
        if (el) el.textContent = units(p.variants.filter((v) => v._ck === ck && sizeList().map(String).includes(String(v.size))));
      }
      for (const s of sizeList()) {
        const el = root.querySelector('[data-coltotal="' + CSS.escape(s) + '"]');
        if (el) el.textContent = units(p.variants.filter((v) => cks.includes(v._ck) && String(v.size) === String(s)));
      }
      const g = root.querySelector('[data-grandtotal]');
      if (g) g.textContent = units(p.variants.filter((v) => cks.includes(v._ck)));
      A.$$('.mx-stock', root).forEach((inp) => {
        const v = findVariant(inp.dataset.ck, inp.dataset.size);
        if (!v) return;
        const s = A.stockStatus(v, p, settings);
        inp.parentElement.className = 'mx-cell mx-cell--' + s;
        inp.title = A.STOCK_LABEL[s];
      });
      updateMatrixSummary();
      A.$$('.color-row', root).forEach((row) => {
        const k = row.dataset.sortId;
        const cnt = row.querySelector('.count');
        if (cnt) cnt.textContent = A.plural(units(p.variants.filter((v) => v._ck === k)), 'unit');
      });
    }

    /* ----------------------------------------------------------- images */

    function renderImages() {
      desc('images', 'The first image is the cover. Without photos the site shows the illustration below.');
      const colorOpts = [{ value: '', label: 'All colours' }].concat(p.colors.map((c) => ({ value: c.name, label: c.name })));
      const firstColor = p.colors[0] || {};
      body('images').innerHTML =
        '<div class="drop" data-drop>' + icon('upload', 22) + '<span class="drop__text"><b>Drop images here</b> or</span><button type="button" class="btn btn--sm btn--secondary" data-act="img-browse">Browse files</button>' +
        '<span class="small faint" style="width:100%">' + (A.data.mode === 'server' ? 'JPG, PNG, WebP, GIF, AVIF or SVG · up to 8 MB each' : 'Demo mode: images are resized to 1600 px and stored in this browser') + '</span></div>' +
        '<div class="url-add"><input class="input" data-img-url placeholder="…or paste an image URL (https:// or /uploads/…)" aria-label="Image URL"><button type="button" class="btn btn--secondary" data-act="img-url">' + icon('link', 15) + 'Add</button></div>' +
        (p.images.length
          ? '<div class="imgs" data-imgs>' +
            p.images
              .map(
                (img, i) =>
                  '<div class="img-card" data-sort-id="' + i + '"><div class="img-card__media"><img src="' + esc(img.url) + '" alt="' + esc(img.alt || '') + '" loading="lazy">' +
                  '<div class="img-card__tools"><button type="button" class="handle" aria-label="Drag to reorder" tabindex="-1">' + icon('grip', 15) + '</button><button type="button" class="icon-btn icon-btn--danger" data-act="img-del" data-i="' + i + '" aria-label="Remove image">' + icon('trash', 15) + '</button></div>' +
                  (i === 0 ? '<span class="img-card__cover">Cover</span>' : '') + '</div>' +
                  '<div class="img-card__body"><input class="input input--sm" data-img="alt" data-i="' + i + '" value="' + esc(img.alt || '') + '" placeholder="Alt text" aria-label="Alt text">' +
                  '<select class="input input--sm" data-img="color" data-i="' + i + '" aria-label="Colour">' + ui.options(colorOpts, img.color || '') + '</select>' +
                  '<div class="row" style="justify-content:space-between"><span class="img-card__size">' + esc(String(img.url).startsWith('data:') ? 'Inline · ' + A.bytes(Math.round((img.url.length * 3) / 4)) : String(img.url).replace(/^.*\//, '').slice(0, 28)) + '</span>' +
                  '<span class="row" style="gap:0"><button type="button" class="icon-btn icon-btn--sm" data-act="img-left" data-i="' + i + '" aria-label="Move earlier"' + (i === 0 ? ' disabled' : '') + '>' + icon('chevronLeft', 14) + '</button><button type="button" class="icon-btn icon-btn--sm" data-act="img-right" data-i="' + i + '" aria-label="Move later"' + (i === p.images.length - 1 ? ' disabled' : '') + '>' + icon('chevronRight', 14) + '</button></span></div></div></div>'
              )
              .join('') +
            '</div>'
          : '') +
        detailHtml() +
        '<div class="ed-sub"><div class="ed-sub__title">Placeholder illustration</div>' +
        '<div class="img-fallback"><div class="img-fallback__art" data-fallback-art>' + A.garmentSvg(p.garment, { color: firstColor.hex || '#8F857A', print: p.print }) + '</div>' +
        '<div class="stack"><div class="garment-pick">' +
        ui.field('Garment type', '<select class="input" id="f-garment" data-f="garment">' + ui.options(A.GARMENTS.map((g) => ({ value: g, label: A.GARMENT_LABEL[g] || g })), p.garment) + '</select>', { for: 'f-garment' }) +
        ui.field('Print', '<select class="input" id="f-print" data-f="print" data-type="nullable">' + ui.options([{ value: '', label: 'None' }, { value: 'monogram', label: 'Monogram' }, { value: 'pocket', label: 'Pocket' }], p.print || '') + '</select>', { for: 'f-print' }) +
        '</div><p>' + (p.images.length ? 'Used for cards and the live-stock page whenever a photo is missing.' : 'No photos yet — the site draws this illustration in each colour.') + '</p></div></div></div>';

      const grid = root.querySelector('[data-imgs]');
      if (grid) {
        sortables.push(
          ui.sortable(grid, {
            items: '.img-card',
            handle: '.handle',
            onEnd(order) {
              p.images = order.map((i) => p.images[Number(i)]);
              renderImages();
              changed();
            },
          })
        );
      }
      const drop = root.querySelector('[data-drop]');
      ['dragenter', 'dragover'].forEach((ev) =>
        drop.addEventListener(ev, (e) => {
          if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
          e.preventDefault();
          drop.classList.add('is-over');
        })
      );
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => /^image\//.test(f.type));
        if (files.length) uploadFiles(files);
        else ui.toast('Drop image files (JPG, PNG, WebP…)', { type: 'info' });
      });
    }

    async function uploadFiles(files) {
      const drop = root.querySelector('[data-drop]');
      const text = drop && drop.querySelector('.drop__text');
      let done = 0;
      for (const f of files) {
        if (text) text.innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:-2px;margin-right:8px"></span>Uploading ' + (done + 1) + ' of ' + files.length + '…';
        if (A.data.mode === 'server' && f.size > 8 * 1024 * 1024 && !/^image\/(jpeg|png|webp|avif)$/.test(f.type)) {
          ui.toast(f.name + ' is larger than 8 MB', { type: 'error' });
          continue;
        }
        try {
          const r = await A.data.upload(f);
          p.images.push({ url: r.url, alt: p.name || '', color: '' });
          if (r.large) ui.toast(f.name + ' is still ' + A.bytes(r.bytes) + ' after resizing — browser storage holds about 5 MB in total', { type: 'warn' });
          done++;
        } catch (e) {
          ui.error(e, 'Upload failed for ' + f.name);
        }
      }
      renderImages();
      changed();
      if (done) ui.toast(A.plural(done, 'image') + ' added — save to keep ' + (done === 1 ? 'it' : 'them'));
    }

    /* ------------------------------------------------------ measurements */

    function syncMeasureRows() {
      const m = p.measurements;
      if (!m) return;
      const bySize = new Map((m.rows || []).map((r) => [String(r.size), r]));
      for (const r of m.rows || []) if (!p.sizes.includes(String(r.size))) measureCache[r.size] = r.values;
      const sizes = p.sizes.length ? p.sizes : ['OS'];
      m.rows = sizes.map((s) => {
        const r = bySize.get(String(s));
        if (r) return Object.assign({}, r, { values: m.columns.map((_, i) => (r.values && r.values[i] !== undefined ? r.values[i] : '')) });
        const cached = measureCache[s];
        return { size: s, values: m.columns.map((_, i) => (cached && cached[i] !== undefined ? cached[i] : '')) };
      });
    }

    function chartHtml() {
      if (!p.sizeChartImage) return '';
      return '<div class="chart-img"><a href="' + esc(p.sizeChartImage) + '" target="_blank" rel="noopener" class="chart-img__thumb"><img src="' + esc(p.sizeChartImage) + '" alt="Size chart photo" loading="lazy"></a><div class="stack--sm stack"><b>Size chart photo</b><p class="hint" style="margin:0">Shown on the product page under “Size &amp; fit”, next to the table below.</p><div><button type="button" class="btn btn--sm btn--ghost" data-act="chart-del">' + icon('trash', 15) + 'Remove photo</button></div></div></div>';
    }
    function detailHtml() {
      const list = p.detailImages || [];
      return (
        '<div class="ed-sub"><div class="ed-sub__title">Detail photos<span class="faint">' + (list.length ? esc(list.length) : '') + '</span></div>' +
        '<p class="hint" style="margin:-4px 0 12px">Photos from the seller’s description (the Weidian import adds them). They appear under “Detail photos” on the product page; mark the size chart so it shows with the measurements.</p>' +
        (list.length
          ? '<div class="dimgs">' +
            list
              .map((d, i) => {
                const chart = d.url === p.sizeChartImage;
                return '<div class="dimg' + (chart ? ' is-chart' : '') + '"><a class="dimg__media" href="' + esc(d.url) + '" target="_blank" rel="noopener"><img src="' + esc(d.url) + '" alt="" loading="lazy"></a>' +
                  '<div class="dimg__tools"><button type="button" class="btn btn--sm ' + (chart ? 'btn--primary' : 'btn--secondary') + '" data-act="dimg-chart" data-i="' + i + '" aria-pressed="' + chart + '">' + (chart ? icon('check', 14) + 'Size chart' : 'Size chart?') + '</button>' +
                  '<button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="dimg-del" data-i="' + i + '" aria-label="Remove detail photo">' + icon('trash', 14) + '</button></div></div>';
              })
              .join('') +
            '</div>'
          : '') +
        '<div class="url-add"><input class="input" data-dimg-url placeholder="Add a detail photo URL (https:// or /uploads/…)" aria-label="Detail photo URL"><button type="button" class="btn btn--secondary" data-act="dimg-url">' + icon('link', 15) + 'Add</button></div></div>'
      );
    }

    function renderMeasure() {
      desc('measurements', 'Garment measurements per size, shown in the size guide.');
      const m = p.measurements;
      head('measurements').innerHTML = m ? '<button type="button" class="btn btn--sm btn--ghost" data-act="m-remove">' + icon('trash', 15) + 'Remove chart</button>' : '';
      if (!m) {
        body('measurements').innerHTML = chartHtml() + ui.empty({
          icon: 'calendar',
          title: 'No size chart',
          body: 'Add one and the rows follow your sizes automatically. Columns start from a ' + esc(A.GARMENT_LABEL[p.garment] || 'garment') + ' template.',
          actions: '<button type="button" class="btn btn--secondary" data-act="m-add">' + icon('plus', 16) + 'Add size chart</button>',
          compact: true,
        });
        return;
      }
      body('measurements').innerHTML =
        chartHtml() +
        '<div class="row row--wrap" style="margin-bottom:14px"><span class="label mb-0">Unit</span>' + ui.segmented('m-unit', [{ value: 'cm', label: 'cm' }, { value: 'in', label: 'inches' }], m.unit || 'cm', 'data-m-unit aria-label="Unit"') +
        '<span class="sp"></span><button type="button" class="btn btn--sm btn--secondary" data-act="m-col-add">' + icon('plus', 15) + 'Column</button></div>' +
        '<div class="measure-wrap"><table class="measure"><thead><tr><th style="text-align:left;padding-left:14px" class="small muted">Size</th>' +
        m.columns
          .map(
            (c, ci) =>
              '<th><div class="mcol"><input class="input" data-m="col" data-ci="' + ci + '" value="' + esc(c) + '" aria-label="Column name">' +
              '<button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="m-col-del" data-ci="' + ci + '" aria-label="Remove column ' + esc(c) + '">' + icon('x', 14) + '</button></div></th>'
          )
          .join('') +
        '</tr></thead><tbody>' +
        (m.rows || [])
          .map(
            (r) =>
              '<tr><th scope="row">' + esc(r.size) + '</th>' +
              m.columns.map((_, ci) => '<td><input class="input" inputmode="decimal" data-m="val" data-size="' + esc(r.size) + '" data-ci="' + ci + '" value="' + esc(r.values[ci] == null ? '' : r.values[ci]) + '" aria-label="' + esc(r.size + ' ' + m.columns[ci]) + '"></td>').join('') +
              '</tr>'
          )
          .join('') +
        '</tbody></table></div><p class="hint">Rows follow the sizes above. Values in ' + esc(m.unit === 'in' ? 'inches' : 'centimetres') + '; use ½ columns for flat measurements.</p>';
    }

    /* ------------------------------------------------------------ links */

    function renderLinks() {
      desc('links', 'Where customers order: the Weidian item and per-agent links.');
      const w = p.weidian;
      const agents = settings.agents || [];
      body('links').innerHTML =
        '<div class="form-grid">' +
        ui.field('Weidian item ID', '<input class="input mono" id="f-witem" data-f="weidian.itemId" value="' + esc(w.itemId) + '" placeholder="e.g. 7781234567" spellcheck="false" style="font-size:13px">', { for: 'f-witem', hint: 'Paste the number from weidian.com/item.html?itemID=… — or the whole link.' }) +
        ui.field('Weidian URL', '<input class="input" id="f-wurl" data-f="weidian.url" value="' + esc(w.url) + '" placeholder="Built from the item ID" spellcheck="false">', { for: 'f-wurl', hint: '<span data-wurl-hint></span>' }) +
        '<div class="field">' + ui.toggle('data-f="weidian.syncEnabled" data-type="bool"', !!w.syncEnabled, 'Sync stock from Weidian', 'Stock follows Weidian on every scheduled sync') + '</div>' +
        '<div class="field">' + ui.toggle('data-f="weidian.syncInfo" data-type="bool"', !!w.syncInfo, 'Sync info', 'Also take over price, title and photos (photos only when empty)') + '</div>' +
        '<div class="field span-2"><div class="row row--wrap small muted">' + icon('clock', 15) + '<span>Last synced: <b style="color:var(--cola);font-weight:500">' + esc(w.lastSyncedAt ? A.dateTime(w.lastSyncedAt) + ' (' + A.ago(w.lastSyncedAt) + ')' : 'never') + '</b></span>' +
        (w.title ? '<span>· Weidian title: ' + esc(w.title) + '</span>' : '') +
        (A.data.caps.weidian ? '<span class="sp"></span><button type="button" class="btn btn--sm btn--secondary" data-act="weidian-test">' + icon('sync', 15) + 'Test this item</button>' : '') +
        '</div></div>' +
        '</div>' +
        '<div class="ed-sub"><div class="ed-sub__title">Agent links <a class="card-link" style="text-transform:none;letter-spacing:0" href="' + A.href('/settings?section=agents') + '">Manage agents' + icon('chevronRight', 13) + '</a></div>' +
        (agents.length
          ? agents
              .map(
                (a) =>
                  '<div class="agent-row"><div class="agent-row__name">' + esc(a.name || a.id) + (a.recommended ? '<span class="pill pill--outline">Recommended</span>' : '') + (a.enabled === false ? '<span class="pill pill--archived">Disabled</span>' : '') + '</div>' +
                  '<div><input class="input" data-agent="' + esc(a.id) + '" value="' + esc(p.agentLinks[a.id] || '') + '" placeholder="Uses the agent template" aria-label="Link override for ' + esc(a.name || a.id) + '" spellcheck="false">' +
                  '<p class="hint" data-agent-hint="' + esc(a.id) + '"></p></div></div>'
              )
              .join('')
          : '<div class="rep__empty">No agents configured. Add them in Settings → Agents.</div>') +
        '</div>';
      renderLinkHints();
    }

    function renderLinkHints() {
      const gen = A.weidianUrl({ weidian: { itemId: p.weidian.itemId } }, settings);
      const hint = root.querySelector('[data-wurl-hint]');
      const urlInput = root.querySelector('#f-wurl');
      if (urlInput) urlInput.placeholder = gen || 'Built from the item ID';
      if (hint) {
        if (p.weidian.url) hint.innerHTML = 'Custom URL · <a href="' + esc(p.weidian.url) + '" target="_blank" rel="noopener">open</a>';
        else if (gen) hint.innerHTML = 'Will be saved as <code>' + esc(gen) + '</code>';
        else hint.textContent = 'Leave empty to build it from the item ID.';
      }
      const weidianUrl = A.weidianUrl(p, settings);
      for (const a of settings.agents || []) {
        const el = root.querySelector('[data-agent-hint="' + CSS.escape(a.id) + '"]');
        if (!el) continue;
        const override = p.agentLinks[a.id];
        if (override) {
          el.innerHTML = 'Override in use · <a href="' + esc(override) + '" target="_blank" rel="noopener">open</a>';
        } else if (!a.urlTemplate) {
          el.innerHTML = 'No URL template for this agent — add one in <a href="' + A.href('/settings?section=agents') + '">Settings</a> or paste a link here.';
        } else if (!weidianUrl && /\{weidianUrl\}|\{itemId\}/.test(a.urlTemplate)) {
          el.textContent = 'Add a Weidian item ID to generate this link.';
        } else {
          const url = A.fillTemplate(a.urlTemplate, { weidianUrl, itemId: p.weidian.itemId, slug: p.slug, name: p.name });
          el.innerHTML = 'Template gives <code>' + esc(url) + '</code>';
        }
        const inp = root.querySelector('[data-agent="' + CSS.escape(a.id) + '"]');
        if (inp) inp.placeholder = a.urlTemplate ? 'Uses the agent template' : 'Paste this agent’s product link';
      }
    }

    /* ---------------------------------------------------------- preview */

    function renderPreview() {
      const el = root.querySelector('.preview');
      if (!el) return;
      const cur = (settings.currency && settings.currency.default) || 'EUR';
      const conv = A.convert(Number(p.price) || 0, cur, settings);
      const convWas = p.compareAt ? A.convert(Number(p.compareAt), cur, settings) : null;
      const color = colorOf(previewColor) || p.colors[0] || null;
      const vsColor = color ? p.variants.filter((v) => v._ck === color._k) : p.variants;
      const avail = A.availability({ variants: vsColor, restockDate: p.restockDate }, settings);
      const total = units(p.variants);
      const badges = p.badges.map((b) => '<span class="pbadge' + (b === 'new' ? ' pbadge--dark' : '') + '">' + esc(A.BADGE_LABEL[b] || b) + '</span>').join('');
      const media = A.productThumb(Object.assign({}, p, { colors: p.colors }), { color: color ? color.name : null });
      const availLabel = avail === 'restocking' && p.restockDate ? 'Restocking ' + A.date(p.restockDate, false) : A.STOCK_LABEL[avail];

      const checks = [];
      const add = (tone, text, sec) => checks.push({ tone, text, sec });
      if (!p.name.trim()) add('err', 'Add a product name', 'basics');
      if (!(Number(p.price) > 0)) add('warn', 'Price is 0', 'pricing');
      if (!p.category) add('warn', 'No category selected', 'basics');
      if (!p.description.trim()) add('warn', 'Description is empty', 'story');
      if (!p.variants.length) add('err', 'No variants — add colours or sizes', 'options');
      const outN = p.variants.filter((v) => ['soldout', 'restocking'].includes(A.stockStatus(v, p, settings))).length;
      if (p.variants.length && outN === p.variants.length) add('warn', 'Every variant is sold out', 'variants');
      else if (outN) add('ok', A.plural(outN, 'variant') + ' sold out', 'variants');
      if (!p.images.length) add('ok', 'No photos — the illustration is shown', 'images');
      if (!p.weidian.itemId && !p.weidian.url) add('warn', 'No Weidian link for agents', 'links');
      if (p.status !== 'published') add('warn', p.status === 'draft' ? 'Draft — not visible on the site' : 'Archived — hidden from the site', 'basics');
      if (!checks.some((c) => c.tone !== 'ok')) add('ok', 'Ready to publish', null);

      el.innerHTML =
        '<div class="preview__label"><span>Live preview</span><span class="faint" style="letter-spacing:.04em;text-transform:none">' + esc(cur) + '</span></div>' +
        '<div class="pcard"><div class="pcard__media">' + media + (badges ? '<div class="pcard__badges">' + badges + '</div>' : '') + (p.status !== 'published' ? '<span class="pcard__status">' + A.statusPill(p.status) + '</span>' : '') + '</div>' +
        '<div class="pcard__body"><div class="pcard__name">' + esc(p.name || 'Product name') + '</div>' + (p.subtitle ? '<div class="pcard__sub">' + esc(p.subtitle) + '</div>' : '') +
        '<div class="pcard__price"><b>' + esc(conv == null ? A.money(p.price || 0, 'CNY') : A.money(conv, cur)) + '</b>' + (convWas && p.compareAt > p.price ? '<s>' + esc(A.money(convWas, cur)) + '</s>' : '') + '<span>' + esc(A.money(Number(p.price) || 0, 'CNY')) + '</span></div>' +
        (p.colors.length ? '<div class="pcard__swatches">' + p.colors.map((c) => '<button type="button" class="pcard__sw' + (color && c._k === color._k ? ' is-on' : '') + '" style="background:' + esc(c.hex || '#DDD3C4') + '" data-pv-color="' + c._k + '" title="' + esc(c.name) + '" aria-label="Preview ' + esc(c.name) + '"></button>').join('') + '</div>' : '') +
        (p.sizes.length
          ? '<div class="pcard__sizes">' +
            p.sizes
              .map((s) => {
                const v = color ? findVariant(color._k, s) : p.variants.find((x) => String(x.size) === String(s));
                const st = v ? A.stockStatus(v, p, settings) : 'soldout';
                return '<span class="psize' + (st === 'low' ? ' psize--low' : st === 'soldout' || st === 'restocking' ? ' psize--out' : st === 'preorder' ? ' psize--pre' : '') + '" title="' + esc((v ? v.stock : 0) + ' in stock') + '">' + esc(s) + '</span>';
              })
              .join('') +
            '</div>'
          : '') +
        '<div class="pcard__stock"><span class="row" style="gap:7px">' + A.stockDot(avail) + esc(availLabel) + (color ? '<span class="faint">· ' + esc(color.name) + '</span>' : '') + '</span><span class="faint tnum">' + esc(A.num(total)) + ' total</span></div>' +
        '</div></div>' +
        '<ul class="checks" aria-label="Checklist">' + checks.map((c) => '<li class="' + c.tone + '">' + icon(c.tone === 'ok' ? 'check' : c.tone === 'err' ? 'alert' : 'info', 15) + (c.sec ? '<button type="button" data-goto="' + c.sec + '">' + esc(c.text) + '</button>' : '<span>' + esc(c.text) + '</span>') + '</li>').join('') + '</ul>';
    }
    const schedulePreview = A.frame(renderPreview);

    /* ---------------------------------------------------------- savebar */

    function renderSavebar() {
      const bar = root.querySelector('[data-savebar]');
      const dirty = !isNew && snapshot() !== baseline;
      bar.className = 'savebar' + (dirty ? ' is-dirty' : '') + (isNew ? ' is-new' : '');
      const status = isNew ? 'New product — not saved yet' : dirty ? 'Unsaved changes' : 'All changes saved' + (p.updatedAt ? ' · ' + A.ago(p.updatedAt) : '');
      bar.innerHTML =
        '<span class="savebar__status" aria-live="polite">' + esc(status) + '</span>' +
        '<div class="savebar__actions">' +
        (dirty ? '<button type="button" class="btn btn--ghost" data-act="discard">Discard</button>' : '') +
        '<button type="button" class="btn btn--secondary" data-act="save-view" title="' + (isNew ? 'Create and view on site' : 'Save and view on site') + '"><span class="hide-sm">' + (isNew ? 'Create & view' : 'Save & view') + '</span>' + icon('external', 15) + '</button>' +
        '<button type="button" class="btn btn--primary" data-act="save"' + (!isNew && !dirty ? ' disabled' : '') + '>' + icon('check', 16) + (isNew ? 'Create product' : 'Save') + '<kbd>' + (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘S' : 'Ctrl S') + '</kbd></button>' +
        '</div>';
    }
    let lastDirty = null;
    function updateDirty() {
      const dirty = isNew || snapshot() !== baseline;
      if (dirty !== lastDirty) {
        lastDirty = dirty;
        renderSavebar();
      }
    }

    function changed() {
      schedulePreview();
      updateDirty();
      renderHeaderMeta();
    }
    function renderHeaderMeta() {
      const meta = root.querySelector('[data-meta]');
      if (meta && !isNew) meta.innerHTML = esc(p.id) + '<br>' + esc(A.plural(p.variants.length, 'variant')) + ' · ' + esc(A.plural(p.images.length, 'image'));
    }

    /* ---------------------------------------------------------- binding */

    function readValue(t) {
      const type = t.dataset.type;
      if (type === 'bool') return t.checked;
      if (type === 'num') return t.value === '' ? null : Number(t.value);
      if (type === 'nnum') return t.value === '' ? null : Number(t.value);
      if (type === 'date') return t.value || null;
      if (type === 'nullable') return t.value || null;
      return t.value;
    }

    function onInput(e) {
      const t = e.target;
      if (t.dataset.f) {
        const path = t.dataset.f;
        const old = A.getPath(p, path);
        let val = readValue(t);
        if (path === 'weidian.itemId' && typeof val === 'string') {
          const m = /itemID=(\d+)/i.exec(val) || /weidian\.com\/item\/(\d+)/i.exec(val);
          if (m) {
            if (!p.weidian.url && /^https?:/i.test(val)) {
              p.weidian.url = val.trim();
              const u = root.querySelector('#f-wurl');
              if (u) u.value = p.weidian.url;
            }
            val = m[1];
            t.value = val;
          }
        }
        A.setPath(p, path, val);
        onField(path, old);
        return changed();
      }
      if (t.name === 'status' && t.type === 'radio') {
        p.status = t.value;
        const f = root.querySelector('[data-status-field] .hint');
        if (f) f.textContent = p.status === 'published' ? 'Visible on the site.' : p.status === 'draft' ? 'Hidden from the site until you publish.' : 'Hidden from the site and from stock counts.';
        return changed();
      }
      if (t.dataset.list) {
        p[t.dataset.list][Number(t.dataset.i)] = t.value;
        return changed();
      }
      if (t.dataset.color) {
        const c = colorOf(t.dataset.k);
        if (!c) return;
        const kind = t.dataset.color;
        if (kind === 'name') {
          const oldName = c.name;
          c.name = t.value;
          p.variants.forEach((v) => v._ck === c._k && (v.color = c.name));
          p.images.forEach((img) => img.color === oldName && (img.color = c.name));
          regenAutoSkus();
          refreshColorDependents();
        } else if (kind === 'hex-pick') {
          c.hex = t.value.toUpperCase();
          const hx = root.querySelector('[data-color="hex"][data-k="' + c._k + '"]');
          if (hx) hx.value = c.hex;
          refreshColorDependents(true);
        } else if (kind === 'hex') {
          let v = t.value.trim();
          if (v && v[0] !== '#') v = '#' + v;
          c.hex = v;
          if (/^#[0-9a-f]{6}$/i.test(v)) {
            const pk = root.querySelector('[data-color="hex-pick"][data-k="' + c._k + '"]');
            if (pk) pk.value = v;
          }
          refreshColorDependents(true);
        }
        return changed();
      }
      if (t.dataset.mx) {
        const v = findVariant(t.dataset.ck, t.dataset.size);
        if (!v) return;
        const kind = t.dataset.mx;
        if (kind === 'stock') {
          const n = Math.max(0, Math.trunc(Number(t.value) || 0));
          v.stock = n;
          updateMatrixTotals();
        } else if (kind === 'sku') {
          v.sku = t.value.trim().toUpperCase();
          v._auto = false;
        } else if (kind === 'wsku') v.weidianSkuId = t.value.trim();
        else if (kind === 'pre') {
          v.preorder = t.checked;
          updateMatrixTotals();
        }
        return changed();
      }
      if (t.dataset.img) {
        const img = p.images[Number(t.dataset.i)];
        if (!img) return;
        img[t.dataset.img] = t.value;
        return changed();
      }
      if (t.dataset.agent !== undefined) {
        const val = t.value.trim();
        if (val) p.agentLinks[t.dataset.agent] = val;
        else delete p.agentLinks[t.dataset.agent];
        renderLinkHints();
        return changed();
      }
      if (t.dataset.m) {
        const m = p.measurements;
        if (!m) return;
        if (t.dataset.m === 'col') m.columns[Number(t.dataset.ci)] = t.value;
        else if (t.dataset.m === 'val') {
          const row = m.rows.find((r) => String(r.size) === t.dataset.size);
          if (row) {
            const raw = t.value.trim().replace(',', '.');
            row.values[Number(t.dataset.ci)] = raw === '' ? '' : Number.isFinite(Number(raw)) ? Number(raw) : t.value;
          }
        }
        return changed();
      }
      if (t.name === 'm-unit' && p.measurements) {
        changeUnit(t.value);
      }
    }

    function refreshColorDependents(hexOnly) {
      // matrix swatches/names + image colour selects + preview, without touching the focused colour row
      if (!hexOnly) {
        A.$$('[data-img="color"]', root).forEach((sel) => {
          const i = Number(sel.dataset.i);
          const cur = p.images[i] ? p.images[i].color : '';
          sel.innerHTML = ui.options([{ value: '', label: 'All colours' }].concat(p.colors.map((c) => ({ value: c.name, label: c.name }))), cur);
        });
      }
      const focus = document.activeElement;
      const inMatrix = focus && body('variants').contains(focus);
      if (!inMatrix) renderVariants();
      const art = root.querySelector('[data-fallback-art]');
      if (art) art.innerHTML = A.garmentSvg(p.garment, { color: (p.colors[0] && p.colors[0].hex) || '#8F857A', print: p.print });
    }

    function onField(path, old) {
      if (path === 'name') {
        if (!slugTouched && (isNew || !p.slug || p.slug === A.slugify(old))) {
          p.slug = A.slugify(p.name);
          const s = root.querySelector('#f-slug');
          if (s) s.value = p.slug;
        }
        const h1 = root.querySelector('[data-title]');
        h1.innerHTML = p.name ? '<b>' + esc(p.name) + '</b>' : isNew ? '<b>New</b> <span>product</span>' : '<b>Untitled</b>';
        ctxSetTitle();
        renderLinkHints();
      } else if (path === 'slug') {
        slugTouched = true;
        renderLinkHints();
      } else if (path === 'price' || path === 'compareAt') renderConv();
      else if (path === 'garment' || path === 'print') {
        const art = root.querySelector('[data-fallback-art]');
        if (art) art.innerHTML = A.garmentSvg(p.garment, { color: (p.colors[0] && p.colors[0].hex) || '#8F857A', print: p.print });
      } else if (path === 'weidian.itemId' || path === 'weidian.url') renderLinkHints();
      else if (path === 'restockDate') updateMatrixTotals();
      if (['seoTitle', 'seoDescription', 'name', 'subtitle', 'description', 'slug', 'category'].includes(path)) {
        const serp = root.querySelector('[data-seo-serp]');
        if (serp) serp.innerHTML = serpHtml();
        const cnt = root.querySelector('[data-seo-count="' + path + '"]');
        if (cnt) {
          const max = path === 'seoTitle' ? 60 : 160;
          const n = (p[path] || '').length;
          cnt.textContent = n + ' / ' + max;
          cnt.classList.toggle('is-over', n > max);
        }
      }
      if (path === 'description') {
        const c = root.querySelector('[data-desc-count]');
        if (c) {
          const n = (p.description || '').length;
          c.textContent = n + ' / ' + DESC_SOFT_MAX;
          c.classList.toggle('is-over', n > DESC_SOFT_MAX);
        }
      }
    }

    function onChange(e) {
      const t = e.target;
      if (t.id === 'f-slug') {
        p.slug = A.slugify(t.value);
        t.value = p.slug;
        changed();
      } else if (t.dataset.color === 'hex') {
        const c = colorOf(t.dataset.k);
        if (c && c.hex && !/^#[0-9a-f]{3,8}$/i.test(c.hex)) ui.toast('“' + c.hex + '” is not a valid hex colour', { type: 'warn' });
      }
    }

    async function changeUnit(unit) {
      const m = p.measurements;
      if (!m || m.unit === unit) return;
      const hasValues = m.rows.some((r) => r.values.some((v) => typeof v === 'number'));
      let convert = false;
      if (hasValues) {
        const r = await ui.dialog({
          title: 'Switch to ' + (unit === 'in' ? 'inches' : 'centimetres') + '?',
          body: '<p>Convert the existing numbers, or only change the unit label?</p>',
          buttons: [
            { id: 'cancel', label: 'Cancel', variant: 'ghost' },
            { id: 'label', label: 'Only change label', variant: 'secondary' },
            { id: 'convert', label: 'Convert values', variant: 'primary', autofocus: true },
          ],
        });
        if (!r || r.id === 'cancel') {
          renderMeasure();
          return;
        }
        convert = r.id === 'convert';
      }
      if (convert) {
        const f = unit === 'in' ? 1 / 2.54 : 2.54;
        const step = unit === 'in' ? 0.25 : 0.5;
        m.rows.forEach((r) => (r.values = r.values.map((v) => (typeof v === 'number' ? Math.round((v * f) / step) * step : v))));
      }
      m.unit = unit;
      renderMeasure();
      changed();
    }

    function onKeydown(e) {
      const t = e.target;
      if (t.matches('[data-tag-input]')) {
        if ((e.key === 'Enter' || e.key === ',') && t.value.trim()) {
          e.preventDefault();
          t.value
            .split(',')
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean)
            .forEach((tag) => !p.tags.includes(tag) && p.tags.push(tag));
          rerenderTags();
          changed();
        } else if (e.key === 'Enter') e.preventDefault();
        else if (e.key === 'Backspace' && !t.value && p.tags.length) {
          p.tags.pop();
          rerenderTags();
          changed();
        }
        return;
      }
      if (t.matches('[data-size-input]')) {
        if ((e.key === 'Enter' || e.key === ',') && t.value.trim()) {
          e.preventDefault();
          const vals = t.value.split(',').map((x) => x.trim()).filter(Boolean);
          t.value = '';
          vals.forEach((v) => addSize(v));
        } else if (e.key === 'Enter') e.preventDefault();
        return;
      }
      if (t.matches('.mx-stock') && (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const all = A.$$('.mx-stock', root);
        const i = all.indexOf(t);
        const cols = sizeList().length;
        let next = null;
        if (e.key === 'Enter') next = all[i + (e.shiftKey ? -1 : 1)];
        else next = all[i + (e.key === 'ArrowDown' ? cols : -cols)];
        if (next) {
          e.preventDefault();
          next.focus();
          next.select();
        }
        return;
      }
      if (t.matches('[data-img-url]') && e.key === 'Enter') {
        e.preventDefault();
        addImageUrl();
        return;
      }
      if (e.key === 'Enter' && t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'radio' && t.type !== 'submit') e.preventDefault(); // never submit the form
    }

    function addImageUrl() {
      const inp = root.querySelector('[data-img-url]');
      const url = (inp.value || '').trim();
      if (!url) return;
      if (!/^(https?:\/\/|\/|\.\.?\/|data:image\/)/i.test(url)) return ui.toast('Use a full https:// link or a site path like /uploads/photo.jpg', { type: 'error' });
      p.images.push({ url, alt: p.name || '', color: '' });
      inp.value = '';
      renderImages();
      changed();
    }

    async function onClick(e) {
      const goto = e.target.closest('[data-goto]');
      if (goto) {
        e.preventDefault();
        scrollToSection(goto.dataset.goto);
        return;
      }
      const sw = e.target.closest('[data-pv-color]');
      if (sw) {
        previewColor = sw.dataset.pvColor;
        renderPreview();
        return;
      }
      const badge = e.target.closest('[data-badge]');
      if (badge) {
        const b = badge.dataset.badge;
        const on = p.badges.includes(b);
        p.badges = on ? p.badges.filter((x) => x !== b) : A.BADGES.filter((x) => x === b || p.badges.includes(x));
        badge.setAttribute('aria-pressed', String(!on));
        changed();
        return;
      }
      if (e.target.closest('[data-tags]') && !e.target.closest('button')) {
        const ti = root.querySelector('[data-tag-input]');
        if (ti) ti.focus();
      }
      if (e.target.closest('[data-sizes]') && !e.target.closest('button, .chip')) {
        const si = root.querySelector('[data-size-input]');
        if (si) si.focus();
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      const i = Number(b.dataset.i);
      switch (act) {
        case 'slug-regen':
          p.slug = A.slugify(p.name);
          root.querySelector('#f-slug').value = p.slug;
          slugTouched = false;
          renderLinkHints();
          changed();
          break;
        case 'rep-add': {
          const key = b.dataset.key;
          p[key].push('');
          rerenderRep(key);
          const inputs = A.$$('[data-list="' + key + '"]', root);
          if (inputs.length) inputs[inputs.length - 1].focus();
          changed();
          break;
        }
        case 'rep-del':
          p[b.dataset.key].splice(i, 1);
          rerenderRep(b.dataset.key);
          changed();
          break;
        case 'rep-up':
        case 'rep-down': {
          const key = b.dataset.key;
          const j = act === 'rep-up' ? i - 1 : i + 1;
          if (j < 0 || j >= p[key].length) break;
          const arr = p[key];
          [arr[i], arr[j]] = [arr[j], arr[i]];
          rerenderRep(key);
          const btn = root.querySelector('[data-act="' + act + '"][data-key="' + key + '"][data-i="' + j + '"]');
          if (btn && !btn.disabled) btn.focus();
          else {
            const inp = root.querySelector('[data-list="' + key + '"][data-i="' + j + '"]');
            if (inp) inp.focus();
          }
          changed();
          break;
        }
        case 'tag-del':
          p.tags.splice(i, 1);
          rerenderTags();
          changed();
          break;
        case 'color-add':
          addColor();
          break;
        case 'color-del':
          await removeColor(b.dataset.k);
          break;
        case 'size-del':
          if (await removeSizes([b.dataset.size])) afterStructure();
          break;
        case 'size-preset':
          await applyPreset(b.dataset.preset);
          break;
        case 'adv-all':
          advAll = !advAll;
          if (!advAll) advOpen.clear();
          renderVariants();
          break;
        case 'adv-toggle': {
          const ck = b.dataset.ck;
          if (advAll) {
            advAll = false;
            colorKeys().forEach((k) => k !== ck && advOpen.add(k));
          } else if (advOpen.has(ck)) advOpen.delete(ck);
          else advOpen.add(ck);
          renderVariants();
          const again = root.querySelector('[data-act="adv-toggle"][data-ck="' + CSS.escape(ck) + '"]');
          if (again) again.focus();
          break;
        }
        case 'sku-regen':
          p.variants.forEach((v) => {
            if (v._ck === b.dataset.ck) {
              v._auto = true;
              v.sku = autoSku(v._ck, v.size);
            }
          });
          renderVariants();
          changed();
          break;
        case 'mx-set': {
          const n = Math.max(0, Math.trunc(Number(root.querySelector('[data-bulk-val="set"]').value) || 0));
          const cks = colorKeys();
          let cnt = 0;
          p.variants.forEach((v) => {
            if (cks.includes(v._ck)) {
              v.stock = n;
              cnt++;
            }
          });
          renderVariants();
          changed();
          ui.toast('Set ' + A.plural(cnt, 'variant') + ' to ' + n);
          break;
        }
        case 'mx-add': {
          const n = Math.trunc(Number(root.querySelector('[data-bulk-val="add"]').value) || 0);
          const cks = colorKeys();
          p.variants.forEach((v) => cks.includes(v._ck) && (v.stock = Math.max(0, (Number(v.stock) || 0) + n)));
          renderVariants();
          changed();
          ui.toast((n >= 0 ? 'Added ' + n + ' to' : 'Removed ' + Math.abs(n) + ' from') + ' every variant');
          break;
        }
        case 'orphans-del': {
          const orph = orphans();
          const u = units(orph);
          const ok = await ui.confirm({ title: 'Remove ' + A.plural(orph.length, 'orphan variant') + '?', body: 'These variants have no matching colour or size' + (u ? ' and hold <b>' + esc(A.plural(u, 'unit')) + '</b>' : '') + '. Save afterwards to make it permanent.', confirmText: 'Remove', danger: true });
          if (!ok) break;
          const set = new Set(orph);
          p.variants = p.variants.filter((v) => !set.has(v));
          renderVariants();
          changed();
          break;
        }
        case 'img-browse': {
          const files = await ui.pickFiles({ accept: 'image/*', multiple: true });
          if (files.length) uploadFiles(files);
          break;
        }
        case 'img-url':
          addImageUrl();
          break;
        case 'describe': {
          try {
            const r = await ui.busy(b, () => A.data.describeProducts([p.id || 'new'], { dryRun: true, source: p.descriptionOriginal || [p.description, ...(p.details || []), p.materials, ...(p.care || []), p.fit].filter(Boolean).join('\n'), title: p.name }), 'Writing…');
            const text = r.results && r.results[0] && r.results[0].description;
            if (!text) throw new Error((r.failed && r.failed[0] && r.failed[0].error) || 'No answer from Claude');
            if (!p.descriptionOriginal && p.description) p.descriptionOriginal = p.description;
            p.description = text;
            renderStory();
            changed();
            ui.toast('Description rewritten — check it and save');
          } catch (err) {
            ui.error(err, 'Could not rewrite');
          }
          break;
        }
        case 'dimg-url': {
          const inp = root.querySelector('[data-dimg-url]');
          const url = (inp.value || '').trim();
          if (!/^(https?:\/\/|\/)/.test(url)) {
            ui.toast('Paste a full image URL (https://…) or a /uploads/ path', { type: 'error' });
            inp.focus();
            break;
          }
          p.detailImages = (p.detailImages || []).concat({ url });
          renderImages();
          changed();
          break;
        }
        case 'dimg-del': {
          const list = p.detailImages || [];
          const gone = list[i];
          p.detailImages = list.filter((_, k) => k !== i);
          if (gone && gone.url === p.sizeChartImage) p.sizeChartImage = '';
          renderImages();
          renderMeasure();
          changed();
          break;
        }
        case 'dimg-chart': {
          const d = (p.detailImages || [])[i];
          if (!d) break;
          p.sizeChartImage = p.sizeChartImage === d.url ? '' : d.url;
          renderImages();
          renderMeasure();
          changed();
          if (p.sizeChartImage) ui.toast('Shown as the size chart on the product page');
          break;
        }
        case 'chart-del':
          p.sizeChartImage = '';
          renderImages();
          renderMeasure();
          changed();
          break;
        case 'img-del': {
          const img = p.images[i];
          p.images.splice(i, 1);
          renderImages();
          changed();
          ui.toast('Image removed', {
            action: {
              label: 'Undo',
              onClick: () => {
                p.images.splice(i, 0, img);
                renderImages();
                changed();
              },
            },
          });
          break;
        }
        case 'img-left':
        case 'img-right': {
          const j = act === 'img-left' ? i - 1 : i + 1;
          if (j < 0 || j >= p.images.length) break;
          [p.images[i], p.images[j]] = [p.images[j], p.images[i]];
          renderImages();
          changed();
          break;
        }
        case 'm-add':
          p.measurements = measureTemplate(p.garment, p.sizes);
          renderMeasure();
          changed();
          break;
        case 'm-remove': {
          const ok = await ui.confirm({ title: 'Remove the size chart?', body: 'All measurements for this product are cleared. You can still discard before saving.', confirmText: 'Remove chart', danger: true });
          if (!ok) break;
          p.measurements = null;
          renderMeasure();
          changed();
          break;
        }
        case 'm-col-add': {
          const m = p.measurements;
          m.columns.push('New column');
          m.rows.forEach((r) => r.values.push(''));
          renderMeasure();
          const inputs = A.$$('[data-m="col"]', root);
          const last = inputs[inputs.length - 1];
          if (last) {
            last.focus();
            last.select();
          }
          changed();
          break;
        }
        case 'm-col-del': {
          const m = p.measurements;
          const ci = Number(b.dataset.ci);
          const has = m.rows.some((r) => r.values[ci] !== '' && r.values[ci] != null);
          if (has && !(await ui.confirm({ title: 'Remove column “' + m.columns[ci] + '”?', body: 'Its values for every size are deleted.', confirmText: 'Remove column', danger: true }))) break;
          m.columns.splice(ci, 1);
          m.rows.forEach((r) => r.values.splice(ci, 1));
          renderMeasure();
          changed();
          break;
        }
        case 'weidian-test':
          await weidianTest(b);
          break;
        default:
          break;
      }
    }

    async function weidianTest(btn) {
      const itemId = (p.weidian.itemId || '').trim() || p.id;
      if (!itemId) return ui.toast('Add a Weidian item ID first', { type: 'info' });
      await ui.busy(btn, async () => {
        try {
          const r = await A.data.weidianTest(itemId);
          const matches = r.matches || [];
          const unm = r.unmatched || [];
          ui.drawer({
            title: 'Weidian test · ' + itemId,
            width: '680px',
            content:
              '<div class="stack"><p class="small muted">Provider <b>' + esc(r.provider) + '</b>' + (r.product ? ' · matched product <b>' + esc(r.product.name) + '</b>' : ' · no product has this item ID saved yet') + '. Nothing was changed.</p>' +
              (matches.length
                ? '<div class="card"><div class="card__head"><span class="card__title">Matched SKUs <span class="count">' + matches.length + '</span></span></div><div class="table-wrap"><table class="table"><thead><tr><th>Weidian</th><th>Variant</th><th class="num">Site</th><th class="num">Weidian</th><th>By</th></tr></thead><tbody>' +
                  matches.map((m) => '<tr><td>' + esc(m.title || m.skuId || '—') + '</td><td class="mono">' + esc(m.variant) + '</td><td class="num">' + esc(m.currentStock) + '</td><td class="num"><b>' + esc(m.stock) + '</b></td><td class="small muted">' + esc(m.matchedBy) + '</td></tr>').join('') +
                  '</tbody></table></div></div>'
                : '') +
              (unm.length ? '<div class="note note--warn">' + icon('alert', 16) + '<p><b>' + unm.length + ' unmatched:</b> ' + esc(unm.map((u) => u.title || u.sku || u.skuId).join(', ')) + '</p></div>' : '') +
              '<details class="adv"><summary>' + icon('chevronRight', 14) + 'Raw item data</summary><div class="adv__body"><pre class="json">' + esc(JSON.stringify(r.item || r, null, 2)) + '</pre></div></details></div>',
          });
        } catch (e) {
          ui.error(e, 'Weidian test failed');
        }
      }, 'Testing…');
    }

    async function onHeadClick(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'view') {
        if (p.status !== 'published') ui.toast('This product is a ' + p.status + ' — it is not visible on the site yet', { type: 'info' });
        window.open(A.productUrl(p), '_blank', 'noopener');
      } else if (act === 'duplicate') {
        if (snapshot() !== baseline && !(await ui.confirm({ title: 'Duplicate without your unsaved changes?', body: 'The copy is made from the last saved version. Save first to include your edits.', confirmText: 'Duplicate saved version' }))) return;
        try {
          const copy = await ui.busy(b, () => A.data.duplicateProduct(p.id));
          if (!copy) return;
          ui.toast('Duplicated as “' + copy.name + '” (draft)');
          leaving = true;
          A.go('/products/' + encodeURIComponent(copy.id));
        } catch (err) {
          ui.error(err, 'Could not duplicate');
        }
      } else if (act === 'delete') {
        const ok = await ui.confirm({ title: 'Delete “' + (p.name || p.id) + '”?', body: 'The product and its ' + esc(A.plural(p.variants.length, 'variant')) + ' are removed permanently. Archive it instead if you might bring it back.', confirmText: 'Delete product', danger: true });
        if (!ok) return;
        try {
          await A.data.deleteProduct(p.id);
          ui.toast('Deleted “' + (p.name || p.id) + '”');
          leaving = true;
          A.app.refreshBadges();
          A.go('/products');
        } catch (err) {
          ui.error(err, 'Could not delete');
        }
      }
    }

    function onSavebarClick(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'save') save();
      else if (b.dataset.act === 'save-view') save({ view: true });
      else if (b.dataset.act === 'discard') discard();
    }

    /* ---------------------------------------------------------- validate */

    function validate() {
      errors.clear();
      const problems = [];
      if (!p.name.trim()) {
        errors.set('basics', 'Name is required');
        problems.push({ sec: 'basics', msg: 'Add a product name', focus: '#f-name' });
      }
      if (p.price == null || !(Number(p.price) >= 0)) {
        errors.set('pricing', 'Price must be a number');
        problems.push({ sec: 'pricing', msg: 'Enter a price of 0 or more', focus: '#f-price' });
      }
      const names = p.colors.map((c) => c.name.trim().toLowerCase());
      const emptyColor = p.colors.find((c) => !c.name.trim());
      if (emptyColor) {
        errors.set('options', 'Colour without a name');
        problems.push({ sec: 'options', msg: 'Every colour needs a name', focus: '[data-color="name"][data-k="' + emptyColor._k + '"]' });
      }
      const dupColor = names.find((n, i) => n && names.indexOf(n) !== i);
      if (dupColor) {
        errors.set('options', 'Duplicate colour');
        problems.push({ sec: 'options', msg: 'Two colours are called “' + dupColor + '”' });
      }
      const skus = p.variants.map((v) => String(v.sku || '').trim().toUpperCase());
      const dupSku = skus.find((s, i) => s && skus.indexOf(s) !== i);
      if (dupSku) {
        errors.set('variants', 'Duplicate SKU');
        problems.push({ sec: 'variants', msg: 'SKU ' + dupSku + ' is used twice' });
        advAll = true;
      }
      const otherSlug = allProducts.find((x) => x.id !== p.id && x.slug && x.slug === A.slugify(p.slug || p.name));
      if (otherSlug && A.data.mode === 'static') {
        /* the data layer makes it unique; just tell the user */
        problems.push({ sec: 'basics', msg: 'Slug is taken by “' + otherSlug.name + '” — a number will be appended', soft: true });
      }
      SECTIONS.forEach((s) => {
        const f = root.querySelector('[data-flag="' + s.id + '"]');
        if (f) f.hidden = !errors.has(s.id);
      });
      return problems;
    }

    /* -------------------------------------------------------------- save */

    function rememberFocus() {
      const a = document.activeElement;
      if (!a || !root.contains(a)) return null;
      if (a.id) return '#' + CSS.escape(a.id);
      const attrs = ['data-f', 'data-list', 'data-i', 'data-color', 'data-k', 'data-mx', 'data-ck', 'data-size', 'data-img', 'data-agent', 'data-m', 'data-ci'];
      const sel = attrs.filter((x) => a.hasAttribute(x)).map((x) => '[' + x + '="' + CSS.escape(a.getAttribute(x)) + '"]').join('');
      return sel || null;
    }

    async function save(opts) {
      const o = opts || {};
      if (saving) return;
      if (!isNew && !o.view && snapshot() === baseline) {
        ui.toast('No changes to save', { type: 'info' });
        return;
      }
      const problems = validate();
      const hard = problems.filter((x) => !x.soft);
      if (hard.length) {
        if (errors.has('variants')) renderVariants();
        ui.toast(hard[0].msg + (hard.length > 1 ? ' (+' + (hard.length - 1) + ' more)' : ''), { type: 'error' });
        scrollToSection(hard[0].sec);
        if (hard[0].focus) {
          const f = root.querySelector(hard[0].focus);
          if (f) setTimeout(() => f.focus({ preventScroll: true }), 250);
        }
        return;
      }
      problems.filter((x) => x.soft).forEach((x) => ui.toast(x.msg, { type: 'info' }));
      // auto-fill the Weidian URL from the template when only an id is given
      if (p.weidian.itemId && !p.weidian.url) p.weidian.url = A.weidianUrl({ weidian: { itemId: p.weidian.itemId } }, settings);
      if (!p.slug) p.slug = A.slugify(p.name);
      const win = o.view ? ui.openLater() : null;
      saving = true;
      const btn = root.querySelector('[data-savebar] [data-act="' + (o.view ? 'save-view' : 'save') + '"]');
      const focusSel = rememberFocus();
      try {
        let saved;
        await ui.busy(btn, async () => {
          const payload = serialize();
          if (isNew) {
            saved = await A.data.createProduct(payload);
            // SKUs were generated with a predicted id — fix them if the server chose another one
            const from = A.idCode(predictedId);
            const to = A.idCode(saved.id);
            if (from && to && from !== to && saved.variants.some((v) => String(v.sku).startsWith(from + '-'))) {
              saved.variants = saved.variants.map((v) => (String(v.sku).startsWith(from + '-') ? Object.assign({}, v, { sku: to + String(v.sku).slice(from.length) }) : v));
              saved = await A.data.saveProduct(saved.id, saved);
            }
          } else saved = await A.data.saveProduct(p.id, payload);
        }, isNew ? 'Creating…' : 'Saving…');
        const wasNew = isNew;
        isNew = false;
        allProducts = await A.data.getProducts().catch(() => allProducts);
        load(saved);
        if (wasNew) A.router.replace('/products/' + encodeURIComponent(saved.id));
        renderAll();
        if (focusSel) {
          const f = root.querySelector(focusSel);
          if (f) f.focus({ preventScroll: true });
        }
        ui.toast(wasNew ? 'Created “' + saved.name + '”' : 'Saved “' + saved.name + '”');
        if (win) {
          if (saved.status !== 'published') ui.toast('Drafts are not visible on the public site — publish to see it there', { type: 'info' });
          win.go(A.productUrl(saved));
        }
        A.app.refreshBadges();
      } catch (e) {
        if (win) win.cancel();
        ui.error(e, 'Could not save');
      } finally {
        saving = false;
      }
    }

    async function discard() {
      const ok = await ui.confirm({ title: 'Discard unsaved changes?', body: 'The product goes back to its last saved version.', confirmText: 'Discard changes', danger: true });
      if (!ok) return;
      load(JSON.parse(baselineRaw));
      renderAll();
      ui.toast('Changes discarded');
    }

    /* ------------------------------------------------------------- setup */

    let baselineRaw = '';
    function load(src) {
      p = prepare(src);
      predictedId = p.id ? '' : nextIdGuess();
      markAutoSkus();
      syncVariants();
      syncMeasureRows();
      baseline = snapshot();
      baselineRaw = JSON.stringify(src);
      slugTouched = !isNew && !!p.slug;
      lastDirty = null;
    }

    function renderAll() {
      sortables.forEach((s) => s.destroy());
      sortables = [];
      renderHeader();
      renderBasics();
      renderPricing();
      renderStory();
      renderOptions();
      renderVariants();
      renderImages();
      renderMeasure();
      renderLinks();
      renderPreview();
      renderSavebar();
      SECTIONS.forEach((s) => {
        const f = root.querySelector('[data-flag="' + s.id + '"]');
        if (f) f.hidden = true;
      });
    }

    function scrollToSection(id) {
      const el = id === 'preview' ? root.querySelector('#sec-preview') : root.querySelector('#sec-' + id);
      if (!el) return;
      el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      setActive(id);
    }
    function setActive(id) {
      A.$$('.secnav__link', root).forEach((a) => a.classList.toggle('is-active', a.dataset.goto === id));
      const active = root.querySelector('.secnav__link.is-active');
      const nav = root.querySelector('.secnav');
      if (active && nav && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: active.offsetLeft - 24, behavior: 'smooth' });
    }

    function setupSpy() {
      if (!('IntersectionObserver' in window)) return;
      const visible = new Map();
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => visible.set(en.target.dataset.sec, en.isIntersecting ? en.boundingClientRect.top : null));
          let best = null;
          let bestTop = Infinity;
          for (const s of SECTIONS) {
            const top = visible.get(s.id);
            if (top != null && Math.abs(top) < bestTop) {
              best = s.id;
              bestTop = Math.abs(top);
            }
          }
          if (best) setActive(best);
        },
        { rootMargin: '-80px 0px -55% 0px', threshold: 0 }
      );
      A.$$('.ed-section', root).forEach((s) => observer.observe(s));
    }

    load(init.product);
    shell();
    renderAll();
    setActive('basics');
    setupSpy();

    const form = root.querySelector('form.ed-main');
    form.addEventListener('input', onInput);
    form.addEventListener('change', onChange);
    form.addEventListener('keydown', onKeydown);
    form.addEventListener('submit', (e) => e.preventDefault());
    root.querySelector('.editor').addEventListener('click', onClick);
    root.querySelector('[data-head-actions]').addEventListener('click', onHeadClick);
    root.querySelector('[data-savebar]').addEventListener('click', onSavebarClick);
    root.querySelector('.preview').addEventListener('click', onClick);

    if (init.ctx.query.section) setTimeout(() => scrollToSection(init.ctx.query.section), 60);
    else if (isNew) setTimeout(() => root.querySelector('#f-name').focus({ preventScroll: true }), 30);

    return {
      save: () => save(),
      isDirty: () => !leaving && (isNew ? snapshot() !== baseline : snapshot() !== baseline),
      async canLeave() {
        if (leaving) return true;
        const dirty = snapshot() !== baseline;
        if (!dirty) return true;
        const r = await ui.dialog({
          title: 'Leave without saving?',
          body: '<p>' + (isNew ? 'This new product has not been created yet.' : 'You have unsaved changes to “' + esc(p.name) + '”.') + '</p>',
          buttons: [
            { id: 'stay', label: 'Keep editing', variant: 'ghost', autofocus: true },
            { id: 'leave', label: 'Discard and leave', variant: 'danger' },
          ],
        });
        if (r && r.id === 'leave') {
          leaving = true;
          return true;
        }
        return false;
      },
      destroy() {
        if (observer) observer.disconnect();
        sortables.forEach((s) => s.destroy());
      },
    };
  }
})();
