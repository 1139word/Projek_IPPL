// Membuat ID extension yang TETAP di semua komputer.
//
// Tanpa "key" di manifest, Chrome membuat ID extension dari lokasi folder. Akibatnya ID berbeda
// di tiap komputer, padahal OAuth Client di Google Cloud hanya menerima satu ID: login di komputer
// lain (teman yang menguji, dosen) akan ditolak. Dengan "key", ID dihitung dari kunci publik,
// sehingga sama di mana pun folder extension berada.
//
// Menjalankan (dari folder utama repo):  node scripts/buat-key-extension.js
// - Pertama kali: membuat pasangan kunci RSA. Kunci privat disimpan di extension-key.pem
//   (RAHASIA, sudah di .gitignore, jangan di-commit). Kunci publik ditulis ke manifest.json.
// - Bila extension-key.pem sudah ada: kunci itu dipakai lagi, jadi ID tidak berubah.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const pemPath = path.join(root, 'extension-key.pem');
const manifestPath = path.join(root, 'extension', 'manifest.json');

// Pengaman: manifest sudah punya "key" tetapi kunci privatnya tidak ada di komputer ini (misalnya
// repo hasil clone). Membuat kunci baru akan MENGGANTI ID extension, dan login Google akan ditolak
// sampai ID baru didaftarkan di Google Cloud. Jadi berhenti, kecuali diminta dengan --baru.
const sudahAdaKey = /^[ \t]*"key":/m.test(fs.readFileSync(manifestPath, 'utf8'));
if (sudahAdaKey && !fs.existsSync(pemPath) && !process.argv.includes('--baru')) {
  console.log('manifest.json sudah berisi "key", jadi ID extension sudah tetap. Tidak ada yang diubah.');
  console.log('Untuk sengaja membuat ID BARU (pemilik proyek saja): node scripts/buat-key-extension.js --baru');
  process.exit(0);
}

let privateKey;
if (fs.existsSync(pemPath)) {
  privateKey = crypto.createPrivateKey(fs.readFileSync(pemPath));
  console.log('Memakai kunci yang sudah ada: extension-key.pem');
} else {
  ({ privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }));
  fs.writeFileSync(pemPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  console.log('Kunci baru dibuat: extension-key.pem (RAHASIA, jangan di-commit)');
}

// Kunci publik dalam format DER (SubjectPublicKeyInfo), ditulis sebagai base64: inilah isi "key".
const der = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const key = der.toString('base64');

// Cara Chrome menghitung ID: SHA-256 dari kunci publik, ambil 32 digit hex pertama,
// lalu tiap digit 0-f diganti huruf a-p.
const id = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

// Tulis/ganti baris "key" tepat setelah "manifest_version", tanpa mengubah format baris lain.
let teks = fs.readFileSync(manifestPath, 'utf8');
const eol = teks.includes('\r\n') ? '\r\n' : '\n';
const baris = `  "key": "${key}",`;
// [^\r\n]* dipakai (bukan .*) supaya pola tidak pernah melewati akhir baris Windows (\r\n).
if (/^[ \t]*"key":[^\r\n]*/m.test(teks)) teks = teks.replace(/^[ \t]*"key":[^\r\n]*/m, baris);
else teks = teks.replace(/^([ \t]*"manifest_version":[^\r\n]*,)/m, `$1${eol}${baris}`);
JSON.parse(teks); // pastikan manifest tetap JSON yang sah sebelum disimpan
fs.writeFileSync(manifestPath, teks);

console.log('Kunci publik sudah ditulis ke extension/manifest.json');
console.log('ID extension sekarang: ' + id);
console.log('Langkah berikutnya: masukkan ID ini sebagai Item ID pada OAuth Client di Google Cloud.');
