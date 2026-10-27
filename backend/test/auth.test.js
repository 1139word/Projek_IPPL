// Tes logika akun tanpa MySQL dan tanpa Google: keduanya diganti versi palsu di memori.
// Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const { loginWithGoogle, userFromSession, logout, hashToken, WEEK_MS, SESSION_MS } = require('../lib/auth');

// Penyimpanan palsu dengan method yang sama seperti lib/auth-store.js.
function storePalsu() {
  const users = [];
  const sessions = new Map();
  return {
    users, sessions,
    async findUserByGoogleSub(sub) { return users.find((u) => u.google_sub === sub) || null; },
    async insertUser(d) {
      const u = { id: users.length + 1, google_sub: d.googleSub, email: d.email, picture_url: d.pictureUrl,
        plan: 'free', credit_left: d.creditLeft, credit_reset_at: d.creditResetAt };
      users.push(u);
      return { ...u };
    },
    async updateProfile(id, d) { Object.assign(users.find((u) => u.id === id), { email: d.email, picture_url: d.pictureUrl }); },
    async resetCredit(id, d) {
      const u = users.find((x) => x.id === id);
      if (u.credit_reset_at.getTime() !== new Date(d.oldResetAt).getTime()) return false;
      Object.assign(u, { credit_left: d.creditLeft, credit_reset_at: d.creditResetAt });
      return true;
    },
    async insertSession(s) { sessions.set(s.tokenHash, s); },
    async findSession(h) {
      const s = sessions.get(h);
      if (!s) return null;
      return { session_expires_at: s.expiresAt, ...users.find((u) => u.id === s.userId) };
    },
    async deleteSession(h) { sessions.delete(h); }
  };
}

const googlePalsu = async (token) => {
  if (token !== 'token-google-sah') throw Object.assign(new Error('Token Google tidak sah'), { code: 'GOOGLE_TOKEN_INVALID' });
  return { sub: 'g-123', email: 'atha@example.com', picture: 'https://foto/1.png' };
};

function jam(mulai) {
  let t = new Date(mulai).getTime();
  return { now: () => new Date(t), maju: (ms) => { t += ms; } };
}

test('login pertama membuat akun Free dengan 10 credit dan token sesi', async () => {
  const store = storePalsu();
  const { token, user } = await loginWithGoogle('token-google-sah', { store, verifyGoogleToken: googlePalsu });
  assert.strictEqual(store.users.length, 1);
  assert.strictEqual(user.plan, 'free');
  assert.strictEqual(user.credit.left, 10);
  assert.strictEqual(user.picture, 'https://foto/1.png');
  assert.ok(token.length >= 40);
  // Yang tersimpan hanya hash, bukan token aslinya.
  assert.ok(store.sessions.has(hashToken(token)));
  assert.ok(!store.sessions.has(token));
});

test('login kedua dengan akun Google yang sama tidak membuat akun baru', async () => {
  const store = storePalsu();
  const deps = { store, verifyGoogleToken: googlePalsu };
  const a = await loginWithGoogle('token-google-sah', deps);
  const b = await loginWithGoogle('token-google-sah', deps);
  assert.strictEqual(store.users.length, 1);
  assert.strictEqual(store.sessions.size, 2); // dua perangkat, dua sesi
  assert.notStrictEqual(a.token, b.token);
});

test('token Google yang ditolak tidak membuat akun', async () => {
  const store = storePalsu();
  await assert.rejects(loginWithGoogle('token-palsu', { store, verifyGoogleToken: googlePalsu }), { code: 'GOOGLE_TOKEN_INVALID' });
  assert.strictEqual(store.users.length, 0);
});

test('token sesi yang benar mengembalikan pengguna, token asal tidak', async () => {
  const store = storePalsu();
  const { token } = await loginWithGoogle('token-google-sah', { store, verifyGoogleToken: googlePalsu });
  assert.strictEqual((await userFromSession(token, { store })).email, 'atha@example.com');
  assert.strictEqual(await userFromSession('token-asal', { store }), null);
  assert.strictEqual(await userFromSession(undefined, { store }), null);
});

test('sesi lewat 30 hari ditolak dan dihapus', async () => {
  const store = storePalsu();
  const j = jam('2026-10-27T00:00:00Z');
  const { token } = await loginWithGoogle('token-google-sah', { store, verifyGoogleToken: googlePalsu, now: j.now });
  j.maju(SESSION_MS + 1000);
  assert.strictEqual(await userFromSession(token, { store, now: j.now }), null);
  assert.strictEqual(store.sessions.size, 0);
});

test('logout menghapus sesi', async () => {
  const store = storePalsu();
  const { token } = await loginWithGoogle('token-google-sah', { store, verifyGoogleToken: googlePalsu });
  await logout(token, { store });
  assert.strictEqual(await userFromSession(token, { store }), null);
});

test('credit kembali ke kuota setelah seminggu, tidak terakumulasi', async () => {
  const store = storePalsu();
  const j = jam('2026-10-27T00:00:00Z');
  const { token } = await loginWithGoogle('token-google-sah', { store, verifyGoogleToken: googlePalsu, now: j.now });
  store.users[0].credit_left = 3; // anggap sudah terpakai 7

  j.maju(WEEK_MS - 1000); // belum seminggu
  assert.strictEqual((await userFromSession(token, { store, now: j.now })).credit_left, 3);

  j.maju(2000); // lewat seminggu
  const u = await userFromSession(token, { store, now: j.now });
  assert.strictEqual(u.credit_left, 10); // kembali ke 10, bukan 3 + 10
  assert.strictEqual(new Date(u.credit_reset_at).getTime(), j.now().getTime() + WEEK_MS);
});
