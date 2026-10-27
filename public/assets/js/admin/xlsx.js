/* ==========================================================================
   Cola Studio — tiny spreadsheet toolkit (no dependencies)
   • writeXlsx(book)  → Uint8Array (.xlsx: shared strings, a few styles,
                        frozen panes, column widths, list dropdowns, help prompts)
   • readXlsx(bytes)  → Promise<{ sheets: [{ name, rows: [[cell…]…] }] }>
   • parseCsv(text)   → rows (detects , ; or tab, handles quotes + BOM)
   • readFile(File)   → Promise<{ kind: 'xlsx'|'csv', sheets }>
   Runs in the admin (window.ColaAdmin.xlsx) and in Node (require) so the same
   code builds the downloadable template and is covered by the test suite.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.ColaAdmin) window.ColaAdmin.xlsx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  /* ------------------------------------------------------------- CRC32 */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* --------------------------------------------------------- zip write */
  /** files: [{ name, data: Uint8Array|string }] → Uint8Array (stored, no compression). */
  function zip(files) {
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of all) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  /* ---------------------------------------------------------- zip read */
  async function inflateRaw(bytes) {
    if (typeof process !== 'undefined' && process.versions && process.versions.node && typeof require === 'function') {
      return new Uint8Array(require('zlib').inflateRawSync(bytes));
    }
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files. Update the browser, or save the sheet as CSV and import that.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** → Map(name → () => Promise<Uint8Array>) */
  function unzip(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('This file is not a valid .xlsx (zip) file.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged .xlsx file (central directory).');
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const raw = u8.subarray(start, start + csize);
      files.set(name.replace(/^\/+/, ''), () => (method === 0 ? Promise.resolve(raw) : method === 8 ? inflateRaw(raw) : Promise.reject(new Error('Unsupported compression in .xlsx'))));
    }
    return files;
  }

  /* -------------------------------------------------------- XML helpers */
  const esc = (s) =>
    String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  function unesc(s) {
    return String(s)
      .replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) =>
        e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10))
      );
  }
  function attrs(s) {
    const o = {};
    const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(s))) o[m[1]] = unesc(m[3] !== undefined ? m[3] : m[4]);
    return o;
  }
  /** Concatenated text of all <t> elements (ignoring phonetic runs). */
  function textOf(xml) {
    const clean = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
    let out = '';
    const re = /<(?:\w+:)?t(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g;
    let m;
    while ((m = re.exec(clean))) out += m[1] ? unesc(m[1]) : '';
    return out;
  }

  /** "A" → 0, "AB" → 27 */
  function colIndex(letters) {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  function colName(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  /* --------------------------------------------------------- xlsx read */
  async function readXlsx(bytes) {
    const files = unzip(bytes);
    const get = async (name) => {
      const f = files.get(name);
      return f ? dec.decode(await f()) : null;
    };
    const wb = await get('xl/workbook.xml');
    if (!wb) throw new Error('This file is not an Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.');
    const relsXml = (await get('xl/_rels/workbook.xml.rels')) || '';
    const rels = {};
    relsXml.replace(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g, (m, a) => {
      const at = attrs(a);
      rels[at.Id] = at.Target;
      return m;
    });
    const sstXml = await get('xl/sharedStrings.xml');
    const sst = [];
    if (sstXml) sstXml.replace(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\s*\/>/g, (m, inner) => (sst.push(inner ? textOf(inner) : ''), m));

    const sheets = [];
    const sheetRe = /<(?:\w+:)?sheet\b([^>]*?)\/?>/g;
    let m;
    while ((m = sheetRe.exec(wb))) {
      const at = attrs(m[1]);
      const ridKey = Object.keys(at).find((k) => /(^|:)id$/.test(k) && k !== 'sheetId');
      const rid = ridKey ? at[ridKey] : '';
      let target = rels[rid] || '';
      if (!target) continue;
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const xml = await get(target);
      if (!xml) continue;
      sheets.push({ name: at.name || 'Sheet' + (sheets.length + 1), rows: parseSheet(xml, sst) });
    }
    return { sheets };
  }

  function parseSheet(xml, sst) {
    const rows = [];
    const dataMatch = /<(?:\w+:)?sheetData\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/.exec(xml);
    if (!dataMatch) return rows;
    const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
    let rm;
    let nextRow = 0;
    while ((rm = rowRe.exec(dataMatch[1]))) {
      const ra = attrs(rm[1]);
      const r = ra.r ? Number(ra.r) - 1 : nextRow;
      nextRow = r + 1;
      const row = [];
      const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
      let cm;
      let nextCol = 0;
      const body = rm[2] || '';
      while ((cm = cellRe.exec(body))) {
        const ca = attrs(cm[1]);
        const ref = /^([A-Z]+)\d+$/i.exec(ca.r || '');
        const c = ref ? colIndex(ref[1]) : nextCol;
        nextCol = c + 1;
        const inner = cm[2] || '';
        const vm = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
        const v = vm ? unesc(vm[1]) : null;
        let val = null;
        switch (ca.t) {
          case 's':
            val = v == null ? '' : sst[Number(v)] ?? '';
            break;
          case 'inlineStr':
            val = textOf(inner);
            break;
          case 'str':
          case 'd':
            val = v == null ? '' : v;
            break;
          case 'b':
            val = v === '1' || v === 'true';
            break;
          case 'e':
            val = null;
            break;
          default:
            val = v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : v;
        }
        if (val !== null && val !== '') row[c] = val;
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
      rows[r] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  /* --------------------------------------------------------------- CSV */
  function parseCsv(text) {
    let s = String(text || '');
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    // Excel's "sep=;" hint line
    let delim = null;
    const hint = /^sep=(.)\r?\n/i.exec(s);
    if (hint) {
      delim = hint[1];
      s = s.slice(hint[0].length);
    }
    if (!delim) {
      const counts = { ',': 0, ';': 0, '\t': 0 };
      let q = false;
      for (let i = 0; i < s.length && i < 20000; i++) {
        const ch = s[i];
        if (ch === '"') q = !q;
        else if (!q && (ch === '\n' || ch === '\r')) break;
        else if (!q && ch in counts) counts[ch]++;
      }
      delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      if (!counts[delim]) delim = ',';
    }
    const rows = [];
    let row = [];
    let field = '';
    let q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i++;
          } else q = false;
        } else field += ch;
        continue;
      }
      if (ch === '"' && field === '') q = true;
      else if (ch === delim) {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.map((r) => r.map((v) => (v === '' ? null : v)));
  }

  /* -------------------------------------------------------- xlsx write */
  // Styles (cellXfs index): keep in sync with STYLES_XML below.
  const S = { normal: 0, header: 1, headerReq: 2, wrap: 3, example: 4, title: 5, note: 6, bold: 7, text: 8, exampleText: 9, headerSoft: 10 };
  const STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="7">' +
    '<font><sz val="11"/><color rgb="FF130D0A"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFF3EEE6"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><i/><sz val="11"/><color rgb="FF8A7F76"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="18"/><color rgb="FF130D0A"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><sz val="10"/><color rgb="FF6B6159"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF130D0A"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF130D0A"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="6">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF130D0A"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFC07A42"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF3EEE6"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE9CDAE"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD9CFC2"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="11">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="49" fontId="2" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="6" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /**
   * book: { active: index, sheets: [{
   *   name, rows: [[cell]], cols: [{ width, style }], freeze: { rows, cols },
   *   heights: { rowIndex: pt }, merges: ['A1:D1'],
   *   validations: [{ range, list: [..] | source: "Lists!$A$2:$A$9", prompt, title, strict }] }] }
   * cell: string | number | boolean | null | { v, s: styleName }
   */
  function writeXlsx(book) {
    const sst = [];
    const sstIndex = new Map();
    const si = (str) => {
      let i = sstIndex.get(str);
      if (i === undefined) {
        i = sst.length;
        sst.push(str);
        sstIndex.set(str, i);
      }
      return i;
    };
    const active = Math.min(Math.max(0, book.active || 0), book.sheets.length - 1);

    const sheetXml = book.sheets.map((sh, idx) => {
      const rows = sh.rows || [];
      const maxCols = Math.max(1, (sh.cols || []).length, ...rows.map((r) => (r ? r.length : 0)));
      const fr = (sh.freeze && sh.freeze.rows) || 0;
      const fc = (sh.freeze && sh.freeze.cols) || 0;
      let pane = '';
      if (fr || fc) {
        const tl = colName(fc) + (fr + 1);
        const ap = fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight';
        pane =
          '<pane' + (fc ? ' xSplit="' + fc + '"' : '') + (fr ? ' ySplit="' + fr + '"' : '') + ' topLeftCell="' + tl + '" activePane="' + ap + '" state="frozen"/>' +
          (fr && fc ? '<selection pane="topRight"/><selection pane="bottomLeft"/>' : '') +
          '<selection pane="' + ap + '" activeCell="' + tl + '" sqref="' + tl + '"/>';
      }
      const views = '<sheetViews><sheetView workbookViewId="0"' + (idx === active ? ' tabSelected="1"' : '') + (sh.zoom ? ' zoomScale="' + sh.zoom + '"' : '') + (sh.gridLines === false ? ' showGridLines="0"' : '') + '>' + pane + '</sheetView></sheetViews>';
      const cols = (sh.cols || []).length
        ? '<cols>' + sh.cols.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 12) + '" customWidth="1"' + (c.style ? ' style="' + S[c.style] + '"' : '') + (c.hidden ? ' hidden="1"' : '') + '/>').join('') + '</cols>'
        : '';
      let data = '';
      rows.forEach((r, ri) => {
        if (!r || !r.length) return;
        const ht = sh.heights && sh.heights[ri];
        let cells = '';
        r.forEach((cell, ci) => {
          if (cell === null || cell === undefined || cell === '') return;
          const o = typeof cell === 'object' && !(cell instanceof Date) ? cell : { v: cell };
          if (o.v === null || o.v === undefined || o.v === '') {
            if (o.s) cells += '<c r="' + colName(ci) + (ri + 1) + '" s="' + S[o.s] + '"/>';
            return;
          }
          const ref = colName(ci) + (ri + 1);
          const s = o.s ? ' s="' + S[o.s] + '"' : (sh.cols && sh.cols[ci] && sh.cols[ci].style ? ' s="' + S[sh.cols[ci].style] + '"' : '');
          if (typeof o.v === 'number' && Number.isFinite(o.v)) cells += '<c r="' + ref + '"' + s + '><v>' + o.v + '</v></c>';
          else if (typeof o.v === 'boolean') cells += '<c r="' + ref + '"' + s + ' t="b"><v>' + (o.v ? 1 : 0) + '</v></c>';
          else cells += '<c r="' + ref + '"' + s + ' t="s"><v>' + si(String(o.v).replace(/\r\n?/g, '\n').slice(0, 32767)) + '</v></c>';
        });
        data += '<row r="' + (ri + 1) + '"' + (ht ? ' ht="' + ht + '" customHeight="1"' : '') + '>' + cells + '</row>';
      });
      const merges = (sh.merges || []).length ? '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map((m) => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>' : '';
      const vals = (sh.validations || []).filter((v) => v.range);
      const dv = vals.length
        ? '<dataValidations count="' + vals.length + '">' +
          vals
            .map((v) => {
              const list = v.list ? '"' + v.list.join(',').replace(/"/g, '""') + '"' : v.source || '';
              const prompt = v.prompt ? ' showInputMessage="1"' + (v.title ? ' promptTitle="' + esc(String(v.title).slice(0, 32)) + '"' : '') + ' prompt="' + esc(String(v.prompt).slice(0, 255)) + '"' : '';
              if (!list) return '<dataValidation allowBlank="1"' + prompt + ' sqref="' + v.range + '"/>';
              return (
                '<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="' + (v.strict ? 'stop' : 'warning') + '"' +
                ' errorTitle="' + esc(String(v.errorTitle || 'Check this value').slice(0, 32)) + '" error="' + esc(String(v.error || 'Pick a value from the list.').slice(0, 225)) + '"' +
                prompt + ' sqref="' + v.range + '"><formula1>' + esc(list) + '</formula1></dataValidation>'
              );
            })
            .join('') +
          '</dataValidations>'
        : '';
      const lastRow = Math.max(1, rows.length);
      return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        (sh.tab ? '<sheetPr><tabColor rgb="FF' + sh.tab.replace('#', '').toUpperCase() + '"/></sheetPr>' : '') +
        '<dimension ref="A1:' + colName(maxCols - 1) + lastRow + '"/>' +
        views +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        cols +
        '<sheetData>' + data + '</sheetData>' +
        merges +
        dv +
        '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
        '</worksheet>'
      );
    });

    const n = book.sheets.length;
    const files = [
      {
        name: '[Content_Types].xml',
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          book.sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
          '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
          '</Types>',
      },
      {
        name: '_rels/.rels',
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
          '</Relationships>',
      },
      {
        name: 'docProps/core.xml',
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          '<dc:title>' + esc(book.title || 'Cola Studio') + '</dc:title><dc:creator>Cola Studio admin</dc:creator>' +
          '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:created></cp:coreProperties>',
      },
      {
        name: 'docProps/app.xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Cola Studio</Application></Properties>',
      },
      {
        name: 'xl/workbook.xml',
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<bookViews><workbookView activeTab="' + active + '"/></bookViews><sheets>' +
          book.sheets.map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '"' + (s.hidden ? ' state="hidden"' : '') + ' r:id="rId' + (i + 1) + '"/>').join('') +
          '</sheets></workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          book.sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
          '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '<Relationship Id="rId' + (n + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
          '</Relationships>',
      },
      { name: 'xl/styles.xml', data: STYLES_XML },
    ];
    sheetXml.forEach((x, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: x }));
    files.push({
      name: 'xl/sharedStrings.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + sst.length + '" uniqueCount="' + sst.length + '">' +
        sst.map((s) => '<si><t xml:space="preserve">' + esc(s) + '</t></si>').join('') +
        '</sst>',
    });
    return zip(files);
  }

  /* ------------------------------------------------------------ files */
  /** Browser File/Blob → { kind, sheets }. CSV becomes one sheet named after the file. */
  async function readFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const name = String(file.name || '');
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      if (/\.(ods|numbers)$/i.test(name)) throw new Error('Save the sheet as Excel (.xlsx) or CSV first — ' + name.split('.').pop().toUpperCase() + ' files cannot be read.');
      return Object.assign({ kind: 'xlsx' }, await readXlsx(buf));
    }
    if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new Error('This is an old Excel file (.xls). Open it and save it as .xlsx, then import again.');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      text = new TextDecoder('windows-1252').decode(buf);
    }
    return { kind: 'csv', sheets: [{ name: name.replace(/\.[^.]+$/, '') || 'Products', rows: parseCsv(text) }] };
  }

  return { writeXlsx, readXlsx, parseCsv, readFile, zip, unzip, crc32, colName, colIndex, STYLE: S };
});
