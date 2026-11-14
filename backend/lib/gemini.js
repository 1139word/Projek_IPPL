// Penerjemahan teks lewat Gemini API (REST, tanpa pustaka tambahan).
// Berisi juga bagian yang dipakai bersama oleh DeepSeek (prompt, pembacaan jawaban JSON).
// Alur lengkapnya (pilih penyedia, ulangi bila gagal) ada di terjemah.js.
// Semua teks balon dalam satu gambar dikirim dalam SATU permintaan, supaya:
//  - hemat kuota (1 panggilan per gambar, bukan per balon),
//  - Gemini melihat konteks seluruh halaman sehingga terjemahannya lebih nyambung.

const LANGS = {
  auto: 'deteksi otomatis', ja: 'Japanese', en: 'English', id: 'Indonesian', ko: 'Korean',
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', es: 'Spanish', fr: 'French',
  de: 'German', ru: 'Russian', th: 'Thai', vi: 'Vietnamese'
};

// Error dari penyedia terjemahan (Gemini maupun DeepSeek). Nama kelasnya dipertahankan
// karena sudah dipakai sejak awal.
// detail = pesan asli dari Google/DeepSeek, hanya untuk log terminal backend (diagnosis),
// tidak ditampilkan ke pengguna.
class GeminiError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; if (detail) this.detail = detail; }
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
  try { data = JSON.parse(bersih); } catch { throw new GeminiError('BAD_RESPONSE', 'Jawaban model tidak bisa dibaca'); }
  const list = Array.isArray(data) ? data : data.translations;
  if (!Array.isArray(list)) throw new GeminiError('BAD_RESPONSE', 'Jawaban model tidak sesuai format');
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

// Model yang menolak pengaturan thinking (HTTP 400). Dicatat supaya permintaan berikutnya
// langsung dikirim tanpa pengaturan itu, tidak gagal dulu setiap kali.
const TANPA_THINKING = new Set();

// Satu panggilan ke Gemini. Mengembalikan teks jawaban mentah dan alasan berhentinya (finishReason).
// api = nama model Gemini (misalnya gemini-3.1-flash-lite), dari models.js.
// thinking = tingkat berpikir yang diminta ('low'), atau kosong = bawaan Google.
async function mintaGemini(texts, { src, tgt, api, fetchFn, thinking }) {
  const pakaiThinking = Boolean(thinking) && !TANPA_THINKING.has(api);
  const generationConfig = { temperature: 0.3, responseMimeType: 'application/json', responseSchema: SKEMA };
  if (pakaiThinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError('NO_API_KEY', 'GEMINI_API_KEY belum diisi di backend/.env');
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const url = `${base}/v1beta/models/${api}:generateContent`;
  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buatPrompt(texts, src, tgt) }] }],
        generationConfig
      }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    throw new GeminiError('GEMINI_UNREACHABLE', 'Tidak bisa menghubungi Gemini: ' + e.message);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || `HTTP ${res.status}`;
    const asli = `${api} HTTP ${res.status}: ${msg}`;
    // Nama field thinking belum bisa dipastikan dari dokumentasi Google untuk generateContent.
    // Bila Google menolaknya, ulangi tanpa pengaturan itu (hasilnya sama seperti sebelum ada pengaturan ini).
    if (res.status === 400 && pakaiThinking && /thinking/i.test(msg)) {
      TANPA_THINKING.add(api);
      console.log(`${api}: pengaturan thinking ditolak Google (${msg.slice(0, 150)}), dikirim ulang tanpa pengaturan itu`);
      return mintaGemini(texts, { src, tgt, api, fetchFn });
    }
    if (res.status === 400 && /api key/i.test(msg)) throw new GeminiError('BAD_API_KEY', 'API key Gemini tidak valid', asli);
    if (res.status === 403) throw new GeminiError('ACCESS_DENIED', 'Akses Gemini ditolak untuk project/akun ini. Coba buat API key dengan akun Google lain (misalnya Gmail pribadi, bukan akun kampus)', asli);
    if (res.status === 404) throw new GeminiError('MODEL_NOT_FOUND', `Model ${api} tidak tersedia. Ganti nama model di .env`, asli);
    // "free_tier ... limit: 0" = model ini sama sekali tidak punya kuota gratis (misalnya Gemini 3.1 Pro),
    // jadi menunggu tidak akan membantu; perlu billing di Google AI Studio.
    if (res.status === 429 && /free_tier/i.test(msg) && /limit:\s*0\b/.test(msg)) {
      throw new GeminiError('NEEDS_BILLING', 'Model ini tidak tersedia di kuota gratis Gemini (butuh billing di Google AI Studio). Pilih model lain', asli);
    }
    if (res.status === 429) throw new GeminiError('QUOTA', 'Kuota Gemini habis sementara, coba lagi sebentar', asli);
    // 503 "high demand" / 500: server Google sedang penuh. Biasanya hilang sendiri dalam beberapa detik,
    // jadi terjemah.js mengulanginya sekali.
    if (res.status === 503 || res.status === 500) throw new GeminiError('OVERLOADED', 'Server Gemini sedang sibuk, coba lagi sebentar', asli);
    throw new GeminiError('GEMINI_ERROR', 'Gemini error: ' + msg, asli);
  }
  const cand = (body.candidates && body.candidates[0]) || {};
  const parts = (cand.content && cand.content.parts) || [];
  return { raw: parts.map((p) => p.text || '').join(''), finishReason: cand.finishReason || '(tidak ada)' };
}

module.exports = { TANPA_THINKING, mintaGemini, buatPrompt, bacaJawaban, selamatkan, GeminiError, JENIS };
