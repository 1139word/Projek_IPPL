"""Layanan OCR kecil untuk Image Translator.

Tugasnya hanya satu: menerima gambar (base64) lalu mengembalikan teks beserta posisinya.
Backend Node.js yang memanggil layanan ini; extension tidak pernah memanggilnya langsung.

Sementara memakai RapidOCR (model PaddleOCR versi ONNX) karena mudah dipasang di Windows.
Setelah UTS, isi fungsi `baca_teks` bisa diganti ke PaddleOCR penuh tanpa mengubah backend,
selama bentuk jawabannya tetap sama.

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
from rapidocr_onnxruntime import RapidOCR

HOST, PORT = "127.0.0.1", 5001
MIN_SCORE = 0.5  # hasil OCR dengan keyakinan di bawah ini dibuang (biasanya noise)

print("Memuat model OCR... (pertama kali agak lama)")
engine = RapidOCR()  # model dimuat sekali saja, lalu dipakai untuk semua permintaan
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


def baca_teks(img):
    """Jalankan OCR. Hasil: daftar baris teks dengan kotak [x, y, lebar, tinggi] dalam piksel."""
    with kunci_ocr:
        result, _ = engine(img)  # result = [[4 titik sudut, teks, skor], ...] atau None
    lines = []
    for box, text, score in result or []:
        if float(score) < MIN_SCORE or not str(text).strip():
            continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        x, y = float(min(xs)), float(min(ys))
        lines.append({
            "text": str(text),
            "box": [x, y, float(max(xs)) - x, float(max(ys)) - y],
            "score": round(float(score), 3),
        })
    return lines


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
