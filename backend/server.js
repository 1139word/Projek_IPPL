// Backend Image Translator: endpoint penerjemahan, akun (login Google), dan credit per akun.
// dan pembelian Premium lewat QRIS Midtrans.
//
// Menjalankan:  npm start   (membaca konfigurasi dari file .env)

const express = require('express');
const { translateImage } = require('./lib/pipeline');
const { loginWithGoogle, userFromSession, logout, publicUser } = require('./lib/auth');
const { userStore } = require('./lib/auth-store');
const { verifyGoogleToken } = require('./lib/google');
const { checkCredit, chargeCredit } = require('./lib/credit');
const { infoPaket } = require('./lib/paket');
const { buatPesanan, cekPesanan, publicOrder } = require('./lib/premium');
const { orderStore } = require('./lib/order-store');
const midtrans = require('./lib/midtrans');

const app = express();
app.use(express.json({ limit: '25mb' })); // gambar dikirim sebagai base64, jadi ukurannya bisa besar

// Izinkan dipanggil dari extension.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ---- Akun ----

// Header "Authorization: Bearer <token sesi>" -> token sesi.
function bearerToken(req) {
  const h = req.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function kirimGagal(res, e) {
  // Error MySQL (misalnya server mati) tidak membawa status sendiri.
  const dariDb = typeof e.code === 'string' && (e.code.startsWith('ER_') || e.code === 'ECONNREFUSED');
  const code = dariDb ? 'DB_ERROR' : e.code || 'ERROR';
  const message = dariDb ? 'Database tidak bisa diakses (cek MySQL dan backend/.env)' : e.message;
  console.log(`GAGAL [${code}] ${e.message}`);
  res.status(e.status || 500).json({ code, message });
}

// Middleware: hanya meneruskan permintaan yang membawa token sesi sah. Pengguna disimpan di req.user
// (credit-nya sudah diisi ulang bila sudah lewat seminggu).
async function requireLogin(req, res, next) {
  try {
    const user = await userFromSession(bearerToken(req), { store: userStore });
    if (!user) return res.status(401).json({ code: 'NOT_LOGGED_IN', message: 'Silakan login dengan akun Google' });
    req.user = user;
    next();
  } catch (e) {
    kirimGagal(res, e);
  }
}

// UC-10 Login (UC-09 Registrasi otomatis pada login pertama).
app.post('/api/auth/google', async (req, res) => {
  try {
    const hasil = await loginWithGoogle((req.body || {}).accessToken, { store: userStore, verifyGoogleToken });
    console.log(`LOGIN ${hasil.user.email}`);
    res.json(hasil);
  } catch (e) {
    kirimGagal(res, e);
  }
});

// UC-02 Melihat credit: data akun untuk popup.
// Bila ada pesanan Premium yang belum selesai, statusnya dicek dulu. Jadi pengguna yang sudah membayar
// tetapi menutup halaman pembayaran terlalu cepat tetap mendapat Premium saat membuka popup.
app.get('/api/me', requireLogin, async (req, res) => {
  let user = req.user;
  try {
    const pending = await orderStore.findLatestPending(user.id);
    if (pending) {
      const { order, activated } = await cekPesanan(user, pending.order_id, depsPremium);
      if (activated) {
        console.log(`PREMIUM AKTIF ${user.email} (pesanan ${order.order_id}, dicek dari popup)`);
        user = await userFromSession(bearerToken(req), { store: userStore });
      }
    }
  } catch (e) {
    console.log(`Cek pesanan gagal: ${e.message}`); // popup tetap mendapat data akun
  }
  res.json(publicUser(user));
});

// UC-07 Melihat Paket Premium: harga, kuota, dan fitur tiap paket. Tidak perlu login.
app.get('/api/plans', (req, res) => res.json(infoPaket()));

app.post('/api/auth/logout', async (req, res) => {
  try {
    await logout(bearerToken(req), { store: userStore });
    res.json({ ok: true });
  } catch (e) {
    kirimGagal(res, e);
  }
});

// ---- Premium (UC-08) ----
const depsPremium = { store: orderStore, midtrans };

// Membuat pesanan QRIS (atau memakai pesanan yang masih menunggu pembayaran).
app.post('/api/orders', requireLogin, async (req, res) => {
  try {
    const order = await buatPesanan(req.user, depsPremium);
    console.log(`PESANAN ${order.order_id} ${req.user.email} Rp ${order.amount}`);
    res.json(publicOrder(order));
  } catch (e) {
    kirimGagal(res, e);
  }
});

// Status pesanan. Backend bertanya langsung ke Midtrans; bila lunas, Premium diaktifkan di sini.
app.get('/api/orders/:id', requireLogin, async (req, res) => {
  try {
    const { order, activated } = await cekPesanan(req.user, req.params.id, depsPremium);
    if (activated) console.log(`PREMIUM AKTIF ${req.user.email} (pesanan ${order.order_id})`);
    const user = activated ? await userFromSession(bearerToken(req), { store: userStore }) : req.user;
    res.json({ order: publicOrder(order), user: publicUser(user) });
  } catch (e) {
    kirimGagal(res, e);
  }
});

// Gambar QR pesanan. Diambil backend dari Midtrans lalu diteruskan, supaya extension
// tidak perlu menghubungi Midtrans sendiri.
app.get('/api/orders/:id/qr', requireLogin, async (req, res) => {
  try {
    const order = await orderStore.findOrder(req.params.id);
    if (!order || order.user_id !== req.user.id || !order.qr_url) return res.status(404).json({ code: 'ORDER_NOT_FOUND', message: 'Pesanan tidak ditemukan' });
    const qr = await midtrans.ambilGambarQr(order.qr_url);
    res.set('Content-Type', qr.type).set('Cache-Control', 'no-store').send(qr.bytes);
  } catch (e) {
    kirimGagal(res, e);
  }
});

// ---- Penerjemahan (UC-01) ----

// Wajib login. Credit dicek sebelum OCR, lalu dipotong hanya bila terjemahan berhasil.
app.post('/api/translate', requireLogin, async (req, res) => {
  const { image, src, tgt, model = 'std', source = 'page' } = req.body || {};
  try {
    checkCredit(req.user, model, { source });
    const result = await translateImage({ image, src, tgt, model });
    const user = await chargeCredit(req.user, model, { store: userStore });
    const m = result.meta;
    console.log(`OK  ${m.balloons} balon (sfx ${m.sfx}, watermark ${m.watermark}) | OCR ${m.ocrMs} ms (proses ${m.ocrProcessMs ?? '?'} ms) | Gemini ${m.translateMs} ms | ${model}->${tgt}${source === 'explorer' ? ' (Explorer)' : ''} | ${user.email} sisa ${user.credit_left}`);
    // LOG_DETAIL=1 di .env: tampilkan setiap balon (jenis, teks hasil OCR, terjemahan) untuk diagnosis.
    if (process.env.LOG_DETAIL === '1') {
      for (const r of result.regions) console.log(`    [${r.type}] ${r.original}  =>  ${r.text}`);
    }
    // Sisa credit ikut dikirim supaya popup langsung diperbarui tanpa memanggil /api/me.
    res.json({ ...result, credit: publicUser(user).credit });
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
  if (!process.env.MIDTRANS_SERVER_KEY) console.log('Catatan: MIDTRANS_SERVER_KEY belum diisi di .env (pembelian Premium belum bisa dipakai)');
  if (!process.env.GOOGLE_CLIENT_ID) console.log('Peringatan: GOOGLE_CLIENT_ID belum diisi di .env (login Google belum bisa dipakai)');
});
