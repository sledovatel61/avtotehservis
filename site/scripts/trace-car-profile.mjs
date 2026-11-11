#!/usr/bin/env node
/**
 * Калибровка профиля Voyah Free по фото и пересчёт контура в метры (задание №54).
 *
 * Что делает:
 *   1. находит оси колёс и землю — по ним масштаб (паспортная база 2,96 м);
 *   2. берёт контур верха кузова из РУЧНЫХ опорных точек (MANUAL_TOP);
 *   3. переводит контур в метры: высота нормируется на паспортные 1,645 м,
 *      длина — на 4,905 м (пропорции из паспорта, форма из фото);
 *   4. раскладывает контур в кубические Эрмиты с АДАПТИВНЫМ шагом и пишет
 *      готовый массив `TOP_SEGMENTS` прямо в `src/client/car-profile.ts`:
 *      в ESSL 1.00 массивов нет, поэтому в шейдере лесенка `if`, и число
 *      сегментов — это прямой счёт в бюджет `оп/px`;
 *   5. пишет `profile-ref.json` (калибровка, контур, сегменты, погрешность)
 *      и `trace.jpg` / `trace-grid.jpg` — контур поверх фото.
 *
 * Почему точки ручные. Автоматическая трассировка силуэта на этом фото
 * проверена во всех видах и не работает: белая краска по яркости совпадает
 * с брусчаткой и светлыми стенами, стёкла — тёмные провалы, над крышей идут
 * деревья. Пороги по L×S, заливка по кузову, сканирование снизу вверх,
 * bodySpan, DP по краю, трекинг кромки — всё либо утекало в фон, либо давало
 * провалы на стёклах. Работает ручная разметка по кропам: 74 точки,
 * положение ±2 px = ±7 мм.
 *
 * Запуск: node site/scripts/trace-car-profile.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..');
const ROOT = join(SITE, '..');
const SRC = join(ROOT, 'docs/brand/voyah/refs/r31/side-white-1456.jpg');
const OUT = join(ROOT, 'docs/reports/r31-car-profile');

/** Паспорт (задание №54 §3.1). Метры — только отсюда; из фото — форма. */
export const SPEC = { length: 4.905, width: 1.95, height: 1.645, wheelbase: 2.96, tyre: 0.7375 };

/**
 * Верхняя кромка кузова, снятая вручную с `side-white-1456.jpg` (px, нос слева).
 * Порядок — от кормы к носу. Снято по кромке краски: верхняя линия багажника,
 * спойлер, крыша, лобовое, капот, фара, кромка бампера.
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

/* ---------- пиксели ---------- */
const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const CH = info.channels;
const L = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) {
  L[i] = 0.2126 * data[i * CH] + 0.7152 * data[i * CH + 1] + 0.0722 * data[i * CH + 2];
}
const isDark = (x, y) => L[y * W + x] < 70;

/* ---------- 1. оси колёс ---------- */
const BAND_Y0 = 440;
const BAND_Y1 = 645;
const cnt = new Int32Array(W);
for (let x = 0; x < W; x++) {
  let c = 0;
  for (let y = BAND_Y0; y <= BAND_Y1; y++) if (isDark(x, y)) c++;
  cnt[x] = c;
}
const runs = [];
let st = -1;
for (let x = 0; x < W; x++) {
  const on = cnt[x] > 150;
  if (on && st < 0) st = x;
  if ((!on || x === W - 1) && st >= 0) { runs.push([st, on ? x : x - 1]); st = -1; }
}
const wheels = runs.filter(([a, b]) => b - a > 80).map(([a, b]) => {
  const cx = Math.round((a + b) / 2);
  let top = -1;
  for (let y = BAND_Y0; y <= BAND_Y1; y++) if (isDark(cx, y)) { top = y; break; }
  return { x0: a, x1: b, cx, top, width: b - a };
});
if (wheels.length !== 2) throw new Error(`Ожидались 2 колеса, найдено ${wheels.length}`);
const [leftWheel, rightWheel] = wheels.sort((a, b) => a.cx - b.cx);

/* Уточнение осей по красным суппортам.
   Полосы тёмного по столбцам (порог L<70) дают центры 295 и 1119: они включают
   юбку и арку, и база выходит 824 px вместо настоящих 786 — то есть масштаб
   занижался на 4,8 %, а на корме это 20 %H ошибки формы (круг 33, задание №60).
   Красный суппорт есть только у диска, поэтому его центроид — надёжная метка
   оси: 294 и 1080 px, база 786 px = 265,5 px/м (паспорт 2,96 м).
   Если суппортов не два (другой кадр, ч/б), остаются старые центры полос. */
{
  const isRed = (x, y) => {
    const i = (y * W + x) * CH;
    const R = data[i], G = data[i + 1], B = data[i + 2];
    return R > 90 && R - G > 45 && R - B > 45;
  };
  const reds = [];
  for (let y = 400; y < 700; y++) for (let x = 0; x < W; x++) if (isRed(x, y)) reds.push(x);
  if (reds.length > 200) {
    const sorted = reds.sort((a, b) => a - b);
    const cluster = [];
    let start = sorted[0];
    for (let i = 0; i < sorted.length; i++) {
      if (i === sorted.length - 1 || sorted[i + 1] - sorted[i] > 40) {
        cluster.push([start, sorted[i]]);
        start = sorted[i + 1];
      }
    }
    if (cluster.length === 2) {
      const cx = cluster.map(([a, b]) => Math.round((a + b) / 2)).sort((p, q) => p - q);
      leftWheel.cx = cx[0];
      rightWheel.cx = cx[1];
      /* пересчитать полосу тёмного вокруг новой оси, чтобы земля читалась там же */
      for (const wheel of [leftWheel, rightWheel]) {
        let a = wheel.cx, b = wheel.cx;
        while (a > 0 && isDark(a, wheel.top + 40)) a--;
        while (b < W - 1 && isDark(b, wheel.top + 40)) b++;
        wheel.x0 = a; wheel.x1 = b; wheel.width = b - a;
      }
      console.log(`оси уточнены по суппортам: ${cx[0]} и ${cx[1]} px (полоса давала ${wheels[0].cx} и ${wheels[1].cx})`);
    }
  }
}

/* края кузова — по тёмному низу (бамперы и юбка): светлая краска по яркости
   не отличается от брусчатки, а низ — отличается */
const lowerBand = (x) => {
  let c = 0;
  for (let y = 460; y <= 640; y++) if (isDark(x, y)) c++;
  return c;
};
let bodyX0 = -1;
let bodyX1 = -1;
for (let x = 0; x < W; x++) if (lowerBand(x) > 40) { bodyX0 = x; break; }
for (let x = W - 1; x >= 0; x--) if (lowerBand(x) > 40) { bodyX1 = x; break; }

/* нос — тот, где свес короче: у Free передний свес короче заднего */
const noseAtLeft = leftWheel.cx - bodyX0 < bodyX1 - rightWheel.cx;
const front = noseAtLeft ? leftWheel : rightWheel;
const rear = noseAtLeft ? rightWheel : leftWheel;

/* ---------- 2. земля: под шиной начинается асфальт ---------- */
/**
 * Шина почти чёрная (L < 30), асфальт под ней 60–90. Идём от середины колеса
 * вниз до первого «долго светлого» пикселя: это касание шины.
 */
const groundUnder = (wheel) => {
  const cx = Math.round(wheel.cx);
  const start = Math.round(wheel.top + wheel.width * 0.5);
  for (let y = start; y < H - 10; y++) {
    let lit = 0;
    for (let k = 0; k < 8; k++) if (L[(y + k) * W + cx] > 56) lit++;
    if (lit >= 8) return y;
  }
  throw new Error(`Не найдена земля под x=${wheel.cx}`);
};
const groundFront = groundUnder(front);
const groundRear = groundUnder(rear);

/* Масштаб — от паспортной базы; расстояние по модулю (кадр может быть
   зеркальным), направление «к носу» — отдельным флагом. */
const mmPerPx = (SPEC.wheelbase / Math.abs(front.cx - rear.cx)) * 1000;
const mPerPx = mmPerPx / 1000;
const dirToNose = noseAtLeft ? -1 : 1;
const midPx = (front.cx + rear.cx) / 2;
/** Y земли под произвольным X кадра: линия земли наклонена (снято по осям). */
const groundAtPx = (xPix) =>
  groundRear + ((xPix - rear.cx) * (groundFront - groundRear)) / (front.cx - rear.cx);

/* ---------- 3. контур: px → метры ---------- */
const px = MANUAL_TOP.map(([x]) => x);
const py = MANUAL_TOP.map(([, y]) => y);
const rawHeightM = Math.max(...px.map((x, i) => (groundAtPx(x) - py[i]) * mPerPx));
const ky = SPEC.height / rawHeightM;

const contour = MANUAL_TOP.map(([x, y]) => {
  const X = -(x - midPx) * mPerPx;         // +X к носу: в кадре нос слева
  const Y = (groundAtPx(x) - y) * mPerPx * ky;
  return { x: +X.toFixed(4), y: +Y.toFixed(4) };
}).sort((a, b) => a.x - b.x);

const rawLengthM = contour[contour.length - 1].x - contour[0].x;
const kx = SPEC.length / rawLengthM;
for (const p of contour) p.x = +(p.x * kx).toFixed(4);
/* Центровка: в модуле машина по центру габарита (−2,4525…+2,4525), а на фото
   центр осей не совпадает с центром кузова — задний свес длиннее. Без сдвига
   `measureJS` даёт длину 4,86 вместо 4,905. */
const shift = (contour[0].x + contour[contour.length - 1].x) / 2;
for (const p of contour) p.x = +(p.x - shift).toFixed(4);

/* ---------- 4. кубические Эрмиты с адаптивным шагом ---------- */
/**
 * Гладкость: ручная разметка идёт с шагом 16–20 px, и «дрожание» ±2 px не
 * даёт уложить кривую в бюджет сегментов. Скользящее среднее по 9 точкам
 * снимает дрожание, но не сглаживает перегибы (спойлер, стойка A) — они
 * держатся десятками пикселей.
 */
const smoothY = (() => {
  const Y = contour.map((p) => p.y);
  const out = Y.slice();
  const Wn = 4;
  for (let i = 0; i < Y.length; i++) {
    let s = 0;
    let n = 0;
    for (let k = -Wn; k <= Wn; k++) {
      const j = i + k;
      if (j < 0 || j >= Y.length) continue;
      s += Y[j];
      n++;
    }
    out[i] = s / n;
  }
  return out;
})();
const ySmooth = (x) => {
  for (let i = 0; i < contour.length - 1; i++) {
    if (x <= contour[i + 1].x) {
      const a = contour[i];
      const b = contour[i + 1];
      const t = (x - a.x) / (b.x - a.x);
      return smoothY[i] + (smoothY[i + 1] - smoothY[i]) * Math.max(0, Math.min(1, t));
    }
  }
  return smoothY[smoothY.length - 1];
};

const X0 = contour[0].x;
const X1 = contour[contour.length - 1].x;
const TOL_MM = 8;      // допуск сегмента: ужимает число ветвей до бюджета оп/px
/* Кромка бампера на самом габарите почти вертикальна, и без замыкания узел
   на краю просаживается ниже порога — силуэт «кончается» раньше габарита.
   0,36 м — 60 мм над порогом (0,185), столько даёт кромка на фото. */
const BUMPER_CLOSE = 0.36;

const hermite = (x0, x1, y0, y1, m0, m1) => {
  const h = x1 - x0;
  const t0 = m0 * h;
  const t1 = m1 * h;
  return [y0, t0, 3 * (y1 - y0) - 2 * t0 - t1, -2 * (y1 - y0) + t0 + t1, h, x0];
};
const evalHermite = (seg, x) => {
  const [a, b, c, d, h, x0] = seg;
  const t = (x - x0) / h;
  return a + t * (b + t * (c + t * d));
};

const nodesX = [X0];
let cur = X0;
let guard = 0;
while (cur < X1 - 0.02 && guard++ < 200) {
  /* тянем сегмент, пока Эрмит не начнёт врать больше TOL_MM: прямые участки
     (крыша, капот) укладываются в 0,65 м, перегибы — в 0,2 м. В шейдере
     каждый сегмент это ветвь `if`, поэтому их число = деньги бюджета */
  let best = Math.min(X1, +(cur + 0.2).toFixed(4));
  for (let len = 0.2; len <= 0.65; len += 0.05) {
    const x1 = Math.min(X1, +(cur + len).toFixed(4));
    if (x1 <= cur + 1e-6) break;
    const y0 = ySmooth(cur);
    const y1 = ySmooth(x1);
    const m0 = (ySmooth(cur + 0.02) - ySmooth(Math.max(X0, cur - 0.02))) / (cur + 0.02 - Math.max(X0, cur - 0.02));
    const m1 = (ySmooth(Math.min(X1, x1 + 0.02)) - ySmooth(Math.max(X0, x1 - 0.02))) / (Math.min(X1, x1 + 0.02) - Math.max(X0, x1 - 0.02));
    const seg = hermite(cur, x1, y0, y1, m0, m1);
    let worst = 0;
    for (let x = cur; x <= x1; x += 0.01) worst = Math.max(worst, Math.abs(evalHermite(seg, x) - ySmooth(x)) * 1000);
    if (worst <= TOL_MM) best = x1;
    else break;
  }
  nodesX.push(+best.toFixed(4));
  cur = best;
}
if (nodesX[nodesX.length - 1] < X1 - 1e-6) nodesX.push(+X1.toFixed(4));

const nodesY = nodesX.map((x) => ySmooth(x));
nodesY[0] = Math.max(nodesY[0], BUMPER_CLOSE);
nodesY[nodesY.length - 1] = Math.max(nodesY[nodesY.length - 1], BUMPER_CLOSE);
const slopes = nodesY.map((y, i) => {
  if (i === 0) return (nodesY[1] - y) / (nodesX[1] - nodesX[0]);
  if (i === nodesY.length - 1) return (y - nodesY[i - 1]) / (nodesX[i] - nodesX[i - 1]);
  return (nodesY[i + 1] - nodesY[i - 1]) / (nodesX[i + 1] - nodesX[i - 1]);
});
const segments = nodesX.slice(0, -1).map((x0, i) => {
  const h = +(nodesX[i + 1] - x0).toFixed(4);
  const t0 = slopes[i] * h;
  const t1 = slopes[i + 1] * h;
  return {
    x0: +x0.toFixed(4),
    h,
    a: +nodesY[i].toFixed(4),
    b: +t0.toFixed(4),
    c: +(3 * (nodesY[i + 1] - nodesY[i]) - 2 * t0 - t1).toFixed(4),
    d: +(-2 * (nodesY[i + 1] - nodesY[i]) + t0 + t1).toFixed(4),
  };
});
const evalSegs = (x) => {
  let i = 0;
  while (i < segments.length - 1 && x >= segments[i].x0 + segments[i].h) i++;
  const s = segments[i];
  const t = (x - s.x0) / s.h;
  return s.a + t * (s.b + t * (s.c + t * s.d));
};
const xs = [];
for (let x = X0; x <= X1 + 1e-9; x += 0.002) xs.push(x);
const errs = xs.map((x) => Math.abs(evalSegs(x) - ySmooth(x)) * 1000);

const out = {
  source: 'docs/brand/voyah/refs/r31/side-white-1456.jpg',
  note: 'контур верха — ручная разметка (74 точки), калибровка — от осей колёс; масштаб и пропорции из паспорта',
  spec: SPEC,
  pixels: {
    width: W,
    height: H,
    bodyX0,
    bodyX1,
    noseAtLeft,
    frontAxleX: front.cx,
    rearAxleX: rear.cx,
    groundFrontY: groundFront,
    groundRearY: groundRear,
    mmPerPx: +mmPerPx.toFixed(4),
  },
  fit: {
    rawLengthM: +rawLengthM.toFixed(4),
    rawHeightM: +rawHeightM.toFixed(4),
    lengthErrorPct: +(((rawLengthM - SPEC.length) / SPEC.length) * 100).toFixed(2),
    heightErrorPct: +(((rawHeightM - SPEC.height) / SPEC.height) * 100).toFixed(2),
    kx: +kx.toFixed(5),
    ky: +ky.toFixed(5),
  },
  landmarks: {
    roofPeak: { x: +xs[errs.length - 1].toFixed(0), y: 0 },
    nose: { x: contour[contour.length - 1].x, y: contour[contour.length - 1].y },
    tail: { x: contour[0].x, y: contour[0].y },
  },
  contour,
  segments,
  modelError: {
    meanMm: +(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2),
    maxMm: +Math.max(...errs).toFixed(2),
    toleranceMm: TOL_MM,
  },
};
const peakX = xs.reduce((best, x) => (evalSegs(x) > evalSegs(best) ? x : best), xs[0]);
out.landmarks.roofPeak = { x: +peakX.toFixed(3), y: +evalSegs(peakX).toFixed(4) };

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'profile-ref.json'), `${JSON.stringify(out, null, 1)}\n`);

/* ---------- 4b. вписать сегменты в модуль ----------
   Модуль не хранит таблицу контура: в ESSL 1.00 массивов нет, а 74 точки
   лесенкой `if` стоили бы ~2500 инструкций на пиксель. Хранятся адаптивные
   кубические сегменты — та же кривая с точностью 8 мм. */
const MODULE = join(SITE, 'src/client/car-profile.ts');
const mod = readFileSync(MODULE, 'utf8');
const rows = segments
  .map((g) => `  { x0: ${g.x0.toFixed(4)}, h: ${g.h.toFixed(4)}, a: ${g.a.toFixed(4)}, b: ${g.b.toFixed(4)}, c: ${g.c.toFixed(4)}, d: ${g.d.toFixed(4)} },`)
  .join('\n');
const body = `export const TOP_SEGMENTS: TopSegment[] = [\n${rows}\n];`;
const re = /export const TOP_SEGMENTS: TopSegment\[\] = \[[^\]]*\];/;
if (!re.test(mod)) throw new Error('Не нашёл TOP_SEGMENTS в car-profile.ts');
writeFileSync(MODULE, mod.replace(re, () => body));

/* ---------- 5. картинка: контур поверх фото ---------- */
const toPx = (p) => {
  const xPix = midPx + (p.x / kx / mPerPx) * dirToNose + (shift / kx / mPerPx) * dirToNose;
  return [xPix, groundAtPx(xPix) - (p.y / ky) / mPerPx];
};
const dense = [];
for (let x = segments[0].x0; x <= X1; x += 0.01) dense.push(x);
const path = dense
  .map((x, i) => {
    const [X, Y] = toPx({ x, y: Math.max(0, evalSegs(x)) });
    return `${i ? 'L' : 'M'}${X.toFixed(1)} ${Y.toFixed(1)}`;
  })
  .join(' ');
const grid = [];
for (let gx = 0; gx < W; gx += 100) grid.push(`<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="#00e5ff" stroke-width="1" opacity=".35"/>`);
for (let gy = 0; gy < H; gy += 100) grid.push(`<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="#00e5ff" stroke-width="1" opacity=".35"/>`);
const axes = [
  `<line x1="${front.cx}" y1="${front.top}" x2="${front.cx}" y2="${groundFront}" stroke="#ffd400" stroke-width="2" stroke-dasharray="8 6"/>`,
  `<line x1="${rear.cx}" y1="${rear.top}" x2="${rear.cx}" y2="${groundRear}" stroke="#ffd400" stroke-width="2" stroke-dasharray="8 6"/>`,
  `<line x1="0" y1="${groundFront}" x2="${W}" y2="${groundRear}" stroke="#00e5ff" stroke-width="2" stroke-dasharray="10 8"/>`,
].join('');
const svg = (withGrid) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  ${withGrid ? grid.join('') : ''}${axes}
  <path d="${path}" fill="none" stroke="#39ff14" stroke-width="3"/>
</svg>`;
await sharp(SRC).composite([{ input: Buffer.from(svg(false)) }]).jpeg({ quality: 90 }).toFile(join(OUT, 'trace.jpg'));
await sharp(SRC).composite([{ input: Buffer.from(svg(true)) }]).jpeg({ quality: 90 }).toFile(join(OUT, 'trace-grid.jpg'));

console.log(`оси: ${front.cx} и ${rear.cx} px → база ${SPEC.wheelbase} м ⇒ ${mmPerPx.toFixed(3)} мм/px`);
console.log(`земля под осями: ${groundFront} / ${groundRear} px (линия земли наклонена)`);
console.log(`по фото: длина ${rawLengthM.toFixed(3)} м (${out.fit.lengthErrorPct} %), высота ${rawHeightM.toFixed(3)} м (${out.fit.heightErrorPct} %)`);
console.log(`нормировка: kx ${kx.toFixed(4)}, ky ${ky.toFixed(4)} — пропорции паспорт, форма фото`);
console.log(`контур: ${contour.length} точек; сегментов ${segments.length} (допуск ${TOL_MM} мм); модель против контура ${out.modelError.meanMm} мм в среднем, ${out.modelError.maxMm} мм максимум`);
console.log(`пик крыши: x ${out.landmarks.roofPeak.x}, y ${out.landmarks.roofPeak.y}`);
console.log(`→ ${join(OUT, 'profile-ref.json')}`);
console.log(`→ ${MODULE}: ${segments.length} сегментов`);
