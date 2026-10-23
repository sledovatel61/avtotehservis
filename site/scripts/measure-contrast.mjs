/**
 * Раунд 12: пиксельный WCAG-контраст текста для трёх режимов компоновки.
 *  1) ≥1025 и 641…1024: текст героя стоит на сплошном --night (#0B1410) —
     подложек и scrim поверх фото нет (hero.css: .slide-bg::before/::after content:none).
 *  2) ≤640: текст героя на панели rgba(6,11,9,.82) поверх мобильного кадра 4:5
 *     (hero-service-m-640.webp) — худший пиксель кадра.
 *  3) Панель диагностики .est-aside: linear-gradient(rgba(11,20,16,.78) →
 *     rgba(11,20,16,.86)) поверх cta-diag-960.webp — худший пиксель фона;
 *     h3 (--brass) и p (--mist) обязаны дать ≥7:1 (задание §7).
 * Пороги: h1 крупный — 3:1, sub/p — 4.5:1, панель диагностики h3/p — 7:1.
 * Запуск: node site/scripts/measure-contrast.mjs (exit 1 при провале).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../site/node_modules/sharp');
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMG = join(HERE, '../public/img');

const NIGHT = [0x0b, 0x14, 0x10];
const IVORY = [0xf4, 0xef, 0xe6];
const MIST = [0xb7, 0xc4, 0xbb];
const BRASS = [0xe0, 0xa9, 0x6d];
const OVER = [6, 11, 9];

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const over = (bg, a, c) => bg.map((v, i) => v * (1 - a) + c[i] * a);

/* худший (самый светлый) пиксель фона после дима/панели */
async function worstAfter(file, dimAt, color = OVER) {
  const r = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const w = r.info.width, h = r.info.height, ch = r.info.channels;
  let worst = null, wl = -1;
  for (let y = 0; y < h; y += 2) {
    const a = dimAt(y / (h - 1));
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * ch;
      const px = over([r.data[i], r.data[i + 1], r.data[i + 2]], a, color);
      const l = lum(px);
      if (l > wl) { wl = l; worst = px; }
    }
  }
  return worst;
}

let fail = 0;
const row = (where, what, color, bg, need) => {
  const r = ratio(color, bg);
  const bad = r < need;
  if (bad) fail = 1;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${where}: ${what} ${r.toFixed(2)}:1 (норма ≥${need})`);
};

/* 1) десктоп и планшет: текст на сплошном --night */
row('≥1025 герой', 'h1 ivory', IVORY, NIGHT, 3);
row('≥1025 герой', 'sub mist', MIST, NIGHT, 4.5);
row('641…1024 герой', 'h1 ivory', IVORY, NIGHT, 3);
row('641…1024 герой', 'sub mist', MIST, NIGHT, 4.5);

/* 2) мобильные: панель .82 поверх кадра 4:5 */
const mobBg = await worstAfter(join(IMG, 'hero-service-m-640.webp'), () => 0.82);
row('≤640 герой', 'h1 ivory по худшему пикселю панели', IVORY, mobBg, 3);
row('≤640 герой', 'sub mist по худшему пикселю панели', MIST, mobBg, 4.5);

/* 3) панель диагностики: градиент .78→.86 поверх cta-diag-960 */
const diagBg = await worstAfter(join(IMG, 'cta-diag-960.webp'), (t) => 0.78 + 0.08 * t, [11, 20, 16]);
row('панель диагностики', 'h3 brass по худшему пикселю фона', BRASS, diagBg, 7);
row('панель диагностики', 'p mist по худшему пикселю фона', MIST, diagBg, 7);

console.log(fail ? 'КОНТРАСТ: ПРОВАЛ' : 'КОНТРАСТ: все нормы выполнены');
process.exit(fail);
