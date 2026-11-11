#!/usr/bin/env node
/**
 * Гейт силуэта: IoU нашего силуэта против золотой маски, снятой с фото
 * (`docs/brand/voyah/refs/r31/side-mask.png`, задание №59, §5.2).
 *
 *   node scripts/bg3d-side-iou.mjs <кадр> [кадр без машины]
 *   npm run measure:side-iou -- /tmp/car/car.png /tmp/car/nocar.png
 *
 * Порог приёмки: IoU ≥ 0,97.
 *
 * Почему маска с BG обязательна
 * -----------------------------
 * Порог по яркости на этой сцене мерит свет, а не машину: кузов (31 L) светлее
 * пола (24 L), но темнее фона (34 L), поэтому «темнее 32» даёт каплю, а «светлее 24»
 * — половину сцены. Единственная маска, не зависящая от палитры, — разница с кадром
 * без машины (`tools/bg3d/ref.mjs`, `renderFrame({car:false})`). Без неё гейт
 * печатает предупреждение и считает по яркости: числа будут про свет.
 *
 * Почему сравнение по нормализованной форме
 * ----------------------------------------
 * Эталон снят при pxPerM = 228,54, наш кадр — при своём масштабе сцены. Абсолютные
 * пиксели сравнивать нельзя, отношение сторон — можно. Поэтому оба силуэта
 * приводятся к одной длине (800 px) с сохранением собственного h/L: если h/L
 * разъедутся, IoU это покажет, а не «спрячет» под масштабированием.
 * Совпадение по вертикали — по нижней кромке (земля общая).
 *
 * Заполнение дыр эталона
 * ----------------------
 * В gold-маске залиты только тёмные пиксели фото, поэтому стёкла и диски в ней
 * — дыры (см. mask-diagnostics ниже: у эталона 6 разрывов по столбцу). Для силуэта
 * это неверно: стекло — часть силуэта. Дыры заливаются по столбцу от верхнего до
 * нижнего белого, а медианный фильтр 3×3 убирает «бахрому» по краям.
 */

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REF = resolve(HERE, '../../docs/brand/voyah/refs/r31/side-mask.png');
const WIDTH = 800;          /* общая длина силуэта для сравнения, px */
const THRESH_REF = 128;     /* белое в gold-маске */
const DIFF = Number(process.env.DIFF ?? 12);   /* порог разницы с кадром без машины */
const KEEP = Number(process.env.KEEP ?? 0.025); /* доля от плотнейшей строки/столбца */
const GAP = Number(process.env.GAP ?? 6);       /* разрыв силуэт/отражение, строк */
const MIN_IOU = Number(process.env.MIN_IOU ?? 0.97);
/* Ориентация. Эталон снят с фото, где машина стоит носом ВЛЕВО, а кадр сцены —
   носом ВПРАВО (так задан вид в SCENE). Сравнивать «как есть» — значит штрафовать
   силуэт за то, что он повёрнут. Поэтому по умолчанию перебираются оба варианта
   и берётся лучший; выбранный печатается, чтобы это не было скрытой подгонкой. */
const MIRROR = process.env.MIRROR ?? 'auto';   /* auto | none | flip */

const carFile = process.argv[2];
const bgFile = process.argv[3] ?? null;
if (!carFile) {
  console.error('нужен кадр: node scripts/bg3d-side-iou.mjs <кадр> [кадр без машины]');
  process.exit(2);
}

/* ------------------------------------------------------------------ маски */

async function raw(file) {
  const r = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: r.data, W: r.info.width, H: r.info.height, C: r.info.channels };
}

/** Эталонная маска: белое → 1, заливка дыр по столбцу, медиана 3×3. */
async function refMask() {
  const r = await raw(REF);
  const { W, H, C, data } = r;
  let m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = data[i * C] > THRESH_REF ? 1 : 0;

  /* Диагностика: сколько разрывов по столбцу было до заливки (дыры = стёкла, диски). */
  let refStat = null;
  let holes = 0;
  for (let x = 0; x < W; x++) {
    let runs = 0, prev = 0;
    for (let y = 0; y < H; y++) {
      const v = m[y * W + x];
      if (v && !prev) runs++;
      if (v) prev = 1; else prev = 0;
    }
    if (runs > 1) holes++;
  }

  for (let x = 0; x < W; x++) {
    let t = -1, b = -1;
    for (let y = 0; y < H; y++) if (m[y * W + x]) { if (t < 0) t = y; b = y; }
    if (t >= 0) for (let y = t; y <= b; y++) m[y * W + x] = 1;
  }
  /* Порог площади компоненты. Заливка «от верхнего белого до нижнего» склеивает
     силуэт с пятнами отражений витрины над капотом и кормой: в золотой маске
     10,1 % белых пикселей — это куски витрины и брусчатки, не машина. Без фильтра
     эталон получается h/L 0,500 вместо 0,340, и любой корректный силуэт против
     него «проваливает» гейт. Фильтр: компонента ≥ 2 % крупнейшей. */
  {
    const seen = new Uint8Array(W * H);
    const comps = [];
    for (let i = 0; i < W * H; i++) {
      if (!m[i] || seen[i]) continue;
      const st = [i]; seen[i] = 1; const cells = [];
      while (st.length) {
        const k = st.pop(); cells.push(k);
        const kx = k % W, ky = (k / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = kx + dx, yy = ky + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const kk = yy * W + xx;
          if (m[kk] && !seen[kk]) { seen[kk] = 1; st.push(kk); }
        }
      }
      comps.push(cells);
    }
    const sizes = comps.map((c) => c.length);
    const biggest = Math.max(...sizes);
    const keep = new Uint8Array(W * H);
    for (let c = 0; c < comps.length; c++) if (sizes[c] >= biggest * 0.02) for (const k of comps[c]) keep[k] = 1;
    m = keep;
    const white = sizes.reduce((a, b) => a + b, 0);
    refStat = { comps: comps.length, kept: comps.filter((c, i) => sizes[i] >= biggest * 0.02).length, white, keptPx: biggest };
  }

  /* медиана 3×3: срезает одиночные «усы» трассировки по краю */
  const o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += m[yy * W + xx]; n++; }
        }
      }
      o[y * W + x] = s * 2 >= n ? 1 : 0;
    }
  }
  return { m: o, W, H, holes, stat: refStat };
}

/** Маска кадра: разница с кадром без машины, затем плотные строки/столбцы. */
async function frameMask() {
  const a = await raw(carFile);
  const { W, H, C, data } = a;
  const m = new Uint8Array(W * H);
  if (bgFile) {
    const b = await raw(bgFile);
    if (b.W !== W || b.H !== H) {
      console.error(`кадр без машины ${b.W}×${b.H} не совпадает с кадром ${W}×${H}`);
      process.exit(2);
    }
    for (let i = 0; i < W * H; i++) {
      const j = i * C;
      const d = (Math.abs(data[j] - b.data[j])
        + Math.abs(data[j + 1] - b.data[j + 1])
        + Math.abs(data[j + 2] - b.data[j + 2])) / 3;
      m[i] = d > DIFF ? 1 : 0;
    }
  } else {
    console.error('ВНИМАНИЕ: кадр без машины не передан — маска по яркости, числа про свет, не про форму.');
    for (let i = 0; i < W * H; i++) m[i] = data[i * C] < 32 ? 1 : 0;
  }

  const rowN = new Array(H).fill(0), colN = new Array(W).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { rowN[y]++; colN[x]++; }
  const rowMax = Math.max(...rowN), colMax = Math.max(...colN);

  let x0 = W, x1 = -1;
  for (let x = 0; x < W; x++) if (colN[x] >= Math.max(2, colMax * KEEP)) { if (x < x0) x0 = x; x1 = x; }

  /* верхняя связная группа строк: отражение в полу — не машина */
  const groups = [];
  let run = null;
  for (let y = 0; y < H; y++) {
    if (rowN[y] >= Math.max(2, rowMax * KEEP)) {
      if (!run) run = { a: y, b: y, gap: 0 }; else { run.b = y; run.gap = 0; }
    } else if (run) {
      if (++run.gap >= GAP) { groups.push(run); run = null; }
    }
  }
  if (run) groups.push(run);
  const solid = groups.filter((g) => g.b - g.a >= 3);
  const g = solid[0] ?? groups[0];
  if (!g) { console.error('машина не найдена: проверьте DIFF и кадр без машины'); process.exit(2); }

  /* внутри габарита оставляем только крупные связные области (ореолы фар — прочь) */
  const keep = new Uint8Array(W * H);
  const seen = new Uint8Array(W * H);
  const stack = [];
  const comps = [];
  for (let y = g.a; y <= g.b; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (!m[i] || seen[i]) continue;
      let n = 0;
      stack.push(i); seen[i] = 1;
      const cells = [];
      while (stack.length) {
        const k = stack.pop(); cells.push(k); n++;
        const kx = k % W, ky = (k / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = kx + dx, yy = ky + dy;
          if (xx < x0 || xx > x1 || yy < g.a || yy > g.b) continue;
          const kk = yy * W + xx;
          if (m[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); }
        }
      }
      comps.push({ n, cells });
    }
  }
  const maxComp = Math.max(...comps.map((c) => c.n));
  for (const c of comps) if (c.n >= maxComp * 0.02) for (const k of c.cells) keep[k] = 1;

  /* заливка по столбцу внутри габарита: стекло и диски — часть силуэта */
  for (let x = x0; x <= x1; x++) {
    let t = -1, b = -1;
    for (let y = g.a; y <= g.b; y++) if (keep[y * W + x]) { if (t < 0) t = y; b = y; }
    if (t >= 0) for (let y = t; y <= b; y++) keep[y * W + x] = 1;
  }
  return { m: keep, W, H, x0, x1, y0: g.a, y1: g.b };
}

/* ------------------------------------------------- нормализация и сравнение */

/** Приводим силуэт к длине WIDTH, сохраняя собственное h/L; низ — на общий край. */
function normalize(mask, W, H, box, flip = false) {
  const L = box.x1 - box.x0 + 1;
  const Hh = box.y1 - box.y0 + 1;
  const s = WIDTH / L;
  const outH = Math.max(1, Math.round(Hh * s));
  const o = new Uint8Array(WIDTH * outH);
  for (let y = 0; y < outH; y++) {
    const sy = box.y0 + Math.min(Hh - 1, Math.floor(y / s));
    for (let x = 0; x < WIDTH; x++) {
      const ix = Math.min(L - 1, Math.floor(x / s));
      const sx = flip ? box.x1 - ix : box.x0 + ix;
      o[y * WIDTH + x] = mask[sy * W + sx];
    }
  }
  return { o, h: outH, hOverL: Hh / L };
}

const ref = await refMask();
const rb = (() => {
  let x0 = ref.W, x1 = -1, y0 = ref.H, y1 = -1;
  for (let y = 0; y < ref.H; y++) for (let x = 0; x < ref.W; x++) if (ref.m[y * ref.W + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, x1, y0, y1 };
})();
const fm = await frameMask();
const R0 = normalize(ref.m, ref.W, ref.H, rb, false);
const O0 = normalize(fm.m, fm.W, fm.H, fm, false);

/** Накладываем два нормализованных силуэта, низ к низу (земля общая). */
function compare(A0, B0) {
  const HH = Math.max(A0.h, B0.h);
  const pad = (n) => {
    const t = new Uint8Array(WIDTH * HH);
    const off = HH - n.h;
    for (let y = 0; y < n.h; y++) for (let x = 0; x < WIDTH; x++) t[(y + off) * WIDTH + x] = n.o[y * WIDTH + x];
    return t;
  };
  const A = pad(A0), B = pad(B0);
  let inter = 0, uni = 0, onlyRef = 0, onlyOurs = 0;
  const colDiffTop = new Array(WIDTH).fill(0);
  for (let x = 0; x < WIDTH; x++) {
    let ta = -1, tb = -1;
    for (let y = 0; y < HH; y++) {
      const a = A[y * WIDTH + x], b = B[y * WIDTH + x];
      if (a) { if (ta < 0) ta = y; }
      if (b) { if (tb < 0) tb = y; }
      if (a && b) inter++;
      if (a || b) uni++;
      if (a && !b) onlyRef++;
      if (b && !a) onlyOurs++;
    }
    colDiffTop[x] = ta >= 0 && tb >= 0 ? Math.abs(ta - tb) / HH : 0;
  }
  const binMiss = new Array(10).fill(0), binTot = new Array(10).fill(0);
  for (let x = 0; x < WIDTH; x++) {
    const b = Math.min(9, Math.floor((x / WIDTH) * 10));
    for (let y = 0; y < HH; y++) {
      const a = A[y * WIDTH + x], o = B[y * WIDTH + x];
      if (a || o) { binTot[b]++; if (a !== o) binMiss[b]++; }
    }
  }
  return {
    iou: uni ? inter / uni : 0, HH, A, B,
    inter, uni, onlyRef, onlyOurs,
    meanTop: colDiffTop.reduce((s, v) => s + v, 0) / WIDTH,
    maxTop: Math.max(...colDiffTop),
    binMiss, binTot,
  };
}

let R = R0, O = O0, mirrored = false, res = compare(R0, O0);
if (MIRROR !== 'none') {
  const Rf = normalize(ref.m, ref.W, ref.H, rb, true);
  const Of = normalize(fm.m, fm.W, fm.H, fm, true);
  const alt = MIRROR === 'flip' ? compare(R0, Of) : compare(Rf, O0);
  if (MIRROR === 'flip' || alt.iou > res.iou) { O = Of; mirrored = true; res = alt; }
  if (MIRROR === 'flip') { R = R0; mirrored = true; }
}

const iou = res.iou;

/* Где расхождение наибольшее — чтобы правка формы была адресной, а не на глаз. */
const binMiss = res.binMiss, binTot = res.binTot;
const A = res.A, B = res.B;   /* наложенные маски (для картинки расхождения) */
const meanTop = res.meanTop, maxTop = res.maxTop;
const { inter, uni, onlyRef, onlyOurs } = res;

const fmt = (v) => v.toFixed(4);
console.log(`кадр:   ${carFile}`);
console.log(`эталон: ${REF}`);
console.log(`маска:  ${bgFile ? `разница с ${bgFile}, порог ${DIFF}` : 'по яркости (числа про свет!)'}`);
console.log('');
console.log(`эталон: h/L ${R.hOverL.toFixed(3)} · ${WIDTH}×${R.h} px · компонент ${ref.stat.comps}, оставлено ${ref.stat.kept}, `
  + `белых ${ref.stat.white} px (отражения витрины отсеяны)`);
console.log(`наш:    h/L ${O.hOverL.toFixed(3)} · ${WIDTH}×${O.h} px`);
console.log('');
console.log(`ориентация: ${mirrored ? 'перевёрнут (эталон носом влево, кадр носом вправо)' : 'как есть'}`);
console.log(`IoU силуэта: ${fmt(iou)}  (порог ≥ ${MIN_IOU}; inter ${inter}, union ${uni}, только эталон ${onlyRef}, только наш ${onlyOurs})`);
console.log(`верхняя кромка: среднее |Δy| ${(meanTop * 100).toFixed(1)} %H · макс ${(maxTop * 100).toFixed(1)} %H`);
console.log('');
if (process.env.PROFILE) {
  console.log('верхняя кромка, %H от земли, по долям длины (0 = левый край = нос у эталона):');
  const line = (n, A2) => {
    const out = [];
    for (let i = 0; i <= 10; i++) {
      const x = Math.min(WIDTH - 1, Math.round((i / 10) * (WIDTH - 1)));
      let t = -1, b = -1;
      for (let y = 0; y < res.HH; y++) if (A2[y * WIDTH + x]) { if (t < 0) t = y; b = y; }
      out.push(t < 0 ? '  —' : String(Math.round((100 * (b - t)) / n.h)).padStart(3));
    }
    return out.join(' ');
  };
  console.log(`  эталон: ${line(R, res.A)}`);
  console.log(`  наш:    ${line(O, res.B)}`);
  console.log('');
}
console.log('расхождение по долям длины (от носа, 0 = нос):');
let worst = -1, worstB = -1;
for (let b = 0; b < 10; b++) {
  const p = binTot[b] ? (100 * binMiss[b]) / binTot[b] : 0;
  if (p > worst) { worst = p; worstB = b; }
  console.log(`  ${(b / 10).toFixed(1)}…${((b + 1) / 10).toFixed(1)}  не совпало ${p.toFixed(1)} %`);
}
console.log('');
console.log(`худший участок: ${(worstB / 10).toFixed(1)}…${((worstB + 1) / 10).toFixed(1)} длины, ${worst.toFixed(1)} % разницы`);
/* Картинка расхождения: жёлтый — совпало, красный — есть у эталона и нет у нас,
   зелёный — есть у нас и нет у эталона. Без неё «правь профиль» — гадание. */
if (process.env.OVERLAY) {
  const px = new Uint8Array(WIDTH * res.HH * 3);
  for (let y = 0; y < res.HH; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const a = A[y * WIDTH + x], b = B[y * WIDTH + x];
      const i = (y * WIDTH + x) * 3;
      if (a && b) { px[i] = 226; px[i + 1] = 210; px[i + 2] = 70; }       /* совпало */
      else if (a) { px[i] = 220; px[i + 1] = 40; px[i + 2] = 40; }         /* только эталон */
      else if (b) { px[i] = 50; px[i + 1] = 200; px[i + 2] = 60; }         /* только наш */
      else { px[i] = 14; px[i + 1] = 14; px[i + 2] = 18; }
    }
  }
  await sharp(Buffer.from(px), { raw: { width: WIDTH, height: res.HH, channels: 3 } })
    .png().toFile(process.env.OVERLAY);
  console.log(`картинка расхождения: ${process.env.OVERLAY}`);
}

console.log(`ИТОГ: ${iou >= MIN_IOU ? 'PASS' : 'FAIL'}  (IoU ${fmt(iou)} против порога ${MIN_IOU})`);
process.exit(iou >= MIN_IOU ? 0 : 1);
