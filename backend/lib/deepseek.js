// Penerjemahan teks lewat DeepSeek API (format OpenAI chat completions, tanpa pustaka tambahan).
// Prompt dan cara membaca jawabannya sama dengan Gemini (gemini.js), sehingga hasilnya
// bisa langsung dipakai alur yang sama di terjemah.js.
//
// Dokumentasi resmi: https://api-docs.deepseek.com
//  - endpoint  : POST https://api.deepseek.com/chat/completions
//  - JSON mode : response_format {type: 'json_object'} dan kata "json" wajib ada di prompt
//  - thinking  : aktif secara bawaan; dimatikan dengan thinking {type: 'disabled'} supaya cepat dan hemat

const { buatPrompt, GeminiError } = require('./gemini');

// api = nama model DeepSeek (misalnya deepseek-flash), dari models.js.
async function mintaDeepSeek(texts, { src, tgt, api, fetchFn }) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new GeminiError('NO_API_KEY', 'DEEPSEEK_API_KEY belum diisi di backend/.env');
  const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  let res;
  try {
    res = await fetchFn(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: api,
        messages: [
          { role: 'system', content: 'You are a comic translator. Always answer with a single valid json object and nothing else.' },
          { role: 'user', content: buatPrompt(texts, src, tgt) }
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0.3,
        max_tokens: 8192,
        stream: false
      }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    throw new GeminiError('DEEPSEEK_UNREACHABLE', 'Tidak bisa menghubungi DeepSeek: ' + e.message);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || `HTTP ${res.status}`;
    const asli = `${api} HTTP ${res.status}: ${msg}`;
    if (res.status === 401) throw new GeminiError('BAD_API_KEY', 'API key DeepSeek tidak valid', asli);
    if (res.status === 402) throw new GeminiError('DEEPSEEK_NO_BALANCE', 'Saldo akun DeepSeek habis. Isi ulang di platform.deepseek.com atau pilih model Gemini', asli);
    if (res.status === 429) throw new GeminiError('QUOTA', 'Batas permintaan DeepSeek tercapai, coba lagi sebentar', asli);
    if (res.status === 400 && /model/i.test(msg)) throw new GeminiError('MODEL_NOT_FOUND', `Model ${api} tidak tersedia. Ganti DEEPSEEK_MODEL di .env`, asli);
    if (res.status === 503 || res.status === 500) throw new GeminiError('OVERLOADED', 'Server DeepSeek sedang sibuk, coba lagi sebentar', asli);
    throw new GeminiError('DEEPSEEK_ERROR', 'DeepSeek error: ' + msg, asli);
  }
  const choice = (body.choices && body.choices[0]) || {};
  // Menurut dokumentasi, bila jawaban tidak berbentuk JSON isinya bisa berupa spasi saja.
  // Teks kosong itu nanti dianggap jawaban rusak dan diulang oleh terjemah.js.
  const raw = (choice.message && choice.message.content) || '';
  return { raw: raw.trim(), finishReason: choice.finish_reason || '(tidak ada)' };
}

module.exports = { mintaDeepSeek };
