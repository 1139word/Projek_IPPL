# Image-Tranlator

Ekstensi Chrome untuk menerjemahkan teks pada gambar komik langsung di halaman.

- `extension/`: kode Chrome extension
- `docs/teknologi.md`: keputusan teknologi dan kontrak API
- `backend/`: server Node.js (Express): OCR + Gemini
- `ocr-service/`: layanan OCR Python (RapidOCR)
- `docs/instalasi.md`: menyiapkan lingkungan pengembangan (Windows)
- `docs/menjalankan.md`: menjalankan prototype (OCR, backend, extension)
- `scripts/cek-lingkungan.js`: mengecek alat yang sudah terpasang

Cara menjalankan lengkap: lihat `docs/menjalankan.md`.

## Mencoba extension tanpa server (mode contoh)

1. Buka `chrome://extensions`, aktifkan **Developer mode**.
2. Klik **Load unpacked**, pilih folder `extension/`.
3. Buka halaman yang memuat gambar besar, arahkan kursor ke gambar, lalu klik tombol **文A**.

Untuk mencoba tampilan tanpa server, ubah `MOCK = true` di `extension/background.js`; hasil terjemahan akan berupa contoh.

link Youtube: https://youtu.be/jdkz8qmGDmw 
