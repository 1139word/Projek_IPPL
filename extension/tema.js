// Tema siang dan malam (FR-36). Dimuat di <head> popup, halaman Beli Credit, dan halaman Unggah,
// SEBELUM isi halaman digambar, supaya halaman tidak sempat berkedip dengan tema yang salah.
//
// Pilihan disimpan di localStorage milik extension. Semua halaman extension (popup dan tab) memakai
// localStorage yang sama, dan localStorage bisa dibaca langsung (tidak perlu menunggu seperti
// chrome.storage). Saat tema diganti dari popup, tab yang sedang terbuka menerima event 'storage'
// dan ikut berganti tanpa dimuat ulang.
//
// Nilai: 'malam' (bawaan) atau 'siang'. Tema siang diterapkan dengan kelas "day" pada <html>;
// warnanya diatur di popup.css (bagian .day).
(() => {
  const KUNCI = 'tema';
  const baca = () => { try { return localStorage.getItem(KUNCI) === 'siang' ? 'siang' : 'malam'; } catch { return 'malam'; } };
  const terapkan = (t) => document.documentElement.classList.toggle('day', t === 'siang');

  terapkan(baca());
  addEventListener('storage', (e) => { if (e.key === KUNCI) terapkan(baca()); });

  // Dipakai popup.js untuk tombol tema.
  window.temaIT = {
    sekarang: baca,
    ganti() {
      const baru = baca() === 'siang' ? 'malam' : 'siang';
      try { localStorage.setItem(KUNCI, baru); } catch {}
      terapkan(baru);
      return baru;
    }
  };
})();
