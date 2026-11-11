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
const thresh = Number(process.env.THRESH ?? 26);
const mode = process.env.MASK ?? 'dark';

const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const lum = (x, y) => {
  const i = (y * W + x) * C;
  return (data[i] + data[i + 1] + data[i + 2]) / 3;
};
const isCar = (x, y) => (mode === 'dark' ? lum(x, y) > thresh : lum(x, y) < thresh);

let x0 = W, x1 = -1, y0 = H, y1 = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (isCar(x, y)) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
}
if (x1 < 0) {
  console.error('машина не найдена: подберите THRESH или MASK');
  process.exit(2);
}
const len = x1 - x0 + 1;
const hgt = y1 - y0 + 1;

console.log(`файл: ${file}  (${W}×${H}, маска «${mode}», порог ${thresh})`);
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

/* Колёса: тёмные диски у земли. Ищем два провала яркости в полосе 55…95 % высоты. */
{
  const band = [];
  for (let x = x0; x <= x1; x++) {
    let s = 0;
    let n = 0;
    for (let y = y0 + Math.round(hgt * 0.55); y <= y0 + Math.round(hgt * 0.95); y++) {
      s += lum(x, y);
      n++;
    }
    band.push(s / n);
  }
  const mean = band.reduce((a, v) => a + v, 0) / band.length;
  const dark = band.map((v) => v < mean * 0.85);
  const runs = [];
  let st = -1;
  for (let i = 0; i <= dark.length; i++) {
    if (dark[i] && st < 0) st = i;
    if ((!dark[i] || i === dark.length) && st >= 0) { runs.push([st, i - 1]); st = -1; }
  }
  const big = runs.filter((r) => r[1] - r[0] > len * 0.02);
  console.log(`\n4. тёмные пятна в нижней половине (шины/диски): ${big.length ? big.map((r) => `${((r[0] / len) * 100).toFixed(0)}…${((r[1] / len) * 100).toFixed(0)} %L`).join(', ') : 'нет'}`);
  for (const r of big) {
    const d = ((r[1] - r[0] + 1) / len);
    console.log(`   пятно ${((r[0] / len) * 100).toFixed(0)} %L: диаметр ${(d * 100).toFixed(1)} %L (паспорт колеса 15,0 %L)`);
  }
  if (!big.length) console.log('   колесо не читается отдельно от кузова — это и есть «капля»');
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
