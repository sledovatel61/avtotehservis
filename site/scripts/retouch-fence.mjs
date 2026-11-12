/**
 * Раунд 15, дефект №2: ретушь master-clean.jpg ДО кропа «О компании».
 * В небе над правым концом кровли торчали две светлые «спицы» (остатки забора)
 * и тянулась тонкая проволока — в кадре они не связаны ни с чем (скрины d/f).
 * Обе зоны лежат на ровном небе, поэтому заполнение — медиана по столбцу из
 * чистых строк НЕБА над дефектом + детерминированный шум ±1. Вне прямоугольников
 * ретуши файл не меняется (compare RMSE = 0).
 * Запуск: node site/scripts/retouch-fence.mjs   (идемпотентно: копию держим в
 * master-clean-prefence.jpg, правим всегда от неё).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../site/node_modules/sharp');
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../../docs/photos-source/r13-clean/master-clean.jpg');
const PRE = join(HERE, '../../docs/photos-source/r13-clean/master-clean-prefence.jpg');
if (!existsSync(PRE)) copyFileSync(SRC, PRE);

/* зоны ретуши в координатах master-clean 3840×2160:
   R1 — спицы: x 3180…3280, y 390…450 (небо над ними чисто на y 360…385)
   R2 — проволока правее кромки кровли до правого края окна «О компании»:
        x 3300…3380, y 430…470 (небо над ней чисто на y 380…420) */
/* R1 — спицы над кромкой кровли: кромку находим по пикселям (первая тёмная строка
   кровли в колонке), заполняем только НЕБО над ней; тон неба — медиана ПО СТРОКЕ
   из чистых колонок 3285…3315 (справа от спиц, слева от проволоки), основания спиц
   на кровле — тоном кровли слева на тех же строках.
   R2 — проволока правее кромки до правого края окна «О компании» (master x 3380):
   тон — медиана по столбцу из неба над ней (y 380…420). */
const L = (x, y) => { const i = (y * W + x) * C; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; };
const ROOF_Y = (x) => {
  for (let y = 395; y < 520; y++) if (L(x, y) < 130 && L(x, y + 1) < 130 && L(x, y + 2) < 130) return y;
  return 520;
};

const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const r = await sharp(PRE).raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = r.info;
const d = Buffer.from(r.data);
const rng = mulberry32(0x51ab77);
const fill = (x, y, med) => {
  const i = (y * W + x) * C;
  const n = (rng() - 0.5) * 2;
  for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, Math.round(med[c] + n)));
};
const rowMed = (y, xa, xb) => [0, 1, 2].map((c) => {
  const col = [];
  for (let x = xa; x < xb; x++) col.push(d[(y * W + x) * C + c]);
  col.sort((a, b) => a - b);
  return col[col.length >> 1];
});
const colMed = (x, ya, yb) => [0, 1, 2].map((c) => {
  const col = [];
  for (let y = ya; y < yb; y++) col.push(d[(y * W + x) * C + c]);
  col.sort((a, b) => a - b);
  return col[col.length >> 1];
});
/* R1: спицы x 3188…3272: небо y 390…кромка−1, затем основания спиц НА кровле
   (кромка…кромка+6) тоном самой кровли слева на тех же строках */
for (let x = 3188; x < 3272; x++) {
  const yEdge = ROOF_Y(x);
  for (let y = 390; y < yEdge; y++) fill(x, y, rowMed(y, 3285, 3315));
  for (let y = yEdge; y < yEdge + 7; y++) fill(x, y, rowMed(y, 3140, 3180));
}
/* R2: проволока x 3300…3380, y 432…470 */
for (let x = 3300; x < 3380; x++) {
  const med = colMed(x, 380, 420);
  for (let y = 432; y < 470; y++) fill(x, y, med);
}
await sharp(d, { raw: { width: W, height: H, channels: C } }).jpeg({ quality: 92, mozjpeg: false }).toFile(SRC);
console.log('ретушь master-clean: спицы x3188…3272 над кромкой кровли + проволока x3300…3380, y432…470');
