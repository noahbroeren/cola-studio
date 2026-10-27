/* ==========================================================================
   Cola Studio — Admin UI kit
   Toasts, confirm dialogs, drawers, skeletons, empty states, small form
   widgets, pointer-based drag reordering, file + image helpers.
   ========================================================================== */
(function () {
  'use strict';

  const A = window.ColaAdmin;
  const { esc, icon } = A;
  const ui = (A.ui = {});

  /* ================================================================ toasts */

  function toastHost() {
    let host = document.getElementById('toasts');
    if (!host) {
      host = A.el('<div id="toasts" class="toasts" role="status" aria-live="polite"></div>');
      document.body.appendChild(host);
    }
    return host;
  }

  /** toast("Saved") · toast("Failed", { type: "error" }) · toast("Deleted", { action: { label, onClick } }) */
  ui.toast = function (message, opts) {
    const o = typeof opts === 'string' ? { type: opts } : opts || {};
    const type = o.type || 'ok';
    const ic = type === 'error' ? 'alert' : type === 'info' ? 'info' : type === 'warn' ? 'alert' : 'check';
    const t = A.el(
      '<div class="toast toast--' + type + '"><span class="toast__ic">' + icon(ic, 16) + '</span><span class="toast__msg">' + esc(message) + '</span>' +
        (o.action ? '<button type="button" class="toast__act">' + esc(o.action.label) + '</button>' : '') +
        '<button type="button" class="toast__x" aria-label="Dismiss">' + icon('x', 14) + '</button></div>'
    );
    const close = () => {
      t.classList.add('is-out');
      setTimeout(() => t.remove(), 220);
    };
    t.querySelector('.toast__x').addEventListener('click', close);
    if (o.action) t.querySelector('.toast__act').addEventListener('click', () => {
      o.action.onClick();
      close();
    });
    toastHost().appendChild(t);
    requestAnimationFrame(() => t.classList.add('is-in'));
    setTimeout(close, o.duration || (type === 'error' ? 6500 : 3400));
    return close;
  };
  ui.error = function (e, prefix) {
    if (e && e.silent) return;
    const msg = (e && e.message) || String(e || 'Something went wrong');
    ui.toast(prefix ? prefix + ': ' + msg : msg, { type: 'error' });
    if (e && !e.status) console.warn('[admin]', e); // eslint-disable-line no-console
  };

  /* ============================================================== overlays */

  const stack = [];
  let lastFocus = null;

  function trapFocus(root, e) {
    const f = A.$$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', (e) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      top.dismiss();
    } else if (e.key === 'Tab') trapFocus(top.el, e);
  }, true);

  ui.hasOverlay = () => stack.length > 0;

  /**
   * Generic modal dialog. Resolves with the id of the clicked button (or null when dismissed).
   * opts: { title, body (html), buttons:[{id,label,variant,autofocus}], onOpen(el), size, dismissable }
   */
  ui.dialog = function (opts) {
    return new Promise((resolve) => {
      lastFocus = document.activeElement;
      const buttons = opts.buttons || [{ id: 'ok', label: 'OK', variant: 'primary' }];
      const el = A.el(
        '<div class="overlay overlay--dialog"><div class="dialog' + (opts.size ? ' dialog--' + opts.size : '') + '" role="dialog" aria-modal="true" aria-labelledby="dlg-title">' +
          '<div class="dialog__head"><h2 id="dlg-title">' + (opts.titleHtml || esc(opts.title || '')) + '</h2></div>' +
          (opts.body ? '<div class="dialog__body">' + opts.body + '</div>' : '') +
          '<div class="dialog__foot">' +
          buttons.map((b) => '<button type="button" class="btn btn--' + (b.variant || 'secondary') + '" data-id="' + esc(b.id) + '">' + esc(b.label) + '</button>').join('') +
          '</div></div></div>'
      );
      let done = false;
      const finish = (id) => {
        if (done) return;
        if (id && opts.validate && opts.validate(id, el) === false) return;
        done = true;
        const i = stack.indexOf(entry);
        if (i >= 0) stack.splice(i, 1);
        el.classList.remove('is-open');
        setTimeout(() => el.remove(), 180);
        if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
        resolve(id ? { id, el } : null);
      };
      const entry = { el, dismiss: () => opts.dismissable !== false && finish(null) };
      stack.push(entry);
      el.addEventListener('mousedown', (e) => {
        if (e.target === el) entry.dismiss();
      });
      A.$$('[data-id]', el).forEach((b) => b.addEventListener('click', () => finish(b.dataset.id)));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
          e.preventDefault();
          const primary = buttons.find((b) => b.variant === 'primary' || b.variant === 'danger');
          if (primary) finish(primary.id);
        }
      });
      document.body.appendChild(el);
      if (opts.onOpen) opts.onOpen(el);
      requestAnimationFrame(() => {
        el.classList.add('is-open');
        const auto = el.querySelector('[autofocus], input, select, textarea') || el.querySelector('[data-id="' + (buttons.find((b) => b.autofocus) || buttons[buttons.length - 1]).id + '"]');
        if (auto) auto.focus({ preventScroll: true });
      });
    });
  };

  /** Promise<boolean>. */
  ui.confirm = async function (opts) {
    const o = typeof opts === 'string' ? { title: opts } : opts;
    const r = await ui.dialog({
      title: o.title,
      body: o.body ? '<p>' + o.body + '</p>' : '',
      buttons: [
        { id: 'cancel', label: o.cancelText || 'Cancel', variant: 'ghost' },
        { id: 'ok', label: o.confirmText || 'Confirm', variant: o.danger ? 'danger' : 'primary', autofocus: true },
      ],
    });
    return !!(r && r.id === 'ok');
  };

  /**
   * Side drawer. opts: { title, titleHtml, content (html|Element), footer (html), width, onClose }
   * Returns { el, body, close }.
   */
  ui.drawer = function (opts) {
    lastFocus = document.activeElement;
    const el = A.el(
      '<div class="overlay overlay--drawer"><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drw-title"' + (opts.width ? ' style="--drawer-w:' + esc(opts.width) + '"' : '') + '>' +
        '<header class="drawer__head"><h2 id="drw-title">' + (opts.titleHtml || esc(opts.title || '')) + '</h2>' +
        '<button type="button" class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></header>' +
        '<div class="drawer__body"></div>' + (opts.footer ? '<footer class="drawer__foot">' + opts.footer + '</footer>' : '') + '</aside></div>'
    );
    const body = el.querySelector('.drawer__body');
    if (typeof opts.content === 'string') body.innerHTML = opts.content;
    else if (opts.content) body.appendChild(opts.content);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      el.classList.remove('is-open');
      setTimeout(() => el.remove(), 260);
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
      if (opts.onClose) opts.onClose();
    };
    const entry = { el, dismiss: close };
    stack.push(entry);
    el.addEventListener('mousedown', (e) => {
      if (e.target === el) close();
    });
    el.querySelector('[data-close]').addEventListener('click', close);
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.classList.add('is-open');
      const f = body.querySelector('input, select, textarea, button') || el.querySelector('[data-close]');
      if (f) f.focus({ preventScroll: true });
    });
    return { el, body, foot: el.querySelector('.drawer__foot'), close };
  };

  /* ===================================================== skeletons / empty */

  ui.skeleton = function (kind) {
    const bar = (w, h) => '<span class="sk" style="width:' + w + ';height:' + (h || '12px') + '"></span>';
    if (kind === 'table') {
      return '<div class="card sk-card">' + Array.from({ length: 7 }, () => '<div class="sk-row">' + bar('44px', '44px') + bar('32%') + bar('14%') + bar('10%') + bar('12%') + '</div>').join('') + '</div>';
    }
    if (kind === 'tiles') {
      return '<div class="kpis">' + Array.from({ length: 8 }, () => '<div class="kpi sk-card">' + bar('50%', '10px') + bar('40%', '28px') + '</div>').join('') + '</div>';
    }
    if (kind === 'form') {
      return '<div class="card sk-card">' + Array.from({ length: 5 }, () => '<div class="sk-field">' + bar('18%', '10px') + bar('100%', '38px') + '</div>').join('') + '</div>';
    }
    return '<div class="sk-page">' + ui.skeleton('tiles') + ui.skeleton('table') + '</div>';
  };

  /** Empty state: { icon, title, body, action:{label, href|id}, tone } */
  ui.empty = function (o) {
    return (
      '<div class="empty' + (o.compact ? ' empty--compact' : '') + '">' +
      '<div class="empty__ic">' + icon(o.icon || 'info', 22) + '</div>' +
      '<h3>' + esc(o.title || '') + '</h3>' +
      (o.body ? '<p>' + o.body + '</p>' : '') +
      (o.actions ? '<div class="empty__actions' + (o.actionsGrid ? ' empty__actions--grid' : '') + '">' + o.actions + '</div>' : '') +
      '</div>'
    );
  };

  /** Explanatory block for server-only features in demo mode. */
  ui.serverOnly = function (feature, detail) {
    return ui.empty({
      icon: 'lock',
      title: feature + ' needs the server',
      body: (detail || 'This feature runs on the Cola Studio server.') + ' In demo mode the admin works on JSON files in this browser only. Run <code>node server.js</code> and open <code>/admin</code> to use it.',
    });
  };

  /* ============================================================== widgets */

  ui.toggle = function (attrs, checked, label, hint) {
    return (
      '<label class="switch"><input type="checkbox" ' + attrs + (checked ? ' checked' : '') + '><span class="switch__track" aria-hidden="true"></span>' +
      (label ? '<span class="switch__text"><span class="switch__label">' + esc(label) + '</span>' + (hint ? '<span class="switch__hint">' + hint + '</span>' : '') + '</span>' : '') +
      '</label>'
    );
  };

  /** Segmented control (radio group). options: [{value,label}] */
  ui.segmented = function (name, options, value, attrs) {
    return (
      '<div class="seg" role="radiogroup" ' + (attrs || '') + '>' +
      options
        .map((o) => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          return '<label class="seg__opt"><input type="radio" name="' + esc(name) + '" value="' + esc(v) + '"' + (String(v) === String(value) ? ' checked' : '') + '><span>' + esc(l) + '</span></label>';
        })
        .join('') +
      '</div>'
    );
  };

  ui.field = function (label, control, o) {
    const opt = o || {};
    return (
      '<div class="field' + (opt.cls ? ' ' + opt.cls : '') + '"' + (opt.attrs ? ' ' + opt.attrs : '') + '>' +
      (label ? '<label class="label"' + (opt.for ? ' for="' + esc(opt.for) + '"' : '') + '>' + esc(label) + (opt.aside ? '<span class="label__aside">' + opt.aside + '</span>' : '') + '</label>' : '') +
      control +
      (opt.hint ? '<p class="hint">' + opt.hint + '</p>' : '') +
      '</div>'
    );
  };

  ui.options = function (list, value) {
    return list
      .map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return '<option value="' + esc(v) + '"' + (String(v) === String(value == null ? '' : value) ? ' selected' : '') + '>' + esc(l) + '</option>';
      })
      .join('');
  };

  /** Small dropdown menu anchored to a button. items: [{id,label,icon,danger}] → Promise<id|null> */
  ui.menu = function (anchor, items) {
    return new Promise((resolve) => {
      A.$$('.menu-pop').forEach((m) => m.remove());
      const r = anchor.getBoundingClientRect();
      const m = A.el(
        '<div class="menu-pop" role="menu">' +
          items.map((it) => (it.sep ? '<hr>' : '<button type="button" role="menuitem" class="menu-pop__item' + (it.danger ? ' is-danger' : '') + '" data-id="' + esc(it.id) + '">' + (it.icon ? icon(it.icon, 16) : '') + '<span>' + esc(it.label) + '</span></button>')).join('') +
          '</div>'
      );
      document.body.appendChild(m);
      const mw = m.offsetWidth;
      const left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw));
      const top = r.bottom + 6 + m.offsetHeight > window.innerHeight ? r.top - m.offsetHeight - 6 : r.bottom + 6;
      m.style.left = left + 'px';
      m.style.top = Math.max(8, top) + 'px';
      let done = false;
      const close = (id) => {
        if (done) return;
        done = true;
        m.remove();
        document.removeEventListener('mousedown', outside, true);
        document.removeEventListener('keydown', key, true);
        resolve(id || null);
      };
      const outside = (e) => {
        if (!m.contains(e.target)) close(null);
      };
      const key = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(null);
          anchor.focus();
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const b = A.$$('.menu-pop__item', m);
          const i = b.indexOf(document.activeElement);
          b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length].focus();
        }
      };
      A.$$('.menu-pop__item', m).forEach((b) => b.addEventListener('click', () => close(b.dataset.id)));
      setTimeout(() => {
        document.addEventListener('mousedown', outside, true);
        document.addEventListener('keydown', key, true);
        const f = m.querySelector('.menu-pop__item');
        if (f) f.focus();
      });
    });
  };

  /* ===================================================== drag to reorder */

  /**
   * Pointer-based sortable (mouse + touch, works for lists and grids).
   * opts: { items: selector, handle: selector, onEnd(orderedIds) } — items need data-sort-id.
   */
  ui.sortable = function (container, opts) {
    let drag = null;
    function onDown(e) {
      const handle = e.target.closest(opts.handle);
      if (!handle || !container.contains(handle) || e.button > 0) return;
      const item = handle.closest(opts.items);
      if (!item) return;
      e.preventDefault();
      const r = item.getBoundingClientRect();
      const ghost = item.cloneNode(true);
      ghost.classList.add('sort-ghost');
      ghost.style.width = r.width + 'px';
      ghost.style.height = r.height + 'px';
      document.body.appendChild(ghost);
      item.classList.add('is-sorting');
      drag = { item, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, pid: e.pointerId };
      move(e);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
      window.addEventListener('pointercancel', up, { once: true });
    }
    function move(e) {
      if (!drag) return;
      drag.ghost.style.transform = 'translate(' + (e.clientX - drag.dx) + 'px,' + (e.clientY - drag.dy) + 'px)';
      drag.ghost.style.visibility = 'hidden';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      drag.ghost.style.visibility = '';
      const target = under && under.closest(opts.items);
      if (target && target !== drag.item && target.parentNode === drag.item.parentNode) {
        const tr = target.getBoundingClientRect();
        const horizontal = Math.abs(tr.top - drag.item.getBoundingClientRect().top) < tr.height / 2 && opts.axis !== 'y';
        const after = horizontal ? e.clientX > tr.left + tr.width / 2 : e.clientY > tr.top + tr.height / 2;
        target.parentNode.insertBefore(drag.item, after ? target.nextSibling : target);
        drag.moved = true;
      }
      // auto-scroll near the viewport edges
      if (e.clientY < 70) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
    }
    function up() {
      if (!drag) return;
      window.removeEventListener('pointermove', move);
      drag.ghost.remove();
      drag.item.classList.remove('is-sorting');
      const moved = drag.moved;
      drag = null;
      if (moved && opts.onEnd) opts.onEnd(A.$$(opts.items, container).filter((x) => x.parentNode === container || container.contains(x)).map((x) => x.dataset.sortId));
    }
    container.addEventListener('pointerdown', onDown);
    return { destroy: () => container.removeEventListener('pointerdown', onDown) };
  };

  /* ========================================================== scroll spy */

  /** Highlight the section nearest the top. sections: Element[] with data-sec; onActive(id). */
  ui.scrollSpy = function (sections, onActive) {
    if (!('IntersectionObserver' in window) || !sections.length) return { destroy() {} };
    const tops = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => tops.set(en.target.dataset.sec, en.isIntersecting ? en.boundingClientRect.top : null));
        let best = null;
        let bestTop = Infinity;
        sections.forEach((s) => {
          const t = tops.get(s.dataset.sec);
          if (t != null && Math.abs(t) < bestTop) {
            best = s.dataset.sec;
            bestTop = Math.abs(t);
          }
        });
        if (best) onActive(best);
      },
      { rootMargin: '-80px 0px -55% 0px', threshold: 0 }
    );
    sections.forEach((s) => io.observe(s));
    return { destroy: () => io.disconnect() };
  };

  /* ============================================================== files */

  ui.readAsDataURL = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read ' + (file.name || 'file')));
      r.readAsDataURL(file);
    });
  ui.readAsText = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read ' + (file.name || 'file')));
      r.readAsText(file);
    });

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('This image could not be decoded'));
      img.src = src;
    });
  }

  ui.imageSize = async function (file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      return { width: img.naturalWidth, height: img.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  /** Downscale to max px on the long side; WebP with JPEG fallback. */
  ui.downscaleImage = async function (file, opts) {
    const o = Object.assign({ max: 1600, quality: 0.85 }, opts || {});
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scale = Math.min(1, o.max / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, cw, ch);
      let type = 'image/webp';
      let dataUrl = c.toDataURL(type, o.quality);
      if (!dataUrl.startsWith('data:image/webp')) {
        type = 'image/jpeg';
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, cw, ch);
        dataUrl = c.toDataURL(type, o.quality);
      }
      const bytes = Math.round(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);
      return { dataUrl, type, width: cw, height: ch, bytes };
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  ui.pickFiles = function (opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (o.accept) input.accept = o.accept;
      if (o.multiple) input.multiple = true;
      input.style.display = 'none';
      input.addEventListener('change', () => {
        resolve(Array.from(input.files || []));
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  };

  ui.download = function (filename, blobOrText, mime) {
    const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  };

  ui.copy = async function (text, label) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      ui.toast((label || 'Copied') + ' to clipboard');
    } catch (e) {
      ui.toast('Could not copy — select the text and copy it manually', { type: 'error' });
    }
  };

  /** Open a URL in a new tab right away (keeps the user gesture) and allow setting it later. */
  ui.openLater = function () {
    const w = window.open('', '_blank');
    return {
      go(url) {
        if (w && !w.closed) {
          try {
            w.opener = null;
          } catch (e) {
            /* ignore */
          }
          w.location.href = url;
        } else window.open(url, '_blank', 'noopener');
      },
      cancel() {
        if (w && !w.closed) w.close();
      },
    };
  };

  /** Console-style log panel markup. */
  ui.consoleBlock = function (lines, opts) {
    const o = opts || {};
    const arr = (lines || []).map((l) => (typeof l === 'string' ? l : JSON.stringify(l)));
    return (
      '<div class="console' + (o.cls ? ' ' + o.cls : '') + '"><div class="console__head"><span>' + icon('terminal', 14) + esc(o.title || 'Log') + '</span>' +
      (o.status ? '<span class="console__status console__status--' + esc(o.statusTone || 'ok') + '">' + esc(o.status) + '</span>' : '') +
      '</div><pre class="console__body">' +
      (arr.length
        ? arr
            .map((l) => {
              const tone = /^\s*warn/i.test(l) ? 'warn' : /^\s*error/i.test(l) ? 'err' : /error|fail|blocked|could not|denied|ok=0|timeout|ENOTFOUND|ECONN|refused|invalid/i.test(l) ? 'err' : /warn|skip|attempt/i.test(l) ? 'warn' : /added|saved|ok\b|success|done|imported/i.test(l) ? 'ok' : '';
              return '<span class="ln' + (tone ? ' ln--' + tone : '') + '">' + esc(l) + '</span>';
            })
            .join('\n')
        : '<span class="ln ln--muted">No output.</span>') +
      '</pre></div>'
    );
  };

  /** Busy state for a button while a promise runs. */
  ui.busy = async function (btn, fn, label) {
    if (!btn) return fn();
    if (btn.disabled) return;
    const html = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-busy');
    if (label) btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>' + esc(label);
    try {
      return await fn();
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.innerHTML = html;
    }
  };
})();
