/* ==========================================================================
   Cola Studio — Admin · Products list
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;
  const PREF_KEY = 'cola.admin.products.view';

  const SORTS = [
    { value: 'order', label: 'Manual order' },
    { value: 'name', label: 'Name A–Z' },
    { value: 'price-asc', label: 'Price: low to high' },
    { value: 'price-desc', label: 'Price: high to low' },
    { value: 'stock-asc', label: 'Stock: low to high' },
    { value: 'stock-desc', label: 'Stock: high to low' },
    { value: 'updated', label: 'Recently updated' },
  ];
  const STOCK_FILTERS = [
    { value: '', label: 'Any stock' },
    { value: 'instock', label: 'In stock' },
    { value: 'low', label: 'Has low stock' },
    { value: 'soldout', label: 'Has sold-out sizes' },
    { value: 'allout', label: 'Fully sold out' },
    { value: 'preorder', label: 'Pre-order' },
  ];

  /* ------------------------------------------------ spreadsheet import/export */

  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  async function sheetContext() {
    const [products, categories, settings] = await Promise.all([A.data.getProducts(), A.data.getCategories(), A.data.getSettings()]);
    return { products, categories, settings, garments: A.GARMENT_LABEL };
  }

  async function downloadSheet(template) {
    const ctx = await sheetContext();
    const bytes = A.xlsx.writeXlsx(A.productSheet.build(ctx, { template }));
    const name = template ? 'cola-studio-products-template.xlsx' : 'cola-studio-products-' + new Date().toISOString().slice(0, 10) + '.xlsx';
    ui.download(name, new Blob([bytes], { type: XLSX_TYPE }));
    ui.toast(template ? 'Template downloaded — fill it in and import it here' : 'Exported ' + A.plural(ctx.products.length, 'product') + ' to ' + name);
  }

  function issueList(list, cls) {
    const line = (w) => '<li><span class="imp-issue__where">' + esc(w.where || [w.sheet, w.row ? 'row ' + w.row : ''].filter(Boolean).join(' · ')) + '</span>' + esc(w.msg) + '</li>';
    const first = list.slice(0, 6).map(line).join('');
    const rest = list.slice(6).map(line).join('');
    return '<ul class="imp-issues ' + cls + '">' + first + (rest ? '<li class="imp-issues__more"><button type="button" class="link-btn" data-more-issues>Show ' + (list.length - 6) + ' more</button></li><span hidden data-rest>' + rest + '</span>' : '') + '</ul>';
  }

  function planBody(plan, source) {
    const c = plan.counts;
    const L = Object.assign({ create: 'New', update: 'Updated', unchanged: 'Unchanged', skipped: 'Skipped' }, plan.labels || {});
    const kpi = (label, value, mod) => '<div class="kpi imp-kpi' + (mod ? ' kpi--' + mod : '') + '"><span class="kpi__label">' + esc(label) + '</span><span class="kpi__value">' + value + '</span></div>';
    const items = plan.items
      .slice(0, 300)
      .map((i) => {
        const stock = (i.input.variants || []).reduce((n, v) => n + (Number(v.stock) || 0), 0);
        const sub =
          i.action === 'create'
            ? [(i.input.colors || []).length + ' × ' + (i.input.sizes || []).length + ' variants', A.num(stock) + ' in stock', i.input.status || 'draft'].join(' · ')
            : (i.stockOnly ? 'Stock only: ' : 'Changes: ') + i.changes.join(', ') + (i.matched === 'name' ? ' · matched by name' : '');
        return (
          '<li class="list__item"><span class="pill ' + (i.action === 'create' ? 'pill--new' : 'pill--outline') + '">' + (i.action === 'create' ? 'New' : 'Update') + '</span>' +
          '<span class="list__main"><span class="list__title">' + esc(i.name) + '</span><span class="list__sub">' + esc(sub) + '</span></span>' +
          '<span class="list__end">' + esc(i.ref || (i.id ? i.id + ' · ' : '') + 'row ' + i.row) + '</span></li>'
        );
      })
      .join('');
    const demoOnly = plan.missing.length && plan.missing.every((m) => m.demo);
    return (
      '<p class="imp-file">' + A.icon(plan.icon || 'sheet', 15) + esc(source) + '</p>' +
      '<div class="kpis imp-kpis">' + kpi(L.create, c.create) + kpi(L.update, c.update) + kpi(L.unchanged, c.unchanged, 'muted') + kpi(L.skipped, c.skipped, c.skipped ? 'out' : 'muted') + '</div>' +
      (plan.errors.length ? '<p class="imp-h">' + esc(A.plural(plan.errors.length, plan.unit || 'row') + ' could not be imported') + '</p>' + issueList(plan.errors, 'imp-issues--err') : '') +
      (plan.warnings.length ? '<p class="imp-h">' + esc(A.plural(plan.warnings.length, 'note')) + '</p>' + issueList(plan.warnings, 'imp-issues--warn') : '') +
      (items ? '<p class="imp-h">What will change</p><ul class="list imp-list">' + items + (plan.items.length > 300 ? '<li class="list__item list__sub">…and ' + (plan.items.length - 300) + ' more</li>' : '') + '</ul>' : '') +
      (plan.missing.length
        ? '<label class="imp-remove"><input type="checkbox" class="check" data-remove> <span><b>Also delete the ' + esc(A.plural(plan.missing.length, 'product')) + ' that are not in this file</b>' +
          '<span class="imp-remove__sub">' + esc(demoOnly ? 'These are all demo products — tick this to replace the demo catalogue with yours.' : plan.missing.slice(0, 4).map((m) => m.name).join(', ') + (plan.missing.length > 4 ? ' and ' + (plan.missing.length - 4) + ' more' : '') + '.') + '</span></span></label>'
        : '') +
      (plan.footnote ? '<p class="hint mb-0">' + plan.footnote + '</p>' : '') +
      (A.data.mode === 'server' ? '<p class="hint mb-0">A backup of the current catalogue is saved on the server first.</p>' : '<p class="hint mb-0">Demo mode: the import is saved in this browser only.</p>')
    );
  }

  async function importSheet(file, done) {
    let book;
    let plan;
    try {
      book = await A.xlsx.readFile(file);
      plan = A.productSheet.parse(book, await sheetContext());
    } catch (e) {
      ui.error(e, 'Could not read ' + file.name);
      return;
    }
    const todo = plan.items.length;
    if (!todo && !plan.errors.length && (!plan.missing.length || !plan.counts.unchanged)) {
      await ui.dialog({ title: 'Nothing to import', body: '<p>' + esc(plan.counts.examples && !plan.counts.unchanged ? 'This file only contains the example rows. Add your products on the Products sheet (rows with ID EXAMPLE are skipped) and import again.' : 'Every product in ' + file.name + ' already matches the shop.') + '</p>', buttons: [{ id: 'ok', label: 'OK', variant: 'primary' }] });
      return;
    }
    await confirmAndApply(plan, file.name, done);
  }

  /** Preview dialog + apply for a plan from the spreadsheet or the Weidian import. */
  async function confirmAndApply(plan, source, done) {
    const todo = plan.items.length;
    const label = (rm) => {
      const n = todo + (rm ? plan.missing.length : 0);
      return n ? 'Import ' + A.plural(todo, 'product') + (rm && plan.missing.length ? ' · delete ' + plan.missing.length : '') : 'Nothing to import';
    };
    const r = await ui.dialog({
      title: plan.title || 'Import products',
      size: 'lg',
      body: planBody(plan, source),
      buttons: [
        { id: 'cancel', label: 'Cancel', variant: 'ghost' },
        { id: 'import', label: label(false), variant: 'primary', autofocus: true },
      ],
      onOpen(el) {
        const btn = el.querySelector('[data-id="import"]');
        const box = el.querySelector('[data-remove]');
        const sync = () => {
          const rm = !!(box && box.checked);
          btn.textContent = label(rm);
          btn.disabled = !todo && !rm;
          btn.className = 'btn btn--' + (rm ? 'danger' : 'primary');
        };
        if (box) box.addEventListener('change', sync);
        el.addEventListener('click', (e) => {
          const more = e.target.closest('[data-more-issues]');
          if (!more) return;
          const ul = more.closest('ul');
          ul.querySelector('[data-rest]').outerHTML = ul.querySelector('[data-rest]').innerHTML;
          more.closest('li').remove();
        });
        sync();
      },
    });
    if (!r || r.id !== 'import') return;
    const remove = r.el.querySelector('[data-remove]') && r.el.querySelector('[data-remove]').checked ? plan.missing.map((m) => m.id) : [];
    const closeToast = ui.toast('Importing ' + A.plural(todo, 'product') + '…', { type: 'info', duration: 60000 });
    try {
      const res = await A.data.bulkProducts(plan.items, remove);
      closeToast();
      const parts = [];
      if (res.created.length) parts.push(res.created.length + ' new');
      if (res.updated.length) parts.push(res.updated.length + ' updated');
      if (res.removed) parts.push(res.removed + ' deleted');
      ui.toast('Import done: ' + (parts.join(', ') || 'no changes'), plan.after ? { duration: 7000 } : undefined);
      if (done) await done(res);
      if (plan.after) await plan.after(res);
    } catch (e) {
      closeToast();
      ui.error(e, 'Import failed — nothing was changed');
    }
  }

  async function pickAndImport(done) {
    const [file] = await ui.pickFiles({ accept: '.xlsx,.csv,.tsv,.txt,' + XLSX_TYPE + ',text/csv' });
    if (file) await importSheet(file, done);
  }

  /* --------------------------------------------------------- Weidian import */

  /** Same pattern as server/services/weidian-import.js → extractItemIds. */
  function extractItemIds(text) {
    const ids = [];
    const re = /item[_-]?id(?:%3[AD]|%22|["':=\s]|\\u0022)*(\d{6,14})|weidian\.com\/(?:[a-z]+\/)*item[^\d\s]{0,12}(\d{6,14})|(?:^|[\s,;])(\d{8,14})(?=$|[\s,;])/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const id = m[1] || m[2] || m[3];
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  // Runs on the person's own Weidian shop page: collects every item id on the page.
  const BOOKMARKLET =
    "(()=>{const ids=new Set();let m;const h=document.documentElement.innerHTML;const re=/item[_-]?id(?:%3[AD]|%22|[\"':=\\s]|\\\\u0022)*(\\d{6,14})/gi;while((m=re.exec(h)))ids.add(m[1]);" +
    "document.querySelectorAll('a[href]').forEach(a=>{const x=/itemI[Dd]=(\\d{6,14})/.exec(a.href);if(x)ids.add(x[1]);});" +
    "if(!ids.size){alert('No Weidian products found on this page. Open your shop and scroll down until all products are loaded.');return;}" +
    "const t=[...ids].map(i=>'https://weidian.com/item.html?itemID='+i).join('\\n');const ok=()=>alert(ids.size+' Weidian products copied. Paste them in the Cola Studio admin.');" +
    "navigator.clipboard?navigator.clipboard.writeText(t).then(ok,()=>prompt('Copy these links:',t)):prompt('Copy these links:',t);})();";

  /** Same note for many products → one line ("4 products: Title is in Chinese …"). */
  function groupNotes(drafts) {
    const by = new Map();
    for (const r of drafts) for (const msg of r.notes) by.set(msg, (by.get(msg) || []).concat(r.draft.name));
    return [...by].map(([msg, names]) => ({ where: names.length > 1 ? A.plural(names.length, 'product') : names[0].slice(0, 40), msg }));
  }

  async function weidianImport(done) {
    if (A.data.mode !== 'server') {
      await ui.dialog({
        title: 'Import from Weidian',
        body: '<p>Fetching products from Weidian runs on the Cola Studio server, so it works once the site is live (Railway). This demo runs in your browser only.</p><p>On the live site: paste product links here, check the preview, and they are added as drafts with stock sync switched on.</p>',
        buttons: [{ id: 'ok', label: 'OK', variant: 'primary' }],
      });
      return;
    }
    let integ = null;
    try {
      integ = await A.data.getIntegrations();
    } catch (e) {
      /* the dialog still works without the hints */
    }
    const cfg = (integ && (integ.config || integ.effective || integ)) || {};
    const wcfg = cfg.weidian || {};
    const tcfg = cfg.translation || {};
    const tKey = { anthropic: tcfg.anthropicKey, deepl: tcfg.deeplKey, google: tcfg.googleKey, libre: tcfg.libreUrl }[tcfg.provider || 'anthropic'];
    const canTranslate = !!tKey && tcfg.provider !== 'none';
    const badProvider = wcfg.provider === 'json-feed' || wcfg.provider === 'mock';
    const step1 = await ui.dialog({
      title: 'Import from Weidian',
      size: 'lg',
      body:
        (badProvider ? '<div class="note note--warn" style="margin-bottom:12px">' + icon('alert', 16) + '<p>Set <b>Integrations → Weidian → Provider</b> to “Public item page” (or Open API) first — the current provider cannot fetch products.</p></div>' : '') +
        '<p>Paste the links of your Weidian products — one per line, or any text that contains them. Item IDs work too.</p>' +
        '<textarea class="input input--code wd-links" rows="7" data-links placeholder="https://weidian.com/item.html?itemID=7781234567"></textarea>' +
        '<p class="hint mt-0" data-count>No products found yet.</p>' +
        '<details class="wd-shop"><summary>' + icon('sparkle', 14) + 'Grab every product of your shop at once</summary><ol class="wd-steps">' +
        '<li>Drag this button to your bookmarks bar: <a class="btn btn--sm btn--secondary wd-bookmarklet" href="javascript:' + esc(encodeURIComponent(BOOKMARKLET)) + '" onclick="return false" title="Drag me to the bookmarks bar">' + icon('link', 14) + 'Copy Weidian products</a></li>' +
        '<li>Open your Weidian shop in this browser and scroll down until every product has loaded.</li>' +
        '<li>Click the bookmark — all product links are copied. Paste them above.</li></ol></details>' +
        '<label class="imp-remove wd-translate"><input type="checkbox" class="check" data-translate' + (canTranslate ? ' checked' : ' disabled') + '> <span><b>Translate titles and colours to English</b><span class="imp-remove__sub">' +
        (canTranslate ? 'Uses the translation provider from Integrations.' : 'No translation key set up yet (Integrations → Translation), so Chinese titles are kept — you can rename them later.') + '</span></span></label>' +
        '<p class="hint mb-0">Nothing is saved until you confirm the preview. Products that are already linked to the same Weidian item are skipped.</p>',
      buttons: [
        { id: 'cancel', label: 'Cancel', variant: 'ghost' },
        { id: 'fetch', label: 'Fetch products', variant: 'primary' },
      ],
      validate(id, el) {
        if (id !== 'fetch') return true;
        return extractItemIds(el.querySelector('[data-links]').value).length > 0;
      },
      onOpen(el) {
        const ta = el.querySelector('[data-links]');
        const out = el.querySelector('[data-count]');
        const btn = el.querySelector('[data-id="fetch"]');
        const sync = () => {
          const n = extractItemIds(ta.value).length;
          out.textContent = n ? A.plural(n, 'Weidian product') + ' found' + (n > 300 ? ' — the first 300 are imported' : '') : 'No products found yet.';
          btn.textContent = n ? 'Fetch ' + A.plural(Math.min(n, 300), 'product') : 'Fetch products';
          btn.disabled = !n || badProvider;
        };
        ta.addEventListener('input', sync);
        sync();
        setTimeout(() => ta.focus(), 50);
      },
    });
    if (!step1 || step1.id !== 'fetch') return;
    const ids = extractItemIds(step1.el.querySelector('[data-links]').value).slice(0, 300);
    const translate = !!(step1.el.querySelector('[data-translate]') || {}).checked;

    // Step 2: fetch in batches of 5 with a progress bar.
    const results = [];
    let cancelled = false;
    let failure = null;
    await ui.dialog({
      title: 'Fetching from Weidian',
      body: '<p data-progress-text>Starting…</p><div class="meter"><div class="meter__bar" data-progress style="width:0%"></div></div><p class="hint">About 1–2 seconds per product. You can keep this tab open in the background.</p>',
      dismissable: false,
      buttons: [
        { id: 'cancel', label: 'Stop', variant: 'ghost' },
        { id: 'done', label: 'Continue', variant: 'primary' },
      ],
      onOpen(el) {
        const doneBtn = el.querySelector('[data-id="done"]');
        doneBtn.hidden = true;
        el.querySelector('[data-id="cancel"]').addEventListener('click', () => (cancelled = true));
        const txt = el.querySelector('[data-progress-text]');
        const bar = el.querySelector('[data-progress]');
        (async () => {
          for (let i = 0; i < ids.length && !cancelled; i += 5) {
            txt.textContent = 'Fetching ' + Math.min(i + 5, ids.length) + ' of ' + ids.length + '…';
            try {
              const r = await A.data.weidianImport(ids.slice(i, i + 5), translate);
              results.push(...(r.results || []));
            } catch (e) {
              failure = e;
              break;
            }
            bar.style.width = Math.round((Math.min(i + 5, ids.length) / ids.length) * 100) + '%';
          }
          if (!cancelled) doneBtn.click();
        })();
      },
    });
    if (failure && !results.length) {
      ui.error(failure, 'Weidian import');
      return;
    }
    if (!results.length) return;

    const drafts = results.filter((r) => r.draft);
    const plan = {
      title: 'Import from Weidian',
      icon: 'globe',
      unit: 'product',
      labels: { create: 'New drafts', update: 'Updated', unchanged: 'Already on site', skipped: 'Failed' },
      items: drafts.map((r) => ({ action: 'create', id: null, name: r.draft.name, input: r.draft, changes: [], ref: 'Weidian ' + r.itemId })),
      errors: results.filter((r) => !r.ok).map((r) => ({ where: 'Weidian ' + r.itemId, msg: r.error })).concat(failure ? [{ where: 'Stopped', msg: failure.message }] : []),
      warnings: groupNotes(drafts).concat(results.filter((r) => r.skipped).map((r) => ({ where: 'Weidian ' + r.itemId, msg: 'Already on the site as “' + r.existing.name + '” (' + r.existing.id + ') — skipped.' }))),
      missing: [],
      counts: { create: drafts.length, update: 0, unchanged: results.filter((r) => r.skipped).length, skipped: results.filter((r) => !r.ok).length },
      footnote: 'They are added as <b>drafts</b> with Weidian stock sync on. Check names, categories and photos, then publish them (select → Publish).' + (wcfg.enabled ? '' : ' Turn on <b>Integrations → Weidian → Enabled</b> to keep stock in sync automatically.'),
      after: async () => {
        A.go('/products?status=draft&sort=updated'); // show the new drafts first
        if (!wcfg.enabled) ui.toast('Tip: switch on Integrations → Weidian so stock stays in sync', { type: 'info', duration: 8000 });
      },
    };
    if (!plan.items.length) {
      await ui.dialog({ title: 'Nothing to import', body: planBody(plan, A.plural(ids.length, 'Weidian link')), buttons: [{ id: 'ok', label: 'OK', variant: 'primary' }] });
      return;
    }
    await confirmAndApply(plan, A.plural(ids.length, 'Weidian link'), done);
  }

  async function sheetMenu(anchor, done) {
    const act = await ui.menu(anchor, [
      { id: 'weidian', label: 'Import from Weidian…', icon: 'globe' },
      { id: 'import', label: 'Import spreadsheet…', icon: 'upload' },
      { sep: true },
      { id: 'export', label: 'Export products (.xlsx)', icon: 'download' },
      { id: 'template', label: 'Download empty template', icon: 'sheet' },
    ]);
    try {
      if (act === 'export') await downloadSheet(false);
      else if (act === 'template') await downloadSheet(true);
      else if (act === 'import') await pickAndImport(done);
      else if (act === 'weidian') await weidianImport(done);
    } catch (e) {
      ui.error(e, 'Import');
    }
  }
  A.productSheetUi = { downloadSheet, importSheet, pickAndImport, sheetMenu, weidianImport, extractItemIds };

  A.views.products = {
    title: 'Products',
    skeleton: 'table',
    async render(root, params, ctx) {
      const [products, categories, settings] = await Promise.all([A.data.getProducts(), A.data.getCategories(), A.data.getSettings()]);
      if (ctx.stale()) return;
      const saved = A.store.get(PREF_KEY, {}) || {};
      const st = {
        products,
        q: ctx.query.q || '',
        category: ctx.query.category || '',
        status: ctx.query.status || '',
        stock: ctx.query.stock || '',
        sort: ctx.query.sort || saved.sort || 'order',
        selected: new Set(),
      };
      const catName = (id) => (categories.find((c) => c.id === id) || {}).name || id || '—';
      const cur = (settings.currency && settings.currency.default) || 'EUR';

      root.innerHTML =
        '<header class="page-head"><div class="page-head__text"><h1 data-count></h1><p class="lead">Every garment in the catalogue — drafts and archived pieces included. Prices are stored in CNY.</p></div>' +
        '<div class="page-actions"><button type="button" class="btn btn--secondary" data-sheet aria-haspopup="menu">' + icon('upload', 16) + 'Import / export</button>' +
        '<a class="btn btn--secondary" href="' + A.href('/inventory') + '">' + icon('inventory', 16) + 'Inventory</a>' +
        '<a class="btn btn--primary" href="' + A.href('/products/new') + '">' + icon('plus', 16) + 'New product</a></div></header>' +
        '<div class="card">' +
        '<div class="toolbar">' +
        '<label class="search"><span class="sr-only" hidden>Search</span>' + icon('search', 16) + '<input class="input" type="search" placeholder="Search name, SKU, tag…" value="' + esc(st.q) + '" data-search data-f="q" aria-label="Search products"><kbd>/</kbd></label>' +
        '<select class="input" data-f="category" aria-label="Category"><option value="">All categories</option>' + ui.options(categories.map((c) => ({ value: c.id, label: c.name })), st.category) + '</select>' +
        '<select class="input" data-f="status" aria-label="Status">' + ui.options([{ value: '', label: 'Any status' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }], st.status) + '</select>' +
        '<select class="input" data-f="stock" aria-label="Stock">' + ui.options(STOCK_FILTERS, st.stock) + '</select>' +
        '<select class="input" data-f="sort" aria-label="Sort">' + ui.options(SORTS, st.sort) + '</select>' +
        '</div>' +
        '<div class="bulkbar" data-bulk hidden></div>' +
        '<div class="table-wrap"><table class="table products-table"><thead><tr>' +
        '<th class="shrink"><input type="checkbox" class="check" data-all aria-label="Select all"></th>' +
        '<th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Variants</th><th>Stock</th><th>Status</th><th>Updated</th><th class="shrink"><span hidden>Actions</span></th>' +
        '</tr></thead><tbody data-rows></tbody></table></div>' +
        '<div data-empty></div>' +
        '</div>';

      const $rows = root.querySelector('[data-rows]');
      const $bulk = root.querySelector('[data-bulk]');
      const $empty = root.querySelector('[data-empty]');
      const $all = root.querySelector('[data-all]');

      function stockState(p) {
        const sts = (p.variants || []).map((v) => A.stockStatus(v, p, settings));
        return {
          avail: A.availability(p, settings),
          low: sts.includes('low'),
          out: sts.includes('soldout') || sts.includes('restocking'),
          allOut: sts.length > 0 && sts.every((s) => s === 'soldout' || s === 'restocking'),
          pre: sts.includes('preorder'),
        };
      }

      function filtered() {
        const q = st.q.trim().toLowerCase();
        let list = st.products.filter((p) => {
          if (st.category && p.category !== st.category) return false;
          if (st.status && p.status !== st.status) return false;
          if (st.stock) {
            const s = stockState(p);
            if (st.stock === 'instock' && !(s.avail === 'instock' || s.avail === 'low')) return false;
            if (st.stock === 'low' && !s.low) return false;
            if (st.stock === 'soldout' && !s.out) return false;
            if (st.stock === 'allout' && !s.allOut) return false;
            if (st.stock === 'preorder' && !s.pre) return false;
          }
          if (q) {
            const hay = [p.name, p.subtitle, p.slug, p.id, p.collection, p.season, (p.tags || []).join(' '), (p.variants || []).map((v) => v.sku).join(' '), (p.colors || []).map((c) => c.name).join(' ')].join(' ').toLowerCase();
            if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
          }
          return true;
        });
        const by = {
          order: (a, b) => (a.order || 0) - (b.order || 0),
          name: (a, b) => a.name.localeCompare(b.name),
          'price-asc': (a, b) => a.price - b.price,
          'price-desc': (a, b) => b.price - a.price,
          'stock-asc': (a, b) => A.totalStock(a) - A.totalStock(b),
          'stock-desc': (a, b) => A.totalStock(b) - A.totalStock(a),
          updated: (a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0),
        }[st.sort];
        if (by) list = list.slice().sort(by);
        return list;
      }

      function row(p) {
        const s = stockState(p);
        const total = A.totalStock(p);
        const conv = A.convert(p.price, cur, settings);
        return (
          '<tr class="is-clickable' + (st.selected.has(p.id) ? ' is-selected' : '') + '" data-id="' + esc(p.id) + '">' +
          '<td class="shrink"><input type="checkbox" class="check" data-sel aria-label="Select ' + esc(p.name) + '"' + (st.selected.has(p.id) ? ' checked' : '') + '></td>' +
          '<td><div class="cell-main"><span class="thumb">' + A.productThumb(p) + '</span><div style="min-width:0"><a class="cell-title" href="' + A.href('/products/' + encodeURIComponent(p.id)) + '">' + esc(p.name) + (p.featured ? ' <span title="Featured" class="faint">' + icon('star', 13) + '</span>' : '') + '</a>' +
          '<span class="cell-sub">' + esc(p.subtitle || '/' + p.slug) + '</span>' +
          '<span class="cell-sub"><span class="mono">' + esc(p.id) + '</span>' + (p.season ? ' · ' + esc(p.season) : '') + '</span></div></div></td>' +
          '<td class="nowrap">' + esc(catName(p.category)) + '</td>' +
          '<td class="num nowrap"><b style="font-weight:500">' + esc(A.money(p.price, 'CNY')) + '</b>' + (p.compareAt ? '<span class="cell-sub"><s>' + esc(A.money(p.compareAt, 'CNY')) + '</s></span>' : conv != null ? '<span class="cell-sub">≈ ' + esc(A.money(conv, cur)) + '</span>' : '') + '</td>' +
          '<td class="num">' + ((p.variants || []).length) + '<span class="cell-sub">' + esc((p.colors || []).length + ' × ' + (p.sizes || []).length) + '</span></td>' +
          '<td class="nowrap"><span class="row" style="gap:8px">' + A.stockDot(s.avail) + '<span class="tnum">' + esc(A.num(total)) + '</span></span><span class="cell-sub">' + esc(A.STOCK_LABEL[s.avail]) + (s.low && s.avail !== 'low' ? ' · some low' : '') + '</span></td>' +
          '<td>' + A.statusPill(p.status) + '</td>' +
          '<td class="nowrap small muted" title="' + esc(A.dateTime(p.updatedAt)) + '">' + esc(A.ago(p.updatedAt)) + '</td>' +
          '<td class="shrink"><div class="row-actions"><a class="icon-btn icon-btn--sm" href="' + A.href('/products/' + encodeURIComponent(p.id)) + '" aria-label="Edit ' + esc(p.name) + '" title="Edit">' + icon('edit', 16) + '</a>' +
          '<button type="button" class="icon-btn icon-btn--sm" data-more aria-label="More actions for ' + esc(p.name) + '" title="More">' + icon('more', 16) + '</button></div></td>' +
          '</tr>'
        );
      }

      function draw() {
        const list = filtered();
        const total = st.products.length;
        root.querySelector('[data-count]').innerHTML = A.heading('Products', list.length === total ? total : list.length + ' / ' + total);
        $rows.innerHTML = list.map(row).join('');
        if (!total) {
          $empty.innerHTML = ui.empty({ icon: 'products', title: 'No products yet', body: 'Add your first garment — colours, sizes and stock are set up in one place.', actions: '<a class="btn btn--primary" href="' + A.href('/products/new') + '">' + icon('plus', 16) + 'New product</a><button type="button" class="btn btn--secondary" data-weidian-import>' + icon('globe', 16) + 'Import from Weidian</button><button type="button" class="btn btn--secondary" data-sheet-import>' + icon('upload', 16) + 'Import spreadsheet</button>' });
        } else if (!list.length) {
          $empty.innerHTML = ui.empty({ icon: 'search', title: 'No products match', body: 'Try another search term or clear the filters.', actions: '<button type="button" class="btn btn--secondary" data-clear>Clear filters</button>', compact: true });
        } else $empty.innerHTML = '';
        // selection may contain products filtered out — keep them but show in count
        drawBulk();
        const visibleIds = list.map((p) => p.id);
        $all.checked = visibleIds.length > 0 && visibleIds.every((id) => st.selected.has(id));
        $all.indeterminate = !$all.checked && visibleIds.some((id) => st.selected.has(id));
      }

      function drawBulk() {
        const n = st.selected.size;
        $bulk.hidden = !n;
        if (!n) return;
        $bulk.innerHTML =
          '<b>' + esc(n + ' selected') + '</b>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-bulk-act="published">' + icon('eye', 15) + 'Publish</button>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-bulk-act="draft">' + icon('edit', 15) + 'Move to draft</button>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-bulk-act="archived">' + icon('backup', 15) + 'Archive</button>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-bulk-act="delete">' + icon('trash', 15) + 'Delete</button>' +
          '<span class="sp"></span><button type="button" class="btn btn--sm btn--ghost" data-bulk-act="clear">Clear selection</button>';
      }

      function syncUrl() {
        const q = new URLSearchParams();
        for (const k of ['q', 'category', 'status', 'stock']) if (st[k]) q.set(k, st[k]);
        if (st.sort !== 'order') q.set('sort', st.sort);
        const s = q.toString();
        A.router.replace('/products' + (s ? '?' + s : ''));
        try {
          A.store.set(PREF_KEY, { sort: st.sort });
        } catch (e) {
          /* ignore */
        }
      }

      async function reload() {
        st.products = await A.data.getProducts();
        const ids = new Set(st.products.map((p) => p.id));
        st.selected.forEach((id) => !ids.has(id) && st.selected.delete(id));
        draw();
      }

      const onFilter = A.debounce(() => {
        draw();
        syncUrl();
      }, 120);
      root.querySelector('.toolbar').addEventListener('input', (e) => {
        const f = e.target.dataset.f;
        if (!f) return;
        st[f] = e.target.value;
        if (f === 'q') onFilter();
        else {
          draw();
          syncUrl();
        }
      });

      $all.addEventListener('change', () => {
        filtered().forEach((p) => ($all.checked ? st.selected.add(p.id) : st.selected.delete(p.id)));
        draw();
      });

      root.addEventListener('change', (e) => {
        if (!e.target.matches('[data-sel]')) return;
        const id = e.target.closest('tr').dataset.id;
        if (e.target.checked) st.selected.add(id);
        else st.selected.delete(id);
        e.target.closest('tr').classList.toggle('is-selected', e.target.checked);
        drawBulk();
        const visibleIds = filtered().map((p) => p.id);
        $all.checked = visibleIds.every((x) => st.selected.has(x));
        $all.indeterminate = !$all.checked && visibleIds.some((x) => st.selected.has(x));
      });

      root.addEventListener('click', async (e) => {
        const sheetBtn = e.target.closest('[data-sheet]');
        if (sheetBtn) {
          e.stopPropagation();
          await A.productSheetUi.sheetMenu(sheetBtn, async () => {
            await reload();
            A.app.refreshBadges();
          });
          return;
        }
        if (e.target.closest('[data-weidian-import]')) {
          await A.productSheetUi.weidianImport(async () => {
            await reload();
            A.app.refreshBadges();
          });
          return;
        }
        if (e.target.closest('[data-sheet-import]')) {
          await A.productSheetUi.pickAndImport(async () => {
            await reload();
            A.app.refreshBadges();
          });
          return;
        }
        if (e.target.closest('[data-clear]')) {
          st.q = st.category = st.status = st.stock = '';
          A.$$('.toolbar [data-f]', root).forEach((el) => {
            if (el.dataset.f !== 'sort') el.value = '';
          });
          draw();
          syncUrl();
          return;
        }
        const more = e.target.closest('[data-more]');
        if (more) {
          e.stopPropagation();
          const id = more.closest('tr').dataset.id;
          const p = st.products.find((x) => x.id === id);
          const act = await ui.menu(more, [
            { id: 'edit', label: 'Edit', icon: 'edit' },
            { id: 'duplicate', label: 'Duplicate', icon: 'copy' },
            { id: 'view', label: 'View on site', icon: 'external' },
            { sep: true },
            { id: 'delete', label: 'Delete', icon: 'trash', danger: true },
          ]);
          if (act === 'edit') A.go('/products/' + encodeURIComponent(id));
          else if (act === 'view') {
            if (p.status !== 'published') ui.toast('This product is a ' + p.status + ' — it is not visible on the site yet', { type: 'info' });
            window.open(A.productUrl(p), '_blank', 'noopener');
          } else if (act === 'duplicate') {
            try {
              const copy = await A.data.duplicateProduct(id);
              ui.toast('Duplicated as “' + copy.name + '” (draft)', { action: { label: 'Open', onClick: () => A.go('/products/' + encodeURIComponent(copy.id)) } });
              await reload();
            } catch (err) {
              ui.error(err, 'Could not duplicate');
            }
          } else if (act === 'delete') {
            const ok = await ui.confirm({ title: 'Delete “' + p.name + '”?', body: 'The product and its ' + A.plural((p.variants || []).length, 'variant') + ' are removed permanently. Archive it instead if you might bring it back.', confirmText: 'Delete product', danger: true });
            if (!ok) return;
            try {
              await A.data.deleteProduct(id);
              st.selected.delete(id);
              ui.toast('Deleted “' + p.name + '”');
              await reload();
              A.app.refreshBadges();
            } catch (err) {
              ui.error(err, 'Could not delete');
            }
          }
          return;
        }
        const bulk = e.target.closest('[data-bulk-act]');
        if (bulk) {
          const act = bulk.dataset.bulkAct;
          if (act === 'clear') {
            st.selected.clear();
            draw();
            return;
          }
          const chosen = st.products.filter((p) => st.selected.has(p.id));
          if (act === 'delete') {
            const ok = await ui.confirm({ title: 'Delete ' + A.plural(chosen.length, 'product') + '?', body: esc(chosen.slice(0, 5).map((p) => p.name).join(', ') + (chosen.length > 5 ? ' and ' + (chosen.length - 5) + ' more' : '')) + '. This cannot be undone.', confirmText: 'Delete ' + A.plural(chosen.length, 'product'), danger: true });
            if (!ok) return;
            await ui.busy(bulk, async () => {
              let n = 0;
              try {
                for (const p of chosen) {
                  await A.data.deleteProduct(p.id);
                  n++;
                }
                ui.toast('Deleted ' + A.plural(n, 'product'));
              } catch (err) {
                ui.error(err, 'Stopped after ' + n);
              }
              st.selected.clear();
              await reload();
              A.app.refreshBadges();
            });
            return;
          }
          const label = { published: 'Publish', draft: 'Move to draft', archived: 'Archive' }[act];
          const ok = await ui.confirm({
            title: label + ' ' + A.plural(chosen.length, 'product') + '?',
            body: act === 'published' ? 'They become visible on the site right away.' : act === 'draft' ? 'They disappear from the site until you publish them again.' : 'Archived products are hidden from the site and from stock counts.',
            confirmText: label,
          });
          if (!ok) return;
          await ui.busy(bulk, async () => {
            try {
              const n = await A.actions.setProductStatus(chosen, act);
              ui.toast(n ? (act === 'published' ? 'Published ' : act === 'draft' ? 'Moved to draft: ' : 'Archived ') + A.plural(n, 'product') : 'Nothing to change');
            } catch (err) {
              ui.error(err, 'Bulk update failed');
            }
            st.selected.clear();
            await reload();
            A.app.refreshBadges();
          });
          return;
        }
        const tr = e.target.closest('tr[data-id]');
        if (tr && !e.target.closest('a, button, input, label')) A.go('/products/' + encodeURIComponent(tr.dataset.id));
      });

      draw();
      return null;
    },
  };
})();
