// Penerjemahan teks lewat Gemini API (REST, tanpa pustaka tambahan).
// Semua teks balon dalam satu gambar dikirim dalam SATU permintaan, supaya:
//  - hemat kuota (1 panggilan per gambar, bukan per balon),
//  - Gemini melihat konteks seluruh halaman sehingga terjemahannya lebih nyambung.

const LANGS = {
  auto: 'deteksi otomatis', ja: 'Japanese', en: 'English', id: 'Indonesian', ko: 'Korean',
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', es: 'Spanish', fr: 'French',
  de: 'German', ru: 'Russian', th: 'Thai', vi: 'Vietnamese'
};

class GeminiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function modelName(model) {
  return model === 'adv'
    ? process.env.GEMINI_MODEL_ADV || 'gemini-3.8-flash'
    : process.env.GEMINI_MODEL_STD || 'gemini-3.5-flash-lite';
}

function buatPrompt(texts, src, tgt) {
  const asal = src === 'auto' || !LANGS[src] ? 'the original language (detect it)' : LANGS[src];
  const tujuan = LANGS[tgt] || tgt;
  const items = texts.map((text, i) => ({ id: i, text }));
  return [
    `You translate speech bubbles from a comic/manga page from ${asal} into ${tujuan}.`,
    'The text comes from OCR, so it may contain small recognition mistakes; infer the intended words.',
    'Keep each translation natural and short enough to fit the same bubble. Keep names as they are.',
    'If an item is already in the target language, return it unchanged.',
    'Answer ONLY with JSON in this exact shape: {"translations":[{"id":0,"text":"..."}]}',
    'Return one entry for every id.',
    '',
    JSON.stringify(items)
  ].join('\n');
}

// Gemini kadang membungkus JSON dengan ```json ... ```; bersihkan dulu sebelum di-parse.
function bacaJawaban(raw, jumlah) {
  const bersih = String(raw || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let data;
  try { data = JSON.parse(bersih); } catch { throw new GeminiError('BAD_RESPONSE', 'Jawaban Gemini tidak bisa dibaca'); }
  const list = Array.isArray(data) ? data : data.translations;
  if (!Array.isArray(list)) throw new GeminiError('BAD_RESPONSE', 'Jawaban Gemini tidak sesuai format');
  const hasil = new Array(jumlah).fill(null);
  list.forEach((t, i) => {
    const id = Number.isInteger(t && t.id) ? t.id : i;
    if (id >= 0 && id < jumlah) hasil[id] = typeof t === 'string' ? t : t && t.text;
  });
  return hasil;
}

// Satu panggilan ke Gemini. Mengembalikan teks jawaban mentah dan alasan berhentinya (finishReason).
async function mintaGemini(texts, { src, tgt, model, key, fetchFn }) {
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const url = `${base}/v1beta/models/${modelName(model)}:generateContent`;
  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buatPrompt(texts, src, tgt) }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
      }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    throw new GeminiError('GEMINI_UNREACHABLE', 'Tidak bisa menghubungi Gemini: ' + e.message);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || `HTTP ${res.status}`;
    if (res.status === 400 && /api key/i.test(msg)) throw new GeminiError('BAD_API_KEY', 'API key Gemini tidak valid');
    if (res.status === 403) throw new GeminiError('ACCESS_DENIED', 'Akses Gemini ditolak untuk project/akun ini. Coba buat API key dengan akun Google lain (misalnya Gmail pribadi, bukan akun kampus)');
    if (res.status === 404) throw new GeminiError('MODEL_NOT_FOUND', `Model ${modelName(model)} tidak tersedia. Ganti nama model di .env`);
    if (res.status === 429) throw new GeminiError('QUOTA', 'Kuota Gemini habis sementara, coba lagi sebentar');
    throw new GeminiError('GEMINI_ERROR', 'Gemini error: ' + msg);
  }
  const cand = (body.candidates && body.candidates[0]) || {};
  const parts = (cand.content && cand.content.parts) || [];
  return { raw: parts.map((p) => p.text || '').join(''), finishReason: cand.finishReason || '(tidak ada)' };
}

// Jawaban Gemini sesekali tidak berbentuk JSON yang sah (terpotong, kosong, atau formatnya meleset),
// padahal permintaan yang sama berhasil bila diulang. Karena itu jawaban yang tidak terbaca diulang
// sekali. Error lain (API key, kuota, model) tidak diulang karena hasilnya pasti sama.
const PERCOBAAN = 2;

async function translateTexts(texts, { src = 'auto', tgt = 'en', model = 'std', fetchFn = fetch } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError('NO_API_KEY', 'GEMINI_API_KEY belum diisi di backend/.env');
  for (let ke = 1; ; ke++) {
    const { raw, finishReason } = await mintaGemini(texts, { src, tgt, model, key, fetchFn });
    try {
      const hasil = bacaJawaban(raw, texts.length);
      return hasil.map((t, i) => (t && String(t).trim()) || texts[i]); // kalau ada yang kosong, tampilkan teks asli
    } catch (e) {
      if (e.code !== 'BAD_RESPONSE') throw e;
      // Catat penyebabnya agar bisa dianalisis: finishReason MAX_TOKENS = terpotong, SAFETY = diblokir.
      console.log(`Gemini percobaan ${ke}: ${e.message} | finishReason=${finishReason} | awal jawaban: ${JSON.stringify(raw.slice(0, 120))}`);
      if (ke >= PERCOBAAN) throw e;
    }
  }
}

module.exports = { translateTexts, buatPrompt, bacaJawaban, modelName, GeminiError };
