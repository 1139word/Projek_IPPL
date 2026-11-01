// Perintah SQL untuk pesanan Premium. premium.js tidak menulis SQL sendiri,
// jadi di tes file ini bisa diganti penyimpanan palsu di memori.

const { pool } = require('./db');

const orderStore = {
  async insertOrder({ orderId, userId, amount, days, expiresAt, qrUrl }) {
    await pool.query(
      "INSERT INTO orders (order_id, user_id, amount, days, status, qr_url, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
      [orderId, userId, amount, days, qrUrl, expiresAt]
    );
    return this.findOrder(orderId);
  },

  async findOrder(orderId) {
    const [rows] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    return rows[0] || null;
  },

  // Pesanan terakhir yang masih menunggu pembayaran dan belum lewat batas waktu.
  async findPendingOrder(userId, now) {
    const [rows] = await pool.query(
      "SELECT * FROM orders WHERE user_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
      [userId, now]
    );
    return rows[0] || null;
  },

  // Pesanan pending terakhir, termasuk yang sudah lewat batas waktu (untuk dicek ulang ke Midtrans).
  async findLatestPending(userId) {
    const [rows] = await pool.query(
      "SELECT * FROM orders WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    return rows[0] || null;
  },

  // Hanya pesanan yang masih pending yang boleh berubah status.
  async setOrderStatus(orderId, status) {
    await pool.query("UPDATE orders SET status = ? WHERE order_id = ? AND status = 'pending'", [status, orderId]);
  },

  // Tandai lunas DAN aktifkan Premium dalam satu transaksi database: keduanya berhasil, atau tidak sama sekali.
  // Syarat status = 'pending' mencegah Premium diaktifkan dua kali bila dua pengecekan datang bersamaan.
  async payOrderAndActivate(orderId, userId, { premiumUntil, creditLeft, creditResetAt, paidAt }) {
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
      await conn.query(
        "UPDATE users SET plan = 'premium', premium_until = ?, credit_left = ?, credit_reset_at = ? WHERE id = ?",
        [premiumUntil, creditLeft, creditResetAt, userId]
      );
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
