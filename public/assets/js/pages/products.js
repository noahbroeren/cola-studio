/* COLA STUDIO — Products (catalogue) */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var ALL = [], state = null, priceBounds = [0, 0];

  function readState() {
    var q = new URLSearchParams(location.search);
    var list = function (k) { var v = q.get(k); return v ? v.split(',').filter(Boolean) : []; };
    return {
      category: q.get('category') || 'all', q: q.get('q') || '', sort: q.get('sort') || 'featured',
      sizes: list('size'), colors: list('color'), collections: list('collection'), badges: list('label'),
      avail: q.get('avail') || 'all', min: q.get('min') ? +q.get('min') : null, max: q.get('max') ? +q.get('max') : null,
      cols: Cola.store.get('cola.cols', 4)
    };
  }
  function writeState() {
    var p = {};
    if (state.category !== 'all') p.category = state.category;
    if (state.q) p.q = state.q;
    if (state.sort !== 'featured') p.sort = state.sort;
    if (state.sizes.length) p.size = state.sizes.join(',');
    if (state.colors.length) p.color = state.colors.join(',');
    if (state.collections.length) p.collection = state.collections.join(',');
    if (state.badges.length) p.label = state.badges.join(',');
    if (state.avail !== 'all') p.avail = state.avail;
    if (state.min != null) p.min = state.min;
    if (state.max != null) p.max = state.max;
    history.replaceState(null, '', location.pathname + Cola.qs(p));
  }

  Cola.boot(function () {
    state = readState();
    return Promise.all([Cola.data.products(), Cola.data.inventory().catch(function () { return null; })]).then(function (r) {
      ALL = Cola.data.withStock(r[0], r[1]);
      var prices = ALL.map(function (p) { return p.price; });
      priceBounds = [Math.min.apply(null, prices), Math.max.apply(null, prices)];
      $('[data-q]').value = state.q;
      $('[data-sort]').value = state.sort;
      setCols(state.cols);
      tabs(); filtersPanel(); render(true); bind();
      var skus = ALL.reduce(function (a, p) { return a + p.variants.filter(function (v) { return Cola.stock.available(Cola.stock.variant(v, p)); }).length; }, 0);
      $('[data-skus]').textContent = skus;
      Cola.c.bindCards($('[data-grid]'), function (id) { return ALL.find(function (p) { return p.id === id; }); });
    });
  });

  // ------------------------------------------------------------------ filtering
  function matches(p, ignore) {
    if (ignore !== 'category' && state.category !== 'all') {
      if (state.category === 'new') { if ((p.badges || []).indexOf('new') < 0) return false; }
      else if (state.category === 'saved') { if (!Cola.bag.isSaved(p.id)) return false; }
      else if (p.category !== state.category) return false;
    }
    if (state.q) {
      var hay = [p.name, p.subtitle, p.category, p.collection, (p.tags || []).join(' '), (p.colors || []).map(function (c) { return c.name; }).join(' ')].join(' ').toLowerCase();
      if (!state.q.toLowerCase().split(/\s+/).every(function (t) { return hay.indexOf(t) >= 0; })) return false;
    }
    if (state.sizes.length && !state.sizes.some(function (s) { return p.variants.some(function (v) { return v.size === s && Cola.stock.available(Cola.stock.variant(v, p)); }); })) return false;
    if (state.colors.length && !(p.colors || []).some(function (c) { return state.colors.indexOf(c.name) >= 0 || Cola.colors.families(c).some(function (f) { return state.colors.indexOf(f) >= 0; }); })) return false;
    if (state.collections.length && state.collections.indexOf(p.collection) < 0) return false;
    if (state.badges.length && !state.badges.some(function (b) { return (p.badges || []).indexOf(b) >= 0; })) return false;
    var st = Cola.stock.product(p);
    if (state.avail === 'instock' && !(st === 'instock' || st === 'low')) return false;
    if (state.avail === 'preorder' && st !== 'preorder') return false;
    if (state.avail === 'hide-soldout' && (st === 'soldout' || st === 'restocking')) return false;
    var cur = Cola.money.current();
    var price = Cola.money.convert(p.price, cur) || p.price;
    if (state.min != null && price < state.min) return false;
    if (state.max != null && price > state.max) return false;
    return true;
  }
  function sorted(list) {
    var s = state.sort;
    var arr = list.slice();
    if (s === 'price-asc') arr.sort(function (a, b) { return a.price - b.price; });
    else if (s === 'price-desc') arr.sort(function (a, b) { return b.price - a.price; });
    else if (s === 'name') arr.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (s === 'new') arr.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    else if (s === 'stock') arr.sort(function (a, b) { return Cola.stock.total(b) - Cola.stock.total(a); });
    else arr.sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (a.order || 0) - (b.order || 0); });
    // sold out always last
    arr.sort(function (a, b) { var x = Cola.stock.product(a) === 'soldout' ? 1 : 0, y = Cola.stock.product(b) === 'soldout' ? 1 : 0; return x - y; });
    return arr;
  }

  // ------------------------------------------------------------------ render
  function render(first) {
    var list = sorted(ALL.filter(function (p) { return matches(p); }));
    var grid = $('[data-grid]'), empty = $('[data-empty]');
    $('[data-total]').textContent = list.length;
    var cat = (Cola.data.categories || []).find(function (c) { return c.id === state.category; });
    var title = $('[data-cat-title]');
    var t = state.category === 'all' ? 'The <b>Collection</b>' : state.category === 'new' ? 'New <b>in</b>' : state.category === 'saved' ? 'Saved <b>pieces</b>' : cat ? splitName(cat.name) : 'The <b>Collection</b>';
    if (title.getAttribute('data-t') !== t) {
      title.setAttribute('data-t', t); delete title.dataset.splitDone; title.classList.remove('is-in'); title.innerHTML = t;
      Cola.ui.split(title); requestAnimationFrame(function () { title.classList.add('is-in'); });
    }
    $('[data-cat-desc]').textContent = cat ? cat.description : state.category === 'new' ? 'The latest additions from the studio — fresh out of production.' : state.category === 'saved' ? 'Pieces you saved on this device.' : 'Every piece designed, patterned and produced by the studio — in small runs, with stock that updates live.';
    $('[data-crumb]').textContent = cat ? cat.name : state.category === 'new' ? 'New in' : 'Shop';
    // The server already wrote the right <title> (incl. admin overrides); only change it when the view changes here.
    if (!(first && Cola.isServer)) {
      var brand = (Cola.data.settings && Cola.data.settings.brand && Cola.data.settings.brand.name) || 'Cola Studio';
      document.title = (cat ? cat.name : state.category === 'new' ? 'New in' : state.category === 'saved' ? 'Saved pieces' : 'Shop the Collection') + ' — ' + brand;
    }
    if (!list.length) {
      grid.innerHTML = ''; empty.hidden = false;
      empty.innerHTML = Cola.c.empty('Nothing matches — yet', 'Try removing a filter, or check the live stock page for restocks.', '<button class="btn btn--sm" type="button" data-clear>Clear all filters</button>');
    } else {
      empty.hidden = true;
      grid.innerHTML = list.map(function (p, i) { return Cola.c.card(p, { index: i, reveal: !first || i > 7 }); }).join('');
      Cola.rewriteLinks(grid);
      if (first) Cola.ui.reveal(grid); else requestAnimationFrame(function () { Cola.ui.reveal(grid); });
    }
    activeChips(); updateTabs(); updateFilterCount();
    writeState();
  }
  // Category names are shown as they are written — no bold word picked out.
  function splitName(n) { return esc(n); }

  function tabs() {
    var cats = [{ id: 'all', name: 'All' }, { id: 'new', name: 'New in' }].concat(Cola.data.categories || []);
    $('[data-cat-tabs]').innerHTML = cats.map(function (c) {
      return '<button class="chip" type="button" role="tab" data-cat="' + esc(c.id) + '" aria-selected="false">' + esc(c.name) + ' <span class="count" data-cat-count="' + esc(c.id) + '"></span></button>';
    }).join('');
  }
  function updateTabs() {
    $$('[data-cat]').forEach(function (b) {
      var id = b.getAttribute('data-cat');
      b.setAttribute('aria-selected', id === state.category);
      var saveCat = state.category; state.category = id;
      var n = ALL.filter(function (p) { return matches(p); }).length;
      state.category = saveCat;
      b.querySelector('[data-cat-count]').textContent = n;
    });
  }

  function filterCount() { return state.sizes.length + state.colors.length + state.collections.length + state.badges.length + (state.avail !== 'all' ? 1 : 0) + (state.min != null || state.max != null ? 1 : 0); }
  function updateFilterCount() { var n = filterCount(); $('[data-filter-count]').textContent = n ? '(' + n + ')' : ''; var foot = $('[data-show-count]'); if (foot) foot.textContent = ALL.filter(function (p) { return matches(p); }).length; }

  function activeChips() {
    var chips = [];
    state.sizes.forEach(function (s) { chips.push(['size', s, 'Size ' + s]); });
    state.colors.forEach(function (s) { chips.push(['color', s, s]); });
    state.collections.forEach(function (s) { chips.push(['collection', s, s]); });
    state.badges.forEach(function (s) { chips.push(['label', s, s.charAt(0).toUpperCase() + s.slice(1)]); });
    if (state.avail !== 'all') chips.push(['avail', state.avail, { instock: 'In stock', preorder: 'Pre-order', 'hide-soldout': 'Hide sold out' }[state.avail]]);
    if (state.min != null || state.max != null) chips.push(['price', '', Cola.money.symbol(Cola.money.current()) + (state.min != null ? Math.round(state.min) : Math.round(cur(priceBounds[0]))) + ' – ' + Cola.money.symbol(Cola.money.current()) + (state.max != null ? Math.round(state.max) : Math.round(cur(priceBounds[1])))]);
    if (state.q) chips.push(['q', state.q, '“' + state.q + '”']);
    $('[data-active]').innerHTML = chips.length ? chips.map(function (c) { return '<button class="chip chip--x" type="button" data-remove="' + c[0] + '" data-val="' + esc(c[1]) + '">' + esc(c[2]) + '</button>'; }).join('') + '<button class="link link--quiet tiny" type="button" data-clear>Clear all</button>' : '';
  }
  function cur(cny) { return Cola.money.convert(cny, Cola.money.current()) || cny; }

  // ------------------------------------------------------------------ filters drawer
  function filtersPanel() {
    var el = $('[data-filters]');
    var sizes = []; ALL.forEach(function (p) { (p.sizes || []).forEach(function (s) { if (sizes.indexOf(s) < 0) sizes.push(s); }); });
    // Letter sizes first (XXS → 4XL), then numbers from small to large, then everything else
    var LETTERS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'XXXL', '4XL', 'OS'];
    var rank = function (s) {
      var i = LETTERS.indexOf(String(s).toUpperCase()); if (i >= 0) return [0, i];
      var n = parseFloat(String(s)); if (!isNaN(n) && /^\d/.test(s)) return [1, n];
      return [2, 0];
    };
    sizes.sort(function (a, b) { var x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || String(a).localeCompare(String(b)); });
    // Colour filter by family (Black, Blue, Green…) — names like "Brick Red" or "With Label Black" stay out of the list
    var colors = {}; ALL.forEach(function (p) { (p.colors || []).forEach(function (c) { Cola.colors.families(c).forEach(function (f) { colors[f] = Cola.colors.FAMILY_HEX[f]; }); }); });
    var FAM_ORDER = ['Black', 'White', 'Grey', 'Beige', 'Brown', 'Red', 'Pink', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple'];
    colors = FAM_ORDER.filter(function (f) { return colors[f]; }).reduce(function (o, f) { o[f] = colors[f]; return o; }, {});
    var cols = []; ALL.forEach(function (p) { if (p.collection && cols.indexOf(p.collection) < 0) cols.push(p.collection); });
    cols.sort();
    var lo = Math.floor(cur(priceBounds[0])), hi = Math.ceil(cur(priceBounds[1]));
    el.innerHTML = '<div class="drawer__head"><h2 class="drawer__title"><b>Filter</b> &amp; refine</h2><button class="icon-btn" type="button" data-filters-close aria-label="Close filters">' + Cola.icon('close') + '</button></div>' +
      '<div class="drawer__body"><div class="fgroup"><h3 class="label">Availability</h3><div class="fopts">' +
        [['all', 'Show everything'], ['instock', 'In stock only'], ['preorder', 'Pre-order'], ['hide-soldout', 'Hide sold out']].map(function (a) { return '<label class="check"><input type="radio" name="avail" value="' + a[0] + '"' + (state.avail === a[0] ? ' checked' : '') + '> ' + a[1] + '</label>'; }).join('') + '</div></div>' +
      '<div class="fgroup"><h3 class="label">Size <span class="subtle">· available sizes only</span></h3><div class="sizes">' + sizes.map(function (s) { return '<button type="button" class="size size--sm" aria-pressed="' + (state.sizes.indexOf(s) >= 0) + '" data-f-size="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div></div>' +
      '<div class="fgroup"><h3 class="label">Colour</h3><div class="fcolors">' + Object.keys(colors).map(function (n) { return '<button type="button" class="fcolor" aria-pressed="' + (state.colors.indexOf(n) >= 0) + '" data-f-color="' + esc(n) + '"><span class="swatch swatch--sm" style="--c:' + colors[n] + '"></span>' + esc(n) + '</button>'; }).join('') + '</div></div>' +
      '<div class="fgroup"><h3 class="label">Price <span class="subtle">· ' + Cola.money.current() + '</span></h3><div class="frange" data-range>' +
        '<div class="frange__track"><span data-range-fill></span></div><input type="range" min="' + lo + '" max="' + hi + '" value="' + (state.min != null ? state.min : lo) + '" data-range-min aria-label="Minimum price"><input type="range" min="' + lo + '" max="' + hi + '" value="' + (state.max != null ? state.max : hi) + '" data-range-max aria-label="Maximum price">' +
        '<div class="row row--between tiny"><span data-range-lo></span><span data-range-hi></span></div></div></div>' +
      '<div class="fgroup"><h3 class="label">Collection</h3><div class="fopts">' + cols.map(function (c) { return '<label class="check"><input type="checkbox" value="' + esc(c) + '" data-f-collection' + (state.collections.indexOf(c) >= 0 ? ' checked' : '') + '> ' + esc(c) + '</label>'; }).join('') + '</div></div>' +
      '<div class="fgroup"><h3 class="label">Labels</h3><div class="row row--wrap" style="--row-gap:8px">' + [['new', 'New'], ['bestseller', 'Bestseller'], ['limited', 'Limited'], ['restock', 'Restocked']].map(function (b) { return '<button type="button" class="chip" aria-pressed="' + (state.badges.indexOf(b[0]) >= 0) + '" data-f-badge="' + b[0] + '">' + b[1] + '</button>'; }).join('') + '</div></div></div>' +
      '<div class="drawer__foot"><div class="row" style="--row-gap:10px"><button class="btn btn--ghost" type="button" data-clear>Clear</button><button class="btn" type="button" style="flex:1" data-filters-close>Show <span data-show-count></span> products</button></div></div>';
    rangeUI();
  }
  function rangeUI() {
    var mn = $('[data-range-min]'), mx = $('[data-range-max]'); if (!mn) return;
    var lo = +mn.min, hi = +mn.max;
    var a = Math.min(+mn.value, +mx.value), b = Math.max(+mn.value, +mx.value);
    var fill = $('[data-range-fill]'); fill.style.left = ((a - lo) / (hi - lo) * 100) + '%'; fill.style.right = (100 - (b - lo) / (hi - lo) * 100) + '%';
    var sym = Cola.money.symbol(Cola.money.current());
    $('[data-range-lo]').textContent = sym + a; $('[data-range-hi]').textContent = sym + b;
  }

  // ------------------------------------------------------------------ events
  function bind() {
    var drawer = $('[data-filters]'), overlay = $('[data-overlay]');
    function openF() { drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false'); overlay.classList.add('is-open'); Cola.ui.lock(); updateFilterCount(); }
    function closeF() { if (!drawer.classList.contains('is-open')) return; drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); overlay.classList.remove('is-open'); Cola.ui.unlock(); }
    $('[data-filters-open]').addEventListener('click', openF);
    overlay.addEventListener('click', closeF);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeF(); });

    $('[data-cat-tabs]').addEventListener('click', function (e) { var b = e.target.closest('[data-cat]'); if (!b) return; state.category = b.getAttribute('data-cat'); render(); window.scrollTo({ top: Math.min(window.scrollY, $('.catalog-bar').offsetTop - 0), behavior: 'smooth' }); });
    $('[data-q]').addEventListener('input', Cola.debounce(function (e) { state.q = e.target.value.trim(); render(); }, 180));
    $('[data-sort]').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
    $('[data-density]').addEventListener('click', function (e) { var b = e.target.closest('[data-cols]'); if (!b) return; setCols(+b.getAttribute('data-cols')); });

    drawer.addEventListener('click', function (e) {
      if (e.target.closest('[data-filters-close]')) return closeF();
      var t;
      if ((t = e.target.closest('[data-f-size]'))) toggle(state.sizes, t.getAttribute('data-f-size'), t);
      else if ((t = e.target.closest('[data-f-color]'))) toggle(state.colors, t.getAttribute('data-f-color'), t);
      else if ((t = e.target.closest('[data-f-badge]'))) toggle(state.badges, t.getAttribute('data-f-badge'), t);
      else return;
      render();
    });
    drawer.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'avail') state.avail = t.value;
      else if (t.hasAttribute('data-f-collection')) { var i = state.collections.indexOf(t.value); if (t.checked && i < 0) state.collections.push(t.value); if (!t.checked && i >= 0) state.collections.splice(i, 1); }
      else return;
      render();
    });
    drawer.addEventListener('input', function (e) {
      if (!e.target.matches('[data-range-min],[data-range-max]')) return;
      rangeUI();
      var mn = $('[data-range-min]'), mx = $('[data-range-max]');
      var a = Math.min(+mn.value, +mx.value), b = Math.max(+mn.value, +mx.value);
      state.min = a > +mn.min ? a : null; state.max = b < +mn.max ? b : null;
      debouncedRender();
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-clear]')) { state.sizes = []; state.colors = []; state.collections = []; state.badges = []; state.avail = 'all'; state.min = state.max = null; state.q = ''; $('[data-q]').value = ''; filtersPanel(); render(); return; }
      var r = e.target.closest('[data-remove]'); if (!r) return;
      var k = r.getAttribute('data-remove'), v = r.getAttribute('data-val');
      var map = { size: state.sizes, color: state.colors, collection: state.collections, label: state.badges };
      if (map[k]) map[k].splice(map[k].indexOf(v), 1);
      if (k === 'avail') state.avail = 'all';
      if (k === 'price') state.min = state.max = null;
      if (k === 'q') { state.q = ''; $('[data-q]').value = ''; }
      filtersPanel(); render();
    });
    Cola.on('currency:change', function () { state.min = state.max = null; filtersPanel(); render(); });
    Cola.on('saved:change', function () { if (state.category === 'saved') render(); });
    // sticky bar shadow
    var bar = $('[data-catalog-bar]');
    window.addEventListener('scroll', function () { bar.classList.toggle('is-stuck', bar.getBoundingClientRect().top <= (document.body.classList.contains('header-hidden') ? 1 : 90)); }, { passive: true });
  }
  var debouncedRender = Cola.debounce(function () { render(); }, 160);
  function toggle(arr, v, btn) { var i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); btn.setAttribute('aria-pressed', i < 0); }
  function setCols(n) {
    state.cols = n; Cola.store.set('cola.cols', n);
    $('[data-grid]').setAttribute('data-cols', n);
    $$('[data-density] [data-cols]').forEach(function (b) { b.setAttribute('aria-pressed', +b.getAttribute('data-cols') === n); });
  }
})();
