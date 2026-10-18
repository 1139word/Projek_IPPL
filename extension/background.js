// Service worker: menjadi perantara antara content script dan backend.
// MOCK = true berarti tidak memanggil backend; hasil berupa contoh agar alur UI bisa dicoba tanpa server.
// MOCK = false: gambar dikirim ke backend (folder backend/) untuk OCR + Gemini.
const MOCK = false;
const API_URL = 'http://localhost:3000/api/translate';

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

async function sendToBackend(image) {
  const settings = await getSettings();
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, src: settings.src, tgt: settings.tgt, model: settings.model })
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, code: data.code || 'ERROR', message: data.message || 'Terjemahan gagal' };
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: 'Server belum berjalan. Jalankan backend (npm start) dan layanan OCR.' };
  }
}

// ---- Credit lokal (sementara, sebelum sistem akun dibuat) ----
// Aturan sama dengan SRS: credit mingguan, Standar 1 credit, Advanced 2 credit, dan credit
// hanya dipotong bila terjemahan berhasil (gagal atau teks tidak ditemukan = tidak dipotong).
// Disimpan di chrome.storage.local, jadi hanya berlaku di browser ini. Nanti dipindah ke server
// per akun, karena data di browser bisa diubah sendiri oleh pengguna.
const CREDIT_QUOTA = 10;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const COST = { std: 1, adv: 2 };

async function getCredit() {
  const { credit } = await chrome.storage.local.get('credit');
  const now = Date.now();
  if (!credit || now >= credit.resetAt) {
    // Pertama kali dipakai, atau sudah lewat 7 hari: isi ulang.
    const baru = { left: CREDIT_QUOTA, quota: CREDIT_QUOTA, resetAt: now + WEEK_MS };
    await chrome.storage.local.set({ credit: baru });
    return baru;
  }
  return credit;
}

async function useCredit(cost) {
  const c = await getCredit();
  c.left = Math.max(0, c.left - cost);
  await chrome.storage.local.set({ credit: c });
  return c;
}

// msg.imageUrl: unduh gambar dari alamatnya.  msg.image: gambar (base64) yang sudah dipotret.
async function translate(msg) {
  const settings = await getSettings();
  const cost = COST[settings.model] || 1;
  const credit = await getCredit();
  if (credit.left < cost) {
    return { ok: false, code: 'NO_CREDIT', message: 'Credit minggu ini habis. Buka popup Image Translator untuk melihat kapan credit diperbarui.' };
  }
  const res = await translateRaw(msg);
  if (res.ok) await useCredit(cost); // hanya dipotong bila berhasil
  return res;
}

async function translateRaw(msg) {
  if (MOCK) {
    await new Promise((r) => setTimeout(r, 1200));
    return { ok: true, ...mockResult(await getSettings()) };
  }
  let image = msg.image;
  if (!image) {
    try {
      if (String(msg.imageUrl).startsWith('blob:')) throw new Error('blob'); // tidak bisa dibaca dari service worker
      image = await imageToBase64(msg.imageUrl);
    } catch (e) {
      return { ok: false, code: 'IMAGE_FETCH', message: 'Gambar tidak bisa diambil dari situs ini (situs memblokir unduhan gambar). Coba gambar atau situs lain.' };
    }
  }
  return sendToBackend(image);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'translate') {
    translate(msg).then(sendResponse);
    return true; // respons asinkron
  }
  if (msg && msg.type === 'credit') {
    getCredit().then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'capture') {
    captureCrop(_sender.tab.windowId, msg.rect, msg.dpr)
      .then((image) => sendResponse({ ok: true, image }))
      .catch((e) => sendResponse({ ok: false, message: 'Gagal memotret gambar: ' + e.message }));
    return true;
  }
});
