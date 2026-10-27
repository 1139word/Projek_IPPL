// Uji koneksi backend ke MySQL memakai akun di backend/.env.
// Menjalankan (dari folder backend):  npm run cek-db

const { pool } = require('../lib/db');

// Membandingkan DB_PASSWORD yang dipakai Node dengan yang tertulis di file .env (hanya panjangnya).
function cekFileEnv(pwDipakai) {
  const fs = require('fs');
  const path = require('path');
  let isi;
  try { isi = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8'); } catch { return; }
  const baris = isi.split(/\r?\n/)
    .map((teks, i) => ({ no: i + 1, teks }))
    .filter((b) => /^\s*DB_PASSWORD\s*=/.test(b.teks));
  for (const b of baris) {
    const nilai = b.teks.slice(b.teks.indexOf('=') + 1);
    console.log(`  Di file .env baris ${b.no}: DB_PASSWORD ${nilai.length} karakter`);
  }
  if (baris.length > 1) console.log('  Ada lebih dari satu baris DB_PASSWORD. Sisakan satu saja');
  const terakhir = baris.length ? baris[baris.length - 1].teks.split('=').slice(1).join('=') : null;
  if (terakhir !== null && terakhir.trim() !== pwDipakai.trim()) {
    console.log('  Nilai yang dipakai Node BERBEDA dengan isi file .env.');
    console.log('  Kemungkinan DB_PASSWORD sudah ada sebagai environment variable Windows (Node tidak menimpanya).');
  }
}

async function main() {
  try {
    const [[info]] = await pool.query('SELECT CURRENT_USER() AS akun, DATABASE() AS db, VERSION() AS versi');
    console.log(`✓ Terhubung sebagai ${info.akun} ke database ${info.db} (MySQL ${info.versi})`);

    const [tabel] = await pool.query('SHOW TABLES');
    console.log('✓ Tabel:', tabel.map((t) => Object.values(t)[0]).join(', ') || '(kosong)');

    const [[jumlah]] = await pool.query('SELECT COUNT(*) AS n FROM users');
    console.log(`✓ Jumlah pengguna: ${jumlah.n}`);
  } catch (e) {
    console.log(`✗ Gagal [${e.code || 'ERROR'}]: ${e.message}`);
    if (e.code === 'ER_ACCESS_DENIED_ERROR') {
      // Tampilkan ciri password yang terbaca dari .env tanpa menampilkan isinya.
      const pw = process.env.DB_PASSWORD || '';
      console.log(`  DB_USER terbaca: "${process.env.DB_USER}", DB_PASSWORD terbaca: ${pw.length} karakter`);
      if (pw !== pw.trim()) console.log('  DB_PASSWORD diawali/diakhiri spasi. Hapus spasinya');
      if (/^["']|["']$/.test(pw)) console.log('  DB_PASSWORD memakai tanda kutip yang ikut terbaca. Hapus tanda kutipnya');
      cekFileEnv(pw);
      console.log('  Pastikan backend/.env sudah disimpan (Ctrl+S) dan isinya sama dengan password akun MySQL');
    }
    if (e.code === 'ECONNREFUSED') console.log('  Server MySQL belum jalan. Cek dengan: Get-Service MySQL*');
    if (e.code === 'ER_BAD_DB_ERROR') console.log('  Database belum dibuat. Jalankan backend/db/schema.sql sebagai root');
    if (e.code === 'MODULE_NOT_FOUND') console.log('  Library belum terpasang. Jalankan: npm install');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
