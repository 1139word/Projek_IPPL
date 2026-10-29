// Service worker: menjadi perantara antara content script dan backend.
// MOCK = true berarti tidak memanggil backend; hasil berupa contoh agar alur UI bisa dicoba tanpa server.
// MOCK = false: gambar dikirim ke backend (folder backend/) untuk OCR + Gemini.
const MOCK = false;
const API_BASE = 'http://localhost:3000';
const API_URL = API_BASE + '/api/translate';

const DEFAULTS = { src: 'auto', tgt: 'en', model: 'std' };

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

async function imageToBase64(url) {
  // Alamat blob: hanya bisa dibaca oleh halaman yang membuatnya (misalnya MANGA Plus).
  // Langsung tolak tanpa fetch, supaya Chrome tidak mencatatnya sebagai error extension;
  // content script lalu memakai cara cadangan (potret layar).
  if (!url || url.startsWith('blob:')) throw new Error('Alamat gambar tidak bisa diunduh dari extension');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Gambar tidak bisa diunduh');
  const buf = await res.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function mockResult(settings) {
  // box = [x, y, lebar, tinggi] dalam pecahan 0..1 dari ukuran gambar
  return {
    regions: [
      { box: [0.08, 0.06, 0.32, 0.1], text: '[Contoh] Teks terjemahan 1' },
      { box: [0.55, 0.3, 0.34, 0.12], text: '[Contoh] Teks terjemahan 2' },
      { box: [0.12, 0.72, 0.4, 0.1], text: '[Contoh] Teks terjemahan 3' }
    ],
    meta: { tgt: settings.tgt, model: settings.model }
  };
}

function bufferToBase64(buf) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// Cara cadangan: potret tab yang sedang tampil, lalu potong bagian tempat gambar berada.
// Dipakai bila gambar tidak bisa diunduh ulang (Pixiv menolak tanpa Referer, MANGA Plus memakai gambar terenkripsi/blob).
// rect = bagian gambar yang terlihat dalam piksel CSS; dpr = devicePixelRatio halaman.
async function captureCrop(windowId, rect, dpr) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const sx = Math.max(0, Math.round(rect.l * dpr));
  const sy = Math.max(0, Math.round(rect.t * dpr));
  const sw = Math.min(bmp.width - sx, Math.round((rect.r - rect.l) * dpr));
  const sh = Math.min(bmp.height - sy, Math.round((rect.b - rect.t) * dpr));
  if (sw < 16 || sh < 16) throw new Error('Area gambar terlalu kecil');
  // Gambar kecil diperbesar (maks 2x) agar huruf cukup besar untuk dibaca OCR.
  const scale = Math.min(2, Math.max(1, 1400 / Math.max(sw, sh)));
  const canvas = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return bufferToBase64(await blob.arrayBuffer());
}

const PESAN_LOGIN = 'Silakan masuk dulu: klik ikon Image Translator di toolbar, lalu "Masuk dengan Google".';

// Credit dicek dan dipotong oleh server (per akun, di MySQL), bukan di browser,
// karena data di browser bisa diubah sendiri oleh pengguna.
async function sendToBackend(image, session) {
  const settings = await getSettings();
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token },
      body: JSON.stringify({ image, src: settings.src, tgt: settings.tgt, model: settings.model })
    });
    const data = await res.json();
    if (res.status === 401) {
      // Sesi kedaluwarsa atau sudah dihapus di server: anggap keluar.
      await chrome.storage.local.remove('session');
      return { ok: false, code: 'NOT_LOGGED_IN', message: PESAN_LOGIN };
    }
    if (!res.ok) return { ok: false, code: data.code || 'ERROR', message: data.message || 'Terjemahan gagal' };
    // Simpan sisa credit terbaru; popup yang sedang terbuka ikut berubah lewat storage.onChanged.
    // Dibaca ulang dulu: kalau pengguna keluar selama proses, sesinya jangan dihidupkan lagi.
    const kini = await getSession();
    if (data.credit && kini && kini.token === session.token) {
      await chrome.storage.local.set({ session: { ...kini, user: { ...kini.user, credit: data.credit } } });
    }
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: 'Server belum berjalan. Jalankan backend (npm start) dan layanan OCR.' };
  }
}

// ---- Akun Google (UC-09 Registrasi otomatis, UC-10 Login) ----
// Alur: Chrome memberi token Google -> backend memeriksanya ke Google -> backend membuat akun bila
// belum ada dan memberi token sesi miliknya sendiri. Yang disimpan hanya token sesi
// (chrome.storage.local, kunci 'session'). Token Google tidak disimpan karena hanya dipakai sekali.
// Login dijalankan di sini, bukan di popup: saat jendela Google muncul, popup kehilangan fokus dan
// langsung tertutup, sehingga proses yang berjalan di popup ikut terhenti.

async function callApi(method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function getSession() {
  const { session } = await chrome.storage.local.get('session');
  return session || null;
}

async function googleToken(interactive) {
  const r = await chrome.identity.getAuthToken({ interactive });
  return typeof r === 'string' ? r : r && r.token; // Chrome 105+ mengembalikan { token, grantedScopes }
}

async function login() {
  let gToken;
  try {
    gToken = await googleToken(true);
  } catch (e) {
    // Jendela Google ditutup, akun bukan Test user, atau client ID tidak cocok dengan ID extension.
    return { ok: false, message: 'Login Google dibatalkan atau ditolak: ' + e.message };
  }
  try {
    let r = await callApi('POST', '/api/auth/google', { body: { accessToken: gToken } });
    if (r.data.code === 'GOOGLE_TOKEN_INVALID') {
      // Token di cache Chrome bisa sudah dicabut atau kedaluwarsa: buang, lalu minta yang baru sekali lagi.
      await chrome.identity.removeCachedAuthToken({ token: gToken });
      gToken = await googleToken(true);
      r = await callApi('POST', '/api/auth/google', { body: { accessToken: gToken } });
    }
    if (r.status !== 200) return { ok: false, code: r.data.code, message: r.data.message || 'Login gagal' };
    await chrome.storage.local.set({ session: { token: r.data.token, user: r.data.user } });
    return { ok: true, user: r.data.user };
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: 'Server belum berjalan. Jalankan backend (npm start).' };
  }
}

async function logoutAkun() {
  const session = await getSession();
  await chrome.storage.local.remove('session');
  // Hapus juga sesi di server. Bila server mati, sesi itu tetap kedaluwarsa sendiri dalam 30 hari.
  if (session) await callApi('POST', '/api/auth/logout', { token: session.token }).catch(() => {});
  // Buang token Google dari cache Chrome agar login berikutnya meminta token baru.
  try {
    const t = await googleToken(false);
    if (t) await chrome.identity.removeCachedAuthToken({ token: t });
  } catch (e) { /* tidak ada token di cache */ }
  return { ok: true };
}

// Ambil data akun terbaru (foto, paket, credit). Sesi yang sudah tidak sah di server dihapus.
async function refreshMe() {
  const session = await getSession();
  if (!session) return null;
  try {
    const r = await callApi('GET', '/api/me', { token: session.token });
    if (r.status === 401) {
      await chrome.storage.local.remove('session');
      return null;
    }
    if (r.status === 200) {
      const baru = { ...session, user: r.data };
      await chrome.storage.local.set({ session: baru });
      return baru;
    }
  } catch (e) { /* server mati: pakai data terakhir yang tersimpan */ }
  return session;
}

// msg.imageUrl: unduh gambar dari alamatnya.  msg.image: gambar (base64) yang sudah dipotret.
async function translate(msg) {
  if (MOCK) {
    await new Promise((r) => setTimeout(r, 1200));
    return { ok: true, ...mockResult(await getSettings()) };
  }
  // Wajib login: cek dulu sebelum mengunduh gambar, supaya tidak membuang waktu.
  const session = await getSession();
  if (!session) return { ok: false, code: 'NOT_LOGGED_IN', message: PESAN_LOGIN };
  let image = msg.image;
  if (!image) {
    try {
      if (String(msg.imageUrl).startsWith('blob:')) throw new Error('blob'); // tidak bisa dibaca dari service worker
      image = await imageToBase64(msg.imageUrl);
    } catch (e) {
      return { ok: false, code: 'IMAGE_FETCH', message: 'Gambar tidak bisa diambil dari situs ini (situs memblokir unduhan gambar). Coba gambar atau situs lain.' };
    }
  }
  return sendToBackend(image, session);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'translate') {
    translate(msg).then(sendResponse);
    return true; // respons asinkron
  }
  if (msg && msg.type === 'login') {
    login().then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'logout') {
    logoutAkun().then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'me') {
    refreshMe().then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'capture') {
    captureCrop(_sender.tab.windowId, msg.rect, msg.dpr)
      .then((image) => sendResponse({ ok: true, image }))
      .catch((e) => sendResponse({ ok: false, message: 'Gagal memotret gambar: ' + e.message }));
    return true;
  }
});
