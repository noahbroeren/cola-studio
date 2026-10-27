/* ==========================================================================
   Cola Studio — Admin · Inventory (spreadsheet of every variant)
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;

  const FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'low', label: 'Low' },
    { value: 'soldout', label: 'Sold out' },
    { value: 'preorder', label: 'Pre-order' },
  ];

  A.views.inventory = {
    title: 'Inventory',
    skeleton: 'table',
    async render(root, params, ctx) {
      const [products, settings, categories, events] = await Promise.all([A.data.getProducts(), A.data.getSettings(), A.data.getCategories(), A.data.getInventoryEvents().catch(() => [])]);
      if (ctx.stale()) return null;
      const st = {
        products,
        events,
        filter: FILTERS.some((f) => f.value === ctx.query.f) ? ctx.query.f : 'all',
        q: ctx.query.q || '',
        category: ctx.query.category || '',
        showArchived: false,
        edits: new Map(), // key → { stock, preorder }
      };
      const key = (pid, sku) => pid + '\u0001' + sku;

      root.innerHTML =
        '<header class="page-head"><div class="page-head__text"><h1 data-count></h1><p class="lead">Edit stock like a spreadsheet — <b>Enter</b> moves down. Changes are highlighted until you save; each product is saved as one stock update and logged in the live-stock feed.</p></div>' +
        '<div class="page-actions">' + (A.data.caps.weidian ? '<button type="button" class="btn btn--secondary" data-act="weidian-dry">' + icon('sync', 16) + 'Weidian dry run</button>' : '') + '<a class="btn btn--secondary" href="' + A.href('/products') + '">' + icon('products', 16) + 'Products</a></div></header>' +
        '<div class="inv-grid"><div class="card" style="min-width:0">' +
        '<div class="tabs" role="tablist" data-tabs></div>' +
        '<div class="toolbar"><label class="search">' + icon('search', 16) + '<input class="input" type="search" data-search data-q placeholder="Search product, colour, size or SKU" value="' + esc(st.q) + '" aria-label="Search variants"><kbd>/</kbd></label>' +
        '<select class="input" data-cat aria-label="Category"><option value="">All categories</option>' + ui.options(categories.map((c) => ({ value: c.id, label: c.name })), st.category) + '</select>' +
        '<label class="row small muted" style="gap:8px"><input type="checkbox" class="check" data-archived> Show archived</label>' +
        '<span class="toolbar__count" data-shown></span></div>' +
        '<div class="table-wrap"><table class="table inv-table"><thead><tr><th>Product</th><th>Colour</th><th>Size</th><th>SKU</th><th class="center">Stock</th><th class="center">Pre-order</th><th class="inv-status">Status</th></tr></thead><tbody data-rows></tbody></table></div>' +
        '<div data-empty></div></div>' +
        '<aside class="card inv-events"><div class="card__head"><span class="card__title">Recent stock changes</span><button type="button" class="icon-btn icon-btn--sm" data-act="reload-events" aria-label="Refresh" title="Refresh">' + icon('refresh', 15) + '</button></div><div class="events" data-events></div></aside>' +
        '</div>' +
        '<div class="savebar" data-savebar></div>';

      const $rows = root.querySelector('[data-rows]');

      function current(p, v) {
        const e = st.edits.get(key(p.id, v.sku));
        return { stock: e && e.stock !== undefined ? e.stock : Number(v.stock) || 0, preorder: e && e.preorder !== undefined ? e.preorder : !!v.preorder };
      }

      function rows() {
        const q = st.q.trim().toLowerCase();
        const out = [];
        for (const p of st.products) {
          if (!st.showArchived && p.status === 'archived') continue;
          if (st.category && p.category !== st.category) continue;
          for (const v of p.variants || []) {
            const s = A.stockStatus(v, p, settings); // filter on saved values so rows don't jump while typing
            if (st.filter === 'low' && s !== 'low') continue;
            if (st.filter === 'soldout' && s !== 'soldout' && s !== 'restocking') continue;
            if (st.filter === 'preorder' && s !== 'preorder') continue;
            if (q) {
              const hay = (p.name + ' ' + p.id + ' ' + v.color + ' ' + v.size + ' ' + v.sku).toLowerCase();
              if (!q.split(/\s+/).every((t) => hay.includes(t))) continue;
            }
            out.push({ p, v });
          }
        }
        return out;
      }

      function counts() {
        const c = { all: 0, low: 0, soldout: 0, preorder: 0 };
        for (const p of st.products) {
          if (!st.showArchived && p.status === 'archived') continue;
          for (const v of p.variants || []) {
            c.all++;
            const s = A.stockStatus(v, p, settings);
            if (s === 'low') c.low++;
            else if (s === 'soldout' || s === 'restocking') c.soldout++;
            else if (s === 'preorder') c.preorder++;
          }
        }
        return c;
      }

      function drawTabs() {
        const c = counts();
        root.querySelector('[data-tabs]').innerHTML = FILTERS.map((f) => '<button type="button" role="tab" class="tab' + (st.filter === f.value ? ' is-active' : '') + '" aria-selected="' + (st.filter === f.value) + '" data-filter="' + f.value + '">' + esc(f.label) + '<span class="count">' + c[f.value] + '</span></button>').join('');
        root.querySelector('[data-count]').innerHTML = A.heading('Inventory', A.num(c.all) + ' SKUs');
      }

      function rowHtml(r, first) {
        const { p, v } = r;
        const cur = current(p, v);
        const k = key(p.id, v.sku);
        const changed = st.edits.has(k);
        const status = A.stockStatus({ stock: cur.stock, preorder: cur.preorder }, p, settings);
        const c = (p.colors || []).find((x) => x.name === v.color);
        const delta = cur.stock - (Number(v.stock) || 0);
        return (
          '<tr data-k="' + esc(k) + '" class="' + (changed ? 'is-changed' : '') + (first ? ' is-first' : '') + '">' +
          '<td class="inv-product' + (first ? '' : ' is-empty') + '">' + (first ? '<div class="cell-main"><span class="thumb thumb--sm">' + A.productThumb(p) + '</span><div style="min-width:0"><a class="cell-title inv-name" title="' + esc(p.name) + '" href="' + A.href('/products/' + encodeURIComponent(p.id) + '?section=variants') + '">' + esc(p.name) + '</a><span class="cell-sub">' + esc(p.id) + (p.status !== 'published' ? ' · ' + esc(p.status) : '') + '</span></div></div>' : '') + '</td>' +
          '<td class="nowrap inv-color"><span class="row" style="gap:8px">' + (v.color ? '<span class="swatch" style="background:' + esc((c && c.hex) || '#DDD3C4') + '"></span>' : '') + esc(v.color || '—') + '</span></td>' +
          '<td class="nowrap inv-size">' + esc(v.size || '—') + '</td>' +
          '<td class="mono nowrap muted inv-sku">' + esc(v.sku) + '</td>' +
          '<td class="center nowrap inv-qty"><input class="input inv-stock" type="number" min="0" step="1" inputmode="numeric" value="' + esc(cur.stock) + '" data-stock aria-label="Stock for ' + esc(p.name + ' ' + v.color + ' ' + v.size) + '">' +
          (delta ? '<span class="inv-delta inv-delta--' + (delta > 0 ? 'up' : 'down') + '">' + (delta > 0 ? '+' : '') + delta + '</span>' : '') + '</td>' +
          '<td class="center inv-pre"><label class="inv-pre__lbl"><input type="checkbox" class="check" data-pre' + (cur.preorder ? ' checked' : '') + ' aria-label="Pre-order"><span>Pre-order</span></label></td>' +
          '<td class="inv-status" data-status>' + A.stockPill(status) + '</td></tr>'
        );
      }

      let visible = [];
      function draw() {
        drawTabs();
        visible = rows();
        let lastPid = null;
        $rows.innerHTML = visible
          .map((r) => {
            const first = r.p.id !== lastPid;
            lastPid = r.p.id;
            return rowHtml(r, first);
          })
          .join('');
        root.querySelector('[data-shown]').textContent = A.plural(visible.length, 'variant') + ' shown';
        root.querySelector('[data-empty]').innerHTML = visible.length
          ? ''
          : ui.empty({ icon: st.filter === 'all' ? 'search' : 'check', title: st.filter === 'low' ? 'Nothing is running low' : st.filter === 'soldout' ? 'Nothing is sold out' : st.filter === 'preorder' ? 'No pre-order variants' : 'No variants match', body: st.q ? 'Try a different search.' : '', compact: true });
        drawSavebar();
      }

      function refreshRow(tr) {
        const k = tr.dataset.k;
        const r = visible.find((x) => key(x.p.id, x.v.sku) === k);
        if (!r) return;
        const cur = current(r.p, r.v);
        const status = A.stockStatus({ stock: cur.stock, preorder: cur.preorder }, r.p, settings);
        tr.classList.toggle('is-changed', st.edits.has(k));
        tr.querySelector('[data-status]').innerHTML = A.stockPill(status);
        const cell = tr.querySelector('[data-stock]').parentElement;
        const old = cell.querySelector('.inv-delta');
        if (old) old.remove();
        const delta = cur.stock - (Number(r.v.stock) || 0);
        if (delta) cell.insertAdjacentHTML('beforeend', '<span class="inv-delta inv-delta--' + (delta > 0 ? 'up' : 'down') + '">' + (delta > 0 ? '+' : '') + delta + '</span>');
      }

      function drawSavebar() {
        const bar = root.querySelector('[data-savebar]');
        const n = st.edits.size;
        const prods = new Set(Array.from(st.edits.keys()).map((k) => k.split('\u0001')[0])).size;
        bar.className = 'savebar' + (n ? ' is-dirty' : '');
        bar.innerHTML =
          '<span class="savebar__status">' + (n ? esc(A.plural(n, 'change') + ' across ' + A.plural(prods, 'product')) : 'Stock is up to date' + (st.events[0] ? ' · last change ' + esc(A.ago(st.events[0].at)) : '')) + '</span>' +
          '<div class="savebar__actions">' + (n ? '<button type="button" class="btn btn--ghost" data-act="discard">Discard</button>' : '') +
          '<button type="button" class="btn btn--primary" data-act="save"' + (n ? '' : ' disabled') + '>' + icon('check', 16) + 'Save changes' + (n ? ' (' + n + ')' : '') + '</button></div>';
      }

      function drawEvents() {
        const byId = new Map(st.products.map((p) => [p.id, p]));
        const host = root.querySelector('[data-events]');
        const list = st.events.slice(0, 40);
        host.innerHTML = list.length
          ? list
              .map((ev) => {
                const p = byId.get(ev.productId);
                const v = p && (p.variants || []).find((x) => x.sku === ev.sku);
                const d = (Number(ev.to) || 0) - (Number(ev.from) || 0);
                return (
                  '<div class="event"><span class="event__name">' + esc(ev.name || (p ? p.name : ev.productId)) + '</span>' +
                  '<span class="event__change"><span class="faint">' + esc(ev.from) + ' → </span><b>' + esc(ev.to) + '</b> <span class="small ' + (d > 0 ? 'diff-up' : 'diff-down') + '">' + (d > 0 ? '+' : '') + d + '</span></span>' +
                  '<span class="event__meta"><span class="event__src event__src--' + esc(ev.source) + '">' + esc(ev.source) + '</span>' + esc([ev.color || (v && v.color), ev.size || (v && v.size)].filter(Boolean).join(' · ') || ev.sku) + ' · ' + esc(A.ago(ev.at)) + '</span></div>'
                );
              })
              .join('')
          : ui.empty({ icon: 'inventory', title: 'No stock changes yet', body: 'Changes from this page, Weidian syncs and orders appear here.', compact: true });
      }

      function setEdit(tr, patch) {
        const k = tr.dataset.k;
        const r = visible.find((x) => key(x.p.id, x.v.sku) === k);
        if (!r) return;
        const e = Object.assign({}, st.edits.get(k) || {}, patch);
        if (e.stock !== undefined && e.stock === (Number(r.v.stock) || 0)) delete e.stock;
        if (e.preorder !== undefined && e.preorder === !!r.v.preorder) delete e.preorder;
        if (Object.keys(e).length) st.edits.set(k, e);
        else st.edits.delete(k);
        refreshRow(tr);
        drawSavebar();
      }

      $rows.addEventListener('input', (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        if (e.target.matches('[data-stock]')) {
          if (e.target.value === '') return;
          setEdit(tr, { stock: Math.max(0, Math.trunc(Number(e.target.value) || 0)) });
        } else if (e.target.matches('[data-pre]')) setEdit(tr, { preorder: e.target.checked });
      });
      $rows.addEventListener('change', (e) => {
        if (e.target.matches('[data-stock]') && e.target.value === '') {
          e.target.value = 0;
          setEdit(e.target.closest('tr'), { stock: 0 });
        }
      });
      $rows.addEventListener('keydown', (e) => {
        if (!e.target.matches('[data-stock]')) return;
        if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const all = A.$$('[data-stock]', $rows);
          const i = all.indexOf(e.target);
          const next = all[i + (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1)];
          if (next) {
            e.preventDefault();
            next.focus();
            next.select();
          }
        }
      });
      $rows.addEventListener('focusin', (e) => {
        if (e.target.matches('[data-stock]')) e.target.select();
      });

      root.querySelector('[data-tabs]').addEventListener('click', (e) => {
        const b = e.target.closest('[data-filter]');
        if (!b) return;
        st.filter = b.dataset.filter;
        draw();
        A.router.replace('/inventory' + (st.filter !== 'all' ? '?f=' + st.filter : ''));
      });
      const onSearch = A.debounce(draw, 120);
      root.querySelector('[data-q]').addEventListener('input', (e) => {
        st.q = e.target.value;
        onSearch();
      });
      root.querySelector('[data-cat]').addEventListener('change', (e) => {
        st.category = e.target.value;
        draw();
      });
      root.querySelector('[data-archived]').addEventListener('change', (e) => {
        st.showArchived = e.target.checked;
        draw();
      });

      async function save() {
        if (!st.edits.size) return;
        const groups = new Map();
        for (const [k, e] of st.edits) {
          const [pid, sku] = k.split('\u0001');
          if (!groups.has(pid)) groups.set(pid, []);
          const item = { sku };
          if (e.stock !== undefined) item.stock = e.stock;
          if (e.preorder !== undefined) item.preorder = e.preorder;
          groups.get(pid).push(item);
        }
        const btn = root.querySelector('[data-savebar] [data-act="save"]');
        let ok = 0;
        let changes = 0;
        await ui.busy(btn, async () => {
          for (const [pid, variants] of groups) {
            try {
              const r = await A.data.patchStock(pid, variants);
              ok++;
              changes += (r.changes || []).length;
              const i = st.products.findIndex((p) => p.id === pid);
              if (i >= 0 && r.product) st.products[i] = r.product;
              variants.forEach((v) => st.edits.delete(key(pid, v.sku)));
              if (r.unmatched && r.unmatched.length) ui.toast(r.unmatched.length + ' SKU(s) no longer exist on ' + pid, { type: 'warn' });
            } catch (e) {
              ui.error(e, 'Could not save ' + pid);
            }
          }
        }, 'Saving…');
        st.events = await A.data.getInventoryEvents().catch(() => st.events);
        draw();
        drawEvents();
        if (ok) ui.toast('Saved stock for ' + A.plural(ok, 'product') + ' · ' + A.plural(changes, 'change') + ' logged');
        A.app.refreshBadges();
      }

      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'save') save();
        else if (b.dataset.act === 'discard') {
          if (!(await ui.confirm({ title: 'Discard ' + A.plural(st.edits.size, 'change') + '?', body: 'Stock goes back to the saved values.', confirmText: 'Discard', danger: true }))) return;
          st.edits.clear();
          draw();
        } else if (b.dataset.act === 'reload-events') {
          st.events = await A.data.getInventoryEvents().catch(() => st.events);
          drawEvents();
        } else if (b.dataset.act === 'weidian-dry') {
          await A.actions.weidianSync(b, {
            dryRun: true,
            onClose: async () => {
              if (st.edits.size) return;
              st.products = await A.data.getProducts();
              st.events = await A.data.getInventoryEvents().catch(() => st.events);
              draw();
              drawEvents();
            },
          });
        }
      });

      draw();
      drawEvents();

      return {
        save,
        isDirty: () => st.edits.size > 0,
        async canLeave() {
          if (!st.edits.size) return true;
          const r = await ui.dialog({
            title: 'Leave with unsaved stock changes?',
            body: '<p>' + esc(A.plural(st.edits.size, 'change')) + ' will be lost.</p>',
            buttons: [
              { id: 'save', label: 'Save and leave', variant: 'secondary' },
              { id: 'stay', label: 'Keep editing', variant: 'ghost', autofocus: true },
              { id: 'leave', label: 'Discard', variant: 'danger' },
            ],
          });
          if (!r || r.id === 'stay') return false;
          if (r.id === 'save') {
            await save();
            return st.edits.size === 0;
          }
          st.edits.clear();
          return true;
        },
      };
    },
  };
})();
