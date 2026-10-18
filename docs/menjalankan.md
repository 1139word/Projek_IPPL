# Menjalankan prototype (tahap UTS)

Ada tiga bagian yang harus menyala bersamaan. Gunakan **dua jendela Command Prompt**.

`FOLDER_PROYEK` di bawah adalah folder hasil clone repo ini di laptopmu (misalnya `C:\Users\defaultuser0\Projek_IPPL`). Folder `ocr-service` dan `backend` ada langsung di dalamnya.

```
Extension (Chrome) ──► Backend Node.js :3000 ──► Layanan OCR Python :5001 (RapidOCR)
                                │
                                └──► Gemini API (terjemahan)
```

## Sekali saja: persiapan

### Layanan OCR (Python 3.12)
```
cd FOLDER_PROYEK\ocr-service
python -m venv venv
venv\Scripts\activate
python -m pip install -r requirements.txt
```

### Backend (Node.js 22 atau lebih baru)
```
cd FOLDER_PROYEK\backend
copy .env.example .env
notepad .env
npm install
```
Di Notepad, ganti `isi_api_key_di_sini` dengan API key Gemini, lalu simpan.

## Setiap kali ingin mencoba

**Jendela 1, layanan OCR:**
```
cd FOLDER_PROYEK\ocr-service
venv\Scripts\activate
python server.py
```
Tunggu sampai muncul `Layanan OCR siap di http://127.0.0.1:5001/ocr`.

**Jendela 2, backend:**
```
cd FOLDER_PROYEK\backend
npm start
```
Tunggu sampai muncul `Backend siap di http://localhost:3000`.

**Chrome:** buka `chrome://extensions`, klik ikon muat ulang (↻) pada Image Translator, lalu buka halaman komik dan klik tombol terjemah pada gambar.

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

## Tes otomatis backend
```
cd FOLDER_PROYEK\backend
npm test
```
Tes ini tidak memakai internet maupun API key (OCR dan Gemini ditiru).

## Catatan
- OCR saat ini memakai **RapidOCR** (model PaddleOCR versi ONNX) karena mudah dipasang. Model bawaannya paling baik untuk teks Inggris dan Mandarin; teks Jepang akan ditingkatkan setelah UTS.
- Akun, credit, Premium, pembayaran, dan File Explorer belum termasuk tahap ini.
- Situs yang memblokir unduhan gambar (Pixiv, MANGA Plus) diterjemahkan lewat **potret layar**, jadi hanya bagian gambar yang sedang terlihat yang terbaca. Setelah menggulir, arahkan kursor ke gambar lagi: tombol terjemah muncul kembali untuk bagian yang belum diterjemahkan, dan hasilnya digabung dengan hasil sebelumnya.
- **Credit sementara disimpan di browser** (mode uji, belum ada akun): 10 credit per 7 hari, Gemini Standar 1 credit, dan credit hanya dipotong bila terjemahan berhasil. Setelah sistem akun dibuat, credit dipindah ke server.
