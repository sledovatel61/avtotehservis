#!/usr/bin/env node
/**
 * Кадры «машина / без машины» для гейтов круга 36 (задание №63).
 *
 *   node tools/bg3d/frames-car.mjs --out ../docs/reports/r36-live/frames
 *
 * Пишет шесть PNG: car-*.png и nocar-*.png на 1440×900, 1280×720 и 390×844.
 * Кадр «без машины» — та же сцена, тот же туман и тот же пол, но пластина не
 * рисуется: маска машины = разница двух кадров. Так её и считает
 * `scripts/bg3d-side-iou.mjs`, и так же сняты кадры круга 35.
 *
 * Пластина грузится ЯВНО: без этого кадр рисуется «пустой сценой», и side-iou честно
 * падает (0,47 вместо 0,88). Ошибка тихая, поэтому загрузка обязательна.
 *
 * PNG — RGB без палитры: палитра губит маску (круг 35: side-iou падал с 0,8833 до
 * 0,8139), поэтому кодируем через sharp с compressionLevel 9.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { renderFrame, loadPlate } from './ref.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argOf = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const OUT = resolve(process.cwd(), argOf('out', '../evaluation/round36-bg-3d/frames'));

await loadPlate(resolve(HERE, '../../public/img/bg3d/car-1600.webp'));

const SIZES = [[1440, 900], [1280, 720], [390, 844]];
mkdirSync(OUT, { recursive: true });

const toFile = (file, w, h, data) => sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 3 } })
  .png({ compressionLevel: 9 })
  .toFile(join(OUT, file));

for (const [w, h] of SIZES) {
  const base = { width: w, height: h, variant: 'silhouette', quality: 2, time: 4, scroll: 0, pointer: [0, 0] };
  const withCar = renderFrame(base);
  const noCar = renderFrame({ ...base, car: false });
  await toFile(`car-${w}x${h}.png`, w, h, withCar.data);
  await toFile(`nocar-${w}x${h}.png`, w, h, noCar.data);
  console.log(`ok  ${w}×${h}: car / nocar · ${withCar.ops.scalarPerPx.toFixed(0)} скалярных оп/px`);
}
console.log(`\nкадры: ${OUT}`);
