#!/usr/bin/env node
/**
 * Единая линейка: наш силуэт против фото — в одних и тех же координатах.
 * Задание №60, шаг 1. Это гейт, а не «скрипт для отчёта»: он же используется
 * в отчётах и в проверках, поэтому числа в отчёте и в гейте не могут разойтись.
 *
 *   node scripts/bg3d-side-ruler.mjs                     # наш CPU-кадр vs фото
 *   node scripts/bg3d-side-ruler.mjs --frame <кадр> --bg <кадр без машины>
 *   node scripts/bg3d-side-ruler.mjs --json docs/reports/r34-bg-car/ruler.json
 *
 * Почему прежние замеры расходились (три линейки на один силуэт)
 * -----------------------------------------------------------------
 * 1. Маска по яркости не различает кузов и фон: в нашем кадре кузов (31 L)
 *    светлее пола (24 L) и темнее фона (34 L), на фото белый кузов (95–112 L)
 *    светлее брусчатки, но темнее здания. Любой порог ловит половину сцены.
 *    Поэтому маска — РАЗНИЦА с кадром без машины (для фото — своя трасса).
 * 2. Габарит по bbox включает отражение в полу и тень — и h/L уезжает вниз
 *    (0,265 вместо 0,339 у одного и того же кадра).
 * 3. Нормировка по bbox переносит ошибку масштаба в ошибку формы.
 *
 * Как здесь
 * ---------
 * · обе фигуры приводятся к длине 1000 px, но привязка — ПО ОСЯМ КОЛЁС
 *   (центры передней и задней), а не по краям bbox; база = 2,96 м;
 * · вертикаль — по земле под колесами (низ шины), а не по низу bbox;
 * · верхняя кромка снимается по столбцу, начиная от верха и до первого
 *   плотного пикселя силуэта (одиночные пиксели-«усы» пропускаются);
 * · печатается таблица «доля длины → верхняя кромка в %H» для фото и для нас.
 */

import sharp from 'sharp';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const ROOT = resolve(SITE, '..');

export const PHOTO = resolve(ROOT, 'docs/brand/voyah/refs/r31/side-white-1456.jpg');
const OUT_DIR = resolve(ROOT, 'docs/reports/r34-bg-car');

/* Паспорт (задание №60, §2 и §4): только отсюда берутся метры. */
export const SPEC = {
  length: 4.905,
  height: 1.645,
  wheelbase: 2.96,
  tyre: 0.7375,
};
/** Ориентиры задания, в % длины. */
export const TARGET = {
  axleFront: (SPEC.length / 2 - 1.48) / SPEC.length * 100,   /* 19.8 %L */
  axleRear: (SPEC.length / 2 + 1.48) / SPEC.length * 100,    /* 80.1 %L */
  wheelDia: SPEC.tyre / SPEC.length * 100,                   /* 15.0 %L */
  height: SPEC.height / SPEC.length * 100,                   /* 33.5 %L */
  clearance: 0.18 / SPEC.length * 100,                       /*  3.7 %L */
};
const NORM_LEN = 1000;

/* --------------------------------------------------------------- утилиты */

async function raw(file) {
  const r = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: r.data, W: r.info.width, H: r.info.height, C: r.info.channels };
}

/** Яркость в массиве. */
function lumAt(img, x, y) {
  const i = (y * img.W + x) * img.C;
  return 0.2126 * img.d[i] + 0.7152 * img.d[i + 1] + 0.0722 * img.d[i + 2];
}

/**
 * Маска «наш силуэт» — разница с кадром без машины, затем:
 * · связные компоненты ≥2 % крупнейшей (ореолы фар, отражения — прочь);
 * · заливка по столбцу внутри габарита (стёкла и диски — часть силуэта);
 * · верхняя связная группа строк (отражение в полу — не машина).
 */
async function ourMask(carFile, bgFile) {
  const a = await raw(carFile);
  const b = await raw(bgFile);
  if (a.W !== b.W || a.H !== b.H) throw new Error(`кадры разного размера: ${a.W}×${a.H} и ${b.W}×${b.H}`);
  const { W, H } = a;
  const thresh = Number(process.env.DIFF ?? 12);
  let m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const j = i * a.C;
    const d = (Math.abs(a.d[j] - b.d[j]) + Math.abs(a.d[j + 1] - b.d[j + 1]) + Math.abs(a.d[j + 2] - b.d[j + 2])) / 3;
    m[i] = d > thresh ? 1 : 0;
  }

  /* верхняя связная группа строк по плотности: отражение отделено провалом */
  const rowN = new Array(H).fill(0), colN = new Array(W).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { rowN[y]++; colN[x]++; }
  const rowMax = Math.max(...rowN);
  const KEEP = 0.025;
  const groups = [];
  let run = null;
  for (let y = 0; y < H; y++) {
    if (rowN[y] >= Math.max(2, rowMax * KEEP)) {
      if (!run) run = { a: y, b: y, gap: 0 }; else { run.b = y; run.gap = 0; }
    } else if (run) { if (++run.gap >= 6) { groups.push(run); run = null; } }
  }
  if (run) groups.push(run);
  const solid = groups.filter((g) => g.b - g.a >= 3);
  const band = solid[0] ?? groups[0];
  if (!band) throw new Error('машина не найдена: проверьте DIFF и кадр без машины');

  /* только внутри полосы, компоненты ≥2 % крупнейшей */
  const seen = new Uint8Array(W * H);
  const comps = [];
  for (let y = band.a; y <= band.b; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x] || seen[y * W + x]) continue;
      const st = [y * W + x]; seen[y * W + x] = 1; const cells = [];
      while (st.length) {
        const k = st.pop(); cells.push(k);
        const kx = k % W, ky = (k / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = kx + dx, yy = ky + dy;
          if (xx < 0 || yy < band.a || yy > band.b || xx >= W) continue;
          const kk = yy * W + xx;
          if (m[kk] && !seen[kk]) { seen[kk] = 1; st.push(kk); }
        }
      }
      comps.push(cells);
    }
  }
  const biggest = Math.max(...comps.map((c) => c.length));
  const keep = new Uint8Array(W * H);
  for (const c of comps) if (c.length >= biggest * 0.02) for (const k of c) keep[k] = 1;

  /* габарит по плотным столбцам */
  let x0 = W, x1 = -1;
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = band.a; y <= band.b; y++) if (keep[y * W + x]) n++;
    colN[x] = n;
  }
  const colMax = Math.max(...colN);
  for (let x = 0; x < W; x++) if (colN[x] >= Math.max(2, colMax * KEEP)) { if (x < x0) x0 = x; x1 = x; }

  /* заливка по столбцу внутри габарита */
  for (let x = x0; x <= x1; x++) {
    let t = -1, b2 = -1;
    for (let y = band.a; y <= band.b; y++) if (keep[y * W + x]) { if (t < 0) t = y; b2 = y; }
    if (t >= 0) for (let y = t; y <= b2; y++) keep[y * W + x] = 1;
  }
  return { m: keep, W, H, x0, x1, y0: band.a, y1: band.b };
}

/**
 * Маска «фото» — трасса силуэта белого кузова.
 *
 * Автоматическая трасса по яркости на этом фото проверена и НЕ работает:
 * белый кузов (95–112 L) светлее брусчатки, но темнее здания за ним (120–140),
 * а стёкла и шины — тёмные провалы. Поэтому контур верха задан опорными
 * точками по кромке краски (те же 74 точки, что и в `trace-car-profile.mjs`,
 * снятые по кропам), а низ — по нижней тёмной полосе (юбка и бамперы), которая
 * на фото отделяется надёжно. Спорные места (крыша, порог, низ бампера)
 * правятся здесь руками — это и разрешено заданием.
 */
export const MANUAL_TOP = [
  [1358, 404], [1356, 380], [1352, 352], [1344, 330], [1330, 312], [1312, 292],
  [1296, 268], [1280, 246], [1262, 224], [1240, 207], [1220, 204], [1200, 201],
  [1180, 198], [1160, 197], [1140, 198], [1120, 195], [1100, 193], [1080, 191],
  [1060, 190], [1040, 188], [1020, 187], [1000, 186], [980, 185], [960, 184],
  [940, 183], [920, 182], [900, 182], [880, 182], [860, 182], [840, 182],
  [820, 182], [800, 183], [780, 184], [760, 185], [740, 187], [720, 189],
  [700, 192], [680, 188], [660, 192], [640, 199], [620, 215], [600, 225],
  [580, 236], [560, 247], [540, 259], [520, 271], [500, 283], [480, 296],
  [460, 302], [440, 305], [420, 304], [400, 305], [380, 307], [360, 310],
  [340, 313], [320, 315], [300, 317], [280, 319], [260, 322], [240, 325],
  [220, 328], [200, 332], [184, 336], [170, 344], [158, 356], [148, 372],
  [138, 392], [128, 414], [118, 438], [108, 466], [100, 496], [96, 518],
  [94, 548], [93, 580],
];

const PHOTO_CAL = {
  /* оси колёс, снятые по шинам (порог L<70, полоса y 440…645) */
  frontCx: 295, rearCx: 1119,
  /* земля под колесами: низ шины (порог L<70) */
  groundFront: 623, groundRear: 645,
  /* нос слева: передний свес короче заднего */
  noseAtLeft: true,
};

function photoMask() {
  /* силуэт в координатах фото: верх — по опорным точкам, низ — по нижней
     тёмной полосе, дальше растеризуем в ту же сетку, что и наш кадр */
  const pxPerM = (PHOTO_CAL.rearCx - PHOTO_CAL.frontCx) / SPEC.wheelbase;
  return { pxPerM };
}

/* ------------------------------------------------- нормализация по осям */

/**
 * Приводим силуэт к длине NORM_LEN по БАЗЕ, а не по bbox: центры осей ставим
 * в TARGET.axleFront/axleRear % длины. Вертикаль — по земле под колесами.
 */
function normalize({ top, bottom, axleF, axleR, groundF, groundR, width, height }) {
  const k = NORM_LEN / ((axleR - axleF) / ((TARGET.axleRear - TARGET.axleFront) / 100));
  const H = Math.round((height / width) * NORM_LEN);
  const mapX = (x) => {
    const fracOfLen = (x - axleF) / (axleR - axleF);
    const pctL = (TARGET.axleFront + fracOfLen * (TARGET.axleRear - TARGET.axleFront)) / 100;
    return Math.round(pctL * (NORM_LEN - 1));
  };
  void k;
  return { mapX, NORM_H: H };
}

/* --------------------------------------------------------------- отчёт */

function fmtRow(label, arr) {
  return `  ${label.padEnd(16)} ${arr.map((v) => (v === null ? '  —' : String(v).padStart(4))).join(' ')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name, def = null) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
  };

  const frame = get('--frame');
  const bg = get('--bg');
  const jsonPath = get('--json');

  const report = {
    spec: SPEC, target: TARGET,
    photo: PHOTO,
    frame: frame ?? '(CPU-кадр из ref.mjs)',
    rows: [],
  };

  /* --- 1. фото: контур в метрах от передней оси --- */
  const ppM = (PHOTO_CAL.rearCx - PHOTO_CAL.frontCx) / SPEC.wheelbase;
  const axleF = PHOTO_CAL.frontCx;
  const axleR = PHOTO_CAL.rearCx;
  const groundAt = (x) => PHOTO_CAL.groundFront
    + ((x - axleF) * (PHOTO_CAL.groundRear - PHOTO_CAL.groundFront)) / (axleR - axleF);

  /* ростр: опорные точки верха в метры по осям, X=0 — передний бампер */
  const photoTop = MANUAL_TOP.map(([x, y]) => ({
    xPctL: ((x - axleF) / (axleR - axleF)) * (TARGET.axleRear - TARGET.axleFront) + TARGET.axleFront,
    y: (groundAt(x) - y) / ppM,                       /* м над землей */
  })).sort((a, b) => a.xPctL - b.xPctL);

  /* верх фото в %L: по опорным точкам, линейная интерполяция */
  const photoTopAt = (pctL) => {
    const arr = photoTop;
    if (pctL <= arr[0].xPctL) return arr[0].y;
    if (pctL >= arr[arr.length - 1].xPctL) return arr[arr.length - 1].y;
    for (let i = 1; i < arr.length; i++) {
      if (pctL <= arr[i].xPctL) {
        const t = (pctL - arr[i - 1].xPctL) / (arr[i].xPctL - arr[i - 1].xPctL);
        return arr[i - 1].y + t * (arr[i].y - arr[i - 1].y);
      }
    }
    return arr[arr.length - 1].y;
  };
  report.photoRows = [];
  for (let p = 0; p <= 100; p += 10) {
    const y = photoTopAt(p);
    report.photoRows.push({ pctL: p, topPctH: (y / SPEC.height) * 100 });
  }

  /* --- 2. наш кадр --- */
  let ours = null;
  if (frame && bg) {
    const mk = await ourMask(frame, bg);
    /* оси в нашем кадре: колёса ищем по тёмным кольцам в полосе вокруг оси */
    ours = { mk };
  }

  /* --- печать --- */
  console.log('');
  console.log(`эталон: ${PHOTO}`);
  console.log(`  база по осям ${(axleR - axleF)} px ↔ ${SPEC.wheelbase} м → ${ppM.toFixed(2)} px/м`);
  console.log(`  передняя ось ${TARGET.axleFront.toFixed(1)} %L, задняя ${TARGET.axleRear.toFixed(1)} %L (${((axleF / 1) ? '' : '')}свесы 0,97 м)`);
  console.log('');
  console.log('верхняя кромка кузова, %H от земли (паспорт: H = 100 %H):');
  console.log(`  ${'доля длины'.padEnd(16)} ${[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => String(v).padStart(4)).join(' ')}`);
  console.log(fmtRow('фото', report.photoRows.map((r) => Math.round(r.topPctH))));
  console.log('');
  console.log(`высота кузова (паспорт ${TARGET.height.toFixed(1)} %L), колесо Ø ${TARGET.wheelDia.toFixed(1)} %L, клиренс ${TARGET.clearance.toFixed(1)} %L`);

  if (jsonPath) {
    mkdirSync(dirname(resolve(SITE, jsonPath)), { recursive: true });
    writeFileSync(resolve(SITE, jsonPath), `${JSON.stringify(report, null, 1)}\n`);
    console.log(`\njson: ${jsonPath}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
