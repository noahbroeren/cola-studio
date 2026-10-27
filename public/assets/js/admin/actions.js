/* ==========================================================================
   Cola Studio — Admin shared actions
   Flows used by several views: Weibo fetch, Weidian sync (dry run + apply),
   product status changes. Server-only flows check A.data.caps first.
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;
  const actions = (A.actions = {});

  /* ----------------------------------------------------------- weibo fetch */

  actions.weiboResultHtml = function (r) {
    const errors = (r && r.errors) || [];
    const bad = r && (r.ok === false || errors.length);
    const tone = bad ? (r.added ? 'warn' : 'err') : 'ok';
    const status = bad ? (r.added ? 'Partial' : 'Failed') : 'OK';
    return (
      '<div class="stack">' +
      '<div class="row row--wrap small">' +
      '<span class="pill pill--' + (bad ? (r.added ? 'pending' : 'soldout') : 'published') + '">' + esc(status) + '</span>' +
      '<span class="muted">' + esc(A.plural(r.added || 0, 'post') + ' added · ' + (r.fetched || 0) + ' fetched · ' + (r.skipped || 0) + ' skipped') + '</span></div>' +
      (errors.length
        ? '<div class="note note--error">' + icon('alert', 16) + '<div><p><b>Weibo could not be read.</b> ' + esc(errors[0]) + (errors.length > 1 ? ' (+' + (errors.length - 1) + ' more)' : '') + '</p>' +
          (/cookie/i.test(errors.join(' ')) ? '' : '<p class="small" style="margin-top:6px">Usually Weibo blocks data-centre IPs. Add a logged-in cookie under Integrations → Weibo, or run the server on a VPS with a regular IP.</p>') + '</div></div>'
        : '') +
      ui.consoleBlock(r.log || [], { title: 'Fetch log', status, statusTone: tone }) +
      '</div>'
    );
  };

  /** Run a Weibo fetch. opts: { target: Element (inline result) , force } */
  actions.weiboFetch = async function (btn, opts) {
    const o = opts || {};
    if (!A.data.caps.weibo) return ui.toast('Weibo fetching needs the server', { type: 'info' });
    return ui.busy(
      btn,
      async () => {
        try {
          const r = await A.data.weiboFetch(o.force);
          const html = actions.weiboResultHtml(r);
          if (o.target) {
            o.target.hidden = false;
            o.target.innerHTML = html;
          } else ui.drawer({ title: 'Weibo fetch', content: html, width: '640px', onClose: o.onClose });
          if (r.ok === false || (r.errors && r.errors.length)) ui.toast('Weibo fetch finished with errors — see the log', { type: 'warn' });
          else ui.toast(r.added ? A.plural(r.added, 'new post') + ' imported' : 'No new posts on Weibo');
          if (A.app) A.app.refreshBadges();
          return r;
        } catch (e) {
          if (e.status === 409) ui.toast('A Weibo fetch is already running — try again in a moment', { type: 'info' });
          else ui.error(e, 'Weibo fetch failed');
          return null;
        }
      },
      'Fetching…'
    );
  };

  /* --------------------------------------------------------- weidian sync */

  actions.weidianResultHtml = function (r, products) {
    const byId = new Map((products || []).map((p) => [p.id, p]));
    const pname = (id) => (byId.get(id) ? byId.get(id).name : id || '—');
    const changes = r.changes || [];
    const unmatched = r.unmatched || [];
    const errors = r.errors || [];
    const info = r.infoChanges || [];
    let html =
      '<div class="row row--wrap small" style="margin-bottom:14px">' +
      '<span class="pill ' + (r.dryRun ? 'pill--outline' : 'pill--published') + '">' + (r.dryRun ? 'Dry run — nothing saved' : 'Applied') + '</span>' +
      '<span class="muted">Provider <b>' + esc(r.provider || '—') + '</b> · ' + esc(A.plural(r.items || 0, 'item')) + ' · ' + esc(A.plural(changes.length, 'stock change')) + ' · ' + esc(unmatched.length + ' unmatched') + (errors.length ? ' · ' + esc(A.plural(errors.length, 'error')) : '') + '</span></div>';
    if (errors.length) {
      html += '<div class="note note--error" style="margin-bottom:14px">' + icon('alert', 16) + '<div>' + errors.map((e) => '<p>' + (e.productId ? '<b>' + esc(pname(e.productId)) + '</b>' + (e.itemId ? ' (item ' + esc(e.itemId) + ')' : '') + ': ' : '') + esc(e.error) + '</p>').join('') + '</div></div>';
    }
    if (changes.length) {
      html +=
        '<div class="card"><div class="card__head"><span class="card__title">Stock changes <span class="count">' + changes.length + '</span></span></div><div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Variant</th><th class="num">From</th><th class="num">To</th><th>Matched by</th></tr></thead><tbody>' +
        changes
          .map((c) => {
            const d = c.to - c.from;
            return (
              '<tr><td><span class="cell-title">' + esc(pname(c.productId)) + '</span></td>' +
              '<td><span class="nowrap">' + esc([c.color, c.size].filter(Boolean).join(' · ') || '—') + '</span><span class="cell-sub mono">' + esc(c.sku) + '</span></td>' +
              '<td class="num muted">' + esc(c.from) + '</td>' +
              '<td class="num"><span class="diff-to">' + esc(c.to) + '</span> <span class="small ' + (d > 0 ? 'diff-up' : 'diff-down') + '">' + (d > 0 ? '+' : '') + d + '</span></td>' +
              '<td class="small muted">' + esc(c.matchedBy || '—') + '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div></div>';
    } else if (!errors.length) {
      html += '<div class="note">' + icon('check', 16) + '<p>Stock already matches Weidian for every matched variant.</p></div>';
    }
    if (info.length) {
      html +=
        '<div class="card"><div class="card__head"><span class="card__title">Product info <span class="count">' + info.length + '</span></span></div><ul class="list">' +
        info.map((c) => '<li class="list__item"><div class="list__main"><span class="list__title">' + esc(pname(c.productId)) + '</span><span class="list__sub">' + esc(c.field) + ': ' + esc(JSON.stringify(c.from)) + ' → ' + esc(JSON.stringify(c.to)) + '</span></div></li>').join('') +
        '</ul></div>';
    }
    if (unmatched.length) {
      html +=
        '<div class="card"><div class="card__head"><span class="card__title">Unmatched Weidian SKUs <span class="count">' + unmatched.length + '</span></span><span class="small faint">Add size/colour aliases or a Weidian SKU id</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Weidian SKU</th><th class="num">Stock</th><th>Reason</th></tr></thead><tbody>' +
        unmatched
          .slice(0, 200)
          .map(
            (u) =>
              '<tr><td>' + esc(pname(u.productId)) + (u.itemId ? '<span class="cell-sub">item ' + esc(u.itemId) + '</span>' : '') + '</td>' +
              '<td>' + esc(u.title || u.sku || [u.color, u.size].filter(Boolean).join(' / ') || '—') + (u.skuId ? '<span class="cell-sub mono">' + esc(u.skuId) + '</span>' : '') + '</td>' +
              '<td class="num">' + esc(u.stock == null ? '—' : u.stock) + '</td><td class="small muted">' + esc(u.reason || '—') + '</td></tr>'
          )
          .join('') +
        '</tbody></table></div></div>';
    }
    return '<div class="stack">' + html + '</div>';
  };

  /** Run a Weidian sync. opts: { dryRun, productId, target, onApplied } */
  actions.weidianSync = async function (btn, opts) {
    const o = opts || {};
    if (!A.data.caps.weidian) return ui.toast('Weidian sync needs the server', { type: 'info' });
    return ui.busy(
      btn,
      async () => {
        try {
          const [r, products] = await Promise.all([A.data.weidianSync({ dryRun: !!o.dryRun, productId: o.productId || undefined }), A.data.getProducts().catch(() => [])]);
          let html = actions.weidianResultHtml(r, products);
          const canApply = o.dryRun && (r.changes || []).length + (r.infoChanges || []).length > 0;
          if (canApply) html += '<div class="row" style="margin-top:16px"><button type="button" class="btn btn--primary" data-apply-sync>' + icon('sync', 16) + 'Apply these changes</button><span class="small faint">Runs a real sync (values may have moved since the dry run).</span></div>';
          let host = o.target;
          let drawer = null;
          if (host) {
            host.hidden = false;
            host.innerHTML = html;
          } else {
            drawer = ui.drawer({ title: o.dryRun ? 'Weidian sync — dry run' : 'Weidian sync', content: html, width: '760px', onClose: o.onClose });
            host = drawer.body;
          }
          const apply = host.querySelector('[data-apply-sync]');
          if (apply) {
            apply.addEventListener('click', async () => {
              const ok = await ui.confirm({ title: 'Apply Weidian sync?', body: 'Stock levels on the site will be updated from Weidian and logged in the live-stock feed.', confirmText: 'Apply sync' });
              if (!ok) return;
              const r2 = await actions.weidianSync(apply, { dryRun: false, productId: o.productId, target: host, onApplied: o.onApplied });
              if (r2 && drawer) drawer.el.querySelector('#drw-title').textContent = 'Weidian sync';
            });
          }
          if (!o.dryRun) {
            ui.toast(r.ok === false ? 'Weidian sync failed — see the details' : 'Weidian sync applied: ' + A.plural((r.changes || []).length, 'stock change'), { type: r.ok === false ? 'error' : 'ok' });
            if (o.onApplied) o.onApplied(r);
            if (A.app) A.app.refreshBadges();
          }
          return r;
        } catch (e) {
          if (e.status === 409) ui.toast('A Weidian sync is already running — try again in a moment', { type: 'info' });
          else ui.error(e, 'Weidian sync failed');
          return null;
        }
      },
      o.dryRun ? 'Checking…' : 'Syncing…'
    );
  };

  /* --------------------------------------------------------- sync status */

  actions.syncRow = function (name, iconName, s, extra) {
    const st = s && s.status ? s.status : 'idle';
    const label = { ok: 'OK', partial: 'Partial', error: 'Error', idle: 'Never run' }[st] || st;
    return (
      '<div class="sync__row"><span class="sync__ic">' + icon(iconName, 18) + '</span><div class="sync__main">' +
      '<div class="sync__name">' + esc(name) + '<span class="pill pill--' + (st === 'ok' ? 'published' : st === 'error' ? 'soldout' : st === 'partial' ? 'pending' : 'draft') + '">' + A.stockDot(st === 'ok' ? 'instock' : st === 'error' ? 'soldout' : st === 'partial' ? 'low' : 'idle') + esc(label) + '</span></div>' +
      (s && s.message ? '<p class="sync__msg" title="' + esc(s.message) + '">' + esc(s.message) + '</p>' : '<p class="sync__msg">' + esc(extra || 'No sync has run yet.') + '</p>') +
      (s && s.at ? '<div class="sync__meta">' + esc('Last run ' + A.ago(s.at) + ' · ' + A.dateTime(s.at)) + (s.source ? ' · ' + esc(s.source) : '') + (s.trigger ? ' · ' + esc(s.trigger) : '') + '</div>' : '') +
      '</div></div>'
    );
  };

  /* ---------------------------------------------------- product actions */

  /** Set status on several products (server: PUT each). Returns number changed. */
  actions.setProductStatus = async function (products, status) {
    let n = 0;
    for (const p of products) {
      if (p.status === status) continue;
      await A.data.saveProduct(p.id, Object.assign({}, p, { status }));
      n++;
    }
    return n;
  };
})();
