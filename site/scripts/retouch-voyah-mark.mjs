/* Ретушь знака марки на кадре «вечером у сервиса» (круг 28).

   На master-кадре mockups/r28/voyah/img/evening.jpg (1400×781) фирменный знак «V»
   виден на решётке и в отражении в луже. По брифу официальную символику не
   используем, поэтому:
     • на решётке знак закрывается фрагментом самой решётки, снятым левее по той
       же строке (ламели и светодиодная полоса остаются на местах), края — мягкая
       маска, чтобы не было шва;
     • отражение в луже закрывать нечем (лужа искажает решётку), поэтому низ
       кадра — это «глубина резкости»: плавное размытие по градиентной маске.

   Результат: docs/photos-source/r28/voyah-evening-clean.jpg
   Запуск: node site/scripts/retouch-voyah-mark.mjs */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../../mockups/r28/voyah/img/evening.jpg');
const OUT = join(HERE, '../../docs/photos-source/r28/voyah-evening-clean.jpg');

/* координаты в мастере 1400×781 */
const HOLES = [
  /* знак «V» на решётке: тёмная перемычка между двумя участками светодиодной полосы.
     Берём её вместе с полосой и заклеиваем фрагментом решётки левее по той же строке. */
  { x: 494, y: 424, w: 32, h: 56, dx: 34, dy: 0, blur: 0.5, feather: 9 },
];
/* Отражение в луже знак не дублирует (проверено кадром) — размытие низа не нужно. */

function featheredMask(w, h, feather) {
  const buf = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.min(1, Math.min(x, w - 1 - x, y, h - 1 - y) / feather);
      buf[y * w + x] = Math.round(255 * (0.5 - 0.5 * Math.cos(Math.PI * d)));
    }
  }
  return buf;
}

const meta = await sharp(SRC).metadata();
console.log(`мастер: ${meta.width}×${meta.height}`);

const composite = [];
for (const hole of HOLES) {
  const left = hole.x - hole.dx;
  const { data, info } = await sharp(SRC)
    .extract({ left, top: hole.y, width: hole.w, height: hole.h })
    .blur(hole.blur)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = featheredMask(info.width, info.height, hole.feather);
  const masked = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .joinChannel(mask, { raw: { width: info.width, height: info.height, channels: 1 } })
    .png()
    .toBuffer();
  composite.push({ input: masked, left: hole.x, top: hole.y });
  console.log(`знак ${info.width}×${info.height} закрыт решёткой из (${left}, ${hole.y})`);
}

await sharp(SRC).composite(composite).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(OUT);
const outMeta = await sharp(OUT).metadata();
console.log(`готово: ${OUT} — ${outMeta.width}×${outMeta.height}`);
