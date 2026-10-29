// Tes aturan credit tanpa MySQL: penyimpanan diganti versi palsu di memori.
// Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const { checkCredit, chargeCredit } = require('../lib/credit');

const free = (left) => ({ id: 1, plan: 'free', credit_left: left });
const premium = (left) => ({ id: 2, plan: 'premium', credit_left: left });

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

test('Standar butuh 1 credit, Advanced 2 credit', () => {
  assert.strictEqual(checkCredit(free(10), 'std'), 1);
  assert.strictEqual(checkCredit(premium(10), 'adv'), 2);
});

test('akun Free tidak boleh memakai Advanced walau credit cukup', () => {
  assert.throws(() => checkCredit(free(10), 'adv'), { code: 'PREMIUM_ONLY', status: 403 });
});

test('credit kurang dari biaya ditolak sebelum menerjemahkan', () => {
  assert.throws(() => checkCredit(free(0), 'std'), { code: 'NO_CREDIT', status: 402 });
  assert.throws(() => checkCredit(premium(1), 'adv'), { code: 'NO_CREDIT' });
});

test('model yang tidak dikenal ditolak', () => {
  assert.throws(() => checkCredit(free(10), 'gratis'), { code: 'BAD_REQUEST', status: 400 });
  assert.throws(() => checkCredit(free(10), 'toString'), { code: 'BAD_REQUEST' }); // bukan model, walau ada di objek bawaan JS
});

test('credit dipotong sesuai biaya model', async () => {
  const users = [free(10), premium(100)];
  const store = storePalsu(users);
  // Salinan, seperti req.user yang dibaca dari database sebelum dipotong.
  assert.strictEqual((await chargeCredit({ ...users[0] }, 'std', { store })).credit_left, 9);
  assert.strictEqual((await chargeCredit({ ...users[1] }, 'adv', { store })).credit_left, 98);
  assert.strictEqual(users[0].credit_left, 9);
});

test('dua terjemahan bersamaan dengan sisa 1 credit tidak membuat credit minus', async () => {
  const users = [free(1)];
  const store = storePalsu(users);
  const dibaca = { ...users[0] }; // keduanya sudah lolos checkCredit dengan sisa 1
  await Promise.all([chargeCredit(dibaca, 'std', { store }), chargeCredit(dibaca, 'std', { store })]);
  assert.strictEqual(users[0].credit_left, 0);
});
