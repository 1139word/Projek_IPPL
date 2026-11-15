// Halaman Unggah Gambar (UC-06 Menerjemahkan Gambar Unggahan), menggantikan fitur File Explorer.
// Alur:
//   1. Pengguna memilih satu atau banyak gambar, satu folder, atau menyeret file ke halaman.
//   2. Setiap file diperiksa di sini (jenis dan ukuran) SEBELUM dikirim; yang tidak lolos ditolak dengan pesan.
//   3. Gambar yang lolos langsung ditampilkan berurutan dari atas ke bawah.
//   4. Gambar diterjemahkan otomatis SATU PER SATU (antrean), supaya urutan hasil sama dengan urutan baca
//      dan layanan OCR tidak menerima banyak gambar sekaligus.
//   5. Yang menggambar kotak terjemahan adalah content.js (dimuat juga di halaman ini). Halaman ini
//      memintanya lewat event 'it-auto' dan menerima hasilnya lewat event 'it-hasil'.
//   6. Gambar yang gagal tetap ada dengan pesan yang menetap dan tombol "Terjemahkan ulang".
//      Credit hanya dipotong server bila terjemahan berhasil.
// Semua gambar dan hasil hanya ada di memori tab ini (hilang saat tab ditutup atau dimuat ulang).

const MAKS_BYTE = 15 * 1024 * 1024; // sama dengan batas lama; backend menerima badan permintaan sampai 25 MB (base64)
const JENIS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' };
// Nama model untuk keterangan di pojok kanan atas (sama dengan popup.js).
const NAMA_MODEL = { 'flash-lite': 'Gemini 3.1 Flash-Lite', deepseek: 'DeepSeek V4.1 Flash', flash: 'Gemini 3.5 Flash', pro: 'Gemini 3.1 Pro' };
// Kegagalan yang pasti terulang untuk gambar berikutnya: sisa antrean langsung ditandai gagal
// tanpa memanggil server, lalu bisa diulang setelah pengguna masuk atau membeli credit.
const HENTIKAN_ANTREAN = ['NO_CREDIT', 'NOT_LOGGED_IN'];

const $ = (id) => document.getElementById(id);
const items = []; // { file, el, img, statusEl, gagalEl, state: 'antre' | 'proses' | 'selesai' | 'gagal' }
const antrean = [];
let berjalan = false;

// ---- Pemeriksaan file sebelum dikirim ----
const ekstensi = (nama) => (/\.([^.\\/]+)$/.exec(nama) || [, ''])[1].toLowerCase();
function periksa(file) {
  const ext = ekstensi(file.name);
  // Jenis dilihat dari ekstensi dan dari jenis yang dilaporkan browser (bila ada).
  const jenisOk = Object.hasOwn(JENIS, ext) && (!file.type || Object.values(JENIS).includes(file.type));
  if (!jenisOk) return 'bukan gambar JPG, PNG, WEBP, BMP, atau GIF';
  if (file.size > MAKS_BYTE) return `ukurannya ${(file.size / 1048576).toFixed(1)} MB, melebihi batas 15 MB`;
  if (file.size === 0) return 'file kosong';
  return null;
}

function tampilkanDitolak(ditolak, bukanGambarDiFolder) {
  const baris = ditolak.map((d) => `${d.nama}: ${d.alasan}`);
  if (bukanGambarDiFolder) baris.push(`${bukanGambarDiFolder} file lain di folder itu bukan gambar dan dilewati`);
  if (!baris.length) { $('ditolak').hidden = true; return; }
  $('ditolakJudul').textContent = ditolak.length
    ? `${ditolak.length} file tidak diunggah (tidak dikirim ke server, credit tidak dipotong):`
    : 'Catatan:';
  const ul = $('ditolakList');
  ul.textContent = '';
  for (const t of baris.slice(0, 20)) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
  if (baris.length > 20) { const li = document.createElement('li'); li.textContent = `dan ${baris.length - 20} lainnya`; ul.appendChild(li); }
  $('ditolak').hidden = false;
}
$('ditolakTutup').addEventListener('click', () => { $('ditolak').hidden = true; });

// ---- Menambah gambar ke halaman ----
const urut = new Intl.Collator('id', { numeric: true, sensitivity: 'base' }); // "2.png" sebelum "10.png"

function tambahFile(fileList, { dariFolder = false } = {}) {
  let files = [...fileList];
  let bukanGambar = 0;
  if (dariFolder) {
    // Folder biasanya berisi file lain (txt, zip): cukup dihitung, tidak ditampilkan satu per satu.
    const semua = files.length;
    files = files.filter((f) => Object.hasOwn(JENIS, ekstensi(f.name)));
    bukanGambar = semua - files.length;
    files.sort((a, b) => urut.compare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
  }
  const ditolak = [];
  for (const file of files) {
    const alasan = periksa(file);
    if (alasan) { ditolak.push({ nama: file.name, alasan }); continue; }
    const it = buatKartu(file);
    items.push(it);
    antrean.push(it);
  }
  if (dariFolder && !files.length) { ditolak.push({ nama: 'Folder yang dipilih', alasan: 'tidak berisi gambar' }); bukanGambar = 0; }
  tampilkanDitolak(ditolak, bukanGambar);
  perbarui();
  jalankan();
}

function buatKartu(file) {
  const el = document.createElement('figure');
  el.className = 'kartu';
  const atas = document.createElement('figcaption');
  atas.className = 'kartu-atas';
  const nomor = document.createElement('span');
  nomor.className = 'nomor';
  nomor.textContent = items.length + 1;
  const nama = document.createElement('span');
  nama.className = 'nama';
  nama.textContent = nama.title = file.name;
  const statusEl = document.createElement('span');
  statusEl.className = 'status';
  atas.append(nomor, nama, statusEl);
  const wadah = document.createElement('div');
  wadah.className = 'gambar-wadah';
  const img = document.createElement('img');
  img.alt = file.name;
  wadah.appendChild(img);
  el.append(atas, wadah);
  $('daftar').appendChild(el);
  const it = { file, el, img, statusEl, gagalEl: null, state: 'antre' };
  setStatus(it, 'antre');
  // Gambar langsung ditampilkan (tanpa menunggu giliran diterjemahkan). Isi file dibaca menjadi alamat
  // data: karena alamat itulah yang nanti dikirim ke backend lewat background.js.
  it.siap = new Promise((resolve) => {
    const fr = new FileReader();
    fr.onerror = () => resolve(false);
    fr.onload = () => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
  return it;
}

const TEKS_STATUS = { antre: 'Menunggu giliran', proses: 'Menerjemahkan…', selesai: 'Selesai', gagal: 'Gagal' };
function setStatus(it, state, keterangan) {
  it.state = state;
  it.statusEl.className = 'status ' + state;
  it.statusEl.textContent = keterangan || TEKS_STATUS[state];
}

// Pesan gagal menetap di atas gambar sampai pengguna menekan "Terjemahkan ulang".
// bisaDiulang = false untuk file yang isinya memang bukan gambar: mengulang tidak akan mengubah hasilnya.
function tandaiGagal(it, pesan, bisaDiulang = true) {
  setStatus(it, 'gagal');
  if (it.gagalEl) it.gagalEl.remove();
  const kotak = document.createElement('div');
  kotak.className = 'gagal-kotak';
  kotak.setAttribute('role', 'alert');
  const teks = document.createElement('span');
  teks.textContent = pesan;
  const ulang = document.createElement('button');
  ulang.type = 'button';
  ulang.className = 'btn';
  ulang.textContent = 'Terjemahkan ulang';
  ulang.addEventListener('click', () => {
    kotak.remove();
    it.gagalEl = null;
    setStatus(it, 'antre');
    antrean.push(it);
    perbarui();
    jalankan();
  });
  if (bisaDiulang) kotak.append(teks, ulang);
  else { kotak.append(teks); it.el.lastChild.hidden = true; } // sembunyikan ikon gambar rusak
  it.el.insertBefore(kotak, it.el.lastChild); // di antara nama file dan gambar
  it.gagalEl = kotak;
}

// ---- Antrean: satu gambar setiap kali ----
function terjemahkan(it) {
  return new Promise((resolve) => {
    it.img.addEventListener('it-hasil', (e) => resolve(e.detail), { once: true });
    // Tunggu satu frame supaya ukuran gambar di layar sudah final sebelum kotak terjemahan dihitung.
    requestAnimationFrame(() => it.img.dispatchEvent(new CustomEvent('it-auto', { bubbles: true })));
  });
}

async function jalankan() {
  if (berjalan) return;
  berjalan = true;
  let henti = null; // pesan kegagalan yang menghentikan sisa antrean
  while (antrean.length) {
    const it = antrean.shift();
    if (henti) { tandaiGagal(it, henti); perbarui(); continue; }
    if (!(await it.siap)) {
      tandaiGagal(it, 'File ini tidak bisa ditampilkan sebagai gambar (isinya rusak atau bukan gambar). Tidak dikirim ke server, credit tidak dipotong.', false);
      perbarui();
      continue;
    }
    setStatus(it, 'proses');
    perbarui();
    const hasil = await terjemahkan(it);
    if (hasil.ok) {
      setStatus(it, 'selesai', hasil.jumlah ? `Selesai · ${hasil.jumlah} teks` : 'Selesai');
    } else {
      tandaiGagal(it, hasil.message);
      if (HENTIKAN_ANTREAN.includes(hasil.code)) henti = hasil.message;
    }
    perbarui();
  }
  berjalan = false;
}

// ---- Ringkasan dan keterangan akun ----
function perbarui() {
  const n = items.length;
  $('pilih').classList.toggle('lagi', n > 0);
  $('pilihTeks').textContent = n ? 'Tambah gambar di bawah gambar terakhir' : 'Seret gambar ke sini, atau pilih dari komputer';
  $('btnGambar').textContent = n ? 'Pilih gambar lagi' : 'Pilih gambar';
  $('btnFolder').textContent = n ? 'Pilih folder lagi' : 'Pilih folder';
  if (!n) return;
  const hitung = (s) => items.filter((x) => x.state === s).length;
  const selesai = hitung('selesai'), gagal = hitung('gagal'), sisa = hitung('antre') + hitung('proses');
  const bagian = [`${selesai} dari ${n} gambar selesai`];
  if (gagal) bagian.push(`${gagal} gagal`);
  if (sisa) bagian.push(`${sisa} masih diproses`);
  $('ringkas').textContent = bagian.join(', ') + '. Gambar dan hasilnya hilang bila tab ini ditutup atau dimuat ulang.';
  document.title = (sisa ? `(${selesai}/${n}) ` : '') + 'Unggah Gambar · Image Translator';
}

async function tampilkanAkun() {
  const { session } = await chrome.storage.local.get('session');
  const { model } = await chrome.storage.sync.get({ model: 'flash-lite' });
  const el = $('infoAkun');
  el.textContent = '';
  $('belumMasuk').hidden = Boolean(session && session.user);
  if (!session || !session.user) return;
  const saldo = document.createElement('b');
  saldo.textContent = `${session.user.credit ? session.user.credit.left : 0} credit`;
  el.append('Saldo ', saldo, ` · Model ${NAMA_MODEL[model] || NAMA_MODEL['flash-lite']}`);
}
// Saldo berkurang setiap terjemahan berhasil; model bisa diganti lewat popup saat halaman ini terbuka.
chrome.storage.onChanged.addListener((ch, area) => {
  if ((area === 'local' && ch.session) || (area === 'sync' && ch.model)) tampilkanAkun();
});

// ---- Tombol, pemilih file, dan seret-lepas ----
$('btnGambar').addEventListener('click', () => $('inGambar').click());
$('btnFolder').addEventListener('click', () => $('inFolder').click());
$('inGambar').addEventListener('change', (e) => { tambahFile(e.target.files); e.target.value = ''; }); // dikosongkan agar file yang sama bisa dipilih lagi
$('inFolder').addEventListener('change', (e) => { tambahFile(e.target.files, { dariFolder: true }); e.target.value = ''; });

let hitungSeret = 0; // dragenter/dragleave juga terpicu oleh elemen anak, jadi dihitung
const adaFile = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
addEventListener('dragenter', (e) => { if (adaFile(e)) { hitungSeret++; $('pilih').classList.add('seret'); } });
addEventListener('dragleave', (e) => { if (adaFile(e) && --hitungSeret <= 0) { hitungSeret = 0; $('pilih').classList.remove('seret'); } });
addEventListener('dragover', (e) => { if (adaFile(e)) e.preventDefault(); }); // tanpa ini browser membuka filenya
addEventListener('drop', (e) => {
  if (!adaFile(e)) return;
  e.preventDefault();
  hitungSeret = 0;
  $('pilih').classList.remove('seret');
  // Folder yang diseret muncul sebagai file tanpa jenis dan berukuran 0; untuk folder pakai tombol "Pilih folder".
  tambahFile(e.dataTransfer.files);
});

tampilkanAkun();
chrome.runtime.sendMessage({ type: 'me' }).catch(() => {}); // minta saldo terbaru dari server
perbarui();
