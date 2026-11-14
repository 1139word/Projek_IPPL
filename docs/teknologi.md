# Keputusan teknologi

Ringkasan keputusan teknologi proyek. Dokumen SRS, SDD, dan catatan lain disimpan terpisah di Drive.

## Pilihan

| Bagian | Pilihan | Alasan singkat |
|---|---|---|
| Extension | Chrome Manifest V3, JavaScript biasa | Target hanya Google Chrome; tanpa framework agar mudah dipahami |
| Backend | Node.js + Express | Satu bahasa dengan extension; menangani akun, credit, pembayaran, dan pemanggilan OCR serta Gemini |
| OCR | RapidOCR (model PaddleOCR versi ONNX) sebagai layanan Python kecil dipanggil backend | Sementara untuk UTS karena mudah dipasang di Windows; diganti PaddleOCR penuh setelah UTS (validasi teknologi, NFR-17) |
| Terjemahan | Empat model: Gemini 3.1 Flash-Lite `gemini-3.1-flash-lite` (1 credit), DeepSeek V4.1 Flash `deepseek-flash` (1 credit), Gemini 3.5 Flash `gemini-3.5-flash` (1 credit), Gemini 3.1 Pro `gemini-3.1-pro-preview` (2 credit); semua akun boleh memakai semuanya | Daftar dan biaya di `backend/lib/models.js`; nama model API bisa diganti di `backend/.env` |
| Database | MySQL | Keputusan proyek |
| Pembayaran | QRIS lewat Midtrans | Keputusan proyek |
| File Explorer | Native Messaging (menu klik kanan, untuk semua akun; akan diganti halaman unggah gambar) | Disetujui di rancangan |

## Alur pengaturan dan pembayaran

- Pengaturan popup (bahasa asal, bahasa tujuan, model) disimpan otomatis begitu dipilih, tanpa tombol Simpan. Disimpan di `chrome.storage.sync`.
- Tombol "Beli credit" di popup menampilkan paket credit; tombol "Beli" pada sebuah paket membuka halaman tab Beli Credit (`beli.html`). QRIS dibayar di tab itu, dan credit ditambahkan oleh server setelah backend bertanya ke Midtrans setiap 3 detik.

## Kontrak API terjemahan (rencana)

`POST /api/translate`

Permintaan:

```json
{ "image": "<base64>", "src": "auto", "tgt": "en", "model": "flash-lite" }
```

Jawaban berhasil:

```json
{
  "regions": [ { "box": [0.08, 0.06, 0.32, 0.10], "text": "Teks terjemahan", "original": "Teks asli" } ],
  "meta": { "ocrMs": 900, "translateMs": 1500, "balloons": 1, "model": "flash-lite", "tgt": "id" }
}
```

`box` = `[x, y, lebar, tinggi]` sebagai pecahan 0..1 dari ukuran gambar.

`model` = `flash-lite` | `deepseek` | `flash` | `pro`. Kode lama `std` dan `adv` masih diterima (diarahkan ke `flash-lite` dan `flash`).

Jawaban gagal: `{ "code": "NO_TEXT" | "OCR_DOWN" | "BAD_IMAGE" | "BAD_API_KEY" | "NO_API_KEY" | "MODEL_NOT_FOUND" | "QUOTA" | "OVERLOADED" | "NEEDS_BILLING" | "DEEPSEEK_NO_BALANCE" | "NO_CREDIT" | "NOT_LOGGED_IN" | "ERROR", "message": "..." }`. Credit hanya dipotong bila terjemahan berhasil.

## Kontrak layanan OCR (internal)

`POST http://127.0.0.1:5001/ocr` dengan `{ "image": "<base64>" }`, jawaban `{ "width", "height", "lines": [ { "text", "box": [x, y, w, h], "score" } ] }` dalam piksel. Backend menggabungkan baris yang berdekatan menjadi satu balon sebelum diterjemahkan.

## Tahap pengerjaan

1. Fitur utama: hover, tombol Translate, overlay hasil, popup pengaturan, backend OCR + Gemini (selesai untuk UTS)
2. Akun dan credit mingguan
3. Tab Beli Credit dan model Advanced
4. Pembayaran QRIS (Midtrans)
5. File Explorer
