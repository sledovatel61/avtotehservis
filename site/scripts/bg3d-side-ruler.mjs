#!/usr/bin/env node
/**
 * Единая линейка: наш силуэт против фото — в одних координатах.
 * Задание №60, шаг 1. Это гейт, а не «скрипт для отчёта».
 *
 *   node scripts/bg3d-side-ruler.mjs                        # фото vs CPU-кадр
 *   node scripts/bg3d-side-ruler.mjs --frame f.png --bg b.png
 *   node scripts/bg3d-side-ruler.mjs --json docs/reports/r34-bg-car/ruler.json
 *
 * Почему прежние замеры расходились
 * ---------------------------------
 * Маска по яркости не различает кузов и фон: в нашем кадре кузов (31 L) светлее
 * пола (24 L) и темнее фона (34 L), на фото белый кузов (95–112 L) светлее
 * брусчатки, но темнее здания (120–140). Любой порог ловит половину сцены —
 * отсюда h/L 0,265 и 0,447 на одном и том же силуэте. Здесь маска нашего
 * силуэта — РАЗНИЦА с кадром без машины.
 *
 * Почему фото нельзя мерить в метрах напрямую
 * -------------------------------------------
 * Это не ортогональная проекция: база по фото читается как 62,5 %L (паспорт
 * 60,3), высота — как 35,1 %L (паспорт 33,5), колесо «по внешнему контуру» —
 * 130 px (PROFILE.md §3.1: 0,588 м вместо 0,7375). Все три расхождения
 * одного знака и одной природы — перспектива. Поэтому:
 *   · ФОРМА сравнивается в безразмерных долях: x — доля собственной длины,
 *     y — доля собственной высоты. Масштабная ошибка фото из формы выпадает;
 *   · АБСОЛЮТНЫЕ числа (h/L, клиренс, колесо) берутся у нас из паспорта и
 *     печатаются отдельно, с явной пометкой перспективной поправки фото.
 *
 * Привязка: x — по центрам осей (красные суппорты дают их однозначно),
 * y — по земле под колесами (низ шины, L<70).
 */

import sharp from 'sharp';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const ROOT = resolve(SITE, '..');

const PHOTO = resolve(ROOT, 'docs/brand/voyah/refs/r31/side-white-1456.jpg');

export const SPEC = { length: 4.905, height: 1.645, wheelbase: 2.96, tyre: 0.7375, clearance: 0.18 };
const TARGET = {
  axleFront: ((SPEC.length / 2 - 1.48) / SPEC.length) * 100,
  axleRear: ((SPEC.length / 2 + 1.48) / SPEC.length) * 100,
  wheelDia: (SPEC.tyre / SPEC.length) * 100,
  height: (SPEC.height / SPEC.length) * 100,
  clearance: (SPEC.clearance / SPEC.length) * 100,
};

/* Калибровка фото (снята с самого файла, шаг 1 задания). */
export const PHOTO_CAL = {
  noseX: 93,          // крайняя передняя точка кузова (бампер, самая низкая кромка)
  tailX: 1408,         // крайняя задняя
  groundY: 624,        // низ шин под осями (L прыгает 8 → 90)
  topY: 182,           // верхняя кромка крыши
  frontAxleX: 294,     // центр переднего диска (по красному суппорту)
  rearAxleX: 1080,     // центр заднего диска
};

/**
 * Верхняя кромка кузова, снятая вручную с этого фото (px, нос слева).
 * Те же 74 точки, что в `trace-car-profile.mjs`: сняты по кромке краски, а не
 * автоматикой — на белом кузове рядом светлое здание, автоматика утекает в фон.
 */
const MANUAL_TOP = [
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

/* --------------------------------------------------------------- утилиты */

const pct = (v) => (v === null ? '  —' : String(Math.round(v)).padStart(4));
const rowsOf = (vals) => vals.map(pct).join(' ');

function lin(xs, ys) {
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (let i = 1; i < xs.length; i++) {
      if (x <= xs[i]) {
        const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
        return ys[i - 1] + t * (ys[i] - ys[i - 1]);
      }
    }
    return ys[ys.length - 1];
  };
}

/* ---------------------------------------------------------- фото: профиль */

/**
 * Форма фото, БЕЗ масштаба: X — доля длины (0 = нос), Y — доля собственной
 * высоты (0 = земля, 100 = верх). Так перспективное искажение снимка
 * (длина +4 %, высота +5 %) не выдаёт себя за ошибку формы.
 */
function photoShape() {
  const { noseX, tailX, groundY, topY } = PHOTO_CAL;
  const pts = MANUAL_TOP.map(([x, y]) => ({
    xL: ((x - noseX) / (tailX - noseX)) * 100,
    yH: ((groundY - y) / (groundY - topY)) * 100,
  })).sort((a, b) => a.xL - b.xL);
  const topAt = lin(pts.map((p) => p.xL), pts.map((p) => p.yH));
  return { topAt, pts };
}

/* ------------------------------------------------------- наш силуэт: маска */

async function raw(file) {
  const r = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: r.data, W: r.info.width, H: r.info.height, C: r.info.channels };
}

async function ourMask(carFile, bgFile) {
  const a = await raw(carFile);
  const b = await raw(bgFile);
  if (a.W !== b.W || a.H !== b.H) throw new Error(`кадры разного размера: ${a.W}×${a.H} и ${b.W}×${b.H}`);
  const { W, H } = a;
  const thresh = Number(process.env.DIFF ?? 12);
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const j = i * a.C;
    const d = (Math.abs(a.d[j] - b.d[j]) + Math.abs(a.d[j + 1] - b.d[j + 1]) + Math.abs(a.d[j + 2] - b.d[j + 2])) / 3;
    m[i] = d > thresh ? 1 : 0;
  }

  const rowN = new Array(H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) rowN[y]++;
  const rowMax = Math.max(...rowN);
  const KEEP = 0.025;

  /* верхняя связная группа строк: отражение в полу отделено провалом */
  const groups = [];
  let run = null;
  for (let y = 0; y < H; y++) {
    if (rowN[y] >= Math.max(2, rowMax * KEEP)) {
      if (!run) run = { a: y, b: y, gap: 0 }; else { run.b = y; run.gap = 0; }
    } else if (run) { if (++run.gap >= 6) { groups.push(run); run = null; } }
  }
  if (run) groups.push(run);
  const band = groups.filter((g) => g.b - g.a >= 3)[0] ?? groups[0];
  if (!band) throw new Error('машина не найдена: проверьте DIFF и кадр без машины');

  /* крупные компоненты, чтобы ореолы фар не тянули края */
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
          if (xx < 0 || xx >= W || yy < band.a || yy > band.b) continue;
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
  const colN = new Array(W).fill(0);
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = band.a; y <= band.b; y++) if (keep[y * W + x]) n++;
    colN[x] = n;
  }
  const colMax = Math.max(...colN);
  let x0 = W, x1 = -1;
  for (let x = 0; x < W; x++) if (colN[x] >= Math.max(2, colMax * KEEP)) { if (x < x0) x0 = x; x1 = x; }

  /* заливка по столбцу внутри габарита: стёкла и диски — часть силуэта */
  for (let x = x0; x <= x1; x++) {
    let t = -1, b2 = -1;
    for (let y = band.a; y <= band.b; y++) if (keep[y * W + x]) { if (t < 0) t = y; b2 = y; }
    if (t >= 0) for (let y = t; y <= b2; y++) keep[y * W + x] = 1;
  }

  /* верхняя кромка по столбцу */
  const top = new Array(W).fill(-1), bot = new Array(W).fill(-1);
  /* (ниже — сглаживание при чтении: одиночный столбец на самом краю ловит
     пиксель подсветки и даёт выброс в 10 %H) */
  for (let x = x0; x <= x1; x++) {
    for (let y = band.a; y <= band.b; y++) if (keep[y * W + x]) { top[x] = y; break; }
    for (let y = band.b; y >= band.a; y--) if (keep[y * W + x]) { bot[x] = y; break; }
  }
  return { W, H, x0, x1, top, bot };
}

/* ------------------------------------------------------------------ main */

async function main() {
  const args = process.argv.slice(2);
  const arg = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const frame = arg('--frame');
  const bg = arg('--bg');
  const json = arg('--json');

  const shape = photoShape();
  const out = { spec: SPEC, target: TARGET, photo: PHOTO, cal: PHOTO_CAL, rows: [] };

  /* абсолютные числа фото — с честной пометкой перспективы */
  const photoLen = PHOTO_CAL.tailX - PHOTO_CAL.noseX;
  const photoH = PHOTO_CAL.groundY - PHOTO_CAL.topY;
  const photoBase = PHOTO_CAL.rearAxleX - PHOTO_CAL.frontAxleX;

  console.log('');
  console.log('=== Калибровка фото (side-white-1456.jpg) ===');
  console.log(`  длина ${photoLen} px → ${(photoLen / SPEC.length).toFixed(1)} px/м`);
  console.log(`  база  ${photoBase} px = ${((photoBase / photoLen) * 100).toFixed(1)} %L (паспорт 60,3) → перспектива +${((photoBase / photoLen) / 0.603 * 100 - 100).toFixed(1)} %`);
  console.log(`  высота ${photoH} px = ${((photoH / photoLen) * 100).toFixed(1)} %L (паспорт 33,5) → перспектива +${((photoH / photoLen) / (SPEC.height / SPEC.length) * 100 - 100).toFixed(1)} %`);
  console.log(`  оси фото: передняя ${(((PHOTO_CAL.frontAxleX - PHOTO_CAL.noseX) / photoLen) * 100).toFixed(1)} %L, задняя ${(((PHOTO_CAL.rearAxleX - PHOTO_CAL.noseX) / photoLen) * 100).toFixed(1)} %L`);
  console.log('  ⇒ фото — перспективный снимок: в метрах годится только ФОРМА, не абсолютные высоты.');

  console.log('');
  console.log('=== Форма: верхняя кромка, % собственной высоты (0 = земля, 100 = верх) ===');
  const COLS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const COLS_FINE = [0, 1, 2, 3, 5, 8, 92, 95, 97, 98, 99, 100];
  console.log(`  ${'доля длины'.padEnd(14)} ${COLS.map((v) => String(v).padStart(4)).join(' ')}`);
  const photoVals = COLS.map((p) => shape.topAt(p));
  console.log(`  ${'фото'.padEnd(14)} ${rowsOf(photoVals)}`);

  let ourVals = null;
  if (frame && bg) {
    const mk = await ourMask(frame, bg);
    const L = mk.x1 - mk.x0 + 1;

    /* Ориентация. Фото снято носом ВЛЕВО, кадр сцены — носом ВПРАВО (так задан
       вид в SCENE). Сравнивать «как есть» — значит штрафовать силуэт за поворот.
       Определяем не на глаз: у Voyah передняя часть ниже кормы на всём участке
       крыши к капоту, поэтому у носа кромка падает раньше. Берём средний наклон
       верхней кромки в первой и последней трети силуэта; где обрыв выше — там нос. */
    const meanTop = (a, b) => {
      let s2 = 0, n = 0;
      for (let x = a; x <= b; x++) if (mk.top[x] >= 0) { s2 += mk.top[x]; n++; }
      return n ? s2 / n : 0;
    };
    const thirdL = meanTop(mk.x0, mk.x0 + Math.round(L / 3));
    const thirdR = meanTop(mk.x1 - Math.round(L / 3), mk.x1);
    const noseRight = thirdR > thirdL;   /* у носа верх ниже → больше y */
    const flip = noseRight;
    /* вертикаль — по земле: самый низ силуэта (низ шин) */
    let yBot = -1, yTop = Infinity;
    for (let x = mk.x0; x <= mk.x1; x++) {
      if (mk.top[x] >= 0) { yTop = Math.min(yTop, mk.top[x]); yBot = Math.max(yBot, mk.bot[x]); }
    }
    const Hh = yBot - yTop + 1;
    /* Медиана по окну ±1 %L: один столбец на краю силуэта ловит пиксель
       подсветки и даёт выброс до 10 %H. Окно не сглаживает перегибы (крыша,
       стойка A): они держатся десятками столбцов. */
    const topAtPct = (p, halfWin = Math.max(1, Math.round(L * 0.01))) => {
      const frac = p / 100;
      const xc = flip
        ? Math.max(mk.x0, mk.x1 - Math.round(frac * (L - 1)))
        : Math.min(mk.x1, mk.x0 + Math.round(frac * (L - 1)));
      const vals = [];
      for (let d = -halfWin; d <= halfWin; d++) {
        const x = xc + d;
        if (x < mk.x0 || x > mk.x1) continue;
        if (mk.top[x] >= 0) vals.push((yBot - mk.top[x]) / Hh * 100);
      }
      if (!vals.length) return null;
      vals.sort((a, b) => a - b);
      return vals[vals.length >> 1];
    };
    ourVals = COLS.map((p) => topAtPct(p));
    console.log(`  ориентация: кадр носом ${noseRight ? 'вправо' : 'влево'}, фото носом влево → ${flip ? 'сравниваем с переворотом' : 'как есть'}`);
    console.log(`  ${'мы'.padEnd(14)} ${rowsOf(ourVals)}`);
    console.log(`  ${'разница'.padEnd(14)} ${rowsOf(ourVals.map((v, i) => (v === null ? null : v - photoVals[i])))}`);

    /* мелко по концам: нос и корма — как раз то, что «обрублено» */
    const ourAt = (p) => topAtPct(p);
    const photoFine = COLS_FINE.map((p) => shape.topAt(p));
    const ourFine = COLS_FINE.map((p) => ourAt(p));
    console.log('');
    console.log(`  ${'концы, доля'.padEnd(14)} ${COLS_FINE.map((v) => String(v).padStart(4)).join(' ')}`);
    console.log(`  ${'фото'.padEnd(14)} ${rowsOf(photoFine)}`);
    console.log(`  ${'мы'.padEnd(14)} ${rowsOf(ourFine)}`);
    console.log(`  ${'разница'.padEnd(14)} ${rowsOf(ourFine.map((v, i) => (v === null || photoFine[i] === null ? null : v - photoFine[i])))}`);

    const diffs = ourVals.map((v, i) => (v === null ? null : Math.abs(v - photoVals[i]))).filter((v) => v !== null);
    const worst = Math.max(...diffs);
    console.log('');
    console.log(`  средняя |Δ| ${(diffs.reduce((s, v) => s + v, 0) / diffs.length).toFixed(1)} %H · макс ${worst.toFixed(1)} %H (допуск 2 %L ≈ ${(2 / TARGET.height * 100).toFixed(1)} %H)`);
    console.log(`  h/L по кадру: ${(Hh / L).toFixed(3)} · по модулю: ${TARGET.height.toFixed(3)} (паспорт ${(SPEC.height / SPEC.length).toFixed(3)})`);

    out.frame = frame;
    out.ourShape = ourVals;
    out.hOverL = Hh / L;
  }
  out.photoShape = photoVals;

  console.log('');
  console.log('=== Ориентиры (числа) ===');
  console.log(`  высота кузова   ${TARGET.height.toFixed(1)} %L (${SPEC.height} м) — допуск ±1,0 %L`);
  console.log(`  колесо Ø        ${TARGET.wheelDia.toFixed(1)} %L (${SPEC.tyre} м), одинаковое спереди и сзади`);
  console.log(`  клиренс         ${TARGET.clearance.toFixed(1)} %L (${SPEC.clearance} м)`);
  console.log(`  оси             передняя ${TARGET.axleFront.toFixed(1)} %L, задняя ${TARGET.axleRear.toFixed(1)} %L`);

  if (json) {
    const p = resolve(SITE, json);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(out, null, 1)}\n`);
    console.log(`\njson: ${json}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
