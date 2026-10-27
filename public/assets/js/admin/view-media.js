/* ==========================================================================
   Cola Studio — Admin · Media library
   Server: files in /uploads. Demo mode: images stored inline in this browser.
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;
  const QUOTA = 5 * 1024 * 1024; // typical localStorage budget (characters ≈ bytes for ASCII)

  function usageMap(products, updates) {
    const map = new Map();
    const add = (url, label, href) => {
      if (!url) return;
      if (!map.has(url)) map.set(url, []);
      map.get(url).push({ label, href });
    };
    products.forEach((p) => (p.images || []).forEach((img) => add(img.url, p.name, '/products/' + encodeURIComponent(p.id) + '?section=images')));
    updates.forEach((u) => (u.media || []).forEach((m) => add(m.url, u.title || 'Update', '/updates/' + encodeURIComponent(u.id))));
    return map;
  }

  A.views.media = {
    title: 'Media library',
    skeleton: 'table',
    async render(root, params, ctx) {
      const server = A.data.mode === 'server';
      let [products, updates] = await Promise.all([A.data.getProducts(), A.data.getUpdates()]);
      let uploads = server ? await A.data.getUploads() : [];
      if (ctx.stale()) return null;

      function drawServer() {
        const used = usageMap(products, updates);
        const total = uploads.reduce((n, u) => n + (u.size || 0), 0);
        root.innerHTML =
          '<header class="page-head"><div class="page-head__text"><h1>' + A.heading('Media library', uploads.length) + '</h1><p class="lead">Files uploaded through the admin, served from <code>/uploads/</code> · ' + esc(A.bytes(total)) + ' in total.</p></div>' +
          '<div class="page-actions"><button type="button" class="btn btn--primary" data-act="upload">' + icon('upload', 16) + 'Upload images</button></div></header>' +
          (uploads.length
            ? '<div class="lib">' +
              uploads
                .slice()
                .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
                .map((u) => {
                  const refs = used.get(u.url) || [];
                  return (
                    '<div class="lib-item" data-name="' + esc(u.name) + '"><a class="lib-item__media" href="' + esc(u.url) + '" target="_blank" rel="noopener">' + (/^image\//.test(u.type) ? '<img src="' + esc(u.url) + '" alt="" loading="lazy">' : icon('media', 28)) + '</a>' +
                    '<div class="lib-item__body"><span class="lib-item__name" title="' + esc(u.name) + '">' + esc(u.name) + '</span><span class="lib-item__meta">' + esc(A.bytes(u.size) + ' · ' + A.date(u.modifiedAt)) + '</span>' +
                    '<span class="lib-item__meta">' + (refs.length ? 'Used by <a href="' + A.href(refs[0].href) + '">' + esc(refs[0].label) + '</a>' + (refs.length > 1 ? ' +' + (refs.length - 1) : '') : '<span class="faint">Not used</span>') + '</span></div>' +
                    '<div class="lib-item__actions"><button type="button" class="icon-btn icon-btn--sm" data-act="copy" aria-label="Copy URL" title="Copy URL">' + icon('copy', 15) + '</button>' +
                    '<a class="icon-btn icon-btn--sm" href="' + esc(u.url) + '" target="_blank" rel="noopener" aria-label="Open" title="Open">' + icon('external', 15) + '</a><span class="sp"></span>' +
                    '<button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="delete" aria-label="Delete" title="Delete">' + icon('trash', 15) + '</button></div></div>'
                  );
                })
                .join('') +
              '</div>'
            : '<div class="card">' + ui.empty({ icon: 'media', title: 'No uploads yet', body: 'Images you upload in the product editor or here appear in this library.', actions: '<button type="button" class="btn btn--primary" data-act="upload">' + icon('upload', 16) + 'Upload images</button>' }) + '</div>');
      }

      function drawStatic() {
        const info = A.data.overlayInfo();
        const pct = Math.min(100, Math.round((info.chars / QUOTA) * 100));
        const inline = [];
        products.forEach((p) => (p.images || []).forEach((img, i) => String(img.url).startsWith('data:') && inline.push({ url: img.url, label: p.name, href: '/products/' + encodeURIComponent(p.id) + '?section=images', size: Math.round((img.url.length * 3) / 4), i })));
        updates.forEach((u) => (u.media || []).forEach((m) => String(m.url || '').startsWith('data:') && inline.push({ url: m.url, label: u.title || 'Update', href: '/updates/' + encodeURIComponent(u.id), size: Math.round((m.url.length * 3) / 4) })));
        root.innerHTML =
          '<header class="page-head"><div class="page-head__text"><h1>' + A.heading('Media library', inline.length) + '</h1><p class="lead">In demo mode, uploaded images are resized and stored inside this browser together with your other edits.</p></div></header>' +
          '<div class="card" style="margin-bottom:20px"><div class="card__head"><span class="card__title">Browser storage</span><span class="small muted">' + esc(A.bytes(info.chars) + ' of ~5 MB') + '</span></div><div class="card__body stack--sm stack">' +
          '<div class="meter"><div class="meter__bar' + (pct > 85 ? ' meter__bar--danger' : pct > 60 ? ' meter__bar--warn' : '') + '" style="width:' + Math.max(pct, 1) + '%"></div></div>' +
          '<p class="small muted mb-0">' + (pct > 85 ? 'Almost full — remove some images or export your data.' : 'Images are the largest part of the demo data. Use image URLs instead of uploads to save space.') + '</p></div></div>' +
          (inline.length
            ? '<div class="lib">' + inline.map((m) => '<div class="lib-item"><div class="lib-item__media"><img src="' + esc(m.url) + '" alt="" loading="lazy"></div><div class="lib-item__body"><span class="lib-item__name">' + esc(m.label) + '</span><span class="lib-item__meta">Inline · ' + esc(A.bytes(m.size)) + '</span></div><div class="lib-item__actions"><a class="btn btn--xs btn--ghost" href="' + A.href(m.href) + '">Open' + icon('chevronRight', 13) + '</a></div></div>').join('') + '</div>'
            : '<div class="card">' + ui.empty({ icon: 'media', title: 'No uploaded images', body: 'Products without photos show their garment illustration. Upload photos in the product editor.', actions: '<a class="btn btn--secondary" href="' + A.href('/products') + '">Go to products</a>' }) + '</div>') +
          '<p class="hint" style="margin-top:16px">With the server running, uploads are stored as files in <code>/uploads/</code> and listed here.</p>';
      }

      const draw = () => (server ? drawServer() : drawStatic());

      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const item = b.closest('[data-name]');
        const u = item ? uploads.find((x) => x.name === item.dataset.name) : null;
        if (b.dataset.act === 'upload') {
          const files = await ui.pickFiles({ accept: 'image/*', multiple: true });
          if (!files.length) return;
          let n = 0;
          await ui.busy(b, async () => {
            for (const f of files) {
              try {
                await A.data.upload(f);
                n++;
              } catch (err) {
                ui.error(err, f.name);
              }
            }
          }, 'Uploading…');
          uploads = await A.data.getUploads();
          draw();
          if (n) ui.toast(A.plural(n, 'image') + ' uploaded');
        } else if (b.dataset.act === 'copy' && u) {
          ui.copy(new URL(u.url, location.origin).href, 'Image URL');
        } else if (b.dataset.act === 'delete' && u) {
          const refs = usageMap(products, updates).get(u.url) || [];
          const ok = await ui.confirm({
            title: 'Delete ' + u.name + '?',
            body: refs.length ? '<b>It is still used by ' + esc(refs.map((r) => r.label).join(', ')) + '.</b> Those pages will show a broken image until you remove it there.' : 'The file is removed from the server.',
            confirmText: 'Delete file',
            danger: true,
          });
          if (!ok) return;
          try {
            await A.data.deleteUpload(u.name);
            uploads = uploads.filter((x) => x.name !== u.name);
            draw();
            ui.toast('Deleted ' + u.name);
          } catch (err) {
            ui.error(err);
          }
        }
      });

      draw();
      return null;
    },
  };
})();
