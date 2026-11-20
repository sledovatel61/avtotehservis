/* Сборка: концепции → SVG, PNG 300 dpi (2×), PDF с вылетами, коллаж.
 *
 *   node build.mjs            всё
 *   node build.mjs --no-collage
 *
 * Ничего не пишет за пределами agents/agent-02/cards (кроме .cache шрифтов
 * и node_modules — они в .gitignore папки).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { Resvg } from '@resvg/resvg-js';
import { textToPath, ttfFiles } from './lib/font.mjs';
import { TRIM_W, TRIM_H, BLEED, PX_PER_MM, C } from './lib/canvas.mjs';
import { facts } from './lib/facts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const CONCEPTS = ['01-nochnoy-ceh', '02-formulyar', '03-kleymo', '04-svetlaya', '05-protektor'];

/** Обрезка вылетов: PNG карточки → только готовый размер. */
function cropTrim(png) {
  const b = Math.round(BLEED * PX_PER_MM * (png.width / ((TRIM_W + BLEED * 2) * PX_PER_MM)));
  const out = new PNG({ width: png.width - 2 * b, height: png.height - 2 * b });
  PNG.bitblt(png, out, b, b, out.width, out.height, 0, 0);
  return { png: out, bleedPx: b };
}

async function buildConcept(dir, mod) {
  const outDir = path.join(OUT, 'concepts', dir);
  fs.mkdirSync(outDir, { recursive: true });
  const sides = {};
  for (const side of ['front', 'back']) {
    const card = await mod[side]();
    fs.writeFileSync(path.join(outDir, `${side}.svg`), card.toSVG());
    const png = card.toPNG({ scale: 2 });
    fs.writeFileSync(path.join(outDir, `${side}.png`), png.buffer);
    sides[side] = { card, png };
  }
  const pdf = path.join(OUT, 'print', `card-02-${dir}.pdf`);
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  await sides.front.card.toPDF(pdf, { title: `02-${dir} лицевая`, cropMarks: true });
  await sides.back.card.toPDF(pdf.replace(/\.pdf$/, '-back.pdf'), { title: `02-${dir} оборотная`, cropMarks: true });
  return sides;
}

/* ---------- коллаж ---------- */

const W = 3400;
const M = 60;
const GAP = 40;
const NUM_COL = 300;
const CARD_W = Math.round((W - 2 * M - NUM_COL - GAP) / 2); // = 1470
const CARD_H = Math.round(CARD_W * TRIM_H / TRIM_W);

function txt(content, { face, px, x, y, fill = C.ivory, anchor = 'start', tracking = 0, opacity = 1 }) {
  return (async () => {
    const sizeMm = px; // в коллаже 1 единица = 1 px, считаем как мм
    const r = await textToPath(content, { weight: face, size: sizeMm, x, y, anchor, tracking: tracking * sizeMm });
    const op = opacity !== 1 ? ` opacity="${opacity}"` : '';
    return `<path d="${r.d}" fill="${fill}"${op}/>`;
  })();
}

async function buildCollage(sides) {
  const headerH = 150;
  const capH = 104;
  const rowGap = 46;
  const rows = CONCEPTS.length;
  const H = M + headerH + rows * (CARD_H + capH + rowGap) + M;
  const defs = [];
  const body = [];

  body.push(`<rect width="${W}" height="${H}" fill="${C.night}"/>`);
  body.push((await txt('АвтоТехСервис · визитка · агент 02', { face: 'unbounded-600', px: 46, x: M, y: M + 52, fill: C.ivory })));
  body.push((await txt('5 концепций × 2 стороны · 90 × 50 мм · шрифты сайта (Unbounded 600, Golos Text) · палитра tokens.css', { face: 'golos-400', px: 22, x: M, y: M + 92, fill: C.mist })));
  body.push((await txt('20 ноября 2026', { face: 'golos-400', px: 22, x: W - M, y: M + 52, fill: C.mist, anchor: 'end' })));
  body.push(`<line x1="${M}" y1="${M + headerH - 26}" x2="${W - M}" y2="${M + headerH - 26}" stroke="${C.brass}" stroke-width="1" opacity="0.5"/>`);

  let y = M + headerH;
  for (let i = 0; i < rows; i++) {
    const dir = CONCEPTS[i];
    const s = sides[i];
    const num = dir.slice(0, 2);

    // номер и название — слева от пары
    body.push(await txt(num, { face: 'unbounded-600', px: 84, x: M, y: y + 92, fill: C.copper }));
    body.push(await txt(s.name, { face: 'unbounded-600', px: 21, x: M, y: y + 132, fill: C.ivory }));

    const fx = M + NUM_COL;
    for (const [side, px] of [['front', fx], ['back', fx + CARD_W + GAP]]) {
      const { png } = s[side];
      const trimmed = cropTrim(PNG.sync.read(png.buffer || png));
      const scaled = trimmed.png;
      // приводим к точной ширине карточки в коллаже
      const resized = resizeNearest(scaled, CARD_W, CARD_H);
      const b64 = PNG.sync.write(resized).toString('base64');
      const id = `img-${i}-${side}`;
      defs.push(`<image id="${id}" width="${CARD_W}" height="${CARD_H}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${b64}"/>`);
      body.push(`<use xlink:href="#${id}" x="${px}" y="${y}"/>`);
      body.push(`<rect x="${px + 0.5}" y="${y + 0.5}" width="${CARD_W - 1}" height="${CARD_H - 1}" fill="none" stroke="${C.brass}" stroke-width="1" opacity="0.28"/>`);
      body.push(await txt(side === 'front' ? 'лицевая' : 'оборотная', { face: 'golos-400', px: 19, x: px, y: y + CARD_H + 30, fill: C.mist, opacity: 0.8 }));
    }
    body.push(await txt(s.idea, { face: 'golos-500', px: 24, x: fx, y: y + CARD_H + 74, fill: C.mist }));
    y += CARD_H + capH + rowGap;
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>${defs.join('')}</defs>
${body.join('\n')}
</svg>`;
  const dir = path.join(OUT, 'collage');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'collage-02.svg'), svg);

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: ttfFiles(), loadSystemFonts: false },
  });
  const png = resvg.render().asPng();
  fs.writeFileSync(path.join(dir, 'collage-02.png'), png);

  const raw = PNG.sync.read(png);
  let quality = 90;
  let jpg;
  do {
    jpg = jpeg.encode({ data: raw.data, width: raw.width, height: raw.height }, quality).data;
    quality -= 4;
  } while (jpg.length > 1_900_000 && quality > 60);
  fs.writeFileSync(path.join(dir, 'collage-02.jpg'), jpg);
  return { w: raw.width, h: raw.height, jpgBytes: jpg.length };
}

function resizeNearest(src, w, h) {
  const dst = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / w));
      const si = (sy * src.width + sx) * 4;
      const di = (y * w + x) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

/* ---------- запуск ---------- */

const only = process.argv.includes('--no-collage');
const all = [];
for (const dir of CONCEPTS) {
  const mod = await import(`./concepts/${dir}.mjs`);
  const sides = await buildConcept(dir, mod);
  all.push({ dir, name: mod.name, idea: mod.idea, num: mod.num, front: sides.front, back: sides.back });
  console.log(`· ${dir}: front.png ${sides.front.png.width}×${sides.front.png.height}, back.png ${sides.back.png.width}×${sides.back.png.height}`);
}
if (!only) {
  const c = await buildCollage(all);
  console.log(`· collage: ${c.w}×${c.h}, jpg ${(c.jpgBytes / 1024 / 1024).toFixed(2)} МБ`);
}
fs.writeFileSync(path.join(OUT, '.concepts.json'), JSON.stringify(all.map((a) => ({ dir: a.dir, num: a.num, name: a.name, idea: a.idea })), null, 1));
console.log('готово:', OUT);
