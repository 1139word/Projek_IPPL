// Logika akun: login Google (membuat akun bila belum ada), sesi, dan logout.
// Tidak memanggil Google dan tidak menulis SQL. Keduanya diterima dari luar (deps),
// sehingga bisa diuji dengan pengganti palsu seperti pipeline.js.
//
// Tidak ada status Free atau Premium dan tidak ada reset mingguan: setiap akun hanya punya saldo credit.
// Saldo bertambah saat membeli paket (lib/pembelian.js) dan berkurang saat menerjemahkan (lib/credit.js).

const crypto = require('node:crypto');

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

class AuthError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

// Credit yang diterima akun baru, sekali saja saat akun dibuat (FR registrasi: 10 credit awal).
function starterCredit() {
  const n = Number(process.env.CREDIT_AWAL);
  return Number.isInteger(n) && n >= 0 ? n : 10;
}

// Token disimpan sebagai hash: kalau isi database bocor, token aslinya tetap tidak diketahui.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Data yang boleh dikirim ke extension. Kolom internal (id, google_sub) tidak ikut.
function publicUser(user) {
  return {
    email: user.email,
    picture: user.picture_url,
    credit: { left: user.credit_left }
  };
}

// UC-10 Login (dan UC-09 Registrasi otomatis pada login pertama).
async function loginWithGoogle(accessToken, deps) {
  const { store, verifyGoogleToken, now = () => new Date() } = deps;
  if (!accessToken || typeof accessToken !== 'string') throw new AuthError('BAD_REQUEST', 'Token Google tidak dikirim', 400);

  const profile = await verifyGoogleToken(accessToken); // { sub, email, picture }
  let user = await store.findUserByGoogleSub(profile.sub);
  if (!user) {
    // Registrasi: credit awal hanya diberikan di sini. Login berikutnya tidak menambah credit.
    user = await store.insertUser({
      googleSub: profile.sub,
      email: profile.email,
      pictureUrl: profile.picture || null,
      creditLeft: starterCredit()
    });
  } else if (user.email !== profile.email || user.picture_url !== (profile.picture || null)) {
    // Pemilik akun Google bisa mengganti email atau foto; kita ikuti.
    await store.updateProfile(user.id, { email: profile.email, pictureUrl: profile.picture || null });
    user = { ...user, email: profile.email, picture_url: profile.picture || null };
  }

  // 32 byte acak = 256 bit, ditulis sebagai teks base64url agar aman dikirim di header.
  const token = crypto.randomBytes(32).toString('base64url');
  await store.insertSession({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(now().getTime() + SESSION_MS) });
  return { token, user: publicUser(user) };
}

// Dipakai middleware: token sesi -> data pengguna, atau null bila tidak sah.
async function userFromSession(token, deps) {
  const { store, now = () => new Date() } = deps;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = await store.findSession(tokenHash);
  if (!row) return null;
  if (now() >= new Date(row.session_expires_at)) {
    await store.deleteSession(tokenHash); // sesi kedaluwarsa dibersihkan
    return null;
  }
  return row;
}

async function logout(token, { store }) {
  if (token) await store.deleteSession(hashToken(token));
}

module.exports = { loginWithGoogle, userFromSession, logout, publicUser, hashToken, starterCredit, AuthError, SESSION_MS };
