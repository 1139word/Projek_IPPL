// Backend Image Translator (tahap UTS): satu endpoint penerjemahan.
// Akun, credit, dan Premium menyusul di tahap berikutnya.
//
// Menjalankan:  npm start   (membaca konfigurasi dari file .env)

const express = require('express');
const { translateImage } = require('./lib/pipeline');

const app = express();
app.use(express.json({ limit: '25mb' })); // gambar dikirim sebagai base64, jadi ukurannya bisa besar

// Izinkan dipanggil dari extension.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/translate', async (req, res) => {
  const { image, src, tgt, model } = req.body || {};
  try {
    const result = await translateImage({ image, src, tgt, model });
    const m = result.meta;
    console.log(`OK  ${m.balloons} balon | OCR ${m.ocrMs} ms (proses ${m.ocrProcessMs ?? '?'} ms) | Gemini ${m.translateMs} ms | ${model}->${tgt}`);
    res.json(result);
  } catch (e) {
    const status = e.status || (e.code === 'BAD_IMAGE' ? 400 : 502);
    console.log(`GAGAL [${e.code || 'ERROR'}] ${e.message}`);
    res.status(status).json({ code: e.code || 'ERROR', message: e.message || 'Terjemahan gagal' });
  }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Backend siap di http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) console.log('Peringatan: GEMINI_API_KEY belum diisi di .env');
});
