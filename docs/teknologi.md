# Keputusan teknologi

Ringkasan keputusan teknologi proyek. Dokumen SRS, SDD, dan catatan lain disimpan terpisah di Drive.

## Pilihan

| Bagian | Pilihan | Alasan singkat |
|---|---|---|
| Extension | Chrome Manifest V3, JavaScript biasa | Target hanya Google Chrome; tanpa framework agar mudah dipahami |
| Backend | Node.js + Express | Satu bahasa dengan extension; menangani akun, credit, pembayaran, dan pemanggilan OCR serta Gemini |
| OCR | RapidOCR (model PaddleOCR versi ONNX) sebagai layanan Python kecil dipanggil backend | Sementara untuk UTS karena mudah dipasang di Windows; diganti PaddleOCR penuh setelah UTS (validasi teknologi, NFR-17) |
| Terjemahan | Gemini: Standar `gemini-3.5-flash-lite` (1 credit) dan Advanced `gemini-3.8-flash` (2 credit, khusus Premium) | Sesuai rancangan paket; nama model diatur di `backend/.env` |
| Database | MySQL | Keputusan proyek |
| Pembayaran | QRIS lewat Midtrans | Keputusan proyek |
| File Explorer | Native Messaging (menu klik kanan hanya untuk Premium) | Disetujui di rancangan |

## Alur pengaturan dan pembayaran

- Pengaturan popup (bahasa asal, bahasa tujuan, model) disimpan otomatis begitu dipilih, tanpa tombol Simpan. Disimpan di `chrome.storage.sync`.
- Tombol "Beli Premium" di popup membuka halaman tab Premium. QRIS dibayar di tab itu, dan status Premium dibaca dari server (notifikasi Midtrans ke backend).

## Kontrak API terjemahan (rencana)

`POST /api/translate`

Permintaan:

```json
{ "image": "<base64>", "src": "auto", "tgt": "en", "model": "std" }
```

Jawaban berhasil:

```json
{
  "regions": [ { "box": [0.08, 0.06, 0.32, 0.10], "text": "Teks terjemahan", "original": "Teks asli" } ],
  "meta": { "ocrMs": 900, "translateMs": 1500, "balloons": 1, "model": "std", "tgt": "id" }
}
```

`box` = `[x, y, lebar, tinggi]` sebagai pecahan 0..1 dari ukuran gambar.

Jawaban gagal: `{ "code": "NO_TEXT" | "OCR_DOWN" | "BAD_IMAGE" | "BAD_API_KEY" | "MODEL_NOT_FOUND" | "QUOTA" | "ERROR", "message": "..." }`. Kode `NO_CREDIT` dan `NOT_LOGGED_IN` menyusul di tahap akun dan credit.

## Kontrak layanan OCR (internal)

`POST http://127.0.0.1:5001/ocr` dengan `{ "image": "<base64>" }`, jawaban `{ "width", "height", "lines": [ { "text", "box": [x, y, w, h], "score" } ] }` dalam piksel. Backend menggabungkan baris yang berdekatan menjadi satu balon sebelum diterjemahkan.

## Tahap pengerjaan

1. Fitur utama: hover, tombol Translate, overlay hasil, popup pengaturan, backend OCR + Gemini (selesai untuk UTS)
2. Akun dan credit mingguan
3. Tab Premium dan model Advanced
4. Pembayaran QRIS (Midtrans)
5. File Explorer
