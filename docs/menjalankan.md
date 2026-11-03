# Menjalankan prototype (dengan akun Google)

Ada tiga bagian yang harus menyala bersamaan: layanan OCR, backend (bersama MySQL yang berjalan sebagai Windows Service), dan extension. Gunakan **dua jendela terminal**.

`FOLDER_PROYEK` di bawah adalah folder hasil clone repo ini di laptopmu (misalnya `C:\Users\defaultuser0\Projek_IPPL`). Folder `ocr-service` dan `backend` ada langsung di dalamnya.

```
Extension (Chrome) ──► Backend Node.js :3000 ──► Layanan OCR Python :5001 (RapidOCR)
                                │
                                ├──► Gemini API (terjemahan)
                                ├──► Google (memeriksa token login)
                                └──► MySQL :3306 (akun, sesi, credit)
```

## Sekali saja: persiapan

### Layanan OCR (Python 3.12)
```
cd FOLDER_PROYEK\ocr-service
python -m venv venv
venv\Scripts\python -m pip install -r requirements.txt
```
Folder `venv` tidak ikut ke GitHub, jadi setiap clone baru perlu membuatnya sendiri. `venv\Scripts\python` dipakai langsung (tanpa `activate`) supaya tidak terhalang pembatasan *execution policy* PowerShell.

### Database MySQL (8.4)
Masuk sebagai root dari folder proyek, buat database dan tabel, lalu buat akun khusus backend (bukan root) yang hanya boleh membaca dan mengubah data:
```
cd FOLDER_PROYEK
mysql -u root -p
```
```
SOURCE backend/db/schema.sql;
CREATE USER 'image_translator'@'localhost' IDENTIFIED BY 'buat_kata_sandi_sendiri';
GRANT SELECT, INSERT, UPDATE, DELETE ON image_translator.* TO 'image_translator'@'localhost';
EXIT;
```
Kata sandi ini hanya ditulis di `backend/.env`, jangan di file lain yang ikut ke GitHub.

### Backend (Node.js 22 atau lebih baru)
```
cd FOLDER_PROYEK\backend
copy .env.example .env
notepad .env
npm install
npm run cek-db
```
Di Notepad, isi `GEMINI_API_KEY` (API key Gemini milikmu) dan `DB_PASSWORD` (kata sandi akun MySQL backend tadi), lalu simpan. `GOOGLE_CLIENT_ID` sudah terisi. `npm run cek-db` harus menampilkan ✓; jika `Access denied`, periksa `DB_PASSWORD` lalu buka terminal baru.

### Extension
1. Buka `chrome://extensions`, aktifkan **Developer mode**.
2. Klik **Load unpacked**, pilih folder `FOLDER_PROYEK\extension` (bukan folder proyeknya).
3. ID extension harus `dnfnbaicahmmahjbpijjcehdoaokkjeg`. ID ini tetap karena ada `"key"` di `manifest.json`, dan ID inilah yang terdaftar di Google Cloud.
4. Akun Google yang dipakai harus terdaftar sebagai **Test user** di Google Cloud (selama aplikasi OAuth berstatus Testing). Minta pemilik proyek menambahkannya bila belum.

## Setiap kali ingin mencoba

**Jendela 1, layanan OCR:**
```
cd FOLDER_PROYEK\ocr-service
venv\Scripts\python server.py
```
Tunggu sampai muncul `Layanan OCR siap di http://127.0.0.1:5001/ocr`.

**Jendela 2, backend:**
```
cd FOLDER_PROYEK\backend
npm start
```
Tunggu sampai muncul `Backend siap di http://localhost:3000`.

**Chrome:** buka `chrome://extensions`, klik ikon muat ulang (↻) pada Image Translator. Klik ikon extension di toolbar, lalu **Masuk dengan Google** (cukup sekali; sesi berlaku 30 hari). Setelah itu buka halaman komik dan klik tombol terjemah pada gambar. Sakelar **Tombol terjemah di halaman** di popup menyembunyikan tombol saat tidak sedang membaca komik.

## Membaca pesan di terminal backend

| Pesan | Arti |
|---|---|
| `OK 3 balon \| OCR 1200 ms (proses 1100 ms) \| Gemini 1500 ms` | Berhasil. Jika angka OCR jauh lebih besar dari angka "proses", waktu habis untuk antre/kirim data, bukan untuk OCR |
| `GAGAL [OCR_DOWN]` | Jendela 1 belum menjalankan `python server.py` |
| `GAGAL [NO_TEXT]` | OCR tidak menemukan teks pada gambar |
| `GAGAL [BAD_API_KEY]` | API key di `.env` salah atau belum diisi |
| `GAGAL [ACCESS_DENIED]` | Google menolak project/akun pemilik API key (sering terjadi pada akun kampus). Buat API key dengan akun Gmail pribadi |
| `GAGAL [MODEL_NOT_FOUND]` | Nama model Gemini di `.env` perlu diganti |
| `GAGAL [QUOTA]` | Kuota gratis Gemini sedang habis, tunggu sebentar |
| `GAGAL [BAD_RESPONSE]` | Jawaban Gemini tidak terbaca dua kali berturut-turut (sudah diulang otomatis sekali). Coba lagi |
| `GAGAL [DB_ERROR]` | MySQL tidak bisa diakses: cek layanan MySQL84 dan isi `DB_` di `.env` (`npm run cek-db`) |
| `GAGAL [GOOGLE_WRONG_CLIENT]` | Token login bukan untuk Client ID di `.env`: cek `GOOGLE_CLIENT_ID` |
| Popup menolak login ("access blocked") | Akun Google belum terdaftar sebagai Test user, atau ID extension bukan `dnfnbaicahmmahjbpijjcehdoaokkjeg` |

## Tes otomatis backend
```
cd FOLDER_PROYEK\backend
npm test
```
Tes ini tidak memakai internet, API key, maupun MySQL (OCR, Gemini, Google, dan database ditiru).

## Catatan
- OCR saat ini memakai **RapidOCR** (model PaddleOCR versi ONNX) karena mudah dipasang. Model bawaannya paling baik untuk teks Inggris dan Mandarin; teks Jepang akan ditingkatkan setelah UTS.
- Sudah ada: login Google (wajib sebelum menerjemahkan), credit per akun di MySQL (Free 10 per minggu, Standar 1 credit, Advanced 1 credit khusus Premium, dipotong hanya bila berhasil). Belum ada: pembelian Premium, pembayaran, dan File Explorer.
- Situs yang memblokir unduhan gambar (Pixiv, MANGA Plus) diterjemahkan lewat **potret layar**, jadi hanya bagian gambar yang sedang terlihat yang terbaca. Setelah menggulir, arahkan kursor ke gambar lagi: tombol terjemah muncul kembali untuk bagian yang belum diterjemahkan, dan hasilnya digabung dengan hasil sebelumnya.
