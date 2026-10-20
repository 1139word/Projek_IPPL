# Instalasi lingkungan pengembangan (Windows)

Panduan ini menyiapkan laptop agar kode proyek bisa dijalankan. Tahap 1 (extension dengan hasil contoh) **tidak butuh apa pun selain Chrome**. Alat di bawah dibutuhkan mulai tahap backend.

| Alat | Untuk apa | Versi yang dipakai | Kapan dibutuhkan |
|---|---|---|---|
| Google Chrome | menjalankan extension | terbaru | sekarang |
| Git | mengambil dan mengirim kode | 2.x | sekarang |
| Node.js | backend Express | 24 LTS (minimal 22) | tahap backend |
| MySQL | akun, credit, riwayat bayar | 8.4 LTS atau 9.7 LTS | tahap backend |
| Python | layanan PaddleOCR | 3.10 sampai 3.13 | tahap OCR |
| Kunci API Gemini | terjemahan | gratis di Google AI Studio | tahap backend |
| Akun Midtrans Sandbox | QRIS uji coba | gratis | tahap pembayaran |

Catatan versi: halaman resmi saat dicek (5 Okt 2026) menampilkan Node.js 24 sebagai LTS, MySQL 8.4 dan 9.7 sebagai LTS (ada juga seri "Innovation" yang tidak dipakai di sini), dan PaddleOCR mendukung Python 3.8 ke atas. Rentang Python 3.10 sampai 3.13 adalah pilihan aman kami, karena PaddlePaddle kadang terlambat mendukung Python terbaru.

## 1. Git
1. Unduh dari https://git-scm.com/download/win, pasang dengan pilihan bawaan.
2. Buka **Command Prompt** baru, cek: `git --version`
3. Ambil kode (repo privat, login GitHub akan diminta lewat browser):
   ```
   git clone https://github.com/1139word/testingcode
   cd testingcode
   ```

## 2. Node.js
1. Unduh versi **LTS** dari https://nodejs.org lalu pasang (centang opsi menambah ke PATH).
2. Buka Command Prompt baru, cek: `node --version` dan `npm --version`

## 3. MySQL
1. Unduh **MySQL Installer** dari https://dev.mysql.com/downloads/installer/ dan pilih MySQL Server seri **LTS** (8.4 atau 9.7).
2. Saat konfigurasi, buat kata sandi untuk pengguna `root` dan **catat**. Biarkan port 3306.
3. Pastikan perintah `mysql --version` jalan. Jika tidak, tambahkan folder `bin` MySQL ke PATH.

## 4. Python
1. Unduh Python 3.12 dari https://www.python.org/downloads/windows/ lalu pasang. **Centang "Add python.exe to PATH".**
2. Cek: `python --version`

## 5. PaddleOCR (nanti, saat tahap OCR)
Pakai lingkungan virtual agar tidak bentrok dengan Python lain:
```
python -m venv venv
venv\Scripts\activate
python -m pip install paddlepaddle paddleocr
```
Jika `paddlepaddle` gagal dipasang, ikuti petunjuk resmi PaddlePaddle (CPU, Windows) di https://www.paddlepaddle.org.cn/en/install/quick. Kami akan menyesuaikan perintahnya bersama saat sampai di tahap ini. Unduhan model pertama kali cukup besar dan butuh internet.

## 6. Kunci API Gemini
1. Buka https://aistudio.google.com/apikey, masuk dengan akun Google, buat API key.
2. Simpan di berkas `.env` di folder backend (berkas ini tidak boleh diunggah ke GitHub):
   ```
   GEMINI_API_KEY=isi_kunci_di_sini
   ```
Jangan membagikan kunci ini di chat, foto layar, atau repo.

## 7. Midtrans Sandbox (nanti, tahap pembayaran)
Daftar di https://dashboard.sandbox.midtrans.com untuk mendapat Server Key dan Client Key uji coba. Tidak ada uang sungguhan yang berpindah.

## 8. Cek semuanya
Di folder proyek:
```
node scripts/cek-lingkungan.js
```
Tanda ✓ berarti siap, ✗ belum terpasang.

## Menjalankan extension (tahap 1)
Lihat `README.md`: Load unpacked, pilih folder `extension/`.
