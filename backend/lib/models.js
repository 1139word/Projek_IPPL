// Daftar model terjemahan (UC-04 Memilih Model Terjemahan) dan biaya credit-nya.
// Satu-satunya sumber data model di backend: credit.js mengambil biaya dari sini,
// terjemah.js mengambil penyedia (Gemini/DeepSeek) dan nama model API dari sini.
//
// id      = kode yang dikirim extension (disimpan di chrome.storage.sync).
// label   = nama yang tampil di popup (harus sama dengan extension/popup.js).
// api     = nama model di API penyedia. Bisa diganti lewat .env tanpa mengubah kode,
//           karena Google dan DeepSeek kadang mengganti atau mengalihkan nama model.
// thinking = tingkat "berpikir" Gemini sebelum menjawab. Bawaan Google untuk 3.5 Flash (dialihkan ke
//           3.6 Flash) adalah medium dan untuk 3.1 Pro high, yang membuat satu halaman bisa 40 detik lebih.
//           Menerjemahkan balon tidak butuh penalaran panjang, jadi diminta 'low'.
const MODELS = [
  { id: 'flash-lite', label: 'Gemini 3.1 Flash-Lite', cost: 1, provider: 'gemini', env: 'GEMINI_MODEL_FLASH_LITE', api: 'gemini-3.1-flash-lite' },
  { id: 'deepseek', label: 'DeepSeek V4.1 Flash', cost: 1, provider: 'deepseek', env: 'DEEPSEEK_MODEL', api: 'deepseek-flash' },
  { id: 'flash', label: 'Gemini 3.5 Flash', cost: 1, provider: 'gemini', env: 'GEMINI_MODEL_FLASH', api: 'gemini-3.5-flash', thinking: 'low' },
  { id: 'pro', label: 'Gemini 3.1 Pro', cost: 2, provider: 'gemini', env: 'GEMINI_MODEL_PRO', api: 'gemini-3.1-pro-preview', thinking: 'low' }
];

const DEFAULT_MODEL = 'flash-lite';

// Kode model lama (sebelum ada empat model). Extension versi lama atau pengaturan yang
// masih tersimpan di browser bisa mengirim kode ini; diarahkan ke model yang paling mirip.
const ALIAS = { std: 'flash-lite', adv: 'flash' };

// Mengembalikan data model, atau null bila kode tidak dikenal.
function findModel(id) {
  const kode = Object.hasOwn(ALIAS, id) ? ALIAS[id] : id;
  return MODELS.find((m) => m.id === kode) || null;
}

// Nama model yang benar-benar dikirim ke API (nilai .env bila diisi).
function apiName(m) {
  return (process.env[m.env] || '').trim() || m.api;
}

module.exports = { MODELS, DEFAULT_MODEL, ALIAS, findModel, apiName };
