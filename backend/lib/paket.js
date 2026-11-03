// Informasi paket Free dan Premium (UC-07 Melihat Paket Premium).
// Angka-angkanya dibaca dari .env, jadi harga dan kuota bisa diubah tanpa mengubah kode.

const { quotaFor } = require('./auth');
const { COST } = require('./credit');

function premiumDays() {
  return Number(process.env.PREMIUM_DAYS) || 30;
}

function premiumPrice() {
  return Number(process.env.PREMIUM_PRICE) || 30000;
}

// Data yang ditampilkan popup. Daftar fitur ditulis di sini supaya popup dan halaman pembayaran
// menampilkan isi paket yang sama.
function infoPaket() {
  return {
    free: {
      price: 0,
      quota: quotaFor('free'),
      features: ['Gemini Standar', 'Terjemahan di halaman komik']
    },
    premium: {
      price: premiumPrice(),
      days: premiumDays(),
      quota: quotaFor('premium'),
      features: [`Gemini Standar dan Advanced (${COST.adv} credit per gambar)`, 'Terjemahkan gambar dari File Explorer']
    }
  };
}

module.exports = { infoPaket, premiumDays, premiumPrice };
