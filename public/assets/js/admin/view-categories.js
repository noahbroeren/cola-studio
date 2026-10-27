/* ==========================================================================
   Cola Studio — Admin · Categories
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;

  A.views.categories = {
    title: 'Categories',
    skeleton: 'table',
    async render(root, params, ctx) {
      let [categories, products] = await Promise.all([A.data.getCategories(), A.data.getProducts()]);
      if (ctx.stale()) return null;
      let sortable = null;

      const countOf = (id) => products.filter((p) => p.category === id).length;

      function draw() {
        root.innerHTML =
          '<header class="page-head"><div class="page-head__text"><h1>' + A.heading('Categories', categories.length) + '</h1><p class="lead">Drag to set the order used in the site navigation and filters.</p></div>' +
          '<div class="page-actions"><button type="button" class="btn btn--primary" data-act="add">' + icon('plus', 16) + 'New category</button></div></header>' +
          '<div class="card">' +
          (categories.length
            ? '<ul class="cat-list" data-list>' +
              categories
                .map((c, i) => {
                  const n = countOf(c.id);
                  return (
                    '<li class="cat-row" data-sort-id="' + esc(c.id) + '"><button type="button" class="handle" aria-label="Drag to reorder ' + esc(c.name) + '">' + icon('grip', 16) + '</button>' +
                    '<div style="min-width:0"><div><span class="cat-row__name">' + esc(c.name) + '</span><span class="cat-row__id">' + esc(c.id) + '</span></div>' + (c.description ? '<div class="cat-row__desc">' + esc(c.description) + '</div>' : '') + '</div>' +
                    '<a class="cat-row__count" href="' + A.href('/products?category=' + encodeURIComponent(c.id)) + '">' + esc(A.plural(n, 'product')) + '</a>' +
                    '<div class="row-actions">' +
                    '<button type="button" class="icon-btn icon-btn--sm" data-act="up" data-i="' + i + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + icon('arrowUp', 15) + '</button>' +
                    '<button type="button" class="icon-btn icon-btn--sm" data-act="down" data-i="' + i + '" aria-label="Move down"' + (i === categories.length - 1 ? ' disabled' : '') + '>' + icon('arrowDown', 15) + '</button>' +
                    '<button type="button" class="icon-btn icon-btn--sm" data-act="edit" data-i="' + i + '" aria-label="Edit ' + esc(c.name) + '">' + icon('edit', 15) + '</button>' +
                    '<button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="delete" data-i="' + i + '" aria-label="Delete ' + esc(c.name) + '">' + icon('trash', 15) + '</button></div></li>'
                  );
                })
                .join('') +
              '</ul>'
            : ui.empty({ icon: 'categories', title: 'No categories', body: 'Categories group products on the site, e.g. Outerwear or Knitwear.', actions: '<button type="button" class="btn btn--primary" data-act="add">' + icon('plus', 16) + 'New category</button>' })) +
          '</div>' +
          (products.some((p) => p.category && !categories.some((c) => c.id === p.category))
            ? '<div class="note note--warn" style="margin-top:16px">' + icon('alert', 16) + '<p><b>Some products point to a category that does not exist:</b> ' + esc(Array.from(new Set(products.filter((p) => p.category && !categories.some((c) => c.id === p.category)).map((p) => p.category))).join(', ')) + '. Re-create the category or move those products.</p></div>'
            : '');
        if (sortable) sortable.destroy();
        const list = root.querySelector('[data-list]');
        if (list) {
          sortable = ui.sortable(list, {
            items: '.cat-row',
            handle: '.handle',
            axis: 'y',
            onEnd(order) {
              categories = order.map((id) => categories.find((c) => c.id === id));
              persist('Order saved');
            },
          });
        }
      }

      async function persist(msg) {
        const payload = categories.map((c, i) => Object.assign({}, c, { order: i + 1 }));
        try {
          categories = await A.data.saveCategories(payload);
          if (msg) ui.toast(msg);
        } catch (e) {
          ui.error(e, 'Could not save categories');
          categories = await A.data.getCategories();
        }
        draw();
      }

      function editor(cat) {
        const isNew = !cat;
        const c = cat || { id: '', name: '', description: '' };
        let idTouched = !isNew;
        const d = ui.drawer({
          title: isNew ? 'New category' : 'Edit category',
          width: '440px',
          content:
            '<form class="stack" novalidate>' +
            ui.field('Name', '<input class="input" id="c-name" value="' + esc(c.name) + '" required maxlength="80" placeholder="e.g. Outerwear">', { for: 'c-name' }) +
            ui.field('ID', '<input class="input mono" id="c-id" value="' + esc(c.id) + '"' + (isNew ? '' : ' readonly') + ' placeholder="generated-from-name" spellcheck="false">', { for: 'c-id', hint: isNew ? 'Used in URLs (<code>/products?category=…</code>) and on every product. It cannot be changed later.' : 'The ID is fixed because products refer to it.' }) +
            ui.field('Description', '<textarea class="input" id="c-desc" rows="3" maxlength="2000" placeholder="One line shown on the category page">' + esc(c.description || '') + '</textarea>', { for: 'c-desc' }) +
            '<p class="hint hint--error" data-err hidden></p></form>',
          footer: '<button type="button" class="btn btn--ghost" data-cancel>Cancel</button><button type="button" class="btn btn--primary" data-save>' + (isNew ? 'Create category' : 'Save') + '</button>',
        });
        const name = d.body.querySelector('#c-name');
        const id = d.body.querySelector('#c-id');
        const err = d.body.querySelector('[data-err]');
        name.addEventListener('input', () => {
          if (isNew && !idTouched) id.value = A.slugify(name.value);
        });
        id.addEventListener('input', () => (idTouched = true));
        const submit = async () => {
          const nm = name.value.trim();
          const cid = A.slugify(id.value || nm);
          err.hidden = true;
          if (!nm) {
            err.hidden = false;
            err.textContent = 'Give the category a name.';
            name.focus();
            return;
          }
          if (isNew && categories.some((x) => x.id === cid)) {
            err.hidden = false;
            err.textContent = 'A category with the ID “' + cid + '” already exists.';
            id.focus();
            return;
          }
          if (isNew) categories.push({ id: cid, name: nm, description: d.body.querySelector('#c-desc').value.trim(), order: categories.length + 1 });
          else Object.assign(c, { name: nm, description: d.body.querySelector('#c-desc').value.trim() });
          d.close();
          await persist(isNew ? 'Created “' + nm + '”' : 'Saved “' + nm + '”');
        };
        d.foot.querySelector('[data-save]').addEventListener('click', submit);
        d.foot.querySelector('[data-cancel]').addEventListener('click', d.close);
        d.body.querySelector('form').addEventListener('submit', (e) => {
          e.preventDefault();
          submit();
        });
        d.body.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
            e.preventDefault();
            submit();
          }
        });
      }

      async function remove(cat) {
        const affected = products.filter((p) => p.category === cat.id);
        if (!affected.length) {
          if (!(await ui.confirm({ title: 'Delete “' + cat.name + '”?', body: 'No products use this category.', confirmText: 'Delete category', danger: true }))) return;
          categories = categories.filter((c) => c.id !== cat.id);
          return persist('Deleted “' + cat.name + '”');
        }
        const others = categories.filter((c) => c.id !== cat.id);
        const r = await ui.dialog({
          title: 'Move ' + A.plural(affected.length, 'product') + ' first',
          body:
            '<p>“' + esc(cat.name) + '” still holds ' + esc(affected.slice(0, 4).map((p) => p.name).join(', ') + (affected.length > 4 ? ' and ' + (affected.length - 4) + ' more' : '')) + '. Choose where they go before the category is deleted.</p>' +
            ui.field('Move products to', '<select class="input" id="reassign">' + (others.length ? ui.options(others.map((c) => ({ value: c.id, label: c.name }))) : '') + '<option value="">No category</option></select>', { for: 'reassign' }),
          buttons: [
            { id: 'cancel', label: 'Cancel', variant: 'ghost' },
            { id: 'ok', label: 'Move and delete', variant: 'danger' },
          ],
        });
        if (!r || r.id !== 'ok') return;
        const target = r.el.querySelector('#reassign').value;
        try {
          for (const p of affected) await A.data.saveProduct(p.id, Object.assign({}, p, { category: target }));
          products = await A.data.getProducts();
          categories = categories.filter((c) => c.id !== cat.id);
          await persist('Moved ' + A.plural(affected.length, 'product') + ' and deleted “' + cat.name + '”');
        } catch (e) {
          ui.error(e, 'Could not move products');
          products = await A.data.getProducts();
          draw();
        }
      }

      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const i = Number(b.dataset.i);
        const act = b.dataset.act;
        if (act === 'add') editor(null);
        else if (act === 'edit') editor(categories[i]);
        else if (act === 'delete') remove(categories[i]);
        else if (act === 'up' || act === 'down') {
          const j = act === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= categories.length) return;
          [categories[i], categories[j]] = [categories[j], categories[i]];
          await persist('Order saved');
          const btn = root.querySelector('[data-act="' + act + '"][data-i="' + j + '"]');
          if (btn && !btn.disabled) btn.focus();
        }
      });

      draw();
      return { destroy: () => sortable && sortable.destroy() };
    },
  };
})();
