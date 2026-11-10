/* Знак марки Voyah Free на кадрах раздела (круг 29, требование владельца «F»).

   История: в круге 28 знак на решётке был закрыт ретушью
   (site/scripts/retouch-voyah-mark.mjs) — владелец это отменил: «логотипы Voyah
   на месте, не убирать». Возвращаем знак осмысленно: не оставляем размытое
   тёмное пятно, а ставим чистый металлический знак в ту же нишу на решётке.

   Как это сделано:
     • знак берётся той же геометрией, что стоит на странице: инлайн-компонент
       VoyahMark.astro и файл site/public/img/vy-mark-light.svg собраны из одного
       вектора (scripts/vectorize-voyah.py), поэтому «логотип на странице» и
       «логотип на машине» — один и тот же знак (две изогнутые лопасти +
       центральная игла, а не самодельная «V»);
     • композит идёт в мастеры (hero.jpg 1400×781 и evening.jpg 1400×781), а не в
       готовые vy-*: build-voyah-images.mjs режет из мастеров все размеры;
     • у знака есть мягкое свечение и лёгкий наклон под ракурс кадра, у героя —
       пониженная яркость (машина в глубине бокса, знак в тени).

   Результат:
     docs/photos-source/r28/voyah-hero-mark.jpg
     docs/photos-source/r28/voyah-evening-mark.jpg
   Запуск: node site/scripts/brand-voyah-mark.mjs
   Проверка глазами: node site/scripts/brand-voyah-mark.mjs --preview → tmp-*.jpg рядом. */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../../mockups/r28/voyah/img');
const OUT = join(HERE, '../../docs/photos-source/r28');
/* Знак на кадрах — тот же вектор, что и на странице (vy-mark-light.svg:
   белая заливка, потому что <img>/композит не наследуют currentColor).
   Раньше здесь был vy-mark.png, искажённый на ~8 % по пропорции; вектор ведён
   от docs/brand/voyah/source/logo-black-on-white.png, пропорция 0.7122. */
const MARK = join(HERE, '../public/img/vy-mark-light.svg');

/* координаты ниши знака (мастер 1400×781) и габарит знака в кадре */
const SHOTS = [
  {
    src: join(SRC, 'evening.jpg'),
    out: join(OUT, 'voyah-evening-mark.jpg'),
    /* ниша на решётке: тёмный «щит» между двумя участками светодиодной полосы.
       Замер по яркости мастера: щит 498…532 × 421…468 (широкий сверху, сходится
       в острие снизу) — знак ставим в щит целиком, как эмблема стоит на машине,
       а не «мелкой наклейкой» в верхней трети */
    x: 500, y: 424, w: 28, h: 41,
    rotate: -1.5, opacity: 1, blur: 0.4, glow: 0.42,
  },
  {
    src: join(SRC, 'hero.jpg'),
    out: join(OUT, 'voyah-hero-mark.jpg'),
    /* решётка в перспективе. Осевая линия кузова = центр номерного знака (774),
       ламели 292…322: эмблема стоит по центру решётки, а не на хромированной
       полосе сверху (так было в круге 29 — владелец: «промахнулся со значком,
       она на решётке радиатора»). Под знаком тёмная площадка-гнездо */
    x: 765, y: 296, w: 18, h: 25,
    rotate: -4, opacity: 0.95, blur: 0.3, glow: 0.3,
    back: { w: 30, h: 34, alpha: 0.62 },
  },
];

/* тёмная площадка под знаком: овальная, с мягкими краями — «гнездо» в решётке */
async function renderBack(w, h, alpha) {
  const pad = 0.35;
  const bw = Math.round(w * (1 + pad * 2)), bh = Math.round(h * (1 + pad * 2));
  const svgBack = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}">
    <defs><radialGradient id="b" cx=".5" cy=".5" r=".5">
      <stop offset=".35" stop-color="#04070B" stop-opacity="${alpha}"/>
      <stop offset="1" stop-color="#04070B" stop-opacity="0"/>
    </radialGradient></defs>
    <ellipse cx="${bw / 2}" cy="${bh / 2}" rx="${bw / 2}" ry="${bh / 2}" fill="url(#b)"/></svg>`;
  return { buf: await sharp(Buffer.from(svgBack)).png().toBuffer(), w: bw, h: bh };
}

async function render(s, w, h, opacity, blur) {
  const base = await sharp(MARK)
    .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .rotate(s.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const { data, info } = await sharp(base).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * opacity);
  let pipe = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  if (blur) pipe = pipe.blur(blur);
  return { buf: await pipe.png().toBuffer(), w: info.width, h: info.height };
}

for (const s of SHOTS) {
  const meta = await sharp(s.src).metadata();
  const mark = await render(s, s.w, s.h, s.opacity, s.blur);
  /* свечение: размытая копия знака холодным светом, чуть крупнее */
  const glowW = Math.round(s.w * 1.9), glowH = Math.round(s.h * 1.9);
  const glow = await sharp(MARK)
    .resize(glowW, glowH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .tint({ r: 234, g: 242, b: 255 })
    .blur(6)
    .png()
    .toBuffer();
  const gd = await sharp(glow).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < gd.data.length; i += 4) gd.data[i] = Math.round(gd.data[i] * s.glow);
  const glowBuf = await sharp(gd.data, { raw: { width: gd.info.width, height: gd.info.height, channels: 4 } }).png().toBuffer();

  const left = Math.round(s.x + s.w / 2 - mark.w / 2);
  const top = Math.round(s.y + s.h / 2 - mark.h / 2);
  const gl = Math.round(s.x + s.w / 2 - gd.info.width / 2);
  const gt = Math.round(s.y + s.h / 2 - gd.info.height / 2);

  const layers = [];
  if (s.back) {
    const b = await renderBack(s.back.w, s.back.h, s.back.alpha);
    layers.push({
      input: b.buf,
      left: Math.round(s.x + s.w / 2 - b.w / 2),
      top: Math.round(s.y + s.h / 2 - b.h / 2),
      blend: 'over',
    });
  }
  layers.push({ input: glowBuf, left: gl, top: gt, blend: 'screen' });
  layers.push({ input: mark.buf, left, top, blend: 'over' });

  await sharp(s.src)
    .composite(layers)
    .jpeg({ quality: 94, mozjpeg: true })
    .toFile(s.out);
  console.log(`${s.out.split('/').pop()}: знак ${mark.w}×${mark.h} в (${left}, ${top}) поверх ${meta.width}×${meta.height}`);
}

/* превью: вырезать зону вокруг знака ×4 — только для глаза, в репозиторий не идёт */
if (process.argv.includes('--preview')) {
  for (const s of SHOTS) {
    const crop = {
      left: Math.max(0, s.x - 60), top: Math.max(0, s.y - 40),
      width: Math.min(200, 1400 - Math.max(0, s.x - 60)), height: 140,
    };
    await sharp(s.out).extract(crop).resize({ width: 800, kernel: 'lanczos3' })
      .jpeg({ quality: 92 }).toFile(join('/tmp', 'mark-preview-' + s.out.split('/').pop()));
    console.log('превью: /tmp/mark-preview-' + s.out.split('/').pop());
  }
}
