'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTranslator,
  parseLlmResponse,
  stripEmoji,
  stripSocial,
  parseGlossary,
  applyGlossary,
  categorize,
  heuristicTitle,
  normalizeTitle,
  buildSystemPrompt,
} = require('../server/services/translate');
const { fakeFetch, silentLog } = require('./helpers');

const PRODUCTS = [
  { id: 'cs-001', name: 'Construction Work Jacket', subtitle: '12 oz waxed canvas' },
  { id: 'cs-002', name: 'Heavyweight Hoodie', subtitle: '480 g loopback' },
];

test('parseLlmResponse: strict JSON', () => {
  const r = parseLlmResponse('{"title":"Production update | Heavyweight Hoodie","category":"production","translation":"Done.","relatedProductIds":["cs-002"]}');
  assert.deepEqual(r, { title: 'Production update | Heavyweight Hoodie', category: 'production', translation: 'Done.', relatedProductIds: ['cs-002'] });
});

test('parseLlmResponse: fenced JSON, JSON in prose, raw newlines inside strings, trailing commas', () => {
  const fenced = '```json\n{"title":"Restock | Jacket","category":"RESTOCK","translation":"Back.","relatedProductIds":[]}\n```';
  assert.equal(parseLlmResponse(fenced).category, 'restock');
  const prose = 'Here you go:\n{"title":"A | B","category":"drop","translation":"Line 1\nLine 2","relatedProductIds":["cs-001",],}\nHope this helps';
  const r = parseLlmResponse(prose);
  assert.equal(r.translation, 'Line 1\nLine 2');
  assert.deepEqual(r.relatedProductIds, ['cs-001']);
  // Unknown category → empty (caller derives it from keywords)
  assert.equal(parseLlmResponse('{"title":"x","category":"merch","translation":"y"}').category, '');
});

test('parseLlmResponse: bot-style TITLE/---TRANSLATION--- fallback and garbage', () => {
  const r = parseLlmResponse('TITLE: SAMPLING UPDATE | HOODIE\n---TRANSLATION---\nThe second round is done.\n\nMore.');
  assert.equal(r.title, 'SAMPLING UPDATE | HOODIE');
  assert.equal(r.translation, 'The second round is done.\n\nMore.');
  const r2 = parseLlmResponse('TITLE: Notice\nThe studio is closed.');
  assert.equal(r2.translation, 'The studio is closed.');
  assert.equal(parseLlmResponse('I cannot help with that.'), null);
  assert.equal(parseLlmResponse(''), null);
});

test('stripEmoji (port of strip_emoji) keeps CJK and punctuation', () => {
  assert.equal(stripEmoji('New drop 🔥🔥 tonight ✨ — 8 pm ✅ 黑色 👍🏽 ok ❤️'), 'New drop tonight — 8 pm 黑色 ok');
  assert.equal(stripEmoji('Line 1 🧵 \nLine 2'), 'Line 1\nLine 2');
  assert.equal(stripEmoji('👨‍👩‍👧 family'), 'family');
});

test('stripSocial removes mentions, hashtags and read-more artifacts', () => {
  assert.equal(stripSocial('面料到了 @面料小王 #ColaStudio# 很好...全文'), '面料到了 很好');
});

test('glossary: parse, apply before (CJK only) and after (whole words)', () => {
  const g = parseGlossary('# comment\n重磅卫衣=Heavyweight Hoodie\n毛圈 = loopback cotton\nhoodie=> hooded sweatshirt\nbroken line\n大货＝bulk production');
  assert.equal(g.length, 4);
  assert.deepEqual(g.map((x) => x.from.length), [...g.map((x) => x.from.length)].sort((a, b) => b - a)); // longest first
  assert.equal(applyGlossary('重磅卫衣用毛圈, hoodie', g, { cjkOnly: true }), 'Heavyweight Hoodie用loopback cotton, hoodie');
  assert.equal(applyGlossary('The hoodie and hoodies; 大货 soon', g), 'The hooded sweatshirt and hoodies; bulk production soon');
});

test('categorize via keyword rules', () => {
  assert.equal(categorize('工装夹克今晚八点补货'), 'restock');
  assert.equal(categorize('新品预售下周开始'), 'drop');
  assert.equal(categorize('第二轮打样，面料来自工厂'), 'production');
  assert.equal(categorize('国庆放假通知'), 'notice');
  assert.equal(categorize('今天的工作室'), 'studio');
});

test('heuristicTitle / normalizeTitle', () => {
  assert.equal(heuristicTitle('production', 'the second sample round is finished. Next week bulk.'), 'Production update | The second sample round is finished');
  assert.equal(heuristicTitle('notice', ''), 'Studio notice');
  assert.equal(heuristicTitle('drop', '新品'), 'New drop');
  const long = heuristicTitle('studio', 'a'.repeat(30) + ' ' + 'b'.repeat(40));
  assert.ok(long.startsWith('Studio update | Aaaa') && long.endsWith('…') && long.length <= 'Studio update | '.length + 61, long);
  assert.equal(normalizeTitle('Heavyweight Hoodie 🔥', 'production'), 'Production update | Heavyweight Hoodie');
  assert.equal(normalizeTitle('"Restock|Jacket"', 'restock'), 'Restock | Jacket');
});

test('system prompt: studio voice, catalogue, glossary — and no brand inference', () => {
  const p = buildSystemPrompt({ products: PRODUCTS, glossary: parseGlossary('重磅=Heavyweight') });
  assert.match(p, /international fashion studio focused on design, production and craftsmanship/);
  assert.match(p, /STRICT JSON/);
  assert.match(p, /"cs-002","name":"Heavyweight Hoodie"/);
  assert.match(p, /重磅 = Heavyweight/);
  assert.match(p, /Never name, guess or infer third-party brands/);
  assert.doesNotMatch(p, /reproduc|well-known fashion brands|BRAND \+ PRODUCT/i);
});

test('anthropic provider: request shape, emoji stripped, ids filtered, glossary after-pass', async () => {
  const fetch = fakeFetch([
    [
      'https://api.anthropic.com/v1/messages',
      (url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(init.method, 'POST');
        assert.equal(init.headers['x-api-key'], 'sk-ant-test');
        assert.equal(init.headers['anthropic-version'], '2023-06-01');
        assert.equal(body.model, 'claude-custom');
        assert.match(body.messages[0].content, /重磅卫衣/);
        return {
          model: 'claude-custom',
          content: [
            { type: 'text', text: '```json\n{"title":"production update | heavyweight hoodie","category":"production","translation":"The 重磅卫衣 samples are in 🎉","relatedProductIds":["cs-002","nope"]}\n```' },
          ],
        };
      },
    ],
  ]);
  const t = createTranslator({
    getConfig: () => ({ provider: 'anthropic', anthropicKey: 'sk-ant-test', model: 'claude-custom', glossary: '重磅卫衣=Heavyweight Hoodie' }),
    fetch,
    log: silentLog(),
  });
  const r = await t.translatePost('重磅卫衣样衣到了🎉', { products: PRODUCTS });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.model, 'claude-custom');
  assert.equal(r.translation, 'The Heavyweight Hoodie samples are in');
  assert.equal(r.title, 'production update | heavyweight hoodie');
  assert.deepEqual(r.relatedProductIds, ['cs-002']);
});

test('deepl provider: free host for ":fx" keys, ZH → EN-GB, heuristic title + category + name match', async () => {
  const fetch = fakeFetch([
    [
      'https://api-free.deepl.com/v2/translate',
      (url, init) => {
        assert.equal(init.headers.Authorization, 'DeepL-Auth-Key abc:fx');
        const body = JSON.parse(init.body);
        assert.equal(body.source_lang, 'ZH');
        assert.equal(body.target_lang, 'EN-GB');
        assert.deepEqual(body.text, ['Construction Work Jacket今晚补货 。']);
        return { translations: [{ detected_source_language: 'ZH', text: 'Construction Work Jacket restock tonight. Sizes M and L. 😀' }] };
      },
    ],
  ]);
  const t = createTranslator({ getConfig: () => ({ provider: 'deepl', deeplKey: 'abc:fx', glossary: '工装夹克=Construction Work Jacket' }), fetch, log: silentLog() });
  const r = await t.translatePost('工装夹克今晚补货 @某人 。', { products: PRODUCTS });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'deepl');
  assert.equal(r.category, 'restock');
  assert.equal(r.title, 'Restock | Construction Work Jacket restock tonight');
  assert.equal(r.translation, 'Construction Work Jacket restock tonight. Sizes M and L.');
  assert.deepEqual(r.relatedProductIds, ['cs-001']);

  const pro = fakeFetch([['https://api.deepl.com/v2/translate', () => ({ translations: [{ text: 'ok' }] })]]);
  const t2 = createTranslator({ getConfig: () => ({ provider: 'deepl', deeplKey: 'pro-key' }), fetch: pro, log: silentLog() });
  assert.equal((await t2.translatePost('好')).translation, 'ok');
});

test('google + libre providers', async () => {
  const fetch = fakeFetch([
    ['translation.googleapis.com/language/translate/v2?key=gk', () => ({ data: { translations: [{ translatedText: 'It&#39;s done &amp; ready' }] } })],
    ['https://libre.example/translate', (u, init) => (JSON.parse(init.body).api_key === 'lk' ? { translatedText: 'Libre ok' } : { error: 'bad key' })],
  ]);
  const g = createTranslator({ getConfig: () => ({ provider: 'google', googleKey: 'gk' }), fetch, log: silentLog() });
  assert.equal((await g.translatePost('完成了')).translation, "It's done & ready");
  const l = createTranslator({ getConfig: () => ({ provider: 'libre', libreUrl: 'https://libre.example/', libreKey: 'lk' }), fetch, log: silentLog() });
  assert.equal((await l.translatePost('好')).translation, 'Libre ok');
});

test('fallback: failing provider / missing key / "none" keep the Chinese text and mark provider none', async () => {
  const fetch = fakeFetch([['api.anthropic.com', () => new Response('overloaded', { status: 529 })]]);
  const t = createTranslator({ getConfig: () => ({ provider: 'anthropic', anthropicKey: 'k' }), fetch, log: silentLog() });
  const r = await t.translatePost('国庆放假通知 🎉');
  assert.equal(r.ok, false);
  assert.equal(r.provider, 'none');
  assert.equal(r.translation, '国庆放假通知');
  assert.equal(r.category, 'notice');
  assert.equal(r.title, 'Studio notice');
  assert.match(r.error, /529/);

  const noKey = createTranslator({ getConfig: () => ({ provider: 'deepl' }), fetch, log: silentLog() });
  const r2 = await noKey.translatePost('你好');
  assert.equal(r2.ok, false);
  assert.match(r2.error, /DeepL API key is not configured/);

  const none = createTranslator({ getConfig: () => ({ provider: 'none' }), fetch, log: silentLog() });
  assert.equal((await none.translatePost('你好')).ok, false);

  // Unparseable model output → fallback too
  const junk = fakeFetch([['api.anthropic.com', () => ({ content: [{ type: 'text', text: 'Sorry!' }] })]]);
  const t3 = createTranslator({ getConfig: () => ({ provider: 'anthropic', anthropicKey: 'k' }), fetch: junk, log: silentLog() });
  const r3 = await t3.translatePost('你好');
  assert.equal(r3.ok, false);
  assert.match(r3.error, /Could not parse/);

  // Image-only post: nothing to translate, still ok
  const empty = await t3.translatePost('   ');
  assert.equal(empty.ok, true);
  assert.equal(empty.translation, '');
});
