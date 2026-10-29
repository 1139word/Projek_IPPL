// Popup pengaturan. Setiap pilihan langsung disimpan (tanpa tombol Simpan)
// dan dipakai pada terjemahan berikutnya karena background membaca chrome.storage.sync.
// Tampilan mengikuti rancangan: popup utama, credit habis, dan "Advanced khusus Premium".
const LANGS = [
  ['ja', 'Jepang'], ['en', 'Inggris'], ['id', 'Indonesia'], ['ko', 'Korea'],
  ['zh-CN', 'Mandarin (Sederhana)'], ['zh-TW', 'Mandarin (Tradisional)'],
  ['es', 'Spanyol'], ['fr', 'Prancis'], ['de', 'Jerman'],
  ['ru', 'Rusia'], ['th', 'Thailand'], ['vi', 'Vietnam']
];
// model: [kode, nama, biaya, khusus Premium?]
const OPTIONS = {
  src: [['auto', 'Deteksi otomatis']].concat(LANGS),
  tgt: LANGS,
  model: [['std', 'Gemini Standar', '1 credit', false], ['adv', 'Gemini Advanced', '2 credit', true]]
};
const DEFAULTS = { src: 'auto', tgt: 'en', model: 'std' };
let plan = 'free'; // diisi dari akun setelah login

let state = { ...DEFAULTS };
let savedTimer = null;
const $ = (sel, root = document) => root.querySelector(sel);

// ---- Pindah tampilan (utama / credit habis / Advanced khusus Premium) ----
function show(view) {
  for (const id of ['vLogin', 'vMain', 'vHabis', 'vAdv']) $('#' + id).hidden = id !== view;
  $('#msg').textContent = '';
}

// ---- Credit ----
// c = credit dari server: { left, quota, resetAt } dengan resetAt berupa teks tanggal ISO.
function sisaWaktu(resetAt) {
  const ms = Math.max(0, Date.parse(resetAt) - Date.now());
  const hari = Math.floor(ms / 86400000);
  const jam = Math.floor((ms % 86400000) / 3600000);
  return hari >= 1 ? `${hari} hari ${jam} jam` : `${jam} jam`;
}
function renderCredit(c) {
  if (!c) return;
  $('#creditText').textContent = `${c.left} / ${c.quota} tersisa`;
  $('#creditText').classList.toggle('empty', c.left === 0);
  $('#creditBar').classList.toggle('full', c.left === 0);
  // Bar menunjukkan sisa credit (4/10 = 40%), sesuai rancangan. Saat habis, bar penuh berwarna merah.
  $('#creditBar i').style.width = (c.left === 0 ? 100 : (c.left / c.quota) * 100) + '%';
  $('#resetNote').textContent = `Credit diperbarui dalam ${sisaWaktu(c.resetAt)}`;
  $('#habisNote').textContent = `Credit diperbarui dalam ${sisaWaktu(c.resetAt)}. Upgrade ke Premium untuk kuota lebih besar.`;
  if (c.left === 0) show('vHabis');
  else if (!$('#vHabis').hidden) show('vMain');
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
      if (key === 'model' && o[3] && plan !== 'premium') {
        const badge = document.createElement('span');
        badge.className = 'bdg';
        badge.textContent = 'PREMIUM';
        left.appendChild(badge);
      }
      const right = document.createElement('span');
      right.className = key === 'model' ? 'sub' : '';
      right.textContent = key === 'model' ? o[2] : o[0] === state[key] ? '✓' : '';
      b.append(left, right);
      b.addEventListener('click', () => choose(key, o[0], o[3]));
      dd.appendChild(b);
    }
  });
}
function choose(key, value, premiumOnly) {
  closeAll();
  if (key === 'model' && premiumOnly && plan !== 'premium') { show('vAdv'); return; }
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
    const planBerubah = plan !== user.plan;
    plan = user.plan;
    // Baru dibuka atau baru saja login: tampilkan pengaturan (renderCredit bisa menggantinya dengan "credit habis").
    if (!['vMain', 'vHabis', 'vAdv'].some((id) => !$('#' + id).hidden)) show('vMain');
    renderCredit(user.credit);
    if (planBerubah) render(); // lencana PREMIUM di pilihan model mengikuti paket akun
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
    plan = 'free';
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

// ---- Tombol ----
// Paket Premium dan pembayaran QRIS belum dibuat (menunggu sistem akun).
document.querySelectorAll('.premium').forEach((b) => b.addEventListener('click', () => {
  $('#msg').textContent = 'Paket Premium dan pembayaran QRIS dibuat setelah sistem akun selesai.';
}));
$('#btnStandar').addEventListener('click', () => show('vMain'));
$('#btnTutup').addEventListener('click', () => window.close());

// ---- Muat data awal ----
// Akun dulu (menentukan paket Free/Premium), baru pengaturan. Data tersimpan ditampilkan dulu
// supaya cepat, lalu background meminta data terbaru (credit, paket) ke server.
(async () => {
  const { session } = await chrome.storage.local.get('session');
  renderAkun(session);
  const s = await chrome.storage.sync.get(DEFAULTS);
  state = { ...DEFAULTS, ...s };
  if (state.model === 'adv' && plan !== 'premium') state.model = 'std';
  render();
  chrome.runtime.sendMessage({ type: 'me' });
})();
// Sesi berubah saat popup terbuka (login, keluar, atau credit berkurang setelah terjemahan).
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.session) renderAkun(ch.session.newValue);
});
