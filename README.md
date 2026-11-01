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

## Menjalankan versi lengkap (dengan akun Google)

Ringkasnya ada tiga bagian yang menyala bersamaan: layanan OCR (Python), backend (Node.js + MySQL), dan extension di Chrome. Langkah rinci ada di `docs/menjalankan.md`; alat yang perlu dipasang ada di `docs/instalasi.md`.

1. **Database:** jalankan `backend/db/schema.sql` di MySQL dan buat akun MySQL khusus backend.
2. **Backend:** salin `backend/.env.example` menjadi `backend/.env`, isi API key Gemini dan kata sandi akun MySQL backend, lalu `npm install` dan `npm start` di folder `backend`.
3. **OCR:** buat `venv` di folder `ocr-service`, pasang `requirements.txt`, lalu `venv\Scripts\python server.py`.
4. **Extension:** `chrome://extensions` → aktifkan **Developer mode** → **Load unpacked** → pilih folder `extension/`. Klik ikon extension, lalu **Masuk dengan Google**.

### ID extension dan login Google

- `extension/manifest.json` berisi `"key"` (kunci publik), sehingga ID extension **selalu** `dnfnbaicahmmahjbpijjcehdoaokkjeg` di komputer mana pun. ID ini yang terdaftar di OAuth Client Google Cloud, jadi login Google bisa dipakai tanpa mengatur apa pun.
- Selama aplikasi OAuth masih berstatus **Testing**, hanya akun Google yang terdaftar sebagai **Test user** yang bisa masuk. Untuk mencoba dengan akun lain, minta pemilik proyek menambahkan email tersebut di Google Cloud (Google Auth Platform → Audience → Test users).
- **Jangan** menjalankan `scripts/buat-key-extension.js` kecuali memang ingin mengganti ID: skrip itu khusus pemilik proyek, dan ID baru harus didaftarkan ulang di Google Cloud.

## Mencoba extension tanpa server (mode contoh)

1. Buka `chrome://extensions`, aktifkan **Developer mode**.
2. Klik **Load unpacked**, pilih folder `extension/`.
3. Buka halaman yang memuat gambar besar, arahkan kursor ke gambar, lalu klik tombol **文A**.

Untuk mencoba tampilan tanpa server, ubah `MOCK = true` di `extension/background.js`; hasil terjemahan akan berupa contoh.

link Youtube: https://youtu.be/jdkz8qmGDmw 
