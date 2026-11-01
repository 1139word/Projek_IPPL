// Melepas fitur File Explorer: hapus menu klik kanan dan pendaftaran native host dari registry,
// lalu hapus folder explorer-host/terpasang. Jalankan: node scripts/lepas-file-explorer.js

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
fs.rmSync(path.resolve(__dirname, '..', 'explorer-host', 'terpasang'), { recursive: true, force: true });
console.log('Fitur File Explorer dilepas.');
