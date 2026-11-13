// Tes paket credit dan pembeliannya tanpa MySQL dan tanpa Midtrans: keduanya diganti versi palsu di memori.
const test = require('node:test');
const assert = require('node:assert');
const { daftarPaket, buatPesanan, cekPesanan, publicOrder } = require('../lib/pembelian');
const { chargeQris, cekStatus } = require('../lib/midtrans');

const PAKET = [
  { id: 1, name: 'Paket 30', credits: 30, price: 10000, active: true },
  { id: 2, name: 'Paket 100', credits: 100, price: 30000, active: true },
  { id: 3, name: 'Paket 250', credits: 250, price: 65000, active: true },
  { id: 4, name: 'Paket lama', credits: 500, price: 99000, active: false }
];

// Penyimpanan palsu dengan method yang sama seperti lib/order-store.js.
// saldo = credit_left tiap pengguna, supaya penambahan credit bisa diperiksa.
function storePalsu(saldo = { 5: 3 }) {
  const orders = new Map();
  return {
    orders, saldo,
    async listPackages() { return PAKET.filter((p) => p.active).sort((a, b) => a.credits - b.credits); },
    async findPackage(id) { return PAKET.find((p) => p.id === id && p.active) || null; },
    async insertOrder(o) {
      orders.set(o.orderId, { order_id: o.orderId, user_id: o.userId, package_id: o.packageId, amount: o.amount, credits: o.credits,
        status: 'pending', qr_url: o.qrUrl, expires_at: o.expiresAt, paid_at: null, created_at: new Date() });
      return { ...orders.get(o.orderId) };
    },
    async findOrder(id) { return orders.has(id) ? { ...orders.get(id) } : null; },
    async findPendingOrder(userId, packageId, now) {
      return [...orders.values()].find((o) => o.user_id === userId && o.package_id === packageId && o.status === 'pending' && o.expires_at > now) || null;
    },
    async setOrderStatus(id, status) { const o = orders.get(id); if (o.status === 'pending') o.status = status; },
    async payOrderAndAddCredit(id, userId, d) {
      const o = orders.get(id);
      if (o.status !== 'pending') return false;
      Object.assign(o, { status: 'paid', paid_at: d.paidAt });
      saldo[userId] = (saldo[userId] || 0) + d.credits;
      return true;
    }
  };
}

function midtransPalsu(jawab = { status: 'pending', amount: 10000 }) {
  const charge = [];
  return {
    charge, jawab,
    async chargeQris(d) { charge.push(d); return { qrUrl: 'https://api.sandbox.midtrans.com/v2/qris/x/qr-code', qrString: '000201' }; },
    async cekStatus() { return this.jawab; }
  };
}

const T0 = new Date('2026-11-13T10:00:00Z');
const user = { id: 5, credit_left: 3 };

test('daftar paket: hanya paket aktif, urut dari yang terkecil, tanpa kolom internal', async () => {
  const paket = await daftarPaket({ store: storePalsu() });
  assert.deepStrictEqual(paket, [
    { id: 1, name: 'Paket 30', credits: 30, price: 10000 },
    { id: 2, name: 'Paket 100', credits: 100, price: 30000 },
    { id: 3, name: 'Paket 250', credits: 250, price: 65000 }
  ]);
});

test('pesanan baru: harga dan credit disalin dari paket, QR berlaku 15 menit, dibuat sekali di Midtrans', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const o = await buatPesanan(user, 2, { store, midtrans, now: () => T0 });
  assert.strictEqual(o.package_id, 2);
  assert.strictEqual(o.amount, 30000);
  assert.strictEqual(o.credits, 100);
  assert.strictEqual(o.status, 'pending');
  assert.strictEqual(new Date(o.expires_at).getTime() - T0.getTime(), 15 * 60 * 1000);
  assert.deepStrictEqual(midtrans.charge, [{ orderId: o.order_id, amount: 30000, minutes: 15 }]);
  // Paket yang sama dibuka lagi sebelum kedaluwarsa: pesanan yang sama dipakai, tidak membuat QR baru.
  const lagi = await buatPesanan(user, 2, { store, midtrans, now: () => new Date(T0.getTime() + 60000) });
  assert.strictEqual(lagi.order_id, o.order_id);
  assert.strictEqual(midtrans.charge.length, 1);
  // Paket lain: pesanan baru dengan QR sendiri.
  const lain = await buatPesanan(user, 1, { store, midtrans, now: () => new Date(T0.getTime() + 120000) });
  assert.notStrictEqual(lain.order_id, o.order_id);
  assert.strictEqual(lain.amount, 10000);
  assert.strictEqual(midtrans.charge.length, 2);
});

test('paket tidak dipilih, tidak ada, atau tidak dijual lagi ditolak tanpa menghubungi Midtrans', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const deps = { store, midtrans, now: () => T0 };
  await assert.rejects(buatPesanan(user, undefined, deps), { code: 'BAD_REQUEST', status: 400 });
  await assert.rejects(buatPesanan(user, 'abc', deps), { code: 'BAD_REQUEST' });
  await assert.rejects(buatPesanan(user, 99, deps), { code: 'PACKAGE_NOT_FOUND', status: 404 });
  await assert.rejects(buatPesanan(user, 4, deps), { code: 'PACKAGE_NOT_FOUND' });
  assert.strictEqual(midtrans.charge.length, 0);
  assert.strictEqual(store.orders.size, 0);
});

test('Midtrans menyatakan lunas: pesanan paid dan credit ditambahkan ke saldo lama', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const o = await buatPesanan(user, 1, { store, midtrans, now: () => T0 });
  midtrans.jawab = { status: 'paid', amount: 10000 };
  const t = new Date(T0.getTime() + 5 * 60000);
  const r = await cekPesanan(user, o.order_id, { store, midtrans, now: () => t });
  assert.strictEqual(r.credited, true);
  assert.strictEqual(r.order.status, 'paid');
  assert.strictEqual(store.saldo[5], 33); // 3 credit lama + 30, bukan diganti menjadi 30
  // Dicek lagi: tidak menambah dua kali, tidak bertanya ke Midtrans lagi.
  midtrans.cekStatus = async () => { throw new Error('tidak boleh dipanggil'); };
  const lagi = await cekPesanan(user, o.order_id, { store, midtrans, now: () => t });
  assert.strictEqual(lagi.order.status, 'paid');
  assert.strictEqual(lagi.credited, undefined);
  assert.strictEqual(store.saldo[5], 33);
});

test('membeli beberapa kali: credit menumpuk dan akun yang masih punya credit tetap boleh membeli', async () => {
  const store = storePalsu({ 5: 40 }), midtrans = midtransPalsu();
  const a = await buatPesanan(user, 1, { store, midtrans, now: () => T0 });
  midtrans.jawab = { status: 'paid', amount: 10000 };
  await cekPesanan(user, a.order_id, { store, midtrans, now: () => T0 });
  const t2 = new Date(T0.getTime() + 60000);
  const b = await buatPesanan(user, 3, { store, midtrans, now: () => t2 });
  midtrans.jawab = { status: 'paid', amount: 65000 };
  await cekPesanan(user, b.order_id, { store, midtrans, now: () => t2 });
  assert.strictEqual(store.saldo[5], 40 + 30 + 250);
});

test('jumlah bayar tidak cocok -> credit tidak ditambahkan', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const o = await buatPesanan(user, 1, { store, midtrans, now: () => T0 });
  midtrans.jawab = { status: 'paid', amount: 1000 };
  await assert.rejects(cekPesanan(user, o.order_id, { store, midtrans, now: () => T0 }), { code: 'PAYMENT_MISMATCH' });
  assert.strictEqual(store.saldo[5], 3);
  assert.strictEqual(store.orders.get(o.order_id).status, 'failed');
});

test('dibatalkan atau kedaluwarsa -> credit tetap; lewat 15 menit dianggap kedaluwarsa', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const o = await buatPesanan(user, 1, { store, midtrans, now: () => T0 });
  const r = await cekPesanan(user, o.order_id, { store, midtrans, now: () => new Date(T0.getTime() + 16 * 60000) });
  assert.strictEqual(r.order.status, 'expired');
  assert.strictEqual(publicOrder(r.order).status, 'expired');
  assert.strictEqual(store.saldo[5], 3);

  const store2 = storePalsu(), m2 = midtransPalsu({ status: 'failed', amount: 10000 });
  const o2 = await buatPesanan(user, 1, { store: store2, midtrans: m2, now: () => T0 });
  const r2 = await cekPesanan(user, o2.order_id, { store: store2, midtrans: m2, now: () => T0 });
  assert.strictEqual(r2.order.status, 'failed');
  assert.strictEqual(store2.saldo[5], 3);
});

test('pesanan milik akun lain tidak bisa dicek', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const o = await buatPesanan(user, 1, { store, midtrans, now: () => T0 });
  await assert.rejects(cekPesanan({ id: 99, credit_left: 0 }, o.order_id, { store, midtrans, now: () => T0 }), { code: 'ORDER_NOT_FOUND' });
});

test('data pesanan untuk extension memuat paket dan jumlah credit', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const p = publicOrder(await buatPesanan(user, 3, { store, midtrans, now: () => T0 }));
  assert.strictEqual(p.packageId, 3);
  assert.strictEqual(p.credits, 250);
  assert.strictEqual(p.amount, 65000);
  assert.strictEqual(p.expiresAt, new Date(T0.getTime() + 15 * 60000).toISOString());
});

// ---- midtrans.js dengan fetch palsu ----
function fetchPalsu(jawaban, catat = []) {
  return async (url, opt) => {
    catat.push({ url, opt });
    return { status: 200, ok: true, json: async () => jawaban };
  };
}

test('chargeQris mengirim permintaan QRIS ke Sandbox dengan Basic Auth Server Key', async () => {
  process.env.MIDTRANS_SERVER_KEY = 'SB-Mid-server-contoh';
  delete process.env.MIDTRANS_PRODUCTION;
  const catat = [];
  const hasil = await chargeQris({ orderId: 'IT-1-a', amount: 25000, minutes: 15 }, {
    fetchFn: fetchPalsu({ status_code: '201', transaction_status: 'pending', qr_string: '0002',
      actions: [{ name: 'generate-qr-code', url: 'https://api.sandbox.midtrans.com/v2/qris/abc/qr-code' }] }, catat)
  });
  assert.strictEqual(hasil.qrUrl, 'https://api.sandbox.midtrans.com/v2/qris/abc/qr-code');
  assert.strictEqual(catat[0].url, 'https://api.sandbox.midtrans.com/v2/charge');
  assert.strictEqual(catat[0].opt.headers.Authorization, 'Basic ' + Buffer.from('SB-Mid-server-contoh:').toString('base64'));
  const body = JSON.parse(catat[0].opt.body);
  assert.strictEqual(body.payment_type, 'qris');
  assert.deepStrictEqual(body.transaction_details, { order_id: 'IT-1-a', gross_amount: 25000 });
});

test('cekStatus menerjemahkan status Midtrans', async () => {
  process.env.MIDTRANS_SERVER_KEY = 'SB-Mid-server-contoh';
  const cek = (j) => cekStatus('IT-1-a', { fetchFn: fetchPalsu(j) });
  assert.deepStrictEqual(await cek({ status_code: '200', transaction_status: 'settlement', gross_amount: '25000.00' }), { status: 'paid', amount: 25000 });
  assert.strictEqual((await cek({ status_code: '201', transaction_status: 'pending', gross_amount: '25000.00' })).status, 'pending');
  assert.strictEqual((await cek({ status_code: '407', transaction_status: 'expire', gross_amount: '25000.00' })).status, 'expired');
  assert.strictEqual((await cek({ status_code: '202', transaction_status: 'cancel', gross_amount: '25000.00' })).status, 'failed');
  assert.strictEqual((await cek({ status_code: '404', status_message: "Transaction doesn't exist." })).status, 'notfound');
});

test('tanpa MIDTRANS_SERVER_KEY muncul pesan yang jelas', async () => {
  delete process.env.MIDTRANS_SERVER_KEY;
  await assert.rejects(cekStatus('x', { fetchFn: fetchPalsu({}) }), { code: 'CONFIG' });
});
