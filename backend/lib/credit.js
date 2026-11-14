// Aturan credit per akun (UC-02, UC-05): biaya tiap model, cek sebelum menerjemahkan,
// dan potong hanya setelah terjemahan berhasil (gagal atau teks tidak ditemukan = gratis).
// Semua akun boleh memakai semua model; yang membatasi hanya saldo credit.

const { MODELS, findModel } = require('./models');

// Biaya per gambar, diambil dari daftar model (models.js): Gemini 3.1 Pro 2 credit, lainnya 1 credit.
const COST = Object.fromEntries(MODELS.map((m) => [m.id, m.cost]));

class CreditError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

function costOf(model) {
  const m = findModel(model);
  if (!m) throw new CreditError('BAD_REQUEST', 'Model terjemahan tidak dikenal', 400);
  return m.cost;
}

// Asal permintaan: 'page' = tombol di halaman situs, 'explorer' = gambar dari File Explorer
// (akan diganti halaman unggah gambar pada tahap berikutnya).
const SOURCES = ['page', 'explorer'];

// Dipanggil SEBELUM OCR dan Gemini, supaya permintaan yang pasti ditolak tidak membuang waktu dan biaya API.
function checkCredit(user, model, { source = 'page' } = {}) {
  const cost = costOf(model);
  if (!SOURCES.includes(source)) throw new CreditError('BAD_REQUEST', 'Asal permintaan tidak dikenal', 400);
  if (user.credit_left < cost) {
    // Saldo masih ada tetapi kurang untuk model 2 credit: sebutkan agar pengguna bisa memilih model lain.
    const pesan = user.credit_left > 0
      ? `Credit tidak cukup: model ini butuh ${cost} credit, sisa ${user.credit_left}. Pilih model 1 credit atau beli credit di popup Image Translator.`
      : 'Credit tidak cukup. Buka popup Image Translator untuk membeli credit.';
    throw new CreditError('NO_CREDIT', pesan, 402);
  }
  return cost;
}

// Dipanggil SETELAH terjemahan berhasil. Pengurangan dilakukan oleh database dengan syarat
// credit masih cukup, sehingga dua terjemahan yang selesai bersamaan tidak membuat credit minus.
async function chargeCredit(user, model, { store }) {
  const cost = costOf(model);
  const ok = await store.useCredit(user.id, cost);
  return { ...user, credit_left: ok ? user.credit_left - cost : user.credit_left };
}

module.exports = { COST, CreditError, costOf, checkCredit, chargeCredit };
