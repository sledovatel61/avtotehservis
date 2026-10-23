/**
 * Раунд 12, §6 и §7 — проверка СОДЕРЖИМОГО собранных файлов (веса и размеры
 * считает check-hero-layout.mjs, контраст текста — measure-contrast.mjs).
 *
 * §6 «О компании» (about-service-1600.webp, кроп 1600×1000 из
 *    original-front-wide 3840×2160, окно {left:600, top:250, 2560×1600}):
 *    - оба проёма ЦЕЛИКОМ внутри кадра (прямоугольники AL/AR из сборщика);
 *    - в проёмах стоят ДРУГИЕ машины (вставка из r12-gen/bay-sedan.jpg и
 *      bay-crossover.jpg): содержимое проёма отличается от фасада и темнее его;
 *    - тон вставок согласован с фасадом (ΔE76 ≤ 6 по кольцу вокруг проёма);
 *    - эмблема кроссовера неразличима (размытие): локальная резкость в
 *      прямоугольнике эмблемы заметно ниже, чем на решётке рядом.
 * §7 Фон панели диагностики (cta-diag-960.webp / cta-diag-640.webp):
 *    - нет читаемых фрагментов: доля «ярких тонких штрихов» (lum > 90 и
 *      локальный контраст 3×3 > 60) < 0,05 %, максимум яркости ≤ 150;
 *    - фон тёмный: средняя яркость ≤ 60 (иначе дим .78→.86 не даст 7:1).
 *
 * Запуск: node site/scripts/check-about-panel.mjs (exit 1 при провале).
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMG = join(HERE, '../public/img');

let fail = 0;
const bad = (m) => { fail = 1; console.error('FAIL ' + m); };
const chk = (name, pass, got, want) => {
  if (!pass) bad(`${name}: ${got}`);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}: ${got} (норма: ${want})`);
};

const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
/* Lab (D65) из sRGB — для ΔE76 */
function lab(d, i) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = f(d[i]), g = f(d[i + 1]), b = f(d[i + 2]);
  let X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  let Y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 1.0;
  let Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  X = t(X); Y = t(Y); Z = t(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

async function raw(file) {
  const { data, info } = await sharp(join(IMG, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height };
}
const meanLum = ({ d, w, h }, x0, y0, ww, hh, step = 2) => {
  let s = 0, n = 0;
  for (let y = Math.max(0, y0); y < Math.min(h, y0 + hh); y += step)
    for (let x = Math.max(0, x0); x < Math.min(w, x0 + ww); x += step) { s += lum(d, (y * w + x) * 3); n++; }
  return n ? s / n : 0;
};
const meanLab = ({ d, w, h }, x0, y0, ww, hh, step = 2) => {
  let L = 0, A = 0, B = 0, n = 0;
  for (let y = Math.max(0, y0); y < Math.min(h, y0 + hh); y += step)
    for (let x = Math.max(0, x0); x < Math.min(w, x0 + ww); x += step) {
      const [l, a, b] = lab(d, (y * w + x) * 3); L += l; A += a; B += b; n++;
    }
  return n ? [L / n, A / n, B / n] : [0, 0, 0];
};
/* доля пикселей с заметным локальным перепадом (содержимое, а не ровная стена) */
const edgeFrac = ({ d, w, h }, x0, y0, ww, hh) => {
  let e = 0, n = 0;
  for (let y = Math.max(1, y0); y < Math.min(h - 1, y0 + hh); y++)
    for (let x = Math.max(1, x0); x < Math.min(w - 1, x0 + ww); x++) {
      const c = (y * w + x) * 3;
      const gx = Math.abs(lum(d, c + 3) - lum(d, c - 3));
      const gy = Math.abs(lum(d, c + w * 3) - lum(d, c - w * 3));
      if (gx + gy > 24) e++;
      n++;
    }
  return n ? e / n : 0;
};

console.log('§6 «О компании» — about-service-1600.webp (РАУНД 14: чистый кроп master-clean, без вставок и грейда):');
const about = await raw('about-service-1600.webp');
chk('размер кадра', about.w === 1600 && about.h === 1000, `${about.w}×${about.h}`, '1600×1000 (16:10)');
/* проёмы в координатах кропа раунда 14 (окно {380,80,3000×1875} из master-clean):
   прямоугольники раунда 12 {600,250,2560×1600}→orig→новое окно */
const AL = { x: 356, y: 464, w: 411, h: 427 };
const AR = { x: 975, y: 464, w: 324, h: 427 };
for (const [name, r] of [['левый проём', AL], ['правый проём', AR]]) {
  const inside = r.x >= 0 && r.y >= 0 && r.x + r.w <= about.w && r.y + r.h <= about.h;
  chk(`${name} целиком в кадре`, inside,
    `x ${r.x}…${r.x + r.w}, y ${r.y}…${r.y + r.h}`, `внутри 0…${about.w} / 0…${about.h}`);
  const inL = meanLum(about, r.x, r.y, r.w, r.h);
  console.log(`     ${name}: средняя яркость содержимого ${inL.toFixed(1)}`);
}
{
  let y0 = -1, y1 = -1, x0 = about.w, x1 = 0;
  for (let y = 0; y < about.h; y += 2) {
    let c = 0, xa = about.w, xb = 0;
    for (let x = 0; x < about.w; x += 2) {
      const i2 = (y * about.w + x) * 3;
      const r2 = about.d[i2], g2 = about.d[i2 + 1], b2 = about.d[i2 + 2];
      if (g2 > r2 + 18 && b2 > r2 + 12 && g2 > 70) { c++; if (x < xa) xa = x; if (x > xb) xb = x; }
    }
    if (c > 200) { if (y0 < 0) y0 = y; y1 = y; if (xa < x0) x0 = xa; if (xb > x1) x1 = xb; }
  }
  chk('вывеска целиком в кадре', y0 >= 0 && y1 > y0 && x0 >= 0 && x1 <= about.w,
    `x ${x0}…${x1}, y ${y0}…${y1}`, 'внутри 0…1600 / 0…1000');
}
chk('вес about webp ≤ 160 КБ', statSync(join(IMG, 'about-service-1600.webp')).size / 1024 <= 160,
  (statSync(join(IMG, 'about-service-1600.webp')).size / 1024).toFixed(1) + ' КБ', '≤ 160 КБ');
chk('вес about avif ≤ 80 КБ', statSync(join(IMG, 'about-service-1600.avif')).size / 1024 <= 80,
  (statSync(join(IMG, 'about-service-1600.avif')).size / 1024).toFixed(1) + ' КБ', '≤ 80 КБ');
/* без грейда и вставок: финал = кроп master-clean {380,80,3000×1875} → 1600×1000 */
const SRC_CLEAN = join(HERE, '../../docs/photos-source/r13-clean/master-clean.jpg');
const base = await (async () => {
  const { data, info } = await sharp(SRC_CLEAN).extract({ left: 380, top: 80, width: 3000, height: 1875 })
    .resize(1600, 1000).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height };
})();
const meanAbsDiffFull = (A, B) => {
  let s2 = 0, n = 0;
  for (let y = 0; y < A.h; y += 2)
    for (let x = 0; x < A.w; x += 2) {
      const a = (y * A.w + x) * 3, b = (y * B.w + x) * 3;
      s2 += (Math.abs(A.d[a] - B.d[b]) + Math.abs(A.d[a + 1] - B.d[b + 1]) + Math.abs(A.d[a + 2] - B.d[b + 2])) / 3;
      n++;
    }
  return s2 / n;
};
const dAll = meanAbsDiffFull(about, base);
chk('кадр = чистый кроп master-clean (без грейда/вставок)', dAll <= 6, `средний |Δ| ${dAll.toFixed(2)} уровня`, '≤ 6');
for (const [name, r] of [['левый проём', AL], ['правый проём', AR]]) {
  let s2 = 0, n = 0;
  for (let y = r.y; y < r.y + r.h; y += 2)
    for (let x = r.x; x < r.x + r.w; x += 2) {
      const a = (y * about.w + x) * 3, b = (y * base.w + x) * 3;
      s2 += (Math.abs(about.d[a] - base.d[b]) + Math.abs(about.d[a + 1] - base.d[b + 1]) + Math.abs(about.d[a + 2] - base.d[b + 2])) / 3;
      n++;
    }
  chk(`${name}: без вставок (совпадает с фасадом)`, s2 / n <= 6, `средний |Δ| ${(s2 / n).toFixed(2)}`, '≤ 6');
}

console.log('\n§7 фон панели диагностики — cta-diag-960.webp / cta-diag-640.webp:');
for (const f of ['cta-diag-960.webp', 'cta-diag-640.webp']) {
  const im = await raw(f);
  let mx = 0, sum = 0, n = 0, strokes = 0;
  for (let y = 1; y < im.h - 1; y++) {
    for (let x = 1; x < im.w - 1; x++) {
      const c = (y * im.w + x) * 3;
      const L = lum(im.d, c);
      if (L > mx) mx = L;
      sum += L; n++;
      const gx = Math.abs(lum(im.d, c + 3) - lum(im.d, c - 3));
      const gy = Math.abs(lum(im.d, c + im.w * 3) - lum(im.d, c - im.w * 3));
      if (L > 90 && Math.max(gx, gy) > 60) strokes++;
    }
  }
  const frac = strokes / n;
  chk(`${f}: нет читаемых фрагментов (яркие тонкие штрихи)`, frac < 0.0005,
    `${(frac * 100).toFixed(4)} % пикселей`, '< 0,05 %');
  chk(`${f}: максимум яркости`, mx <= 150, mx.toFixed(0), '≤ 150');
  chk(`${f}: фон тёмный`, sum / n <= 60, (sum / n).toFixed(1), 'средняя яркость ≤ 60');
  chk(`${f}: вес ≤ 45 КБ`, statSync(join(IMG, f)).size / 1024 <= 45,
    (statSync(join(IMG, f)).size / 1024).toFixed(1) + ' КБ', '≤ 45 КБ');
}

console.log(fail ? 'ABOUT/ПАНЕЛЬ: ПРОВАЛ' : 'ABOUT/ПАНЕЛЬ: нормы §6–§7 выполнены');
process.exit(fail);
