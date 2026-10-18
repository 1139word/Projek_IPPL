// Memanggil layanan OCR Python (folder ocr-service/).

class OcrError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function runOcr(imageBase64) {
  const url = process.env.OCR_URL || 'http://127.0.0.1:5001/ocr';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 }),
      signal: AbortSignal.timeout(90000)
    });
  } catch (e) {
    throw new OcrError('OCR_DOWN', 'Layanan OCR belum berjalan (jalankan: python server.py di folder ocr-service)');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new OcrError(res.status === 400 ? 'BAD_IMAGE' : 'OCR_ERROR', body.message || 'OCR gagal');
  return body; // { width, height, lines: [{ text, box: [x, y, w, h], score }], ms }
}

module.exports = { runOcr, OcrError };
