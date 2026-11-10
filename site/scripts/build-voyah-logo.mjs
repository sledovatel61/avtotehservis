/* Знак и лейбл Voyah из исходников владельца (круг 30).

   Исходники лежат в docs/brand/voyah/source/ — это файлы, которые владелец прислал
   в Drive 10.11.2026:
     logo-white-on-dark.jpg    — белый знак + надпись VOYAH на тёмно-синем фоне (920×518);
     logo-black-on-white.png   — чёрный знак + надпись на белом, вертикальная композиция (1536×864);
     grille-badge-lit.jpg      — реальная эмблема на решётке машины под светом (1200×900).

   Почему не «нарисовать SVG руками»: прошлый знак был собран на глаз и получился
   тремя палочками вместо двух изогнутых лопастей и центральной иглы. Здесь контур
   берётся с файла владельца: альфа считается по яркости пикселя относительно фона,
   цвет — белый. Кромка сглажена по альфе, поэтому знак чист на любом фоне.

   Выход:
     site/public/img/vy-mark.png      — знак без надписи, прозрачный фон, 512 px;
     site/public/img/vy-mark@2x.png   — тот же в 256 px для мелких мест (24–30 px в вёрстке);
     site/public/img/vy-label.png      — надпись VOYAH отдельно, прозрачный фон;
     site/public/img/vy-lockup.png     — знак + надпись в одну строку (как в файле владельца).
   Векторную версию делает отдельный агент (prompts/45) — этот скрипт даёт точную
   растровую замену, чтобы на странице не висела самодельная «V из трёх линий».

   Запуск: node site/scripts/build-voyah-logo.mjs */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../../docs/brand/voyah/source');
const OUT = join(HERE, '../public/img');

/* зоны в файле logo-white-on-dark.jpg (920×518), замерены по кадру */
const CROP = {
  mark: { left: 58, top: 108, width: 200, height: 290 },
  label: { left: 282, top: 196, width: 580, height: 118 },
};

async function whiteOnTransparent(file, area) {
  const { data, info } = await sharp(file)
    .extract(area)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  /* фон файла — тёмно-синий ≈ rgb(35,40,56); альфа = насколько пиксель светлее фона */
  const bg = [35, 40, 56];
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0, p = 0; i < w * h; i++, p += ch) {
    const lum = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
    const bgLum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
    let a = (lum - bgLum) / (255 - bgLum);
    a = Math.max(0, Math.min(1, a));
    /* мягкий порог: убираем шум JPEG в тёмной зоне, сохраняя кромку */
    a = a < 0.08 ? 0 : a > 0.94 ? 1 : (a - 0.08) / 0.86;
    out[i * 4] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 });
}

async function save(pipe, name, width) {
  const buf = await pipe.clone().resize({ width, kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(OUT, name), buf);
  console.log(`  ${name}: ${width} px, ${(buf.length / 1024).toFixed(1)} КБ`);
}

const file = join(SRC, 'logo-white-on-dark.jpg');
const meta = await sharp(file).metadata();
console.log(`исходник ${meta.width}×${meta.height}`);

console.log('знак:');
const mark = await whiteOnTransparent(file, CROP.mark);
await save(mark, 'vy-mark.png', 512);
await save(mark, 'vy-mark@2x.png', 256);

console.log('надпись VOYAH:');
const label = await whiteOnTransparent(file, CROP.label);
await save(label, 'vy-label.png', 960);

/* локап: знак слева, надпись справа, выровнены по центру — как в файле владельца */
console.log('локап (знак + надпись):');
{
  const m = await sharp(join(OUT, 'vy-mark.png')).metadata();
  const l = await sharp(join(OUT, 'vy-label.png')).metadata();
  const gap = 34;
  const H = Math.max(m.height, l.height);
  const W = m.width + gap + l.width;
  const markBuf = await sharp(join(OUT, 'vy-mark.png')).toBuffer();
  const labelBuf = await sharp(join(OUT, 'vy-label.png')).toBuffer();
  /* холст с запасом: composite в sharp требует, чтобы каждая вставка была
     не больше холста, а при узком знаке надпись может выйти за расчётную высоту */
  /* важно: sharp выполняет resize РАНЬШЕ composite, поэтому сначала собираем
     холст в исходном масштабе, и только потом уменьшаем готовый буфер */
  const raw = await sharp({ create: { width: W + 8, height: H + 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: markBuf, left: 0, top: Math.round((H - m.height) / 2) },
      { input: labelBuf, left: m.width + gap, top: Math.round((H - l.height) / 2) },
    ])
    .png()
    .toBuffer();
  const buf = await sharp(raw).resize({ width: 1200 }).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(OUT, 'vy-lockup.png'), buf);
  console.log(`  vy-lockup.png: ${(buf.length / 1024).toFixed(1)} КБ`);
}

/* контроль: знак не пустой и пропорции как у оригинала (высота > ширины) */
{
  const m = await sharp(join(OUT, 'vy-mark.png')).metadata();
  const ok = m.width > 100 && m.height > m.width * 1.1;
  console.log(ok
    ? `проверка: знак ${m.width}×${m.height} — вертикальный, как оригинал`
    : `ПРОВАЛ: пропорции знака ${m.width}×${m.height} не похожи на оригинал`);
  process.exit(ok ? 0 : 1);
}
