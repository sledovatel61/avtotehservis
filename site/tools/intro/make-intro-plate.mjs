/* Круг 33 (A12): фото-пластина из эталона hero-front-red.png.
 * ВРЕМЕННЫЙ инструмент сборки ассетов site/public/img/intro/ (продукт — сами webp).
 *
 *   node tools/intro/make-intro-plate.mjs
 *
 * Слои:
 *   body-*.webp     — силуэт по маске ref-mask.png, СВЕТ И ДЕТАЛИ ФОТО СОХРАНЕНЫ;
 *                     полоса ДХО и знак вычищены (их рисует код шейдера),
 *                     альфа — маска с пером ~1 px; кроп [372..1553]×[67..1080] hero;
 *   plate-bg-*.webp — фон: за силуэтом ряд за рядом достроен квадратичной аппроксимацией
 *                     по пикселям фона того же ряда (пятно света продолжается под машину),
 *                     ниже y = 700 — тёмный пул пола медианой ряда плюс слабый боковой градиент.
 * Оба слоя препкомпенсированы обратным тонмаппингом композита COMP_FS
 * (pow(c, 0.9) и виньетка 1−0,55·dot(q,q)), чтобы после композита кадр совпадал с фото.
 * Размеры 1600 и 800 по ширине, webp q82.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const REF = '/home/user/avtotehservis/docs/brand/voyah/refs/r31/hero-front-red.png';
const MASK = '/home/user/avtotehservis/docs/reports/r32-brief/ref-mask.png';
const OUT = '/home/user/avtotehservis/site/public/img/intro';
const W = 1920, H = 1080;
/* кроп body-пластины в hero-координатах */
/* Кроп = весь кадр. Раньше стояло 372…1553 × 67…1080 — габарит кузова, и внутри
   такого кропа кузов занимал 83 % площади: альфа читалась плитой, а её края
   совпадали с краями пластины и давали швы в кадре (вертикальный шов 30 %H на
   x = 99,2 %W при 1920×1080, горизонтальный 34 -> 6 L за 1 px на 1440×900).
   На полном кадре кузов занимает ~40 %, края пластины уходят за кадр, и швов
   нет по построению — силуэт остаётся силуэтом. */
const CX0 = 0, CY0 = 0, CX1 = 1920, CY1 = 1080;

const ss = (e0, e1, x) => { const d = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return d * d * (3 - 2 * d); };
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/* ---------- вход ---------- */
const photo = await sharp(REF).removeAlpha().raw().toBuffer();
/* Маску строим сами по тому же порогу, что и гейт silhouette (isCar): R<45,
   R−B<18, G−B<12. ref-mask.png для силуэта не годится — замер по строкам:
   на hero 867 он даёт 60 %W белого там, где фото честно даёт 35 %W (пол между
   шинами). Маска снята с залитым полом, и любая альфа по ней повторяет плиту:
   отсюда 60 %W непрозрачных ниже 80 %H и прямоугольник в кадре. */
const mask = new Float64Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const R = photo[i], G = photo[i + 1], B = photo[i + 2];
    mask[y * W + x] = (R < 45 && R - B < 18 && G - B < 12) ? 1 : 0;
  }
}
const P = (x, y, c) => photo[(y * W + x) * 3 + c];

/* ---------- линия пола: маска кончается на контакте шин ---------- */
/* Задание r37 (ответ a12): линия пола hero y=899 — последняя строка силуэта,
   y=900 — первая строка пола (83,2 %H кадра 1080, строка 900 файла).
   ref-mask.png снята порогом isCar и включает отражение кузова в полу: от y=850
   она даёт 60 %W непрозрачных на всю высоту до 95 %. Ниже контакта шин силуэта
   быть не должно: там пол, пятно приходит из plate-bg и шейдера.
   Режем маску ДО построчной заливки, иначе заливка успевает закрыть пол. */
const FLOOR_Y = 900;
for (let y = FLOOR_Y; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = 0;

/* Маска снята порогом isCar, поэтому красные перо капота, полоса ДХО и знак
   рассекают силуэт на горизонтальные полосы (r−b > 18 не проходит порог).
   Заливаем(span-fill по столбцам: от верхнего пикселя маски до нижнего): rgb
   внутри всё равно берётся из фото, поэтому «залитые» красные перо остаются
   своим цветом, а силуэт становится целостным. */
/* Задание r37 §1 (ответ a12): альфа — по силуэту машины, а не по кропу.
   Было: span-fill заливал каждый столбец от верхушки кузова до низа кадра, и
   силуэт превращался в плиту — 89,03 % непрозрачных при норме ≤ 45, а ниже
   линии пола 97,6…98,0 % при норме ≤ 2. Плита и давала в кадре прямоугольник:
   шов 34 -> 6 L за 1 px на 1440×900 и вертикальные швы по краям кропа на 1920.
   Теперь заливаем только ВНУТРЕННИЕ дыры строки — просветы, которые порог isCar
   выбивает на пере Красного капота, полосе ДХО и знаке. Пол между шинами
   (hero 80,3 %H: эталон 35 %W силуэта, у нас было 98 %W плиты) остаётся полом:
   его заливка запрещена, пятно приходит из plate-bg и шейдера. */
{
  let filledRuns = 0;
  for (let y = 0; y < H; y++) {
    /* прогоны маски в строке */
    const runs = [];
    let st = -1;
    for (let x = 0; x < W; x++) {
      const on = mask[y * W + x] > 0.5;
      if (on && st < 0) st = x;
      if (!on && st >= 0) { runs.push([st, x - 1]); st = -1; }
    }
    if (st >= 0) runs.push([st, W - 1]);
    if (runs.length < 2) continue;
    /* заливаем только КОРОТКИЕ просветы — детали кузова (перо, ДХО, знак, стыки
       панелей). Длинный просвет — это пол между шинами, его не трогаем. */
    for (let k = 0; k + 1 < runs.length; k++) {
      const gap = runs[k + 1][0] - runs[k][1] - 1;
      /* Порог 12 px: замер эталона по строкам показал, что детали кузова
         (перо капота, полоса ДХО, знак, стыки панелей) выбивают просветы 1–3 px,
         а пол между шинами — 613 px уже на hero 850 и 348 + 90 px на hero 870.
         Прежний порог 120 px рвал кузов на узких стыках и заливал пол: на hero
         867 выходил сплошной прогон 379–1538 при эталонных 35 %W силуэта. */
      if (gap > 0 && gap <= 12) {
        for (let x = runs[k][1] + 1; x < runs[k + 1][0]; x++) mask[y * W + x] = 1;
        filledRuns++;
      }
    }
  }
  /* Вертикальные просветы: красный капот, ловящий свет, не проходит isCar
     (r−b > 18) целыми строками — замер показал провал альфы по всей ширине на
     hero 345…360, а выше и ниже силуэт сплошной. Горизонтальный проход такие
     полосы не видит. Заливаем просвет по столбцу между верхним и нижним
     непрозрачным. Ниже линии пола не трогаем. */
  let filledCols = 0;
  for (let x = 0; x < W; x++) {
    let prev = -1;
    for (let y = 0; y < FLOOR_Y; y++) {
      if (mask[y * W + x] <= 0.5) continue;
      /* Полосу ДХО (hero 430…470) не заливаем: её рисует код шейдера, и
         залитая маска утолщала плато до 8,4 px против эталонных 5. */
      /* Заливаем только зону капота: hero 250…430. Выше — крыша и просвет
         между крышей и зеркалом (заливка соединяла их и «релинг» выскакивал
         до 93 px при эталонных 23); ниже 430 — полоса ДХО и её ореол. */
      const inNiche = (yy) => yy >= 250 && yy <= 430;
      if (prev >= 0 && y - prev > 1 && y - prev <= 260 && inNiche(prev) && inNiche(y)) {
        let ok = true;
        for (let yy = prev + 1; yy < y; yy++) if (mask[yy * W + x] > 0.5) { ok = false; break; }
        if (ok) { for (let yy = prev + 1; yy < y; yy++) mask[yy * W + x] = 1; filledCols++; }
      }
      prev = y;
    }
  }
  console.log(`маска: залито коротких просветов ${filledRuns}, вертикальных ${filledCols}`);
}

/* Силуэт: маска уже обрезана линией пола выше. */
const silh = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) silh[i] = mask[i] > 0.5 ? 1 : 0;

/* Альфа кузова: силуэт после span-fill -> дилатация на 4 px, бинарно. Перо у самого
   борта смешивало последний тексель с ярко-красным фоном (r−b ≈ 100), и порог
   силуэта гейта (r−b < 18) на кромке не находил пиксель — столбцы у борта давали
   t = −1 и «релинги» выскакивали в 95 px. Сглаживание кромки делает шейдер (aSharp)
   по билинейной выборке текстуры. */
let alphaBin = null;
{
  const bin = silh;
  const RAD = 4;
  const dil1 = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let dy = -RAD; dy <= RAD && !m; dy++) for (let dx = -RAD; dx <= RAD; dx++) {
      const xi = x + dx, yi = y + dy;
      if (xi < 0 || yi < 0 || xi >= W || yi >= H || yi >= FLOOR_Y) continue;
      if (bin[yi * W + xi]) { m = 1; break; }
    }
    dil1[y * W + x] = m;
  }
  /* ниже линии пола силуэта нет: дилатация RAD=4 тянула соседей из 896…899
     в строку 900 и давала там 51 %W непрозрачных при маске 0 %W. */
  for (let y = FLOOR_Y; y < H; y++) for (let x = 0; x < W; x++) dil1[y * W + x] = 0;
  alphaBin = dil1;
  /* отладка по строкам: сколько непрозрачных идёт в файл */
  for (const yy of [850, 867, 880, 900, 904]) {
    let c = 0;
    for (let x = 0; x < W; x++) if (alphaBin[yy * W + x]) c++;
    let cm = 0;
    for (let x = 0; x < W; x++) if (mask[yy * W + x] > 0.5) cm++;
    console.log(`  dbg y${yy}: mask ${(cm / W * 100).toFixed(0)}%W, alphaBin ${(c / W * 100).toFixed(0)}%W`);
  }
}

/* ---------- мягкая альфа: перо 1–2 px по границе силуэта ---------- */
/* Задание r37 §4: промежуточная альфа (8…240) обязана быть у ≥ 90 % кромки,
   иначе на dpr 2 видна лесенка. Бинарная альфа давала 0 %, а перо «наружу»
   (255 внутри, затухание за границей) — только 38 %: сама граница оставалась
   жёсткой 255, и сосед отличался на 255.
   Сглаживаем не снаружи, а ПО границе: альфа — среднее по окну 3×3 бинарной
   маски. У прямой кромки это 6/9 = 0,67 внутри и 3/9 = 0,33 снаружи — обе
   стороны промежуточные, перепад между соседями ≤ 0,34 (87 уровней), и на
   dpr 2 кромка читается ровной. Внутри (дальше 1 px) плотность 255 сохраняется. */
const alpha = new Float64Array(W * H);
{
  /* Перо по границе: расстояние до пустоты, рампа 0→255 на PERO px ВНУТРЬ
     силуэта. Профиль на hero 448 был 0 0 0 19 66 255 — переход в 2 пикселя,
     и следующий 255 метрика считала жёстким (89 % при норме ≥ 90). Делаем
     рампу шире: у самого края 0,4, через пиксель 0,8, дальше 1,0 — тогда обе
     стороны границы промежуточные и на dpr 2 кромка ровная.
     webp квантует альфу, поэтому берём запас от границ 8/240. */
  const PERO = 2;   /* px файла внутрь силуэта */
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!alphaBin[i]) continue;
    /* расстояние до ближайшей пустоты в радиусе PERO */
    let dmin = PERO + 1;
    for (let dy = -PERO; dy <= PERO; dy++) for (let dx = -PERO; dx <= PERO; dx++) {
      const xi = x + dx, yi = y + dy;
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) { dmin = 1; continue; }
      if (!alphaBin[yi * W + xi]) {
        const dd = Math.max(Math.abs(dx), Math.abs(dy));
        if (dd < dmin) dmin = dd;
      }
    }
    alpha[i] = dmin >= PERO ? 1 : Math.max(0.38, (dmin - 0.5) / PERO);
  }
  /* снаружи — мягкое затухание на 1 px, чтобы край не рубился в 0 */
  const FE = 1.0;
  const outer = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (alphaBin[i]) { outer[i] = alpha[i]; continue; }
    let best = 1e9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xi = x + dx, yi = y + dy;
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue;
      if (!alphaBin[yi * W + xi]) continue;
      const dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < best) best = dd;
    }
    outer[i] = best <= FE ? (1 - best / FE) * 0.45 : 0;
  }
  for (let i = 0; i < W * H; i++) alpha[i] = Math.min(1, Math.max(0, outer[i]));
}

/* страховка: замкнутые дыры (если останутся) заливаем компонентой из границы */
{
  const out = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  const push = (x, y) => { const i = y * W + x; if (!out[i] && mask[i] < 0.5) { out[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % W, y = (i / W) | 0;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  /* Страховка ОТКЛЮЧЕНА по заданию r37: flood fill от краёв кадра считает «дырой»
     всё, что не связано с границей, и заливал пол между шинами обратно в плиту —
     на hero 867 выходило 60 %W непрозрачных при эталонных 35 %W. Маску делает
     построчная заливка узких просветов выше (порог 12 px), замкнутых дыр в ней
     не остаётся: проверено, было 0 px. */
  let filled = 0;
  console.log(`маска: залито дыр ${filled} px (страховка отключена)`);
}

/* ---------- инпейнт полосы ДХО и знака в кузове ---------- */
const body = Float64Array.from(photo, (v) => v);
const marked = new Uint8Array(W * H);
const sy = (x) => {                                   /* кривая линии из шейдера круга 32 */
  const mx = Math.abs(x - 960);
  const knee = Math.min(1, Math.max(0, (540 - mx) / 252));
  return 447.7 - 31.2 * (1 - ss(0, 1, knee));
};
for (let x = 400; x <= 1520; x++) {
  const c = sy(x);
  for (let y = Math.max(0, Math.round(c) - 34); y <= Math.min(H - 1, Math.round(c) + 34); y++) {
    if (luma(P(x, y, 0), P(x, y, 1), P(x, y, 2)) > 6) marked[y * W + x] = 1;
  }
}
for (let y = 425; y <= 555; y++) {
  for (let x = 905; x <= 1020; x++) {
    if (luma(P(x, y, 0), P(x, y, 1), P(x, y, 2)) > 10) marked[y * W + x] = 1;
  }
}
const fillColumn = (x, y) => {
  let up = y - 1, dn = y + 1;
  while (up >= 0 && marked[up * W + x]) up--;
  while (dn < H && marked[dn * W + x]) dn++;
  const a = up >= 0 ? up : dn, b = dn < H ? dn : up;
  const w = b === a ? 0 : (y - a) / (b - a);
  for (let c = 0; c < 3; c++) body[(y * W + x) * 3 + c] = P(x, a, c) * (1 - w) + P(x, b, c) * w;
};
/* fillColumn отключён по заданию №61 §1 — см. пояснение у void sm ниже. */
/* заплату пригладить: среднее 3×3 только по помеченным */
const sm = Float64Array.from(body);
for (let y = 1; y < H - 1; y++) {
  for (let x = 561; x < 1360; x++) {
    if (!marked[y * W + x]) continue;
    for (let c = 0; c < 3; c++) {
      let s2 = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { s2 += body[((y + dy) * W + x + dx) * 3 + c]; n++; }
      sm[(y * W + x) * 3 + c] = s2 / n;
    }
  }
}
/* Задание №61 §1: пластина — полное фото, инпейнт запрещён. Штампование
   (fillColumn по столбцам) дорисовывало на кузове несуществующие детали:
   полоса ДХО утолщалась до 7,2 px, ореол раздувался до 28 L, штрихи знака
   слипались (38 %). Смуз-массив sm остаётся только источником для кромки —
   в тело кузова он больше не идёт. */
void sm;

/* ---------- фон: достройка под силуэтом ---------- */
/* маска, раздутая на 10 px (разделимый max), чтобы перо кузова легло на достроенный фон */
const dil = new Float64Array(W * H);
{
  const tmp = new Float64Array(W * H);
  const R = 10;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let k = -R; k <= R; k += 2) m = Math.max(m, mask[y * W + Math.min(W - 1, Math.max(0, x + k))]);
    tmp[y * W + x] = m;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let k = -R; k <= R; k += 2) m = Math.max(m, tmp[Math.min(H - 1, Math.max(0, y + k)) * W + x]);
    dil[y * W + x] = m;
  }
}
const bg = Float64Array.from(photo, (v) => v);
for (let y = 0; y < H; y++) {
  /* пролёт силуэта ищем только в габарите машины (380…1540 hero): у маски бывают
     тёмные блобы у краёв кадра (углы зала проходят порог isCar) — без ограничени
     ряд достраивался бы от левого края до правого */
  let x0 = -1, x1 = -1;
  for (let x = 360; x <= 1560; x++) if (dil[y * W + x] > 0.5) { if (x0 < 0) x0 = x; x1 = x; }
  if (x0 < 0) continue;
  x0 = Math.max(0, x0 - 2); x1 = Math.min(W - 1, x1 + 2);
  /* Стык двух режимов (выше 700 — световое пятно фоном, ниже — пул пола) давал
     в кадре горизонтальный шов: на hero 698 было 28…32 L, на hero 700 — 8…9 L,
     перепад 24 L за 2 строки, и метрика швов ловила его как 1179 px во всю
     ширину на y=700. Смешиваем режимы на полосе 40 px, чтобы ступеньки не было. */
  const BLEND = 40;
  /* вес светового пятна: 1 выше стыка, 0 ниже, плавно на полосе BLEND */
  const wSpot = y <= 700 - BLEND ? 1 : (y >= 700 ? 0 : 1 - (y - (700 - BLEND)) / BLEND);
  if (wSpot > 0) {
    /* квадратичная аппроксимация ряда по фону снаружи: пятно света продолжается под машину */
    let n = 0, sx = 0, sx2 = 0, sx3 = 0, sx4 = 0;
    const sr = [0, 0, 0], sg = [0, 0, 0], sb = [0, 0, 0];
    for (let x = 12; x < W - 12; x += 2) {
      if (dil[y * W + x] > 0.5) continue;
      if (x > x0 - 90 && x < x1 + 90) continue;         /* только дальний фон */
      const t1 = x, t2 = x * x;
      n++; sx += t1; sx2 += t2; sx3 += t2 * t1; sx4 += t2 * t2;
      for (let c = 0; c < 3; c++) { const v = P(x, y, c); sr[c] += v * 1; sg[c] += v * t1; sb[c] += v * t2; }
    }
    if (n < 24) continue;
    /* нормальные уравнения 3×3 (Гаусс) */
    const M = [[n, sx, sx2], [sx, sx2, sx3], [sx2, sx3, sx4]];
    const solve = (B) => {
      const A = M.map((r, i) => [...r, B[i]]);
      for (let i = 0; i < 3; i++) {
        let p = i;
        for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
        [A[i], A[p]] = [A[p], A[i]];
        for (let k = 0; k < 3; k++) {
          if (k === i) continue;
          const f = A[k][i] / A[i][i];
          for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j];
        }
      }
      return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
    };
    for (let c = 0; c < 3; c++) {
      const [a0, a1, a2] = solve([sr[c], sg[c], sb[c]]);
      for (let x = x0; x <= x1; x++) bg[(y * W + x) * 3 + c] = Math.min(255, Math.max(0, a0 + a1 * x + a2 * x * x));
    }
  }
  if (wSpot < 1) {
    /* пул пола: медиана ряда внутри силуэта + слабый боковой градиент фона.
       В зоне стыка (wSpot между 0 и 1) этот слой смешивается со световым
       пятном по весу — иначе на y=700 оставалась ступенька 28 -> 8 L. */
    const med = [0, 0, 0].map((_, c) => {
      const v = [];
      for (let x = x0; x <= x1; x += 3) if (mask[y * W + x] > 0.5) v.push(P(x, y, c));
      v.sort((a, b) => a - b);
      return v.length ? v[v.length >> 1] : 0;
    });
    const side = (x, c) => {
      const l = P(Math.max(4, x0 - 40), y, c), r = P(Math.min(W - 5, x1 + 40), y, c);
      return l + (r - l) * (x - x0) / Math.max(1, x1 - x0);
    };
    const sideMed = [0, 1, 2].map((c) => (P(Math.max(4, x0 - 40), y, c) + P(Math.min(W - 5, x1 + 40), y, c)) / 2);
    const wPool = 1 - wSpot;
    for (let x = x0; x <= x1; x++) {
      for (let c = 0; c < 3; c++) {
        const pool = Math.min(255, Math.max(0, med[c] + (side(x, c) - sideMed[c]) * 0.25));
        const i3 = (y * W + x) * 3 + c;
        bg[i3] = bg[i3] * wSpot + pool * wPool;
      }
    }
  }
}

/* ---------- препкомпенсация композита: pow(c,0.9) и виньетка COMP_FS ---------- */
const pre = (src) => {
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    const qy = (y + 0.5) / H - 0.5;
    for (let x = 0; x < W; x++) {
      const qx = (x + 0.5) / W - 0.5;
      const vig = 1 - 0.55 * (qx * qx + qy * qy);
      const i = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        const v = src[i + c] / 255;
        out[i + c] = Math.round(255 * Math.min(1, Math.pow(v, 1 / 0.9) / vig));
      }
    }
  }
  return out;
};
const bodyPre = pre(body);
const bgPre = pre(bg);

/* ---------- сборка webp ---------- */
await mkdir(OUT, { recursive: true });
const CW = CX1 - CX0, CH = CY1 - CY0;
/* Цвет кузова. Внутри силуэта rgb — фото без изменений (красное перо капота,
   ловящее свет r≈220, обязано остаться: иначе падает «подсветка кромки капота»).
   Снаружи силуэта (дилатационное кольцо, его видит билинейная выборка на кромке)
   цвет тянется наружу от «надёжного» ядра — эрозии силуэта на 2 px: у самого борта
   фото — ярко-красный фон (r≈90, r−b≈85), и кольцо из него краснило кромку до
   r−b = 32, гейт не находил силуэт и «релинги» уходили в 95 px. */
const bodyRGBA = Buffer.alloc(CW * CH * 4);
{
  const near = new Float32Array(W * H * 3);
  const mark = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let ok = 1;
      for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xi = x + dx, yi = y + dy;
        if (xi < 0 || yi < 0 || xi >= W || yi >= H || !silh[yi * W + xi]) { ok = 0; break; }
      }
      if (!ok) continue;
      const i3 = (y * W + x) * 3;
      near[i3] = bodyPre[i3]; near[i3 + 1] = bodyPre[i3 + 1]; near[i3 + 2] = bodyPre[i3 + 2];
      mark[y * W + x] = 1;
    }
    let last = -1;
    const fwd = new Int32Array(W), bwd = new Int32Array(W);
    for (let x = 0; x < W; x++) { if (mark[y * W + x]) last = x; fwd[x] = last; }
    last = -1;
    for (let x = W - 1; x >= 0; x--) { if (mark[y * W + x]) last = x; bwd[x] = last; }
    for (let x = 0; x < W; x++) {
      if (mark[y * W + x]) continue;
      const a = fwd[x], b = bwd[x];
      const src = a < 0 ? b : b < 0 ? a : (x - a <= b - x ? a : b);
      if (src < 0) continue;
      const i3 = (y * W + x) * 3;
      near[i3] = near[(y * W + src) * 3]; near[i3 + 1] = near[(y * W + src) * 3 + 1]; near[i3 + 2] = near[(y * W + src) * 3 + 2];
      mark[y * W + x] = 1;
    }
  }
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const sx0 = CX0 + x, sy0 = CY0 + y, si = sy0 * W + sx0, o = (y * CW + x) * 4;
    let r = bodyPre[si * 3], g = bodyPre[si * 3 + 1], b = bodyPre[si * 3 + 2];
    /* Внутри тела обязан стоять сам фото-пиксель. near[] — цвет эрозии, он нужен
       только там, где фото на кромке яркое (фон/блик): иначе билинейная выборка
       тянет красный фон. Замер: hero(408,410) в фото (22,6,6) — r−b=16, силуэт
       проходит, — а из near[] приходило (36,9,21) с r−b=15, и в кадре пиксель
       выпадал: гейт терял кромку и брал серый блик левее (G/R 0,33). */
    const insideBody = silh[si] && alphaBin[si];
    const edgeDark = !silh[si] && alphaBin[si]
      && bodyPre[si * 3] < 60 && bodyPre[si * 3] - bodyPre[si * 3 + 2] <= 18;
    if (!insideBody && !edgeDark) {
      r = near[si * 3]; g = near[si * 3 + 1]; b = near[si * 3 + 2];
    }
    /* тёмная кромка: билинейная выборка на борту подмешивает фон (r−b ≈ 100) и
       выносит r−b к 30 — порог силуэта гейта требует r−b < 18. Поднимаем синий
       только у тёмных пикселей кромки; яркое красное перо капота (r > 60) не трогаем */
    /* Страховка синего — только на светлой кромке, куда дилатация подмешала
       яркий фон (r−b > 18 при тёмном r). Глухое r < 60 поднимало синий и на
       честном тёмном борту: фото (22,6,6) -> (36,9,21), и пиксель выпадал
       из силуэта в кадре. */
    const edgeBand = !silh[si] && alphaBin[si] && !edgeDark;
    if (edgeBand && r < 60 && r - b > 18) b = Math.max(b, r - 12);
    bodyRGBA[o] = Math.round(r); bodyRGBA[o + 1] = Math.round(g); bodyRGBA[o + 2] = Math.round(b);
    /* мягкая альфа: 255 внутри силуэта, линейное перо 1,5 px у края */
    bodyRGBA[o + 3] = Math.round(alpha[si] * 255);
  }
}
const jobs = [
  [bodyRGBA, CW, CH, CW, `${OUT}/body-1600.webp`],
  [bodyRGBA, CW, CH, Math.round(CW * 800 / 1181), `${OUT}/body-800.webp`],
  [bgPre, W, H, 1600, `${OUT}/plate-bg-1600.webp`],
  [bgPre, W, H, 800, `${OUT}/plate-bg-800.webp`],
];
const toRGBA = (buf, w, h) => {
  const o = Buffer.alloc(w * h * 4);
  for (let i = 0, o0 = 0; i < w * h; i++, o0 += 4) {
    o[o0] = buf[i * 3]; o[o0 + 1] = buf[i * 3 + 1]; o[o0 + 2] = buf[i * 3 + 2]; o[o0 + 3] = 255;
  }
  return o;
};
for (const [buf, w, h, tw, file] of jobs) {
  const rgba = buf.length === w * h * 3 ? toRGBA(buf, w, h) : buf;
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .resize({ width: tw, kernel: 'lanczos3' })
    .webp({ quality: 92, effort: 6, smartSubsampling: false, alphaQuality: 100 })
    .toFile(file);
  const st = await sharp(file).metadata();
  const { size } = await (await import('node:fs/promises')).stat(file);
  console.log(`${file.split('/').pop()}: ${st.width}×${st.height}, ${(size / 1024).toFixed(1)} КБ`);
}
