"""Alat uji OCR: menjalankan OCR pada semua gambar di folder sampel/ lalu menyimpan hasilnya.

Gunanya sebagai "penggaris" sebelum dan sesudah OCR diubah (model Jepang, SFX, dll.),
supaya perbaikan bisa dibandingkan dengan angka dan gambar, bukan hanya perasaan.

Menjalankan (dari folder ocr-service):
    venv\\Scripts\\python uji_ocr.py            -> hasil ke folder hasil\\
    venv\\Scripts\\python uji_ocr.py sebelum    -> hasil ke folder hasil\\sebelum\\ (untuk dibandingkan)

Isi folder hasil untuk setiap gambar:
    <nama>.png   gambar dengan kotak hijau (yakin) / oranye (ragu), nomor baris, dan kotak biru (balon)
    <nama>.txt   daftar baris: nomor, skor, ukuran kotak, teks
Ringkasan semua gambar tertulis di ringkasan.txt.

Folder sampel/ dan hasil/ tidak ikut ke Git (gambar komik berhak cipta).
"""
import sys
import time
from pathlib import Path

import cv2
import numpy as np

from server import MIN_SCORE, baca_teks  # memakai fungsi OCR yang sama persis dengan server

FOLDER = Path(__file__).resolve().parent
SAMPEL = FOLDER / "sampel"
HASIL = FOLDER / "hasil" / (sys.argv[1] if len(sys.argv) > 1 else "")
EKSTENSI = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def baca_gambar(path: Path):
    # cv2.imread gagal untuk nama file/folder berhuruf non-ASCII di Windows, jadi baca byte-nya dulu.
    return cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)


def simpan_gambar(path: Path, img):
    ok, buf = cv2.imencode(".png", img)
    if ok:
        buf.tofile(str(path))


def gambar_kotak(img, lines):
    out = img.copy()
    tebal = max(1, round(max(img.shape[:2]) / 800))
    for b in {tuple(ln["bubble"]) for ln in lines if ln.get("bubble")}:
        cv2.rectangle(out, (b[0], b[1]), (b[0] + b[2], b[1] + b[3]), (255, 0, 0), tebal + 1)  # biru = balon
    for i, ln in enumerate(lines, 1):
        x, y, w, h = (int(round(v)) for v in ln["box"])
        warna = (0, 180, 0) if ln["score"] >= 0.8 else (0, 140, 255)  # BGR: hijau / oranye
        cv2.rectangle(out, (x, y), (x + w, y + h), warna, tebal)
        cv2.putText(out, str(i), (x, max(12, y - 3)), cv2.FONT_HERSHEY_SIMPLEX,
                    0.5 * tebal, (0, 0, 255), tebal, cv2.LINE_AA)
    return out


def main():
    if not SAMPEL.is_dir():
        SAMPEL.mkdir()
        print(f"Folder {SAMPEL} baru dibuat. Isi dengan gambar komik, lalu jalankan lagi.")
        return
    files = sorted(p for p in SAMPEL.iterdir() if p.suffix.lower() in EKSTENSI)
    if not files:
        print(f"Belum ada gambar di {SAMPEL}")
        return
    HASIL.mkdir(parents=True, exist_ok=True)

    ringkasan = [f"Uji OCR {time.strftime('%Y-%m-%d %H:%M')}  (MIN_SCORE={MIN_SCORE})", ""]
    for path in files:
        img = baca_gambar(path)
        if img is None:
            print(f"- {path.name}: tidak bisa dibaca, dilewati")
            continue
        mulai = time.time()
        lines = baca_teks(img)
        ms = int((time.time() - mulai) * 1000)

        simpan_gambar(HASIL / f"{path.stem}.png", gambar_kotak(img, lines))
        teks = [f"{i:>3}  {ln['score']:.3f}  {int(ln['box'][2])}x{int(ln['box'][3])}  {ln['text']}"
                for i, ln in enumerate(lines, 1)]
        (HASIL / f"{path.stem}.txt").write_text("\n".join(teks) + "\n", encoding="utf-8")

        rata = sum(ln["score"] for ln in lines) / len(lines) if lines else 0
        dlm_balon = sum(1 for ln in lines if ln.get("bubble"))
        baris = f"{path.name}: {len(lines)} baris ({dlm_balon} di dalam balon), skor rata-rata {rata:.3f}, {ms} ms"
        print(baris)
        ringkasan.append(baris)

    (HASIL / "ringkasan.txt").write_text("\n".join(ringkasan) + "\n", encoding="utf-8")
    print(f"\nHasil tersimpan di {HASIL}")


if __name__ == "__main__":
    main()
