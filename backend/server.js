// Backend Image Translator: endpoint penerjemahan, akun (login Google), dan credit per akun.
// Pembayaran Premium menyusul di tahap berikutnya.
//
// Menjalankan:  npm start   (membaca konfigurasi dari file .env)

const express = require('express');
const { translateImage } = require('./lib/pipeline');
const { loginWithGoogle, userFromSession, logout, publicUser } = require('./lib/auth');
const { userStore } = require('./lib/auth-store');
const { verifyGoogleToken } = require('./lib/google');
const { checkCredit, chargeCredit } = require('./lib/credit');

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
app.get('/api/me', requireLogin, (req, res) => res.json(publicUser(req.user)));

app.post('/api/auth/logout', async (req, res) => {
  try {
    await logout(bearerToken(req), { store: userStore });
    res.json({ ok: true });
  } catch (e) {
    kirimGagal(res, e);
  }
});

// ---- Penerjemahan (UC-01) ----

// Wajib login. Credit dicek sebelum OCR, lalu dipotong hanya bila terjemahan berhasil.
app.post('/api/translate', requireLogin, async (req, res) => {
  const { image, src, tgt, model = 'std' } = req.body || {};
  try {
    checkCredit(req.user, model);
    const result = await translateImage({ image, src, tgt, model });
    const user = await chargeCredit(req.user, model, { store: userStore });
    const m = result.meta;
    console.log(`OK  ${m.balloons} balon | OCR ${m.ocrMs} ms (proses ${m.ocrProcessMs ?? '?'} ms) | Gemini ${m.translateMs} ms | ${model}->${tgt} | ${user.email} sisa ${user.credit_left}`);
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
  if (!process.env.GOOGLE_CLIENT_ID) console.log('Peringatan: GOOGLE_CLIENT_ID belum diisi di .env (login Google belum bisa dipakai)');
});
