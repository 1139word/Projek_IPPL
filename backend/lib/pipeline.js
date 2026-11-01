// Alur penerjemahan satu gambar: OCR -> kelompokkan per balon -> Gemini -> kotak hasil.
// Dipisah dari server.js agar bisa diuji tanpa Express.

const { runOcr } = require('./ocr');
const { groupLines } = require('./group');
const { translateTexts } = require('./gemini');

class PipelineError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

async function translateImage({ image, src = 'auto', tgt = 'en', model = 'std' }, deps = {}) {
  const ocr = deps.runOcr || runOcr;
  const translate = deps.translateTexts || translateTexts;
  if (!image || typeof image !== 'string') throw new PipelineError('BAD_REQUEST', 'Gambar tidak dikirim', 400);

  const t0 = Date.now();
  const hasilOcr = await ocr(image);
  const t1 = Date.now();

  const groups = groupLines(hasilOcr.lines || []);
  if (!groups.length) throw new PipelineError('NO_TEXT', 'Teks tidak ditemukan pada gambar', 422);

  const translations = await translate(groups.map((g) => g.text), { src, tgt, model });
  const t2 = Date.now();

  const W = hasilOcr.width, H = hasilOcr.height;
  // Kotak dikirim sebagai pecahan 0..1, sehingga overlay tetap pas walau gambar ditampilkan diperkecil/diperbesar.
  // type: 'dialog' | 'sfx' | 'watermark' (ditandai Gemini). Extension memakai ini untuk gaya tampilan.
  const regions = groups.map((g, i) => {
    const t = translations[i];
    return {
      box: [g.box[0] / W, g.box[1] / H, g.box[2] / W, g.box[3] / H].map((v) => Math.round(v * 10000) / 10000),
      text: typeof t === 'string' ? t : t.text,
      type: typeof t === 'string' ? 'dialog' : t.type,
      original: g.text,
      dark: g.dark || false // balon hitam: extension menampilkan kotak hitam berhuruf putih
    };
  });
  // ocrMs = total menunggu OCR (termasuk pengiriman data); ocrProcessMs = waktu proses OCR di layanan Python.
  const sfx = regions.filter((r) => r.type === 'sfx').length;
  const watermark = regions.filter((r) => r.type === 'watermark').length;
  return { regions, meta: { ocrMs: t1 - t0, ocrProcessMs: hasilOcr.ms, translateMs: t2 - t1, balloons: regions.length, sfx, watermark, model, tgt } };
}

module.exports = { translateImage, PipelineError };
