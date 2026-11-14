// Tes aturan credit tanpa MySQL: penyimpanan diganti versi palsu di memori.
// Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const { checkCredit, chargeCredit } = require('../lib/credit');

const akun = (left, id = 1) => ({ id, credit_left: left });

// Meniru UPDATE ... SET credit_left = credit_left - ? WHERE id = ? AND credit_left >= ?
function storePalsu(users) {
  return {
    async useCredit(id, cost) {
      const u = users.find((x) => x.id === id);
      if (u.credit_left < cost) return false;
      u.credit_left -= cost;
      return true;
    }
  };
}

test('biaya empat model: Gemini 3.1 Pro 2 credit, lainnya 1 credit', () => {
  assert.strictEqual(checkCredit(akun(10), 'flash-lite'), 1);
  assert.strictEqual(checkCredit(akun(10), 'deepseek'), 1);
  assert.strictEqual(checkCredit(akun(10), 'flash'), 1);
  assert.strictEqual(checkCredit(akun(10), 'pro'), 2);
  // Semua akun boleh memakai semua model; yang membatasi hanya saldo.
  assert.strictEqual(checkCredit(akun(2), 'pro'), 2);
});

test('kode model lama (std/adv) masih diterima dan diarahkan ke model baru', () => {
  assert.strictEqual(checkCredit(akun(10), 'std'), 1);
  assert.strictEqual(checkCredit(akun(10), 'adv'), 1);
});

test('asal permintaan: halaman dan File Explorer boleh untuk semua akun, lainnya ditolak', () => {
  assert.strictEqual(checkCredit(akun(10), 'std', { source: 'page' }), 1);
  assert.strictEqual(checkCredit(akun(10), 'std', { source: 'explorer' }), 1);
  assert.throws(() => checkCredit(akun(10), 'std', { source: 'lain' }), { code: 'BAD_REQUEST', status: 400 });
});

test('credit kurang dari biaya ditolak sebelum menerjemahkan', () => {
  assert.throws(() => checkCredit(akun(0), 'flash-lite'), { code: 'NO_CREDIT', status: 402 });
  assert.throws(() => checkCredit(akun(0), 'deepseek'), { code: 'NO_CREDIT' });
});

test('sisa 1 credit tidak cukup untuk Gemini 3.1 Pro, pesannya menyebut biayanya', () => {
  assert.throws(() => checkCredit(akun(1), 'pro'), (e) => e.code === 'NO_CREDIT' && /butuh 2 credit, sisa 1/.test(e.message));
  assert.strictEqual(checkCredit(akun(1), 'flash'), 1); // model 1 credit masih bisa
});

test('model yang tidak dikenal ditolak', () => {
  assert.throws(() => checkCredit(akun(10), 'gratis'), { code: 'BAD_REQUEST', status: 400 });
  assert.throws(() => checkCredit(akun(10), 'toString'), { code: 'BAD_REQUEST' }); // bukan model, walau ada di objek bawaan JS
});

test('credit dipotong sesuai biaya model', async () => {
  const users = [akun(10, 1), akun(100, 2)];
  const store = storePalsu(users);
  // Salinan, seperti req.user yang dibaca dari database sebelum dipotong.
  assert.strictEqual((await chargeCredit({ ...users[0] }, 'flash-lite', { store })).credit_left, 9);
  assert.strictEqual((await chargeCredit({ ...users[1] }, 'pro', { store })).credit_left, 98);
  assert.strictEqual(users[0].credit_left, 9);
});

test('dua terjemahan bersamaan dengan sisa 1 credit tidak membuat credit minus', async () => {
  const users = [akun(1)];
  const store = storePalsu(users);
  const dibaca = { ...users[0] }; // keduanya sudah lolos checkCredit dengan sisa 1
  await Promise.all([chargeCredit(dibaca, 'flash', { store }), chargeCredit(dibaca, 'flash', { store })]);
  assert.strictEqual(users[0].credit_left, 0);
});
