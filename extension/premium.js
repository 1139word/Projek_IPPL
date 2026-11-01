// Halaman pembayaran Premium (UC-08), dibuka di tab dari popup.
// Alur: minta pesanan ke backend -> tampilkan QR dan hitung mundur -> tanya status setiap 3 detik.
// Halaman ini tidak pernah memutuskan sendiri bahwa pembayaran berhasil: yang memutuskan backend,
// setelah bertanya ke Midtrans (NFR-20). Semua permintaan lewat background.js (membawa token sesi).

const $ = (sel) => document.querySelector(sel);
const rupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
const tanggal = (iso) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
const CEK_MS = 3000;

let order = null;
let timerId = null;
let cekId = null;

function tampil(id) {
  for (const s of ['sMuat', 'sQr', 'sLunas', 'sHabis', 'sGagal']) $('#' + s).hidden = s !== id;
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

// Isi kolom Free dan Premium dari server (harga dan kuota yang sama dengan popup).
async function muatPaket() {
  const res = await chrome.runtime.sendMessage({ type: 'plans' });
  if (!res || !res.ok) return;
  const { free, premium } = res.plans;
  const daftar = (el, items) => $(el).replaceChildren(...items.map((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    return li;
  }));
  daftar('#fiturFree', [`${free.quota} credit per minggu`, ...free.features]);
  daftar('#fiturPremium', [`${premium.quota} credit per minggu`, ...premium.features]);
  $('#hargaPremium').textContent = rupiah(premium.price) + ' ';
  const per = document.createElement('span');
  per.className = 'note';
  per.textContent = `/ ${premium.days} hari`;
  $('#hargaPremium').append(per);
}

function hitungMundur() {
  const sisa = Math.max(0, Date.parse(order.expiresAt) - Date.now());
  const m = Math.floor(sisa / 60000), d = Math.floor((sisa % 60000) / 1000);
  $('#timer').textContent = `${String(m).padStart(2, '0')}:${String(d).padStart(2, '0')}`;
  $('#timer').classList.toggle('mepet', sisa < 60000);
  // Waktu habis: tanya status sekali lagi (siapa tahu dibayar tepat di detik terakhir).
  if (sisa === 0) { clearInterval(timerId); cekStatus(); }
}

async function mulai() {
  berhenti();
  tampil('sMuat');
  const res = await chrome.runtime.sendMessage({ type: 'order-create' });
  if (!res || !res.ok) {
    if (res && res.code === 'ALREADY_PREMIUM') return selesai(res.user);
    return gagal(res && res.message);
  }
  order = res.order;
  $('#orderId').textContent = `ID pesanan: ${order.orderId}`;
  const qr = await chrome.runtime.sendMessage({ type: 'order-qr', orderId: order.orderId });
  if (!qr || !qr.ok) return gagal(qr && qr.message);
  $('#qrImg').src = qr.dataUrl;
  $('#sandbox').hidden = !order.sandboxQrUrl;
  tampil('sQr');
  hitungMundur();
  timerId = setInterval(hitungMundur, 1000);
  cekId = setTimeout(cekStatus, CEK_MS);
}

async function cekStatus() {
  clearTimeout(cekId);
  const res = await chrome.runtime.sendMessage({ type: 'order-status', orderId: order.orderId });
  if (res && res.ok) {
    const s = res.order.status;
    if (s === 'paid') return selesai(res.user);
    if (s === 'expired' || s === 'failed') {
      berhenti();
      $('#habisJudul').textContent = s === 'expired' ? 'Waktu pembayaran habis' : 'Pembayaran dibatalkan atau gagal';
      $('#habisNote').textContent = 'Premium tidak diaktifkan dan tidak ada biaya yang terpotong.';
      return tampil('sHabis');
    }
  } else if (res && res.code === 'PAYMENT_MISMATCH') {
    return gagal(res.message); // A3: jangan aktifkan, jangan lanjut bertanya
  }
  // Masih menunggu, atau gangguan sementara (server/Midtrans): tanya lagi nanti.
  if (Date.now() < Date.parse(order.expiresAt) + 30000) cekId = setTimeout(cekStatus, CEK_MS);
}

function selesai(user) {
  berhenti();
  $('#lunasNote').textContent = user && user.premiumUntil
    ? `Premium aktif sampai ${tanggal(user.premiumUntil)}. Credit mingguan Anda sekarang ${user.credit.left} / ${user.credit.quota}.`
    : 'Premium Anda sudah aktif.';
  tampil('sLunas');
}

$('#btnSalin').addEventListener('click', async () => {
  await navigator.clipboard.writeText(order.sandboxQrUrl);
  $('#btnSalin').textContent = '✓ Tersalin';
  setTimeout(() => ($('#btnSalin').textContent = 'Salin alamat QR'), 1500);
});
$('#btnUlang').addEventListener('click', mulai);
$('#btnCoba').addEventListener('click', mulai);
$('#btnSelesai').addEventListener('click', () => window.close());

muatPaket();
mulai();
