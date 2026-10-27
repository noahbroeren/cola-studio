/* ==========================================================================
   Cola Studio — Admin · Studio updates (Weibo + manual posts)
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;
  const CAT_LABEL = { production: 'Production', drop: 'Drop', restock: 'Restock', studio: 'Studio', notice: 'Notice' };

  function mediaTile(m, opts) {
    const o = opts || {};
    const cap = o.caption ? '<span class="media-tile__cap">' + esc(o.caption) + '</span>' : '';
    if (m.type === 'image' && m.url) return '<div class="media-tile"><img src="' + esc(m.url) + '" alt="" loading="lazy">' + cap + (o.remove != null ? removeBtn(o.remove) : '') + '</div>';
    if (m.type === 'video' && m.url) return '<div class="media-tile"><video src="' + esc(m.url) + '" muted playsinline preload="metadata"' + (m.poster ? ' poster="' + esc(m.poster) + '"' : '') + '></video>' + cap + (o.remove != null ? removeBtn(o.remove) : '') + '</div>';
    const svg = A.mediaSvg(m);
    return '<div class="media-tile media-tile--' + esc(m.type) + '">' + (svg || icon('media', 22)) + '<span class="media-tile__cap">' + esc(o.caption || (m.type === 'illustration' ? A.GARMENT_LABEL[m.garment] || m.garment : m.type === 'swatch' ? (m.texture || 'swatch') : m.type === 'pattern' ? 'Pattern · ' + (m.garment || '') : m.type)) + '</span>' + (o.remove != null ? removeBtn(o.remove) : '') + '</div>';
  }
  function removeBtn(i) {
    return '<button type="button" class="icon-btn" data-act="media-del" data-i="' + i + '" aria-label="Remove media">' + icon('x', 14) + '</button>';
  }
  function thumbFor(u) {
    const m = (u.media || [])[0] || (u.video && u.video.poster ? { type: 'image', url: u.video.poster } : null);
    if (!m) return '<div class="u-thumb">' + icon('updates', 20) + '</div>';
    if (m.type === 'image' && m.url) return '<div class="u-thumb"><img src="' + esc(m.url) + '" alt="" loading="lazy"></div>';
    return '<div class="u-thumb u-thumb--' + esc(m.type) + '">' + (A.mediaSvg(m) || icon('media', 20)) + '</div>';
  }
  const publicUpdatesUrl = () => (A.data.mode === 'server' ? '/updates' : new URL('../updates.html', location.href).href);

  /* ================================================================= list */

  const PAGE = 50;

  A.views.updates = {
    title: 'Studio updates',
    skeleton: 'table',
    async render(root, params, ctx) {
      let updates = await A.data.getUpdates();
      if (ctx.stale()) return null;
      const server = A.data.mode === 'server';
      const st = { status: ['published', 'pending', 'hidden'].includes(ctx.query.status) ? ctx.query.status : 'all', source: '', q: '', shown: PAGE };

      root.innerHTML =
        '<header class="page-head"><div class="page-head__text"><h1 data-count></h1><p class="lead">Posts from the studio’s Weibo, translated to English, plus your own studio posts. Pinned posts stay on top.</p></div>' +
        '<div class="page-actions">' +
        (server ? '<button type="button" class="btn btn--secondary" data-act="fetch">' + icon('refresh', 16) + 'Fetch Weibo now</button>' : '<button type="button" class="btn btn--secondary" disabled title="Needs the server">' + icon('lock', 15) + 'Fetch Weibo now</button>') +
        '<a class="btn btn--primary" href="' + A.href('/updates/new') + '">' + icon('plus', 16) + 'New studio post</a></div></header>' +
        '<div data-console hidden style="margin-bottom:20px"></div>' +
        '<div class="card"><div class="tabs" role="tablist" data-tabs></div>' +
        '<div class="toolbar"><label class="search">' + icon('search', 16) + '<input class="input" type="search" data-search data-q placeholder="Search titles and text" aria-label="Search updates"><kbd>/</kbd></label>' +
        ui.segmented('src', [{ value: '', label: 'All sources' }, { value: 'weibo', label: 'Weibo' }, { value: 'studio', label: 'Studio' }], '', 'aria-label="Source"') +
        '</div><div data-bulk></div><div data-list></div></div>';

      function counts() {
        const c = { all: 0, published: 0, pending: 0, hidden: 0 };
        updates.forEach((u) => {
          if (st.source && u.source !== st.source) return;
          c.all++;
          c[u.status] = (c[u.status] || 0) + 1;
        });
        return c;
      }

      function draw() {
        const c = counts();
        root.querySelector('[data-count]').innerHTML = A.heading('Studio updates', updates.length);
        root.querySelector('[data-tabs]').innerHTML = [
          ['all', 'All'],
          ['published', 'Published'],
          ['pending', 'Pending'],
          ['hidden', 'Hidden'],
        ]
          .map(([v, l]) => '<button type="button" role="tab" class="tab' + (st.status === v ? ' is-active' : '') + '" aria-selected="' + (st.status === v) + '" data-status="' + v + '">' + l + '<span class="count">' + (c[v] || 0) + '</span></button>')
          .join('');
        const q = st.q.trim().toLowerCase();
        const list = updates.filter((u) => (st.status === 'all' || u.status === st.status) && (!st.source || u.source === st.source) && (!q || (u.title + ' ' + u.textEnglish + ' ' + u.textOriginal).toLowerCase().includes(q)));
        const pending = updates.filter((u) => u.status === 'pending' && (!st.source || u.source === st.source));
        const queued = pending.filter((u) => u.translation && u.translation.queued).length;
        root.querySelector('[data-bulk]').innerHTML =
          st.status === 'pending' && pending.length > 1
            ? '<div class="bulk-bar"><span>' + esc(A.plural(pending.length, 'post') + ' waiting for review') + (queued ? ' · ' + esc(queued) + ' not translated yet' : '') + '</span><div class="row row--wrap">' +
              (queued && server ? '<a class="btn btn--sm btn--ghost" href="' + A.href('/integrations?section=weibo-history') + '">' + icon('wand', 15) + 'Translate</a>' : '') +
              '<button type="button" class="btn btn--sm btn--primary" data-act="publish-all">' + icon('eye', 15) + 'Publish all ' + esc(pending.length) + '</button></div></div>'
            : '';
        const page = list.slice(0, st.shown);
        root.querySelector('[data-list]').innerHTML = list.length
          ? page
              .map(
                (u) =>
                  '<div class="u-row is-clickable" data-id="' + esc(u.id) + '">' + thumbFor(u) +
                  '<div style="min-width:0"><div class="u-title">' + (u.pinned ? icon('pin', 14) : '') + '<a class="u-link" href="' + A.href('/updates/' + encodeURIComponent(u.id)) + '">' + esc(u.title || '(untitled)') + '</a></div>' +
                  '<div class="u-excerpt">' + esc(u.textEnglish || u.textOriginal || '') + '</div>' +
                  '<div class="u-meta"><span class="pill pill--outline">' + esc(CAT_LABEL[u.category] || u.category) + '</span><span>' + esc(u.source === 'weibo' ? 'Weibo' : 'Studio') + '</span><span>·</span><span title="' + esc(A.dateTime(u.publishedAt)) + '">' + esc(A.date(u.publishedAt)) + '</span>' +
                  (u.translation && u.translation.provider && u.translation.provider !== 'none' ? '<span>· translated by ' + esc(u.translation.provider) + (u.translation.edited ? ', edited' : '') + '</span>' : u.source === 'weibo' && u.translation && u.translation.error ? '<span class="diff-down">· translation failed</span>' : u.source === 'weibo' && u.translation && u.translation.queued ? '<span class="u-queue">· waiting for translation</span>' : '') +
                  ((u.media || []).length ? '<span>· ' + esc(A.plural(u.media.length, 'media item', 'media items')) + '</span>' : '') +
                  '</div></div>' +
                  '<div class="u-end">' + A.statusPill(u.status) + '<button type="button" class="icon-btn icon-btn--sm" data-more aria-label="Actions for ' + esc(u.title || 'update') + '">' + icon('more', 16) + '</button></div></div>'
              )
              .join('') +
            (list.length > page.length ? '<div class="list-more"><button type="button" class="btn btn--secondary" data-act="more">Show more<span class="faint" style="margin-left:6px">' + esc(page.length + ' of ' + list.length) + '</span></button></div>' : '')
          : ui.empty({
              icon: 'updates',
              title: updates.length ? 'Nothing in this view' : 'No updates yet',
              body: updates.length ? 'Try another tab or source.' : server ? 'Fetch the studio’s Weibo or write a studio post.' : 'Write a studio post to get started.',
              actions: '<a class="btn btn--primary" href="' + A.href('/updates/new') + '">' + icon('plus', 16) + 'New studio post</a>',
              compact: !!updates.length,
            });
      }

      root.addEventListener('click', async (e) => {
        const tab = e.target.closest('[data-status]');
        if (tab && tab.classList.contains('tab')) {
          st.status = tab.dataset.status;
          st.shown = PAGE;
          A.router.replace('/updates' + (st.status !== 'all' ? '?status=' + st.status : ''));
          return draw();
        }
        const more = e.target.closest('[data-more]');
        if (more) {
          e.preventDefault();
          e.stopPropagation();
          const id = more.closest('[data-id]').dataset.id;
          const u = updates.find((x) => x.id === id);
          const items = [];
          if (u.status !== 'published') items.push({ id: 'published', label: 'Publish', icon: 'eye' });
          if (u.status !== 'pending') items.push({ id: 'pending', label: 'Mark as pending', icon: 'clock' });
          if (u.status !== 'hidden') items.push({ id: 'hidden', label: 'Hide', icon: 'minus' });
          items.push({ id: 'pin', label: u.pinned ? 'Unpin' : 'Pin to top', icon: 'pin' });
          if (server && u.textOriginal) items.push({ id: 'retranslate', label: 'Re-translate', icon: 'wand' });
          items.push({ sep: true }, { id: 'delete', label: 'Delete', icon: 'trash', danger: true });
          const act = await ui.menu(more, items);
          if (!act) return;
          try {
            if (['published', 'pending', 'hidden'].includes(act)) {
              await A.data.saveUpdate(id, { status: act });
              ui.toast(act === 'published' ? 'Published' : act === 'pending' ? 'Marked as pending' : 'Hidden from the site');
            } else if (act === 'pin') {
              await A.data.saveUpdate(id, { pinned: !u.pinned });
              ui.toast(u.pinned ? 'Unpinned' : 'Pinned to the top');
            } else if (act === 'retranslate') {
              await ui.busy(more, () => A.data.retranslate(id));
              ui.toast('Re-translated');
            } else if (act === 'delete') {
              const ok = await ui.confirm({ title: 'Delete this update?', body: esc(u.title || 'Untitled') + (u.source === 'weibo' ? ' — it will not be re-imported by the next Weibo fetch.' : ''), confirmText: 'Delete update', danger: true });
              if (!ok) return;
              await A.data.deleteUpdate(id);
              ui.toast('Update deleted');
            }
            updates = await A.data.getUpdates();
            draw();
            A.app.refreshBadges();
          } catch (err) {
            ui.error(err);
          }
          return;
        }
        const row = e.target.closest('.u-row[data-id]');
        if (row && !e.target.closest('a, button')) {
          A.go('/updates/' + encodeURIComponent(row.dataset.id));
          return;
        }
        const moreBtn = e.target.closest('[data-act="more"]');
        if (moreBtn) {
          st.shown += PAGE;
          draw();
          return;
        }
        const all = e.target.closest('[data-act="publish-all"]');
        if (all) {
          const pending = updates.filter((u) => u.status === 'pending' && (!st.source || u.source === st.source));
          const queued = pending.filter((u) => u.translation && u.translation.queued).length;
          const ok = await ui.confirm({
            title: 'Publish ' + A.plural(pending.length, 'post') + '?',
            body: 'They appear on the Studio Updates page straight away.' + (queued ? ' <b>' + esc(A.plural(queued, 'post is', 'posts are')) + ' not translated yet</b> and will show the Chinese text.' : ''),
            confirmText: 'Publish all',
          });
          if (!ok) return;
          try {
            const r = await ui.busy(all, () => A.data.bulkUpdates({ fromStatus: 'pending', status: 'published', ...(st.source ? { source: st.source } : {}) }), 'Publishing…');
            ui.toast(A.plural(r.changed || 0, 'post') + ' published');
            updates = await A.data.getUpdates();
            draw();
            A.app.refreshBadges();
          } catch (err) {
            ui.error(err);
          }
          return;
        }
        const b = e.target.closest('[data-act="fetch"]');
        if (b) {
          const target = root.querySelector('[data-console]');
          const r = await A.actions.weiboFetch(b, { target });
          if (r) {
            updates = await A.data.getUpdates();
            draw();
          }
        }
      });
      root.querySelector('[data-q]').addEventListener('input', A.debounce((e) => {
        st.q = e.target.value;
        st.shown = PAGE;
        draw();
      }, 120));
      root.querySelector('.seg').addEventListener('change', (e) => {
        st.source = e.target.value;
        st.shown = PAGE;
        draw();
      });
      draw();
      return null;
    },
  };

  /* =============================================================== editor */

  A.views.updateEditor = {
    title: 'Studio update',
    skeleton: 'form',
    async render(root, params, ctx) {
      const server = A.data.mode === 'server';
      const isNewInit = params.id === 'new';
      const [updates, products] = await Promise.all([A.data.getUpdates(), A.data.getProducts()]);
      if (ctx.stale()) return null;
      let isNew = isNewInit;
      let src = isNew ? { title: '', textOriginal: '', textEnglish: '', category: 'studio', status: 'published', pinned: false, relatedProducts: [], media: [], source: 'studio', publishedAt: new Date().toISOString() } : updates.find((u) => u.id === params.id);
      if (!src) throw Object.assign(new Error('This update does not exist (any more).'), { status: 404 });
      let u = A.clone(src);
      let baseline = '';
      let mediaDirty = false;
      let leaving = false;
      const FIELDS = ['title', 'textEnglish', 'textOriginal', 'category', 'status', 'pinned', 'relatedProducts', 'publishedAt'];
      const pick = (x) => {
        const o = {};
        FIELDS.forEach((k) => (o[k] = x[k]));
        o.media = x.media || [];
        return o;
      };
      const snap = () => JSON.stringify(pick(u));
      const reset = () => {
        baseline = snap();
        mediaDirty = false;
      };
      reset();
      const productById = new Map(products.map((p) => [p.id, p]));

      function draw() {
        const weibo = u.source === 'weibo';
        ctx.setTitle((u.title || (isNew ? 'New studio post' : 'Update')) + ' · Studio updates');
        root.innerHTML =
          '<header class="page-head"><div class="page-head__text"><a class="crumb" href="' + A.href('/updates') + '">' + icon('chevronLeft', 14) + 'Studio updates</a>' +
          '<div class="title-row"><h1>' + (u.title ? '<b>' + esc(u.title) + '</b>' : isNew ? '<b>New</b> <span>studio post</span>' : '<b>Untitled</b>') + '</h1>' + (isNew ? '<span class="pill pill--outline">Not saved</span>' : A.statusPill(u.status)) + '</div>' +
          '<p class="lead">' + (isNew ? 'A manual post from the studio. Chinese original is optional.' : esc((weibo ? 'Imported from Weibo' : 'Studio post') + ' · ' + A.dateTime(u.publishedAt))) + (weibo && u.url ? ' · <a href="' + esc(u.url) + '" target="_blank" rel="noopener">original post ↗</a>' : '') + '</p></div>' +
          '<div class="page-actions">' +
          (!isNew ? '<a class="btn btn--secondary" href="' + esc(publicUpdatesUrl()) + '" target="_blank" rel="noopener">View on site' + icon('external', 15) + '</a>' : '') +
          (!isNew && server && u.textOriginal ? '<button type="button" class="btn btn--secondary" data-act="retranslate">' + icon('wand', 16) + 'Re-translate</button>' : '') +
          (!isNew ? '<button type="button" class="btn btn--danger" data-act="delete">' + icon('trash', 16) + 'Delete</button>' : '<a class="btn btn--ghost" href="' + A.href('/updates') + '">Cancel</a>') +
          '</div></header>' +
          '<div class="grid grid--main"><div class="stack">' +
          '<div class="card"><div class="card__head"><span class="card__title">Text</span>' + (u.translation ? '<span class="small faint">' + esc(u.translation.provider && u.translation.provider !== 'none' ? 'Translated by ' + u.translation.provider + (u.translation.model ? ' (' + u.translation.model + ')' : '') + (u.translation.edited ? ' · edited' : '') : 'Not machine-translated') + '</span>' : '') + '</div><div class="card__body stack">' +
          (u.translation && u.translation.error ? '<div class="note note--error">' + icon('alert', 16) + '<p><b>Translation failed:</b> ' + esc(u.translation.error) + (server ? ' — fix the provider under Integrations and use Re-translate.' : '') + '</p></div>' : '') +
          ui.field('Title', '<input class="input input--lg" id="u-title" data-u="title" value="' + esc(u.title) + '" placeholder="e.g. Production update | Heavyweight Hoodie" maxlength="300">', { for: 'u-title', hint: 'Format used on the site: “Category | Product or topic”.' }) +
          '<div class="translate-grid">' +
          '<div class="field"><div class="label">Original · 中文' + (weibo ? '<span class="label__aside">from Weibo</span>' : '') + '</div>' +
          (weibo ? '<div class="zh-text" lang="zh">' + esc(u.textOriginal || '—') + '</div>' : '<textarea class="input" lang="zh" data-u="textOriginal" placeholder="Optional — the Chinese text, if any">' + esc(u.textOriginal || '') + '</textarea>') + '</div>' +
          '<div class="field"><label class="label" for="u-en">English<span class="label__aside" data-en-count>' + (u.textEnglish || '').length + ' characters</span></label><textarea class="input" id="u-en" data-u="textEnglish" placeholder="English text shown on the site">' + esc(u.textEnglish || '') + '</textarea></div>' +
          '</div></div></div>' +
          '<div class="card"><div class="card__head"><span class="card__title">Media <span class="count">' + (u.media || []).length + '</span></span>' +
          '<div class="row"><button type="button" class="btn btn--sm btn--secondary" data-act="media-upload">' + icon('upload', 15) + 'Upload image</button><button type="button" class="btn btn--sm btn--ghost" data-act="media-url">' + icon('link', 15) + 'Add URL</button></div></div><div class="card__body">' +
          ((u.media || []).length || (u.video && u.video.url)
            ? '<div class="media-grid">' + (u.video && u.video.url ? mediaTile({ type: 'video', url: u.video.url, poster: u.video.poster }, { caption: 'Video' }) : '') + (u.media || []).map((m, i) => mediaTile(m, { remove: i })).join('') + '</div>' +
              ((u.media || []).some((m) => m.type !== 'image' && m.type !== 'video') ? '<p class="hint">Illustrations, swatches and patterns are demo media drawn by the site.</p>' : '')
            : ui.empty({ icon: 'media', title: 'No media', body: 'Add photos from the studio or the factory floor.', compact: true })) +
          '</div></div>' +
          '</div><div class="stack">' +
          '<div class="card"><div class="card__head"><span class="card__title">Publishing</span></div><div class="card__body stack">' +
          ui.field('Status', ui.segmented('u-status', [{ value: 'published', label: 'Published' }, { value: 'pending', label: 'Pending' }, { value: 'hidden', label: 'Hidden' }], u.status, 'aria-label="Status"')) +
          ui.field('Category', '<select class="input" id="u-cat" data-u="category">' + ui.options(A.UPDATE_CATEGORIES.map((c) => ({ value: c, label: CAT_LABEL[c] })), u.category) + '</select>', { for: 'u-cat' }) +
          ui.field('Published', '<input class="input" type="datetime-local" id="u-date" data-u="publishedAt" value="' + esc(A.toLocalInput(u.publishedAt)) + '">', { for: 'u-date', hint: 'Controls the order on the updates page.' }) +
          ui.toggle('data-u="pinned"', !!u.pinned, 'Pin to top', 'Pinned posts are shown first') +
          '</div></div>' +
          '<div class="card"><div class="card__head"><span class="card__title">Related products <span class="count" data-rel-count>' + (u.relatedProducts || []).length + '</span></span></div><div class="card__body stack--sm stack">' +
          '<div class="chips" data-rel-chips></div>' +
          '<label class="search" style="flex:none">' + icon('search', 16) + '<input class="input" type="search" data-rel-q placeholder="Find products" aria-label="Find products"></label>' +
          '<div class="pick-list" data-rel-list></div></div></div>' +
          '</div></div>' +
          '<div class="savebar" data-savebar></div>';
        drawRelated();
        drawSavebar();
      }

      function drawRelated(q) {
        const sel = u.relatedProducts || [];
        root.querySelector('[data-rel-count]').textContent = sel.length;
        root.querySelector('[data-rel-chips]').innerHTML = sel.length
          ? sel.map((id) => '<span class="chip chip--tag">' + esc((productById.get(id) || {}).name || id) + '<button type="button" class="chip__x" data-act="rel-del" data-id="' + esc(id) + '" aria-label="Remove">' + icon('x', 12) + '</button></span>').join('')
          : '<span class="small faint">None — the post shows without product links.</span>';
        const query = String(q || '').toLowerCase();
        root.querySelector('[data-rel-list]').innerHTML = products
          .filter((p) => !query || (p.name + ' ' + p.id).toLowerCase().includes(query))
          .map((p) => '<label class="pick-item"><input type="checkbox" class="check" data-rel="' + esc(p.id) + '"' + (sel.includes(p.id) ? ' checked' : '') + '><span class="thumb">' + A.productThumb(p) + '</span><span class="ellipsis">' + esc(p.name) + '</span><span class="sp"></span><span class="mono faint">' + esc(p.id) + '</span></label>')
          .join('');
      }

      function drawSavebar() {
        const dirty = isNew || snap() !== baseline;
        const bar = root.querySelector('[data-savebar]');
        bar.className = 'savebar' + (dirty && !isNew ? ' is-dirty' : '') + (isNew ? ' is-new' : '');
        bar.innerHTML =
          '<span class="savebar__status">' + (isNew ? 'New post — not saved yet' : dirty ? 'Unsaved changes' : 'All changes saved') + '</span>' +
          '<div class="savebar__actions">' + (dirty && !isNew ? '<button type="button" class="btn btn--ghost" data-act="discard">Discard</button>' : '') +
          '<button type="button" class="btn btn--primary" data-act="save"' + (dirty ? '' : ' disabled') + '>' + icon('check', 16) + (isNew ? 'Create post' : 'Save') + '</button></div>';
      }

      root.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.u) {
          const k = t.dataset.u;
          if (k === 'pinned') u.pinned = t.checked;
          else if (k === 'publishedAt') u.publishedAt = t.value ? new Date(t.value).toISOString() : u.publishedAt;
          else u[k] = t.value;
          if (k === 'textEnglish') root.querySelector('[data-en-count]').textContent = u.textEnglish.length + ' characters';
          drawSavebar();
        } else if (t.name === 'u-status') {
          u.status = t.value;
          drawSavebar();
        } else if (t.dataset.rel) {
          const id = t.dataset.rel;
          const set = new Set(u.relatedProducts || []);
          if (t.checked) set.add(id);
          else set.delete(id);
          u.relatedProducts = products.map((p) => p.id).filter((x) => set.has(x));
          drawRelated(root.querySelector('[data-rel-q]').value);
          drawSavebar();
        } else if (t.matches('[data-rel-q]')) drawRelated(t.value);
      });

      async function addMedia(m) {
        u.media = (u.media || []).concat([m]);
        mediaDirty = true;
        draw();
      }

      async function save() {
        if (!u.title.trim() && !(u.textEnglish || '').trim()) {
          ui.toast('Add a title or English text', { type: 'error' });
          root.querySelector('#u-title').focus();
          return;
        }
        const btn = root.querySelector('[data-savebar] [data-act="save"]');
        const body = pick(u);
        if (!mediaDirty) delete body.media; // never round-trip demo media through the server
        if (u.source === 'weibo') delete body.textOriginal;
        try {
          const saved = await ui.busy(btn, () => (isNew ? A.data.createUpdate(body) : A.data.saveUpdate(u.id, body)), 'Saving…');
          const wasNew = isNew;
          isNew = false;
          u = A.clone(saved);
          reset();
          if (wasNew) A.router.replace('/updates/' + encodeURIComponent(saved.id));
          draw();
          ui.toast(wasNew ? 'Post created' : 'Update saved');
          A.app.refreshBadges();
        } catch (e) {
          ui.error(e, 'Could not save');
        }
      }

      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'save') save();
        else if (act === 'discard') {
          if (!(await ui.confirm({ title: 'Discard changes?', confirmText: 'Discard', danger: true }))) return;
          u = A.clone(src);
          reset();
          draw();
        } else if (act === 'rel-del') {
          u.relatedProducts = (u.relatedProducts || []).filter((x) => x !== b.dataset.id);
          drawRelated(root.querySelector('[data-rel-q]').value);
          drawSavebar();
        } else if (act === 'media-del') {
          const i = Number(b.dataset.i);
          u.media.splice(i, 1);
          mediaDirty = true;
          draw();
        } else if (act === 'media-upload') {
          const files = await ui.pickFiles({ accept: 'image/*', multiple: true });
          for (const f of files) {
            try {
              const r = await ui.busy(b, () => A.data.upload(f), 'Uploading…');
              if (r.large) ui.toast(f.name + ' is ' + A.bytes(r.bytes) + ' — browser storage is limited', { type: 'warn' });
              await addMedia({ type: 'image', url: r.url });
            } catch (err) {
              ui.error(err, 'Upload failed');
            }
          }
        } else if (act === 'media-url') {
          const r = await ui.dialog({
            title: 'Add image by URL',
            body: ui.field('Image URL', '<input class="input" id="m-url" placeholder="https://… or /uploads/…">', { for: 'm-url' }),
            buttons: [
              { id: 'cancel', label: 'Cancel', variant: 'ghost' },
              { id: 'ok', label: 'Add image', variant: 'primary' },
            ],
          });
          const url = r && r.id === 'ok' ? r.el.querySelector('#m-url').value.trim() : '';
          if (url) {
            if (!/^(https?:\/\/|\/)/i.test(url)) return ui.toast('Use a full https:// link or a site path', { type: 'error' });
            await addMedia({ type: 'image', url });
          }
        } else if (act === 'retranslate') {
          if (snap() !== baseline && !(await ui.confirm({ title: 'Re-translate and lose your edits?', body: 'The English text and title are replaced by a fresh translation.', confirmText: 'Re-translate', danger: true }))) return;
          try {
            const saved = await ui.busy(b, () => A.data.retranslate(u.id), 'Translating…');
            u = A.clone(saved);
            src = A.clone(saved);
            reset();
            draw();
            ui.toast(saved.translation && saved.translation.error ? 'Translation failed: ' + saved.translation.error : 'Re-translated with ' + ((saved.translation && saved.translation.provider) || 'the provider'), { type: saved.translation && saved.translation.error ? 'error' : 'ok' });
          } catch (err) {
            ui.error(err, 'Re-translate failed');
          }
        } else if (act === 'delete') {
          if (!(await ui.confirm({ title: 'Delete this update?', body: u.source === 'weibo' ? 'It will not be re-imported by the next Weibo fetch.' : 'This cannot be undone.', confirmText: 'Delete update', danger: true }))) return;
          try {
            await A.data.deleteUpdate(u.id);
            leaving = true;
            ui.toast('Update deleted');
            A.app.refreshBadges();
            A.go('/updates');
          } catch (err) {
            ui.error(err);
          }
        }
      });

      draw();
      if (isNew) setTimeout(() => root.querySelector('#u-title').focus(), 30);

      return {
        save,
        isDirty: () => !leaving && snap() !== baseline,
        async canLeave() {
          if (leaving || snap() === baseline) return true;
          const ok = await ui.confirm({ title: 'Leave without saving?', body: 'Your changes to this update will be lost.', confirmText: 'Discard and leave', cancelText: 'Keep editing', danger: true });
          if (ok) leaving = true;
          return ok;
        },
      };
    },
  };
})();
