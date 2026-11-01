// Menggabungkan baris-baris hasil OCR menjadi satu kelompok per balon teks.
//
// Kenapa perlu? OCR membaca per BARIS. Satu balon dialog biasanya terdiri dari 2-4 baris.
// Kalau tiap baris diterjemahkan sendiri-sendiri, kalimatnya terpotong dan terjemahannya aneh.
// Jadi baris yang letaknya berdekatan kita anggap satu balon, lalu diterjemahkan sekaligus.
//
// Masukan: [{ text, box: [x, y, lebar, tinggi], bubble?: [x, y, lebar, tinggi] | null }]  (piksel)
//   bubble = kotak balon yang melingkupi baris itu (dideteksi layanan OCR), bila ada.
//   dark   = true bila balonnya hitam (teks putih di atas hitam).
// Keluaran: [{ text, box: [x, y, lebar, tinggi], textBox, bubble, dark, lines: jumlah baris }]
//   box     = kotak untuk menampilkan terjemahan (bisa lebih lebar dari teks asli, lihat kotakTampil)
//   textBox = kotak gabungan teks asli

const CJK = /[぀-ヿ㐀-鿿가-힯]/; // Jepang, Mandarin, Korea

// Dua baris dianggap satu balon jika kotaknya bersentuhan setelah diperbesar sedikit.
// Besarnya celah mengikuti ketebalan huruf, supaya bekerja untuk tulisan kecil maupun besar.
function dekat(a, b) {
  const tebalA = Math.min(a.box[2], a.box[3]);
  const tebalB = Math.min(b.box[2], b.box[3]);
  const celah = 0.6 * Math.min(tebalA, tebalB);
  const [ax, ay, aw, ah] = a.box;
  const [bx, by, bw, bh] = b.box;
  return ax - celah < bx + bw && bx - celah < ax + aw && ay - celah < by + bh && by - celah < ay + ah;
}

const kunciBalon = (l) => (l.bubble ? l.bubble.join(',') : '');

// Dua baris boleh digabung bila: berada di balon yang sama, ATAU letaknya berdekatan dan tidak
// berada di dua balon yang berbeda (dua balon yang bersebelahan tidak boleh tergabung).
function satuKelompok(a, b) {
  const ka = kunciBalon(a), kb = kunciBalon(b);
  if (ka && ka === kb) return true;
  if (ka && kb) return false;
  return dekat(a, b);
}

// Union-Find: cara sederhana mengelompokkan "siapa terhubung dengan siapa".
function kelompokkan(lines) {
  const induk = lines.map((_, i) => i);
  const cari = (i) => (induk[i] === i ? i : (induk[i] = cari(induk[i])));
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (satuKelompok(lines[i], lines[j])) induk[cari(i)] = cari(j);
    }
  }
  const map = new Map();
  lines.forEach((l, i) => {
    const r = cari(i);
    if (!map.has(r)) map.set(r, []);
    map.get(r).push(l);
  });
  return [...map.values()];
}

function gabungKotak(items) {
  const x1 = Math.min(...items.map((l) => l.box[0]));
  const y1 = Math.min(...items.map((l) => l.box[1]));
  const x2 = Math.max(...items.map((l) => l.box[0] + l.box[2]));
  const y2 = Math.max(...items.map((l) => l.box[1] + l.box[3]));
  return [x1, y1, x2 - x1, y2 - y1];
}

// Kotak untuk menampilkan terjemahan.
// - Di dalam balon: pakai persegi terbesar yang muat di dalam oval balon (sekitar 70% lebar dan
//   tinggi balon), digabung dengan kotak teks asli agar teks asli tetap tertutup, lalu dibatasi
//   oleh tepi balon. Hasilnya terjemahan mendatar punya ruang lebar walau teks aslinya vertikal.
// - Tanpa balon tapi teksnya vertikal dan sempit: kotak dilebarkan ke kiri-kanan secukupnya,
//   supaya terjemahan mendatar tidak patah per huruf ("S y u k u r l a h").
const SUSUT_BALON = 0.15; // oval: persegi dalam ≈ 70% → susut 15% tiap sisi
function kotakTampil(textBox, bubble) {
  const [tx, ty, tw, th] = textBox;
  if (bubble) {
    const [bx, by, bw, bh] = bubble;
    const ix1 = bx + bw * SUSUT_BALON, iy1 = by + bh * SUSUT_BALON;
    const ix2 = bx + bw * (1 - SUSUT_BALON), iy2 = by + bh * (1 - SUSUT_BALON);
    const x1 = Math.max(bx, Math.min(tx, ix1)), y1 = Math.max(by, Math.min(ty, iy1));
    const x2 = Math.min(bx + bw, Math.max(tx + tw, ix2)), y2 = Math.min(by + bh, Math.max(ty + th, iy2));
    return [x1, y1, x2 - x1, y2 - y1];
  }
  if (th > tw * 2) {
    // Lebar dibatasi agar tidak menutupi gambar terlalu banyak: maksimal setinggi kotaknya, atau 5x lebar asli.
    const lebar = Math.min(th, tw * 5);
    return [tx - (lebar - tw) / 2, ty, lebar, th];
  }
  return textBox;
}

function groupLines(lines) {
  const valid = lines.filter((l) => l && l.text && l.text.trim() && l.box && l.box[2] > 0 && l.box[3] > 0);
  const hasil = [];
  for (const items of kelompokkan(valid)) {
    // Tulisan vertikal (manga Jepang) dibaca dari kanan ke kiri; tulisan biasa dari atas ke bawah.
    const vertikal = items.filter((l) => l.box[3] > l.box[2] * 1.5).length > items.length / 2;
    items.sort(vertikal
      ? (a, b) => b.box[0] - a.box[0]
      : (a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
    const pemisah = items.some((l) => CJK.test(l.text)) ? '' : ' ';
    const text = items.map((l) => l.text.trim()).join(pemisah).replace(/\s+/g, ' ').trim();
    if (!/\p{L}/u.test(text)) continue; // buang angka halaman, tanda baca saja, dll.
    const textBox = gabungKotak(items);
    const dalamBalon = items.find((l) => l.bubble) || {};
    const bubble = dalamBalon.bubble || null;
    const dark = Boolean(bubble && dalamBalon.dark);
    hasil.push({ text, box: kotakTampil(textBox, bubble), textBox, bubble, dark, lines: items.length });
  }
  // Urutkan balon dari atas ke bawah agar terjemahan konteksnya berurutan.
  return hasil.sort((a, b) => a.textBox[1] - b.textBox[1] || a.textBox[0] - b.textBox[0]);
}

module.exports = { groupLines, kotakTampil };
