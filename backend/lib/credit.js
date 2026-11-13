// Aturan credit per akun (UC-02, UC-05): biaya tiap model, cek sebelum menerjemahkan,
// dan potong hanya setelah terjemahan berhasil (gagal atau teks tidak ditemukan = gratis).
// Semua akun boleh memakai semua model; yang membatasi hanya saldo credit.

// Biaya per gambar. Daftar ini masih dua model lama; empat model baru (termasuk yang 2 credit)
// dikerjakan pada tahap model.
const COST = { std: 1, adv: 1 };

class CreditError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

function costOf(model) {
  if (!Object.hasOwn(COST, model)) throw new CreditError('BAD_REQUEST', 'Model terjemahan tidak dikenal', 400);
  return COST[model];
}

// Asal permintaan: 'page' = tombol di halaman situs, 'explorer' = gambar dari File Explorer
// (akan diganti halaman unggah gambar pada tahap berikutnya).
const SOURCES = ['page', 'explorer'];

// Dipanggil SEBELUM OCR dan Gemini, supaya permintaan yang pasti ditolak tidak membuang waktu dan biaya API.
function checkCredit(user, model, { source = 'page' } = {}) {
  const cost = costOf(model);
  if (!SOURCES.includes(source)) throw new CreditError('BAD_REQUEST', 'Asal permintaan tidak dikenal', 400);
  if (user.credit_left < cost) {
    throw new CreditError('NO_CREDIT', 'Credit tidak cukup. Buka popup Image Translator untuk membeli credit.', 402);
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
