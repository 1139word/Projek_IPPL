// Aturan credit per akun (UC-02, UC-05): biaya tiap model, cek sebelum menerjemahkan,
// dan potong hanya setelah terjemahan berhasil (gagal atau teks tidak ditemukan = gratis).

const COST = { std: 1, adv: 2 };

class CreditError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

function costOf(model) {
  if (!Object.hasOwn(COST, model)) throw new CreditError('BAD_REQUEST', 'Model terjemahan tidak dikenal', 400);
  return COST[model];
}

// Dipanggil SEBELUM OCR dan Gemini, supaya permintaan yang pasti ditolak tidak membuang waktu dan biaya API.
function checkCredit(user, model) {
  const cost = costOf(model);
  if (model === 'adv' && user.plan !== 'premium') {
    throw new CreditError('PREMIUM_ONLY', 'Model Advanced khusus akun Premium', 403);
  }
  if (user.credit_left < cost) {
    throw new CreditError('NO_CREDIT', 'Credit minggu ini habis. Buka popup Image Translator untuk melihat kapan credit diperbarui.', 402);
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
