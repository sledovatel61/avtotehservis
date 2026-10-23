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
/* прямоугольники проёмов — те же, что в build-images.mjs (патч «О компании») */
const AL = { x: 280, y: 437, w: 482, h: 500 };
const AR = { x: 1005, y: 437, w: 380, h: 500 };
const EMB = { x: AR.x + 120, y: AR.y + 280, w: 80, h: 60 };

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

console.log('§6 «О компании» — about-service-1600.webp:');
const about = await raw('about-service-1600.webp');
chk('размер кадра', about.w === 1600 && about.h === 1000, `${about.w}×${about.h}`, '1600×1000 (16:10)');
for (const [name, r] of [['левый проём', AL], ['правый проём', AR]]) {
  const inside = r.x >= 0 && r.y >= 0 && r.x + r.w <= about.w && r.y + r.h <= about.h;
  chk(`${name} целиком в кадре`, inside,
    `x ${r.x}…${r.x + r.w}, y ${r.y}…${r.y + r.h}`, `внутри 0…${about.w} / 0…${about.h}`);
}
chk('вес about ≤ 70 КБ', statSync(join(IMG, 'about-service-1600.webp')).size / 1024 <= 70,
  (statSync(join(IMG, 'about-service-1600.webp')).size / 1024).toFixed(1) + ' КБ', '≤ 70 КБ');

/* Эталон — тот же кроп фасада БЕЗ вставок (aboutBase из сборщика: SRCW, окно
   {left:600, top:250, 2560×1600} → 1600×1000). Сравнивая финал с ним, проверяем:
   1) граница вставки невидима (перо 32 px + согласование тона) — ΔE76 ≤ 6
      в полосе 6 px сразу внутри проёма;
   2) в проёме действительно ДРУГАЯ машина: содержимое совпадает с исходником
      r12-gen/bay-*.jpg и НЕ совпадает с фасадом. */
const SRCW = join(HERE, '../../docs/photos-source/original-front-wide-3840x2160.jpg');
const R12 = join(HERE, '../../docs/photos-source/r12-gen');
const base = await (async () => {
  const { data, info } = await sharp(SRCW).extract({ left: 600, top: 250, width: 2560, height: 1600 })
    .resize(1600, 1000).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height };
})();
const dE76 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/* средний |Δ| по каналам между двумя кадрами в прямоугольнике (внутрь от пера) */
const meanAbsDiff = (A, B, r, inset) => {
  let s = 0, n = 0;
  for (let y = r.y + inset; y < r.y + r.h - inset; y += 2)
    for (let x = r.x + inset; x < r.x + r.w - inset; x += 2) {
      const a = (y * A.w + x) * 3, b = (y * B.w + x) * 3;
      s += (Math.abs(A.d[a] - B.d[a]) + Math.abs(A.d[a + 1] - B.d[b + 1]) + Math.abs(A.d[a + 2] - B.d[b + 2])) / 3;
      n++;
    }
  return n ? s / n : 0;
};
const INSERTS = [
  ['левый проём (седан на подъёмнике)', AL, { file: 'bay-sedan.jpg', left: 115, top: 150, width: 785, height: 685 }],
  ['правый проём (кроссовер)', AR, { file: 'bay-crossover.jpg', left: 200, top: 210, width: 520, height: 620 }],
];
for (const [name, r, src] of INSERTS) {
  /* 1) невидимая граница вставки */
  const ring = [];
  for (let k = 0; k < 6; k++) {
    const pts = [];
    for (let x = r.x + k; x < r.x + r.w - k; x += 4) { pts.push([x, r.y + k], [x, r.y + r.h - 1 - k]); }
    for (let y = r.y + k; y < r.y + r.h - k; y += 4) { pts.push([r.x + k, y], [r.x + r.w - 1 - k, y]); }
    ring.push(pts);
  }
  let dE = 0, cnt = 0;
  for (const pts of ring) for (const [x, y] of pts) {
    const a = (y * about.w + x) * 3, b = (y * base.w + x) * 3;
    dE += dE76(lab(about.d, a), lab(base.d, b)); cnt++;
  }
  dE /= Math.max(1, cnt);
  chk(`${name}: граница вставки не видна`, dE <= 6, `ΔE76 ${dE.toFixed(2)} к фасаду в полосе 6 px`, '≤ 6');
  /* 2) содержимое — другой кадр */
  const ins = await (async () => {
    const { data, info } = await sharp(join(R12, src.file))
      .extract({ left: src.left, top: src.top, width: src.width, height: src.height })
      .resize(r.w, r.h).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { d: data, w: r.w, h: r.h };
  })();
  /* вставка в финале лежит в r.x/r.y — сдвинем исходник в те же координаты */
  const shifted = { d: Buffer.alloc(base.d.length), w: base.w, h: base.h };
  base.d.copy(shifted.d);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const a = ((r.y + y) * shifted.w + (r.x + x)) * 3, b = (y * ins.w + x) * 3;
    shifted.d[a] = ins.d[b]; shifted.d[a + 1] = ins.d[b + 1]; shifted.d[a + 2] = ins.d[b + 2];
  }
  const dSrc = meanAbsDiff(about, shifted, r, 40);   // против своего исходника
  const dBase = meanAbsDiff(about, base, r, 40);     // против пустого проёма фасада
  chk(`${name}: в проёме кадр из ${src.file}`, dSrc < 25, `средний |Δ| ${dSrc.toFixed(1)} уровня`, '< 25 (та же картинка)');
  chk(`${name}: это НЕ исходный проём фасада`, dBase > 25, `средний |Δ| ${dBase.toFixed(1)} уровня к фасаду`, '> 25 (содержимое заменено)');
  const eIn = edgeFrac(about, r.x + 20, r.y + 20, r.w - 40, r.h - 40);
  chk(`${name}: содержимое читается`, eIn > 0.05, `доля перепадов ${(eIn * 100).toFixed(1)} %`, '> 5 % (машина, а не пустой проём)');
}
/* эмблема кроссовера размыта: резкость внутри эмблемы ниже, чем на решётке рядом */
const eEmb = edgeFrac(about, EMB.x, EMB.y, EMB.w, EMB.h);
const eGrille = edgeFrac(about, EMB.x - 100, EMB.y, 80, EMB.h);
chk('эмблема кроссовера неразличима (размыта)', eEmb < eGrille / 4,
  `перепады ${(eEmb * 100).toFixed(1)} % в эмблеме против ${(eGrille * 100).toFixed(1)} % на решётке рядом`,
  'эмблема ≥4× мягче окружения');

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
