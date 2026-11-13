// Semua perintah SQL untuk akun dan sesi ada di sini.
// auth.js tidak menulis SQL sendiri, jadi di tes file ini bisa diganti penyimpanan palsu di memori.

const { pool } = require('./db');

const userStore = {
  async findUserByGoogleSub(sub) {
    const [rows] = await pool.query('SELECT * FROM users WHERE google_sub = ?', [sub]);
    return rows[0] || null;
  },

  // creditLeft = credit awal akun baru (diberikan sekali, saat akun dibuat).
  async insertUser({ googleSub, email, pictureUrl, creditLeft }) {
    const [res] = await pool.query(
      'INSERT INTO users (google_sub, email, picture_url, credit_left) VALUES (?, ?, ?, ?)',
      [googleSub, email, pictureUrl, creditLeft]
    );
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [res.insertId]);
    return rows[0];
  },

  async updateProfile(userId, { email, pictureUrl }) {
    await pool.query('UPDATE users SET email = ?, picture_url = ? WHERE id = ?', [email, pictureUrl, userId]);
  },

  // Kurangi credit hanya bila masih cukup. Dicek dan dikurangi dalam SATU perintah UPDATE,
  // jadi tidak ada celah di antara "baca sisa" dan "tulis sisa baru" (race condition).
  async useCredit(userId, cost) {
    const [res] = await pool.query(
      'UPDATE users SET credit_left = credit_left - ? WHERE id = ? AND credit_left >= ?',
      [cost, userId, cost]
    );
    return res.affectedRows === 1;
  },

  async insertSession({ tokenHash, userId, expiresAt }) {
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [tokenHash, userId, expiresAt]);
  },

  // Sesi beserta data pemiliknya dalam satu query (JOIN).
  async findSession(tokenHash) {
    const [rows] = await pool.query(
      'SELECT s.expires_at AS session_expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
      [tokenHash]
    );
    return rows[0] || null;
  },

  async deleteSession(tokenHash) {
    await pool.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
  }
};

module.exports = { userStore };
