// Memasang fitur File Explorer (Premium) di Windows, hanya untuk akun Windows yang sedang dipakai (HKCU,
// tidak perlu hak Administrator). Jalankan sekali dari folder proyek:
//     node scripts/pasang-file-explorer.js
// Yang dipasang:
//   1. Native host: file explorer-host/terpasang/host.bat dan manifest JSON-nya, lalu didaftarkan di
//      HKCU\Software\Google\Chrome\NativeMessagingHosts\com.imagetranslator.explorer
//   2. Menu klik kanan "Terjemahkan dengan Image Translator" untuk semua file gambar, di
//      HKCU\Software\Classes\SystemFileAssociations\image\shell\ImageTranslator
// Untuk melepas: node scripts/lepas-file-explorer.js
// Bila folder proyek dipindah, jalankan skrip ini lagi (lokasi file ditulis lengkap di registry).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EXT_ID = 'dnfnbaicahmmahjbpijjcehdoaokkjeg'; // ID tetap dari "key" di manifest.json
const HOST = 'com.imagetranslator.explorer';
const KUNCI_HOST = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST}`;
const KUNCI_MENU = 'HKCU\\Software\\Classes\\SystemFileAssociations\\image\\shell\\ImageTranslator';

if (process.platform !== 'win32') {
  console.error('Skrip ini hanya untuk Windows.');
  process.exit(1);
}

function reg(...args) {
  execFileSync('reg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

// Cari chrome.exe: dari daftar "App Paths" Windows dulu, lalu lokasi pemasangan yang umum.
function cariChrome() {
  for (const akar of ['HKCU', 'HKLM']) {
    try {
      const out = execFileSync('reg', ['query', `${akar}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe`, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = /REG_(?:EXPAND_)?SZ\s+(.+\.exe)/i.exec(out);
      if (m && fs.existsSync(m[1].trim())) return m[1].trim();
    } catch (e) { /* tidak ada di kunci ini */ }
  }
  const calon = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return calon.find((p) => fs.existsSync(p)) || null;
}

const chrome = cariChrome();
if (!chrome) {
  console.error('chrome.exe tidak ditemukan. Pastikan Google Chrome terpasang.');
  process.exit(1);
}

const akarProyek = path.resolve(__dirname, '..');
const hostJs = path.join(akarProyek, 'explorer-host', 'host.js');
const folder = path.join(akarProyek, 'explorer-host', 'terpasang'); // di-.gitignore: berisi lokasi lengkap di laptop ini
fs.mkdirSync(folder, { recursive: true });

// host.bat memanggil node.exe yang sama dengan yang menjalankan skrip ini (lokasi lengkap),
// supaya tetap jalan walau Chrome dibuka tanpa PATH yang berisi Node.
const bat = path.join(folder, 'host.bat');
fs.writeFileSync(bat, `@echo off\r\n"${process.execPath}" "${hostJs}" %*\r\n`);

const manifestHost = path.join(folder, `${HOST}.json`);
fs.writeFileSync(manifestHost, JSON.stringify({
  name: HOST,
  description: 'Image Translator: membaca file gambar yang dipilih dari File Explorer',
  path: bat,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${EXT_ID}/`] // hanya extension ini yang boleh memakai host
}, null, 2));

reg('add', KUNCI_HOST, '/ve', '/t', 'REG_SZ', '/d', manifestHost, '/f');

// %1 = lokasi file yang diklik kanan; Windows menggantinya saat menu dipilih.
const perintah = `"${chrome}" "chrome-extension://${EXT_ID}/viewer.html?path=%1"`;
reg('add', KUNCI_MENU, '/ve', '/t', 'REG_SZ', '/d', 'Terjemahkan dengan Image Translator', '/f');
reg('add', KUNCI_MENU, '/v', 'Icon', '/t', 'REG_SZ', '/d', `${chrome},0`, '/f');
reg('add', KUNCI_MENU + '\\command', '/ve', '/t', 'REG_SZ', '/d', perintah, '/f');

console.log('Fitur File Explorer terpasang.');
console.log('  Chrome      :', chrome);
console.log('  Native host :', manifestHost);
console.log('  Menu        : klik kanan file gambar -> "Terjemahkan dengan Image Translator"');
console.log('               (Windows 11: ada di "Show more options" / Shift+F10)');
console.log('Muat ulang extension di chrome://extensions karena izin "nativeMessaging" baru ditambahkan.');
