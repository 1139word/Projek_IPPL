// Logika akun: login Google (membuat akun bila belum ada), sesi, logout, reset credit mingguan,
// dan berakhirnya Premium.
// Tidak memanggil Google dan tidak menulis SQL. Keduanya diterima dari luar (deps),
// sehingga bisa diuji dengan pengganti palsu seperti pipeline.js.

const crypto = require('node:crypto');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

class AuthError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

function quotaFor(plan) {
  return plan === 'premium'
    ? Number(process.env.CREDIT_QUOTA_PREMIUM) || 100
    : Number(process.env.CREDIT_QUOTA_FREE) || 10;
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
    plan: user.plan,
    // Tanggal berakhirnya Premium (teks ISO), atau null untuk akun Free.
    premiumUntil: user.plan === 'premium' && user.premium_until ? new Date(user.premium_until).toISOString() : null,
    credit: { left: user.credit_left, quota: quotaFor(user.plan), resetAt: new Date(user.credit_reset_at).toISOString() }
  };
}

// Premium berakhir "malas", sama seperti reset credit: dicek setiap kali data akun dibaca.
// Bila premium_until sudah lewat, akun kembali Free. Sisa credit dipotong ke kuota Free supaya
// pengguna yang baru selesai Premium tidak membawa sisa 100 credit ke paket Free.
async function refreshPlan(user, { store, now }) {
  if (user.plan !== 'premium') return user;
  if (user.premium_until && now() < new Date(user.premium_until)) return user;
  const creditLeft = Math.min(user.credit_left, quotaFor('free'));
  await store.endPremium(user.id, { creditLeft });
  return { ...user, plan: 'free', premium_until: null, credit_left: creditLeft };
}

// Reset "malas": dicek setiap kali credit dibaca. Credit dikembalikan ke kuota, tidak ditambah.
async function refreshCredit(user, { store, now }) {
  const t = now();
  if (t < new Date(user.credit_reset_at)) return user;
  const baru = { creditLeft: quotaFor(user.plan), creditResetAt: new Date(t.getTime() + WEEK_MS) };
  await store.resetCredit(user.id, { ...baru, oldResetAt: user.credit_reset_at });
  return { ...user, credit_left: baru.creditLeft, credit_reset_at: baru.creditResetAt };
}

// UC-10 Login (dan UC-09 Registrasi otomatis pada login pertama).
async function loginWithGoogle(accessToken, deps) {
  const { store, verifyGoogleToken, now = () => new Date() } = deps;
  if (!accessToken || typeof accessToken !== 'string') throw new AuthError('BAD_REQUEST', 'Token Google tidak dikirim', 400);

  const profile = await verifyGoogleToken(accessToken); // { sub, email, picture }
  let user = await store.findUserByGoogleSub(profile.sub);
  if (!user) {
    user = await store.insertUser({
      googleSub: profile.sub,
      email: profile.email,
      pictureUrl: profile.picture || null,
      creditLeft: quotaFor('free'),
      creditResetAt: new Date(now().getTime() + WEEK_MS)
    });
  } else if (user.email !== profile.email || user.picture_url !== (profile.picture || null)) {
    // Pemilik akun Google bisa mengganti email atau foto; kita ikuti.
    await store.updateProfile(user.id, { email: profile.email, pictureUrl: profile.picture || null });
    user = { ...user, email: profile.email, picture_url: profile.picture || null };
  }
  user = await refreshCredit(await refreshPlan(user, { store, now }), { store, now });

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
  return refreshCredit(await refreshPlan(row, { store, now }), { store, now });
}

async function logout(token, { store }) {
  if (token) await store.deleteSession(hashToken(token));
}

module.exports = { loginWithGoogle, userFromSession, logout, publicUser, refreshPlan, hashToken, quotaFor, AuthError, WEEK_MS, SESSION_MS };
