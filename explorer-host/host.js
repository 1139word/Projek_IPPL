// Native host untuk fitur File Explorer (Premium).
// Dijalankan oleh Chrome (bukan oleh pengguna) setiap kali viewer.html memanggil chrome.runtime.connectNative.
// Hanya extension Image Translator yang boleh memanggilnya (allowed_origins di manifest host).
//
// Protokol Native Messaging: setiap pesan = 4 byte panjang (little-endian) + JSON (UTF-8).
// Masuk : { path: "C:\\...\\gambar.jpg" }
// Keluar: { type: 'start', name, mime, size, parts }  lalu  { type: 'part', i, data }  sebanyak parts
//         atau { type: 'error', code, message }
// Pesan dari host ke Chrome maksimal 1 MB, jadi isi file (base64) dikirim berpotong-potong.
// Tidak boleh ada console.log di file ini: stdout dipakai khusus untuk pesan ke Chrome.

const fs = require('fs');
const path = require('path');

const MAKS_BYTE = 15 * 1024 * 1024; // gambar dikirim ke backend sebagai base64 (batas backend 25 MB)
const POTONGAN = 512 * 1024; // panjang base64 per pesan, jauh di bawah batas 1 MB
const JENIS = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif' };

function kirim(obj) {
  const isi = Buffer.from(JSON.stringify(obj), 'utf8');
  const kepala = Buffer.alloc(4);
  kepala.writeUInt32LE(isi.length, 0);
  process.stdout.write(Buffer.concat([kepala, isi]));
}

function gagal(code, message) {
  kirim({ type: 'error', code, message });
  process.stdout.end(() => process.exit(0));
}

// Periksa permintaan sebelum membaca apa pun: hanya file gambar biasa dengan ukuran wajar.
function periksa(p) {
  if (typeof p !== 'string' || !p || !path.isAbsolute(p)) return ['BAD_PATH', 'Lokasi file tidak sah.'];
  const ext = path.extname(p).toLowerCase();
  if (!JENIS[ext]) return ['NOT_IMAGE', 'Hanya file gambar (JPG, PNG, WEBP, BMP, GIF) yang bisa diterjemahkan.'];
  let st;
  try { st = fs.statSync(p); } catch (e) { return ['NOT_FOUND', 'File tidak ditemukan: ' + p]; }
  if (!st.isFile()) return ['NOT_FOUND', 'Bukan file: ' + p];
  if (st.size > MAKS_BYTE) return ['TOO_BIG', 'File terlalu besar (maksimal 15 MB).'];
  return null;
}

function layani(pesan) {
  const p = pesan && pesan.path;
  const salah = periksa(p);
  if (salah) return gagal(...salah);
  let data;
  try { data = fs.readFileSync(p).toString('base64'); } catch (e) { return gagal('READ_FAIL', 'File tidak bisa dibaca: ' + e.message); }
  const parts = Math.max(1, Math.ceil(data.length / POTONGAN));
  kirim({ type: 'start', name: path.basename(p), mime: JENIS[path.extname(p).toLowerCase()], size: fs.statSync(p).size, parts });
  for (let i = 0; i < parts; i++) kirim({ type: 'part', i, data: data.slice(i * POTONGAN, (i + 1) * POTONGAN) });
  process.stdout.end(() => process.exit(0));
}

// Baca satu pesan dari stdin (bisa datang terpotong-potong), lalu layani.
let buf = Buffer.alloc(0);
let sudah = false;
process.stdin.on('data', (d) => {
  if (sudah) return;
  buf = Buffer.concat([buf, d]);
  if (buf.length < 4) return;
  const n = buf.readUInt32LE(0);
  if (n > 64 * 1024) { sudah = true; return gagal('BAD_REQUEST', 'Permintaan terlalu besar.'); }
  if (buf.length < 4 + n) return;
  sudah = true;
  let pesan;
  try { pesan = JSON.parse(buf.subarray(4, 4 + n).toString('utf8')); } catch (e) { return gagal('BAD_REQUEST', 'Permintaan tidak bisa dibaca.'); }
  layani(pesan);
});
process.stdin.on('end', () => process.exit(0));
