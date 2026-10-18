// Mengecek apakah alat yang dibutuhkan sudah terpasang.
// Jalankan: node scripts/cek-lingkungan.js
const { spawnSync } = require('child_process');

function jalankan(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.error || r.status !== 0) return null;
  return (r.stdout || r.stderr || '').trim().split('\n')[0];
}
function angka(teks) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(teks || '');
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}
function minimal(teks, mayor, minor = 0) {
  const [a, b] = angka(teks);
  return a > mayor || (a === mayor && b >= minor);
}

const pythonCmd = jalankan('python', ['--version']) ? 'python' : 'py';
const cek = [
  { nama: 'Git',     ver: jalankan('git', ['--version']),            ok: v => minimal(v, 2), wajib: true },
  { nama: 'Node.js', ver: jalankan('node', ['--version']),           ok: v => minimal(v, 22), wajib: true, saran: 'pasang Node.js LTS dari nodejs.org' },
  { nama: 'npm',     ver: jalankan('npm', ['--version']),            ok: v => minimal(v, 10), wajib: true },
  { nama: 'Python',  ver: jalankan(pythonCmd, ['--version']),        ok: v => minimal(v, 3, 9) && !minimal(v, 3, 14), wajib: true, saran: 'pakai Python 3.10 sampai 3.13 (versi terlalu baru bisa belum didukung PaddlePaddle)' },
  { nama: 'MySQL',   ver: jalankan('mysql', ['--version']),          ok: v => minimal(v, 8, 0), wajib: true, saran: 'pasang MySQL dan tambahkan ke PATH' },
  { nama: 'PaddleOCR (pip)', ver: jalankan(pythonCmd, ['-m', 'pip', 'show', 'paddleocr']) && 'terpasang 0.0', ok: () => true, wajib: false, saran: 'tahap OCR; boleh dipasang nanti' },
];

let gagal = 0;
for (const c of cek) {
  if (!c.ver) {
    console.log(`${c.wajib ? '✗' : '–'} ${c.nama}: belum ditemukan${c.saran ? ' (' + c.saran + ')' : ''}`);
    if (c.wajib) gagal++;
  } else if (!c.ok(c.ver)) {
    console.log(`! ${c.nama}: ${c.ver} (versi kurang cocok${c.saran ? ': ' + c.saran : ''})`);
    gagal++;
  } else {
    console.log(`✓ ${c.nama}: ${c.ver}`);
  }
}
console.log(gagal ? `\n${gagal} hal perlu diperbaiki. Lihat docs/instalasi.md.` : '\nSemua siap.');
process.exit(gagal ? 1 : 0);
