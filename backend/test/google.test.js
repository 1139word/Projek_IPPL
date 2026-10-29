// Tes pemeriksaan token Google tanpa internet: fetch diganti fungsi palsu.
// Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const { verifyGoogleToken } = require('../lib/google');

const CLIENT_ID = 'client-kita.apps.googleusercontent.com';

// Google palsu: menjawab tokeninfo dan userinfo sesuai skenario.
function fetchPalsu({ aud = CLIENT_ID, tokenSah = true, sub = 'g-1', email = 'a@example.com' } = {}) {
  const jawab = (status, body) => ({ ok: status < 400, status, json: async () => body });
  return async (url) => {
    if (!tokenSah) return jawab(400, { error: 'invalid_token' });
    if (url.includes('tokeninfo')) return jawab(200, { aud, sub, scope: 'openid email profile' });
    return jawab(200, { sub, email, picture: 'https://foto/a.png' });
  };
}

test('token sah untuk Client ID kita menghasilkan profil', async () => {
  const p = await verifyGoogleToken('tok', { fetchFn: fetchPalsu(), clientId: CLIENT_ID });
  assert.deepStrictEqual(p, { sub: 'g-1', email: 'a@example.com', picture: 'https://foto/a.png' });
});

test('token untuk aplikasi lain ditolak', async () => {
  await assert.rejects(
    verifyGoogleToken('tok', { fetchFn: fetchPalsu({ aud: 'aplikasi-lain' }), clientId: CLIENT_ID }),
    { code: 'GOOGLE_WRONG_CLIENT', status: 401 }
  );
});

test('token kedaluwarsa atau palsu ditolak', async () => {
  await assert.rejects(
    verifyGoogleToken('tok', { fetchFn: fetchPalsu({ tokenSah: false }), clientId: CLIENT_ID }),
    { code: 'GOOGLE_TOKEN_INVALID' }
  );
});

test('Google tidak bisa dihubungi menghasilkan GOOGLE_DOWN', async () => {
  const putus = async () => { throw new Error('ENOTFOUND'); };
  await assert.rejects(verifyGoogleToken('tok', { fetchFn: putus, clientId: CLIENT_ID }), { code: 'GOOGLE_DOWN', status: 502 });
});

test('GOOGLE_CLIENT_ID kosong memberi pesan pengaturan yang jelas', async () => {
  await assert.rejects(verifyGoogleToken('tok', { fetchFn: fetchPalsu(), clientId: '' }), { code: 'CONFIG' });
});
