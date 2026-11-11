#!/usr/bin/env node
/**
 * Замер машины в кадре 3D-фона (круг 32).
 *
 *   node scripts/bg3d-car-measure.mjs docs/reports/r31-bg3d/frames-cpu/B-silhouette-1280x720.png
 *
 * Печатает то, что видит владелец, а не то, что записано в паспорте:
 *   • габарит силуэта в кадре и отношение высота/длина (паспорт 0,335);
 *   • диаметр колеса к длине (паспорт 0,150) — по тёмным «шинам» у земли;
 *   • есть ли полоса остекления: контраст между зоной стёкол и зоной двери;
 *   • профиль верхней кромки — по нему видно, есть ли капот, лобовое и крыша,
 *     или это одна «капля».
 *
 * Скрипт ничего не запрещает: он мерит и печатает. Порог — в задании №57.
 *
 * Переменные: THRESH — яркость, ниже которой пиксель считается кузовом (по умолчанию 26),
 * MASK=light — если машина светлая на тёмном (эталонное фото).
 */
import sharp from 'sharp';

const file = process.argv[2] ?? 'docs/reports/r31-bg3d/frames-cpu/B-silhouette-1280x720.png';
const bgFile = process.env.BG ?? null;      /* тот же кадр БЕЗ машины (вариант A) */
const thresh = Number(process.env.THRESH ?? 26);
const mode = process.env.MASK ?? 'diff';    /* diff | dark | light */

const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const lum = (x, y) => {
  const i = (y * W + x) * C;
  return (data[i] + data[i + 1] + data[i + 2]) / 3;
};

/* ---------------------------------------------------------------------------
   Маска машины. Расширено в круге 32 (задание №57), потому что порог яркости
   перестал быть честным: после того как кузов стал светлее пола, «тёмное на
   светлом» ловит не машину, а тени, а «светлое на тёмном» — прожекторы пола.
   Маска по РАЗНИЦЕ с кадром без машины (`BG=<кадр без машины>`) не зависит ни
   от палитры, ни от порога: пиксель считается машиной там, где включение
   машины изменило кадр сильнее порога. Числа приёмки не меняются.
   --------------------------------------------------------------------------- */
let bg = null;
if (bgFile) {
  const r = await sharp(bgFile).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (r.info.width !== W || r.info.height !== H) {
    console.error(`BG=${bgFile}: размер ${r.info.width}×${r.info.height} не совпадает с кадром ${W}×${H}`);
    process.exit(2);
  }
  bg = r.data;
  if (mode === 'diff') { /* порог разницы по умолчанию */ }
}
if (mode === 'diff') mode === 'diff';   /* оставлено для ясности ветвления ниже */
/* 12,0 из 765 возможных: шум ≤ 1,5, мягкая тень и подсветка пола 3–9, корпус
   машины 20+. Порог отсекает свет, а не машину. */
const diffThresh = Number(process.env.DIFF ?? (bgFile ? 12.0 : 0));
const isCar = (x, y) => {
  if (bgFile && (mode === 'diff' || mode === 'auto')) {
    const i = (y * W + x) * C;
    const d = Math.abs(data[i] - bg[i]) + Math.abs(data[i + 1] - bg[i + 1]) + Math.abs(data[i + 2] - bg[i + 2]);
    return d / 3 > diffThresh;
  }
  return mode === 'dark' ? lum(x, y) > thresh : lum(x, y) < thresh;
};

/* Габарит.
   Расширено в круге 32: маска «машина» включает её собственные ореолы (фары,
   габариты, отражение), поэтому «крайний пиксель маски» даёт bbox больше кузова,
   и все полосы (стекло, дверь, колёса) считаются не там, где машина.
   Кузов плотный, ореолы — разреженные: берём строки и столбцы, где маска занимает
   не меньше 4 % самой плотной строки/столбца. Порог 4 % выбран по гистограмме:
   у кузова 60–100 %, у ореолов 0,5–3 %. */
const rowN = new Array(H).fill(0);
const colN = new Array(W).fill(0);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (isCar(x, y)) { rowN[y]++; colN[x]++; }
  }
}
/* Порог 2,5 % от самой плотной строки/столбца. Почему так:
   · «крайний пиксель» — это ореолы фар, они уезжают на 40–100 px за нос и корму;
   · 2,5 % (≈ 23 px на кадре 1280) отсекают именно их, но оставляют каждую
     настоящую строку кузова: над крышей в строке 200+ пикселей, у юбки 20–30.
   Раньше стояло 4 % — bbox обрезался по порогу и низ машины не попадал в замер. */
const KEEP = Number(process.env.KEEP ?? 0.025);
const rowMax = Math.max(...rowN), colMax = Math.max(...colN);
let x0 = W, x1 = -1, y0 = H, y1 = -1;
for (let x = 0; x < W; x++) if (colN[x] >= Math.max(2, colMax * KEEP)) { if (x < x0) x0 = x; x1 = x; }

/* По вертикали — ВЕРХНЯЯ связная группа строк. Причина: при высоком качестве
   шейдер рисует отражение в мокром асфальте, и оно попадает в маску «разница с
   кадром без машины», растягивая габарит вниз на треть. Отражение отделено от
   машины провалом в 20+ пустых строк, поэтому группы различаются надёжно.
   Мерим силуэт (верхнюю группу) — отражение это не машина. */
const GROUPS_GAP = Number(process.env.GAP ?? 6);
{
  const groups = [];
  let run = null;
  for (let y = 0; y < H; y++) {
    const on = rowN[y] >= Math.max(2, rowMax * KEEP);
    if (on) {
      if (!run) run = { a: y, b: y, gap: 0 };
      else run.b = y, run.gap = 0;
    } else if (run) {
      run.gap++;
      if (run.gap >= GROUPS_GAP) { groups.push(run); run = null; }
    }
  }
  if (run) groups.push(run);
  const solid = groups.filter((g) => g.b - g.a >= 3);
  if (solid.length) { y0 = solid[0].a; y1 = solid[0].b; } else if (groups.length) { y0 = groups[0].a; y1 = groups[0].b; }
}
if (x1 < 0) {
  console.error('машина не найдена: подберите THRESH или MASK');
  process.exit(2);
}
const len = x1 - x0 + 1;
const hgt = y1 - y0 + 1;

console.log(`файл: ${file}  (${W}×${H}, маска «${bgFile ? 'diff по ' + bgFile : mode}», порог ${bgFile ? diffThresh : thresh})`);
console.log(`\n1. габарит в кадре: x ${x0}…${x1} (${len} px = ${((len / W) * 100).toFixed(1)} %W), y ${y0}…${y1} (${hgt} px = ${((hgt / H) * 100).toFixed(1)} %H)`);
const hl = hgt / len;
console.log(`2. высота/длина = ${hl.toFixed(3)}  (паспорт 0,335; допуск ±0,010 → ${(hl >= 0.325 && hl <= 0.345) ? 'PASS' : 'FAIL'})`);

/* Верхняя кромка по столбцам — по ней видно капот/лобовое/крышу. */
const tops = [];
for (let x = x0; x <= x1; x++) {
  let t = -1;
  for (let y = y0; y <= y1; y++) if (isCar(x, y)) { t = y; break; }
  tops.push(t);
}
const q = (f) => tops[Math.min(tops.length - 1, Math.max(0, Math.round(f * (tops.length - 1))))];
console.log(`\n3. верхняя кромка (в долях длины, %H):`
  + ` 0,00:${(((q(0) - y0) / hgt) * 100).toFixed(0)}`
  + ` 0,10:${(((q(0.1) - y0) / hgt) * 100).toFixed(0)}`
  + ` 0,22:${(((q(0.22) - y0) / hgt) * 100).toFixed(0)}`
  + ` 0,35:${(((q(0.35) - y0) / hgt) * 100).toFixed(0)}`
  + ` 0,50:${(((q(0.5) - y0) / hgt) * 100).toFixed(0)}`
  + ` 0,65:${(((q(0.65) - y0) / hgt) * 100).toFixed(0)}`
  + ` 0,78:${(((q(0.78) - y0) / hgt) * 100).toFixed(0)}`
  + ` 0,90:${(((q(0.9) - y0) / hgt) * 100).toFixed(0)}`
  + ` 1,00:${(((q(1) - y0) / hgt) * 100).toFixed(0)}`);
console.log('   ожидание по профилю Voyah Free: капот 45–55 %, лобовое 20–45 %, крыша 0–15 %, корма 10–30 %');

/* Колёса: тёмный прогон на УРОВНЕ ОСИ колеса.
   Переписано в круге 32. Прежняя версия искала «провалы яркости относительно
   среднего по полосе» — на светлом полу это не срабатывало ни при каком колесе,
   а после того как пол стал темнее кузова, среднее по полосе вообще перестало
   быть кузовом. Теперь признак прямой и не зависит от палитры:
     · опорный тон — кузов (медиана полосы двери);
     · колесо — прогон по X, где на высоте оси (24 % высоты силуэта от низа)
       яркость ниже 55 % тона кузова (шина почти чёрная);
     · ширина прогона в долях длины машины (паспорт колеса 0,150 L).
   Так меряется ровно то, что видит владелец: «колесо читается пятном». */
{
  /* Уровень оси колеса — 0,135 высоты силуэта от низа (проверено по кадру:
     у 1280×720 колесо занимает 20…40 % высоты силуэта, ось на 23…26 %). */
  const yAxle = y1 - Math.round(hgt * 0.24);
  /* Опорный тон — КУЗОВ (медиана полосы двери), а не пол. На тёмной сцене пол
     почти чёрный, и «тёмное колесо на тёмном полу» не читается физически; зато
     колесо обязано читаться пятном на светлом кузове — это и видит владелец
     на фото. Поэтому признак: прогон по X, где у оси яркость ниже 55 % кузова. */
  const bodyVals = [];
  for (let y = y0 + Math.round(hgt * 0.52); y <= y0 + Math.round(hgt * 0.72); y++) {
    for (let x = x0 + Math.round(len * 0.35); x <= x0 + Math.round(len * 0.65); x++) {
      bodyVals.push(lum(x, y));
    }
  }
  bodyVals.sort((p, q) => p - q);
  const bodyL = bodyVals[Math.floor(bodyVals.length / 2)];
  const isDark = new Array(len).fill(false);
  for (let i = 0; i < len; i++) {
    let s2 = 0;
    let n2 = 0;
    for (let y = yAxle - 3; y <= yAxle + 3; y++) { s2 += lum(x0 + i, y); n2++; }
    isDark[i] = s2 / n2 < bodyL * 0.55;
  }
  const runs = [];
  let st = -1;
  for (let i = 0; i <= len; i++) {
    const on = i < len && isDark[i];
    if (on && st < 0) st = i;
    if ((!on || i === len) && st >= 0) { if (i - st > len * 0.03) runs.push([st, i - 1]); st = -1; }
  }
  console.log(`\n4. колёса: тон кузова ${bodyL.toFixed(1)} L, на высоте оси ${(hgt * 0.24).toFixed(0)} px от низа`);
  for (const r of runs) {
    const w = (r[1] - r[0] + 1) / len;
    const ok = Math.abs(w * 100 - 15.0) <= 1.0;
    console.log(`   пятно ${((r[0] / len) * 100).toFixed(0)}…${((r[1] / len) * 100).toFixed(0)} %L: ширина ${(w * 100).toFixed(1)} %L`
      + ` (паспорт 15,0 ±1,0 → ${ok ? 'PASS' : 'FAIL'})`);
  }
  if (!runs.length) console.log('   колесо не читается отдельно от кузова и пола — это и есть «капля»');
}

/* Остекление: контраст между полосой 20…40 % высоты и 55…75 % высоты. */
{
  const bandMean = (a, b) => {
    let s = 0;
    let n = 0;
    for (let y = y0 + Math.round(hgt * a); y <= y0 + Math.round(hgt * b); y++) {
      for (let x = x0 + Math.round(len * 0.35); x <= x0 + Math.round(len * 0.75); x++) {
        s += lum(x, y);
        n++;
      }
    }
    return s / n;
  };
  const glass = bandMean(0.18, 0.38);
  const door = bandMean(0.58, 0.78);
  console.log(`\n5. остекление: яркость в полосе стёкол ${glass.toFixed(1)} L, в полосе двери ${door.toFixed(1)} L`
    + ` → контраст ${(Math.max(glass, door) / Math.max(1, Math.min(glass, door))).toFixed(2)}×`);
}
