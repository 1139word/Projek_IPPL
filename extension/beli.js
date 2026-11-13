// Halaman Beli Credit (UC-07 dan UC-08), dibuka di tab dari popup.
// Alur: tampilkan daftar paket -> pengguna memilih paket -> minta pesanan ke backend ->
// tampilkan QR dan hitung mundur -> tanya status setiap 3 detik.
// Halaman ini tidak pernah memutuskan sendiri bahwa pembayaran berhasil: yang memutuskan backend,
// setelah bertanya ke Midtrans (NFR-20). Semua permintaan lewat background.js (membawa token sesi).

const $ = (sel) => document.querySelector(sel);
const rupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
const CEK_MS = 3000;

let paket = [];      // daftar paket dari server
let dipilih = null;  // paket yang sedang dibayar
let order = null;
let timerId = null;
let cekId = null;
let urutan = 0;      // nomor permintaan terakhir: jawaban dari permintaan lama diabaikan

function tampil(id) {
  for (const s of ['sPilih', 'sMuat', 'sQr', 'sLunas', 'sHabis', 'sGagal']) $('#' + s).hidden = s !== id;
}

function berhenti() {
  clearInterval(timerId);
  clearTimeout(cekId);
}

function gagal(pesan) {
  berhenti();
  $('#gagalNote').textContent = pesan || 'Terjadi kesalahan. Coba lagi beberapa saat lagi.';
  tampil('sGagal');
}

// Saldo saat ini, dibaca dari sesi yang disimpan background.
async function tampilSaldo() {
  const { session } = await chrome.storage.local.get('session');
  const c = session && session.user && session.user.credit;
  $('#saldoNote').textContent = c ? `Saldo Anda saat ini ${c.left} credit.` : '';
}

// ---- Daftar paket (UC-07) ----
// Harga per credit sengaja tidak ditampilkan (keputusan rancangan).
function gambarPaket() {
  $('#paketList').replaceChildren(...paket.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opsi' + (dipilih && dipilih.id === p.id ? ' on' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(!!dipilih && dipilih.id === p.id));
    const nama = document.createElement('b');
    nama.textContent = `${p.credits} credit`;
    const harga = document.createElement('span');
    harga.className = 'harga';
    harga.textContent = rupiah(p.price);
    b.append(nama, harga);
    b.addEventListener('click', () => pilih(p));
    return b;
  }));
}

async function muatPaket() {
  const res = await chrome.runtime.sendMessage({ type: 'packages' });
  if (!res || !res.ok) {
    $('#paketList').replaceChildren();
    return gagal(res && res.message);
  }
  paket = res.packages;
  gambarPaket();
  // Dibuka dari tombol "Beli" di popup: paket itu langsung dipilih.
  const id = Number(new URLSearchParams(location.search).get('paket'));
  const awal = paket.find((p) => p.id === id);
  if (awal) pilih(awal);
}

function pilih(p) {
  dipilih = p;
  gambarPaket();
  mulai();
}

// ---- Pembayaran (UC-08) ----
function hitungMundur() {
  const sisa = Math.max(0, Date.parse(order.expiresAt) - Date.now());
  const m = Math.floor(sisa / 60000), d = Math.floor((sisa % 60000) / 1000);
  $('#timer').textContent = `${String(m).padStart(2, '0')}:${String(d).padStart(2, '0')}`;
  $('#timer').classList.toggle('mepet', sisa < 60000);
  // Waktu habis: tanya status sekali lagi (siapa tahu dibayar tepat di detik terakhir).
  if (sisa === 0) { clearInterval(timerId); cekStatus(urutan); }
}

async function mulai() {
  if (!dipilih) return tampil('sPilih');
  berhenti();
  const no = ++urutan;
  tampil('sMuat');
  const res = await chrome.runtime.sendMessage({ type: 'order-create', packageId: dipilih.id });
  if (no !== urutan) return; // pengguna sudah memilih paket lain
  if (!res || !res.ok) return gagal(res && res.message);
  order = res.order;
  $('#ringkas').textContent = `${order.credits} credit · ${rupiah(order.amount)}`;
  $('#orderId').textContent = `ID pesanan: ${order.orderId}`;
  const qr = await chrome.runtime.sendMessage({ type: 'order-qr', orderId: order.orderId });
  if (no !== urutan) return;
  if (!qr || !qr.ok) return gagal(qr && qr.message);
  $('#qrImg').src = qr.dataUrl;
  $('#sandbox').hidden = !order.sandboxQrUrl;
  tampil('sQr');
  hitungMundur();
  timerId = setInterval(hitungMundur, 1000);
  cekId = setTimeout(() => cekStatus(no), CEK_MS);
}

async function cekStatus(no) {
  clearTimeout(cekId);
  if (no !== urutan) return;
  const res = await chrome.runtime.sendMessage({ type: 'order-status', orderId: order.orderId });
  if (no !== urutan) return;
  if (res && res.ok) {
    const s = res.order.status;
    if (s === 'paid') return selesai(res.order, res.user);
    if (s === 'expired' || s === 'failed') {
      berhenti();
      $('#habisJudul').textContent = s === 'expired' ? 'Waktu pembayaran habis' : 'Pembayaran dibatalkan atau gagal';
      return tampil('sHabis');
    }
  } else if (res && res.code === 'PAYMENT_MISMATCH') {
    return gagal(res.message); // jumlah bayar tidak cocok: jangan lanjut bertanya
  }
  // Masih menunggu, atau gangguan sementara (server/Midtrans): tanya lagi nanti.
  if (Date.now() < Date.parse(order.expiresAt) + 30000) cekId = setTimeout(() => cekStatus(no), CEK_MS);
}

function selesai(o, user) {
  berhenti();
  urutan++;
  const saldo = user && user.credit ? ` Saldo Anda sekarang ${user.credit.left} credit.` : '';
  $('#lunasNote').textContent = `${o.credits} credit sudah ditambahkan.${saldo}`;
  tampilSaldo();
  tampil('sLunas');
}

$('#btnSalin').addEventListener('click', async () => {
  await navigator.clipboard.writeText(order.sandboxQrUrl);
  $('#btnSalin').textContent = '✓ Tersalin';
  setTimeout(() => ($('#btnSalin').textContent = 'Salin alamat QR'), 1500);
});
$('#btnUlang').addEventListener('click', mulai);
$('#btnCoba').addEventListener('click', () => (paket.length ? mulai() : muatPaket()));
$('#btnSelesai').addEventListener('click', () => window.close());
$('#btnLagi').addEventListener('click', () => {
  dipilih = null;
  order = null;
  gambarPaket();
  tampil('sPilih');
});

tampilSaldo();
muatPaket();
