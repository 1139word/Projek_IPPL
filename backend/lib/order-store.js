// Perintah SQL untuk paket credit dan pesanan. pembelian.js tidak menulis SQL sendiri,
// jadi di tes file ini bisa diganti penyimpanan palsu di memori.

const { pool } = require('./db');

const orderStore = {
  // Paket yang sedang dijual, dari yang paling kecil.
  async listPackages() {
    const [rows] = await pool.query('SELECT id, name, credits, price FROM credit_packages WHERE active = TRUE ORDER BY credits');
    return rows;
  },

  async findPackage(packageId) {
    const [rows] = await pool.query('SELECT id, name, credits, price FROM credit_packages WHERE id = ? AND active = TRUE', [packageId]);
    return rows[0] || null;
  },

  async insertOrder({ orderId, userId, packageId, amount, credits, expiresAt, qrUrl }) {
    await pool.query(
      "INSERT INTO orders (order_id, user_id, package_id, amount, credits, status, qr_url, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
      [orderId, userId, packageId, amount, credits, qrUrl, expiresAt]
    );
    return this.findOrder(orderId);
  },

  async findOrder(orderId) {
    const [rows] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    return rows[0] || null;
  },

  // Pesanan paket yang sama yang masih menunggu pembayaran dan belum lewat batas waktu.
  async findPendingOrder(userId, packageId, now) {
    const [rows] = await pool.query(
      "SELECT * FROM orders WHERE user_id = ? AND package_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
      [userId, packageId, now]
    );
    return rows[0] || null;
  },

  // Semua pesanan pending milik pengguna, termasuk yang sudah lewat batas waktu (untuk dicek ulang ke Midtrans).
  // Dibatasi 5 terbaru supaya membuka popup tidak memicu banyak panggilan ke Midtrans.
  async findPendingOrders(userId) {
    const [rows] = await pool.query(
      "SELECT * FROM orders WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 5",
      [userId]
    );
    return rows;
  },

  // Hanya pesanan yang masih pending yang boleh berubah status.
  async setOrderStatus(orderId, status) {
    await pool.query("UPDATE orders SET status = ? WHERE order_id = ? AND status = 'pending'", [status, orderId]);
  },

  // Tandai lunas DAN tambah credit dalam satu transaksi database: keduanya berhasil, atau tidak sama sekali.
  // Syarat status = 'pending' mencegah credit ditambahkan dua kali bila dua pengecekan datang bersamaan.
  // "credit_left = credit_left + ?" dihitung oleh database, jadi credit lama tidak hilang (menumpuk).
  async payOrderAndAddCredit(orderId, userId, { credits, paidAt }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [res] = await conn.query(
        "UPDATE orders SET status = 'paid', paid_at = ? WHERE order_id = ? AND status = 'pending'",
        [paidAt, orderId]
      );
      if (res.affectedRows !== 1) {
        await conn.rollback();
        return false;
      }
      await conn.query('UPDATE users SET credit_left = credit_left + ? WHERE id = ?', [credits, userId]);
      await conn.commit();
      return true;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
};

module.exports = { orderStore };
