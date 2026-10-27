/* ==========================================================================
   Cola Studio — Admin · Backup, import/export and logs
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;
  const LABEL = { settings: 'Settings', categories: 'Categories', products: 'Products', updates: 'Studio updates', inventoryEvents: 'Stock history', messages: 'Messages', orders: 'Orders', notify: 'Restock requests' };

  A.views.backup = {
    title: 'Backup & logs',
    skeleton: 'form',
    async render(root, params, ctx) {
      const server = A.data.mode === 'server';
      let logs = [];
      let logTimer = null;
      const lf = { level: '', q: '' };

      function exportCard() {
        if (server) {
          return (
            '<div class="card"><div class="card__head"><span class="card__title">Export</span></div><div class="card__body stack">' +
            '<p class="muted mb-0">Downloads everything — settings, categories, products, updates, stock history, messages, orders and restock requests — as one JSON file. Secrets from Integrations are never included.</p>' +
            '<div class="row row--wrap"><button type="button" class="btn btn--primary" data-act="export">' + icon('download', 16) + 'Download full backup</button>' +
            '<button type="button" class="btn btn--secondary" data-act="export-xlsx">' + icon('sheet', 16) + 'Products as spreadsheet</button></div>' +
            '<p class="hint mb-0">The server also keeps automatic daily snapshots, plus one before every import.</p></div></div>'
          );
        }
        return (
          '<div class="card"><div class="card__head"><span class="card__title">Export JSON</span></div><div class="card__body stack">' +
          '<p class="muted mb-0">Download a collection and replace the matching file in <code>public/data/</code> on your static host to publish your demo edits.</p>' +
          '<div class="row row--wrap">' +
          ['products', 'categories', 'settings', 'updates'].map((k) => '<button type="button" class="btn btn--secondary" data-act="export-col" data-key="' + k + '">' + icon('download', 16) + k + '.json</button>').join('') +
          '<button type="button" class="btn btn--secondary" data-act="export-xlsx">' + icon('sheet', 16) + 'products.xlsx</button>' +
          '</div><hr style="margin:4px 0"><div class="row row--wrap"><button type="button" class="btn btn--primary" data-act="export">' + icon('download', 16) + 'Full backup (all collections)</button><span class="small faint">Can be imported here or on the server.</span></div></div></div>'
        );
      }

      function importCard() {
        return (
          '<div class="card"><div class="card__head"><span class="card__title">Import</span></div><div class="card__body stack">' +
          '<p class="muted mb-0">' + (server ? 'Restore a backup made with Export. Collections in the file replace the current ones; a snapshot of the current data is saved first.' : 'Load a full backup or a single <code>products.json</code>, <code>categories.json</code>, <code>settings.json</code> or <code>updates.json</code>. It replaces that collection in this browser.') + '</p>' +
          '<div class="drop" data-drop>' + icon('upload', 22) + '<span class="drop__text"><b>Drop a .json file</b> or</span><button type="button" class="btn btn--sm btn--secondary" data-act="import">Choose file</button></div>' +
          '</div></div>'
        );
      }

      function storageCard() {
        const info = A.data.overlayInfo();
        return (
          '<div class="card"><div class="card__head"><span class="card__title">Demo data in this browser</span></div><div class="card__body stack">' +
          (info.present
            ? '<dl class="dl mb-0"><dt>Edited</dt><dd>' + esc(info.keys.map((k) => LABEL[k] || k).join(', ') || '—') + '</dd><dt>Size</dt><dd>' + esc(A.bytes(info.chars)) + ' of ~5 MB</dd><dt>Last change</dt><dd>' + esc(info.updatedAt ? A.dateTime(info.updatedAt) + ' (' + A.ago(info.updatedAt) + ')' : '—') + '</dd><dt>Key</dt><dd><code>localStorage["' + esc(A.data.OVERLAY_KEY) + '"]</code></dd></dl>'
            : '<p class="muted mb-0">No changes yet — the admin and the public site show the original JSON files.</p>') +
          '<p class="small muted mb-0">The public site reads this overlay in the same browser, so your edits show up there immediately.</p>' +
          '<div><button type="button" class="btn btn--danger" data-act="reset"' + (info.present ? '' : ' disabled') + '>' + icon('refresh', 16) + 'Reset demo data</button></div></div></div>'
        );
      }

      function demoCard() {
        return (
          '<div class="card" data-demo-card><div class="card__head"><span class="card__title">Demo content</span></div><div class="card__body stack">' +
          '<p class="muted mb-0">The site ships with fictional demo products and posts (marked “demo”). Remove them once your own products are in. Demo posts already hide themselves on the site as soon as real Weibo posts arrive.</p>' +
          '<div data-demo-info class="small muted">Checking…</div>' +
          '<div class="row row--wrap"><button type="button" class="btn btn--danger" data-act="demo-clear" disabled>' + icon('trash', 16) + 'Remove all demo content</button>' +
          '<button type="button" class="btn btn--secondary" data-act="demo-updates" disabled>Only demo posts</button></div>' +
          '<p class="hint mb-0">A snapshot is saved first, so this can be undone by importing a backup.</p></div></div>'
        );
      }
      async function loadDemo() {
        const host = root.querySelector('[data-demo-info]');
        if (!host) return;
        try {
          const d = await A.data.getDemo();
          const total = d.products + d.updates + d.inventoryEvents;
          host.innerHTML = total || d.demoMode
            ? esc(A.plural(d.products, 'demo product') + ' · ' + A.plural(d.updates, 'demo post') + ' · ' + A.plural(d.inventoryEvents, 'demo stock event')) + (d.demoMode ? ' · demo label shown on the site' : '')
            : 'No demo content left.';
          root.querySelector('[data-act="demo-clear"]').disabled = !(total || d.demoMode);
          root.querySelector('[data-act="demo-updates"]').disabled = !d.updates;
        } catch (e) {
          host.textContent = 'Could not check demo content.';
        }
      }

      function logsCard() {
        return (
          '<div class="card"><div class="card__head"><span class="card__title">Server log <span class="count" data-log-count></span></span><div class="row">' +
          '<label class="row small muted" style="gap:8px">' + '<input type="checkbox" class="check" data-log-auto> Auto-refresh</label>' +
          '<button type="button" class="btn btn--sm btn--secondary" data-act="logs">' + icon('refresh', 15) + 'Refresh</button></div></div>' +
          '<div class="toolbar"><label class="search">' + icon('search', 16) + '<input class="input" type="search" data-log-q placeholder="Filter log lines" aria-label="Filter log"></label>' +
          ui.segmented('log-level', [{ value: '', label: 'All' }, { value: 'info', label: 'Info' }, { value: 'warn', label: 'Warnings' }, { value: 'error', label: 'Errors' }], '', 'aria-label="Level"') + '</div>' +
          '<div class="console" style="border-radius:0"><pre class="console__body logs" style="max-height:520px" data-logs><span class="ln ln--muted">Loading…</span></pre></div></div>'
        );
      }

      root.innerHTML =
        '<header class="page-head"><div class="page-head__text"><h1>' + A.heading(server ? 'Backup & logs' : 'Backup') + '</h1><p class="lead">' + (server ? 'Export or restore all content, and read what the server has been doing.' : 'Export your demo edits as JSON, import files, or start over.') + '</p></div></header>' +
        '<div class="grid grid--2">' + exportCard() + importCard() + '</div>' +
        (server ? '<div style="margin-top:20px">' + demoCard() + '</div><div style="margin-top:20px">' + logsCard() + '</div>' : '<div style="margin-top:20px">' + storageCard() + '</div>');
      if (server) loadDemo();

      function drawLogs() {
        const host = root.querySelector('[data-logs]');
        if (!host) return;
        const q = lf.q.toLowerCase();
        const list = logs.filter((l) => (!lf.level || l.level === lf.level) && (!q || (l.message + ' ' + l.scope).toLowerCase().includes(q)));
        root.querySelector('[data-log-count]').textContent = list.length + (list.length !== logs.length ? ' / ' + logs.length : '');
        host.innerHTML = list.length
          ? list
              .slice()
              .reverse()
              .map((l) => '<span class="log-line"><span class="log-line__at">' + esc(A.dateTime(l.at)) + '</span><span class="log-line__lvl--' + esc(l.level) + '">' + esc(String(l.level || '').toUpperCase()) + '</span><span class="log-line__scope">' + esc(l.scope || '') + '</span><span>' + esc(l.message) + '</span></span>')
              .join('')
          : '<span class="ln ln--muted">No log lines' + (lf.level || lf.q ? ' match the filter' : '') + '.</span>';
      }
      async function loadLogs(btn) {
        try {
          logs = await (btn ? ui.busy(btn, () => A.data.getLogs()) : A.data.getLogs());
          drawLogs();
        } catch (e) {
          if (!btn) return;
          ui.error(e, 'Could not load logs');
        }
      }

      async function handleFile(file) {
        if (!file) return;
        let json;
        try {
          json = JSON.parse(await ui.readAsText(file));
        } catch (e) {
          return ui.toast(file.name + ' is not valid JSON', { type: 'error' });
        }
        const det = A.data.detectImport(json, file.name);
        if (!det) return ui.toast('Could not recognise ' + file.name + ' — expected a backup or a products/categories/settings/updates file', { type: 'error' });
        const keys = server ? det.keys : det.keys.filter((k) => ['settings', 'categories', 'products', 'updates', 'inventoryEvents'].includes(k));
        const ok = await ui.confirm({
          title: 'Import ' + file.name + '?',
          body:
            'This replaces: <b>' + esc(keys.map((k) => LABEL[k] + (Array.isArray(det.data[k]) ? ' (' + det.data[k].length + ')' : '')).join(', ')) + '</b>.' +
            (server ? ' A snapshot of the current data is saved on the server first.' : ' Export first if you want to keep your current demo edits.'),
          confirmText: 'Import',
          danger: true,
        });
        if (!ok) return;
        try {
          const payload = {};
          keys.forEach((k) => (payload[k] = det.data[k]));
          const r = await A.data.importData(server ? det.data : payload);
          ui.toast('Imported ' + Object.entries(r.imported || {}).map(([k, n]) => (LABEL[k] || k) + (n > 1 ? ' (' + n + ')' : '')).join(', '));
          if (A.app.renderBanners) A.app.renderBanners();
          A.app.refreshBadges();
          A.router.refresh();
        } catch (e) {
          ui.error(e, 'Import failed');
        }
      }

      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        try {
          if (act === 'demo-clear' || act === 'demo-updates') {
            const onlyPosts = act === 'demo-updates';
            const ok = await ui.confirm({
              title: onlyPosts ? 'Remove demo posts?' : 'Remove all demo content?',
              body: onlyPosts
                ? 'Deletes the fictional studio updates marked “demo”. Real Weibo posts stay.'
                : 'Deletes every demo product, demo post and demo stock event, and turns off the demo label on the site. Your own products and posts stay.',
              confirmText: 'Remove',
              danger: true,
            });
            if (!ok) return;
            const r = await ui.busy(b, () => A.data.clearDemo(onlyPosts ? ['updates'] : null));
            ui.toast('Demo content removed' + (r.backup ? ' — snapshot saved' : ''));
            if (A.app.renderBanners) A.app.renderBanners();
            A.app.refreshBadges();
            loadDemo();
            return;
          }
          if (act === 'export') {
            const r = await ui.busy(b, () => A.data.exportBackup());
            ui.download(r.filename, r.blob);
            ui.toast('Backup downloaded');
          } else if (act === 'export-xlsx') {
            await ui.busy(b, () => A.productSheetUi.downloadSheet(false));
          } else if (act === 'export-col') {
            const r = await A.data.exportCollection(b.dataset.key);
            ui.download(r.filename, r.blob);
            ui.toast(r.filename + ' downloaded');
          } else if (act === 'import') {
            const [file] = await ui.pickFiles({ accept: 'application/json,.json' });
            handleFile(file);
          } else if (act === 'reset') {
            await A.app.resetDemo();
          } else if (act === 'logs') loadLogs(b);
        } catch (err) {
          ui.error(err);
        }
      });
      const drop = root.querySelector('[data-drop]');
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('is-over');
      }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        handleFile(f);
      });

      if (server) {
        root.querySelector('[data-log-q]').addEventListener('input', A.debounce((e) => {
          lf.q = e.target.value;
          drawLogs();
        }, 120));
        root.querySelector('.toolbar .seg').addEventListener('change', (e) => {
          lf.level = e.target.value;
          drawLogs();
        });
        root.querySelector('[data-log-auto]').addEventListener('change', (e) => {
          clearInterval(logTimer);
          if (e.target.checked) logTimer = setInterval(() => !document.hidden && loadLogs(), 5000);
        });
        loadLogs();
      }

      return { destroy: () => clearInterval(logTimer) };
    },
  };
})();
