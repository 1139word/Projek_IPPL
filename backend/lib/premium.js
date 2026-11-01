// Berlangganan Premium (UC-08): membuat pesanan QRIS dan memeriksa pembayarannya.
// Tidak menulis SQL dan tidak memanggil Midtrans sendiri: keduanya diterima dari luar (deps),
// sehingga bisa diuji dengan pengganti palsu seperti auth.js.
//
// Alur:
// 1. Extension meminta pesanan baru -> backend membuat baris orders (pending) dan transaksi QRIS di Midtrans.
// 2. Halaman pembayaran menanyakan status setiap beberapa detik -> backend bertanya ke Midtrans.
// 3. Midtrans menjawab "settlement" (lunas) -> pesanan jadi paid dan Premium diaktifkan, dalam satu transaksi database.
// Status yang dikirim extension tidak pernah dipercaya; hanya jawaban Midtrans (NFR-20).

const { quotaFor, WEEK_MS } = require('./auth');
const { premiumDays, premiumPrice } = require('./paket');

const BAYAR_MENIT = 15; // QR berlaku 15 menit (sesuai timer di rancangan)
const DAY_MS = 24 * 60 * 60 * 1000;

class PremiumError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

// Data pesanan yang boleh dikirim ke extension.
function publicOrder(o) {
  return {
    orderId: o.order_id,
    status: o.status,
    amount: o.amount,
    days: o.days,
    expiresAt: new Date(o.expires_at).toISOString(),
    paidAt: o.paid_at ? new Date(o.paid_at).toISOString() : null,
    // Mode Sandbox: alamat QR ikut dikirim agar bisa ditempel di simulator pembayaran Midtrans.
    sandboxQrUrl: process.env.MIDTRANS_PRODUCTION === '1' ? null : o.qr_url || null
  };
}

// Membuat pesanan, atau memakai ulang pesanan yang masih menunggu pembayaran
// (supaya membuka halaman pembayaran dua kali tidak membuat dua QR).
async function buatPesanan(user, { store, midtrans, now = () => new Date() }) {
  if (user.plan === 'premium') {
    throw new PremiumError('ALREADY_PREMIUM', 'Premium Anda masih aktif. Paket bisa dibeli lagi setelah masa aktif berakhir.', 409);
  }
  const t = now();
  const lama = await store.findPendingOrder(user.id, t);
  if (lama) return lama;

  const order = {
    orderId: `IT-${user.id}-${t.getTime().toString(36)}`, // unik dan pendek (Midtrans maksimal 50 karakter)
    userId: user.id,
    amount: premiumPrice(),
    days: premiumDays(),
    expiresAt: new Date(t.getTime() + BAYAR_MENIT * 60 * 1000)
  };
  const qr = await midtrans.chargeQris({ orderId: order.orderId, amount: order.amount, minutes: BAYAR_MENIT });
  return store.insertOrder({ ...order, qrUrl: qr.qrUrl });
}

// Memeriksa satu pesanan milik pengguna ini. Bila Midtrans menyatakan lunas, Premium diaktifkan.
async function cekPesanan(user, orderId, { store, midtrans, now = () => new Date() }) {
  const order = await store.findOrder(orderId);
  // Pesanan orang lain diperlakukan sama dengan pesanan yang tidak ada.
  if (!order || order.user_id !== user.id) throw new PremiumError('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan', 404);
  if (order.status !== 'pending') return { order };

  const t = now();
  const hasil = await midtrans.cekStatus(order.order_id);

  if (hasil.status === 'paid') {
    // A3: jumlah yang dibayar harus sama dengan harga pesanan.
    if (hasil.amount !== order.amount) {
      await store.setOrderStatus(order.order_id, 'failed');
      throw new PremiumError('PAYMENT_MISMATCH', 'Jumlah pembayaran tidak cocok dengan pesanan. Premium tidak diaktifkan.', 409);
    }
    // Premium berlaku sejak sekarang (atau diperpanjang dari tanggal lama bila masih aktif).
    const dasar = user.plan === 'premium' && user.premium_until && new Date(user.premium_until) > t ? new Date(user.premium_until) : t;
    const aktif = {
      premiumUntil: new Date(dasar.getTime() + order.days * DAY_MS),
      creditLeft: quotaFor('premium'),
      creditResetAt: new Date(t.getTime() + WEEK_MS)
    };
    const berhasil = await store.payOrderAndActivate(order.order_id, user.id, { ...aktif, paidAt: t });
    return { order: await store.findOrder(order.order_id), activated: berhasil };
  }
  if (hasil.status === 'expired' || hasil.status === 'failed') {
    await store.setOrderStatus(order.order_id, hasil.status);
    return { order: { ...order, status: hasil.status } };
  }
  // Masih pending (atau belum tercatat di Midtrans). Lewat batas waktu = kedaluwarsa.
  if (t >= new Date(order.expires_at)) {
    await store.setOrderStatus(order.order_id, 'expired');
    return { order: { ...order, status: 'expired' } };
  }
  return { order };
}

module.exports = { buatPesanan, cekPesanan, publicOrder, PremiumError, BAYAR_MENIT };
