#!/usr/bin/env node
/**
 * Гейт «заставка против эталона» (круг 32).
 *
 * Сравнивает снятый кадр заставки с эталоном `docs/brand/voyah/refs/r31/hero-front-red.png`
 * по семи измеримым признакам. Нужен потому, что числовые гейты круга 31 были зелёными,
 * а владелец увидел «детский рисунок»: они мерили не то. Здесь меряется то, что видно.
 *
 *   node scripts/intro-vs-ref.mjs [кадр] [эталон]
 *
 * Кадр по умолчанию `docs/reports/r31-intro/still-1400.jpg`, эталон — 1920×1080.
 * Разрешения могут быть любыми при том же соотношении сторон: всё считается
 * в % ширины и % высоты, а пиксельные величины приводятся к эталонным 1920×1080.
 *
 * Код возврата 0 — все строки PASS, 1 — есть FAIL.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const shot = process.argv[2] ?? resolve(root, 'docs/reports/r31-intro/still-1400.jpg');
const ref = process.argv[3] ?? resolve(root, 'docs/brand/voyah/refs/r31/hero-front-red.png');

for (const f of [shot, ref]) {
  if (!existsSync(f)) {
    console.error(`нет файла: ${f}`);
    process.exit(2);
  }
}

/** @returns {Promise<{data:Buffer,W:number,H:number,C:number}>} */
async function load(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height, C: info.channels };
}

const at = (im, x, y) => {
  const px = Math.min(im.W - 1, Math.max(0, Math.round(x)));
  const py = Math.min(im.H - 1, Math.max(0, Math.round(y)));
  const i = (py * im.W + px) * im.C;
  return [im.data[i], im.data[i + 1], im.data[i + 2]];
};
const luma = (im, x, y) => {
  const [r, g, b] = at(im, x, y);
  return (r + g + b) / 3;
};

/** Силуэт: нейтрально-тёмный пиксель. Порог по яркости не работает — фон и пол тоже тёмные. */
const isCar = (im, x, y) => {
  const [r, g, b] = at(im, x, y);
  return r < 45 && r - b < 18 && g - b < 12;
};

/** Центр и толщина полосы ДХО в столбце: кластер ярких пикселей в окне 32–60 %H. */
function barAt(im, xpct) {
  const x = Math.round((xpct / 100) * im.W);
  const y0 = Math.round(im.H * 0.32);
  const y1 = Math.round(im.H * 0.60);
  const ys = [];
  for (let y = y0; y < y1; y++) if (luma(im, x, y) > 200) ys.push(y);
  if (ys.length < 2) return null;
  let best = [ys[0], ys[0]];
  let cur = [ys[0], ys[0]];
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] - cur[1] <= 1) cur[1] = ys[i];
    else cur = [ys[i], ys[i]];
    if (cur[1] - cur[0] > best[1] - best[0]) best = [...cur];
  }
  return { y: ((best[0] + best[1]) / 2 / im.H) * 100, n: best[1] - best[0] + 1 };
}

/** Левая кромка силуэта в строке ypct (в %W), либо −1. */
function leftEdge(im, ypct) {
  const y = Math.round((ypct / 100) * im.H);
  for (let x = 0; x < im.W; x++) if (isCar(im, x, y)) return (x / im.W) * 100;
  return -1;
}

/** Верх силуэта в столбце (в %H), либо −1. */
function topAt(im, xpct) {
  const x = Math.round((xpct / 100) * im.W);
  for (let y = 0; y < im.H; y++) if (isCar(im, x, y)) return (y / im.H) * 100;
  return -1;
}

/** Ширина силуэта на высоте ypct, %W. */
function widthAt(im, ypct) {
  const y = Math.round((ypct / 100) * im.H);
  let l = -1;
  let r = -1;
  for (let x = 0; x < im.W; x++) if (isCar(im, x, y)) { if (l < 0) l = x; r = x; }
  return l < 0 ? -1 : ((r - l) / im.W) * 100;
}

/** Вертикальный профиль яркости поперёк полосы: плато, фронт, ореол. */
function barProfile(im) {
  // столбец в середине левой половины полосы, где линия горизонтальна
  const xpct = 39;
  const x = Math.round((xpct / 100) * im.W);
  const b = barAt(im, xpct);
  if (!b) return null;
  const yc = Math.round((b.y / 100) * im.H);
  const v = [];
  for (let d = -14; d <= 14; d++) v.push(luma(im, x, yc + d));
  const peak = Math.max(...v);
  const idx = v.indexOf(peak);
  let plateau = 0;
  for (let i = idx; i < v.length && v[i] >= peak * 0.9; i++) plateau++;
  for (let i = idx - 1; i >= 0 && v[i] >= peak * 0.9; i--) plateau++;
  // фронт вверх: от 10 % до 90 % от пика
  let rise = 0;
  for (let i = idx; i >= 0; i--) {
    if (v[i] <= peak * 0.1) { rise = idx - i; break; }
  }
  // ореол: фон на 0,9…1,3 %H от центра полосы (в эталоне 9…14 px при 1080)
  const k = 1920 / im.W;
  const halo = [];
  for (const off of [0.9, 1.05, 1.2, 1.3]) {
    const d = Math.round((off / 100) * im.H);
    halo.push(luma(im, x, yc - d), luma(im, x, yc + d));
  }
  return { plateau: plateau * k, rise: rise * k, halo: halo.reduce((a, v2) => a + v2, 0) / halo.length };
}

/** Зеркало: верх и низ (низ — конец непрерывного пробега силуэта вниз). */
function mirrorBox(im) {
  let top = 100;
  let bottom = 0;
  for (let xp = 23; xp <= 30; xp += 0.25) {
    const t = topAt(im, xp);
    if (t < 0) continue;
    top = Math.min(top, t);
    const x = Math.round((xp / 100) * im.W);
    let y = Math.round((t / 100) * im.H);
    let gap = 0;
    while (y < im.H * 0.6 && gap < 3) {
      if (isCar(im, x, y)) gap = 0;
      else gap++;
      y++;
    }
    bottom = Math.max(bottom, ((y - gap) / im.H) * 100);
  }
  return { top, bottom };
}

/** Знак: bbox и доля заливки в окне x 47,6…52,4 %W (разрыв полосы), y 41…55 %H. */
function emblem(im) {
  const x0 = Math.round(im.W * 0.476);
  const x1 = Math.round(im.W * 0.524);
  const y0 = Math.round(im.H * 0.41);
  const y1 = Math.round(im.H * 0.55);
  let minx = 1e9; let maxx = -1; let miny = 1e9; let maxy = -1; let cnt = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (luma(im, x, y) > 200) {
        cnt++;
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  if (maxx < 0) return null;
  const w = ((maxx - minx + 1) / im.W) * 100;
  const h = ((maxy - miny + 1) / im.H) * 100;
  const wpx = (w / 100) * 1920;
  const hpx = (h / 100) * 1080;
  return { w, h, cover: (cnt / ((maxx - minx + 1) * (maxy - miny + 1))) * 100, aspect: hpx / wpx };
}

const A = await load(shot);
const B = await load(ref);

const rows = [];
const add = (name, ours, target, ok, note = '') => rows.push({ name, ours, target, ok, note });
/** Сравнение с эталоном в долях: lo…hi от эталонного значения (самокалибровка). */
const addRatio = (name, ours, refVal, lo, hi, unit, note = '') => {
  const ok = refVal > 0 && ours >= lo * refVal && ours <= hi * refVal;
  add(name, `${ours.toFixed(1)} ${unit}`, `${(lo * refVal).toFixed(0)}…${(hi * refVal).toFixed(0)} ${unit}`, ok,
    note ? `${note}; эталон ${refVal.toFixed(0)}` : `эталон ${refVal.toFixed(0)}`);
};

// 1. Осевая линия: совпадение по высоте в одной и той же точке %W
{
  let maxd = 0;
  let sum = 0;
  let cnt = 0;
  for (let xp = 23; xp <= 46.5; xp += 0.5) {
    const a = barAt(A, xp);
    const b = barAt(B, xp);
    if (!a || !b) continue;
    const d = Math.abs(a.y - b.y);
    maxd = Math.max(maxd, d);
    sum += d * d;
    cnt++;
  }
  const rms = Math.sqrt(sum / Math.max(1, cnt));
  add('осевая полосы: RMS |Δy|', `${rms.toFixed(2)} %H`, '≤ 0,45 %H', rms <= 0.45);
  add('осевая полосы: max |Δy|', `${maxd.toFixed(2)} %H`, '≤ 0,90 %H', maxd <= 0.9);
}

// 2. Гладкость линии: средняя |2-я разность| по пиксельным столбцам середины плеча
{
  const d2 = [];
  const xStart = Math.round(A.W * 0.33);
  const xEnd = Math.round(A.W * 0.46);
  for (let x = xStart; x <= xEnd; x++) {
    const a = barAt(A, (x / A.W) * 100);
    const b = barAt(A, ((x - 1) / A.W) * 100);
    const c = barAt(A, ((x + 1) / A.W) * 100);
    if (!a || !b || !c) continue;
    d2.push(Math.abs((c.y - 2 * a.y + b.y) / 100) * A.H);
  }
  const m = d2.reduce((a, v) => a + v, 0) / Math.max(1, d2.length);
  const px = m * (1080 / A.H); // в пикселях эталона 1080
  add('гладкость линии: |2Δ|', `${px.toFixed(3)} px`, '≤ 0,12 px', px <= 0.12, 'эталон 0,05–0,08 px');
}

// 3. Профиль полосы: плато и ореол
{
  const p = barProfile(A);
  if (!p) {
    add('профиль полосы', 'полоса не найдена', 'плато 4,5…6,5 px', false);
  } else {
    const pB = barProfile(B);
    add('плато полосы', `${p.plateau.toFixed(1)} px`, '4,5…6,5 px', p.plateau >= 4.5 && p.plateau <= 6.5, 'эталон 5 px');
    addRatio('ореол вокруг полосы', p.halo, pB.halo, 0.55, 1.9, 'L', 'без ореола полоса читается как штрих маркером');
  }
}

// 4. Кромка кузова: цвет и яркость контрового света (y 38…45 %H, левая кромка)
{
  const samples = [];
  for (const yp of [38, 40, 42, 44]) {
    const l = leftEdge(A, yp);
    if (l < 0) continue;
    const lx = (l / 100) * A.W;
    let best = [0, 0, 0];
    for (let d = 12; d >= 2; d--) {
      const c = at(A, lx - d, (yp / 100) * A.H);
      if (c[0] > best[0]) best = c;
    }
    samples.push(best);
  }
  const gr = samples.length ? samples.reduce((a, c) => a + (c[0] > 20 ? c[1] / c[0] : 0), 0) / samples.length : 0;
  const R = samples.length ? samples.reduce((a, c) => a + c[0], 0) / samples.length : 0;
  add('кромка: G/R', gr.toFixed(2), '≤ 0,20', gr <= 0.2, 'эталон 0,12 — кромка красная, не белая');
  add('кромка: R', R.toFixed(0), '95…150', R >= 95 && R <= 150, 'эталон 108–135');
}

// 5. Объём над линией: отблеск на капоте и плечах (y 33…37 %H, внутри силуэта)
{
  const sheen = (im) => {
    const vals = [];
    for (let yp = 33; yp <= 37; yp += 0.5) {
      const y = Math.round((yp / 100) * im.H);
      const l = leftEdge(im, yp);
      if (l < 0) continue;
      for (let xp = l + 3; xp < 100 - l - 3; xp += 1) vals.push(luma(im, (xp / 100) * im.W, y));
    }
    vals.sort((a, b) => a - b);
    return { max: vals[vals.length - 1] ?? 0, p90: vals[Math.floor(vals.length * 0.9)] ?? 0 };
  };
  const sA = sheen(A);
  const sB = sheen(B);
  addRatio('отблеск кузова: max', sA.max, sB.max, 0.55, 1.6, 'L', 'кузов должен ловить свет, а не быть плоским');
  addRatio('отблеск кузова: p90', sA.p90, sB.p90, 0.45, 1.8, 'L');
}

// 6. Купол крыши: ширина силуэта на 2 %H ниже макушки
{
  let topA = 100;
  for (let xp = 30; xp <= 70; xp += 0.5) {
    const t = topAt(A, xp);
    if (t >= 0 && t < topA) topA = t;
  }
  const wA = widthAt(A, topA + 2);
  add('купол крыши: ширина на +2 %H', `${wA.toFixed(1)} %W`, '≤ 45 %W', wA <= 45, 'эталон 33 %W — крыша куполом, не коробкой');
}

// 7. Зеркало: верх и низ
{
  const mA = mirrorBox(A);
  const mB = mirrorBox(B);
  add('зеркало: верх', `${mA.top.toFixed(1)} %H`, `${(mB.top - 1.5).toFixed(1)}…${(mB.top + 1.5).toFixed(1)} %H`, Math.abs(mA.top - mB.top) <= 1.5);
  add('зеркало: низ', `${mA.bottom.toFixed(1)} %H`, `${(mB.bottom - 3).toFixed(1)}…${(mB.bottom + 3).toFixed(1)} %H`, Math.abs(mA.bottom - mB.bottom) <= 3, 'низ зеркала: у нас ножка-«палочка»');
}

// 8. Знак: размер, пропорция и плотность (цели — из эталона того же прогона)
{
  const eA = emblem(A);
  const eB = emblem(B);
  if (!eA || !eB) {
    add('знак', `наш ${eA ? 'есть' : 'нет'} / эталон ${eB ? 'есть' : 'нет'}`, 'оба найдены', false);
  } else {
    add('знак: ширина', `${eA.w.toFixed(2)} %W`, `${(eB.w - 0.35).toFixed(2)}…${(eB.w + 0.35).toFixed(2)} %W`, Math.abs(eA.w - eB.w) <= 0.35, 'не уже эталона');
    add('знак: высота', `${eA.h.toFixed(2)} %H`, `${(eB.h - 0.4).toFixed(2)}…${(eB.h + 0.4).toFixed(2)} %H`, Math.abs(eA.h - eB.h) <= 0.4);
    add('знак: пропорция h/w', eA.aspect.toFixed(3), `${(eB.aspect - 0.08).toFixed(2)}…${(eB.aspect + 0.08).toFixed(2)}`, Math.abs(eA.aspect - eB.aspect) <= 0.08, 'не вытягивать по высоте');
    add('знак: заливка', `${eA.cover.toFixed(0)} %`, '25…36 %', eA.cover <= 36 && eA.cover >= 25, 'эталон 31 % — штрихи не слипаются');
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nкадр:   ${shot}`);
console.log(`эталон: ${ref}`);
console.log(`\n${pad('признак', 30)} ${pad('наш', 16)} ${pad('цель', 22)} итог`);
console.log('-'.repeat(88));
let fails = 0;
for (const r of rows) {
  if (!r.ok) fails++;
  console.log(`${pad(r.name, 30)} ${pad(r.ours, 16)} ${pad(r.target, 22)} ${r.ok ? 'PASS' : 'FAIL'}${r.note ? `   (${r.note})` : ''}`);
}
console.log('-'.repeat(88));
console.log(fails === 0 ? 'ИТОГ: PASS' : `ИТОГ: ${fails} из ${rows.length} FAIL`);
process.exit(fails === 0 ? 0 : 1);
