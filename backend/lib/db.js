// Koneksi ke MySQL. Semua file lain memakai `pool` dari sini, bukan membuat koneksi sendiri.
//
// Pool = kumpulan koneksi yang dibuka sekali lalu dipinjamkan bergantian ke tiap permintaan,
// jadi backend tidak perlu login ulang ke MySQL setiap ada terjemahan.

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'image_translator',
  connectionLimit: 10,  // paling banyak 10 koneksi terbuka bersamaan
  timezone: 'Z',        // DATETIME dibaca dan ditulis sebagai UTC, sama di semua laptop
  dateStrings: false
});

module.exports = { pool };
