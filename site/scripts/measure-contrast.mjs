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

/* 1) РАУНД 14: десктоп и планшет — текст стоит на фото ПОД скримом
   (hero.css ::before — горизонтальный градиент, ::after/второй слой — вертикальный
   снизу). Худший пиксель ищем внутри зоны текстаSafe-zone (safe-zone-geom.json,
   мастер 2560×1440), компонуя фото + оба градиента; норма для заголовка И подзаголовка ≥4.5. */
const stopA = (stops, t) => {
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const [t0, a0] = stops[k - 1], [t1, a1] = stops[k];
      return a0 + (a1 - a0) * (t - t0) / (t1 - t0);
    }
  }
  return stops[stops.length - 1][1];
};
async function worstInZone(file, zone, stopsH, botA) {
  const r = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const w = r.info.width, h = r.info.height, ch = r.info.channels;
  const [x0, y0, x1, y1] = zone;
  let worst = null, wl = -1, wx = 0, wy = 0;
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const a1 = stopA(stopsH, x / (w - 1));
      const a2 = botA(y / (h - 1));
      const a = 1 - (1 - a1) * (1 - a2);
      const i = (y * w + x) * ch;
      const px = over([r.data[i], r.data[i + 1], r.data[i + 2]], a, OVER);
      const l = lum(px);
      if (l > wl) { wl = l; worst = px; wx = x; wy = y; }
    }
  }
  return { worst, wx, wy, wl };
}
/* десктоп ≥1024: зона текста из safe-zone-geom.json (title zone), скрим hero.css ≥1024 */
const desk = await worstInZone(join(IMG, 'hero-service-2560.webp'), [249, 344, 1126, 1098],
  [[0, .94], [.26, .90], [.44, .74], [.52, .34], [.60, 0]],
  (t) => (t > .74 ? .55 * (t - .74) / .26 : 0));
row('≥1025 герой', `h1 ivory по худшему пикселю зоны (${desk.wx},${desk.wy})`, IVORY, desk.worst, 4.5);
row('≥1025 герой', `sub mist по худшему пикселю зоны (${desk.wx},${desk.wy})`, MIST, desk.worst, 4.5);
/* планшет 1024×768: hero h=553, scale=.4, верх кропа 29 px мастера; текст x 4…62 % */
const tab = await worstInZone(join(IMG, 'hero-service-2560.webp'), [102, 244, 1126, 1194],
  [[0, .94], [.26, .90], [.44, .74], [.52, .34], [.60, 0]],
  (t) => { const ys = (t * 1440 - 29) / 1382; return ys > .68 ? .62 * (ys - .68) / .32 : 0; });
row('641…1024 герой', `h1 ivory по худшему пикселю зоны (${tab.wx},${tab.wy})`, IVORY, tab.worst, 4.5);
row('641…1024 герой', `sub mist по худшему пикселю зоны (${tab.wx},${tab.wy})`, MIST, tab.worst, 4.5);

/* 2) РАУНД 15: мобильные — текст ПОД полосой фото, на сплошном --night */
row('≤640 герой', 'h1 ivory на --night (текст под фото)', IVORY, NIGHT, 4.5);
row('≤640 герой', 'sub mist на --night (текст под фото)', MIST, NIGHT, 4.5);

/* 3) панель диагностики: градиент .78→.86 поверх cta-diag-960 */
const diagBg = await worstAfter(join(IMG, 'cta-diag-960.webp'), (t) => 0.78 + 0.08 * t, [11, 20, 16]);
row('панель диагностики', 'h3 brass по худшему пикселю фона', BRASS, diagBg, 7);
row('панель диагностики', 'p mist по худшему пикселю фона', MIST, diagBg, 7);

console.log(fail ? 'КОНТРАСТ: ПРОВАЛ' : 'КОНТРАСТ: все нормы выполнены');
process.exit(fail);
