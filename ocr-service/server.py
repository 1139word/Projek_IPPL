"""Layanan OCR kecil untuk Image Translator.

Tugasnya hanya satu: menerima gambar (base64) lalu mengembalikan teks beserta posisinya.
Backend Node.js yang memanggil layanan ini; extension tidak pernah memanggilnya langsung.

Memakai RapidOCR 3 (model PaddleOCR versi ONNX, mudah dipasang di Windows) dengan model
PP-OCRv6 small. Model ini membaca Mandarin, Inggris, dan Jepang (termasuk teks vertikal manga)
dalam satu model, dan sudah ikut terpasang bersama paket pip, jadi tidak perlu unduh terpisah.
Sebelumnya (rapidocr_onnxruntime 1.x, PP-OCRv4) huruf kana Jepang tidak terbaca (masalah M4).
Bila suatu saat model diganti lagi, cukup ubah fungsi `baca_teks`; bentuk jawabannya harus tetap sama.

Menjalankan:  python server.py
Alamat:       http://127.0.0.1:5001/ocr   (POST)   dan   /health   (GET)
"""
import base64
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
from rapidocr import RapidOCR

HOST, PORT = "127.0.0.1", 5001
MIN_SCORE = 0.5  # hasil OCR dengan keyakinan di bawah ini dibuang (biasanya noise)
SKOR_SELAMATKAN = 0.1  # baris dengan skor 0.1..0.5 dicoba dibaca ulang (lihat baca_ulang)

print("Memuat model OCR... (pertama kali agak lama)")
# Model dimuat sekali saja, lalu dipakai untuk semua permintaan. Bawaan RapidOCR 3.10 = PP-OCRv6 small.
# text_score diturunkan agar baris yang ragu-ragu ikut dikembalikan; penyaringan dilakukan di baca_teks.
engine = RapidOCR(params={"Global.log_level": "warning", "Global.text_score": SKOR_SELAMATKAN})
# Mesin kedua hanya untuk membaca ulang potongan gambar (tanpa deteksi), dipakai oleh baca_ulang.
pembaca = RapidOCR(params={"Global.log_level": "warning", "Global.text_score": 0.0,
                           "Global.use_det": False, "Global.use_cls": False})
kunci_ocr = threading.Lock()  # satu gambar diproses pada satu waktu agar model tidak dipakai bersamaan


def decode_gambar(b64: str):
    """Ubah base64 menjadi gambar OpenCV (array piksel BGR)."""
    data = base64.b64decode(b64)
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        # OpenCV tidak bisa membaca GIF; coba lewat Pillow bila tersedia.
        try:
            from io import BytesIO
            from PIL import Image
            pil = Image.open(BytesIO(data)).convert("RGB")
            img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
        except Exception:
            raise ValueError("Format gambar tidak didukung")
    return img


# ---- Deteksi balon ----
# Balon dialog = area putih yang tertutup garis gelap. Caranya:
#  1. Tandai piksel yang hampir putih. Garis balon dipertebal sedikit (erode) agar celah kecil di garis
#     tidak membuat isi balon "bocor" menyatu dengan latar.
#  2. Kotak teks diisi putih juga, supaya huruf di dalam balon tidak memutus area putihnya.
#  3. Area putih yang saling terhubung dikelompokkan (connected components). Area yang memuat
#     tengah sebuah baris teks adalah calon balonnya.
#  4. Calon ditolak bila bukan bentuk balon: terlalu besar (latar halaman), bentuknya tidak cembung
#     (solidity rendah, misalnya kemeja putih atau latar toko), tidak dikelilingi garis/tepi yang
#     kontras (misalnya langit atau lantai terang), atau hampir sama dengan kotak teksnya.
# Balon hitam (teks putih di atas hitam, biasanya teriakan/pikiran gelap) dicari dengan cara yang
# sama tetapi warnanya dibalik: area yang hampir hitam, dan tepinya harus terang.
PUTIH = 200          # kecerahan minimum (0..255) yang dianggap putih
HITAM = 70           # kecerahan maksimum yang dianggap hitam (untuk balon hitam)
BALON_MAKS = 0.2     # balon tidak mungkin lebih dari 20% luas halaman
SOLIDITY_MIN = 0.8   # luas area / luas selubung cembungnya; balon oval/awan ~0.85-1.0
ISI_MIN = 0.55       # luas area / luas kotak pembatasnya; oval ~0.78
TEKS_RASIO_MAKS = 8  # luas balon / luas semua teks di dalamnya; lebih dari ini biasanya langit/lantai putih
GARIS_MIN = 0.15     # bagian piksel di tepi luar area yang kontras; balon punya garis tepi (~0.17-0.5)


def _cari(gray, lines, mask, tepi_kontras):
    """Satu putaran pencarian balon pada mask (1 = warna isi balon). Hasil: kotak balon/None per baris."""
    H, W = gray.shape
    mask = cv2.erode(mask, np.ones((3, 3), np.uint8), iterations=2)
    for ln in lines:
        x, y, w, h = (int(round(v)) for v in ln["box"])
        mask[max(y, 0):y + h, max(x, 0):x + w] = 1
    _, label, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=4)

    def label_of(ln):
        x, y, w, h = (int(round(v)) for v in ln["box"])
        return int(label[min(max(y + h // 2, 0), H - 1), min(max(x + w // 2, 0), W - 1)])

    luas_teks = {}  # label -> jumlah luas kotak teks di dalamnya
    for ln in lines:
        k = label_of(ln)
        luas_teks[k] = luas_teks.get(k, 0) + ln["box"][2] * ln["box"][3]
    cek = {}  # label -> kotak balon atau None (dihitung sekali per area)
    hasil = []
    for ln in lines:
        x, y, w, h = (int(round(v)) for v in ln["box"])
        k = label_of(ln)
        if k not in cek:
            cek[k] = None
            bx, by, bw, bh, luas = (int(v) for v in stats[k])
            if k and luas <= BALON_MAKS * W * H and luas <= TEKS_RASIO_MAKS * luas_teks[k] and bw < 0.9 * W and bh < 0.9 * H and luas / (bw * bh) >= ISI_MIN:
                p = 6  # potong sedikit lebih lebar dari area agar tepi luarnya ikut terlihat
                x0, y0 = max(bx - p, 0), max(by - p, 0)
                area = (label[y0:by + bh + p, x0:bx + bw + p] == k).astype(np.uint8)
                kontur, _ = cv2.findContours(area, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                selubung = cv2.contourArea(cv2.convexHull(max(kontur, key=cv2.contourArea)))
                tepi = cv2.dilate(area, np.ones((3, 3), np.uint8), iterations=4) - area
                abu = gray[y0:by + bh + p, x0:bx + bw + p][tepi > 0]
                garis = float(np.mean(tepi_kontras(abu))) if abu.size else 0.0
                if selubung > 0 and luas / selubung >= SOLIDITY_MIN and garis >= GARIS_MIN:
                    cek[k] = [bx, by, bw, bh]
        b = cek[k]
        # Balon yang hampir sama dengan kotak teksnya bukan balon sungguhan.
        hasil.append(b if b and b[2] * b[3] >= 1.3 * w * h else None)
    return hasil


def cari_balon(img, lines):
    """Tambahkan "bubble": [x, y, lebar, tinggi] (atau None) dan "dark" (balon hitam) pada setiap baris."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    putih = _cari(gray, lines, (gray >= PUTIH).astype(np.uint8), lambda abu: abu < 120)
    hitam = _cari(gray, lines, (gray <= HITAM).astype(np.uint8), lambda abu: abu > 150)
    for ln, bp, bh in zip(lines, putih, hitam):
        # Balon hitam hanya bila latar kotak teksnya memang gelap (median kecerahan rendah). Tanpa cek ini,
        # huruf hitam biasa yang menempel ke garis/arsiran gelap bisa dianggap "balon hitam".
        x, y, w, h = (int(round(v)) for v in ln["box"])
        gelap = bh is not None and float(np.median(gray[max(y, 0):y + h, max(x, 0):x + w])) < 100
        ln["bubble"] = bh if gelap else bp
        ln["dark"] = gelap
    return lines


def baca_ulang(img, x1, y1, x2, y2):
    """Baca ulang satu baris yang skornya rendah. Contoh: teks di balon bergradasi/raster (screentone),
    di mana titik-titik raster mengganggu pembacaan. Potongan gambar dihaluskan dengan median blur
    (titik raster hilang, huruf tetap) lalu dibaca lagi. Hasil: (teks, skor) terbaik."""
    p = int(0.15 * min(x2 - x1, y2 - y1)) + 4
    potong = img[max(y1 - p, 0):y2 + p, max(x1 - p, 0):x2 + p]
    terbaik = ("", 0.0)
    for k in (5, 7):
        c = cv2.medianBlur(potong, k)
        if c.shape[0] > 1.5 * c.shape[1]:  # teks vertikal: putar agar terbaca mendatar
            c = cv2.rotate(c, cv2.ROTATE_90_COUNTERCLOCKWISE)
        r = pembaca(c)
        if r.txts and float(r.scores[0]) > terbaik[1]:
            terbaik = (str(r.txts[0]), float(r.scores[0]))
    return terbaik


def baca_teks(img):
    """Jalankan OCR. Hasil: daftar baris teks dengan kotak [x, y, lebar, tinggi] dalam piksel,
    ditambah "bubble" (kotak balon yang melingkupinya, atau None bila teks tidak di dalam balon)."""
    with kunci_ocr:
        hasil = engine(img)  # hasil.boxes = 4 titik sudut per baris, hasil.txts = teks, hasil.scores = skor
    lines = []
    if hasil.boxes is None:  # tidak ada teks sama sekali
        return lines
    for box, text, score in zip(hasil.boxes, hasil.txts, hasil.scores):
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        x, y = float(min(xs)), float(min(ys))
        if float(score) < MIN_SCORE:
            with kunci_ocr:
                text, score = baca_ulang(img, int(x), int(y), int(max(xs)), int(max(ys)))
            # Hasil baca ulang hanya dipakai bila yakin DAN berisi minimal 2 huruf (bukan "1", "m", "木").
            if score < MIN_SCORE or sum(ch.isalpha() for ch in text) < 2:
                continue
        if not str(text).strip():
            continue
        lines.append({
            "text": str(text),
            "box": [x, y, float(max(xs)) - x, float(max(ys)) - y],
            "score": round(float(score), 3),
        })
    return cari_balon(img, lines)


class Handler(BaseHTTPRequestHandler):
    # Koneksi yang dibuka lalu didiamkan (misalnya koneksi cadangan dari tab Chrome) diputus setelah 10 detik.
    timeout = 10

    def _kirim(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._kirim(200, {"ok": True})
        else:
            self._kirim(404, {"message": "Tidak ditemukan"})

    def do_POST(self):
        if self.path != "/ocr":
            return self._kirim(404, {"message": "Tidak ditemukan"})
        try:
            panjang = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(panjang) or b"{}")
            mulai = time.time()
            img = decode_gambar(body["image"])
            h, w = img.shape[:2]
            lines = baca_teks(img)
            ms = int((time.time() - mulai) * 1000)
            print(f"OCR {w}x{h}: {len(lines)} baris, {ms} ms")
            self._kirim(200, {"width": w, "height": h, "lines": lines, "ms": ms})
        except (KeyError, ValueError) as e:
            self._kirim(400, {"message": str(e) or "Permintaan tidak valid"})
        except Exception as e:  # jangan sampai server mati karena satu gambar bermasalah
            print("Error OCR:", repr(e))
            self._kirim(500, {"message": "OCR gagal: " + str(e)})

    def log_message(self, *args):  # matikan log bawaan agar terminal rapi
        pass


if __name__ == "__main__":
    print(f"Layanan OCR siap di http://{HOST}:{PORT}/ocr")
    # ThreadingHTTPServer: setiap koneksi dilayani di jalur (thread) sendiri, sehingga satu koneksi
    # yang menganggur tidak membuat permintaan lain mengantre. Sebelumnya (HTTPServer satu jalur)
    # permintaan dari backend bisa tertahan lebih dari 1 menit.
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
