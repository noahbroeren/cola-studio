'use strict';
/**
 * Translation of Weibo posts (Chinese → English) with pluggable providers:
 *
 *   anthropic  Claude Messages API — translation + title + category + related products in one call
 *   deepl      DeepL API (free keys end with ":fx")
 *   google     Google Cloud Translation v2 (API key)
 *   libre      LibreTranslate (self-hosted or public instance)
 *   none       keep the original text
 *
 * Fallback: if the configured provider fails, the original Chinese text is
 * kept, translation.provider becomes "none" and the post is held as
 * "pending" so the owner can fix it in the admin panel.
 */

const CATEGORIES = ['production', 'drop', 'restock', 'studio', 'notice'];
const CATEGORY_LABELS = {
  production: 'Production update',
  drop: 'New drop',
  restock: 'Restock',
  studio: 'Studio update',
  notice: 'Studio notice',
};
const PROVIDERS = ['anthropic', 'deepl', 'google', 'libre', 'none'];
const DEFAULT_MODEL = 'claude-sonnet-5-5';

/* ------------------------------------------------------------------------ */
/* Text helpers                                                               */
/* ------------------------------------------------------------------------ */

// Port of strip_emoji() from the Weibo→Discord bot, plus ZWJ, keycaps and tag characters.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B50}\u{2705}\u{274C}\u{203C}\u{2049}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]+/gu;

function stripEmoji(text) {
  return String(text || '')
    .replace(EMOJI_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

const HAS_CJK = /[㐀-鿿豈-﫿]/;

/** "中文=English" lines → [{from,to}], longest first. Supports "=", "＝" and "=>". */
function parseGlossary(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const m = /^(.+?)\s*(?:=>|=|＝)\s*(.+)$/.exec(l);
    if (!m) continue;
    const from = m[1].trim();
    const to = m[2].trim();
    if (from && to) out.push({ from, to });
  }
  return out.sort((a, b) => b.from.length - a.from.length);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace glossary terms. Chinese terms are replaced anywhere; Latin terms only
 * as whole words (case-sensitive), so "Hoodie=Hooded Sweatshirt" does not touch "Hoodies".
 * Before translation only CJK entries are applied (cjkOnly).
 */
function applyGlossary(text, entries, { cjkOnly = false } = {}) {
  let out = String(text || '');
  for (const { from, to } of entries) {
    if (HAS_CJK.test(from)) out = out.split(from).join(to);
    else if (!cjkOnly) out = out.replace(new RegExp(`(?<![\\w-])${escapeRe(from)}(?![\\w-])`, 'g'), to);
  }
  return out;
}

/** Remove @mentions, Weibo #hashtags# and "read more" artifacts (for non-LLM providers). */
function stripSocial(text) {
  return String(text || '')
    .replace(/@[\w㐀-鿿\-·]{1,30}/g, '')
    .replace(/#[^#\n]{1,40}#/g, '')
    .replace(/(\.\.\.|…)?\s*(全文|查看更多|展开全文|收起全文)\s*$/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const KEYWORDS = {
  restock: ['补货', '返场', '补单', '再到货', '回归', '加单', 'restock', 'back in stock', 'restocked'],
  drop: ['上新', '新品', '预售', '发售', '开售', '上架', '首发', '新款', 'new drop', 'release', 'pre-order', 'preorder', 'launch', 'drop'],
  notice: ['通知', '放假', '休息', '停发', '暂停', '公告', '假期', '延迟', '延期', '春节', '国庆', 'notice', 'holiday', 'announcement', 'closed', 'delay'],
  production: ['打样', '样衣', '生产', '工厂', '面料', '大货', '制作', '进度', '裁剪', '车间', '做工', '工艺', '版型', '印花', '刺绣', '水洗', 'sample', 'sampling', 'production', 'fabric', 'factory', 'pattern', 'stitch'],
};

/** Keyword-based category (used by non-LLM providers and as a fallback). */
function categorize(...texts) {
  const hay = texts.filter(Boolean).join('\n').toLowerCase();
  let best = 'studio';
  let bestScore = 0;
  for (const cat of ['restock', 'drop', 'notice', 'production']) {
    const score = KEYWORDS[cat].reduce((n, k) => n + (hay.includes(k.toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }
  return best;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Title heuristic for MT providers: "<Category label> | <first sentence>". */
function heuristicTitle(category, english) {
  const label = CATEGORY_LABELS[category] || CATEGORY_LABELS.studio;
  const first = String(english || '')
    .split(/\n+|(?<=[.!?。！？])\s+/)[0]
    ?.replace(/[.!?。！？:：;；,，\s]+$/, '')
    .trim();
  if (!first || HAS_CJK.test(first)) return label;
  let subject = first;
  if (subject.length > 60) {
    subject = subject.slice(0, 60);
    const sp = subject.lastIndexOf(' ');
    if (sp > 30) subject = subject.slice(0, sp);
    subject = subject.replace(/[\s,.;:–-]+$/, '') + '…';
  }
  return `${label} | ${capitalize(subject)}`;
}

/** Make sure a model title follows "Type | Subject" and contains no emoji. */
function normalizeTitle(title, category) {
  let t = stripEmoji(String(title || ''))
    .replace(/^["'“”*#\s]+|["'“”*\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return CATEGORY_LABELS[category] || CATEGORY_LABELS.studio;
  if (!t.includes('|')) t = `${CATEGORY_LABELS[category] || CATEGORY_LABELS.studio} | ${t}`;
  t = t.replace(/\s*\|\s*/, ' | ');
  return t.length > 120 ? t.slice(0, 119).trimEnd() + '…' : t;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/* ------------------------------------------------------------------------ */
/* LLM response parsing                                                       */
/* ------------------------------------------------------------------------ */

function stripFences(raw) {
  const s = String(raw || '').trim();
  const fenced = /```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```/.exec(s);
  if (fenced) return fenced[1].trim();
  return s.replace(/^```(?:\w+)?\s*|\s*```$/g, '').trim();
}

/** Escape raw control characters that appear inside JSON strings (a common LLM slip). */
function repairJson(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      else if (ch === '\n') {
        out += '\\n';
        continue;
      } else if (ch === '\r') continue;
      else if (ch === '\t') {
        out += '\\t';
        continue;
      }
    } else if (ch === '"') inStr = true;
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1'); // trailing commas
}

function tryJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(repairJson(s));
    } catch {
      return undefined;
    }
  }
}

/**
 * Parse the model output into { title, category, translation, relatedProductIds }.
 * Order: strict JSON → JSON inside fences/prose → bot-style "TITLE: … ---TRANSLATION---" → null.
 */
function parseLlmResponse(raw) {
  const text = stripFences(raw);
  let obj = tryJson(text);
  if (!obj || typeof obj !== 'object') {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) obj = tryJson(text.slice(a, b + 1));
  }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const translation = typeof obj.translation === 'string' ? obj.translation : typeof obj.text === 'string' ? obj.text : '';
    return {
      title: typeof obj.title === 'string' ? obj.title : '',
      category: CATEGORIES.includes(String(obj.category || '').toLowerCase()) ? String(obj.category).toLowerCase() : '',
      translation: translation.trim(),
      relatedProductIds: Array.isArray(obj.relatedProductIds) ? obj.relatedProductIds.map(String) : [],
    };
  }
  // Fallback like the Discord bot's parse_response().
  const m = /TITLE:\s*(.+?)\s*\n\s*-{2,}\s*TRANSLATION\s*-{2,}\s*\n([\s\S]+)/i.exec(text);
  if (m) return { title: m[1].trim(), category: '', translation: m[2].trim(), relatedProductIds: [] };
  const t = /TITLE:\s*(.+)/i.exec(text);
  if (t) {
    const rest = text
      .slice(t.index + t[0].length)
      .replace(/^\s*-{2,}\s*TRANSLATION\s*-{2,}\s*/i, '')
      .trim();
    if (rest) return { title: t[1].trim(), category: '', translation: rest, relatedProductIds: [] };
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Prompt                                                                     */
/* ------------------------------------------------------------------------ */

function buildSystemPrompt({ products = [], glossary = [] } = {}) {
  const catalogue = products.length
    ? JSON.stringify(products.map((p) => ({ id: p.id, name: p.name, subtitle: p.subtitle || '' })))
    : '[]';
  const glossaryText = glossary.length ? glossary.map((g) => `- ${g.from} = ${g.to}`).join('\n') : '(none)';
  return `You translate Weibo posts for Cola Studio, an international fashion studio focused on design, production and craftsmanship. The posts are studio updates: sampling and production progress, fabrics, drops, restocks and notices.

You receive the original Chinese text of one Weibo post. Produce:

1. translation — natural, polished English in the studio's calm, premium voice. Fix awkward phrasing so it reads fluently, but stay faithful to the original: never invent details, numbers, dates, prices or promises that are not in the post. Keep paragraph breaks. Remove ALL emoji (the output must contain no emoji at all), all @mentions of other accounts, hashtag spam, and "read more" / "全文" / "查看更多" artifacts.

2. title — short, in the format "<Update type> | <Subject>", for example "Production update | Heavyweight Hoodie", "Sampling update | Wool Overshirt", "Restock | Construction Work Jacket", "New drop | Vol. 03", "Studio notice | Holiday Schedule". Use Title Case after the bar. The subject must be a Cola Studio catalogue product name from the list below when the post clearly matches one; otherwise use a generic product type (e.g. "Heavyweight Hoodie", "Denim Trousers") or the topic of the notice. Never name, guess or infer third-party brands, and never deduce brands from photos, logos or construction details — titles describe Cola Studio's own work only.

3. category — exactly one of:
   production (sampling, fabrics, factory and making-of progress),
   drop (new release, launch, pre-order),
   restock (items back in stock),
   studio (behind the scenes, general studio news),
   notice (holidays, shipping pauses, delays, announcements).

4. relatedProductIds — ids from the catalogue below that the post clearly refers to. Use an empty array when unsure. Never invent ids.

Glossary — always use these English terms:
${glossaryText}

Cola Studio catalogue (id, name, subtitle):
${catalogue}

Respond with STRICT JSON only — no markdown fences, no commentary — exactly this shape:
{"title": "...", "category": "production|drop|restock|studio|notice", "translation": "...", "relatedProductIds": []}`;
}

/* ------------------------------------------------------------------------ */
/* Providers                                                                  */
/* ------------------------------------------------------------------------ */

async function httpJson(fetchFn, url, init, label) {
  const res = await fetchFn(url, { ...init, signal: init.signal || AbortSignal.timeout(90000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

async function callAnthropic(fetchFn, text, { key, model, products, glossary, log }) {
  if (!key) throw new Error('Anthropic API key is not configured (ANTHROPIC_API_KEY)');
  const payload = await httpJson(
    fetchFn,
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 4000,
        system: buildSystemPrompt({ products, glossary }),
        messages: [{ role: 'user', content: `Original Chinese Weibo post:\n---\n${text}\n---` }],
      }),
    },
    'Anthropic'
  );
  if (payload.stop_reason === 'max_tokens' && log) log.warn('Anthropic response hit max_tokens — translation may be incomplete');
  const raw = (payload.content || [])
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const parsed = parseLlmResponse(raw);
  if (!parsed || !parsed.translation) throw new Error(`Could not parse model response: ${raw.slice(0, 200)}`);
  return { ...parsed, model: payload.model || model || DEFAULT_MODEL };
}

async function callDeepl(fetchFn, text, { key }) {
  if (!key) throw new Error('DeepL API key is not configured (DEEPL_API_KEY)');
  const host = key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const json = await httpJson(
    fetchFn,
    `${host}/v2/translate`,
    {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${key.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: [text], source_lang: 'ZH', target_lang: 'EN-GB', preserve_formatting: true }),
    },
    'DeepL'
  );
  const out = json?.translations?.[0]?.text;
  if (typeof out !== 'string') throw new Error('DeepL response had no translation');
  return out;
}

async function callGoogle(fetchFn, text, { key }) {
  if (!key) throw new Error('Google Translate API key is not configured (GOOGLE_TRANSLATE_API_KEY)');
  const json = await httpJson(
    fetchFn,
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'zh-CN', target: 'en', format: 'text' }),
    },
    'Google'
  );
  const out = json?.data?.translations?.[0]?.translatedText;
  if (typeof out !== 'string') throw new Error('Google response had no translation');
  return decodeEntities(out);
}

async function callLibre(fetchFn, text, { url, key }) {
  if (!url) throw new Error('LibreTranslate URL is not configured (LIBRETRANSLATE_URL)');
  const body = { q: text, source: 'auto', target: 'en', format: 'text' };
  if (key) body.api_key = key;
  const json = await httpJson(
    fetchFn,
    `${url.replace(/\/+$/, '')}/translate`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    'LibreTranslate'
  );
  if (typeof json?.translatedText !== 'string') throw new Error(json?.error || 'LibreTranslate response had no translation');
  return json.translatedText;
}

/** Catalogue products whose English name appears in the translated text. */
function matchProductsByName(text, products) {
  const hay = String(text || '').toLowerCase();
  return products.filter((p) => p.name && p.name.length >= 4 && hay.includes(p.name.toLowerCase())).map((p) => p.id);
}

/* ------------------------------------------------------------------------ */
/* Translator                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * @param {object} o
 * @param {() => object} o.getConfig  returns the effective `translation` config
 * @param {Function} o.fetch
 */
function createTranslator({ getConfig, fetch: fetchFn = globalThis.fetch, log }) {
  const logger = log || { info() {}, warn() {}, error() {} };

  /**
   * Translate one post.
   * → { ok, provider, model, title, category, translation, relatedProductIds, error? }
   */
  async function translatePost(text, { products = [] } = {}) {
    const cfg = getConfig() || {};
    const provider = PROVIDERS.includes(cfg.provider) ? cfg.provider : 'anthropic';
    const glossary = parseGlossary(cfg.glossary);
    const original = String(text || '').trim();
    const catalogue = products.map((p) => ({ id: p.id, name: p.name, subtitle: p.subtitle || '' }));
    const ids = new Set(catalogue.map((p) => p.id));

    // Image-only posts: nothing to translate.
    if (!original) {
      return { ok: true, provider: 'none', model: null, title: CATEGORY_LABELS.studio, category: 'studio', translation: '', relatedProductIds: [] };
    }

    try {
      if (provider === 'none') throw Object.assign(new Error('Translation provider is set to "none"'), { quiet: true });

      if (provider === 'anthropic') {
        const r = await callAnthropic(fetchFn, original, {
          key: cfg.anthropicKey,
          model: cfg.model || DEFAULT_MODEL,
          products: catalogue,
          glossary,
          log: logger,
        });
        const category = r.category || categorize(original, r.translation);
        const translation = stripEmoji(applyGlossary(r.translation, glossary));
        return {
          ok: true,
          provider,
          model: r.model,
          title: normalizeTitle(applyGlossary(r.title, glossary), category),
          category,
          translation,
          relatedProductIds: [...new Set(r.relatedProductIds.filter((id) => ids.has(id)))],
        };
      }

      // Machine-translation providers.
      const source = applyGlossary(stripEmoji(stripSocial(original)), glossary, { cjkOnly: true });
      let translated;
      if (provider === 'deepl') translated = await callDeepl(fetchFn, source, { key: cfg.deeplKey });
      else if (provider === 'google') translated = await callGoogle(fetchFn, source, { key: cfg.googleKey });
      else translated = await callLibre(fetchFn, source, { url: cfg.libreUrl, key: cfg.libreKey });
      const translation = stripEmoji(applyGlossary(decodeEntities(translated), glossary)).replace(/\n{3,}/g, '\n\n');
      const category = categorize(original, translation);
      return {
        ok: true,
        provider,
        model: null,
        title: heuristicTitle(category, translation),
        category,
        translation,
        relatedProductIds: matchProductsByName(translation, catalogue),
      };
    } catch (err) {
      if (!err.quiet) logger.warn(`translation via ${provider} failed: ${err.message}`);
      const category = categorize(original);
      return {
        ok: false,
        provider: 'none',
        model: null,
        title: CATEGORY_LABELS[category],
        category,
        translation: stripEmoji(original),
        relatedProductIds: [],
        error: err.message,
      };
    }
  }

  /**
   * Translate short Chinese strings (product titles, colour names) in one call.
   * → array of the same length, or null when no translation provider is set up.
   * Throws when the provider fails (callers keep the originals).
   */
  async function translateLines(lines, { kind = 'fashion product titles', prose = false } = {}) {
    const cfg = getConfig() || {};
    const provider = PROVIDERS.includes(cfg.provider) ? cfg.provider : 'anthropic';
    const list = (lines || []).map((x) => String(x == null ? '' : x).trim());
    if (!list.length) return [];
    const ready = { anthropic: cfg.anthropicKey, deepl: cfg.deeplKey, google: cfg.googleKey, libre: cfg.libreUrl, none: '' }[provider];
    if (!ready) return null;
    const glossary = parseGlossary(cfg.glossary);
    const src = list.map((x) => applyGlossary(stripEmoji(x), glossary, { cjkOnly: true }));
    let out;
    if (provider === 'anthropic') {
      const payload = await httpJson(
        fetchFn,
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: { 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: cfg.model || DEFAULT_MODEL,
            max_tokens: prose ? 4000 : 2000,
            system: prose
              ? `You translate Chinese ${kind} from a Weidian shop into clear, natural British English for an international fashion studio's website. ` +
                'Keep measurements, fabric weights and model codes exactly, drop shop slogans, emoji, marketing filler and decorative brackets such as 【】. ' +
                `Reply with only a JSON array of exactly ${src.length} strings, in the same order as the input (an empty string for lines that only contained filler).`
              : `You translate Chinese ${kind} from a Weidian shop into concise, natural English for an international fashion studio's website. ` +
                'Keep brand names and model codes, drop shop slogans, emoji and decorative brackets such as 【】, use Title Case for product titles and plain names for colours (e.g. "Black", "Clay"). ' +
                `Reply with only a JSON array of exactly ${src.length} strings, in the same order as the input.`,
            messages: [{ role: 'user', content: JSON.stringify(src) }],
          }),
        },
        'Anthropic'
      );
      const raw = (payload.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
      const m = /\[[\s\S]*\]/.exec(stripFences(raw));
      out = m ? tryJson(m[0]) : null;
    } else if (provider === 'deepl') {
      const key = cfg.deeplKey.trim();
      const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
      const json = await httpJson(fetchFn, `${host}/v2/translate`, { method: 'POST', headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: src, source_lang: 'ZH', target_lang: 'EN-GB' }) }, 'DeepL');
      out = (json.translations || []).map((t) => t.text);
    } else if (provider === 'google') {
      const json = await httpJson(fetchFn, `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(cfg.googleKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: src, source: 'zh-CN', target: 'en', format: 'text' }) }, 'Google');
      out = ((json.data && json.data.translations) || []).map((t) => t.translatedText);
    } else {
      const body = { q: src, source: 'auto', target: 'en', format: 'text' };
      if (cfg.libreKey) body.api_key = cfg.libreKey;
      const json = await httpJson(fetchFn, `${cfg.libreUrl.replace(/\/+$/, '')}/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 'LibreTranslate');
      out = Array.isArray(json.translatedText) ? json.translatedText : [json.translatedText];
    }
    if (!Array.isArray(out) || out.length !== src.length) throw new Error(`${provider}: unexpected translation response`);
    return out.map((t, i) => {
      const v = stripEmoji(applyGlossary(decodeEntities(String(t == null ? '' : t)), glossary)).replace(/\s+/g, ' ').trim();
      return prose ? v : v || list[i];
    });
  }

  /** { key, model } when an Anthropic key is saved — used for Claude-only extras (size charts, web fetch). */
  function claudeConfig() {
    const cfg = getConfig() || {};
    return cfg.anthropicKey ? { key: cfg.anthropicKey, model: cfg.model || DEFAULT_MODEL } : null;
  }

  /**
   * Find the size chart among product photos and read it (Claude vision).
   * images: [{ data (base64), mediaType }]. → { index, unit, columns, rows:[{size, values}] } or null.
   */
  async function readSizeChart(images, { title = '', sizes = [] } = {}) {
    const c = claudeConfig();
    if (!c || !images || !images.length) return null;
    const content = [];
    images.forEach((im, i) => {
      content.push({ type: 'text', text: `Image ${i}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: im.mediaType || 'image/jpeg', data: im.data } });
    });
    content.push({
      type: 'text',
      text:
        `These are photos from a Weidian listing${title ? ` for "${title}"` : ''}${sizes.length ? ` (sizes on sale: ${sizes.join(', ')})` : ''}. ` +
        'Find the image that shows the size chart / measurement table (尺码表, 尺寸表). If there is one, transcribe it. ' +
        'Reply with only JSON: {"index": <number of the image or null>, "unit": "cm" or "in", "columns": [...], "rows": [{"size": "M", "values": [...]}]}. ' +
        'Columns are short English measurement names in the order of the chart, e.g. 衣长 → "Length", 胸围 → "Chest", 肩宽 → "Shoulder", 袖长 → "Sleeve", 腰围 → "Waist", 臀围 → "Hip", 裤长 → "Length", 大腿围 → "Thigh", 脚口 → "Leg opening", 前裆 → "Front rise", 下摆 → "Hem". ' +
        'Leave out columns that are not garment measurements (height, weight, recommended body size). Write sizes like XS, S, M, L, XL, XXL, XXXL (2XL → XXL, 3XL → XXXL) or as printed when they are numbers. ' +
        'Values are numbers as strings without units, one per column (use "" when a cell is empty). If no image shows a size chart, reply {"index": null}.',
    });
    const payload = await httpJson(
      fetchFn,
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: c.model, max_tokens: 1500, messages: [{ role: 'user', content }] }),
        signal: AbortSignal.timeout(120000),
      },
      'Anthropic'
    );
    const raw = (payload.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
    const m = /\{[\s\S]*\}/.exec(stripFences(raw));
    const j = m ? tryJson(m[0]) : null;
    if (!j || j.index === null || j.index === undefined || !Number.isInteger(Number(j.index))) return null;
    const index = Number(j.index);
    if (index < 0 || index >= images.length) return null;
    const columns = (Array.isArray(j.columns) ? j.columns : []).map((x) => String(x || '').trim().slice(0, 40)).filter(Boolean).slice(0, 10);
    const rows = (Array.isArray(j.rows) ? j.rows : [])
      .filter((r) => r && r.size != null && Array.isArray(r.values))
      .map((r) => ({ size: String(r.size).trim().slice(0, 20), values: columns.map((_, i) => String(r.values[i] == null ? '' : r.values[i]).trim().slice(0, 12)) }))
      .slice(0, 20);
    return { index, unit: j.unit === 'in' ? 'in' : 'cm', columns, rows };
  }

  /** True when the selected provider has what it needs (key / URL). */
  function configured() {
    const cfg = getConfig() || {};
    const provider = PROVIDERS.includes(cfg.provider) ? cfg.provider : 'anthropic';
    return !!{ anthropic: cfg.anthropicKey, deepl: cfg.deeplKey, google: cfg.googleKey, libre: cfg.libreUrl, none: '' }[provider];
  }

  return { translatePost, translateLines, configured, claudeConfig, readSizeChart };
}

module.exports = {
  createTranslator,
  parseLlmResponse,
  stripFences,
  repairJson,
  stripEmoji,
  stripSocial,
  parseGlossary,
  applyGlossary,
  categorize,
  heuristicTitle,
  normalizeTitle,
  buildSystemPrompt,
  decodeEntities,
  CATEGORIES,
  CATEGORY_LABELS,
  PROVIDERS,
  DEFAULT_MODEL,
};
