// Tes pembelian Premium tanpa MySQL dan tanpa Midtrans: keduanya diganti versi palsu di memori.
const test = require('node:test');
const assert = require('node:assert');
const { buatPesanan, cekPesanan, publicOrder } = require('../lib/premium');
const { chargeQris, cekStatus } = require('../lib/midtrans');

process.env.PREMIUM_PRICE = '25000';
process.env.PREMIUM_DAYS = '30';

function storePalsu() {
  const orders = new Map();
  const users = new Map();
  return {
    orders, users,
    async insertOrder(o) {
      orders.set(o.orderId, { order_id: o.orderId, user_id: o.userId, amount: o.amount, days: o.days, status: 'pending',
        qr_url: o.qrUrl, expires_at: o.expiresAt, paid_at: null, created_at: new Date() });
      return { ...orders.get(o.orderId) };
    },
    async findOrder(id) { return orders.has(id) ? { ...orders.get(id) } : null; },
    async findPendingOrder(userId, now) {
      return [...orders.values()].find((o) => o.user_id === userId && o.status === 'pending' && o.expires_at > now) || null;
    },
    async setOrderStatus(id, status) { const o = orders.get(id); if (o.status === 'pending') o.status = status; },
    async payOrderAndActivate(id, userId, d) {
      const o = orders.get(id);
      if (o.status !== 'pending') return false;
      Object.assign(o, { status: 'paid', paid_at: d.paidAt });
      users.set(userId, { plan: 'premium', premium_until: d.premiumUntil, credit_left: d.creditLeft, credit_reset_at: d.creditResetAt });
      return true;
    }
  };
}

function midtransPalsu(jawab = { status: 'pending', amount: 25000 }) {
  const charge = [];
  return {
    charge, jawab,
    async chargeQris(d) { charge.push(d); return { qrUrl: 'https://api.sandbox.midtrans.com/v2/qris/x/qr-code', qrString: '000201' }; },
    async cekStatus() { return this.jawab; }
  };
}

const T0 = new Date('2026-11-01T10:00:00Z');
const userFree = { id: 5, plan: 'free', premium_until: null, credit_left: 3 };

test('pesanan baru: harga dari .env, QR berlaku 15 menit, dibuat sekali di Midtrans', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const o = await buatPesanan(userFree, { store, midtrans, now: () => T0 });
  assert.strictEqual(o.amount, 25000);
  assert.strictEqual(o.days, 30);
  assert.strictEqual(o.status, 'pending');
  assert.strictEqual(new Date(o.expires_at).getTime() - T0.getTime(), 15 * 60 * 1000);
  assert.deepStrictEqual(midtrans.charge, [{ orderId: o.order_id, amount: 25000, minutes: 15 }]);
  // Dibuka lagi sebelum kedaluwarsa: pesanan yang sama dipakai, tidak membuat QR baru.
  const lagi = await buatPesanan(userFree, { store, midtrans, now: () => new Date(T0.getTime() + 60000) });
  assert.strictEqual(lagi.order_id, o.order_id);
  assert.strictEqual(midtrans.charge.length, 1);
});

test('A4: akun yang masih Premium tidak bisa membeli lagi', async () => {
  const user = { id: 6, plan: 'premium', premium_until: new Date('2026-12-01T00:00:00Z') };
  await assert.rejects(buatPesanan(user, { store: storePalsu(), midtrans: midtransPalsu(), now: () => T0 }), { code: 'ALREADY_PREMIUM' });
});

test('Midtrans menyatakan lunas: pesanan paid dan Premium aktif 30 hari dengan 100 credit', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const o = await buatPesanan(userFree, { store, midtrans, now: () => T0 });
  midtrans.jawab = { status: 'paid', amount: 25000 };
  const t = new Date(T0.getTime() + 5 * 60000);
  const r = await cekPesanan(userFree, o.order_id, { store, midtrans, now: () => t });
  assert.strictEqual(r.activated, true);
  assert.strictEqual(r.order.status, 'paid');
  const u = store.users.get(5);
  assert.strictEqual(u.plan, 'premium');
  assert.strictEqual(u.credit_left, 100);
  assert.strictEqual(u.premium_until.getTime() - t.getTime(), 30 * 24 * 3600 * 1000);
  // Dicek lagi: tidak mengaktifkan dua kali, tidak bertanya ke Midtrans lagi.
  midtrans.cekStatus = async () => { throw new Error('tidak boleh dipanggil'); };
  const lagi = await cekPesanan(userFree, o.order_id, { store, midtrans, now: () => t });
  assert.strictEqual(lagi.order.status, 'paid');
  assert.strictEqual(lagi.activated, undefined);
});

test('A3: jumlah bayar tidak cocok -> Premium tidak diaktifkan', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const o = await buatPesanan(userFree, { store, midtrans, now: () => T0 });
  midtrans.jawab = { status: 'paid', amount: 1000 };
  await assert.rejects(cekPesanan(userFree, o.order_id, { store, midtrans, now: () => T0 }), { code: 'PAYMENT_MISMATCH' });
  assert.strictEqual(store.users.size, 0);
  assert.strictEqual(store.orders.get(o.order_id).status, 'failed');
});

test('A1/A2: dibatalkan atau kedaluwarsa -> tidak aktif; lewat 15 menit dianggap kedaluwarsa', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const o = await buatPesanan(userFree, { store, midtrans, now: () => T0 });
  const r = await cekPesanan(userFree, o.order_id, { store, midtrans, now: () => new Date(T0.getTime() + 16 * 60000) });
  assert.strictEqual(r.order.status, 'expired');
  assert.strictEqual(publicOrder(r.order).status, 'expired');

  const store2 = storePalsu(), m2 = midtransPalsu({ status: 'failed', amount: 25000 });
  const o2 = await buatPesanan(userFree, { store: store2, midtrans: m2, now: () => T0 });
  const r2 = await cekPesanan(userFree, o2.order_id, { store: store2, midtrans: m2, now: () => T0 });
  assert.strictEqual(r2.order.status, 'failed');
  assert.strictEqual(store2.users.size, 0);
});

test('pesanan milik akun lain tidak bisa dicek', async () => {
  const store = storePalsu(), midtrans = midtransPalsu();
  const o = await buatPesanan(userFree, { store, midtrans, now: () => T0 });
  await assert.rejects(cekPesanan({ id: 99, plan: 'free' }, o.order_id, { store, midtrans, now: () => T0 }), { code: 'ORDER_NOT_FOUND' });
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
