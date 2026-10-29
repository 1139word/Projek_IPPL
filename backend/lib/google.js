// Memeriksa access token Google yang dikirim extension (dari chrome.identity.getAuthToken).
// Hanya file ini yang diganti bila nanti pindah ke launchWebAuthFlow (ID token OpenID).

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

class GoogleError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

async function verifyGoogleToken(accessToken, { fetchFn = fetch, clientId = process.env.GOOGLE_CLIENT_ID } = {}) {
  if (!clientId) throw new GoogleError('CONFIG', 'GOOGLE_CLIENT_ID belum diisi di backend/.env', 500);

  // 1) Token ini sah dan dibuat untuk aplikasi kita?
  //    Tanpa cek aud, token yang diberikan Google ke aplikasi lain bisa dipakai masuk ke aplikasi kita.
  const info = await ambilJson(fetchFn, `${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`);
  if (!info.ok) throw new GoogleError('GOOGLE_TOKEN_INVALID', 'Token Google tidak sah atau sudah kedaluwarsa', 401);
  if (info.body.aud !== clientId) throw new GoogleError('GOOGLE_WRONG_CLIENT', 'Token Google bukan untuk aplikasi ini', 401);

  // 2) Milik siapa? sub = ID akun Google yang tidak berubah.
  const user = await ambilJson(fetchFn, USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!user.ok) throw new GoogleError('GOOGLE_TOKEN_INVALID', 'Profil Google tidak bisa dibaca dengan token ini', 401);
  if (!user.body.sub || user.body.sub !== info.body.sub) throw new GoogleError('GOOGLE_TOKEN_INVALID', 'Data token Google tidak cocok', 401);
  if (!user.body.email) throw new GoogleError('GOOGLE_NO_EMAIL', 'Izin email belum diberikan saat login Google', 401);

  return { sub: user.body.sub, email: user.body.email, picture: user.body.picture || null };
}

async function ambilJson(fetchFn, url, options = {}) {
  let res;
  try {
    res = await fetchFn(url, { ...options, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new GoogleError('GOOGLE_DOWN', 'Tidak bisa menghubungi server Google', 502);
  }
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

module.exports = { verifyGoogleToken, GoogleError };
