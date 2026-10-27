/* ==========================================================================
   Cola Studio — products ⇄ spreadsheet
   build(ctx, { template })  → workbook model for xlsx.writeXlsx
   parse(book, ctx)          → { items, warnings, errors, missing, counts }
     items: [{ row, action: 'create'|'update', id, name, input, matched, changes }]
   ctx: { products, categories, settings, garments? }
   One row per product on "Products", one row per colour × size on "Stock".
   Shared by the admin (window.ColaAdmin.productSheet) and Node (tests and
   scripts/products-template.js).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.ColaAdmin) window.ColaAdmin.productSheet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATUSES = ['published', 'draft', 'archived'];
  const BADGES = ['new', 'bestseller', 'limited', 'preorder', 'restock'];
  const BADGE_ALIAS = { 'pre-order': 'preorder', 'pre order': 'preorder', 'best seller': 'bestseller', 'best-seller': 'bestseller', restocked: 'restock', nieuw: 'new' };
  const GARMENT_LABEL = {
    tee: 'T-shirt', longsleeve: 'Longsleeve', hoodie: 'Hoodie', ziphoodie: 'Zip hoodie', crewneck: 'Crewneck', sweatpants: 'Sweatpants',
    workjacket: 'Work jacket', bomber: 'Bomber', puffer: 'Puffer', coach: 'Coach jacket', coat: 'Coat', knit: 'Knit sweater', cardigan: 'Cardigan',
    shirt: 'Shirt', overshirt: 'Overshirt', trousers: 'Trousers', jeans: 'Jeans', cargo: 'Cargo pants', shorts: 'Shorts', cap: 'Cap',
    beanie: 'Beanie', tote: 'Tote bag', crossbody: 'Crossbody bag', socks: 'Socks',
  };
  const DEFAULT_GARMENT = { outerwear: 'workjacket', hoodies: 'hoodie', tees: 'tee', knitwear: 'knit', shirts: 'shirt', trousers: 'trousers', accessories: 'cap' };
  const EXAMPLE = 'EXAMPLE';
  const UPLOADED = '[uploaded photo]';
  const ROWS = 1000; // rows covered by dropdowns / help prompts

  /** Swatch colours for common names, so "Black" works without a hex code. */
  const COLOR_HEX = {
    black: '#161514', 'off black': '#262321', 'washed black': '#33302E', ink: '#1E1B1A', white: '#F4F2EE', 'off white': '#EFEBE3', ecru: '#E8E0CC', bone: '#E6DFD2',
    cream: '#EEE6D4', ivory: '#F1EBDD', sand: '#D1BD9C', beige: '#D8C7A8', stone: '#C8C0B1', oatmeal: '#D9CDB8', khaki: '#A89A72', olive: '#5D6046', forest: '#2E3F33',
    green: '#3F5A40', sage: '#9AA58A', lichen: '#9EA184', mint: '#BFD8C6', navy: '#1F2A44', midnight: '#232A38', blue: '#3D5A80', indigo: '#2C3954', 'rinse indigo': '#2C3954',
    denim: '#4A6584', sky: '#A9C6DE', 'sky blue': '#A9C6DE', 'fog blue': '#AFC0CE', grey: '#8D8C89', gray: '#8D8C89', 'heather grey': '#A8A5A0', 'heather gray': '#A8A5A0',
    'light grey': '#C9C7C2', 'light gray': '#C9C7C2', 'dark grey': '#4E4D4B', 'dark gray': '#4E4D4B', charcoal: '#3A3A3C', graphite: '#55585C', brown: '#6B4A35',
    chocolate: '#4A2F22', espresso: '#3E2B21', mocha: '#7A5A48', camel: '#B9895A', caramel: '#B47D4C', tan: '#C49A6C', clay: '#AE7658', rust: '#9A4B2C', orange: '#D9772B',
    red: '#A8322D', burgundy: '#6B2230', wine: '#5E1F2B', pink: '#E5B7B5', purple: '#5B4470', lilac: '#BBA8CF', yellow: '#E2C25B', mustard: '#C9A43A', silver: '#B8B9BB',
    gold: '#C8A951', zwart: '#161514', wit: '#F4F2EE', grijs: '#8D8C89', blauw: '#3D5A80', groen: '#3F5A40', bruin: '#6B4A35', rood: '#A8322D',
  };
  const FALLBACK_HEX = '#9A948E';

  /* ---------------------------------------------------------- columns */
  function productColumns(settings) {
    const agents = ((settings && settings.agents) || []).filter((a) => a && a.id);
    return [
      { key: 'id', header: 'ID', width: 11, style: 'text', title: 'ID', prompt: 'Leave empty for a new product. Filled in by the site (cs-001…). Keep it when you edit an exported product.', ex: ['', ''] },
      { key: 'name', header: 'Name', req: true, width: 30, title: 'Name (required)', prompt: 'Product name as shown on the site.' },
      { key: 'status', header: 'Status', width: 12, list: STATUSES, strict: true, title: 'Status', prompt: 'published = on the site · draft = hidden (default for new rows) · archived = out of the shop.' },
      { key: 'category', header: 'Category', width: 18, source: 'categories', title: 'Category', prompt: 'Pick a category. New categories are made in the admin under Categories.' },
      { key: 'price', header: 'Price (CNY)', req: true, width: 12, title: 'Price in CNY (required)', prompt: 'Price in yuan, numbers only, e.g. 689. The site converts it to EUR, USD and GBP.' },
      { key: 'compareAt', header: 'Was price (CNY)', width: 13, title: 'Was price', prompt: 'Optional. The old price, shown crossed out for a sale. Leave empty otherwise.' },
      { key: 'colors', header: 'Colours', width: 30, title: 'Colours', prompt: 'Comma separated, e.g. Black, Clay #AE7658. Add a #hex code for an exact swatch colour.' },
      { key: 'sizes', header: 'Sizes', width: 20, style: 'text', title: 'Sizes', prompt: 'Comma separated, in order, e.g. S, M, L, XL. One-size accessories: OS.' },
      { key: 'badges', header: 'Badges', width: 16, title: 'Badges', prompt: 'Optional, comma separated: new, bestseller, limited, preorder, restock.' },
      { key: 'featured', header: 'Featured', width: 10, list: ['yes', 'no'], strict: true, title: 'Featured', prompt: 'yes = shown under Selected pieces on the home page.' },
      { key: 'subtitle', header: 'Subtitle', width: 28, title: 'Subtitle', prompt: 'Short line under the name, e.g. 12 oz waxed cotton canvas.' },
      { key: 'description', header: 'Description', width: 50, title: 'Description', prompt: 'Main product text. New line in a cell: Alt+Enter (Mac: Option+Enter).' },
      { key: 'details', header: 'Details', width: 40, title: 'Details', prompt: 'Bullet points, one per line (Alt+Enter between lines).' },
      { key: 'materials', header: 'Materials', width: 30, title: 'Materials', prompt: 'e.g. 100% cotton canvas, 12 oz.' },
      { key: 'fit', header: 'Fit', width: 30, title: 'Fit', prompt: 'e.g. Boxy and slightly cropped. Take your usual size.' },
      { key: 'care', header: 'Care', width: 30, title: 'Care', prompt: 'Care instructions, one per line.' },
      { key: 'collection', header: 'Collection', width: 22, title: 'Collection', prompt: 'Optional, e.g. Vol. 04 — Winter Construction.' },
      { key: 'season', header: 'Season', width: 10, title: 'Season', prompt: 'Optional, e.g. AW26.' },
      { key: 'leadTime', header: 'Lead time', width: 22, title: 'Lead time', prompt: 'Optional, e.g. Ships in 3–5 working days.' },
      { key: 'weightKg', header: 'Weight (kg)', width: 11, title: 'Weight', prompt: 'Optional, in kilograms, e.g. 1.2. Helps with shipping estimates.' },
      { key: 'weidianItemId', header: 'Weidian item ID', width: 16, style: 'text', title: 'Weidian item ID', prompt: 'Optional. The itemID number from the Weidian link. Needed for automatic stock sync.' },
      { key: 'weidianUrl', header: 'Weidian link', width: 30, title: 'Weidian link', prompt: 'Optional. Full link to this product on Weidian.' },
      { key: 'weidianSync', header: 'Weidian stock sync', width: 12, list: ['yes', 'no'], strict: true, title: 'Weidian stock sync', prompt: 'yes = stock for this product is updated from Weidian automatically.' },
      { key: 'weidianInfo', header: 'Weidian price sync', width: 12, list: ['yes', 'no'], strict: true, title: 'Weidian price sync', prompt: 'yes = the price follows Weidian, and Weidian photos are used while the product has none.' },
      ...agents.map((a) => ({
        key: 'agent:' + a.id,
        agent: a.id,
        header: 'Agent link: ' + (a.name || a.id),
        width: 26,
        title: 'Agent link',
        prompt: 'Optional. Direct link to this product at ' + (a.name || a.id) + '. Empty = the agent’s standard link is used.',
      })),
      { key: 'images', header: 'Photo URLs', width: 36, title: 'Photo URLs', prompt: 'Optional, one link per line. Easier: upload photos per product in the admin.' },
      { key: 'garment', header: 'Drawing', width: 16, source: 'garments', title: 'Drawing', prompt: 'Illustration shown while the product has no photos.' },
      { key: 'tags', header: 'Tags', width: 20, title: 'Tags', prompt: 'Optional, comma separated. Used by the search.' },
      { key: 'order', header: 'Sort order', width: 10, title: 'Sort order', prompt: 'Lower numbers come first. Empty = after the others.' },
    ];
  }
  const STOCK_COLUMNS = [
    { key: 'productId', header: 'Product ID', width: 12, style: 'text', title: 'Product ID', prompt: 'ID from the Products sheet. New product without an ID? Leave this empty and fill in the exact product name.' },
    { key: 'productName', header: 'Product name', width: 30, title: 'Product name', prompt: 'Exact name from the Products sheet (used when Product ID is empty).' },
    { key: 'color', header: 'Colour', width: 18, title: 'Colour', prompt: 'One of the colours of the product.' },
    { key: 'size', header: 'Size', width: 10, style: 'text', title: 'Size', prompt: 'One of the sizes of the product.' },
    { key: 'stock', header: 'Stock', width: 9, title: 'Stock', prompt: 'Pieces in stock (0 = sold out).' },
    { key: 'preorder', header: 'Pre-order', width: 10, list: ['yes', 'no'], strict: true, title: 'Pre-order', prompt: 'yes = can be ordered while out of stock.' },
    { key: 'weidianSkuId', header: 'Weidian SKU ID', width: 16, style: 'text', title: 'Weidian SKU ID', prompt: 'Optional. Links this colour + size to its Weidian SKU for stock sync.' },
    { key: 'sku', header: 'SKU', width: 18, style: 'text', title: 'SKU', prompt: 'Optional. Made automatically when empty.' },
  ];

  const HEADER_ALIASES = {
    id: ['id', 'product id', 'productid'],
    name: ['name', 'product name', 'title', 'naam', 'productnaam', 'product'],
    status: ['status'],
    category: ['category', 'categorie', 'category id', 'categoria'],
    price: ['price', 'price cny', 'price yuan', 'prijs', 'prijs cny'],
    compareAt: ['was price', 'was price cny', 'compare at', 'compare at price', 'compareat', 'compare at price cny', 'old price', 'oude prijs'],
    colors: ['colours', 'colors', 'colour', 'color', 'kleuren', 'kleur'],
    sizes: ['sizes', 'size', 'maten', 'maat'],
    badges: ['badges', 'badge', 'labels'],
    featured: ['featured', 'featured on home', 'uitgelicht'],
    subtitle: ['subtitle', 'ondertitel'],
    description: ['description', 'omschrijving', 'beschrijving'],
    details: ['details'],
    materials: ['materials', 'material', 'materiaal', 'materialen'],
    fit: ['fit', 'pasvorm'],
    care: ['care', 'wasvoorschrift', 'care instructions'],
    collection: ['collection', 'collectie'],
    season: ['season', 'seizoen'],
    leadTime: ['lead time', 'leadtime', 'levertijd'],
    weightKg: ['weight kg', 'weight', 'gewicht', 'gewicht kg'],
    weidianItemId: ['weidian item id', 'weidian id', 'weidian itemid', 'weidian item'],
    weidianUrl: ['weidian link', 'weidian url'],
    weidianSync: ['weidian stock sync', 'weidian sync'],
    weidianInfo: ['weidian price sync', 'weidian info sync', 'weidian price and photo sync'],
    images: ['photo urls', 'photos', 'images', 'image urls', 'photo url', 'fotos', 'foto urls', 'foto s'],
    garment: ['drawing', 'garment', 'illustration', 'tekening'],
    tags: ['tags'],
    order: ['sort order', 'order', 'sort', 'volgorde'],
  };
  const STOCK_ALIASES = {
    productId: ['product id', 'id', 'productid'],
    productName: ['product name', 'product', 'name', 'naam', 'productnaam'],
    color: ['colour', 'color', 'kleur'],
    size: ['size', 'maat'],
    stock: ['stock', 'qty', 'quantity', 'voorraad', 'aantal', 'in stock'],
    preorder: ['pre order', 'preorder', 'pre orders'],
    weidianSkuId: ['weidian sku id', 'weidian sku', 'weidian skuid'],
    sku: ['sku'],
  };

  /* ---------------------------------------------------------- helpers */
  const norm = (s) =>
    String(s == null ? '' : s)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\*/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const slugify = (s) =>
    String(s || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  const text = (v) => (v == null ? '' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)).replace(/\r\n?/g, '\n').trim();
  const isEmpty = (v) => text(v) === '';
  const lower = (s) => String(s || '').trim().toLowerCase();
  const splitList = (v) =>
    text(v)
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  const splitLines = (v) =>
    text(v)
      .split(/\n|\s\|\s/)
      .map((s) => s.replace(/^\s*(?:[-•*·]|\d+[.)])\s+/, '').trim())
      .filter(Boolean);
  const uniq = (list, key) => {
    const seen = new Set();
    return list.filter((x) => {
      const k = key ? key(x) : lower(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  /** "689", "¥ 1.299,00", "1,299.5", "€12,50" → number; '' → null; junk → NaN */
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    let s = text(v).replace(/[¥￥€$£\s]|cny|rmb|yuan|eur|usd/gi, '');
    if (!s) return null;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lastComma >= 0) s = /,\d{1,2}$/.test(s) && (s.match(/,/g) || []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  /** yes/no in several spellings → true/false; '' → null; junk → undefined */
  function yesNo(v) {
    if (typeof v === 'boolean') return v;
    const s = lower(text(v));
    if (!s) return null;
    if (['yes', 'y', 'ja', 'j', 'true', '1', 'x', '✓', '✔', 'on', 'waar'].includes(s)) return true;
    if (['no', 'n', 'nee', 'false', '0', 'off', '-', 'onwaar'].includes(s)) return false;
    return undefined;
  }
  function parseColor(item) {
    const m = /^(.*?)[\s(:–-]*#([0-9a-f]{6}|[0-9a-f]{3})\)?\s*$/i.exec(item);
    if (m) return { name: m[1].trim().replace(/[\s(:–-]+$/, ''), hex: '#' + m[2].toUpperCase() };
    return { name: item.trim(), hex: '' };
  }
  const colorCell = (colors) => (colors || []).map((c) => (c.hex ? c.name + ' ' + String(c.hex).toUpperCase() : c.name)).join(', ');

  function headerMap(row, aliases) {
    const map = {};
    const unknown = [];
    (row || []).forEach((h, i) => {
      const raw = text(h);
      if (!raw) return;
      const agent = /^\s*agent\s*link\s*[:\-–]?\s*(.+)$/i.exec(raw);
      if (agent && aliases === HEADER_ALIASES) {
        map['agent:' + agent[1].trim()] = i;
        return;
      }
      const n = norm(raw);
      const key = Object.keys(aliases).find((k) => aliases[k].includes(n));
      if (key && map[key] === undefined) map[key] = i;
      else if (!key) unknown.push(raw);
    });
    return { map, unknown };
  }
  function findHeaderRow(rows, aliases, mustHave) {
    for (let r = 0; r < Math.min(rows.length, 8); r++) {
      const { map, unknown } = headerMap(rows[r], aliases);
      if (mustHave.every((k) => map[k] !== undefined)) return { index: r, map, unknown };
    }
    return null;
  }

  /* ------------------------------------------------------------ build */
  function build(ctx, opts) {
    const o = opts || {};
    const settings = ctx.settings || {};
    const categories = ctx.categories || [];
    const garments = ctx.garments || GARMENT_LABEL;
    const catName = (id) => (categories.find((c) => c.id === id) || {}).name || id || '';
    const cols = productColumns(settings);
    const products = o.template ? [] : [...(ctx.products || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    const productRow = (p, example) => {
      const w = p.weidian || {};
      const st = example ? 'example' : null;
      return cols.map((c) => {
        let v;
        switch (c.key) {
          case 'id':
            v = example ? EXAMPLE : p.id;
            break;
          case 'category':
            v = catName(p.category);
            break;
          case 'compareAt':
            v = p.compareAt || null;
            break;
          case 'colors':
            v = colorCell(p.colors);
            break;
          case 'sizes':
            v = (p.sizes || []).join(', ');
            break;
          case 'badges':
          case 'tags':
            v = (p[c.key] || []).join(', ');
            break;
          case 'featured':
            v = p.featured ? 'yes' : 'no';
            break;
          case 'details':
          case 'care':
            v = (p[c.key] || []).join('\n');
            break;
          case 'weidianItemId':
            v = w.itemId || '';
            break;
          case 'weidianUrl':
            v = w.url || '';
            break;
          case 'weidianSync':
            v = w.syncEnabled ? 'yes' : 'no';
            break;
          case 'weidianInfo':
            v = w.syncInfo ? 'yes' : 'no';
            break;
          case 'images':
            v = (p.images || []).map((i) => (/^data:/i.test(i.url || '') ? UPLOADED : i.url)).join('\n');
            break;
          case 'garment':
            v = garments[p.garment] || p.garment || '';
            break;
          default:
            if (c.agent) v = (p.agentLinks || {})[c.agent] || '';
            else v = p[c.key];
        }
        if (v === undefined || v === null || v === '') return st ? { v: null, s: st } : null;
        const s = st ? (c.style === 'text' ? 'exampleText' : 'example') : null;
        return s ? { v, s } : v;
      });
    };

    const head = cols.map((c) => ({ v: c.header + (c.req ? ' *' : ''), s: c.req ? 'headerReq' : 'header' }));
    const pRows = [head];
    const sRows = [STOCK_COLUMNS.map((c) => ({ v: c.header, s: c.key === 'stock' ? 'headerReq' : 'header' }))];
    const stockRow = (p, v, example) => {
      const cells = [example ? EXAMPLE : p.id, p.name, v.color, v.size, Number(v.stock) || 0, v.preorder ? 'yes' : 'no', v.weidianSkuId || '', example ? '' : v.sku || ''];
      return example ? cells.map((x, i) => ({ v: x === '' ? null : x, s: STOCK_COLUMNS[i].style === 'text' ? 'exampleText' : 'example' })) : cells.map((x) => (x === '' ? null : x));
    };
    const list = o.template ? examples(categories) : products;
    for (const p of list) {
      pRows.push(productRow(p, o.template));
      for (const v of p.variants || []) sRows.push(stockRow(p, v, o.template));
    }

    // Lists sheet (dropdown sources).
    const catNames = categories.map((c) => c.name || c.id);
    const garmentNames = Object.keys(garments).map((k) => garments[k]);
    const listCols = [
      { h: 'Categories', v: catNames },
      { h: 'Drawings', v: garmentNames },
      { h: 'Status', v: STATUSES },
      { h: 'Badges', v: BADGES },
      { h: 'Yes / no', v: ['yes', 'no'] },
    ];
    const maxLen = Math.max(...listCols.map((c) => c.v.length));
    const lRows = [listCols.map((c) => ({ v: c.h, s: 'header' }))];
    for (let i = 0; i < maxLen; i++) lRows.push(listCols.map((c) => (c.v[i] !== undefined ? c.v[i] : null)));
    const source = (name) => {
      const idx = name === 'categories' ? 0 : 1;
      const len = listCols[idx].v.length;
      const L = String.fromCharCode(65 + idx);
      return len ? 'Lists!$' + L + '$2:$' + L + '$' + (len + 1) : '';
    };
    const colLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
    const validations = (columns) =>
      columns.map((c, i) => {
        const range = colLetter(i) + '2:' + colLetter(i) + ROWS;
        const src = c.source ? source(c.source) : '';
        return { range, list: c.list, source: src || undefined, strict: !!c.strict, title: c.title, prompt: c.prompt, errorTitle: c.title, error: c.list ? 'Choose ' + c.list.join(' or ') + '.' : 'This value is not in the list. It is kept, but check the spelling.' };
      });

    const help = helpSheet(cols, o.template);
    // Keep product rows two lines high so the sheet stays scannable; click a cell to read all of it.
    const pHeights = { 0: 32 };
    for (let i = 1; i < pRows.length; i++) pHeights[i] = 32;
    const book = {
      title: o.template ? 'Cola Studio — product template' : 'Cola Studio — products',
      active: o.template ? 0 : 1,
      sheets: [
        help,
        { name: 'Products', tab: '#130D0A', rows: pRows, cols: cols.map((c) => ({ width: c.width, style: c.style })), freeze: { rows: 1, cols: 2 }, heights: pHeights, validations: validations(cols) },
        { name: 'Stock', tab: '#C07A42', rows: sRows, cols: STOCK_COLUMNS.map((c) => ({ width: c.width, style: c.style })), freeze: { rows: 1, cols: 2 }, heights: { 0: 32 }, validations: validations(STOCK_COLUMNS) },
        { name: 'Lists', rows: lRows, cols: listCols.map(() => ({ width: 22 })), freeze: { rows: 1 } },
      ],
    };
    return book;
  }

  function helpSheet(cols, template) {
    const rows = [];
    const heights = {};
    const add = (cells, h) => {
      if (h) heights[rows.length] = h;
      rows.push(cells);
    };
    const lines = (str, width) => Math.max(1, String(str).split('\n').reduce((n, l) => n + Math.ceil((l.length || 1) / width), 0));
    add([{ v: 'Cola Studio — product sheet', s: 'title' }], 30);
    add([{ v: template ? 'Fill in your products, then import this file in the admin: Products → Spreadsheet → Import.' : 'Exported from the admin. Edit it and import it again: Products → Spreadsheet → Import.', s: 'note' }], 20);
    add([]);
    const steps = [
      ['1', 'Products sheet', 'One row per product. Only Name and Price are required. Everything else can be added later, here or in the admin.'],
      ['2', 'Stock sheet', 'One row per colour + size with the number in stock. Skip it and every combination starts at 0 (existing products keep their stock).'],
      ['3', 'New or existing', 'New product: leave ID empty. Editing an exported product: keep its ID. A row without ID whose name already exists updates that product.'],
      ['4', 'Lists and lines', 'Colours, Sizes, Badges and Tags: separate with commas. Details and Care: one item per line (Alt+Enter, on a Mac Option+Enter).'],
      ['5', 'Examples', 'Rows with ID “' + EXAMPLE + '” are ignored. Overwrite them with your own products or delete them.'],
      ['6', 'Importing', 'You see a preview (new, updated, warnings) before anything changes, and the server saves a backup first.'],
      ['7', 'Photos & size table', 'Photos and the measurements table are easiest in the product editor in the admin. They are kept when you import this sheet again.'],
    ];
    for (const s of steps) add([{ v: s[0], s: 'bold' }, { v: s[1], s: 'bold' }, { v: s[2], s: 'wrap' }], 16 * lines(s[2], 100) + 4);
    add([]);
    add([{ v: 'Columns', s: 'title' }], 26);
    add([{ v: 'Sheet', s: 'header' }, { v: 'Column', s: 'header' }, { v: 'What to fill in', s: 'header' }], 22);
    for (const c of cols) add([{ v: 'Products', s: 'note' }, { v: c.header + (c.req ? ' *' : ''), s: 'bold' }, { v: c.prompt || '', s: 'wrap' }], 16 * lines(c.prompt || '', 100) + 4);
    for (const c of STOCK_COLUMNS) add([{ v: 'Stock', s: 'note' }, { v: c.header, s: 'bold' }, { v: c.prompt || '', s: 'wrap' }], 16 * lines(c.prompt || '', 100) + 4);
    return { name: 'How to fill in', tab: '#E9CDAE', rows, heights, merges: ['A1:C1', 'A2:C2'], cols: [{ width: 10 }, { width: 24 }, { width: 96 }], gridLines: false };
  }

  /** Three clearly marked example rows for the empty template. */
  function examples(categories) {
    const cat = (id, fallback) => (categories.some((c) => c.id === id) ? id : (categories[0] && categories[0].id) || fallback);
    const variants = (colors, sizes, stock) => {
      const out = [];
      let i = 0;
      for (const c of colors) for (const s of sizes) out.push({ color: c.name, size: s, stock: stock[i++ % stock.length], preorder: false });
      return out;
    };
    const jacketColors = [{ name: 'Clay', hex: '#AE7658' }, { name: 'Ink', hex: '#1E1B1A' }];
    return [
      {
        name: 'Example — Canvas Work Jacket', status: 'published', category: cat('outerwear', ''), price: 689, compareAt: null, colors: jacketColors, sizes: ['S', 'M', 'L', 'XL'],
        badges: ['new'], featured: true, subtitle: '12 oz waxed cotton canvas',
        description: 'A chore jacket in dense 12 oz canvas, lightly waxed after dyeing. Triple-needle seams and a corduroy collar.',
        details: ['12 oz cotton canvas, light wax finish', 'Corduroy-faced collar', 'Four patch pockets'], materials: '100% cotton canvas', fit: 'Boxy, slightly cropped. Take your usual size.',
        care: ['Spot clean', 'Cold hand wash only'], collection: 'Vol. 04 — Winter Construction', season: 'AW26', leadTime: 'Ships in 3–5 working days', weightKg: 1.3,
        weidian: { itemId: '', url: '', syncEnabled: false }, agentLinks: {}, images: [], garment: 'workjacket', tags: ['outerwear', 'canvas'], order: 10,
        variants: variants(jacketColors, ['S', 'M', 'L', 'XL'], [4, 12, 9, 2]),
      },
      {
        name: 'Example — Heavyweight Tee', status: 'draft', category: cat('tees', ''), price: 239, compareAt: 299, colors: [{ name: 'Black', hex: '' }, { name: 'Bone', hex: '#E6DFD2' }],
        sizes: ['S', 'M', 'L', 'XL', 'XXL'], badges: ['bestseller'], featured: false, subtitle: '260 gsm compact jersey', description: 'Boxy tee in a dense, compact jersey.',
        details: ['260 gsm cotton jersey', 'Ribbed neck'], materials: '100% cotton', fit: 'Boxy fit', care: ['Wash cold, inside out'], collection: '', season: '', leadTime: '', weightKg: 0.35,
        weidian: { itemId: '', url: '', syncEnabled: false }, agentLinks: {}, images: [], garment: 'tee', tags: [], order: 20, variants: [],
      },
      {
        name: 'Example — Six-Panel Cap', status: 'published', category: cat('accessories', ''), price: 189, compareAt: null, colors: [{ name: 'Ink', hex: '#1E1B1A' }], sizes: ['OS'],
        badges: [], featured: false, subtitle: 'Washed cotton twill', description: 'Six-panel cap with an embroidered monogram.', details: [], materials: '100% cotton twill', fit: 'Adjustable strap',
        care: [], collection: '', season: '', leadTime: '', weightKg: 0.12, weidian: { itemId: '', url: '', syncEnabled: false }, agentLinks: {}, images: [], garment: 'cap', tags: [], order: 30,
        variants: [{ color: 'Ink', size: 'OS', stock: 25, preorder: false }],
      },
    ];
  }

  /* ------------------------------------------------------------ parse */
  function parse(book, ctx) {
    const products = ctx.products || [];
    const categories = ctx.categories || [];
    const settings = ctx.settings || {};
    const garments = ctx.garments || GARMENT_LABEL;
    const agents = (settings.agents || []).filter((a) => a && a.id);
    const warnings = [];
    const errors = [];
    const warn = (sheet, row, msg) => warnings.push({ sheet, row, msg });
    const fail = (sheet, row, msg) => errors.push({ sheet, row, msg });
    const sheets = (book && book.sheets) || [];

    // ---- locate sheets
    const isHelp = (s) => /how to|lists?$|instructions|uitleg/i.test(s.name);
    let pSheet = sheets.find((s) => /product/i.test(s.name) && findHeaderRow(s.rows, HEADER_ALIASES, ['name']));
    if (!pSheet) pSheet = sheets.find((s) => !isHelp(s) && !/stock|voorraad|inventory/i.test(s.name) && findHeaderRow(s.rows, HEADER_ALIASES, ['name']));
    let sSheet = sheets.find((s) => s !== pSheet && /stock|voorraad|inventory/i.test(s.name) && findHeaderRow(s.rows, STOCK_ALIASES, ['stock']));
    if (!sSheet) sSheet = sheets.find((s) => s !== pSheet && !isHelp(s) && findHeaderRow(s.rows, STOCK_ALIASES, ['stock', 'color', 'size']));
    if (!pSheet && !sSheet) {
      fail('', 0, 'No Products sheet found. The first row needs column names such as Name and Price — download the template from the admin to start from.');
      return { items: [], warnings, errors, missing: [], counts: { create: 0, update: 0, unchanged: 0, skipped: 0, examples: 0 } };
    }

    const byId = new Map(products.map((p) => [p.id, p]));
    const byName = new Map();
    for (const p of products) {
      const k = lower(p.name);
      byName.set(k, byName.has(k) ? null : p); // null = ambiguous
    }
    const catOf = (v) => {
      const s = text(v);
      if (!s) return '';
      const n = norm(s);
      const c = categories.find((x) => norm(x.id) === n || norm(x.name) === n);
      return c ? c.id : null;
    };
    const garmentOf = (v) => {
      const n = norm(v);
      if (!n) return '';
      const id = Object.keys(garments).find((k) => norm(k) === n || norm(garments[k]) === n);
      return id || null;
    };
    const agentOf = (label) => {
      const m = /\[([^\]]+)\]\s*$/.exec(label);
      const n = norm(m ? m[1] : label);
      const a = agents.find((x) => norm(x.id) === n || norm(x.name) === n);
      return a ? a.id : null;
    };

    // ---- products sheet
    const targets = []; // { row, action, id, name, existing, data }
    const seen = new Map(); // target key → row
    let examplesSkipped = 0;
    let skipped = 0;
    if (pSheet) {
      const h = findHeaderRow(pSheet.rows, HEADER_ALIASES, ['name']);
      const S = pSheet.name;
      if (h.unknown.length) warn(S, h.index + 1, 'Column' + (h.unknown.length > 1 ? 's' : '') + ' ignored: ' + h.unknown.join(', ') + '.');
      for (const k of Object.keys(h.map)) if (k.startsWith('agent:') && !agentOf(k.slice(6))) warn(S, h.index + 1, 'Column “Agent link: ' + k.slice(6) + '” ignored — no agent with that name in Settings → Agents.');
      const col = (row, key) => (h.map[key] === undefined ? undefined : row[h.map[key]]);
      const has = (key) => h.map[key] !== undefined;
      for (let r = h.index + 1; r < pSheet.rows.length; r++) {
        const row = pSheet.rows[r] || [];
        const rowNo = r + 1;
        if (!row.some((v) => !isEmpty(v))) continue;
        const idCell = text(col(row, 'id'));
        if (idCell.toUpperCase() === EXAMPLE) {
          examplesSkipped++;
          continue;
        }
        const name = text(col(row, 'name'));
        if (!name) {
          fail(S, rowNo, 'Name is empty — row skipped.');
          skipped++;
          continue;
        }
        let existing = null;
        let matched = null;
        if (idCell) {
          existing = byId.get(idCell) || null;
          if (existing) matched = 'id';
          else warn(S, rowNo, 'ID ' + idCell + ' does not exist (any more) — “' + name + '” is added as a new product.');
        } else {
          const e = byName.get(lower(name));
          if (e) {
            existing = e;
            matched = 'name';
          } else if (e === null) warn(S, rowNo, 'More than one product is called “' + name + '” — added as a new product. Fill in the ID to update one of them.');
        }
        const key = existing ? 'id:' + existing.id : 'name:' + lower(name);
        if (seen.has(key)) {
          fail(S, rowNo, '“' + name + '” is already on row ' + seen.get(key) + ' — row skipped.');
          skipped++;
          continue;
        }
        seen.set(key, rowNo);

        const input = {};
        let bad = false;
        const rowFail = (msg) => {
          fail(S, rowNo, msg + ' — row skipped.');
          bad = true;
        };
        input.name = matched === 'name' ? existing.name : name; // name match is case-insensitive: keep the shop's spelling
        if (has('status')) {
          const s = lower(text(col(row, 'status')));
          if (s) {
            const st = STATUSES.find((x) => x === s) || { live: 'published', online: 'published', visible: 'published', hidden: 'draft', concept: 'draft', gepubliceerd: 'published' }[s];
            if (st) input.status = st;
            else warn(S, rowNo, 'Status “' + s + '” unknown — use published, draft or archived. ' + (existing ? 'Kept ' + existing.status + '.' : 'Saved as draft.'));
          }
        }
        if (!existing && !input.status) input.status = 'draft';
        if (has('price')) {
          const p = num(col(row, 'price'));
          if (p === null) {
            if (!existing) rowFail('Price is empty');
          } else if (Number.isNaN(p) || p < 0) rowFail('Price “' + text(col(row, 'price')) + '” is not a number');
          else input.price = Math.round(p * 100) / 100;
        } else if (!existing) rowFail('Price is missing');
        if (has('compareAt')) {
          const p = num(col(row, 'compareAt'));
          if (p === null || p === 0) input.compareAt = null;
          else if (Number.isNaN(p) || p < 0) warn(S, rowNo, 'Was price “' + text(col(row, 'compareAt')) + '” is not a number — ignored.');
          else input.compareAt = Math.round(p * 100) / 100;
        }
        if (has('category')) {
          const raw = text(col(row, 'category'));
          const c = catOf(raw);
          if (c === null) {
            input.category = slugify(raw);
            warn(S, rowNo, 'Category “' + raw + '” does not exist yet — create it under Categories, otherwise the product only shows under All.');
          } else input.category = c;
        }
        if (has('colors')) {
          const items = splitList(col(row, 'colors')).map(parseColor).filter((c) => c.name);
          if (items.length) {
            input.colors = uniq(items, (c) => lower(c.name)).map((c) => {
              const old = existing && (existing.colors || []).find((x) => lower(x.name) === lower(c.name));
              let hex = c.hex || (old && old.hex) || COLOR_HEX[lower(c.name)] || '';
              if (!hex) {
                hex = FALLBACK_HEX;
                warn(S, rowNo, 'Colour “' + c.name + '” has no #hex code — the swatch is grey until you add one (e.g. ' + c.name + ' #2E3F33).');
              }
              return Object.assign({}, old || {}, { name: c.name, hex });
            });
          }
        }
        if (has('sizes')) {
          const sizes = uniq(splitList(col(row, 'sizes')));
          if (sizes.length) input.sizes = sizes;
        }
        if (has('badges')) {
          const out = [];
          for (const b of splitList(col(row, 'badges'))) {
            const k = BADGE_ALIAS[lower(b)] || lower(b);
            if (BADGES.includes(k)) out.push(k);
            else warn(S, rowNo, 'Badge “' + b + '” unknown — use ' + BADGES.join(', ') + '.');
          }
          input.badges = uniq(out);
        }
        if (has('featured')) {
          const b = yesNo(col(row, 'featured'));
          if (b === undefined) warn(S, rowNo, 'Featured “' + text(col(row, 'featured')) + '” — use yes or no. Ignored.');
          else input.featured = !!b;
        }
        for (const k of ['subtitle', 'description', 'materials', 'fit', 'collection', 'season', 'leadTime']) if (has(k)) input[k] = text(col(row, k));
        for (const k of ['details', 'care']) if (has(k)) input[k] = splitLines(col(row, k));
        if (has('tags')) input.tags = uniq(splitList(col(row, 'tags')));
        if (has('weightKg')) {
          const w = num(col(row, 'weightKg'));
          if (w === null) input.weightKg = null;
          else if (Number.isNaN(w) || w < 0) warn(S, rowNo, 'Weight “' + text(col(row, 'weightKg')) + '” is not a number — ignored.');
          else input.weightKg = w;
        }
        if (has('order')) {
          const n = num(col(row, 'order'));
          if (n !== null && !Number.isNaN(n)) input.order = n;
          else if (n !== null) warn(S, rowNo, 'Sort order “' + text(col(row, 'order')) + '” is not a number — ignored.');
        }
        if (has('garment')) {
          const raw = text(col(row, 'garment'));
          const g = garmentOf(raw);
          if (g === null) warn(S, rowNo, 'Drawing “' + raw + '” unknown — pick one from the Lists sheet. Ignored.');
          else if (g) input.garment = g;
        }
        if (!existing && !input.garment) input.garment = DEFAULT_GARMENT[input.category] || 'tee';
        if (has('weidianItemId') || has('weidianUrl') || has('weidianSync') || has('weidianInfo')) {
          const w = Object.assign({ itemId: '', url: '', syncEnabled: false, syncInfo: false, lastSyncedAt: null }, (existing && existing.weidian) || {});
          if (has('weidianItemId')) w.itemId = text(col(row, 'weidianItemId')).replace(/\.0+$/, '');
          if (has('weidianUrl')) {
            const u = text(col(row, 'weidianUrl'));
            if (u && !/^https?:\/\//i.test(u)) warn(S, rowNo, 'Weidian link should start with https:// — ignored.');
            else w.url = u;
          }
          for (const [k, f] of [['weidianSync', 'syncEnabled'], ['weidianInfo', 'syncInfo']]) {
            if (!has(k)) continue;
            const b = yesNo(col(row, k));
            if (b !== undefined && b !== null) w[f] = b;
          }
          if (w.syncEnabled && !w.itemId && !w.url) warn(S, rowNo, 'Weidian stock sync is on, but there is no Weidian item ID or link yet.');
          input.weidian = w;
        }
        const agentKeys = Object.keys(h.map).filter((k) => k.startsWith('agent:'));
        if (agentKeys.length) {
          const links = Object.assign({}, (existing && existing.agentLinks) || {});
          for (const k of agentKeys) {
            const id = agentOf(k.slice(6));
            if (!id) continue;
            const u = text(row[h.map[k]]);
            if (!u) delete links[id];
            else if (!/^https?:\/\//i.test(u)) warn(S, rowNo, 'Agent link for ' + k.slice(6) + ' should start with https:// — ignored.');
            else links[id] = u;
          }
          input.agentLinks = links;
        }
        if (has('images')) {
          const old = (existing && existing.images) || [];
          const uploaded = old.filter((i) => /^data:/i.test(i.url || ''));
          const imgs = [];
          for (const line of splitLines(col(row, 'images')).flatMap((l) => l.split(/\s+(?=https?:\/\/)/))) {
            if (line.toLowerCase() === UPLOADED) {
              const u = uploaded.shift();
              if (u) imgs.push(u);
              continue;
            }
            if (!/^(https?:\/\/|\/)/i.test(line)) {
              warn(S, rowNo, 'Photo “' + line.slice(0, 60) + '” is not a link (https://…) — ignored.');
              continue;
            }
            imgs.push(old.find((i) => i.url === line) || { url: line, alt: '', color: '' });
          }
          input.images = uniq(imgs, (i) => i.url);
        }
        if (bad) {
          skipped++;
          seen.delete(key);
          continue;
        }
        if (existing && existing.demo && (input.name !== existing.name || (input.price !== undefined && input.price !== existing.price) || (input.description !== undefined && input.description !== (existing.description || '')))) input.demo = false;
        targets.push({ row: rowNo, sheet: S, action: existing ? 'update' : 'create', id: existing ? existing.id : null, name, existing, matched, input, stock: [] });
      }
    }

    // ---- stock sheet
    if (sSheet) {
      const h = findHeaderRow(sSheet.rows, STOCK_ALIASES, ['stock']);
      const S = sSheet.name;
      const col = (row, key) => (h.map[key] === undefined ? undefined : row[h.map[key]]);
      if (h.map.productId === undefined && h.map.productName === undefined) warn(S, h.index + 1, 'The Stock sheet needs a Product ID or Product name column — stock ignored.');
      else
        for (let r = h.index + 1; r < sSheet.rows.length; r++) {
          const row = sSheet.rows[r] || [];
          const rowNo = r + 1;
          if (!row.some((v) => !isEmpty(v))) continue;
          const pid = text(col(row, 'productId'));
          if (pid.toUpperCase() === EXAMPLE) continue;
          const pname = text(col(row, 'productName'));
          let t = null;
          if (pid) t = targets.find((x) => x.id === pid) || null;
          if (!t && pname) t = targets.find((x) => lower(x.name) === lower(pname)) || null;
          if (!t) {
            const e = (pid && byId.get(pid)) || (pname && byName.get(lower(pname))) || null;
            if (e) {
              t = targets.find((x) => x.id === e.id);
              if (!t) {
                t = { row: rowNo, sheet: S, action: 'update', id: e.id, name: e.name, existing: e, matched: pid ? 'id' : 'name', input: { name: e.name }, stock: [], stockOnly: true };
                targets.push(t);
              }
            }
          }
          if (!t) {
            warn(S, rowNo, 'Product “' + (pid || pname || '?') + '” not found on the Products sheet or in the shop — stock row skipped.');
            continue;
          }
          const stockRaw = col(row, 'stock');
          const n = num(stockRaw);
          if (n !== null && (Number.isNaN(n) || n < 0)) {
            warn(S, rowNo, 'Stock “' + text(stockRaw) + '” is not a number — row skipped.');
            continue;
          }
          const pre = yesNo(col(row, 'preorder'));
          t.stock.push({
            row: rowNo,
            color: text(col(row, 'color')),
            size: text(col(row, 'size')),
            stock: n === null ? 0 : Math.trunc(n),
            preorder: pre === undefined ? null : pre,
            weidianSkuId: h.map.weidianSkuId === undefined ? undefined : text(col(row, 'weidianSkuId')).replace(/\.0+$/, ''),
            sku: text(col(row, 'sku')),
          });
        }
    }

    // ---- variants per target
    for (const t of targets) {
      const S = t.sheet;
      const e = t.existing;
      let colors = t.input.colors || (e && e.colors) || [];
      let sizes = t.input.sizes || (e && e.sizes) || [];
      if (!colors.length) {
        if (t.stock.some((s) => s.color)) colors = [];
        else {
          colors = [{ name: 'Default', hex: FALLBACK_HEX }];
          warn(S, t.row, '“' + t.name + '” has no colours — added one colour called Default. Fill in Colours to change it.');
        }
      }
      if (!sizes.length && !t.stock.some((s) => s.size)) {
        sizes = ['OS'];
        if (!e) warn(S, t.row, '“' + t.name + '” has no sizes — saved as one size (OS).');
      }
      colors = colors.slice();
      sizes = sizes.slice();
      // Colours/sizes that only appear on the Stock sheet are added.
      for (const s of t.stock) {
        if (!s.color && colors.length === 1) s.color = colors[0].name;
        if (!s.size && sizes.length === 1) s.size = sizes[0];
        if (!s.color || !s.size) {
          warn(sSheet ? sSheet.name : 'Stock', s.row, 'Fill in Colour and Size for “' + t.name + '” — stock row skipped.');
          s.skip = true;
          continue;
        }
        const c = colors.find((x) => lower(x.name) === lower(s.color));
        if (c) s.color = c.name;
        else {
          colors.push({ name: s.color, hex: COLOR_HEX[lower(s.color)] || FALLBACK_HEX });
          warn(sSheet.name, s.row, 'Colour “' + s.color + '” is not in the Colours of “' + t.name + '” — added.');
        }
        const z = sizes.find((x) => lower(x) === lower(s.size));
        if (z) s.size = z;
        else {
          sizes.push(s.size);
          warn(sSheet.name, s.row, 'Size “' + s.size + '” is not in the Sizes of “' + t.name + '” — added.');
        }
      }
      if (t.input.colors || colors.length !== ((e && e.colors) || []).length || !t.input.colors) {
        if (t.input.colors || colors.some((c) => !((e && e.colors) || []).some((x) => lower(x.name) === lower(c.name)))) t.input.colors = colors;
      }
      if (t.input.sizes || sizes.some((z) => !((e && e.sizes) || []).some((x) => lower(x) === lower(z)))) t.input.sizes = sizes;
      const changesShape = !!(t.input.colors || t.input.sizes) || !e;
      if (!changesShape && !t.stock.length) continue;
      const variants = [];
      const used = new Set();
      for (const c of colors) {
        for (const z of sizes) {
          const k = lower(c.name) + '|' + lower(z);
          const fromSheet = t.stock.filter((s) => !s.skip && lower(s.color) === lower(c.name) && lower(s.size) === lower(z));
          const s = fromSheet[fromSheet.length - 1];
          if (fromSheet.length > 1) warn(sSheet.name, s.row, c.name + ' / ' + z + ' of “' + t.name + '” appears more than once — the last row counts.');
          const old = e && (e.variants || []).find((v) => lower(v.color) === lower(c.name) && lower(v.size) === lower(z));
          const v = Object.assign({}, old || {}, { color: c.name, size: z });
          if (s) {
            v.stock = s.stock;
            if (s.preorder !== null && s.preorder !== undefined) v.preorder = s.preorder;
            if (s.weidianSkuId !== undefined) v.weidianSkuId = s.weidianSkuId;
            if (s.sku && !used.has(s.sku.toUpperCase())) v.sku = s.sku;
          }
          if (v.stock === undefined) v.stock = 0;
          if (v.preorder === undefined) v.preorder = false;
          if (v.sku) {
            if (used.has(String(v.sku).toUpperCase())) delete v.sku;
            else used.add(String(v.sku).toUpperCase());
          }
          variants.push(v);
          used.add(k);
        }
      }
      t.input.variants = variants;
    }

    // ---- changes + summary
    const items = [];
    let unchanged = 0;
    for (const t of targets) {
      const changes = t.existing ? diff(t.existing, t.input) : [];
      if (t.existing && !changes.length) {
        unchanged++;
        continue;
      }
      items.push({ row: t.row, sheet: t.sheet, action: t.action, id: t.id, name: t.name, matched: t.matched, input: t.input, changes, stockOnly: !!t.stockOnly });
    }
    const referenced = new Set(targets.filter((t) => t.id).map((t) => t.id));
    const missing = pSheet ? products.filter((p) => !referenced.has(p.id)).map((p) => ({ id: p.id, name: p.name, demo: !!p.demo, status: p.status })) : [];
    const counts = {
      create: items.filter((i) => i.action === 'create').length,
      update: items.filter((i) => i.action === 'update').length,
      unchanged,
      skipped,
      examples: examplesSkipped,
    };
    return { items, warnings, errors, missing, counts, sheets: { products: pSheet ? pSheet.name : null, stock: sSheet ? sSheet.name : null } };
  }

  const LABEL = {
    name: 'name', status: 'status', price: 'price', compareAt: 'was price', category: 'category', colors: 'colours', sizes: 'sizes', badges: 'badges', featured: 'featured',
    subtitle: 'subtitle', description: 'description', details: 'details', materials: 'materials', fit: 'fit', care: 'care', collection: 'collection', season: 'season',
    leadTime: 'lead time', weightKg: 'weight', order: 'sort order', garment: 'drawing', weidian: 'Weidian', agentLinks: 'agent links', images: 'photos', tags: 'tags', variants: 'stock',
  };
  function diff(e, input) {
    const out = [];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const k of Object.keys(input)) {
      if (k === 'demo') continue;
      const a = e[k];
      const b = input[k];
      let eq;
      if (k === 'colors') eq = same((a || []).map((c) => [lower(c.name), lower(c.hex)]), (b || []).map((c) => [lower(c.name), lower(c.hex)]));
      else if (k === 'variants') {
        const key = (v) => lower(v.color) + '|' + lower(v.size) + '|' + (Number(v.stock) || 0) + '|' + !!v.preorder + '|' + (v.weidianSkuId || '');
        eq = same((a || []).map(key).sort(), (b || []).map(key).sort());
      } else if (k === 'weidian') eq = same([(a || {}).itemId || '', (a || {}).url || '', !!(a || {}).syncEnabled, !!(a || {}).syncInfo], [b.itemId || '', b.url || '', !!b.syncEnabled, !!b.syncInfo]);
      else if (k === 'images') eq = same((a || []).map((i) => i.url), (b || []).map((i) => i.url));
      else if (k === 'agentLinks') eq = same(Object.entries(a || {}).filter((x) => x[1]).sort(), Object.entries(b || {}).filter((x) => x[1]).sort());
      else if (typeof b === 'number' || b === null) eq = (a == null && b == null) || Number(a) === Number(b);
      else if (typeof b === 'boolean') eq = !!a === b;
      else if (Array.isArray(b)) eq = same((a || []).map(String), b);
      else eq = String(a == null ? '' : a).replace(/\r\n?/g, '\n').trim() === String(b).trim();
      if (!eq) out.push(LABEL[k] || k);
    }
    return out;
  }

  return { build, parse, productColumns, STOCK_COLUMNS, EXAMPLE, UPLOADED, COLOR_HEX, num, yesNo, parseColor };
});
