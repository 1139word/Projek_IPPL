// Membersihkan sisa fitur File Explorer lama (fitur itu sudah diganti halaman Unggah Gambar).
// Hanya perlu dijalankan sekali di komputer yang dulu pernah menjalankan pasang-file-explorer.js:
// menghapus menu klik kanan dan pendaftaran native host dari registry, lalu folder explorer-host.
// Jalankan: node scripts/lepas-file-explorer.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KUNCI = [
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.imagetranslator.explorer',
  'HKCU\\Software\\Classes\\SystemFileAssociations\\image\\shell\\ImageTranslator'
];

if (process.platform !== 'win32') {
  console.error('Skrip ini hanya untuk Windows.');
  process.exit(1);
}

for (const k of KUNCI) {
  try {
    execFileSync('reg', ['delete', k, '/f'], { stdio: 'ignore' });
    console.log('Dihapus :', k);
  } catch (e) {
    console.log('Tidak ada:', k);
  }
}
// Folder explorer-host sudah tidak ada di repo; yang tersisa hanya salinan terpasang (diabaikan Git).
fs.rmSync(path.resolve(__dirname, '..', 'explorer-host'), { recursive: true, force: true });
console.log('Sisa fitur File Explorer sudah dibersihkan.');
