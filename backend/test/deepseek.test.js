// Tes pemanggilan DeepSeek tanpa internet: fetch diganti versi palsu.
// Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const { translateTexts } = require('../lib/terjemah');

const SAH = '{"translations":[{"id":0,"type":"dialog","text":"Halo"},{"id":1,"type":"sfx","text":"Dunia"}]}';
const HASIL = [{ text: 'Halo', type: 'dialog' }, { text: 'Dunia', type: 'sfx' }];
const diam = (fn) => async () => { const log = console.log; console.log = () => {}; try { await fn(); } finally { console.log = log; } };

// Jawaban format OpenAI chat completions.
function fetchPalsu(isi, status = 200) {
  const f = async (url, opt) => {
    f.permintaan.push({ url, opt, body: JSON.parse(opt.body) });
    const raw = isi[Math.min(f.permintaan.length - 1, isi.length - 1)];
    return { ok: status === 200, status, json: async () => (status === 200 ? { choices: [{ message: { content: raw }, finish_reason: 'stop' }] } : { error: { message: 'gagal' } }) };
  };
  f.permintaan = [];
  return f;
}

test.beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'kunci-deepseek'; });

test('DeepSeek: permintaan sesuai dokumentasi (endpoint, JSON mode, thinking mati)', async () => {
  const f = fetchPalsu([SAH]);
  assert.deepStrictEqual(await translateTexts(['Hello', 'World'], { model: 'deepseek', fetchFn: f }), HASIL);
  const { url, opt, body } = f.permintaan[0];
  assert.strictEqual(url, 'https://api.deepseek.com/chat/completions');
  assert.strictEqual(opt.headers.Authorization, 'Bearer kunci-deepseek');
  assert.strictEqual(body.model, 'deepseek-flash');
  assert.deepStrictEqual(body.response_format, { type: 'json_object' });
  assert.deepStrictEqual(body.thinking, { type: 'disabled' });
  // JSON mode DeepSeek mewajibkan kata "json" di prompt.
  assert.match(body.messages.map((m) => m.content).join(' '), /json/);
  assert.match(body.messages[1].content, /"Hello"/);
});

test('DeepSeek: jawaban kosong (hanya spasi) diulang sekali', diam(async () => {
  const f = fetchPalsu(['   ', SAH]);
  assert.deepStrictEqual(await translateTexts(['Hello', 'World'], { model: 'deepseek', fetchFn: f }), HASIL);
  assert.strictEqual(f.permintaan.length, 2);
}));

test('DeepSeek: API key belum diisi', async () => {
  delete process.env.DEEPSEEK_API_KEY;
  await assert.rejects(translateTexts(['Hello'], { model: 'deepseek', fetchFn: fetchPalsu([SAH]) }), (e) => e.code === 'NO_API_KEY' && /DEEPSEEK_API_KEY/.test(e.message));
});

test('DeepSeek: API key salah (401) dan saldo DeepSeek habis (402)', async () => {
  await assert.rejects(translateTexts(['Hello'], { model: 'deepseek', fetchFn: fetchPalsu([SAH], 401) }), { code: 'BAD_API_KEY' });
  await assert.rejects(translateTexts(['Hello'], { model: 'deepseek', fetchFn: fetchPalsu([SAH], 402) }), { code: 'DEEPSEEK_NO_BALANCE' });
});

test('DeepSeek: nama model bisa diganti lewat .env', async () => {
  process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
  const f = fetchPalsu([SAH]);
  try { await translateTexts(['Hello', 'World'], { model: 'deepseek', fetchFn: f }); } finally { delete process.env.DEEPSEEK_MODEL; }
  assert.strictEqual(f.permintaan[0].body.model, 'deepseek-v4-flash');
});
