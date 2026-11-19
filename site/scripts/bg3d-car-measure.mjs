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
 * Переменные:
 *   BG=<кадр без машины>   маска = разница с этим кадром (рекомендуется, см. ниже);
 *   MASK=dark|light        без BG — по яркости: выше/ниже порога;
 *   THRESH=<0..255>        порог яркости для MASK (по умолчанию 26);
 *   DIFF=<0..765>          порог разницы для BG (по умолчанию 12);
 *   KEEP=<0..1>            доля от самой плотной строки/столбца, ниже — свет (0,025);
 *   GAP=<строки>           разрыв, разделяющий силуэт и отражение (6).
 *
 * Кадр без машины снимается CPU-портом: renderFrame({..., car: false}) —
 * та же сцена, тот же туман, тот же пол, только силуэт не рисуется.
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
if (!bgFile) {
  /* Без кадра без машины маска ловит освещение сцены, и все числа ниже — про свет,
     а не про машину. Это ошибка вызова, а не «результат замера». */
  console.error('\nНЕТ BG: маска посчитана по абсолютной яркости и ловит пол, тень и прожекторы.\n'
    + '  Снимите кадр без машины и передайте его через BG=<файл>; маска станет разницей кадров.\n'
    + '  Числа ниже печатаются для отладки палитры, но приёмке не годятся.');
}
const len = x1 - x0 + 1;
const hgt = y1 - y0 + 1;

console.log(`файл: ${file}  (${W}×${H}, маска «${bgFile ? 'diff по ' + bgFile : mode}», порог ${bgFile ? diffThresh : thresh})`);
console.log(`\n1. габарит в кадре: x ${x0}…${x1} (${len} px = ${((len / W) * 100).toFixed(1)} %W), y ${y0}…${y1} (${hgt} px = ${((hgt / H) * 100).toFixed(1)} %H)`);
const hl = hgt / len;
console.log(`2. высота/длина = ${hl.toFixed(3)}  (паспорт 0,335; допуск ±0,010 → ${(hl >= 0.325 && hl <= 0.345) ? 'PASS' : 'FAIL'})`);

/* Верхняя кромка — в долях длины ОТ НОСА и в % высоты кузова ОТ ЗЕМЛИ,
   как таблица задания №57 §2.4. Раньше печаталось «от верха bbox» и без
   ориентации: числа нельзя было сверить с паспортом, и разворот кадра
   (нос справа) принимался за провал на корме.
   Нос — правая сторона кадра: в сцене +X это нос, а экранный X растёт с ним. */
const tops = new Array(len).fill(-1);
for (let i = 0; i < len; i++) {
  const x = x0 + i;
  for (let y = y0; y <= y1; y++) if (isCar(x, y)) { tops[i] = y; break; }
}
/* tops[i]: 0 у правого края кадра = нос, len−1 у левого = корма */
const topAtF = (f) => {
  const i = Math.min(len - 1, Math.max(0, Math.round((1 - f) * (len - 1))));
  return tops[i];
};
const pct = (y) => (y < 0 ? null : ((y1 - y) / hgt) * 100);
const SPEC = [25, 69, 73, 77, 91, 98, 100, 98, 97, 85, 56];
const row = [];
for (let k = 0; k <= 10; k++) {
  const v = pct(topAtF(k / 10));
  row.push(`${(k / 10).toFixed(1)}:${v === null ? '—' : v.toFixed(0)}`);
}
console.log(`\n3. верхняя кромка от носа (% высоты кузова): ${row.join(' ')}`);
console.log(`   паспорт (§2.4):            0.0:25 0.1:69 0.2:73 0.3:77 0.4:91 0.5:98 0.6:100 0.7:98 0.8:97 0.9:85 1.0:56`);
{
  /* Ступеньки считаются на участке 0,10…0,90 длины. Нос и корма (0…0,10 и
     0,90…1,0) — это торцевые поверхности бампера и двери багажника: там кромка
     падает к 25 и 56 %H вертикально по паспорту, и «ступенька» там не дефект,
     а сам силуэт. Именно так записан провал в задании: 25 %H на 0,65 длины —
     это середина крыши, а не торец. */
  /* Ступенька меряется СВЕРХ паспортной: паспортная таблица сама требует 3,5 %H
     на 2,5 %L на скате лобового (0,30:77 → 0,40:91), поэтому «не больше 1,5 %H»,
     прочитанное буквально, противоречит собственному паспорту. Смысл допуска —
     «нет разрывов, которых не требует профиль», и он и проверяется: разность
     между фактической ступенькой и паспортной не больше 1,5 %H. */
  const specAt = (f) => {
    const u = Math.min(1, Math.max(0, f)) * 10;
    const k = Math.min(9, Math.floor(u));
    return SPEC[k] + (SPEC[k + 1] - SPEC[k]) * (u - k);
  };
  let worst = 0;
  let at = 0;
  let raw = 0;
  for (let k = 4; k <= 35; k++) {
    const a = pct(topAtF(k / 40));
    const b = pct(topAtF((k + 1) / 40));
    if (a === null || b === null) continue;
    const step = Math.abs(b - a);
    const want = Math.abs(specAt((k + 1) / 40) - specAt(k / 40));
    if (step > raw) raw = step;
    const excess = Math.max(0, step - want);
    if (excess > worst) { worst = excess; at = (k + 1) / 40; }
  }
  console.log(`   макс. ступенька на 2,5 %L (0,10…0,90 длины): ${raw.toFixed(1)} %H,`
    + ` сверх паспортной ${worst.toFixed(1)} %H при доле ${at.toFixed(3)}`
    + ` (допуск 1,5 %H → ${worst <= 1.5 ? 'PASS' : 'FAIL'})`);
}

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

  /* Привязка к ОСЯМ, а не к пятнам (задание №60, шаг 3.4).
     Прежняя версия печатала каждое тёмное пятно на линии оси как «колесо»:
     на CPU-кадре их набиралось четыре (бампер, тень, две арки), и каждое
     объявлялось колесом. Теперь окна берутся там, где оси стоят по паспорту:
     передняя 19,8 %L, задняя 80,1 %L от носа, и в каждом окне (±8 %L)
     измеряется ширина тёмного прогона. Пятна вне окон — не колёса. */
  const AXLE_F = 19.8, AXLE_R = 80.1, WIN = 8;
  const wheels = [];
  for (const [label, c] of [['переднее', AXLE_F], ['заднее', AXLE_R]]) {
    const r = runs.find(([a, b]) => {
      const mid = ((a + b) / 2 / len) * 100;
      return Math.abs(mid - c) <= WIN;
    });
    if (!r) { wheels.push({ label, ok: false, w: null }); continue; }
    const w = ((r[1] - r[0] + 1) / len) * 100;
    const ok = Math.abs(w - 15.0) <= 1.0;
    wheels.push({ label, ok, w, from: (r[0] / len) * 100, to: (r[1] / len) * 100 });
  }
  for (const wh of wheels) {
    if (wh.w === null) {
      console.log(`   ${wh.label}: окно оси ${wh.label === 'переднее' ? AXLE_F : AXLE_R} %L — колесо не читается (FAIL)`);
    } else {
      console.log(`   ${wh.label} (ось ${wh.label === 'переднее' ? AXLE_F : AXLE_R} %L): прогон ${wh.from.toFixed(0)}…${wh.to.toFixed(0)} %L,`
        + ` ширина ${wh.w.toFixed(1)} %L (паспорт 15,0 ±1,0 → ${wh.ok ? 'PASS' : 'FAIL'})`);
    }
  }
  const outside = runs.filter(([a, b]) => {
    const mid = ((a + b) / 2 / len) * 100;
    return Math.abs(mid - AXLE_F) > WIN && Math.abs(mid - AXLE_R) > WIN;
  });
  if (outside.length) {
    console.log(`   вне окон осей тёмных пятен: ${outside.length} (бампер/тень/арки — за колёса не считаются)`);
  }
  const same = wheels.every((wh) => wh.w !== null)
    && Math.abs(wheels[0].w - wheels[1].w) <= 0.5;
  if (wheels.every((wh) => wh.w !== null)) {
    console.log(`   переднее и заднее: ${wheels[0].w.toFixed(1)} и ${wheels[1].w.toFixed(1)} %L → ${same ? 'одинаковые (PASS)' : 'РАЗНЫЕ (FAIL: арка перекрывает шину или колёса разного размера)'}`);
  }
}

/* Клиренс — числом (задание №60, §5.2).
   Меряется по ТОНУ КУЗОВА, а не по маске: маска «разница с кадром без машины»
   включает контактную тень, и её низ уходит ниже шины — по маске клиренс
   получался −4,9 %L, то есть «отрицательный». Кузов светлый (55–70 L), пол под
   ним 20–24 L, поэтому низ кузова — последняя строка, где у середины кузова
   яркость выше 1,8 тона пола; земля — низ шины на оси переднего колеса. */
{
  const xMid = Math.round((x0 + x1) / 2);
  const floorL = lum(xMid, Math.min(H - 1, y1 + 6));
  const thr = Math.max(floorL * 1.8, floorL + 14);
  let bodyBottom = -1;
  for (let y = y0; y <= Math.min(H - 1, y1 + 12); y++) if (lum(xMid, y) > thr) bodyBottom = y;
  const xAxle = Math.round(x0 + len * 0.198);
  let tyreBottom = -1;
  for (let y = y0; y <= Math.min(H - 1, y1 + 12); y++) if (isCar(xAxle, y)) tyreBottom = y;
  const clearPx = tyreBottom - bodyBottom;
  const clearPctL = (clearPx / len) * 100;
  const okC = Math.abs(clearPctL - 3.7) <= 0.8;
  console.log(`\n6. клиренс: порог ${bodyBottom}, земля ${tyreBottom} → ${clearPx} px = ${clearPctL.toFixed(1)} %L`
    + ` (паспорт 3,7 %L = 0,18 м → ${okC ? 'PASS' : 'FAIL'})`);
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
