(() => {
  // Iframe kecil (iklan, widget) bukan halaman komik: jangan dipasangi tombol.
  if (window !== window.top && (innerWidth < 500 || innerHeight < 400)) return;
  const MIN_SIZE = 250; // abaikan gambar kecil (ikon, avatar, banner iklan)
  let fab = null;
  let fabOn = false;
  let current = null; // gambar yang sedang di-hover
  const sessions = new Map(); // elemen gambar -> { img, layer, bar, load, err, w, h }
  const dismissed = new WeakSet(); // gambar yang hasilnya sengaja ditutup pengguna: jangan dipulihkan otomatis
  const cache = new Map(); // alamat gambar -> { regions, sk }; hasil dipakai ulang tanpa memanggil server
  let settings = { src: 'auto', tgt: 'en', model: 'std' };
  chrome.storage.sync.get(settings).then((v) => { settings = { ...settings, ...v }; });
  chrome.storage.onChanged.addListener((ch) => { for (const k in ch) settings[k] = ch[k].newValue; });
  const settingsKey = () => `${settings.src}|${settings.tgt}|${settings.model}`;
  let running = false;

  const isOurs = (el) => typeof el.className === 'string' && el.className.startsWith('it-');
  function bgUrl(el) {
    const m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(el).backgroundImage || '');
    return m ? m[1] : '';
  }
  const big = (r) => r.width >= MIN_SIZE && r.height >= MIN_SIZE;
  // Terlihat sungguhan: tidak tersembunyi, dan tidak transparan di elemen itu maupun pembungkusnya.
  const visibleEl = (el) => {
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true });
    }
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return false;
    }
    return true;
  };
  // Apakah halaman ini punya <img>/<canvas> besar? Kalau ya, gambar latar (background-image) diabaikan,
  // karena pembungkus halaman sering punya background-image dan bukan komiknya.
  let hasImgCache = { t: 0, v: false };
  function pageHasImages() {
    const now = Date.now();
    if (now - hasImgCache.t < 1000) return hasImgCache.v;
    let v = false;
    for (const el of document.querySelectorAll('img,canvas')) {
      if (!isOurs(el) && big(el.getBoundingClientRect())) { v = true; break; }
    }
    hasImgCache = { t: now, v };
    return v;
  }
  // Cari gambar di bawah kursor. elementsFromPoint dipakai agar tetap ketemu walau ada lapisan transparan di atasnya.
  function findTarget(x, y) {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      if (isOurs(el)) { if (el === fab) return 'fab'; continue; }
      if (el.tagName !== 'IMG' && el.tagName !== 'CANVAS') continue;
      if (!big(el.getBoundingClientRect()) || !visibleEl(el)) continue;
      if (el.tagName === 'IMG' && !(el.complete && el.naturalWidth >= MIN_SIZE)) continue;
      const v = visibleRect(el);
      if (v.ok && x >= v.l && x <= v.r && y >= v.t && y <= v.b) return el;
    }
    if (pageHasImages()) return null;
    for (const el of els) {
      if (isOurs(el) || el === document.body || el === document.documentElement) continue;
      const r = el.getBoundingClientRect();
      if (!big(r) || (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9)) continue;
      const u = bgUrl(el);
      if (u && !u.startsWith('data:') && visibleEl(el)) return el;
    }
    return null;
  }
  function srcOf(el) {
    if (el.tagName === 'IMG') return el.currentSrc || el.src;
    if (el.tagName === 'CANVAS') { try { return el.toDataURL('image/png'); } catch (e) { return ''; } }
    return new URL(bgUrl(el), location.href).href;
  }

  // Bagian gambar yang benar-benar terlihat: irisan dengan layar dan semua kontainer yang bisa digulir.
  function visibleRect(el) {
    const full = el.getBoundingClientRect();
    let l = Math.max(full.left, 0), t = Math.max(full.top, 0);
    let r = Math.min(full.right, innerWidth), b = Math.min(full.bottom, innerHeight);
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
      const pr = p.getBoundingClientRect();
      l = Math.max(l, pr.left); t = Math.max(t, pr.top);
      r = Math.min(r, pr.right); b = Math.min(b, pr.bottom);
    }
    return { full, l, t, r, b, ok: r - l > 8 && b - t > 8 };
  }
  function put(el, x, y, w, h) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (w != null) { el.style.width = w + 'px'; el.style.height = h + 'px'; }
  }
  function clipTo(el, v) {
    const f = v.full;
    el.style.clipPath = `inset(${Math.max(v.t - f.top, 0)}px ${Math.max(f.right - v.r, 0)}px ${Math.max(f.bottom - v.b, 0)}px ${Math.max(v.l - f.left, 0)}px)`;
  }

  // Perkecil huruf sampai teks muat di dalam kotaknya.
  // scrollWidth dipakai agar satu kata tidak dipotong di tengah ("Benarka/h"): kata yang lebih lebar
  // dari kotak membuat ukuran huruf diperkecil, bukan katanya dipenggal.
  function fitText(layer) {
    for (const box of layer.children) {
      const span = box.firstChild;
      span.classList.remove('wrapany');
      const maxW = box.clientWidth - 8, maxH = box.clientHeight - 4;
      const muat = () => span.scrollWidth <= maxW + 1 && span.offsetHeight <= maxH;
      let lo = 7, hi = 28;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        box.style.fontSize = mid + 'px';
        if (muat()) lo = mid; else hi = mid - 1;
      }
      box.style.fontSize = lo + 'px';
      if (!muat()) span.classList.add('wrapany'); // kotak terlalu sempit: terpaksa memotong kata
    }
  }

  // ---- Cakupan hasil potret layar ----
  // Bila gambar hanya terpotret sebagian (terpotong layar), kita catat bagian mana yang sudah
  // diterjemahkan sebagai persegi [kiri, atas, kanan, bawah] dalam pecahan 0..1 dari gambar.
  const FULL = [[0, 0, 1, 1]];
  function visibleFrac(v) {
    const f = v.full;
    return [(v.l - f.left) / f.width, (v.t - f.top) / f.height, (v.r - f.left) / f.width, (v.b - f.top) / f.height];
  }
  // Seberapa banyak bagian yang sedang terlihat BELUM pernah diterjemahkan (0..1).
  // Dihitung dengan mengambil 10x10 titik sampel di area terlihat, cukup akurat dan murah tiap frame.
  function uncovered(vf, covered) {
    let miss = 0;
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        const x = vf[0] + ((i + 0.5) / 10) * (vf[2] - vf[0]);
        const y = vf[1] + ((j + 0.5) / 10) * (vf[3] - vf[1]);
        if (!covered.some((c) => x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3])) miss++;
      }
    }
    return miss / 100;
  }
  // Gambar yang sudah punya hasil masih boleh diberi tombol bila >15% bagian terlihatnya belum diterjemahkan.
  function needsMore(img) {
    const s = sessions.get(img);
    if (!s || !s.layer || !s.covered || s.load) return false;
    const v = visibleRect(img);
    return v.ok && uncovered(visibleFrac(v), s.covered) > 0.15;
  }
  // Gabungkan hasil lama dan baru. Kotak yang bertumpuk >50% dianggap balon yang sama:
  // yang dipertahankan adalah kotak yang lebih besar, karena balon yang tadinya terpotong tepi layar
  // biasanya terbaca lebih lengkap pada potret berikutnya.
  function mergeRegions(oldR, newR) {
    const area = (b) => b[2] * b[3];
    const overlap = (a, b) => {
      const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
      const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
      return w > 0 && h > 0 ? (w * h) / Math.min(area(a), area(b)) : 0;
    };
    const out = [...oldR];
    for (const n of newR) {
      const i = out.findIndex((o) => overlap(o.box, n.box) > 0.5);
      if (i < 0) out.push(n);
      else if (area(n.box) > area(out[i].box)) out[i] = n;
    }
    return out.sort((a, b) => a.box[1] - b.box[1]);
  }

  // Dipanggil tiap frame selama ada tombol atau hasil di layar, supaya semuanya ikut saat digulir.
  function layout() {
    if (fabOn && current && (!sessions.has(current) || needsMore(current))) {
      const v = visibleRect(current);
      if (v.ok) { put(fab, v.l + 12, v.t + 12); fab.classList.add('show'); } else fab.classList.remove('show');
    } else if (fab) fab.classList.remove('show');

    for (const s of [...sessions.values()]) {
      if (!s.img.isConnected) { removeSession(s); continue; } // situs membuang gambar ini; hasilnya tetap ada di cache
      const v = visibleRect(s.img);
      const f = v.full;
      if (s.layer) {
        put(s.layer, f.left, f.top, f.width, f.height);
        clipTo(s.layer, v);
        s.layer.classList.toggle('hid', !v.ok);
      }
      // Lingkaran proses menggantikan tombol di posisi yang sama (kiri atas bagian gambar yang terlihat).
      if (s.load) {
        put(s.load, v.l + 12, v.t + 12);
        s.load.classList.toggle('hid', !v.ok);
      }
      if (s.bar) {
        s.bar.style.display = v.ok ? '' : 'none';
        put(s.bar, v.l + 12, v.b - s.bar.offsetHeight - 12);
      }
      if (s.err) put(s.err, v.l + 12, v.t + 12);
      if (s.layer && (s.w !== f.width || s.h !== f.height)) {
        s.w = f.width; s.h = f.height;
        fitText(s.layer);
      }
    }
  }
  function loop() {
    layout();
    if (fabOn || sessions.size) requestAnimationFrame(loop); else running = false;
  }
  function start() { if (!running) { running = true; requestAnimationFrame(loop); } }

  function ensureFab() {
    if (fab) return fab;
    fab = document.createElement('button');
    fab.className = 'it-fab';
    fab.type = 'button';
    fab.textContent = '文A';
    fab.title = 'Terjemahkan gambar';
    fab.addEventListener('click', (e) => { e.stopPropagation(); if (current) run(current); });
    document.body.appendChild(fab);
    return fab;
  }
  function showFab(el) { ensureFab(); current = el; fabOn = true; start(); }
  function hideFab() { fabOn = false; if (fab) fab.classList.remove('show'); }

  let debug = false;
  let dbgBox = null;
  addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyD') {
      debug = !debug;
      if (!debug && dbgBox) { dbgBox.remove(); dbgBox = null; }
    }
  });
  function drawDebug(t) {
    if (!debug) return;
    if (!dbgBox) { dbgBox = document.createElement('div'); dbgBox.className = 'it-dbg'; document.body.appendChild(dbgBox); }
    if (!t || t === 'fab') { dbgBox.style.display = 'none'; return; }
    const r = t.getBoundingClientRect();
    dbgBox.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    dbgBox.textContent = `${t.tagName}.${(t.className || '').toString().slice(0, 40)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  }

  let moving = false;
  let lastPt = null;
  function refreshTarget() {
    moving = false;
    if (!lastPt) return;
    const t = findTarget(lastPt.x, lastPt.y);
    drawDebug(t);
    if (t === 'fab') return;
    if (t) showFab(t); else hideFab();
  }
  document.addEventListener('mousemove', (e) => {
    lastPt = { x: e.clientX, y: e.clientY };
    if (!moving) { moving = true; requestAnimationFrame(refreshTarget); }
  }, true);
  // Menggulir dengan roda mouse tidak menggerakkan kursor, tapi gambar di bawahnya berganti.
  document.addEventListener('scroll', () => {
    if (!moving) { moving = true; requestAnimationFrame(refreshTarget); }
  }, true);
  document.addEventListener('mouseleave', () => { lastPt = null; hideFab(); });

  function removeSession(s) {
    if (s.load) clearInterval(s.load._timer);
    for (const k of ['layer', 'bar', 'load', 'err']) s[k] && s[k].remove();
    sessions.delete(s.img);
  }

  // Tombol berubah menjadi lingkaran proses: cincin berputar dan detik berjalan di tengahnya.
  // Tidak ada panel yang menutupi komik (lihat tab "konsep visual").
  function makeLoader() {
    const el = document.createElement('div');
    el.className = 'it-load';
    el.innerHTML = '<svg viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="14" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3"/>'
      + '<path d="M17 3a14 14 0 0 1 14 14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg><span>0</span>';
    el.title = 'Menerjemahkan…';
    document.body.appendChild(el);
    const mulai = Date.now();
    el._timer = setInterval(() => {
      const dtk = Math.round((Date.now() - mulai) / 1000);
      el.lastChild.textContent = dtk;
      el.title = `Menerjemahkan… ${dtk} detik`;
    }, 1000);
    return el;
  }
  function stopLoader(el) { if (el) { clearInterval(el._timer); el.remove(); } }
  // Pesan error untuk pengguna. Credit hanya dipotong bila berhasil, jadi katakan dengan jelas.
  function errText(res) {
    const m = (res && res.message) || 'Terjemahan gagal';
    return res && res.code === 'NO_CREDIT' ? m : m + ' Credit tidak dipotong.';
  }

  function showResult(img, regions, covered = FULL) {
    const old = sessions.get(img);
    if (old) removeSession(old);
    const s = { img, w: -1, h: -1, covered, regions };
    s.layer = document.createElement('div');
    s.layer.className = 'it-layer';
    for (const reg of regions) {
      const [x, y, w, h] = reg.box;
      const b = document.createElement('div');
      b.className = 'it-box';
      b.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%`;
      const span = document.createElement('span');
      span.textContent = reg.text;
      b.appendChild(span);
      s.layer.appendChild(b);
    }
    document.body.appendChild(s.layer);

    s.bar = document.createElement('div');
    s.bar.className = 'it-bar';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Tampilkan asli';
    toggle.addEventListener('click', () => {
      const orig = s.layer.classList.toggle('orig');
      toggle.textContent = orig ? 'Tampilkan terjemahan' : 'Tampilkan asli';
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Tutup hasil';
    close.addEventListener('click', () => { dismissed.add(img); removeSession(s); });
    s.bar.append(toggle, close);
    document.body.appendChild(s.bar);
    sessions.set(img, s);
    start();
  }

  function showError(img, message) {
    const s = { img, err: document.createElement('div') };
    s.err.className = 'it-err';
    s.err.textContent = message;
    document.body.appendChild(s.err);
    sessions.set(img, s);
    start();
    setTimeout(() => { if (sessions.get(img) === s) removeSession(s); }, 4000);
  }

  // Pesan singkat di atas hasil yang sudah ada (tanpa menghapus hasilnya).
  function showNotice(img, message) {
    const s = sessions.get(img);
    if (!s) return;
    s.err = document.createElement('div');
    s.err.className = 'it-err';
    s.err.textContent = message;
    document.body.appendChild(s.err);
    setTimeout(() => { if (s.err) { s.err.remove(); s.err = null; } }, 4000);
  }

  // Lanjutan terjemahan untuk gambar yang baru sebagian diterjemahkan: potret bagian yang
  // sekarang terlihat, terjemahkan, lalu gabungkan dengan hasil sebelumnya.
  async function runMore(img, s) {
    hideFab();
    s.load = makeLoader();
    // Sembunyikan hasil lama dan loader agar tidak ikut terpotret.
    for (const el of [s.layer, s.bar, s.load]) el.style.visibility = 'hidden';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const v = visibleRect(img);
    let shot;
    try { shot = await chrome.runtime.sendMessage({ type: 'capture', rect: { l: v.l, t: v.t, r: v.r, b: v.b }, dpr: devicePixelRatio }); }
    catch (e) { shot = { ok: false, message: 'Ekstensi tidak merespons' }; }
    for (const el of [s.layer, s.bar, s.load]) el.style.visibility = '';
    let res = shot;
    if (shot.ok) {
      try { res = await chrome.runtime.sendMessage({ type: 'translate', image: shot.image }); }
      catch (e) { res = { ok: false, message: 'Ekstensi tidak merespons' }; }
    }
    if (sessions.get(img) !== s) return; // pengguna menutup hasil saat proses berjalan
    stopLoader(s.load); s.load = null;
    const covered = [...s.covered, visibleFrac(v)];
    let regions = null;
    if (res && res.ok) regions = mergeRegions(s.regions, toFull(res.regions, v));
    else if (res && res.code === 'NO_TEXT') regions = s.regions; // area kosong: tetap dicatat sudah diperiksa // area kosong: tetap dicatat sudah diperiksa
    if (!regions) { showNotice(img, errText(res)); return; }
    const key = img.tagName === 'CANVAS' ? null : srcOf(img);
    if (key) cache.set(key, { regions, sk: settingsKey(), covered });
    showResult(img, regions, covered);
  }
  // Kotak hasil potret relatif terhadap bagian yang terlihat; ubah menjadi relatif terhadap seluruh gambar.
  function toFull(regions, v) {
    const f = v.full, vw = v.r - v.l, vh = v.b - v.t;
    return regions.map((g) => {
      const [x, y, w, h] = g.box;
      return { ...g, box: [(v.l + x * vw - f.left) / f.width, (v.t + y * vh - f.top) / f.height, (w * vw) / f.width, (h * vh) / f.height] };
    });
  }

  async function run(img) {
    const ada = sessions.get(img);
    if (ada) { if (needsMore(img) && window === window.top) runMore(img, ada); return; }
    dismissed.delete(img);
    hideFab();
    const key = img.tagName === 'CANVAS' ? null : srcOf(img);
    const hit = key && cache.get(key);
    if (hit && hit.sk === settingsKey()) { showResult(img, hit.regions, hit.covered); return; } // sudah pernah diterjemahkan: gratis
    // Indikator proses (FR-14): lingkaran berputar dengan detik berjalan.
    const s = { img, load: makeLoader() };
    sessions.set(img, s);
    start();
    const sk = settingsKey();
    let covered = FULL; // unduhan langsung = seluruh gambar
    const kirim = async (msg) => {
      try { return await chrome.runtime.sendMessage(msg); } catch (e) { return { ok: false, message: 'Ekstensi tidak merespons' }; }
    };
    // Cara 1: unduh gambar dari alamatnya (kualitas terbaik, seluruh gambar).
    // Alamat blob: hanya bisa dibaca oleh halaman itu sendiri, jadi langsung pakai cara 2
    // (tanpa mencoba mengunduh, supaya lebih cepat dan tidak ada error di chrome://extensions).
    const url = srcOf(img);
    let res = url.startsWith('blob:')
      ? { ok: false, code: 'IMAGE_FETCH' }
      : await kirim({ type: 'translate', imageUrl: url });
    // Cara 2 (cadangan): situs memblokir unduhan -> potret bagian layar tempat gambar tampil.
    if (res && res.code === 'IMAGE_FETCH' && window === window.top) {
      s.load.style.visibility = 'hidden'; // jangan sampai lingkaran proses ikut terpotret
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const v = visibleRect(img);
      const shot = v.ok
        ? await kirim({ type: 'capture', rect: { l: v.l, t: v.t, r: v.r, b: v.b }, dpr: devicePixelRatio })
        : { ok: false, message: 'Gambar tidak terlihat di layar' };
      s.load.style.visibility = '';
      res = shot.ok ? await kirim({ type: 'translate', image: shot.image }) : shot;
      if (res && res.ok) res.regions = toFull(res.regions, v);
      // Catat bagian yang sudah dipotret, termasuk saat kosong, agar tombol bisa muncul lagi untuk bagian lain.
      if (v.ok) covered = [visibleFrac(v)];
    }
    stopLoader(s.load); s.load = null;
    removeSession(s);
    if (res && res.ok) {
      if (key) cache.set(key, { regions: res.regions, sk, covered });
      showResult(img, res.regions, covered);
    } else if (res && res.code === 'NO_TEXT' && covered !== FULL) {
      // Bagian terlihat tidak berisi teks; tampilkan hasil kosong supaya bagian lain tetap bisa dilanjutkan.
      showResult(img, [], covered);
      showNotice(img, res.message);
    } else {
      showError(img, errText(res));
    }
  }

  // Pulihkan hasil untuk gambar yang sudah pernah diterjemahkan dan kembali muncul di layar
  // (misalnya situs memuat ulang gambar saat digulir). Tidak memanggil server.
  function restoreVisible() {
    for (const el of document.images) {
      if (sessions.has(el) || dismissed.has(el)) continue;
      const hit = cache.get(el.currentSrc || el.src);
      if (!hit || hit.sk !== settingsKey()) continue;
      const r = el.getBoundingClientRect();
      if (r.width < MIN_SIZE || r.height < MIN_SIZE || r.bottom < 0 || r.top > innerHeight) continue;
      showResult(el, hit.regions, hit.covered);
    }
  }
  let restoreTimer = null;
  document.addEventListener('scroll', () => {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(restoreVisible, 200);
  }, true);
  // Situs yang membuang dan memasang ulang gambar tanpa digulir juga ditangani.
  new MutationObserver(() => {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(restoreVisible, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
