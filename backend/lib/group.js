// Menggabungkan baris-baris hasil OCR menjadi satu kelompok per balon teks.
//
// Kenapa perlu? OCR membaca per BARIS. Satu balon dialog biasanya terdiri dari 2-4 baris.
// Kalau tiap baris diterjemahkan sendiri-sendiri, kalimatnya terpotong dan terjemahannya aneh.
// Jadi baris yang letaknya berdekatan kita anggap satu balon, lalu diterjemahkan sekaligus.
//
// Masukan: [{ text, box: [x, y, lebar, tinggi] }]  (piksel)
// Keluaran: [{ text, box: [x, y, lebar, tinggi], lines: jumlah baris }]

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

// Union-Find: cara sederhana mengelompokkan "siapa terhubung dengan siapa".
function kelompokkan(lines) {
  const induk = lines.map((_, i) => i);
  const cari = (i) => (induk[i] === i ? i : (induk[i] = cari(induk[i])));
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (dekat(lines[i], lines[j])) induk[cari(i)] = cari(j);
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
    hasil.push({ text, box: gabungKotak(items), lines: items.length });
  }
  // Urutkan balon dari atas ke bawah agar terjemahan konteksnya berurutan.
  return hasil.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
}

module.exports = { groupLines };
