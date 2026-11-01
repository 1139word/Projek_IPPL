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
    'Also classify every item with "type":',
    '- "dialog": speech, thoughts, narration boxes, and story text such as signs or letters;',
    '  a character\'s own voice is ALWAYS "dialog", even when it is short, outside a bubble or written by hand:',
    '  screams, gasps, laughs, stutters and interjections such as ひぃぃ, きゃあ, はぁ?, え…, ちっ, Hiii!, Huh?, Eek!;',
    '- "sfx": sounds that do not come from a character\'s mouth: impacts, movements, ambience and mood effects',
    '  drawn as part of the artwork (e.g. ドン, ゴゴゴ, バキ, ぷるぷる, ざわ, BOOM, CRACK). When unsure, use "dialog";',
    '- "watermark": credits, artist or circle names, URLs, social media handles, copyright or "do not repost / no AI training" notices.',
    'Translate every item whatever its type; for "sfx" give a short equivalent sound or description in the target language.',
    'Answer ONLY with JSON in this exact shape: {"translations":[{"id":0,"type":"dialog","text":"..."}]}',
    'Return one entry for every id.',
    '',
    JSON.stringify(items)
  ].join('\n');
}

// Jenis teks yang dikenali. Jenis lain (atau tidak ada) dianggap dialog, supaya tetap ditampilkan seperti biasa.
const JENIS = ['dialog', 'sfx', 'watermark'];
const jenisSah = (t) => (JENIS.includes(t) ? t : 'dialog');

// Gemini kadang membungkus JSON dengan ```json ... ```; bersihkan dulu sebelum di-parse.
// Hasil: daftar { text, type } sesuai urutan id (null bila id itu tidak dijawab).
function bacaJawaban(raw, jumlah) {
  const bersih = String(raw || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let data;
  try { data = JSON.parse(bersih); } catch { throw new GeminiError('BAD_RESPONSE', 'Jawaban Gemini tidak bisa dibaca'); }
  const list = Array.isArray(data) ? data : data.translations;
  if (!Array.isArray(list)) throw new GeminiError('BAD_RESPONSE', 'Jawaban Gemini tidak sesuai format');
  const hasil = new Array(jumlah).fill(null);
  list.forEach((t, i) => {
    const id = Number.isInteger(t && t.id) ? t.id : i;
    if (id >= 0 && id < jumlah) {
      hasil[id] = typeof t === 'string'
        ? { text: t, type: 'dialog' }
        : { text: t && t.text, type: jenisSah(t && t.type) };
    }
  });
  return hasil;
}

// Cara cadangan bila JSON utuhnya rusak (misalnya satu tanda kutip di tengah tidak di-escape):
// ambil satu per satu objek {"id":..,"type":..,"text":..} yang masih utuh. Id yang tidak terselamatkan
// nanti diisi teks aslinya. Mengembalikan null bila tidak ada satu pun yang terbaca.
function selamatkan(raw, jumlah) {
  const hasil = new Array(jumlah).fill(null);
  let dapat = 0;
  for (const m of String(raw || '').matchAll(/\{[^{}]*"id"\s*:\s*\d+[^{}]*\}/g)) {
    let t;
    try { t = JSON.parse(m[0]); } catch { continue; }
    if (Number.isInteger(t.id) && t.id >= 0 && t.id < jumlah && typeof t.text === 'string' && !hasil[t.id]) {
      hasil[t.id] = { text: t.text, type: jenisSah(t.type) };
      dapat++;
    }
  }
  return dapat ? hasil : null;
}

// Bentuk jawaban yang diwajibkan ke Gemini (structured output). Dengan skema ini Gemini dipaksa
// mengeluarkan JSON yang sah dan sesuai bentuk, jauh lebih jarang rusak dibanding hanya diminta lewat prompt.
const SKEMA = {
  type: 'OBJECT',
  properties: {
    translations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'INTEGER' },
          type: { type: 'STRING', enum: JENIS },
          text: { type: 'STRING' }
        },
        required: ['id', 'type', 'text'],
        propertyOrdering: ['id', 'type', 'text']
      }
    }
  },
  required: ['translations']
};

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
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json', responseSchema: SKEMA }
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
  // Kalau ada yang kosong, tampilkan teks asli sebagai dialog.
  const rapikan = (hasil) => hasil.map((t, i) => ({
    text: (t && t.text && String(t.text).trim()) || texts[i],
    type: (t && t.text && String(t.text).trim() && t.type) || 'dialog'
  }));
  let cadangan = null; // hasil terbaik dari jawaban rusak, dipakai bila semua percobaan gagal
  for (let ke = 1; ; ke++) {
    const { raw, finishReason } = await mintaGemini(texts, { src, tgt, model, key, fetchFn });
    try {
      return rapikan(bacaJawaban(raw, texts.length));
    } catch (e) {
      if (e.code !== 'BAD_RESPONSE') throw e;
      // Catat penyebabnya agar bisa dianalisis: finishReason MAX_TOKENS = terpotong, SAFETY = diblokir.
      // Bagian akhir ikut dicatat karena kerusakan JSON sering ada di tengah/akhir, bukan di awal.
      console.log(`Gemini percobaan ${ke}: ${e.message} | finishReason=${finishReason} | panjang ${raw.length} | awal: ${JSON.stringify(raw.slice(0, 120))} | akhir: ${JSON.stringify(raw.slice(-120))}`);
      const s = selamatkan(raw, texts.length);
      if (s && (!cadangan || s.filter(Boolean).length > cadangan.filter(Boolean).length)) cadangan = s;
      if (ke >= PERCOBAAN) {
        if (!cadangan) throw e;
        console.log(`Gemini: JSON rusak, ${cadangan.filter(Boolean).length} dari ${texts.length} teks diselamatkan (sisanya ditampilkan teks asli)`);
        return rapikan(cadangan);
      }
    }
  }
}

module.exports = { translateTexts, buatPrompt, bacaJawaban, selamatkan, modelName, GeminiError, JENIS };
