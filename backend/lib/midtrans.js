// Komunikasi dengan Midtrans (payment gateway) lewat Core API, khusus pembayaran QRIS.
// Hanya backend yang memegang Server Key. Extension tidak pernah menghubungi Midtrans langsung,
// dan status Premium hanya diaktifkan dari jawaban Midtrans yang diminta backend sendiri (NFR-20).
//
// Mode Sandbox (uji coba, tanpa uang sungguhan) dipakai selama MIDTRANS_PRODUCTION bukan "1".

const SANDBOX = 'https://api.sandbox.midtrans.com';
const PRODUCTION = 'https://api.midtrans.com';

class MidtransError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

function konfigurasi() {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) throw new MidtransError('CONFIG', 'MIDTRANS_SERVER_KEY belum diisi di backend/.env', 500);
  return { serverKey, base: process.env.MIDTRANS_PRODUCTION === '1' ? PRODUCTION : SANDBOX };
}

// Midtrans memakai Basic Auth: Server Key sebagai username, password kosong.
async function panggil(method, path, body, { fetchFn = fetch } = {}) {
  const { serverKey, base } = konfigurasi();
  let res;
  try {
    res = await fetchFn(base + path, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(serverKey + ':').toString('base64')
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    throw new MidtransError('PAYMENT_DOWN', 'Tidak bisa menghubungi Midtrans', 502);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || data.status_code === '401') {
    throw new MidtransError('PAYMENT_CONFIG', 'Midtrans menolak Server Key (cek MIDTRANS_SERVER_KEY dan mode Sandbox)', 500);
  }
  return data;
}

// Membuat transaksi QRIS. Hasil: { qrUrl, qrString } atau error bila Midtrans menolak.
async function chargeQris({ orderId, amount, minutes }, opts) {
  const data = await panggil('POST', '/v2/charge', {
    payment_type: 'qris',
    transaction_details: { order_id: orderId, gross_amount: amount },
    qris: { acquirer: 'gopay' },
    custom_expiry: { expiry_duration: minutes, unit: 'minute' }
  }, opts);
  if (data.status_code !== '201') {
    throw new MidtransError('PAYMENT_FAILED', `Midtrans menolak transaksi: ${data.status_message || 'tanpa keterangan'}`, 502);
  }
  const qr = (data.actions || []).find((a) => a.name === 'generate-qr-code');
  return { qrUrl: qr ? qr.url : null, qrString: data.qr_string || null };
}

// Menanyakan status transaksi ke Midtrans. Hasil: { status, amount } dengan status salah satu:
// 'paid' | 'pending' | 'expired' | 'failed' | 'notfound'.
async function cekStatus(orderId, opts) {
  const data = await panggil('GET', `/v2/${encodeURIComponent(orderId)}/status`, null, opts);
  if (data.status_code === '404') return { status: 'notfound', amount: null };
  const s = data.transaction_status;
  const status = s === 'settlement' || (s === 'capture' && data.fraud_status !== 'deny') ? 'paid'
    : s === 'pending' ? 'pending'
    : s === 'expire' ? 'expired'
    : 'failed'; // cancel, deny, failure, refund, dll.
  return { status, amount: Number(data.gross_amount) };
}

// Gambar QR (PNG) dari Midtrans, diteruskan backend ke halaman pembayaran.
async function ambilGambarQr(url, { fetchFn = fetch } = {}) {
  const { base } = konfigurasi();
  if (!String(url).startsWith(base + '/')) throw new MidtransError('BAD_QR', 'Alamat QR tidak dikenal', 400);
  const res = await fetchFn(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new MidtransError('PAYMENT_DOWN', 'Gambar QR tidak bisa diambil dari Midtrans', 502);
  return { type: res.headers.get('content-type') || 'image/png', bytes: Buffer.from(await res.arrayBuffer()) };
}

module.exports = { chargeQris, cekStatus, ambilGambarQr, MidtransError, SANDBOX };
