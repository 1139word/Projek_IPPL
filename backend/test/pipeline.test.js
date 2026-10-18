// Tes tanpa internet dan tanpa API key: OCR dan Gemini diganti server palsu di komputer sendiri.
// Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { groupLines } = require('../lib/group');
const { bacaJawaban, buatPrompt } = require('../lib/gemini');
const { translateImage } = require('../lib/pipeline');

test('baris yang berdekatan digabung menjadi satu balon', () => {
  const lines = [
    { text: 'WHERE ARE', box: [100, 100, 120, 20] },
    { text: 'YOU GOING?', box: [98, 124, 130, 20] },      // tepat di bawahnya -> balon sama
    { text: 'HOME.', box: [500, 600, 70, 20] }            // jauh -> balon lain
  ];
  const g = groupLines(lines);
  assert.strictEqual(g.length, 2);
  assert.strictEqual(g[0].text, 'WHERE ARE YOU GOING?');
  assert.deepStrictEqual(g[0].box, [98, 100, 130, 44]);
  assert.strictEqual(g[1].text, 'HOME.');
});

test('tulisan vertikal dibaca kanan ke kiri dan tanpa spasi', () => {
  const lines = [
    { text: 'いくの', box: [200, 50, 30, 120] },  // kolom kiri (dibaca kedua)
    { text: 'どこに', box: [240, 50, 30, 120] }   // kolom kanan (dibaca pertama)
  ];
  const g = groupLines(lines);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].text, 'どこにいくの');
});

test('angka halaman dan tanda baca saja dibuang', () => {
  assert.strictEqual(groupLines([{ text: '12', box: [0, 0, 20, 20] }, { text: '!!', box: [500, 500, 20, 20] }]).length, 0);
});

test('jawaban Gemini dengan pembungkus ```json tetap terbaca', () => {
  const raw = '```json\n{"translations":[{"id":1,"text":"B"},{"id":0,"text":"A"}]}\n```';
  assert.deepStrictEqual(bacaJawaban(raw, 2), ['A', 'B']);
});

test('prompt memuat semua teks dan bahasa tujuan', () => {
  const p = buatPrompt(['hello', 'bye'], 'en', 'id');
  assert.match(p, /Indonesian/);
  assert.match(p, /"text":"hello"/);
});

// ---------- alur lengkap dengan server palsu ----------
function serverPalsu(handler) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => handler(req, JSON.parse(data || '{}'), res));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
const kirim = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

test('alur lengkap: OCR -> Gemini -> kotak pecahan 0..1', async (t) => {
  let promptDiterima = '';
  const ocr = await serverPalsu((req, body, res) => kirim(res, 200, {
    width: 1000, height: 2000,
    lines: [{ text: 'HELLO', box: [100, 200, 200, 50], score: 0.9 }, { text: 'THERE', box: [100, 255, 200, 50], score: 0.9 }]
  }));
  const gemini = await serverPalsu((req, body, res) => {
    promptDiterima = body.contents[0].parts[0].text;
    assert.strictEqual(req.headers['x-goog-api-key'], 'kunci-uji');
    assert.match(req.url, /gemini-3\.5-flash-lite:generateContent/);
    kirim(res, 200, { candidates: [{ content: { parts: [{ text: '{"translations":[{"id":0,"text":"HALO DI SANA"}]}' }] } }] });
  });
  t.after(() => { ocr.close(); gemini.close(); });
  process.env.OCR_URL = `http://127.0.0.1:${ocr.address().port}/ocr`;
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${gemini.address().port}`;
  process.env.GEMINI_API_KEY = 'kunci-uji';

  const hasil = await translateImage({ image: 'AAAA', src: 'en', tgt: 'id', model: 'std' });
  assert.strictEqual(hasil.regions.length, 1);
  assert.strictEqual(hasil.regions[0].text, 'HALO DI SANA');
  assert.strictEqual(hasil.regions[0].original, 'HELLO THERE');
  assert.deepStrictEqual(hasil.regions[0].box, [0.1, 0.1, 0.2, 0.0525]);
  assert.match(promptDiterima, /HELLO THERE/);
});

test('gambar tanpa teks menghasilkan NO_TEXT', async () => {
  await assert.rejects(
    translateImage({ image: 'AAAA' }, { runOcr: async () => ({ width: 10, height: 10, lines: [] }) }),
    (e) => e.code === 'NO_TEXT' && e.status === 422
  );
});

test('layanan OCR mati menghasilkan pesan yang jelas', async () => {
  process.env.OCR_URL = 'http://127.0.0.1:1/ocr';
  await assert.rejects(translateImage({ image: 'AAAA' }), (e) => e.code === 'OCR_DOWN');
});

test('API key salah diterjemahkan menjadi BAD_API_KEY', async (t) => {
  const gemini = await serverPalsu((req, body, res) => kirim(res, 400, { error: { message: 'API key not valid. Please pass a valid API key.' } }));
  t.after(() => gemini.close());
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${gemini.address().port}`;
  await assert.rejects(
    translateImage({ image: 'AAAA' }, { runOcr: async () => ({ width: 100, height: 100, lines: [{ text: 'HI', box: [1, 1, 20, 10] }] }) }),
    (e) => e.code === 'BAD_API_KEY'
  );
});
