// Tes pemanggilan Gemini tanpa internet: fetch diganti versi palsu.
// Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const { translateTexts } = require('../lib/terjemah');

process.env.GEMINI_API_KEY = 'kunci-palsu';

// Membuat fetch palsu yang menjawab berurutan sesuai daftar teks jawaban.
function fetchPalsu(jawaban, status = 200) {
  const f = async () => {
    const raw = jawaban[Math.min(f.panggil++, jawaban.length - 1)];
    return { ok: status === 200, status, json: async () => ({ candidates: [{ content: { parts: [{ text: raw }] }, finishReason: 'STOP' }] }) };
  };
  f.panggil = 0;
  return f;
}
const SAH = '{"translations":[{"id":0,"type":"dialog","text":"Halo"},{"id":1,"type":"sfx","text":"Dunia"}]}';
const HASIL = [{ text: 'Halo', type: 'dialog' }, { text: 'Dunia', type: 'sfx' }];
const diam = (fn) => async () => { const log = console.log; console.log = () => {}; try { await fn(); } finally { console.log = log; } };

test('jawaban sah langsung dipakai, satu panggilan', async () => {
  const f = fetchPalsu([SAH]);
  assert.deepStrictEqual(await translateTexts(['Hello', 'World'], { fetchFn: f }), HASIL);
  assert.strictEqual(f.panggil, 1);
});

test('jawaban tidak terbaca diulang sekali lalu berhasil', diam(async () => {
  const f = fetchPalsu(['{"translations":[{"id":0,"text":"Ha', SAH]); // jawaban pertama terpotong
  assert.deepStrictEqual(await translateTexts(['Hello', 'World'], { fetchFn: f }), HASIL);
  assert.strictEqual(f.panggil, 2);
}));

test('dua kali tidak terbaca: menyerah dengan BAD_RESPONSE', diam(async () => {
  const f = fetchPalsu(['bukan json']);
  await assert.rejects(translateTexts(['Hello'], { fetchFn: f }), { code: 'BAD_RESPONSE' });
  assert.strictEqual(f.panggil, 2);
}));

test('JSON rusak di tengah: teks yang utuh diselamatkan, sisanya teks asli', diam(async () => {
  // Tanda kutip tanpa escape di teks id 1 membuat seluruh JSON tidak sah.
  const rusak = '{"translations":[{"id":0,"type":"dialog","text":"Halo"},{"id":1,"type":"dialog","text":"Dia bilang "hai""},{"id":2,"type":"sfx","text":"Duar"}]}';
  const f = fetchPalsu([rusak]);
  assert.deepStrictEqual(await translateTexts(['A', 'B', 'C'], { fetchFn: f }), [
    { text: 'Halo', type: 'dialog' },
    { text: 'B', type: 'dialog' },
    { text: 'Duar', type: 'sfx' }
  ]);
  assert.strictEqual(f.panggil, 2); // tetap dicoba ulang sekali dulu
}));

test('permintaan memakai skema JSON (structured output)', async () => {
  let body;
  const f = async (_u, opt) => { body = JSON.parse(opt.body); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: SAH }] } }] }) }; };
  await translateTexts(['Hello', 'World'], { fetchFn: f });
  assert.strictEqual(body.generationConfig.responseSchema.properties.translations.type, 'ARRAY');
});

test('jenis tidak dikenal dianggap dialog, teks kosong diganti teks asli', async () => {
  const f = fetchPalsu(['{"translations":[{"id":0,"type":"noise","text":"A"},{"id":1,"type":"sfx","text":""}]}']);
  assert.deepStrictEqual(await translateTexts(['x', 'Asli'], { fetchFn: f }), [
    { text: 'A', type: 'dialog' },
    { text: 'Asli', type: 'dialog' }
  ]);
});

test('jenis watermark ikut terbaca', async () => {
  const f = fetchPalsu(['{"translations":[{"id":0,"type":"watermark","text":"Dilarang repost"}]}']);
  assert.deepStrictEqual(await translateTexts(['転載禁止'], { fetchFn: f }), [{ text: 'Dilarang repost', type: 'watermark' }]);
});

test('kuota habis (429) tidak diulang', async () => {
  const f = fetchPalsu([SAH], 429);
  await assert.rejects(translateTexts(['Hello'], { fetchFn: f }), { code: 'QUOTA' });
  assert.strictEqual(f.panggil, 1);
});

test('server Gemini sibuk (503) diulang sekali setelah jeda, lalu berhasil', diam(async () => {
  let ke = 0;
  const f = async () => (++ke === 1
    ? { ok: false, status: 503, json: async () => ({ error: { message: 'This model is currently experiencing high demand.' } }) }
    : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: SAH }] } }] }) });
  const jeda = [];
  assert.deepStrictEqual(await translateTexts(['Hello', 'World'], { fetchFn: f, tunggu: async (ms) => jeda.push(ms) }), HASIL);
  assert.strictEqual(ke, 2);
  assert.deepStrictEqual(jeda, [2000]);
}));

test('server Gemini sibuk dua kali: menyerah dengan OVERLOADED', diam(async () => {
  const f = fetchPalsu([SAH], 503);
  await assert.rejects(translateTexts(['Hello'], { fetchFn: f, tunggu: async () => {} }), { code: 'OVERLOADED' });
  assert.strictEqual(f.panggil, 2);
}));

test('nama model Gemini sesuai pilihan, dan bisa diganti lewat .env', async () => {
  const url = [];
  const f = async (u) => { url.push(u); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: SAH }] } }] }) }; };
  await translateTexts(['Hello', 'World'], { model: 'flash-lite', fetchFn: f });
  await translateTexts(['Hello', 'World'], { model: 'flash', fetchFn: f });
  await translateTexts(['Hello', 'World'], { model: 'pro', fetchFn: f });
  process.env.GEMINI_MODEL_PRO = 'gemini-3.1-pro';
  try { await translateTexts(['Hello', 'World'], { model: 'pro', fetchFn: f }); } finally { delete process.env.GEMINI_MODEL_PRO; }
  assert.match(url[0], /\/models\/gemini-3\.1-flash-lite:generateContent$/);
  assert.match(url[1], /\/models\/gemini-3\.5-flash:generateContent$/);
  assert.match(url[2], /\/models\/gemini-3\.1-pro-preview:generateContent$/);
  assert.match(url[3], /\/models\/gemini-3\.1-pro:generateContent$/);
});

test('model tidak dikenal ditolak tanpa memanggil API', async () => {
  let dipanggil = false;
  await assert.rejects(translateTexts(['Hello'], { model: 'gratis', fetchFn: async () => { dipanggil = true; } }), { code: 'BAD_REQUEST' });
  assert.strictEqual(dipanggil, false);
});

test('model tanpa kuota gratis (limit: 0) memberi NEEDS_BILLING, bukan QUOTA, dan tidak diulang', async () => {
  let ke = 0;
  const f = async () => { ke++; return { ok: false, status: 429, json: async () => ({ error: { message: 'You exceeded your current quota. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0, model: gemini-3.1-pro' } }) }; };
  await assert.rejects(translateTexts(['Hello'], { model: 'pro', fetchFn: f }), (e) => e.code === 'NEEDS_BILLING' && /gemini-3\.1-pro-preview HTTP 429/.test(e.detail));
  assert.strictEqual(ke, 1);
});

test('3.5 Flash dan Pro meminta thinking rendah; Flash-Lite tidak mengubah bawaan', async () => {
  const body = [];
  const f = async (_u, opt) => { body.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: SAH }] } }] }) }; };
  await translateTexts(['Hello', 'World'], { model: 'flash', fetchFn: f });
  await translateTexts(['Hello', 'World'], { model: 'pro', fetchFn: f });
  await translateTexts(['Hello', 'World'], { model: 'flash-lite', fetchFn: f });
  assert.deepStrictEqual(body[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.deepStrictEqual(body[1].generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.strictEqual(body[2].generationConfig.thinkingConfig, undefined);
});

test('bila Google menolak pengaturan thinking (400), dikirim ulang tanpa itu dan diingat', diam(async () => {
  const { TANPA_THINKING } = require('../lib/gemini');
  TANPA_THINKING.clear();
  const body = [];
  const f = async (_u, opt) => {
    const b = JSON.parse(opt.body); body.push(b);
    if (b.generationConfig.thinkingConfig) return { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid JSON payload received. Unknown name "thinkingLevel" at generation_config.thinking_config' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: SAH }] } }] }) };
  };
  assert.deepStrictEqual(await translateTexts(['Hello', 'World'], { model: 'flash', fetchFn: f }), HASIL);
  assert.strictEqual(body.length, 2);
  await translateTexts(['Hello', 'World'], { model: 'flash', fetchFn: f });
  assert.strictEqual(body.length, 3); // permintaan berikutnya langsung tanpa thinking
  TANPA_THINKING.clear();
}));
