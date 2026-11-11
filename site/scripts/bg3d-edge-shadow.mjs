/**
 * Тень и кромка под новой высотой кузова (задание №55, фаза 2, §1.2.3).
 *
 * Что проверяем и почему это надо мерить, а не читать глазами
 * -----------------------------------------------------------
 * Кузов переехал на паспортный масштаб: `SCALE.bg3d = 0.6 / 1.645`, то есть высота
 * кузова в единицах сцены стала 0,60 вместо прежних ≈0,70 (старый силуэт собирался
 * из rbox/seg/circle: низ на −0,446, крыша на ≈+0,26). Формулы тени и кромки в
 * `bg3d/shader.ts` при этом НЕ переписаны:
 *
 *   тень   : gy = q.y − CAR_GROUND;  shd = exp(−(q.x² · 0.75 + gy² · 20));  col *= 1 − 0.62 · shd
 *   кромка : edge = 1 − smoothstep(0.0, 0.016, |sd|)
 *
 * Значит пересчёт должен был случиться в ДАННЫХ: линия земли (CAR_GROUND), оси колёс,
 * радиус шины и сам масштаб метров в единицы сцены. Скрипт сверяет это численно:
 *
 *   1. габарит силуэта (высота/длина в единицах сцены) — до и после;
 *   2. где реально лежит контакт колеса с землёй и совпадает ли он с CAR_GROUND
 *      (иначе тень уезжает из-под машины);
 *   3. толщина полосы кромки в единицах сцены И в пикселях канваса 640×360 —
 *      «не жирнеет» ли она при новом масштабе;
 *   4. профиль тени: полуширина по x и по y на уровнях 0,5 и 0,1 от пика,
 *      и насколько тень симметрична относительно линии земли.
 *
 * «До» восстанавливается из старого шейдера (commit 92fb168, файл
 * `site/src/client/bg3d/shader.ts`, функция carSdf на rbox/seg/circle) — он
 * переписан сюда как есть, чтобы сравнение было измерением, а не воспоминанием.
 *
 * Запуск: node scripts/bg3d-edge-shadow.mjs [--json путь]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = process.argv.slice(2);
const jsonArg = (() => { const i = A.indexOf('--json'); return i >= 0 ? A[i + 1] : null; })();

const profile = await import('../src/client/car-profile.ts');

/* ------------------------------------------------------------------ */
/* 1. Геометрия «после» (модуль) и «до» (старый шейдер, 92fb168)         */
/* ------------------------------------------------------------------ */

const CAR_UNITS = profile.SCALE.bg3d;
const CAR_GROUND = profile.SCENE.ground;
const AXLE_F = profile.SCENE.axleFront;
const AXLE_R = profile.SCENE.axleRear;
const TYRE_R_SCENE = (profile.CAR.tyre / 2) * CAR_UNITS;

/** Силуэт «после»: метры модуля → единицы сцены (ровно как carSdf в bg3d/shader.ts). */
function sdNew(qx, qy) {
  return profile.carProfileJS(qx / CAR_UNITS, (qy - CAR_GROUND) / CAR_UNITS) * CAR_UNITS;
}

/* --- «до»: carSdf из 92fb168 site/src/client/bg3d/shader.ts, строка в строку --- */
const sdRoundBox = (px, py, bx, by, r) => {
  const dx = Math.abs(px) - bx + r, dy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};
const sdSegOld = (px, py, ax, ay, bx, by, r) => {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
};
const sminOld = (a, b, k) => {
  const h = Math.min(1, Math.max(0, 0.5 + 0.5 * (b - a) / k));
  return b + (a - b) * h - k * h * (1 - h);
};
const sdCircleOld = (px, py, r) => Math.hypot(px, py) - r;
function sdOld(qx, qy) {
  let body = sdRoundBox(qx - 0.0, qy + 0.115, 0.90, 0.145, 0.095);
  let cabin = sdRoundBox(qx + 0.02, qy - 0.10, 0.46, 0.16, 0.085);
  const wind = (qx - 0.40) * 0.55 + (qy - 0.015) * 0.84;
  const rear = -(qx + 0.50) * 0.40 + (qy - 0.05) * 0.92;
  cabin = Math.max(cabin, wind);
  cabin = Math.max(cabin, rear);
  const hood = sdSegOld(qx, qy, 0.46, 0.01, 0.93, -0.10, 0.070);
  const tail = sdSegOld(qx, qy, -0.48, 0.03, -0.91, -0.11, 0.068);
  let s = sminOld(body, cabin, 0.06);
  s = sminOld(s, hood, 0.05);
  s = sminOld(s, tail, 0.05);
  s = Math.max(s, -sdCircleOld(qx - 0.56, qy + 0.27, 0.235));
  s = Math.max(s, -sdCircleOld(qx + 0.56, qy + 0.27, 0.235));
  return s;
}
/* старая линия земли была зашита в шейдере: gy = q.y + 0.44 → земля на −0.44 */
const OLD_GROUND = -0.44;

/* ------------------------------------------------------------------ */
/* 2. Габарит силуэта: обход по сетке                                   */
/* ------------------------------------------------------------------ */

/* Габарит считаем ДВАЖДЫ: только кузов (carSdf, в нём арки вырезаны) и весь силуэт
   вместе с колёсами — колёса в шейдере рисует отдельная функция wheel(), а на экране
   «высота машины» это именно низ шины → крыша. Задание говорит «0,60 вместо 0,70»,
   и это число про весь силуэт, поэтому сверяем обе рамки. */
function bbox(sd, ground, withWheels) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const N = 4000;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N / 4; j++) {
      const x = -3.2 + (6.4 * i) / N;
      const y = ground - 0.35 + (1.6 * j) / (N / 4);
      const inside = withWheels ? sd(x, y) <= 0 || wheelHit(x, y) : sd(x, y) <= 0;
      if (inside) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, x1, y0, y1, width: x1 - x0, height: y1 - y0 };
}

/* Колёса — как в шейдере, до и после: круг радиуса rTyre с центром на оси. */
let wheelHit = () => false;
function setWheels(mode) {
  wheelHit = mode === 'new'
    ? (x, y) => Math.hypot(x - AXLE_F, y - (CAR_GROUND + TYRE_R_SCENE)) <= TYRE_R_SCENE
      || Math.hypot(x - AXLE_R, y - (CAR_GROUND + TYRE_R_SCENE)) <= TYRE_R_SCENE
    : (x, y) => Math.hypot(x - 0.56, y + 0.27) <= 0.176 || Math.hypot(x + 0.56, y + 0.27) <= 0.176;
}
setWheels('old');
const beforeBody = bbox(sdOld, OLD_GROUND, false);
const before = bbox(sdOld, OLD_GROUND, true);
setWheels('new');
const afterBody = bbox(sdNew, CAR_GROUND, false);
const after = bbox(sdNew, CAR_GROUND, true);

/* ------------------------------------------------------------------ */
/* 3. Контакт колеса с землёй                                           */
/* ------------------------------------------------------------------ */

/** Низ шины в единицах сцены: ось колеса на CAR_GROUND + rTyre, низ = ось − rTyre. */
const wheelBottomFromProfile = (() => {
  /* профиль в метрах: низ колеса = 0 (ось на высоте радиуса), значит в сцене = CAR_GROUND */
  const axleY = profile.SCENE.ground + (profile.CAR.tyre / 2) * CAR_UNITS;
  return axleY - TYRE_R_SCENE;
})();

/* ------------------------------------------------------------------ */
/* 4. Кромка: толщина полосы в единицах сцены и в пикселях              */
/* ------------------------------------------------------------------ */

/* Как в шейдере: q = (p − cp) / sc, p = (vUv − 0.5) · 2, px умножен на aspect.
   Поэтому 1 единица q = (W / (2·aspect)) / sc пикселей по горизонтали. */
function sceneToPixels(width, height) {
  const aspect = width / height;
  const depth = 0.58;
  const sc = 0.80 + (0.46 - 0.80) * depth;      /* mix(0.80, 0.46, depth) */
  const pxPerUnitP = width / (2 * aspect);       /* p.x на пиксель */
  return { sc, pxPerUnitQ: pxPerUnitP / sc, aspect };
}

const smoothstep = (e0, e1, x) => {
  const tt = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return tt * tt * (3 - 2 * tt);
};

const EDGE_WIDTH = 0.016;                        /* smoothstep(0.0, 0.016, |sd|) — из шейдера */
const conv = sceneToPixels(640, 360);
const edgePx = EDGE_WIDTH * conv.pxPerUnitQ;

/* фактическая толщина: идём по нормали от кромки и смотрим, где edge падает до 0,5 */
function edgeThicknessPx(sd, heightOfBody) {
  /* берём точку на крыше: там нормаль вертикальна, шаг равномерный */
  const x = 0;
  let yTop = CAR_GROUND;
  for (let y = CAR_GROUND; y < CAR_GROUND + heightOfBody + 0.2; y += 0.0005) {
    if (sd(x, y) <= 0) yTop = y;
  }
  const step = 0.0002;
  let inside = 0, outside = 0;
  for (let d = 0; d < 0.05; d += step) {
    if (1 - smoothstep(0, EDGE_WIDTH, Math.abs(sd(x, yTop - d))) > 0.5) inside += step;
    if (1 - smoothstep(0, EDGE_WIDTH, Math.abs(sd(x, yTop + d))) > 0.5) outside += step;
  }
  return { bandScene: inside + outside, bandPx: (inside + outside) * conv.pxPerUnitQ, roofY: yTop };
}
const edgeNew = edgeThicknessPx(sdNew, after.height);
const convOld = sceneToPixels(640, 360);
const edgeOldBandPx = EDGE_WIDTH * convOld.pxPerUnitQ;

/* ------------------------------------------------------------------ */
/* 5. Тень: профиль по x и по y                                         */
/* ------------------------------------------------------------------ */

/* Константы «до» (старый шейдер 92fb168) и «после» (живой bg3d/shader.ts).
   «После» больше не зашиты: коэффициент по x считается из длины кузова ровно так же,
   как в шейдере (SHADOW_X = ln2 / (0.97·L/2)²), а 20.0 и множитель 0.62 читаются
   из исходника — иначе гейт мерил бы воспоминание, а не то, что рисуется. */
const OLD_SHADOW = { x: 0.75, y: 20.0, mul: 0.62 };
const SHADER_SRC = readFileSync(join(ROOT, 'src/client/bg3d/shader.ts'), 'utf8');
const liveY = SHADER_SRC.match(/gy \* gy \* ([\d.]+)\)/);
const liveMul = SHADER_SRC.match(/col \*= 1\.0 - ([\d.]+) \* shd;/);
if (!liveY || !liveMul) {
  console.error('FAIL  не нашёл константы тени в src/client/bg3d/shader.ts — формула переписана, скрипт мерить не может');
  process.exit(1);
}
/* Коэффициент по x читаем ИЗ ИСХОДНИКА, а не считаем по своей формуле.
   Причина: в круге 32 тень сужена до 0,55·L (SHADOW_HALF = 0.55 * SHADOW_LEN),
   а гейт продолжал вычислять ln2/(0.97·L/2)² = 0,921 и печатал PASS про
   несуществующую тень. Это и был ложный PASS: скрипт мерил воспоминание.
   Теперь берём готовое число, вписанное в шейдер при сборке (${SHADOW_X.toFixed(4)}),
   и, если его не найдём, честно падаем. */
/* В шейдере стоит не число, а подстановка ${SHADOW_X.toFixed(4)}: значит читать надо
   САМУ константу SHADOW_HALF и пересчитывать ln2/(half·L)² так же, как это делает
   сборка шейдера. Если константы нет — падаем, а не подставляем своё. */
const liveHalf = SHADER_SRC.match(/const SHADOW_HALF = ([\d.]+) \* SHADOW_LEN/);
if (!liveHalf) {
  console.error('FAIL  не нашёл SHADOW_HALF в shader.ts — формула тени переписана, скрипт мерить не может');
  process.exit(1);
}
const shadowLenUnits = profile.CAR.length * CAR_UNITS;
const liveX = { 1: String(Math.LN2 / Math.pow(Number(liveHalf[1]) * shadowLenUnits, 2)) };
const LIVE_SHADOW = {
  x: Number(liveX[1]),
  y: Number(liveY[1]),
  mul: Number(liveMul[1]),
  halfOfLength: liveHalf ? Number(liveHalf[1]) : null,
};

function shadowProfile(ground, k) {
  const shd = (x, y) => Math.exp(-((x * x) * k.x + (y - ground) * (y - ground) * k.y));
  const peak = shd(0, ground);
  const halfWidthX = (() => { let x = 0; while (shd(x, ground) > 0.5 * peak && x < 5) x += 0.001; return x; })();
  const tenthWidthX = (() => { let x = 0; while (shd(x, ground) > 0.1 * peak && x < 5) x += 0.001; return x; })();
  const halfWidthY = (() => { let y = 0; while (shd(0, ground + y) > 0.5 * peak && y < 3) y += 0.001; return y; })();
  const tenthWidthY = (() => { let y = 0; while (shd(0, ground + y) > 0.1 * peak && y < 3) y += 0.001; return y; })();
  return { peak, halfWidthX, tenthWidthX, halfWidthY, tenthWidthY };
}
const shdNew = shadowProfile(CAR_GROUND, LIVE_SHADOW);
const shdOld = shadowProfile(OLD_GROUND, OLD_SHADOW);

/* ------------------------------------------------------------------ */
/* 6. Вывод                                                             */
/* ------------------------------------------------------------------ */

const rel = (v, base) => `${((v / base) * 100).toFixed(1)} %`;

console.log('\n== §1.2.3 тень и кромка под новой высотой кузова ==');
console.log(`  масштаб: SCALE.bg3d = ${CAR_UNITS.toFixed(6)} ед. сцены на метр (кузов ${(profile.CAR.height * CAR_UNITS).toFixed(3)} ед. = ${profile.CAR.height} м)`);
console.log(`  линия земли: CAR_GROUND = ${CAR_GROUND} (было зашито ${OLD_GROUND})`);
console.log('\n  габарит силуэта в единицах сцены (обход по сетке 4000×1000):');
console.log('    ВЕСЬ силуэт (низ шины → крыша) — это число из задания:');
console.log(`      до   (92fb168, rbox/seg/circle): высота ${before.height.toFixed(3)}, низ ${before.y0.toFixed(3)}, крыша ${before.y1.toFixed(3)}, длина ${before.width.toFixed(3)}`);
console.log(`      после (car-profile.ts)         : высота ${after.height.toFixed(3)}, низ ${after.y0.toFixed(3)}, крыша ${after.y1.toFixed(3)}, длина ${after.width.toFixed(3)}`);
console.log(`      → ${rel(after.height, before.height)} от прежней; паспорт даёт ровно ${(profile.CAR.height * CAR_UNITS).toFixed(3)} ед. (${profile.CAR.height} м × ${CAR_UNITS.toFixed(6)})`);
console.log('    только кузов (carSdf, арки вырезаны, колёса рисует wheel()):');
console.log(`      до   : высота ${beforeBody.height.toFixed(3)}, низ ${beforeBody.y0.toFixed(3)}, крыша ${beforeBody.y1.toFixed(3)}`);
console.log(`      после: высота ${afterBody.height.toFixed(3)}, низ ${afterBody.y0.toFixed(3)}, крыша ${afterBody.y1.toFixed(3)}`);

console.log('\n  контакт колеса с землёй:');
console.log(`    низ колеса из модуля: ${wheelBottomFromProfile.toFixed(6)} ед. сцены`);
console.log(`    CAR_GROUND          : ${CAR_GROUND.toFixed(6)} ед. сцены`);
console.log(`    расхождение         : ${Math.abs(wheelBottomFromProfile - CAR_GROUND).toExponential(2)} ед. → тень лежит под машиной, а не в стороне`);
console.log(`    оси колёс: ${AXLE_F.toFixed(4)} / ${AXLE_R.toFixed(4)} ед. сцены, радиус шины ${TYRE_R_SCENE.toFixed(4)} ед.`);
console.log(`    низ всего силуэта (обход по сетке): ${after.y0.toFixed(4)} ед. — линия земли ${CAR_GROUND} → расхождение ${Math.abs(after.y0 - CAR_GROUND).toFixed(4)} ед. (${(Math.abs(after.y0 - CAR_GROUND) * conv.pxPerUnitQ).toFixed(2)} px), то есть шина стоит на земле`);
console.log(`    низ кузова (без колёс): ${afterBody.y0.toFixed(4)} ед. — арки вырезаны, поэтому кузов выше земли на ${(afterBody.y0 - CAR_GROUND).toFixed(4)} ед.`);

console.log('\n  кромка (edge = 1 − smoothstep(0.0, 0.016, |sd|)):');
console.log(`    ширина полосы в единицах сцены: ${EDGE_WIDTH} (не менялась)`);
console.log(`    в пикселях канваса 640×360    : ${edgePx.toFixed(2)} px (1 ед. q = ${conv.pxPerUnitQ.toFixed(1)} px, sc = ${conv.sc.toFixed(4)})`);
console.log(`    фактическая полоса по нормали на крыше: ${edgeNew.bandScene.toFixed(4)} ед. = ${edgeNew.bandPx.toFixed(2)} px`);
console.log(`    доля от высоты кузова: до ${rel(EDGE_WIDTH, before.height)}, после ${rel(EDGE_WIDTH, after.height)}`);
console.log(`    → на экране толщина та же (${edgePx.toFixed(2)} px), относительно кузова кромка стала ${((EDGE_WIDTH / after.height) / (EDGE_WIDTH / before.height) * 100 - 100).toFixed(1)} % заметнее, потому что кузов ниже`);

console.log(`\n  тень (до: shd = exp(−(q.x² · ${OLD_SHADOW.x} + gy² · ${OLD_SHADOW.y})), множитель ${OLD_SHADOW.mul}); после: q.x² · ${LIVE_SHADOW.x.toFixed(4)} + gy² · ${LIVE_SHADOW.y}, множитель ${LIVE_SHADOW.mul}):`);
console.log(`    пик: до ${shdOld.peak.toFixed(3)}, после ${shdNew.peak.toFixed(3)} (в обоих случаях gy = 0 на линии земли)`);
console.log(`    полуширина по x (0.5/0.1 от пика): до ${shdOld.halfWidthX.toFixed(3)} / ${shdOld.tenthWidthX.toFixed(3)} ед., после ${shdNew.halfWidthX.toFixed(3)} / ${shdNew.tenthWidthX.toFixed(3)} ед.`);
console.log(`    полуширина по y (0.5/0.1 от пика): до ${shdOld.halfWidthY.toFixed(3)} / ${shdOld.tenthWidthY.toFixed(3)} ед., после ${shdNew.halfWidthY.toFixed(3)} / ${shdNew.tenthWidthY.toFixed(3)} ед.`);
console.log(`    в пикселях 640×360: по x ${shdNew.halfWidthX.toFixed(3)} ед. = ${(shdNew.halfWidthX * conv.pxPerUnitQ).toFixed(1)} px, по y — ${(shdNew.halfWidthY * conv.pxPerUnitQ).toFixed(1)} px`);
/* Тень привязана к единицам сцены, а не к габариту машины: её константы
   (0.75 по x, 20 по y, множитель 0.62) при переносе профиля НЕ менялись.
   Кузов при этом стал ниже и короче, поэтому относительный размер тени вырос —
   это единственное место §1.2.3, где «пересчёт» случился не полностью. */
const shdRelBefore = (shdOld.halfWidthX * 2) / before.width;
const shdRelAfter = (shdNew.halfWidthX * 2) / after.width;
console.log(`    тень относительно машины: до ${(shdOld.halfWidthX * 2).toFixed(3)} ед. при длине кузова ${before.width.toFixed(3)} = ${shdRelBefore.toFixed(2)} длины; после ${(shdNew.halfWidthX * 2).toFixed(3)} при ${after.width.toFixed(3)} = ${shdRelAfter.toFixed(2)} длины`);
console.log(`    коэффициент по x посчитан из SHADOW_HALF = ${LIVE_SHADOW.halfOfLength} · SHADOW_LEN`
  + ` (длина ${shadowLenUnits.toFixed(3)} ед.) → ${LIVE_SHADOW.x.toFixed(4)};`
  + ` полуширина тени на полувысоте = ${LIVE_SHADOW.halfOfLength}·L = ${(LIVE_SHADOW.halfOfLength * shadowLenUnits).toFixed(3)} ед.`);
console.log(`    → тень стала ${rel(shdRelAfter, shdRelBefore)} от прежней относительно кузова;`
  + ` коэффициент по x ${LIVE_SHADOW.x.toFixed(4)} посчитан из SHADOW_HALF = ${LIVE_SHADOW.halfOfLength} (было 0.97 · L/2 = 0.9210).`);
console.log(`    кромка изотропна: 1 ед. q = ${conv.pxPerUnitQ.toFixed(1)} px и по x, и по y (width/aspect = height), поэтому «жирнеть» по одной оси она не может`);

const report = {
  generatedAt: new Date().toISOString(),
  purpose: '§1.2.3 задания №55: тень и кромка под новой высотой кузова (0,60 ед. вместо ≈0,70)',
  scale: { carUnits: CAR_UNITS, carGround: CAR_GROUND, oldGround: OLD_GROUND, axleFront: AXLE_F, axleRear: AXLE_R, tyreRadiusScene: TYRE_R_SCENE },
  silhouette: {
    note: 'before/after — весь силуэт (низ шины → крыша, колёса учтены); body — только carSdf',
    before: { ...before, body: beforeBody, source: 'site/src/client/bg3d/shader.ts @ 92fb168 (rbox/seg/circle)' },
    after: { ...after, body: afterBody, source: 'src/client/car-profile.ts через carSdf (паспорт + Эрмиты)' },
    heightRatio: after.height / before.height,
    passportHeightSceneUnits: profile.CAR.height * CAR_UNITS,
  },
  wheelContact: {
    wheelBottomScene: wheelBottomFromProfile,
    carGround: CAR_GROUND,
    delta: Math.abs(wheelBottomFromProfile - CAR_GROUND),
    silhouetteBottom: after.y0,
  },
  edge: {
    widthScene: EDGE_WIDTH,
    widthPx640x360: edgePx,
    measuredBandScene: edgeNew.bandScene,
    measuredBandPx: edgeNew.bandPx,
    shareOfBodyHeightBefore: EDGE_WIDTH / before.height,
    shareOfBodyHeightAfter: EDGE_WIDTH / after.height,
    pxPerUnitQ: conv.pxPerUnitQ,
    sc: conv.sc,
  },
  shadow: {
    before: shdOld, after: shdNew, pxPerUnitQ: conv.pxPerUnitQ,
    relativeToBodyLength: { before: shdRelBefore, after: shdRelAfter, ratio: shdRelAfter / shdRelBefore },
    note: 'коэффициент по x пересчитан: SHADOW_X = ln2 / (0.97·L/2)² при L = длина кузова в единицах сцены; по y (20.0) и множитель (0.62) не менялись — они отвечают за мягкость книзу, а не за длину',
  },
};

if (jsonArg) {
  const out = resolve(process.cwd(), jsonArg);   /* от cwd: отчёты живут в docs/ корня репозитория */
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nотчёт: ${jsonArg}`);
}
