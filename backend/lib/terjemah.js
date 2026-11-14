// Menerjemahkan semua teks balon satu gambar dengan model yang dipilih pengguna (UC-04).
// Penyedia dipilih dari models.js: Gemini (gemini.js) atau DeepSeek (deepseek.js).
// Keduanya menerima prompt yang sama dan menjawab JSON yang sama, jadi pembacaannya juga sama.

const { findModel, apiName, DEFAULT_MODEL } = require('./models');
const { mintaGemini, bacaJawaban, selamatkan, GeminiError } = require('./gemini');
const { mintaDeepSeek } = require('./deepseek');

const PENYEDIA = { gemini: mintaGemini, deepseek: mintaDeepSeek };

// Jawaban kadang tidak berbentuk JSON yang sah (terpotong, kosong, atau formatnya meleset),
// padahal permintaan yang sama berhasil bila diulang. Karena itu jawaban yang tidak terbaca diulang
// sekali. Server yang sedang penuh (OVERLOADED) juga diulang sekali setelah jeda singkat.
// Error lain (API key, kuota, model) tidak diulang karena hasilnya pasti sama.
const PERCOBAAN = 2;
const JEDA_SIBUK_MS = 2000;

async function translateTexts(texts, { src = 'auto', tgt = 'en', model = DEFAULT_MODEL, fetchFn = fetch, tunggu } = {}) {
  const m = findModel(model);
  if (!m) throw new GeminiError('BAD_REQUEST', 'Model terjemahan tidak dikenal');
  const minta = PENYEDIA[m.provider];
  const api = apiName(m);
  const jeda = tunggu || ((ms) => new Promise((r) => setTimeout(r, ms)));

  // Kalau ada yang kosong, tampilkan teks asli sebagai dialog.
  const rapikan = (hasil) => hasil.map((t, i) => ({
    text: (t && t.text && String(t.text).trim()) || texts[i],
    type: (t && t.text && String(t.text).trim() && t.type) || 'dialog'
  }));
  let cadangan = null; // hasil terbaik dari jawaban rusak, dipakai bila semua percobaan gagal
  let sibukDiulang = false;
  for (let ke = 1; ; ke++) {
    let jawaban;
    try {
      jawaban = await minta(texts, { src, tgt, api, fetchFn, thinking: m.thinking });
    } catch (e) {
      if (e.code !== 'OVERLOADED' || sibukDiulang) throw e;
      sibukDiulang = true;
      console.log(`${m.label}: ${e.message}, diulang sekali setelah ${JEDA_SIBUK_MS / 1000} detik`);
      await jeda(JEDA_SIBUK_MS);
      ke--; // percobaan karena server sibuk tidak dihitung sebagai jawaban rusak
      continue;
    }
    const { raw, finishReason } = jawaban;
    try {
      return rapikan(bacaJawaban(raw, texts.length));
    } catch (e) {
      if (e.code !== 'BAD_RESPONSE') throw e;
      // Catat penyebabnya agar bisa dianalisis: finishReason MAX_TOKENS/length = terpotong, SAFETY = diblokir.
      // Bagian akhir ikut dicatat karena kerusakan JSON sering ada di tengah/akhir, bukan di awal.
      console.log(`${m.label} percobaan ${ke}: ${e.message} | finishReason=${finishReason} | panjang ${raw.length} | awal: ${JSON.stringify(raw.slice(0, 120))} | akhir: ${JSON.stringify(raw.slice(-120))}`);
      const s = selamatkan(raw, texts.length);
      if (s && (!cadangan || s.filter(Boolean).length > cadangan.filter(Boolean).length)) cadangan = s;
      if (ke >= PERCOBAAN) {
        if (!cadangan) throw e;
        console.log(`${m.label}: JSON rusak, ${cadangan.filter(Boolean).length} dari ${texts.length} teks diselamatkan (sisanya ditampilkan teks asli)`);
        return rapikan(cadangan);
      }
    }
  }
}

module.exports = { translateTexts };
