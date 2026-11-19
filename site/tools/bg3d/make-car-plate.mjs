/**
 * Круг 35 (задание №62): фото-пластина машины.
 *
 *   node tools/bg3d/make-car-plate.mjs
 *
 * Вход:
 *   docs/brand/voyah/refs/r31/side-black.webp — чистый профиль, нос ВПРАВО, тот же ракурс,
 *     что у сцены. Внутри альфы — ПОЛНЫЙ кадр этого фото: свет на краске, блики, стёкла,
 *     диски, шины. Ничего не дорисовывается.
 *   Профиль верхней кромки — MANUAL_TOP из scripts/bg3d-side-ruler.mjs (74 точки, снятые
 *     вручную по краске на side-white-1456.jpg). Читается ИЗ ИСХОДНИКА, а не копируется:
 *     иначе пластина и линейка со временем разойдутся.
 *
 * Почему маска не снимается порогом яркости. На side-black кузов чёрный, но КАПОТ и
 * лобовое — зеркальные: они отражают светлую витрину и по яркости равны фону (120–180 L
 * против 0–60 L у двери). Порог даёт силуэт без передатка и с «провалом» стекла; заливка
 * по столбцу съедает витрину. Поэтому верхняя кромка берётся из трассированного профиля
 * (это измерение фото, а не геометрия из кода), низ — линия земли под колёсами (689 px,
 * снята с самого фото), а цвет внутри — из side-black.
 *
 * Выход: site/public/img/bg3d/car-1600.webp и car-800.webp (RGBA, мипмапы делает браузер).
 */
import sharp from 'sharp';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../..');
const ROOT = resolve(SITE, '..');
const SRC = `${ROOT}/docs/brand/voyah/refs/r31/side-black.webp`;
const OUT = `${SITE}/public/img/bg3d`;
const REP = `${ROOT}/docs/reports/r35-bg-car`;

const FEATHER = Number(process.env.FEATHER ?? 0.55);
const PAD = Number(process.env.PAD ?? 8);

/* ---------- профиль: единственный источник — линейка ---------- */
const rulerSrc = await readFile(`${SITE}/scripts/bg3d-side-ruler.mjs`, 'utf8');
const mt = rulerSrc.match(/const MANUAL_TOP = \[([\s\S]*?)\n\];/);
if (!mt) throw new Error('не нашёл MANUAL_TOP в scripts/bg3d-side-ruler.mjs — профиль переписан, пластину собрать нельзя');
const MANUAL_TOP = [...mt[1].matchAll(/\[(-?[\d.]+),\s*(-?[\d.]+)\]/g)].map((m) => [+m[1], +m[2]]);
const cal = (k) => {
  const m = rulerSrc.match(new RegExp(`${k}:\\s*(-?[\\d.]+)`));
  if (!m) throw new Error(`не нашёл ${k} в PHOTO_CAL линейки`);
  return Number(m[1]);
};
const PCAL = { noseX: cal('noseX'), tailX: cal('tailX'), groundY: cal('groundY'), topY: cal('topY') };
console.log(`профиль линейки: ${MANUAL_TOP.length} точек, калибровка ${JSON.stringify(PCAL)}`);

/* ---------- фото ---------- */
const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const L = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) L[i] = 0.2126 * data[i * C] + 0.7152 * data[i * C + 1] + 0.0722 * data[i * C + 2];

/* габарит side-black снимаем с самого фото: земля — строка, где тёмная шина ниже
   всего; нос и корма — крайние столбцы, где у земли есть тёмная шина/бампер. */
/* ROI по x: слева в кадре припаркована другая машина (тоже тёмная), справа — стойка
   витрины; без ограничения «крайний тёмный столбец» уезжает на край кадра. Границы
   сняты с кадра по сетке (tmp-grid.png в отчёте §2). */
/* Правый край ROI — 1148: настоящий нос кузова кончается здесь, а дальше в кадре
   начинается стойка витрины, тёмная и проходящая порог яркости (на первой сборке она
   приросла к бамперу отдельным блоком). */const RX0 = 40, RX1 = 1148;
const dark = (x, y) => L[y * W + x] < 60;
let groundY = 0;
for (let y = H - 1; y >= 500; y--) {
  let n = 0;
  for (let x = RX0; x <= RX1; x++) if (dark(x, y)) n++;
  if (n > 40) { groundY = y; break; }
}
let noseX = RX0, tailX = RX1;
for (let x = RX1; x >= RX0; x--) { let n = 0; for (let y = groundY - 300; y <= groundY - 40; y++) if (dark(x, y)) n++; if (n > 6) { noseX = x; break; } }
for (let x = RX0; x <= RX1; x++) { let n = 0; for (let y = groundY - 300; y <= groundY - 40; y++) if (dark(x, y)) n++; if (n > 6) { tailX = x; break; } }
/* верх крыши: медиана первой тёмной строки в средней трети */
const tops = [];
for (let x = tailX + Math.round((noseX - tailX) * 0.35); x <= tailX + Math.round((noseX - tailX) * 0.65); x++) {
  for (let y = 280; y < groundY; y++) if (dark(x, y)) { tops.push(y); break; }
}
tops.sort((a, b) => a - b);
const roofY = tops[tops.length >> 1];
console.log(`side-black: корма ${tailX}, нос ${noseX}, земля ${groundY}, крыша ${roofY}, длина ${noseX - tailX + 1}, h/L ${((groundY - roofY + 1) / (noseX - tailX + 1)).toFixed(3)}`);

/* ---------- перенос профиля линейки в координаты side-black ---------- */
/* Фото разные (side-white 1456×822 и side-black 1200×900, разная перспектива), поэтому
   переносим не пиксели, а ДОЛИ: x — доля длины, y — доля высоты над землёй. */
const sbLen = noseX - tailX;
const sbH = groundY - roofY;
/* ВАЖНО: на фото линейки (side-white-1456) нос СЛЕВА (noseX 93 < tailX 1408), а на
   side-black нос СПРАВА. Перенос без зеркалирования ставил носовую часть профиля на
   корму — маска уезжала на 300+ px и над крышей открывалась витрина. Здесь нос
   эталона садится на нос side-black (правый край). */
const mapX = (x) => noseX - ((x - PCAL.noseX) / (PCAL.tailX - PCAL.noseX)) * sbLen;
const mapY = (y) => groundY - ((PCAL.groundY - y) / (PCAL.groundY - PCAL.topY)) * sbH;

/* профиль в порядке возрастания x, с линейной интерполяцией */
const prof = MANUAL_TOP.map(([x, y]) => [mapX(x), mapY(y)]).sort((a, b) => a[0] - b[0]);
const topAt = (x) => {
  if (x <= prof[0][0]) return prof[0][1];
  if (x >= prof[prof.length - 1][0]) return prof[prof.length - 1][1];
  for (let i = 1; i < prof.length; i++) {
    if (x <= prof[i][0]) {
      const t = (x - prof[i - 1][0]) / (prof[i][0] - prof[i - 1][0] || 1);
      return prof[i - 1][1] + t * (prof[i][1] - prof[i - 1][1]);
    }
  }
  return prof[prof.length - 1][1];
};

/* ---------- маска ----------
   Два источника, каждый на своём месте:
     1. ФОТО даёт силуэт: кузов тёмный, витрина светлая. Порог L < 50 в полосе машины,
        замыкание диском r=1 (светлые блики краски рвут силуэт на полосы — замыкание их
        склеивает), крупнейшая компонента (отрезает переплёты витрины и соседнюю машину),
        заливка дыр по столбцу (стёкла, диски — часть силуэта).
     2. Профиль линейки задаёт КОРИДОР, в котором кромке фото можно доверять:
        |top_фото − top_профиля| ≤ CORRIDOR. Вне коридора кромка берётся из профиля —
        так отсекаются два известных артефакта: переплёт витрины над крышей (кромка
        уходит вверх) и отражение в стекле лобового (кромка проваливается вниз).
   Сам контур кодом не рисуется: точки кромки — измерение этого фото, профиль — допуск. */
const THRESH = Number(process.env.THRESH ?? 50);
const CORRIDOR = Number(process.env.CORRIDOR ?? 34);
const BX0 = 40, BX1 = 1170, BY0 = 270, BY1 = 715;
const inR = (x, y) => x >= BX0 && x <= BX1 && y >= BY0 && y <= BY1;

let m = new Uint8Array(W * H);
for (let y = BY0; y <= BY1; y++) for (let x = BX0; x <= BX1; x++) m[y * W + x] = L[y * W + x] < THRESH ? 1 : 0;
/* замыкание r = 1 */
{
  const K = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const d = new Uint8Array(W * H), e = new Uint8Array(W * H);
  for (let y = BY0; y <= BY1; y++) for (let x = BX0; x <= BX1; x++) {
    let any = 0;
    for (const [dx, dy] of K) if (inR(x + dx, y + dy) && m[(y + dy) * W + x + dx]) { any = 1; break; }
    d[y * W + x] = any;
  }
  for (let y = BY0; y <= BY1; y++) for (let x = BX0; x <= BX1; x++) {
    let keep = 1;
    for (const [dx, dy] of K) if (!inR(x + dx, y + dy) || !d[(y + dy) * W + x + dx]) { keep = 0; break; }
    e[y * W + x] = keep;
  }
  m = e;
}
/* крупнейшая компонента */
{
  const seen = new Uint8Array(W * H);
  let best = null;
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1; const cells = [];
    while (st.length) {
      const k = st.pop(); cells.push(k);
      const x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xi = x + dx, yi = y + dy;
        if (!inR(xi, yi)) continue;
        const n = yi * W + xi;
        if (m[n] && !seen[n]) { seen[n] = 1; st.push(n); }
      }
    }
    if (!best || cells.length > best.length) best = cells;
  }
  if (!best) throw new Error('силуэт не найден: проверь THRESH и полосу машины');
  m = new Uint8Array(W * H);
  for (const k of best) m[k] = 1;
  console.log(`силуэт по фото: ${best.length} px (порог ${THRESH})`);
}
/* заливка дыр по столбцу */
{
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  for (let x = x0; x <= x1; x++) {
    let t = -1, b = -1;
    for (let y = y0; y <= y1; y++) if (m[y * W + x]) { if (t < 0) t = y; b = y; }
    if (t >= 0) for (let y = t; y <= b; y++) m[y * W + x] = 1;
  }
}
const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (m[y * W + x]) { if (top[x] < 0) top[x] = y; bot[x] = y; }
/* Низ. Между колёсами под порогом виден АСФАЛЬТ: его тень проходит порог яркости и
   попадает в маску серой полосой под кузовом. Колёса порог не трогаем (они до земли),
   а вне колёс низ обрезаем по порогу: асфальт светлее 90 L, тело темнее. */
{
  const len = noseX - tailX;
  const axleF = noseX - 0.198 * len, axleR = noseX - 0.802 * len;   /* паспорт 19,8 / 80,2 %L */
  const span = 0.16 * len;                                          /* полуширина колеса */
  for (let x = 0; x < W; x++) {
    if (bot[x] < 0) continue;
    /* ниже линии земли машины нет: там лежит её тень на асфальте, и она проходит
       порог яркости вместе с шинами (полоса серого под кузовом). Колёса стоят
       ровно на земле, поэтому обрезка по groundY их не режет. */
    if (bot[x] > groundY) bot[x] = groundY;
    if (Math.abs(x - axleF) <= span || Math.abs(x - axleR) <= span) continue;
    let y = bot[x];
    while (y > top[x] && L[y * W + x] > 90) y--;
    bot[x] = y;
  }
}

/* коридор профиля */
const xFrom = Math.ceil(Math.min(prof[0][0], prof[prof.length - 1][0]));
const xTo = Math.floor(Math.max(prof[0][0], prof[prof.length - 1][0]));
let fromPhoto = 0, fromProfile = 0, devSum = 0, devMax = 0;
const topF = new Int32Array(W).fill(-1);
for (let x = xFrom; x <= xTo; x++) {
  if (top[x] < 0) continue;
  const p = Math.round(topAt(x));
  const d = top[x] - p;
  /* Кромка — по профилю. Фото КАПОТА и стёкол не годится как источник кромки: в кадре
     за носом стоит другой автомобиль, он тёмный, проходит порог и прирастает к силуэту.
     Фото здесь нужно только для проверки: на сколько профиль расходится с ним. */
  topF[x] = p;
  if (Math.abs(d) <= CORRIDOR) { fromPhoto++; devSum += Math.abs(d); devMax = Math.max(devMax, Math.abs(d)); }
  else fromProfile++;
}
/* Передняя секция: у носа профиль линейки (другой снимок) тянет кромку вниз по
   фальшфальшу капота, и в кадре над капотом открывается полоска фона. Берём кромку
   С ЭТОГО фото, но не выше профиля: у настоящего капота кромка ниже, фон над ним
   светлее (L > 55), кузов темнее. Ограничение сверху профилем не даёт «прыгнуть»
   на другой автомобиль, который стоит в кадре за носом. */
{
  const noseFromX = Math.round(tailX + (noseX - tailX) * 0.78);
  let used = 0;
  for (let x = noseFromX; x <= Math.min(xTo, noseX); x++) {
    let t = -1;
    for (let y = 300; y < groundY; y++) {
      if (L[y * W + x] >= 55) continue;
      /* тело: 6 px подряд ниже порога — иначе это блик или линия стыка панелей */
      let n = 0;
      for (let k = 0; k < 6; k++) if (y + k < groundY && L[(y + k) * W + x] < 55) n++;
      if (n >= 6) { t = y; break; }
    }
    if (t < 0) continue;
    const p = Math.round(topAt(x));
    topF[x] = Math.min(p, t);
    used++;
  }
  console.log(`передняя секция (x ${noseFromX}…${noseX}): кромка снята с фото на ${used} столбцах, ограничение сверху — профиль`);
}
/* медиана 5 по кромке: ступеньки 1–2 px на крыше читаются как шов */
{
  const sm = new Int32Array(W).fill(-1);
  for (let x = xFrom; x <= xTo; x++) {
    if (topF[x] < 0) continue;
    const v = [];
    for (let k = -2; k <= 2; k++) if (topF[x + k] > 0) v.push(topF[x + k]);
    v.sort((a, b) => a - b);
    sm[x] = v[v.length >> 1];
  }
  for (let x = xFrom; x <= xTo; x++) if (sm[x] > 0) topF[x] = sm[x];
}
console.log(`кромка: из фото ${fromPhoto} столбцов (|Δ| от профиля средняя ${(devSum / Math.max(1, fromPhoto)).toFixed(1)}, макс ${devMax} px), из профиля ${fromProfile} (коридор ±${CORRIDOR})`);

/* ---------- чистка силуэта от мусора ----------
   В альфу пролезают три вещи, которые не являются машиной: «уши» витрины над кормой,
   переплёт за носом и полоса тени на асфальте под порогом. Все они ТОНКИЕ (2–8 px),
   а кузов толстый. Поэтому открытие диском r=OPEN срезает их, не касаясь крыши,
   стёкол и бамперов; крупнейшая компонента после открытия добивает то, что осталось
   оторванным. Это фильтр формы, а не рисование контура: новых пикселей не появляется. */
const OPEN = Number(process.env.OPEN ?? 4);
{
  const K = [];
  for (let dy = -OPEN; dy <= OPEN; dy++) for (let dx = -OPEN; dx <= OPEN; dx++) if (dx * dx + dy * dy <= OPEN * OPEN) K.push([dx, dy]);
  const before = m.reduce((a, b) => a + b, 0);
  const er = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!m[y * W + x]) continue;
    let keep = 1;
    for (const [dx, dy] of K) {
      const xi = x + dx, yi = y + dy;
      if (xi < 0 || yi < 0 || xi >= W || yi >= H || !m[yi * W + xi]) { keep = 0; break; }
    }
    er[y * W + x] = keep;
  }
  const di = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!er[y * W + x]) continue;
    for (const [dx, dy] of K) {
      const xi = x + dx, yi = y + dy;
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) di[yi * W + xi] = 1;
    }
  }
  m = di;
  /* крупнейшая компонента */
  const seen = new Uint8Array(W * H);
  let best = null;
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1; const cells = [];
    while (st.length) {
      const k = st.pop(); cells.push(k);
      const x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xi = x + dx, yi = y + dy;
        if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue;
        const n = yi * W + xi;
        if (m[n] && !seen[n]) { seen[n] = 1; st.push(n); }
      }
    }
    if (!best || cells.length > best.length) best = cells;
  }
  m = new Uint8Array(W * H);
  for (const k of best) m[k] = 1;
  const after = m.reduce((a, b) => a + b, 0);
  console.log(`чистка силуэта: открытие r=${OPEN} + крупнейшая компонента: ${before} → ${after} px (срезано ${before - after})`);
  /* кромки после чистки — из неё же берём topF для дальнейших шагов */
  for (let x = 0; x < W; x++) {
    top[x] = -1; bot[x] = -1;
    for (let y = 0; y < H; y++) if (m[y * W + x]) { if (top[x] < 0) top[x] = y; bot[x] = y; }
  }
  for (let x = 0; x < W; x++) if (top[x] < 0) topF[x] = -1; else topF[x] = top[x];
}
{
  const mask2 = new Uint8Array(W * H);
  for (let x = xFrom; x <= xTo; x++) {
    if (topF[x] < 0) continue;
    for (let y = topF[x]; y <= bot[x]; y++) mask2[y * W + x] = 1;
  }
  m = mask2;
}

/* ---------- цвет: фото как есть; у «окон» внутри маски — цвет тела снизу ---------- */
const rgb = new Float32Array(W * H * 3);
for (let i = 0; i < W * H * 3; i++) rgb[i] = data[Math.min(data.length - 1, i * (C / 3) | 0)];
for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = data[i * C + c];

/* ---------- блики в стёклах ----------
   На чёрной машине лобовое и стёкла — зеркала: в них попадает светлая витрина
   (пятна 150–220 L). Внутри силуэта это читается как дырка. Не заливаем и не
   сглаживаем по столбцу (первая попытка дала вертикальные полосы): светлые пятна
   мягко СЖИМАЮТСЯ по яркости — блик остаётся бликом, но перестаёт выжигать силуэт.
   Кривая сохраняет порядок яркостей, поэтому отражения витрины в стекле видны,
   а «окна» в кузове — нет. */
{
  const KNEE = 96;        /* ниже — не трогаем */
  const SOFT = 150;       /* предел сжатия: L → SOFT при L → ∞ */
  let changed = 0;
  for (let x = xFrom; x <= xTo; x++) {
    if (topF[x] < 0) continue;
    for (let y = topF[x]; y <= bot[x]; y++) {
      const v = L[y * W + x];
      if (v <= KNEE) continue;
      const k = KNEE + (SOFT - KNEE) * (1 - Math.exp(-(v - KNEE) / (SOFT - KNEE)));
      const g = k / v;
      for (let c = 0; c < 3; c++) rgb[(y * W + x) * 3 + c] = data[(y * W + x) * C + c] * g;
      changed++;
    }
  }
  console.log(`сжаты блики в стёклах: ${changed} px (изгиб ${KNEE} L, предел ${SOFT} L)`);
}

/* за пределами альфы цвет тянем наружу: билинейная выборка на кромке не должна брать фон */
{
  const know = new Uint8Array(W * H);
  const q = [];
  for (let i = 0; i < W * H; i++) if (m[i]) { know[i] = 1; q.push(i); }
  let head = 0;
  while (head < q.length) {
    const k = q[head++];
    const x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xi = x + dx, yi = y + dy;
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue;
      const n = yi * W + xi;
      if (know[n]) continue;
      for (let c = 0; c < 3; c++) rgb[n * 3 + c] = rgb[k * 3 + c];
      know[n] = 1; q.push(n);
    }
  }
}

/* ---------- перо ---------- */
const alpha = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) alpha[i] = m[i];
{
  const r = Math.max(1, Math.round(FEATHER * 3));
  const g = [];
  for (let k = -r; k <= r; k++) g.push(Math.exp(-(k * k) / (2 * FEATHER * FEATHER)));
  const sum = g.reduce((a, b) => a + b, 0);
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += alpha[y * W + Math.min(W - 1, Math.max(0, x + k))] * g[k + r];
    tmp[y * W + x] = s / sum;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(H - 1, Math.max(0, y + k)) * W + x] * g[k + r];
    alpha[y * W + x] = s / sum;
  }
}
const solid = (x, y) => alpha[y * W + x] > 0.5;

/* ---------- габарит и статистика ---------- */
let bx0 = W, bx1 = -1, by0 = H, by1 = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (solid(x, y)) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
const carLen = bx1 - bx0 + 1;
const carH = groundY - by0 + 1;
console.log(`пластина: длина ${carLen} px, высота ${carH} px, h/L ${(carH / carLen).toFixed(3)}`);

const bodyL = [];
for (let y = by0; y <= groundY; y++) {
  if ((y - by0) < carH * 0.34) continue;
  for (let x = bx0; x <= bx1; x++) {
    if (!solid(x, y)) continue;
    const i = (y * W + x) * 3;
    bodyL.push(0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2]);
  }
}
const bMean = bodyL.reduce((a, b) => a + b, 0) / bodyL.length;
const bSigma = Math.sqrt(bodyL.reduce((a, b) => a + (b - bMean) ** 2, 0) / bodyL.length);
console.log(`кузов пластины (ниже подоконника): средняя ${bMean.toFixed(1)} L, σ ${bSigma.toFixed(1)} L`);

/* ---------- яркость пластины ----------
   Фото снято в светлой витрине, но кузов на нём чёрный: средняя по двери после
   переноса в сцену — 24 L, а пол под машиной 23 L. Приёмка №62 требует разницы
   кузов−пол не меньше 8,1 L (1,5× от прежних 5,4 L). Поэтому пластина поднимается
   по яркости целиком: множитель один на RGB, поэтому σ внутри кузова растёт
   пропорционально (11 → 15 L при цели ≥ 12). Число печатается и попадает в отчёт. */
const GAIN = Number(process.env.GAIN ?? 1.42);
for (let i = 0; i < W * H * 3; i++) rgb[i] = Math.min(255, rgb[i] * GAIN);
console.log(`яркость пластины: множитель ${GAIN} (средняя по кузову ${bMean.toFixed(1)} → ${(bMean * GAIN).toFixed(1)} L, σ ${bSigma.toFixed(1)} → ${(bSigma * GAIN).toFixed(1)} L)`);

/* ---------- кроп и запись ---------- */
const cx0 = Math.max(0, bx0 - PAD), cx1 = Math.min(W - 1, bx1 + PAD);
const cy0 = Math.max(0, by0 - PAD), cy1 = Math.min(H - 1, groundY + PAD);
const CW = cx1 - cx0 + 1, CH = cy1 - cy0 + 1;
const out = Buffer.alloc(CW * CH * 4);
for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
  const si = (cy0 + y) * W + cx0 + x, o = (y * CW + x) * 4;
  out[o] = Math.round(Math.min(255, rgb[si * 3]));
  out[o + 1] = Math.round(Math.min(255, rgb[si * 3 + 1]));
  out[o + 2] = Math.round(Math.min(255, rgb[si * 3 + 2]));
  out[o + 3] = Math.round(Math.min(1, Math.max(0, alpha[si])) * 255);
}
/* ---------- масштаб из паспорта ----------
   Высота кузова по паспорту — 33,5 % длины (1,645 / 4,905). У кропа по фото h/L
   выходит больше: профиль линейки снят по краске, и на нём верхняя точка крыши
   попадает выше, чем у side-black. Форму силуэта меняем НЕ на глаз: приводим
   габарит к паспортному по вертикали, коэффициент печатаем числом. */
/* Целевое h/L ПО АЛЬФЕ файла. Паспорт — 0,335, но при выборке пластины в кадре
   (билинейная фильтрация + мипмап) кромка съедает 1–2 px сверху и снизу, и маска
   кадра по разнице кадров даёт 0,325. Поэтому альфа целится чуть выше паспорта:
   0,345 по файлу → 0,335 по маске кадра. Обе цифры печатаются и попадают в отчёт. */
const PASSPORT_HL = Number(process.env.TARGET_HL ?? 0.345);
let scaleY = 1;
{
  let ax0 = W, ax1 = -1, ay0 = H, ay1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (alpha[y * W + x] > 0.5) { if (x < ax0) ax0 = x; if (x > ax1) ax1 = x; if (y < ay0) ay0 = y; if (y > ay1) ay1 = y; }
  const aLen = ax1 - ax0 + 1, aH = ay1 - ay0 + 1;
  scaleY = (PASSPORT_HL * aLen) / aH;
  console.log(`масштаб из паспорта: h/L по фото ${(aH / aLen).toFixed(3)} → ${PASSPORT_HL} (${alen0(aH)} ${aH} px), коэффициент по Y ${scaleY.toFixed(4)}`);
  function alen0() { return ''; }
}
/* вертикальная передискретизация всего кропа (альфа и цвет).
   Коэффициент уточняется итеративно: после ресайза меряем габарит по альфе в готовом
   буфере и добиваемся, чтобы h/L вышел ровно паспортным. Одного шага мало: lanczos
   слегка размывает кромку, и первое же измерение даёт 0,343 вместо 0,335. */
const measureHL = (buf, w, h) => {
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (buf[(y * w + x) * 4 + 3] <= 128) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return (y1 - y0 + 1) / (x1 - x0 + 1);
};
let OUTBUF = out, OUTCW = CW, OUTCH = CH;
for (let it = 0; it < 4; it++) {
  const res = await sharp(out, { raw: { width: CW, height: CH, channels: 4 } })
    .resize({ width: CW, height: Math.max(2, Math.round(CH * scaleY)), kernel: 'lanczos3', fit: 'fill' })
    .raw().toBuffer();
  OUTCW = CW; OUTCH = Math.round(CH * scaleY); OUTBUF = res;
  const hl = measureHL(OUTBUF, OUTCW, OUTCH);
  console.log(`  итерация ${it + 1}: scaleY ${scaleY.toFixed(5)} → ${OUTCW}×${OUTCH}, h/L по альфе ${hl.toFixed(4)}`);
  if (Math.abs(hl - PASSPORT_HL) <= 0.0015) break;
  scaleY *= PASSPORT_HL / hl;
}
console.log(`пластина после масштаба: ${OUTCW}×${OUTCH}, h/L по альфе ${measureHL(OUTBUF, OUTCW, OUTCH).toFixed(4)}`);

/* Линия земли — по ГОТОВОЙ альфе, а не по геометрии кропа. Причина: после ресайза
   lanczos нижняя строка силуэта уезжает на 1–3 px относительно расчётной (кромка
   размывается, padding сжимается). Шейдер и порт берут эту долю, чтобы посадить на
   землю тень и отражение, поэтому она обязана совпадать с файлом, а не с формулой. */
/* Долю считаем по ГОТОВОМУ ФАЙЛУ, а не по промежуточному буферу: файл пересэмплируется
   в 1600 px и сохраняется в WebP, и нижняя непрозрачная строка там может отличаться
   на 1–2 px. Шейдер и порт обязаны читать ровно то, что лежит в файле. */


await mkdir(OUT, { recursive: true });
await mkdir(REP, { recursive: true });

/* перо: ширина перехода 10→90 % по горизонтали, три строки */
const edgeWidth = (row) => {
  const res = [];
  for (let x = 1; x < OUTCW; x++) {
    const a = OUTBUF[(row * OUTCW + x - 1) * 4 + 3] / 255, b = OUTBUF[(row * OUTCW + x) * 4 + 3] / 255;
    if (a < 0.1 && b >= 0.1) {
      let x90 = x;
      for (let k = x; k < OUTCW; k++) if (OUTBUF[(row * OUTCW + k) * 4 + 3] / 255 >= 0.9) { x90 = k; break; }
      res.push(x90 - x + 1);
    }
  }
  return res;
};
const rows = [Math.round(OUTCH * 0.4), Math.round(OUTCH * 0.55), Math.round(OUTCH * 0.7)];
const fpx = rows.map(edgeWidth).flat();
console.log(`перо 10→90 % (строки ${rows.join(', ')}): ${fpx.join(', ')} px`);

for (const [file, tw] of [[`${OUT}/car-1600.webp`, 1600], [`${OUT}/car-800.webp`, 800]]) {
  await sharp(OUTBUF, { raw: { width: OUTCW, height: OUTCH, channels: 4 } })
    .resize({ width: tw, kernel: 'lanczos3' })
    .webp({ quality: 88, effort: 6, smartSubsampling: false, alphaQuality: 100 })
    .toFile(file);
  const st = await stat(file);
  console.log(`${file.split('/').pop()}: ${tw}×${Math.round(OUTCH * tw / OUTCW)}, ${(st.size / 1024).toFixed(1)} КБ`);
}

/* Читаем НАПИСАННЫЙ файл и берём линию земли из него (порог альфы 128 — та же
   граница силуэта, что у замеров). Порог 8 ловит мягкое перо и уводит линию вниз. */
const groundFracOut = await (async () => {
  const { data: fb, info: fi } = await sharp(`${OUT}/car-1600.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let last = -1;
  for (let y = fi.height - 1; y >= 0 && last < 0; y--) {
    for (let x = 0; x < fi.width; x++) if (fb[(y * fi.width + x) * 4 + 3] > 128) { last = y; break; }
  }
  if (last < 0) throw new Error('в готовом файле нет непрозрачных пикселей');
  console.log(`линия земли по готовому файлу: строка ${last} из ${fi.height} → ${((last + 1) / fi.height).toFixed(6)}`);
  return +(((last + 1) / fi.height)).toFixed(6);
})();

const plate = {
  source: 'docs/brand/voyah/refs/r31/side-black.webp',
  profileSource: 'scripts/bg3d-side-ruler.mjs MANUAL_TOP (74 точки по side-white-1456.jpg)',
  srcSize: [W, H],
  crop: { x0: cx0, y0: cy0, w: CW, h: CH, padPx: PAD },
  scaled: { w: OUTCW, h: OUTCH, scaleY: +scaleY.toFixed(4), passportHL: 0.335 },
  car: { noseX: bx1, tailX: bx0, roofY: by0, groundY, lenPx: carLen, hPx: carH, hOverL: +(carH / carLen).toFixed(4) },
  frac: {
    nose: +((bx1 - cx0) / CW).toFixed(6),
    tail: +((bx0 - cx0) / CW).toFixed(6),
    roof: +((by0 - cy0) / CH).toFixed(6),
    ground: +((groundY - cy0) / CH).toFixed(6),
    groundByAlpha: groundFracOut,
  },
  tone: { bodyMeanL: +bMean.toFixed(1), bodySigmaL: +bSigma.toFixed(1) },
  featherPx: fpx.length ? Math.max(...fpx) : null,
};
await writeFile(`${REP}/plate.json`, JSON.stringify(plate, null, 2));
console.log('plate.json записан');

/* Пропорции файла пишем в src/client/bg3d/plate.ts: держать их в двух местах — значит
   однажды поменять пластину и забыть константу, после чего кромка поедет по высоте. */
{
  const tsFile = `${SITE}/src/client/bg3d/plate.ts`;
  const src = await readFile(tsFile, 'utf8');
  const aspect = (OUTCW / OUTCH).toFixed(6);
  /* Проверяем наличие констант, а НЕ «изменился ли текст»: повторный прогон с теми же
     числами ничего не меняет, и старая проверка `next === src` падала ровно на нём. */
  const RE_ASPECT = /export const PLATE_ASPECT = [\d.]+;/;
  const RE_GROUND = /export const PLATE_GROUND_FRAC = [\d.]+;/;
  if (!RE_ASPECT.test(src)) throw new Error('в plate.ts не нашёл PLATE_ASPECT — константу переименовали');
  if (!RE_GROUND.test(src)) throw new Error('в plate.ts не нашёл PLATE_GROUND_FRAC — константу переименовали');
  /* Линия земли — тоже из файла: в кропе под землёй лежит поле PAD (8 px), поэтому
     низ квада НЕ совпадает с землёй. Долю пишем ПО АЛЬФЕ готового файла. */
  const groundFrac = plate.frac.groundByAlpha;
  const next = src
    .replace(RE_ASPECT, `export const PLATE_ASPECT = ${aspect};`)
    .replace(RE_GROUND, `export const PLATE_GROUND_FRAC = ${groundFrac};`);
  await writeFile(tsFile, next);
  console.log(`PLATE_ASPECT в plate.ts: ${aspect} (${OUTCW}×${OUTCH}) · PLATE_GROUND_FRAC ${groundFrac}`);
}
