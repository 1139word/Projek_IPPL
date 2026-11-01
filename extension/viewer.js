// Fitur Premium: terjemahkan gambar dari File Explorer Windows.
// Alur:
//   1. Menu klik kanan Windows membuka halaman ini dengan lokasi file di alamatnya (?path=...).
//   2. Cek akun: harus login dan Premium (backend juga memeriksa lagi, jadi pemeriksaan ini hanya
//      supaya pengguna langsung mendapat pesan yang jelas).
//   3. Minta isi file ke native host (explorer-host/host.js) lewat Native Messaging, karena
//      extension tidak boleh membaca file di komputer secara langsung.
//   4. Tampilkan gambarnya, lalu minta content.js langsung menerjemahkan (event 'it-auto').

const HOST = 'com.imagetranslator.explorer';
const $ = (id) => document.getElementById(id);

function status(teks) { $('status').textContent = teks || ''; }

function pesan(teks, tombol) {
  status('');
  $('pesanTeks').textContent = teks;
  const b = $('pesanTombol');
  b.hidden = !tombol;
  if (tombol) { b.textContent = tombol.label; b.onclick = tombol.aksi; }
  $('pesan').hidden = false;
}

// Lokasi file diambil dari alamat halaman. Windows menempelkan lokasi file apa adanya (%1), lalu Chrome
// mengubah sebagian karakter: spasi menjadi %20, huruf non-ASCII menjadi %XX, dan '#' memotong
// alamat menjadi bagian "hash". Jadi semua bagian setelah "?path=" digabung lagi, lalu hanya urutan
// %XX yang sah yang dikembalikan; tanda % biasa (misalnya "50%.jpg") dibiarkan.
function lokasiFile() {
  const alamat = location.search + location.hash;
  const i = alamat.indexOf('path=');
  if (i < 0) return '';
  return alamat.slice(i + 5).replace(/(%[0-9A-Fa-f]{2})+/g, (m) => {
    try { return decodeURIComponent(m); } catch (e) { return m; }
  });
}

// Isi file dikirim native host dalam beberapa potongan, karena satu pesan dari host maksimal 1 MB.
function bacaFile(path) {
  return new Promise((resolve, reject) => {
    let port;
    try { port = chrome.runtime.connectNative(HOST); } catch (e) { reject(e); return; }
    let info = null;
    const bagian = [];
    let selesai = false;
    port.onMessage.addListener((m) => {
      if (m.type === 'error') { selesai = true; reject(new Error(m.message)); port.disconnect(); return; }
      if (m.type === 'start') { info = m; return; }
      if (m.type === 'part') {
        bagian[m.i] = m.data;
        if (info && bagian.filter((x) => x !== undefined).length === info.parts) {
          selesai = true;
          resolve({ ...info, dataUrl: `data:${info.mime};base64,${bagian.join('')}` });
          port.disconnect();
        }
      }
    });
    port.onDisconnect.addListener(() => {
      if (selesai) return;
      const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Penghubung berhenti sebelum selesai';
      reject(new Error(/not found|forbidden/i.test(err)
        ? 'Penghubung File Explorer belum terpasang. Di folder proyek, jalankan: node scripts/pasang-file-explorer.js'
        : 'Gagal membaca file: ' + err));
    });
    port.postMessage({ path });
  });
}

async function mulai() {
  const path = lokasiFile();
  if (!path) {
    pesan('Halaman ini dibuka dari File Explorer: klik kanan sebuah gambar, lalu pilih "Terjemahkan dengan Image Translator".');
    return;
  }
  $('nama').textContent = path.split(/[\\/]/).pop();
  document.title = $('nama').textContent + ' · Image Translator';

  status('Memeriksa akun…');
  let sesi = null;
  try { sesi = await chrome.runtime.sendMessage({ type: 'me' }); } catch (e) { /* diperlakukan sebagai belum login */ }
  const bukaPremium = { label: 'Lihat paket Premium', aksi: () => chrome.tabs.create({ url: chrome.runtime.getURL('premium.html') }) };
  if (!sesi || !sesi.user) {
    pesan('Silakan masuk dulu: klik ikon Image Translator di toolbar, lalu "Masuk dengan Google". Setelah itu muat ulang halaman ini (F5).');
    return;
  }
  if (sesi.user.plan !== 'premium') {
    pesan('Menerjemahkan gambar dari File Explorer adalah fitur Premium. Akun kamu masih Free.', bukaPremium);
    return;
  }

  status('Membaca file…');
  let file;
  try { file = await bacaFile(path); } catch (e) { pesan(e.message); return; }

  const img = $('gambar');
  img.alt = file.name;
  img.onload = () => {
    status('');
    // Tunggu satu frame supaya ukuran gambar di layar sudah final sebelum kotak terjemahan dihitung.
    requestAnimationFrame(() => img.dispatchEvent(new CustomEvent('it-auto', { bubbles: true })));
  };
  img.onerror = () => pesan('File ini tidak bisa ditampilkan sebagai gambar.');
  img.src = file.dataUrl;
  img.hidden = false;
}

mulai();
