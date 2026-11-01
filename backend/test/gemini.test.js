// Tes pemanggilan Gemini tanpa internet: fetch diganti versi palsu.
// Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const { translateTexts } = require('../lib/gemini');

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
