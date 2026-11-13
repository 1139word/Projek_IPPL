// Paket credit (UC-07) dan pembeliannya lewat QRIS (UC-08).
// Tidak menulis SQL dan tidak memanggil Midtrans sendiri: keduanya diterima dari luar (deps),
// sehingga bisa diuji dengan pengganti palsu seperti auth.js.
//
// Alur:
// 1. Extension meminta pesanan untuk satu paket -> backend membuat baris orders (pending) dan transaksi QRIS di Midtrans.
// 2. Halaman pembayaran menanyakan status setiap beberapa detik -> backend bertanya ke Midtrans.
// 3. Midtrans menjawab "settlement" (lunas) -> pesanan jadi paid dan credit ditambahkan, dalam satu transaksi database.
// Status yang dikirim extension tidak pernah dipercaya; hanya jawaban Midtrans (NFR-20).

const BAYAR_MENIT = 15; // QR berlaku 15 menit

class PembelianError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

// Paket yang boleh dilihat extension.
function publicPackage(p) {
  return { id: p.id, name: p.name, credits: p.credits, price: p.price };
}

async function daftarPaket({ store }) {
  return (await store.listPackages()).map(publicPackage);
}

// Data pesanan yang boleh dikirim ke extension.
function publicOrder(o) {
  return {
    orderId: o.order_id,
    packageId: o.package_id,
    status: o.status,
    amount: o.amount,
    credits: o.credits,
    expiresAt: new Date(o.expires_at).toISOString(),
    paidAt: o.paid_at ? new Date(o.paid_at).toISOString() : null,
    // Mode Sandbox: alamat QR ikut dikirim agar bisa ditempel di simulator pembayaran Midtrans.
    sandboxQrUrl: process.env.MIDTRANS_PRODUCTION === '1' ? null : o.qr_url || null
  };
}

// Membuat pesanan untuk satu paket, atau memakai ulang pesanan paket yang sama yang masih menunggu
// pembayaran (supaya membuka halaman pembayaran dua kali tidak membuat dua QR).
// Harga dan jumlah credit disalin ke pesanan: bila harga paket diubah kemudian, pesanan lama tidak ikut berubah.
async function buatPesanan(user, packageId, { store, midtrans, now = () => new Date() }) {
  const id = Number(packageId);
  if (!Number.isInteger(id) || id <= 0) throw new PembelianError('BAD_REQUEST', 'Paket credit tidak dipilih', 400);
  const paket = await store.findPackage(id);
  if (!paket) throw new PembelianError('PACKAGE_NOT_FOUND', 'Paket credit tidak ditemukan atau tidak dijual lagi', 404);

  const t = now();
  const lama = await store.findPendingOrder(user.id, paket.id, t);
  if (lama) return lama;

  const order = {
    orderId: `IT-${user.id}-${t.getTime().toString(36)}`, // unik dan pendek (Midtrans maksimal 50 karakter)
    userId: user.id,
    packageId: paket.id,
    amount: paket.price,
    credits: paket.credits,
    expiresAt: new Date(t.getTime() + BAYAR_MENIT * 60 * 1000)
  };
  const qr = await midtrans.chargeQris({ orderId: order.orderId, amount: order.amount, minutes: BAYAR_MENIT });
  return store.insertOrder({ ...order, qrUrl: qr.qrUrl });
}

// Memeriksa satu pesanan milik pengguna ini. Bila Midtrans menyatakan lunas, credit ditambahkan.
async function cekPesanan(user, orderId, { store, midtrans, now = () => new Date() }) {
  const order = await store.findOrder(orderId);
  // Pesanan orang lain diperlakukan sama dengan pesanan yang tidak ada.
  if (!order || order.user_id !== user.id) throw new PembelianError('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan', 404);
  if (order.status !== 'pending') return { order };

  const t = now();
  const hasil = await midtrans.cekStatus(order.order_id);

  if (hasil.status === 'paid') {
    // Jumlah yang dibayar harus sama dengan harga pesanan.
    if (hasil.amount !== order.amount) {
      await store.setOrderStatus(order.order_id, 'failed');
      throw new PembelianError('PAYMENT_MISMATCH', 'Jumlah pembayaran tidak cocok dengan pesanan. Credit tidak ditambahkan.', 409);
    }
    const berhasil = await store.payOrderAndAddCredit(order.order_id, user.id, { credits: order.credits, paidAt: t });
    return { order: await store.findOrder(order.order_id), credited: berhasil };
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

module.exports = { daftarPaket, buatPesanan, cekPesanan, publicOrder, publicPackage, PembelianError, BAYAR_MENIT };
