#!/usr/bin/env node
/**
 * Тон кадра 3D-фона на НОВОМ разрешении (круг 36, задание №63).
 *
 *   node scripts/bg3d-tone.mjs [--json путь]
 *
 * Мерит то, что требует приёмка: кузов, его σ, пол под машиной, контраст и среднюю
 * кадра — на разрешениях, на которых фон реально работает после круга 36 (1:1 при
 * dpr ≤ 2): 1425×767 и 375×565 при dpr 1, 2850×1534 и 750×1130 при dpr 2.
 *
 * Считается по CPU-порту tools/bg3d/ref.mjs — той же математике, что в шейдере, —
 * поэтому числа сравнимы с приёмкой круга 35 (кузов 28,0 L, пол 16,8, контраст 11,2 L,
 * средняя кадра 24,50): там мерили так же, а не по скриншоту, потому что поверх
 * канваса лежит градиент .v-hero::after и скриншот темнее сцены.
 *
 * Шкала: Y′ = 0,2126R + 0,7152G + 0,0722B в диапазоне 0…255 (как в r34/r35).
 * Маска машины — разница кадра с машиной и без неё (как в side-iou): иначе «кузов»
 * ловит тень, прожекторы и дизеринг.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const A = process.argv.slice(2);
const JSON_OUT = (() => { const i = A.indexOf('--json'); return i >= 0 ? A[i + 1] : null; })();

const ref = await import(join(SITE, 'tools/bg3d/ref.mjs'));
await ref.loadPlate(join(SITE, 'public/img/bg3d/car-1600.webp'));
const placeMod = await import(join(SITE, 'src/client/bg3d/plate.ts'));

const PLATE = await sharp(join(SITE, 'public/img/bg3d/car-800.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const pmask = new Uint8Array(PLATE.info.width * PLATE.info.height);
for (let i = 0; i < pmask.length; i++) if (PLATE.data[i * 4 + 3] >= 128) pmask[i] = 1;

const Y = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const SIZES = [
  { id: '1440-dpr1', w: 1425, h: 767 },
  { id: '1440-dpr2', w: 2850, h: 1534 },
  { id: '390-dpr1', w: 375, h: 565 },
  { id: '390-dpr2', w: 750, h: 1130 },
];

const rows = [];
for (const s of SIZES) {
  const withCar = ref.renderFrame({ width: s.w, height: s.h, variant: 'silhouette', quality: 2, time: 4, scroll: 0, pointer: [0, 0] });
  const noCar = ref.renderFrame({ width: s.w, height: s.h, variant: 'silhouette', quality: 2, time: 4, scroll: 0, pointer: [0, 0], car: false });
  const W = s.w, H = s.h;
  const L = new Float32Array(W * H);
  let rgbSum = 0;
  for (let i = 0; i < W * H; i++) {
    L[i] = Y(withCar.data[i * 3], withCar.data[i * 3 + 1], withCar.data[i * 3 + 2]);
    rgbSum += (withCar.data[i * 3] + withCar.data[i * 3 + 1] + withCar.data[i * 3 + 2]) / 3;
  }
  /* маска машины и её габарит */
  const car = new Uint8Array(W * H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
  for (let i = 0; i < W * H; i++) {
    const d = Math.abs(withCar.data[i * 3] - noCar.data[i * 3])
      + Math.abs(withCar.data[i * 3 + 1] - noCar.data[i * 3 + 1])
      + Math.abs(withCar.data[i * 3 + 2] - noCar.data[i * 3 + 2]);
    if (d > 24) {
      car[i] = 1; n++;
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  /* Линия земли — из пластины (PLATE_GROUND_FRAC): ниже неё отражение в асфальте,
     и если его включить, «кузов» меряет отражение, а не машину (та самая ошибка,
     из-за которой в круге 33 высота машины удваивалась). */
  const place = placeMod.platePlacement(W / H, [0, 0], 0, 0.10);
  const hyHalf = placeMod.PLATE_HALF_LEN * place.sc / placeMod.PLATE_ASPECT;
  const quadBottom = place.cy - hyHalf, quadTop = place.cy + hyHalf;
  const groundP = quadBottom + (1 - placeMod.PLATE_GROUND_FRAC) * (quadTop - quadBottom);
  const groundY = Math.round((1 - groundP) / 2 * H);
  const midY = y0 + (y1 - y0) * 0.5;

  const body = [], lower = [];
  for (let y = y0; y <= Math.min(y1, groundY - 1); y++) {
    for (let x = x0; x <= x1; x++) {
      if (!car[y * W + x]) continue;
      body.push(L[y * W + x]);
      if (y >= midY) lower.push(L[y * W + x]);
    }
  }
  /* Пол — полоса под линией земли вне силуэта; если её нет (силуэт у нижней кромки) —
     слева и справа от силуэта на высоте нижней трети. */
  const floor = [];
  for (let y = Math.min(H - 1, groundY + 2); y < Math.min(H, groundY + 16); y++) for (let x = x0; x <= x1; x++) if (!car[y * W + x]) floor.push(L[y * W + x]);
  if (floor.length < 40) {
    for (let y = Math.round(y0 + (y1 - y0) * 0.72); y <= groundY; y++) {
      for (let x = 0; x < x0; x++) floor.push(L[y * W + x]);
      for (let x = x1 + 1; x < W; x++) floor.push(L[y * W + x]);
    }
  }
  const mean = (a) => a.reduce((v, u) => v + u, 0) / Math.max(a.length, 1);
  const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
  const bodyM = mean(body), lowM = mean(lower), floorM = mean(floor);
  const row = {
    id: s.id, canvas: [W, H],
    bodyL: +bodyM.toFixed(1), bodySigmaL: +sd(body).toFixed(1), bodyPx: body.length,
    bodyLowerL: +lowM.toFixed(1), floorL: +floorM.toFixed(1),
    contrastL: +(bodyM - floorM).toFixed(1), lowerContrastL: +(lowM - floorM).toFixed(1),
    frameMeanRgb: +(rgbSum / (W * H)).toFixed(2), frameMeanL: +mean(Array.from(L)).toFixed(2),
    bodyBox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], carPx: n,
  };
  rows.push(row);
  console.log(`${row.id.padEnd(10)} габарит ${row.bodyBox.join('×')} · кузов ${row.bodyL} L (σ ${row.bodySigmaL}; низ ${row.bodyLowerL} L) · пол ${row.floorL} L · контраст ${row.contrastL} L (по низу ${row.lowerContrastL} L) · средняя кадра ${row.frameMeanRgb} RGB / ${row.frameMeanL} L`);
}

const pass = {
  contrast: rows.every((r) => r.lowerContrastL >= 8.1),
  sigma: rows.every((r) => r.bodySigmaL >= 12),
  mean: rows.every((r) => r.frameMeanRgb >= 24.3),
};
console.log(`\nпорог приёмки: контраст ≥ 8,1 L — ${pass.contrast ? 'ok' : 'НЕТ'}; σ ≥ 12 L — ${pass.sigma ? 'ok' : 'НЕТ'}; средняя кадра ≥ 24,3 — ${pass.mean ? 'ok' : 'НЕТ'}`);
console.log('Средняя кадра здесь — по КАНВАСУ (сцена). Поверх него на странице лежит градиент');
console.log('.v-hero::after, поэтому средняя первого экрана меряется отдельно —');
console.log('scripts/bg3d-live-shot.mjs, поле screenMeanL.');

if (JSON_OUT) {
  mkdirSync(dirname(resolve(JSON_OUT)), { recursive: true });
  writeFileSync(resolve(JSON_OUT), JSON.stringify({
    generatedAt: new Date().toISOString(),
    thresholds: { contrastL: 8.1, sigmaL: 12, meanRgb: 24.3 },
    pass, rows,
  }, null, 2));
  console.log(`\nчисла: ${resolve(JSON_OUT)}`);
}
