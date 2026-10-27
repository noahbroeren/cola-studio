/* ==========================================================================
   Cola Studio — Admin · Integrations (server only: Weibo, translation, Weidian)
   Secrets come back masked ("••••abcd"); we only send a secret when the user
   typed a new one (or explicitly cleared it). ENV-pinned fields are read-only.
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon, ui } = A;

  const SECRETS = ['weibo.cookie', 'translation.anthropicKey', 'translation.deeplKey', 'translation.googleKey', 'translation.libreKey', 'weidian.appSecret', 'weidian.accessToken', 'weidian.fetchVia'];
  const PROVIDER_HELP = {
    anthropic: 'Best quality: translation, title, category and related products in one call.',
    deepl: 'Free keys end in <code>:fx</code>. Translates to British English.',
    google: 'Google Cloud Translation v2.',
    libre: 'Your own or a public LibreTranslate server.',
    none: 'No translation — new posts stay pending with the Chinese text.',
    'public-item': 'Reads Weidian’s public item data. Unofficial — check with “Test item”.',
    'open-api': 'Official Weidian Open Platform (developer account required).',
    'json-feed': 'Your own JSON or CSV feed, e.g. a published Google Sheet.',
    mock: 'Fake stock that moves up and down — for demos of the live-stock page.',
  };
  const SECTIONS = [
    { id: 'weibo', label: 'Weibo' },
    { id: 'translation', label: 'Translation' },
    { id: 'weidian', label: 'Weidian' },
  ];

  A.views.integrations = {
    title: 'Integrations',
    skeleton: 'form',
    async render(root, params, ctx) {
      if (!A.data.caps.integrations) {
        root.innerHTML = '<header class="page-head"><div class="page-head__text"><h1>' + A.heading('Integrations') + '</h1></div></header><div class="card">' + ui.serverOnly('Integrations', 'Weibo import, translation and Weidian stock sync run on the server and keep their keys in <code>data/private.json</code>.') + '</div>';
        return null;
      }
      let data = await A.data.getIntegrations();
      if (ctx.stale()) return null;
      let meta = data._meta || {};
      let cfg = strip(data);
      let baseline = JSON.stringify(cfg);
      let typed = {}; // secret path → new value ('' = clear)
      let leaving = false;
      let testItem = '';

      function strip(d) {
        const o = A.clone(d);
        delete o._meta;
        return o;
      }
      const envOf = (path) => (meta.envOverrides || []).find((x) => x.path === path);
      const isDirty = () => JSON.stringify(cfg) !== baseline || Object.keys(typed).length > 0;

      function lockAside(path) {
        const e = envOf(path);
        return e ? '<span class="env-lock" title="Set by an environment variable">' + icon('lock', 12) + 'set via ' + esc(e.env) + '</span>' : '';
      }
      function text(label, path, o) {
        const opt = o || {};
        const e = envOf(path);
        const v = A.getPath(cfg, path);
        return ui.field(
          label,
          '<input class="input' + (opt.mono ? ' mono' : '') + '" id="i-' + path.replace('.', '-') + '" data-i="' + path + '"' + (opt.type ? ' type="' + opt.type + '"' : '') + (opt.dtype ? ' data-type="' + opt.dtype + '"' : '') + (opt.attrs ? ' ' + opt.attrs : '') + ' value="' + esc(v == null ? '' : v) + '"' + (opt.ph ? ' placeholder="' + esc(opt.ph) + '"' : '') + (e ? ' readonly' : '') + (opt.mono ? ' style="font-size:12.5px"' : '') + ' spellcheck="false">',
          { for: 'i-' + path.replace('.', '-'), aside: lockAside(path), hint: opt.hint, cls: opt.cls }
        );
      }
      function secret(label, path, o) {
        const opt = o || {};
        const e = envOf(path);
        const masked = A.getPath(cfg, path) || '';
        const has = !!masked;
        const t = typed[path];
        const state = e ? '' : t === '' ? 'Will be removed on save' : t ? 'New value will be saved' : has ? 'Saved — leave empty to keep it' : 'Not set';
        return ui.field(
          label,
          '<div class="ig"><input class="input mono" style="font-size:12.5px" type="password" id="i-' + path.replace('.', '-') + '" data-secret="' + path + '" value="' + esc(t || '') + '" placeholder="' + esc(e ? 'Set in the environment' : has ? masked : 'Not set') + '" autocomplete="new-password" spellcheck="false"' + (e ? ' readonly' : '') + '>' +
            (!e && has ? '<button type="button" class="btn btn--secondary" data-clear="' + path + '" title="Remove the saved value">Clear</button>' : '') + '</div>',
          { for: 'i-' + path.replace('.', '-'), aside: lockAside(path) || '<span class="secret-state" data-secret-state="' + path + '">' + esc(state) + '</span>', hint: opt.hint, cls: opt.cls }
        );
      }
      function toggle(path, label, hint) {
        const e = envOf(path);
        return '<div class="field">' + ui.toggle('data-i="' + path + '" data-type="bool"' + (e ? ' disabled' : ''), !!A.getPath(cfg, path), label, (hint || '') + (e ? ' · set via ' + esc(e.env) : '')) + '</div>';
      }
      function select(label, path, options, o) {
        const e = envOf(path);
        return ui.field(label, '<select class="input" id="i-' + path.replace('.', '-') + '" data-i="' + path + '"' + (e ? ' disabled' : '') + '>' + ui.options(options, A.getPath(cfg, path)) + '</select>', Object.assign({ for: 'i-' + path.replace('.', '-'), aside: lockAside(path) }, o || {}));
      }
      function kv(path, fromPh, toPh) {
        const obj = A.getPath(cfg, path) || {};
        const entries = Object.entries(obj);
        return (
          '<div class="kv" data-kv="' + path + '">' +
          (entries.length
            ? entries.map(([k, v], i) => '<div class="kv__row"><input class="input input--sm" data-kv-k="' + path + '" data-n="' + i + '" value="' + esc(k) + '" placeholder="' + esc(fromPh) + '" aria-label="From"><span class="kv__arrow">' + icon('chevronRight', 14) + '</span><input class="input input--sm" data-kv-v="' + path + '" data-n="' + i + '" value="' + esc(v) + '" placeholder="' + esc(toPh) + '" aria-label="To"><button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-kv-del="' + path + '" data-n="' + i + '" aria-label="Remove">' + icon('x', 14) + '</button></div>').join('')
            : '<div class="rep__empty">No aliases — the built-in ones (均码 → OS, 2XL → XXL, 黑色 → Black …) still apply.</div>') +
          '</div><button type="button" class="btn btn--sm btn--secondary rep__add" data-kv-add="' + path + '">' + icon('plus', 15) + 'Add alias</button>'
        );
      }
      function statusBlock(name, key) {
        const sched = (meta.scheduler || {})[key] || {};
        const running = (meta.running || {})[key];
        return (
          '<div class="sync" style="margin-bottom:20px">' + A.actions.syncRow(name, key === 'weibo' ? 'globe' : 'sync', (meta.sync || {})[key]) +
          '<div class="small faint" style="padding-left:50px;margin-top:-6px">' +
          esc(running ? 'Running now…' : 'Scheduler: ' + (A.getPath(cfg, key + '.enabled') ? 'every ' + (A.getPath(cfg, key + '.intervalMinutes') || '—') + ' min' : 'off (integration disabled)') + (sched.failures ? ' · ' + sched.failures + ' failure(s) in a row — backing off' : '') + (sched.lastRun ? ' · last attempt ' + A.ago(sched.lastRun) : '')) +
          '</div></div>'
        );
      }

      function glossaryInfo() {
        const lines = String(cfg.translation.glossary || '').split(/\r?\n/).filter((l) => l.trim());
        const bad = lines.filter((l) => !/^[^=]+=[^=]+$/.test(l.trim()));
        return esc(A.plural(lines.length, 'term')) + (bad.length ? ' · <span class="diff-down">' + esc(A.plural(bad.length, 'line')) + ' without “=”</span>' : '');
      }

      function draw() {
        const tp = cfg.translation.provider;
        const wp = cfg.weidian.provider;
        const tProviders = (meta.providers && meta.providers.translation) || ['anthropic', 'deepl', 'google', 'libre', 'none'];
        const wProviders = (meta.providers && meta.providers.weidian) || ['public-item', 'open-api', 'json-feed', 'mock'];
        root.innerHTML =
          '<header class="page-head"><div class="page-head__text"><h1>' + A.heading('Integrations') + '</h1><p class="lead">Private configuration, stored on the server and never sent to visitors. Environment variables win over values set here.</p></div></header>' +
          ((meta.envOverrides || []).length ? '<div class="note" style="margin-bottom:20px">' + icon('lock', 16) + '<p><b>' + esc(A.plural(meta.envOverrides.length, 'field')) + ' pinned by environment variables:</b> ' + esc(meta.envOverrides.map((x) => x.env).join(', ')) + '. Change them in <code>.env</code> or your host, then restart.</p></div>' : '') +
          '<div class="set-layout"><nav class="secnav" aria-label="Sections">' + SECTIONS.map((x) => '<a class="secnav__link" href="' + A.href('/integrations?section=' + x.id) + '" data-goto="' + x.id + '"><span>' + esc(x.label) + '</span></a>').join('') + '</nav>' +
          '<form class="set-main stack" novalidate autocomplete="off">' +
          /* ---------- weibo */
          '<section class="card ed-section" id="int-weibo" data-sec="weibo"><div class="ed-section__head"><div><h2>Weibo</h2><p>Imports the studio’s Weibo posts as Studio Updates and translates them.</p></div><div class="row"><button type="button" class="btn btn--sm btn--primary" data-act="weibo-fetch">' + icon('refresh', 15) + 'Fetch now</button></div></div><div class="ed-section__body">' +
          statusBlock('Weibo import', 'weibo') +
          '<div class="form-grid">' + toggle('weibo.enabled', 'Enabled', 'Fetch on a schedule') + toggle('weibo.autoPublish', 'Publish automatically', 'Off = new posts wait as pending') +
          text('Weibo UID', 'weibo.uid', { mono: true, ph: '1234567890', hint: 'The number in m.weibo.cn/u/<b>1234567890</b>.' }) +
          text('Interval (minutes)', 'weibo.intervalMinutes', { type: 'number', dtype: 'num', attrs: 'min="5" max="1440"', hint: 'Minimum 5.' }) +
          text('Backfill', 'weibo.backfill', { type: 'number', dtype: 'num', attrs: 'min="0" max="20"', hint: 'Posts imported on the very first fetch.' }) +
          ui.field('Last imported post', '<div class="ig"><input class="input mono" style="font-size:12.5px" id="i-weibo-lastId" data-i="weibo.lastId" data-type="nullable" value="' + esc(cfg.weibo.lastId || '') + '" placeholder="none yet" spellcheck="false"><button type="button" class="btn btn--secondary" data-act="lastid-reset">Reset</button></div>', { for: 'i-weibo-lastId', hint: 'Only newer posts are fetched. Reset to import the latest posts again.' }) +
          secret('Cookie', 'weibo.cookie', { cls: 'span-2', hint: 'Only needed when Weibo blocks the server. Copy the <code>Cookie:</code> header from a logged-in m.weibo.cn request. Treat it like a password.' }) +
          '</div><div data-weibo-out hidden style="margin-top:20px"></div></div></section>' +
          /* ---------- translation */
          '<section class="card ed-section" id="int-translation" data-sec="translation"><div class="ed-section__head"><div><h2>Translation</h2><p>Chinese → English for Weibo posts, with a house glossary.</p></div></div><div class="ed-section__body"><div class="form-grid">' +
          select('Provider', 'translation.provider', tProviders.map((p) => ({ value: p, label: { anthropic: 'Anthropic (Claude)', deepl: 'DeepL', google: 'Google Translate', libre: 'LibreTranslate', none: 'None' }[p] || p })), { hint: PROVIDER_HELP[tp] || '' }) +
          (tp === 'anthropic' ? text('Model', 'translation.model', { mono: true, ph: 'claude-sonnet-5-5' }) + secret('Anthropic API key', 'translation.anthropicKey', { cls: 'span-2' }) : '') +
          (tp === 'deepl' ? secret('DeepL API key', 'translation.deeplKey', { cls: 'span-2' }) : '') +
          (tp === 'google' ? secret('Google API key', 'translation.googleKey', { cls: 'span-2' }) : '') +
          (tp === 'libre' ? text('LibreTranslate URL', 'translation.libreUrl', { ph: 'https://libretranslate.example' }) + secret('LibreTranslate key', 'translation.libreKey') : '') +
          ui.field('Glossary', '<textarea class="input input--code" id="i-glossary" data-i="translation.glossary" rows="6" placeholder="重磅卫衣=Heavyweight Hoodie&#10;毛圈=loopback cotton&#10;大货=bulk production" lang="zh">' + esc(cfg.translation.glossary || '') + '</textarea>', { cls: 'span-2', for: 'i-glossary', aside: '<span data-gloss>' + glossaryInfo() + '</span>', hint: 'One term per line as <code>中文=English</code>. Applied before and after translating.' }) +
          '</div><div class="ed-sub"><div class="ed-sub__title">Test translation</div><div class="stack--sm stack"><textarea class="input" data-test-text rows="3" lang="zh" placeholder="粘贴一段中文… e.g. 重磅卫衣大货已经到仓,本周五开始发货。">' + esc('') + '</textarea>' +
          '<div class="row"><button type="button" class="btn btn--sm btn--secondary" data-act="translate-test">' + icon('wand', 15) + 'Translate</button><span class="small faint">Uses the saved settings — save first if you changed them.</span></div><div data-test-out></div></div></div>' +
          '</div></section>' +
          /* ---------- weidian */
          '<section class="card ed-section" id="int-weidian" data-sec="weidian"><div class="ed-section__head"><div><h2>Weidian</h2><p>Keeps stock (and optionally prices and photos) in sync with the Weidian shop.</p></div><div class="row"><button type="button" class="btn btn--sm btn--secondary" data-act="weidian-dry">' + icon('eye', 15) + 'Dry run</button><button type="button" class="btn btn--sm btn--primary" data-act="weidian-apply">' + icon('sync', 15) + 'Apply sync</button></div></div><div class="ed-section__body">' +
          statusBlock('Weidian stock sync', 'weidian') +
          '<div class="form-grid">' + toggle('weidian.enabled', 'Enabled', 'Sync on a schedule') +
          text('Interval (minutes)', 'weidian.intervalMinutes', { type: 'number', dtype: 'num', attrs: 'min="2" max="1440"', hint: 'Minimum 2. Failures back off automatically.' }) +
          select('Provider', 'weidian.provider', wProviders.map((p) => ({ value: p, label: { 'public-item': 'Public item page', 'open-api': 'Open API', 'json-feed': 'JSON / CSV feed', mock: 'Mock (demo)' }[p] || p })), { cls: 'span-2', hint: PROVIDER_HELP[wp] || '' }) +
          (wp === 'open-api' ? text('App key', 'weidian.appKey', { mono: true }) + secret('App secret', 'weidian.appSecret') + secret('Access token', 'weidian.accessToken', { cls: 'span-2', hint: 'Optional fixed token — otherwise the server requests one with the key and secret.' }) : '') +
          (wp === 'public-item' || !wp ? secret('Scraping service (optional)', 'weidian.fetchVia', { cls: 'span-2', hint: 'Only needed if Weidian blocks the server. Paste the request URL of a scraping service with your API key, e.g. <code>https://api.scraperapi.com/?api_key=YOUR_KEY&amp;url={url}</code> — <code>{url}</code> is replaced by the Weidian request.' }) : '') +
          (wp === 'json-feed' ? text('Feed URL', 'weidian.feedUrl', { cls: 'span-2', ph: 'https://docs.google.com/spreadsheets/d/…/pub?output=csv', hint: 'Rows reference a product by <code>productId</code>, <code>slug</code> or <code>itemId</code>, and a variant by <code>sku</code>, <code>weidianSkuId</code> or <code>color</code> + <code>size</code>.' }) : '') +
          '<div class="field"><div class="label">Size aliases</div>' + kv('weidian.sizeAliases', '均码', 'OS') + '</div>' +
          '<div class="field"><div class="label">Colour aliases</div>' + kv('weidian.colorAliases', '黑色', 'Washed Black') + '</div>' +
          '<div class="field span-2"><details class="adv"><summary>' + icon('chevronRight', 14) + 'Advanced endpoints</summary><div class="adv__body form-grid">' +
          text('Item URL template', 'weidian.itemUrlTemplate', { mono: true, cls: 'span-2', hint: 'For the public-item provider. Placeholders <code>{itemId}</code> or <code>{param}</code>.' }) +
          text('Token URL', 'weidian.tokenUrl', { mono: true, cls: 'span-2' }) + text('API URL', 'weidian.apiUrl', { mono: true }) + text('API method', 'weidian.apiMethod', { mono: true }) +
          text('API version', 'weidian.apiVersion', { mono: true }) + text('Delay between items (ms)', 'weidian.delayMs', { type: 'number', dtype: 'num', attrs: 'min="0" max="60000"' }) +
          select('Price unit', 'weidian.priceUnit', [{ value: 'auto', label: 'Auto-detect' }, { value: 'cent', label: 'Fen (cents)' }, { value: 'yuan', label: 'Yuan' }]) +
          '</div></details></div>' +
          '</div><div class="ed-sub"><div class="ed-sub__title">Test one item</div><div class="url-add" style="margin-top:0"><input class="input mono" style="font-size:12.5px" data-test-item value="' + esc(testItem) + '" placeholder="Weidian item ID (or a product id for mock / feed)" aria-label="Item ID to test"><button type="button" class="btn btn--secondary" data-act="weidian-test">' + icon('sync', 15) + 'Test item</button></div>' +
          '<p class="hint">Shows what Weidian returns and which SKUs match which variants. Nothing is saved.</p><div data-weidian-test></div></div>' +
          '<div data-weidian-out hidden style="margin-top:20px"></div></div></section>' +
          '</form></div><div class="savebar" data-savebar></div>';
        drawSavebar();
        if (spy) spy.destroy();
        spy = ui.scrollSpy(A.$$('.ed-section', root), setActive);
        setActive(activeSec);
      }

      let spy = null;
      let activeSec = 'weibo';
      function setActive(id) {
        activeSec = id;
        A.$$('.secnav__link', root).forEach((a) => a.classList.toggle('is-active', a.dataset.goto === id));
      }

      function drawSavebar() {
        const dirty = isDirty();
        const bar = root.querySelector('[data-savebar]');
        bar.className = 'savebar' + (dirty ? ' is-dirty' : '');
        bar.innerHTML = '<span class="savebar__status">' + (dirty ? 'Unsaved changes' : 'Integration settings saved') + '</span><div class="savebar__actions">' + (dirty ? '<button type="button" class="btn btn--ghost" data-act="discard">Discard</button>' : '') + '<button type="button" class="btn btn--primary" data-act="save"' + (dirty ? '' : ' disabled') + '>' + icon('check', 16) + 'Save integrations</button></div>';
      }

      function kvRead(path) {
        const rows = A.$$('[data-kv="' + path + '"] .kv__row', root);
        const out = {};
        rows.forEach((r) => {
          const k = r.querySelector('[data-kv-k]').value.trim();
          const v = r.querySelector('[data-kv-v]').value.trim();
          if (k) out[k] = v;
        });
        return out;
      }

      root.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.i) {
          const path = t.dataset.i;
          let v = t.dataset.type === 'bool' ? t.checked : t.dataset.type === 'num' ? (t.value === '' ? null : Number(t.value)) : t.dataset.type === 'nullable' ? t.value.trim() || null : t.value;
          A.setPath(cfg, path, v);
          if (path === 'translation.provider' || path === 'weidian.provider') {
            const y = window.scrollY;
            const keepTest = root.querySelector('[data-test-item]') ? root.querySelector('[data-test-item]').value : testItem;
            testItem = keepTest;
            draw();
            window.scrollTo(0, y);
            const sel = root.querySelector('[data-i="' + path + '"]');
            if (sel) sel.focus();
          }
          if (path === 'translation.glossary') root.querySelector('[data-gloss]').innerHTML = glossaryInfo();
        } else if (t.dataset.secret) {
          const path = t.dataset.secret;
          if (t.value) typed[path] = t.value;
          else delete typed[path];
          const st = root.querySelector('[data-secret-state="' + path + '"]');
          if (st) st.textContent = typed[path] ? 'New value will be saved' : A.getPath(cfg, path) ? 'Saved — leave empty to keep it' : 'Not set';
        } else if (t.dataset.kvK || t.dataset.kvV) {
          const path = t.dataset.kvK || t.dataset.kvV;
          A.setPath(cfg, path, kvRead(path));
        } else if (t.matches('[data-test-item]')) testItem = t.value;
        drawSavebar();
      });

      async function save() {
        const body = A.clone(cfg);
        // secrets: only what the user typed or cleared
        for (const path of SECRETS) {
          const [sec, key] = path.split('.');
          if (!body[sec]) continue;
          if (Object.prototype.hasOwnProperty.call(typed, path)) body[sec][key] = typed[path];
          else delete body[sec][key];
        }
        // never send ENV-pinned fields
        (meta.envOverrides || []).forEach((x) => {
          const [sec, key] = x.path.split('.');
          if (body[sec]) delete body[sec][key];
        });
        for (const [path, min, max] of [['weibo.intervalMinutes', 5, 1440], ['weibo.backfill', 0, 20], ['weidian.intervalMinutes', 2, 1440], ['weidian.delayMs', 0, 60000]]) {
          const v = A.getPath(body, path);
          if (v === null || v === undefined || v === '') {
            const [sec, key] = path.split('.');
            delete body[sec][key];
          } else if (!Number.isFinite(Number(v))) {
            ui.toast(path + ' must be a number', { type: 'error' });
            return false;
          } else if (v < min || v > max) ui.toast(path.split('.')[1] + ' will be limited to ' + min + '–' + max, { type: 'info' });
        }
        if (body.weibo && body.weibo.lastId && !/^\d{1,25}$/.test(String(body.weibo.lastId))) {
          ui.toast('Last imported post must be a numeric Weibo id, or empty', { type: 'error' });
          return false;
        }
        const btn = root.querySelector('[data-savebar] [data-act="save"]');
        try {
          data = await ui.busy(btn, () => A.data.saveIntegrations(body), 'Saving…');
          meta = data._meta || {};
          cfg = strip(data);
          baseline = JSON.stringify(cfg);
          typed = {};
          const y = window.scrollY;
          draw();
          window.scrollTo(0, y);
          ui.toast('Integrations saved');
          return true;
        } catch (e) {
          ui.error(e, 'Could not save');
          return false;
        }
      }

      async function ensureSaved(what) {
        if (!isDirty()) return true;
        const ok = await ui.confirm({ title: 'Save changes first?', body: what + ' uses the saved configuration. Save your changes now and continue?', confirmText: 'Save and continue' });
        if (!ok) return false;
        return save();
      }

      async function refreshMeta() {
        try {
          const d = await A.data.getIntegrations();
          meta = d._meta || {};
          if (!isDirty()) {
            cfg = strip(d);
            baseline = JSON.stringify(cfg);
          }
        } catch (e) {
          /* ignore */
        }
      }

      root.addEventListener('click', async (e) => {
        const g = e.target.closest('[data-goto]');
        if (g) {
          e.preventDefault();
          const el = root.querySelector('#int-' + g.dataset.goto);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setActive(g.dataset.goto);
          return;
        }
        const clr = e.target.closest('[data-clear]');
        if (clr) {
          typed[clr.dataset.clear] = '';
          const inp = root.querySelector('[data-secret="' + clr.dataset.clear + '"]');
          if (inp) {
            inp.value = '';
            inp.placeholder = 'Will be removed on save';
          }
          const st = root.querySelector('[data-secret-state="' + clr.dataset.clear + '"]');
          if (st) st.textContent = 'Will be removed on save';
          drawSavebar();
          return;
        }
        const kvAdd = e.target.closest('[data-kv-add]');
        if (kvAdd) {
          const path = kvAdd.dataset.kvAdd;
          const host = root.querySelector('[data-kv="' + path + '"]');
          const empty = host.querySelector('.rep__empty');
          if (empty) empty.remove();
          const n = host.querySelectorAll('.kv__row').length;
          host.insertAdjacentHTML('beforeend', '<div class="kv__row"><input class="input input--sm" data-kv-k="' + path + '" data-n="' + n + '" placeholder="Weidian" aria-label="From"><span class="kv__arrow">' + icon('chevronRight', 14) + '</span><input class="input input--sm" data-kv-v="' + path + '" data-n="' + n + '" placeholder="Site" aria-label="To"><button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-kv-del="' + path + '" data-n="' + n + '" aria-label="Remove">' + icon('x', 14) + '</button></div>');
          host.lastElementChild.querySelector('input').focus();
          return;
        }
        const kvDel = e.target.closest('[data-kv-del]');
        if (kvDel) {
          const path = kvDel.dataset.kvDel;
          kvDel.closest('.kv__row').remove();
          A.setPath(cfg, path, kvRead(path));
          drawSavebar();
          return;
        }
        const b = e.target.closest('[data-act]');
        if (!b) return;
        switch (b.dataset.act) {
          case 'save':
            save();
            break;
          case 'discard':
            if (!(await ui.confirm({ title: 'Discard changes?', confirmText: 'Discard', danger: true }))) return;
            cfg = JSON.parse(baseline);
            typed = {};
            draw();
            break;
          case 'lastid-reset':
            cfg.weibo.lastId = null;
            root.querySelector('[data-i="weibo.lastId"]').value = '';
            drawSavebar();
            ui.toast('The next fetch imports the latest posts again (after saving)', { type: 'info' });
            break;
          case 'weibo-fetch': {
            if (!(await ensureSaved('Fetching'))) return;
            const out = root.querySelector('[data-weibo-out]');
            await A.actions.weiboFetch(root.querySelector('[data-act="weibo-fetch"]'), { target: out });
            await refreshMeta();
            break;
          }
          case 'translate-test': {
            const txt = root.querySelector('[data-test-text]').value.trim();
            const out = root.querySelector('[data-test-out]');
            if (!txt) {
              ui.toast('Paste some Chinese text to translate', { type: 'info' });
              root.querySelector('[data-test-text]').focus();
              return;
            }
            if (!(await ensureSaved('The test'))) return;
            await ui.busy(root.querySelector('[data-act="translate-test"]'), async () => {
              try {
                const r = await A.data.translateTest(txt);
                out.innerHTML =
                  '<div class="note' + (r.ok === false || r.error ? ' note--error' : '') + '" style="margin-top:4px">' + icon(r.error ? 'alert' : 'check', 16) + '<div style="min-width:0"><p class="small muted">Provider <b>' + esc(r.provider) + '</b>' + (r.model ? ' · ' + esc(r.model) : '') + (r.category ? ' · category <b>' + esc(r.category) + '</b>' : '') + '</p>' +
                  (r.error ? '<p><b>Error:</b> ' + esc(r.error) + '</p>' : '') +
                  (r.title ? '<p style="margin-top:8px"><b>' + esc(r.title) + '</b></p>' : '') +
                  '<p style="margin-top:6px;white-space:pre-wrap;color:var(--cola)">' + esc(r.translation || '—') + '</p>' +
                  ((r.relatedProductIds || []).length ? '<p class="small muted" style="margin-top:6px">Related products: ' + esc(r.relatedProductIds.join(', ')) + '</p>' : '') + '</div></div>';
              } catch (err) {
                out.innerHTML = '<div class="note note--error">' + icon('alert', 16) + '<p>' + esc(err.message) + '</p></div>';
              }
            }, 'Translating…');
            break;
          }
          case 'weidian-test': {
            const id = (root.querySelector('[data-test-item]').value || '').trim();
            const out = root.querySelector('[data-weidian-test]');
            if (!id) {
              ui.toast('Enter a Weidian item ID to test', { type: 'info' });
              root.querySelector('[data-test-item]').focus();
              return;
            }
            if (!(await ensureSaved('The test'))) return;
            await ui.busy(root.querySelector('[data-act="weidian-test"]'), async () => {
              try {
                const r = await A.data.weidianTest(id);
                const m = r.matches || [];
                const u = r.unmatched || [];
                out.innerHTML =
                  '<div class="stack" style="margin-top:12px"><p class="small muted">Provider <b>' + esc(r.provider) + '</b> · ' + esc(A.plural(((r.item && r.item.skus) || []).length, 'SKU')) + ' returned' + (r.product ? ' · product <b>' + esc(r.product.name) + '</b>' : ' · no product has this item ID') + (r.item && r.item.title ? ' · “' + esc(r.item.title) + '”' : '') + '</p>' +
                  (m.length
                    ? '<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Weidian SKU</th><th>Variant</th><th class="num">Site</th><th class="num">Weidian</th><th>Matched by</th></tr></thead><tbody>' +
                      m.map((x) => '<tr><td>' + esc(x.title || '—') + (x.skuId ? '<span class="cell-sub mono">' + esc(x.skuId) + '</span>' : '') + '</td><td class="mono">' + esc(x.variant) + '</td><td class="num">' + esc(x.currentStock) + '</td><td class="num"><b>' + esc(x.stock) + '</b></td><td class="small muted">' + esc(x.matchedBy) + '</td></tr>').join('') +
                      '</tbody></table></div></div>'
                    : '') +
                  (u.length ? '<div class="note note--warn">' + icon('alert', 16) + '<p><b>' + esc(A.plural(u.length, 'unmatched SKU')) + ':</b> ' + esc(u.map((x) => x.title || x.sku || x.skuId).join(', ')) + '. Add aliases above.</p></div>' : '') +
                  '<details class="adv"><summary>' + icon('chevronRight', 14) + 'Raw response</summary><div class="adv__body"><pre class="json">' + esc(JSON.stringify(r.raw !== undefined ? r.raw : r.item, null, 2)) + '</pre></div></details></div>';
              } catch (err) {
                out.innerHTML = '<div class="note note--error" style="margin-top:12px">' + icon('alert', 16) + '<p><b>Test failed:</b> ' + esc(err.message) + '</p></div>';
              }
            }, 'Testing…');
            break;
          }
          case 'weidian-dry': {
            if (!(await ensureSaved('The dry run'))) return;
            await A.actions.weidianSync(root.querySelector('[data-act="weidian-dry"]'), { dryRun: true, target: root.querySelector('[data-weidian-out]'), onApplied: refreshMeta });
            break;
          }
          case 'weidian-apply': {
            if (!(await ensureSaved('The sync'))) return;
            if (!(await ui.confirm({ title: 'Run a Weidian sync now?', body: 'Stock on the site is updated from Weidian (provider: <b>' + esc(cfg.weidian.provider) + '</b>). Run a dry run first if you are unsure.', confirmText: 'Apply sync' }))) return;
            await A.actions.weidianSync(root.querySelector('[data-act="weidian-apply"]'), { dryRun: false, target: root.querySelector('[data-weidian-out]') });
            await refreshMeta();
            break;
          }
          default:
            break;
        }
      });

      draw();
      if (ctx.query.section) setTimeout(() => {
        const el = root.querySelector('#int-' + ctx.query.section);
        if (el) el.scrollIntoView({ block: 'start' });
      }, 60);

      return {
        save,
        destroy: () => spy && spy.destroy(),
        isDirty: () => !leaving && isDirty(),
        async canLeave() {
          if (leaving || !isDirty()) return true;
          const ok = await ui.confirm({ title: 'Leave without saving?', body: 'Your integration changes will be lost.', confirmText: 'Discard and leave', cancelText: 'Keep editing', danger: true });
          if (ok) leaving = true;
          return ok;
        },
      };
    },
  };
})();
