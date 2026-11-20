/* Коллаж: одна картинка, по которой за минуту видны все пять концепций.
   Пять рядов: лицевая + оборотная в одном масштабе, подпись Unbounded. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { loadFonts } from './lib/fonts.mjs';
import { textCmds } from './lib/text.mjs';
import { C } from './lib/palette.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const OUT = path.resolve(import.meta.dirname, '..');
const fonts = await loadFonts(path.join(ROOT, 'site/public/fonts'));

const W = 3300;
const PAD = 60;
const CARD_W = 1120;                       // 90 мм в масштабе коллажа
const CARD_H = Math.round(CARD_W * 50 / 90);
const GAP = 40;
const TEXT_H = 130;
const ROW_H = CARD_H + TEXT_H;
const TOP = 190;                            // заголовок
const H = TOP + 5 * ROW_H + PAD + 40;

const mods = [];
for (const f of (await fs.readdir(path.join(import.meta.dirname, 'concepts'))).sort()) mods.push(await import(`./concepts/${f}`));

const bg = C.night;
const parts = [];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Кегль коллажа задаём в пикселях: textCmds считает в пунктах (1 pt = 0,3528 мм),
   а на коллаже 1 «мм» = 1 px, поэтому переводим px → pt. */
const px = (v) => v * 2.8346;
function text(doc, str, o) {
  const r = textCmds(fonts, str, { ...o, size: px(o.px ?? 30) });
  doc.push(`<path d="${r.d}" fill="${o.fill}"/>`);
  return { x0: r.x0, x1: r.x1 };
}

for (const [i, m] of mods.entries()) {
  const y = TOP + i * ROW_H;
  for (const [k, side] of [[0, 'front'], [1, 'back']]) {
    const x = k === 0 ? PAD + 40 : PAD + 40 + CARD_W + GAP;
    const svg = await fs.readFile(path.join(OUT, 'concepts', m.meta.id, `${side}.svg`), 'utf8');
    // SVG — рабочий холст 96×56 мм (с вылетами). Для коллажа обрезаем вылеты:
    // показываем ровно готовый размер 90×50, как он выйдет из-под реза.
    const fullW = Math.round(CARD_W * 96 / 90);
    const bleed = Math.round((3 / 96) * fullW);
    const full = await new Resvg(svg, { fitTo: { mode: 'width', value: fullW } }).render().asPng();
    const px = await sharp(full).extract({ left: bleed, top: bleed, width: fullW - 2 * bleed, height: Math.round(fullW * 56 / 96) - 2 * bleed }).png().toBuffer();
    parts.push({ input: px, left: Math.round(x), top: Math.round(y) });
  }
}

const doc = [];
doc.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);
// шапка
text(doc, 'АвтоТехСервис · визитка · агент 01', { x: PAD, y: 100, px: 64, family: 'Unbounded', weight: 600, fill: C.ivory });
text(doc, 'пять концепций, по 90 × 50 мм, лицевая и оборотная · 20.11.2026', { x: PAD, y: 152, px: 34, family: 'Golos', weight: 400, fill: C.mist });
doc.push(`<path d="M${PAD} 172L${W - PAD} 172" stroke="${C.brass}" stroke-width="2" stroke-opacity=".55"/>`);

for (const [i, m] of mods.entries()) {
  const y = TOP + i * ROW_H;
  const ty = y + CARD_H + 52;
  // тонкая рамка вокруг пары
  doc.push(`<rect x="${PAD + 40 - 1}" y="${y - 1}" width="${CARD_W * 2 + GAP + 2}" height="${CARD_H + 2}" fill="none" stroke="${C.brass}" stroke-opacity=".18" stroke-width="1"/>`);
  text(doc, `${m.meta.num} · ${m.meta.title}`, { x: PAD + 40, y: ty, px: 36, family: 'Unbounded', weight: 600, fill: C.ivory });
  text(doc, m.meta.idea, { x: PAD + 40, y: ty + 42, px: 26, family: 'Golos', weight: 400, fill: C.mist });
  // номер справа — чтобы можно было называть концепцию вслух
  text(doc, 'лицевая / оборотная', { x: W - PAD - 40, y: ty, px: 24, family: 'Golos', weight: 500, fill: C.brass, align: 'right', tracking: 0.08 });
}

const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${doc.join('\n')}</svg>`);
const base = await new Resvg(overlay, { fitTo: { mode: 'width', value: W } }).render().asPng();
const png = await sharp(base).composite(parts).png({ compressionLevel: 9 }).toBuffer();
await fs.mkdir(path.join(OUT, 'collage'), { recursive: true });
await fs.writeFile(path.join(OUT, 'collage', 'collage-01.png'), png);
const jpg = await sharp(png).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
await fs.writeFile(path.join(OUT, 'collage', 'collage-01.jpg'), jpg);
console.log('коллаж', W + '×' + H, 'png', (png.length / 1024).toFixed(0) + ' КБ', 'jpg', (jpg.length / 1024).toFixed(0) + ' КБ');
