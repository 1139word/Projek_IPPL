// Popup pengaturan. Setiap pilihan langsung disimpan (tanpa tombol Simpan)
// dan dipakai pada terjemahan berikutnya karena background membaca chrome.storage.sync.
// Tampilan: popup utama, credit habis, dan daftar paket credit.
const LANGS = [
  ['ja', 'Jepang'], ['en', 'Inggris'], ['id', 'Indonesia'], ['ko', 'Korea'],
  ['zh-CN', 'Mandarin (Sederhana)'], ['zh-TW', 'Mandarin (Tradisional)'],
  ['es', 'Spanyol'], ['fr', 'Prancis'], ['de', 'Jerman'],
  ['ru', 'Rusia'], ['th', 'Thailand'], ['vi', 'Vietnam']
];
// model: [kode, nama, biaya]. Semua akun boleh memakai semua model.
// Harus sama dengan backend/lib/models.js (backend yang menentukan biaya sebenarnya).
const OPTIONS = {
  src: [['auto', 'Deteksi otomatis']].concat(LANGS),
  tgt: LANGS,
  model: [
    ['flash-lite', 'Gemini 3.1 Flash-Lite', '1 credit'],
    ['deepseek', 'DeepSeek V4.1 Flash', '1 credit'],
    ['flash', 'Gemini 3.5 Flash', '1 credit'],
    ['pro', 'Gemini 3.1 Pro', '2 credit']
  ]
};
const DEFAULTS = { src: 'auto', tgt: 'en', model: 'flash-lite' };
// Kode lama dari versi dua model, diganti ke model baru yang paling mirip.
const MODEL_LAMA = { std: 'flash-lite', adv: 'flash' };
let state = { ...DEFAULTS };
let savedTimer = null;
const $ = (sel, root = document) => root.querySelector(sel);

// ---- Pindah tampilan (login / utama / credit habis / paket credit) ----
function show(view) {
  for (const id of ['vLogin', 'vMain', 'vHabis', 'vPaket']) $('#' + id).hidden = id !== view;
  $('#msg').textContent = '';
}

// ---- Credit (UC-02) ----
// c = credit dari server: { left }. Saldo tidak punya kuota dan tidak direset,
// jadi yang ditampilkan hanya jumlahnya.
function renderCredit(c) {
  if (!c) return;
  $('#creditText').textContent = `${c.left} credit`;
  $('#creditText').classList.toggle('empty', c.left === 0);
  if (c.left === 0) { if (!$('#vMain').hidden) show('vHabis'); }
  else if (!$('#vHabis').hidden) show('vMain'); // baru saja membeli credit
}

// ---- Dropdown pengaturan ----
function labelOf(key, value) {
  const o = OPTIONS[key].find((x) => x[0] === value);
  return o ? o[1] : value;
}
function closeAll() {
  document.querySelectorAll('.dd').forEach((d) => (d.hidden = true));
  document.querySelectorAll('.sel').forEach((s) => s.classList.remove('open'));
  document.querySelectorAll('.caret').forEach((c) => (c.textContent = '▾'));
}
function render() {
  document.querySelectorAll('.wrap').forEach((wrap) => {
    const key = wrap.dataset.key;
    $('.val', wrap).textContent = labelOf(key, state[key]);
    const dd = $('.dd', wrap);
    dd.textContent = '';
    for (const o of OPTIONS[key]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ddi' + (o[0] === state[key] ? ' on' : '');
      b.setAttribute('role', 'option');
      const left = document.createElement('span');
      left.textContent = o[1];
      const right = document.createElement('span');
      right.className = key === 'model' ? 'sub' : '';
      right.textContent = key === 'model' ? o[2] : o[0] === state[key] ? '✓' : '';
      b.append(left, right);
      b.addEventListener('click', () => choose(key, o[0]));
      dd.appendChild(b);
    }
  });
}
function choose(key, value) {
  closeAll();
  $('#msg').textContent = '';
  state[key] = value;
  chrome.storage.sync.set({ [key]: value }).then(() => {
    const el = $('#saved');
    el.textContent = '✓ Tersimpan';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (el.textContent = ''), 1800);
  });
  render();
}

document.querySelectorAll('.wrap').forEach((wrap) => {
  $('.sel', wrap).addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = $('.dd', wrap);
    const wasHidden = dd.hidden;
    closeAll();
    if (wasHidden) {
      dd.hidden = false;
      $('.sel', wrap).classList.add('open');
      $('.caret', wrap).textContent = '▴';
      const on = $('.ddi.on', dd);
      if (on) on.scrollIntoView({ block: 'nearest' });
    }
  });
});
document.addEventListener('click', closeAll);

// ---- Akun Google ----
// Login dan logout dikerjakan background (lihat background.js). Popup hanya menampilkan
// isi 'session' di chrome.storage.local dan ikut berubah saat isinya berubah.
// Belum login: hanya layar "Masuk untuk menerjemahkan". Sudah login: credit dan pengaturan.
const AVATAR_DEFAULT = $('#av').innerHTML;

function renderAkun(session) {
  const user = session && session.user;
  const av = $('#av');
  $('#akunInfo').hidden = !user;
  $('#tglRow').hidden = !user;
  $('#creditBox').hidden = !user;
  if (user) {
    // Baru dibuka atau baru saja login: tampilkan pengaturan (renderCredit bisa menggantinya dengan "credit habis").
    if (!['vMain', 'vHabis', 'vPaket'].some((id) => !$('#' + id).hidden)) show('vMain');
    renderCredit(user.credit);
    $('#akunEmail').textContent = user.email;
    av.title = user.email;
    av.setAttribute('aria-label', user.email);
    if (user.picture) {
      const img = document.createElement('img');
      img.src = user.picture;
      img.alt = '';
      img.referrerPolicy = 'no-referrer'; // foto Google kadang ditolak bila alamat asal ikut dikirim
      av.replaceChildren(img);
    } else {
      av.innerHTML = AVATAR_DEFAULT;
    }
    $('#tos').textContent = '';
  } else {
    show('vLogin');
    av.innerHTML = AVATAR_DEFAULT;
    av.title = 'Belum login';
    av.setAttribute('aria-label', 'Belum login');
    $('#tos').textContent = 'Kami hanya menerima email dan foto profil akun Google Anda.';
  }
}

$('#btnLogin').addEventListener('click', async () => {
  const b = $('#btnLogin');
  b.disabled = true;
  b.textContent = 'Menunggu Google…';
  $('#msg').textContent = '';
  const res = await chrome.runtime.sendMessage({ type: 'login' });
  b.disabled = false;
  b.textContent = 'Masuk dengan Google';
  if (!res.ok) $('#msg').textContent = res.message;
});
$('#btnLogout').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'logout' }));

// ---- Sakelar aktif ----
// Disimpan di chrome.storage.sync (kunci 'enabled'). content.js di semua tab ikut mendengarkan,
// jadi tombol langsung hilang/muncul tanpa memuat ulang halaman.
function renderTgl(on) {
  $('#tgl').classList.toggle('on', on);
  $('#tgl').setAttribute('aria-checked', String(on));
  $('#tglNote').textContent = on ? 'Matikan saat tidak membaca komik' : 'Mati di semua halaman';
}
$('#tgl').addEventListener('click', () => {
  const on = !$('#tgl').classList.contains('on');
  renderTgl(on);
  chrome.storage.sync.set({ enabled: on });
});
chrome.storage.sync.get({ enabled: true }).then((v) => renderTgl(v.enabled !== false));

// ---- Paket credit (UC-07) ----
const rupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

// Satu kartu per paket: nama, jumlah credit, harga, dan tombol Beli.
// Harga per credit sengaja tidak ditampilkan (keputusan rancangan).
function kartuPaket(p) {
  const card = document.createElement('div');
  card.className = 'card paket';
  const kiri = document.createElement('div');
  const nama = document.createElement('b');
  nama.textContent = `${p.credits} credit`;
  const harga = document.createElement('div');
  harga.className = 'note';
  harga.textContent = rupiah(p.price);
  kiri.append(nama, harga);
  const beli = document.createElement('button');
  beli.type = 'button';
  beli.className = 'btn mini';
  beli.textContent = 'Beli';
  beli.setAttribute('aria-label', `Beli ${p.credits} credit seharga ${rupiah(p.price)}`);
  // UC-08: pembayaran QRIS dibuka di tab, karena popup tertutup begitu pengguna mengklik di luar popup.
  beli.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('beli.html') + '?paket=' + encodeURIComponent(p.id) });
    window.close();
  });
  card.append(kiri, beli);
  return card;
}

async function bukaPaket() {
  show('vPaket');
  const res = await chrome.runtime.sendMessage({ type: 'packages' });
  if (!res || !res.ok) {
    $('#paketList').replaceChildren();
    $('#msg').textContent = (res && res.message) || 'Daftar paket tidak bisa diambil dari server.';
    return;
  }
  if (!res.packages.length) {
    $('#paketList').replaceChildren();
    $('#msg').textContent = 'Belum ada paket credit yang dijual.';
    return;
  }
  $('#paketList').replaceChildren(...res.packages.map(kartuPaket));
}

// ---- Tombol ----
document.querySelectorAll('.beli').forEach((b) => b.addEventListener('click', bukaPaket));
$('#btnKembali').addEventListener('click', async () => {
  // Kembali ke pengaturan, atau ke layar "credit habis" bila saldo masih nol.
  const { session } = await chrome.storage.local.get('session');
  show('vMain');
  renderCredit(session && session.user && session.user.credit);
});
$('#btnTutup').addEventListener('click', () => window.close());

// ---- Muat data awal ----
// Data tersimpan ditampilkan dulu supaya cepat, lalu background meminta data terbaru (saldo credit) ke server.
(async () => {
  const { session } = await chrome.storage.local.get('session');
  renderAkun(session);
  const s = await chrome.storage.sync.get(DEFAULTS);
  state = { ...DEFAULTS, ...s };
  if (!OPTIONS.model.some((o) => o[0] === state.model)) {
    state.model = MODEL_LAMA[state.model] || DEFAULTS.model;
    chrome.storage.sync.set({ model: state.model }); // simpan kode baru agar semua tab memakai yang sama
  }
  render();
  chrome.runtime.sendMessage({ type: 'me' });
})();
// Sesi berubah saat popup terbuka (login, keluar, atau credit berkurang setelah terjemahan).
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.session) renderAkun(ch.session.newValue);
});
