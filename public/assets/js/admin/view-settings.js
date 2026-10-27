/* ==========================================================================
   Cola Studio — Admin · Settings (public site settings)
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;

  const SECTIONS = [
    { id: 'brand', label: 'Brand' },
    { id: 'announcement', label: 'Announcement' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'agents', label: 'Agents & Weidian' },
    { id: 'currency', label: 'Currency' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'drop', label: 'Next drop' },
    { id: 'social', label: 'Social links' },
    { id: 'shipping', label: 'Shipping' },
    { id: 'seo', label: 'SEO' },
    { id: 'demo', label: 'Demo mode' },
  ];
  const KNOWN_CURRENCIES = ['CNY', 'EUR', 'USD', 'GBP', 'AUD', 'CAD', 'CHF', 'JPY', 'HKD', 'SEK', 'DKK', 'NOK', 'PLN', 'SGD', 'NZD', 'KRW'];
  const SOCIAL = [
    ['instagram', 'Instagram', 'https://instagram.com/colastudio'],
    ['weibo', 'Weibo', 'https://weibo.com/u/…'],
    ['tiktok', 'TikTok', 'https://tiktok.com/@colastudio'],
    ['whatsappChannel', 'WhatsApp channel', 'https://whatsapp.com/channel/…'],
    ['discord', 'Discord', 'https://discord.gg/…'],
    ['xiaohongshu', 'Xiaohongshu (RED)', 'https://xiaohongshu.com/user/profile/…'],
  ];

  function withDefaults(s) {
    const x = A.clone(s || {});
    x.brand = Object.assign({ name: 'Cola Studio', tagline: '', domain: '', email: '', established: '' }, x.brand || {});
    x.announcement = Object.assign({ enabled: false, text: '', link: '' }, x.announcement || {});
    x.currency = Object.assign({ base: 'CNY', default: 'EUR', available: ['CNY', 'EUR', 'USD', 'GBP'], rates: { CNY: 1 }, autoUpdate: false, updatedAt: null }, x.currency || {});
    x.currency.rates = Object.assign({ CNY: 1 }, x.currency.rates || {});
    x.inventory = Object.assign({ lowStockThreshold: 5, refreshSeconds: 30 }, x.inventory || {});
    x.whatsapp = Object.assign({ number: '', enabled: true, greeting: '', orderPrefix: 'CS' }, x.whatsapp || {});
    x.agents = Array.isArray(x.agents) ? x.agents : [];
    x.weidian = Object.assign({ shopUrl: '', itemUrlTemplate: 'https://weidian.com/item.html?itemID={itemId}' }, x.weidian || {});
    x.social = Object.assign({}, x.social || {});
    x.nextDrop = Object.assign({ enabled: false, title: '', subtitle: '', date: '' }, x.nextDrop || {});
    x.shipping = Object.assign({ regions: [], note: '' }, x.shipping || {});
    x.shipping.regions = Array.isArray(x.shipping.regions) ? x.shipping.regions : [];
    x.seo = Object.assign({ title: '', description: '' }, x.seo || {});
    return x;
  }

  A.views.settings = {
    title: 'Settings',
    skeleton: 'form',
    async render(root, params, ctx) {
      const [raw, products] = await Promise.all([A.data.getSettings(), A.data.getProducts().catch(() => [])]);
      if (ctx.stale()) return null;
      let s = withDefaults(raw);
      let baseline = JSON.stringify(s);
      let leaving = false;
      let sortables = [];
      const sample = products.find((p) => p.status === 'published') || products[0] || { slug: 'heavyweight-hoodie', name: 'Heavyweight Hoodie', weidian: {} };
      const sampleItemId = (sample.weidian && sample.weidian.itemId) || '7781234567';

      const card = (id, title, desc, bodyHtml, headHtml) =>
        '<section class="card ed-section" id="set-' + id + '" data-sec="' + id + '"><div class="ed-section__head"><div><h2>' + esc(title) + '</h2>' + (desc ? '<p>' + desc + '</p>' : '') + '</div>' + (headHtml ? '<div class="row">' + headHtml + '</div>' : '') + '</div><div class="ed-section__body" data-body="' + id + '">' + bodyHtml + '</div></section>';
      const input = (path, o) => {
        const opt = o || {};
        const v = A.getPath(s, path);
        return '<input class="input' + (opt.cls ? ' ' + opt.cls : '') + '" id="s-' + path.replace(/\./g, '-') + '" data-s="' + path + '"' + (opt.type ? ' type="' + opt.type + '"' : '') + (opt.dtype ? ' data-type="' + opt.dtype + '"' : '') + ' value="' + esc(v == null ? '' : v) + '"' + (opt.ph ? ' placeholder="' + esc(opt.ph) + '"' : '') + (opt.attrs ? ' ' + opt.attrs : '') + '>';
      };
      const f = (label, path, o) => ui.field(label, input(path, o), Object.assign({ for: 's-' + path.replace(/\./g, '-') }, o || {}));

      function agentsHtml() {
        return (
          '<div data-agents>' +
          (s.agents.length
            ? s.agents
                .map(
                  (a, i) =>
                    '<div class="agent-card" data-sort-id="' + i + '"><div class="agent-card__head"><button type="button" class="handle" aria-label="Drag to reorder" tabindex="-1">' + icon('grip', 16) + '</button><b>' + esc(a.name || 'New agent') + '</b>' +
                    (a.recommended ? '<span class="pill pill--outline">Recommended</span>' : '') + (a.enabled === false ? '<span class="pill pill--archived">Disabled</span>' : '') +
                    '<span class="sp"></span><button type="button" class="icon-btn icon-btn--sm" data-act="agent-up" data-i="' + i + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + icon('arrowUp', 15) + '</button>' +
                    '<button type="button" class="icon-btn icon-btn--sm" data-act="agent-down" data-i="' + i + '" aria-label="Move down"' + (i === s.agents.length - 1 ? ' disabled' : '') + '>' + icon('arrowDown', 15) + '</button>' +
                    '<button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="agent-del" data-i="' + i + '" aria-label="Remove agent">' + icon('trash', 15) + '</button></div>' +
                    '<div class="agent-card__body"><div class="form-grid">' +
                    ui.field('Name', '<input class="input" data-agent="name" data-i="' + i + '" value="' + esc(a.name || '') + '" placeholder="e.g. Agent One">') +
                    ui.field('ID', '<input class="input mono" data-agent="id" data-i="' + i + '" value="' + esc(a.id || '') + '" placeholder="agent-1" spellcheck="false">', { hint: 'Used for per-product link overrides — avoid changing it.' }) +
                    ui.field('Description', '<input class="input" data-agent="description" data-i="' + i + '" value="' + esc(a.description || '') + '" placeholder="e.g. QC photos · consolidated shipping">', { cls: 'span-2' }) +
                    ui.field('URL template', '<input class="input mono" style="font-size:12.5px" data-agent="urlTemplate" data-i="' + i + '" value="' + esc(a.urlTemplate || '') + '" placeholder="https://agent.example/item?url={weidianUrl}" spellcheck="false">', {
                      cls: 'span-2',
                      hint: 'Placeholders: <code>{weidianUrl}</code> <code>{itemId}</code> <code>{slug}</code> <code>{name}</code> — values are URL-encoded. Products can override the link individually.',
                    }) +
                    '<div class="field span-2"><div class="label">Example</div><div class="example" data-agent-example="' + i + '"></div></div>' +
                    '<div class="field">' + ui.toggle('data-agent="enabled" data-i="' + i + '"', a.enabled !== false, 'Enabled', 'Shown as an ordering option') + '</div>' +
                    '<div class="field">' + ui.toggle('data-agent="recommended" data-i="' + i + '"', !!a.recommended, 'Recommended', 'Highlighted on product pages') + '</div>' +
                    '</div></div></div>'
                )
                .join('')
            : '<div class="rep__empty">No agents yet.</div>') +
          '</div><button type="button" class="btn btn--sm btn--secondary rep__add" data-act="agent-add">' + icon('plus', 15) + 'Add agent</button>'
        );
      }

      function ratesHtml() {
        const c = s.currency;
        return (
          '<table class="rates"><thead><tr><th>Currency</th><th>1 CNY =</th><th>Inverse</th><th>Example: ¥459</th></tr></thead><tbody>' +
          c.available
            .map((code) => {
              const r = code === 'CNY' ? 1 : c.rates[code];
              const ok = Number(r) > 0;
              return (
                '<tr><td><b>' + esc(code) + '</b>' + (code === c.default ? ' <span class="pill pill--outline">Default</span>' : '') + (code === 'CNY' ? ' <span class="faint small">base</span>' : '') + '</td>' +
                '<td>' + (code === 'CNY' ? '<span class="muted">1</span>' : '<input class="input input--num" type="number" min="0" step="0.0001" data-rate="' + esc(code) + '" value="' + esc(r == null ? '' : r) + '" aria-label="Rate for ' + esc(code) + '">') + '</td>' +
                '<td class="muted small" data-inv="' + esc(code) + '">' + (ok ? esc('1 ' + code + ' = ¥' + A.num(1 / r, 2)) : '<span class="diff-down">Missing rate</span>') + '</td>' +
                '<td class="small" data-ex="' + esc(code) + '">' + (ok ? esc(A.money(459 * r, code)) : '—') + '</td></tr>'
              );
            })
            .join('') +
          '</tbody></table>'
        );
      }

      function shippingHtml() {
        return (
          '<div class="rep" data-ship>' +
          (s.shipping.regions.length
            ? '<div class="ship-row small muted" style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:500"><span></span><span>Region</span><span>Delivery time</span><span></span></div>' +
              s.shipping.regions
                .map(
                  (r, i) =>
                    '<div class="ship-row" data-sort-id="' + i + '"><button type="button" class="handle" aria-label="Drag to reorder" tabindex="-1">' + icon('grip', 16) + '</button>' +
                    '<input class="input" data-ship="region" data-i="' + i + '" value="' + esc(r.region || '') + '" placeholder="Region" aria-label="Region">' +
                    '<input class="input" data-ship="time" data-i="' + i + '" value="' + esc(r.time || '') + '" placeholder="e.g. 7–12 days" aria-label="Delivery time">' +
                    '<button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="ship-del" data-i="' + i + '" aria-label="Remove region">' + icon('x', 15) + '</button></div>'
                )
                .join('')
            : '<div class="rep__empty">No regions yet.</div>') +
          '</div><button type="button" class="btn btn--sm btn--secondary rep__add" data-act="ship-add">' + icon('plus', 15) + 'Add region</button>'
        );
      }

      function draw() {
        const c = s.currency;
        const extraSocial = Object.keys(s.social).filter((k) => !SOCIAL.some(([key]) => key === k));
        root.innerHTML =
          '<header class="page-head"><div class="page-head__text"><h1>' + A.heading('Settings') + '</h1><p class="lead">Public settings used across the site. ' + (A.data.mode === 'server' ? 'Private keys live under <a href="' + A.href('/integrations') + '">Integrations</a>.' : 'In demo mode they are saved in this browser.') + '</p></div></header>' +
          '<div class="set-layout"><nav class="secnav" aria-label="Sections">' + SECTIONS.map((x) => '<a class="secnav__link" href="' + A.href('/settings?section=' + x.id) + '" data-goto="' + x.id + '"><span>' + esc(x.label) + '</span></a>').join('') + '</nav>' +
          '<form class="set-main stack" novalidate autocomplete="off">' +
          card('brand', 'Brand', 'How the studio is named across the site and in metadata.',
            '<div class="form-grid">' + f('Name', 'brand.name') + f('Tagline', 'brand.tagline', { ph: 'International Fashion Studio' }) + f('Domain', 'brand.domain', { ph: 'colastudio.com' }) + f('Email', 'brand.email', { type: 'email', ph: 'studio@colastudio.com' }) + f('Established', 'brand.established', { ph: '2019' }) + '</div>') +
          card('announcement', 'Announcement bar', 'A single line above the header on every page.',
            '<div class="stack">' + ui.toggle('data-s="announcement.enabled" data-type="bool"', !!s.announcement.enabled, 'Show the announcement bar') +
            ui.field('Text', input('announcement.text', { ph: 'e.g. Vol. 04 drops 14.11 · Worldwide shipping', attrs: 'maxlength="200"' }), { for: 's-announcement-text', aside: '<span data-count-for="announcement.text">' + (s.announcement.text || '').length + ' / 120</span>' }) +
            f('Link', 'announcement.link', { ph: 'updates  or  https://…', hint: 'A page path like <code>live-stock</code> or <code>/products</code>, or a full URL. Leave empty for plain text.' }) + '</div>') +
          card('whatsapp', 'WhatsApp ordering', 'Customers send their order as a pre-filled WhatsApp message.',
            '<div class="form-grid">' + '<div class="field span-2">' + ui.toggle('data-s="whatsapp.enabled" data-type="bool"', s.whatsapp.enabled !== false, 'WhatsApp ordering enabled') + '</div>' +
            ui.field('Number', '<div class="ig"><span class="ig__pre">+</span>' + input('whatsapp.number', { ph: '31600000000', attrs: 'inputmode="numeric" maxlength="18"' }) + '</div>', { for: 's-whatsapp-number', hint: '<span data-wa-hint>International format, digits only — country code first, no + or spaces.</span>' }) +
            f('Order prefix', 'whatsapp.orderPrefix', { ph: 'CS', hint: 'Order references look like <code>' + esc((s.whatsapp.orderPrefix || 'CS') + '-K3F9Q2') + '</code>.', attrs: 'maxlength="8"' }) +
            f('Greeting', 'whatsapp.greeting', { cls: '', ph: 'Hello Cola Studio', hint: 'The first line of every message.' }) +
            '<div class="field span-2"><div class="label">Link preview</div><div class="example" data-wa-preview></div></div>' + '</div>') +
          card('agents', 'Agents & Weidian', 'Buying agents customers can order through, and how Weidian links are built.',
            '<div class="form-grid" style="margin-bottom:22px">' + f('Weidian shop URL', 'weidian.shopUrl', { ph: 'https://weidian.com/?userid=…' }) +
            f('Item URL template', 'weidian.itemUrlTemplate', { cls: 'mono', ph: 'https://weidian.com/item.html?itemID={itemId}', hint: 'Builds a product’s Weidian link from its item ID. Placeholder: <code>{itemId}</code>.' }) + '</div>' +
            '<div class="ed-sub__title">Agents</div>' + agentsHtml()) +
          card('currency', 'Currency', 'Prices are stored in CNY and converted for visitors.',
            '<div class="form-grid">' +
            ui.field('Default currency', '<select class="input" id="s-cur-default" data-s="currency.default">' + ui.options(c.available, c.default) + '</select>', { for: 's-cur-default', hint: 'What first-time visitors see.' }) +
            '<div class="field">' + ui.toggle('data-s="currency.autoUpdate" data-type="bool"', !!c.autoUpdate, 'Update rates automatically', A.data.mode === 'server' ? 'Once a day from open.er-api.com — manual rates are overwritten.' : 'Runs on the server only.') + '</div>' +
            ui.field('Available currencies', '<div class="chips">' + KNOWN_CURRENCIES.map((code) => '<button type="button" class="chip" data-cur="' + code + '" aria-pressed="' + c.available.includes(code) + '"' + (code === 'CNY' ? ' disabled title="CNY is the base currency"' : '') + '>' + code + '</button>').join('') + '</div>', { cls: 'span-2' }) +
            '<div class="field span-2"><div class="label">Exchange rates<span class="label__aside" data-rates-updated>' + esc(c.updatedAt ? 'Updated ' + A.dateTime(c.updatedAt) : 'Never updated') + '</span></div><div data-rates>' + ratesHtml() + '</div></div>' +
            '</div>') +
          card('inventory', 'Inventory', 'How stock is labelled and refreshed on the live-stock page.',
            '<div class="form-grid">' + f('Low-stock threshold', 'inventory.lowStockThreshold', { type: 'number', dtype: 'num', attrs: 'min="0" step="1"', hint: 'At or below this many units a size shows “Low stock”.' }) +
            f('Live refresh (seconds)', 'inventory.refreshSeconds', { type: 'number', dtype: 'num', attrs: 'min="5" step="1"', hint: 'How often the live-stock page polls for changes.' }) + '</div>') +
          card('drop', 'Next drop', 'Countdown shown on the homepage.',
            '<div class="form-grid"><div class="field span-2">' + ui.toggle('data-s="nextDrop.enabled" data-type="bool"', !!s.nextDrop.enabled, 'Show the countdown') + '</div>' +
            f('Title', 'nextDrop.title', { cls: '', ph: 'Vol. 04 — Winter Construction' }) +
            ui.field('Date & time', '<input class="input" type="datetime-local" id="s-drop-date" data-drop-date value="' + esc(A.toLocalInput(s.nextDrop.date)) + '">', { for: 's-drop-date', hint: '<span data-drop-hint>' + esc(s.nextDrop.date ? 'Your local time · ' + A.ago(s.nextDrop.date) : 'Your local time') + '</span>' }) +
            ui.field('Subtitle', '<textarea class="input" id="s-nextDrop-subtitle" data-s="nextDrop.subtitle" rows="2" style="min-height:64px">' + esc(s.nextDrop.subtitle || '') + '</textarea>', { cls: 'span-2', for: 's-nextDrop-subtitle' }) + '</div>') +
          card('social', 'Social links', 'Shown in the footer. Leave empty to hide.',
            '<div class="form-grid">' + SOCIAL.map(([k, label, ph]) => f(label, 'social.' + k, { ph })).join('') + extraSocial.map((k) => f(k, 'social.' + k)).join('') + '</div>') +
          card('shipping', 'Shipping', 'Indicative delivery times after dispatch.',
            shippingHtml() + '<div style="margin-top:18px">' + ui.field('Note', '<textarea class="input" id="s-shipping-note" data-s="shipping.note" rows="2" style="min-height:64px">' + esc(s.shipping.note || '') + '</textarea>', { for: 's-shipping-note' }) + '</div>') +
          card('seo', 'SEO', 'Default title and description for search engines and link previews.',
            '<div class="stack">' + ui.field('Title', input('seo.title', { attrs: 'maxlength="120"' }), { for: 's-seo-title', aside: '<span data-count-for="seo.title">' + (s.seo.title || '').length + ' / 60</span>' }) +
            ui.field('Description', '<textarea class="input" id="s-seo-description" data-s="seo.description" rows="3" maxlength="400">' + esc(s.seo.description || '') + '</textarea>', { for: 's-seo-description', aside: '<span data-count-for="seo.description">' + (s.seo.description || '').length + ' / 160</span>' }) +
            '<div class="field"><div class="label">Search preview</div><div class="example" style="font-family:var(--font);font-size:13px;line-height:1.5" data-serp></div></div></div>') +
          card('demo', 'Demo mode', null,
            ui.toggle('data-s="demo" data-type="bool"', !!s.demo, 'Show demo markers on the site', 'Adds a small “demo catalogue” label to products and the footer so visitors know the stock and prices are examples. Turn it off when the real catalogue goes live.')) +
          '</form></div>' +
          '<div class="savebar" data-savebar></div>';
        attachSortables();
        refreshPreviews();
        drawSavebar();
        if (spy) spy.destroy();
        spy = ui.scrollSpy(A.$$('.ed-section', root), setActive);
        setActive(activeSec);
      }

      let spy = null;
      let activeSec = 'brand';
      function setActive(id) {
        activeSec = id;
        A.$$('.secnav__link', root).forEach((a) => a.classList.toggle('is-active', a.dataset.goto === id));
        const nav = root.querySelector('.secnav');
        const act = root.querySelector('.secnav__link.is-active');
        if (nav && act && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: act.offsetLeft - 24, behavior: 'smooth' });
      }

      function attachSortables() {
        sortables.forEach((x) => x.destroy());
        sortables = [];
        const ag = root.querySelector('[data-agents]');
        if (ag) sortables.push(ui.sortable(ag, { items: '.agent-card', handle: '.handle', axis: 'y', onEnd: (order) => {
          s.agents = order.map((i) => s.agents[Number(i)]);
          redrawPart('agents');
        } }));
        const sh = root.querySelector('[data-ship]');
        if (sh) sortables.push(ui.sortable(sh, { items: '.ship-row[data-sort-id]', handle: '.handle', axis: 'y', onEnd: (order) => {
          s.shipping.regions = order.map((i) => s.shipping.regions[Number(i)]);
          redrawPart('shipping');
        } }));
      }

      function redrawPart(which) {
        if (which === 'agents') {
          const host = root.querySelector('[data-body="agents"]');
          const wrap = host.querySelector('[data-agents]');
          const add = wrap.nextElementSibling;
          const tmp = A.el('<div>' + agentsHtml() + '</div>');
          wrap.replaceWith(tmp.firstElementChild);
          add.replaceWith(tmp.lastElementChild);
        } else if (which === 'shipping') {
          const wrap = root.querySelector('[data-ship]');
          const add = wrap.nextElementSibling;
          const tmp = A.el('<div>' + shippingHtml() + '</div>');
          wrap.replaceWith(tmp.firstElementChild);
          add.replaceWith(tmp.lastElementChild);
        } else if (which === 'rates') {
          root.querySelector('[data-rates]').innerHTML = ratesHtml();
          const sel = root.querySelector('#s-cur-default');
          sel.innerHTML = ui.options(s.currency.available, s.currency.default);
        }
        attachSortables();
        refreshPreviews();
        drawSavebar();
      }

      function waDigits() {
        return String(s.whatsapp.number || '');
      }

      function refreshPreviews() {
        // WhatsApp
        const num = waDigits();
        const valid = /^\d{7,15}$/.test(num);
        const hint = root.querySelector('[data-wa-hint]');
        if (hint) {
          hint.textContent = !num ? 'International format, digits only — country code first, no + or spaces.' : valid ? 'Looks good: +' + num : /\D/.test(num) ? 'Digits only — remove spaces, + and dashes.' : 'Should be 7–15 digits including the country code.';
          hint.closest('.hint').classList.toggle('hint--error', !!num && !valid);
          hint.closest('.field').classList.toggle('has-error', !!num && !valid);
        }
        const prev = root.querySelector('[data-wa-preview]');
        if (prev) {
          const text = (s.whatsapp.greeting || 'Hello') + '\nOrder ' + (s.whatsapp.orderPrefix || 'CS') + '-K3F9Q2\n• 1 × ' + (sample.name || 'Product') + ' — M';
          const link = valid ? A.waLink(num, text) : '';
          prev.innerHTML = valid ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">' + esc(link.length > 140 ? link.slice(0, 140) + '…' : link) + '</a>' : '<span class="faint">Enter a valid number to see the wa.me link.</span>';
        }
        // agents examples
        s.agents.forEach((a, i) => {
          const el = root.querySelector('[data-agent-example="' + i + '"]');
          if (!el) return;
          if (!a.urlTemplate) {
            el.innerHTML = '<span class="faint">No template — products need their own link for this agent.</span>';
            return;
          }
          const wUrl = (sample.weidian && sample.weidian.url) || String(s.weidian.itemUrlTemplate || '').replace(/\{itemId\}/g, sampleItemId);
          const url = A.fillTemplate(a.urlTemplate, { weidianUrl: wUrl, itemId: sampleItemId, slug: sample.slug, name: sample.name });
          el.innerHTML = esc(url) + '<div class="faint" style="margin-top:4px;font-family:var(--font)">for “' + esc(sample.name) + '” (item ' + esc(sampleItemId) + ')</div>';
        });
        // SEO
        const serp = root.querySelector('[data-serp]');
        if (serp) serp.innerHTML = '<div style="color:#1a0dab;font-size:16px;line-height:1.3">' + esc((s.seo.title || s.brand.name || '').slice(0, 70)) + '</div><div style="color:#006621;font-size:12.5px">' + esc(s.brand.domain || 'colastudio.com') + '</div><div style="color:#545454">' + esc((s.seo.description || '').slice(0, 165)) + ((s.seo.description || '').length > 165 ? '…' : '') + '</div>';
        // counts
        A.$$('[data-count-for]', root).forEach((el) => {
          const path = el.dataset.countFor;
          const max = Number(el.textContent.split('/')[1]) || 0;
          const n = String(A.getPath(s, path) || '').length;
          el.textContent = n + ' / ' + max;
          el.classList.toggle('is-over', max && n > max);
        });
      }

      function drawSavebar() {
        const dirty = JSON.stringify(s) !== baseline;
        const bar = root.querySelector('[data-savebar]');
        bar.className = 'savebar' + (dirty ? ' is-dirty' : '');
        bar.innerHTML =
          '<span class="savebar__status">' + (dirty ? 'Unsaved changes' : 'All settings saved') + '</span><div class="savebar__actions">' +
          (dirty ? '<button type="button" class="btn btn--ghost" data-act="discard">Discard</button>' : '') +
          '<button type="button" class="btn btn--primary" data-act="save"' + (dirty ? '' : ' disabled') + '>' + icon('check', 16) + 'Save settings</button></div>';
      }

      function readVal(t) {
        if (t.dataset.type === 'bool') return t.checked;
        if (t.dataset.type === 'num') return t.value === '' ? null : Number(t.value);
        return t.value;
      }

      root.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.s) {
          let v = readVal(t);
          if (t.dataset.s === 'whatsapp.number') v = String(v).trim();
          A.setPath(s, t.dataset.s, v);
        } else if (t.dataset.agent) {
          const a = s.agents[Number(t.dataset.i)];
          const k = t.dataset.agent;
          a[k] = t.type === 'checkbox' ? t.checked : k === 'id' ? A.slugify(t.value) || t.value : t.value;
          if (k === 'name' || k === 'enabled' || k === 'recommended') {
            const head = t.closest('.agent-card').querySelector('.agent-card__head b');
            if (head && k === 'name') head.textContent = a.name || 'New agent';
            if (k !== 'name') redrawPart('agents');
          }
        } else if (t.dataset.rate) {
          const code = t.dataset.rate;
          s.currency.rates[code] = t.value === '' ? null : Number(t.value);
          s.currency.updatedAt = new Date().toISOString();
          const r = Number(t.value);
          const inv = root.querySelector('[data-inv="' + code + '"]');
          const ex = root.querySelector('[data-ex="' + code + '"]');
          if (inv) inv.innerHTML = r > 0 ? esc('1 ' + code + ' = ¥' + A.num(1 / r, 2)) : '<span class="diff-down">Missing rate</span>';
          if (ex) ex.textContent = r > 0 ? A.money(459 * r, code) : '—';
          root.querySelector('[data-rates-updated]').textContent = 'Edited just now — saved with the settings';
        } else if (t.dataset.ship) {
          s.shipping.regions[Number(t.dataset.i)][t.dataset.ship] = t.value;
        } else if (t.matches('[data-drop-date]')) {
          s.nextDrop.date = A.fromLocalInput(t.value);
          const h = root.querySelector('[data-drop-hint]');
          if (h) h.textContent = s.nextDrop.date ? 'Your local time · ' + A.ago(s.nextDrop.date) : 'Your local time';
        }
        refreshPreviews();
        drawSavebar();
      });
      root.addEventListener('change', (e) => {
        if (e.target.dataset.agent === 'id') e.target.value = s.agents[Number(e.target.dataset.i)].id;
      });

      async function save() {
        // validation
        const num = waDigits();
        if (num && !/^\d{7,15}$/.test(num)) {
          ui.toast('The WhatsApp number must be 7–15 digits, no + or spaces', { type: 'error' });
          scrollTo('whatsapp');
          return;
        }
        const ids = s.agents.map((a) => a.id);
        if (ids.some((id) => !id)) {
          ui.toast('Every agent needs an ID', { type: 'error' });
          return scrollTo('agents');
        }
        if (new Set(ids).size !== ids.length) {
          ui.toast('Two agents share the same ID', { type: 'error' });
          return scrollTo('agents');
        }
        for (const code of s.currency.available) {
          if (code === 'CNY') continue;
          if (!(Number(s.currency.rates[code]) > 0)) {
            ui.toast('Add a positive exchange rate for ' + code, { type: 'error' });
            return scrollTo('currency');
          }
        }
        if (!s.currency.available.includes(s.currency.default)) s.currency.default = s.currency.available[0];
        const payload = A.clone(s);
        // drop rates for currencies that are no longer offered? keep them — harmless and handy when re-enabled
        Object.keys(payload.currency.rates).forEach((k) => {
          if (payload.currency.rates[k] == null || !(Number(payload.currency.rates[k]) > 0)) delete payload.currency.rates[k];
        });
        payload.currency.rates.CNY = 1;
        const btn = root.querySelector('[data-savebar] [data-act="save"]');
        try {
          const saved = await ui.busy(btn, () => A.data.saveSettings(payload), 'Saving…');
          s = withDefaults(saved);
          baseline = JSON.stringify(s);
          const y = window.scrollY;
          draw();
          window.scrollTo(0, y);
          ui.toast('Settings saved');
          if (A.app.renderBanners) A.app.renderBanners();
        } catch (e) {
          ui.error(e, 'Could not save settings');
        }
      }

      function scrollTo(id) {
        const el = root.querySelector('#set-' + id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActive(id);
      }

      root.addEventListener('click', async (e) => {
        const g = e.target.closest('[data-goto]');
        if (g) {
          e.preventDefault();
          return scrollTo(g.dataset.goto);
        }
        const cur = e.target.closest('[data-cur]');
        if (cur) {
          const code = cur.dataset.cur;
          const av = s.currency.available;
          if (av.includes(code)) {
            if (code === s.currency.default) return ui.toast('Choose another default currency first', { type: 'info' });
            s.currency.available = av.filter((x) => x !== code);
          } else {
            s.currency.available = KNOWN_CURRENCIES.filter((x) => x === code || av.includes(x));
            if (!(Number(s.currency.rates[code]) > 0)) ui.toast('Add a rate for ' + code + (A.data.mode === 'server' && s.currency.autoUpdate ? ' (or let the daily update fill it in)' : ''), { type: 'info' });
          }
          cur.setAttribute('aria-pressed', String(s.currency.available.includes(code)));
          redrawPart('rates');
          return;
        }
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const i = Number(b.dataset.i);
        switch (b.dataset.act) {
          case 'save':
            save();
            break;
          case 'discard':
            if (!(await ui.confirm({ title: 'Discard unsaved settings?', confirmText: 'Discard', danger: true }))) return;
            s = withDefaults(JSON.parse(baseline));
            draw();
            break;
          case 'agent-add': {
            let n = s.agents.length + 1;
            while (s.agents.some((a) => a.id === 'agent-' + n)) n++;
            s.agents.push({ id: 'agent-' + n, name: '', enabled: true, recommended: false, urlTemplate: '', description: '' });
            redrawPart('agents');
            const inputs = A.$$('[data-agent="name"]', root);
            if (inputs.length) inputs[inputs.length - 1].focus();
            break;
          }
          case 'agent-del': {
            const a = s.agents[i];
            const used = products.filter((p) => p.agentLinks && p.agentLinks[a.id]).length;
            if (!(await ui.confirm({ title: 'Remove ' + (a.name || 'this agent') + '?', body: used ? esc(A.plural(used, 'product')) + ' have a link override for this agent; those links stop being shown.' : 'Customers will no longer see this ordering option.', confirmText: 'Remove agent', danger: true }))) return;
            s.agents.splice(i, 1);
            redrawPart('agents');
            break;
          }
          case 'agent-up':
          case 'agent-down': {
            const j = b.dataset.act === 'agent-up' ? i - 1 : i + 1;
            if (j < 0 || j >= s.agents.length) return;
            [s.agents[i], s.agents[j]] = [s.agents[j], s.agents[i]];
            redrawPart('agents');
            break;
          }
          case 'ship-add':
            s.shipping.regions.push({ region: '', time: '' });
            redrawPart('shipping');
            {
              const inputs = A.$$('[data-ship="region"]', root);
              if (inputs.length) inputs[inputs.length - 1].focus();
            }
            break;
          case 'ship-del':
            s.shipping.regions.splice(i, 1);
            redrawPart('shipping');
            break;
          default:
            break;
        }
      });

      draw();
      if (ctx.query.section) setTimeout(() => scrollTo(ctx.query.section), 60);

      return {
        save,
        isDirty: () => !leaving && JSON.stringify(s) !== baseline,
        async canLeave() {
          if (leaving || JSON.stringify(s) === baseline) return true;
          const ok = await ui.confirm({ title: 'Leave without saving?', body: 'Your settings changes will be lost.', confirmText: 'Discard and leave', cancelText: 'Keep editing', danger: true });
          if (ok) leaving = true;
          return ok;
        },
        destroy: () => {
          sortables.forEach((x) => x.destroy());
          if (spy) spy.destroy();
        },
      };
    },
  };
})();
