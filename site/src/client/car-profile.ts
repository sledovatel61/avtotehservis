/**
 * Профиль Voyah Free — единственный источник геометрии машины (задание №54).
 *
 * Зачем модуль. До него было ДВЕ машины: одна в заставке (`voyah-intro.ts`,
 * A5), другая в 3D-фоне (`bg3d/shader.ts`, функция `carSdf` из rbox/seg).
 * Обе «примерно Voyah», обе неверные, и правки в одной не доезжали до другой.
 * Теперь машина одна. Заставка из задания выведена (у неё фронтальный силуэт,
 * A5 ведёт его отдельно), поэтому `SCALE.intro` здесь нет и модуль в
 * заставку не тянется: он обслуживает **только 3D-фон**.
 *
 * Что откуда взято (подробная таблица — в отчёте круга):
 *   • **масштаб и пропорции — из паспорта**: 4905 × 1950 × 1645 мм, база 2960,
 *     клиренс 180, колесо 255/45 R20 (Ø 0,7375), колея 1654/1648;
 *   • **форма — с фото**: контур верха, снятый с `side-white-1456.jpg`
 *     (`scripts/trace-car-profile.mjs`), калибровка от осей колёс;
 *   • **паспорт против фото**: по фото база выходит 3,07 м при паспортных
 *     2,96 (+3,9 %), а колесо «по внешнему контуру шины» — 0,588 вместо 0,7375.
 *     Это перспектива кадра, а не данные. Поэтому база, длина, высота и
 *     диаметр колеса принудительно паспортные, а из фото берётся только форма
 *     (нормировка по X и Y).
 *
 * Ограничения ESSL 1.00 (WebGL1 и WebGL2 без `#version`), которые определили
 * вид кода:
 *   • массивов с инициализатором нет — `float a[3] = float[3](…)` появился
 *     только в GLSL ES 3.00, поэтому контур это лесенка `if`, а не таблица;
 *   • индекс-переменная для массива запрещена;
 *   • циклы — только с константными границами, поэтому циклов нет вовсе.
 *
 * Контракт для соседей (A10, задача №55):
 *   CarPoint {x, y} — метры; y = 0 — земля; +X к носу, 0 — центр кузова.
 *   `PROFILE_GLSL` даёт `carProfile` (силуэт), `carCabin` (остекление),
 *   `carWheels` (колёса) и внутренние `pTop`/`pBottom`/`pBelt`/`pArch`.
 *   Единицы сцены фона: `SCALE.bg3d`, земля сцены — `BgCar.GROUND`.
 */

export interface CarPoint {
  x: number;
  y: number;
}

/**
 * Паспорт. Это единственные числа, которые разрешено менять «по памяти»:
 * всё остальное считается из них или снимается с фото скриптом.
 */
export const CAR = {
  length: 4.905,
  width: 1.95,
  height: 1.645,
  wheelbase: 2.96,
  clearance: 0.18,
  tyre: 0.7375,          // 255/45 R20: 0,7375 м по паспорту
  track: { front: 1.654, rear: 1.648 },
  /** Оси от центра кузова: база 2,96, центр посередине (свесы 0,97/0,97). */
  axles: [-1.48, 1.48] as const,
  /** Зазор в арке над шиной: по фото 8–12 px ≈ 0,035 м. */
  archGap: 0.035,
} as const;

/** Габарит: половина длины. За ним силуэта нет. */
const HALF_LENGTH = CAR.length / 2;

export interface TopSegment {
  x0: number;
  h: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

/**
 * Верхняя кромка кузова — цепочка кубических Эрмитов.
 *
 * Заполняется скриптом `scripts/trace-car-profile.mjs` прямо в этот файл:
 * он снимает контур с фото, нормирует его на паспорт и подбирает узлы так,
 * чтобы погрешность не превышала 8 мм. Руками эти числа не правят — иначе
 * модуль разойдётся с фото и никто не заметит.
 *
 * Почему Эрмиты, а не таблица на 99 узлов: таблица с `if`-лесенкой стоила бы
 * ~2500 инструкций на пиксель при бюджете 941 `оп/px` (см. `npm run
 * measure:bg3d`), а 10–15 сегментов дают ту же кривую с точностью 8 мм.
 */
export const TOP_SEGMENTS: TopSegment[] = [
  { x0: -2.4525, h: 0.2000, a: 0.9166, b: 0.2846, c: 0.1342, d: -0.1342 },
  { x0: -2.2525, h: 0.6500, a: 1.2012, b: 0.4886, c: -0.1224, d: -0.0118 },
  { x0: -1.6025, h: 0.6500, a: 1.5556, b: 0.2083, c: -0.2720, d: 0.1259 },
  { x0: -0.9525, h: 0.6500, a: 1.6178, b: 0.0420, c: 0.0136, d: -0.0338 },
  { x0: -0.3025, h: 0.6500, a: 1.6396, b: -0.0322, c: -0.0076, d: -0.0464 },
  { x0: 0.3475, h: 0.6500, a: 1.5534, b: -0.1866, c: -0.3000, d: 0.1996 },
  { x0: 0.9975, h: 0.6500, a: 1.2665, b: -0.1877, c: 0.2186, d: -0.1193 },
  { x0: 1.6475, h: 0.4500, a: 1.1780, b: -0.0752, c: 0.1049, d: -0.1251 },
  { x0: 2.0975, h: 0.2000, a: 1.0827, b: -0.1069, c: -0.1632, d: 0.0180 },
  { x0: 2.2975, h: 0.1550, a: 0.8306, b: -0.2939, c: -0.2543, d: 0.1272 },
];

/**
 * Верхняя кромка кузова, м. X — вдоль кузова (+X к носу), Y — вверх от земли.
 * За габаритом возвращает −1: «не кузов».
 */
export function topAt(x: number): number {
  if (x < -HALF_LENGTH || x > HALF_LENGTH) return -1;
  const segs = TOP_SEGMENTS;
  let i = 0;
  while (i < segs.length - 1 && x >= segs[i].x0 + segs[i].h) i++;
  const s = segs[i];
  const t = (x - s.x0) / s.h;
  return s.a + t * (s.b + t * (s.c + t * s.d));
}

/**
 * Нижняя кромка: порог между арками и подъём к бамперам.
 *
 * 0,185 м — паспортный клиренс 180 мм плюс 5 мм на кромку юбки: на фото
 * чёрная юбка уходит ниже, чем читается «клиренс 180». Разница помечена в
 * отчёте как «с фото». Та же формула, что `pBottom` в GLSL, иначе гейт
 * GLSL↔JS развалится, а он и есть защита от расхождения.
 */
const BOTTOM_BASE = 0.185;
const BOTTOM_RISE = 0.115;
const BOTTOM_SPAN = 0.55;   // от 1,90 м от центра до габарита

export function bottomAt(x: number): number {
  if (x < -HALF_LENGTH || x > HALF_LENGTH) return 2;   // за габаритом — не кузов
  const t = Math.min(1, Math.max(0, (Math.abs(x) - 1.9) / BOTTOM_SPAN));
  const s = t * t * (3 - 2 * t);
  return BOTTOM_BASE + BOTTOM_RISE * (s * 0.78 + t * 0.22);
}

/** Подоконная линия: к корме чуть поднимается, нужна для стекла, не для формы. */
export function beltAt(x: number): number {
  return 0.99 + 0.075 * Math.max(0, (-x - 0.3) / 2.15);
}

/** Кабина: между стойками, от подоконника до крыши. */
export const CABIN = {
  front: 1.16,       // X лобового внизу
  frontTop: 0.6,     // X лобового вверху
  rearTop: -1.62,    // X заднего стекла вверху
  rear: -1.95,       // X двери багажника внизу
} as const;

/** Арка: радиус — паспортное колесо пополам плюс зазор; по Y чуть сжата. */
export const ARCH = { radius: CAR.tyre / 2 + CAR.archGap, squashY: 1.06 } as const;

export interface ProfileNode extends CarPoint {
  top: number;
  bottom: number;
  belt: number;
}

/** Узлы профиля с шагом 0,05 м — для отчёта и глаза; в шейдер не идут. */
export const NODES: ProfileNode[] = (() => {
  const out: ProfileNode[] = [];
  const n = Math.round(CAR.length / 0.05);
  for (let i = 0; i <= n; i++) {
    const x = -CAR.length / 2 + (i * CAR.length) / n;
    out.push({ x: +x.toFixed(3), top: +topAt(x).toFixed(4), bottom: +bottomAt(x).toFixed(4), belt: +beltAt(x).toFixed(4) });
  }
  return out;
})();

/**
 * Единицы сцены фона. Высота кузова в сцене — 0,60 единицы, значит
 * 1 единица = 1,645 / 0,60 = 2,7417 м. Менять это число можно только вместе
 * с тенью, отражением и контактной линией у A10 (задача №55), иначе они уедут.
 */
export const SCALE = { bg3d: 0.6 / CAR.height } as const;

/**
 * Единицы сцены, которые нужны шейдеру: земля, оси, радиус колеса.
 * Отдельным объектом, чтобы не тащить в шейдер весь паспорт.
 */
export const SCENE = {
  ground: -0.44,                                  // линия земли в сцене фона
  axleFront: CAR.axles[0] * SCALE.bg3d,
  axleRear: CAR.axles[1] * SCALE.bg3d,
  tyreRadius: (CAR.tyre / 2) * SCALE.bg3d,
} as const;

/* ------------------------------------------------------------------ GLSL */

const glslF = (v: number): string => {
  const s = v.toFixed(6).replace(/0+$/, '');
  return s.endsWith('.') ? `${s}0` : s;
};

/**
 * Сегмент в координате `t`: a + t·(b + t·(c + t·d)).
 * Нулевые коэффициенты не попадают в код: на прямых участках ветвь короче,
 * а бюджет `оп/px` считается по SPIR-V, то есть по факту.
 */
const segGlsl = (i: number): string => {
  const g = TOP_SEGMENTS[i];
  const t = 't';
  let e = glslF(g.a);
  if (Math.abs(g.d) >= 1e-4) e = `(${e} + ${t} * (${glslF(g.b)} + ${t} * (${glslF(g.c)} + ${t} * ${glslF(g.d)})))`;
  else if (Math.abs(g.c) >= 1e-4) e = `(${e} + ${t} * (${glslF(g.b)} + ${t} * ${glslF(g.c)}))`;
  else if (Math.abs(g.b) >= 1e-4) e = `(${e} + ${t} * ${glslF(g.b)})`;
  return e;
};

/**
 * Верх через лесенку `if`. Шаг узлов адаптивный, поэтому `t` считается
 * в ветви: делитель — константа, компилятор превращает деление в умножение.
 */
const topGlsl = (): string =>
  TOP_SEGMENTS.map((g, i) => {
    const edge = glslF(g.x0 + g.h);
    const t = `((k - ${glslF(g.x0)}) / ${glslF(g.h)})`;
    return `  if (k < ${edge}) { float t = ${t}; return ${segGlsl(i)}; }`;
  }).join('\n');

const lastSeg = TOP_SEGMENTS[TOP_SEGMENTS.length - 1];

/**
 * ESSL 1.00: без `#version`, без массивов, без циклов, только скаляры.
 * Три экспорта для фона — `carProfile`, `carCabin`, `carWheels` — плюс
 * внутренние `pTop`, `pBottom`, `pBelt`, `pArch`.
 */
export const PROFILE_GLSL = `
/* ---------- профиль Voyah Free (сгенерировано car-profile.ts) ----------
   Метры: X вдоль кузова (0 = центр, +X к носу), Y вверх от земли.
   Верх — адаптивные кубические Эрмиты по контуру с фото, низ — порог и
   юбка, арки — вырезы по паспортному колесу. Массивов нет: ESSL 1.00. */

const float C_HALF = ${glslF(HALF_LENGTH)};
const float C_TYRE_R = ${glslF(CAR.tyre * 0.5)};
const float C_ARCH_R = ${glslF(ARCH.radius)};
const float C_ARCH_SQ = ${glslF(ARCH.squashY)};
const float C_AXLE_F = ${glslF(CAR.axles[0])};
const float C_AXLE_R = ${glslF(CAR.axles[1])};

/* Верхняя кромка кузова. */
float pTop(float x){
  float k = clamp(x, ${glslF(TOP_SEGMENTS[0].x0)}, ${glslF(lastSeg.x0 + lastSeg.h)});
${topGlsl()}
  return ${glslF(lastSeg.a)};
}

/* Порог и юбка. Степень 1,7 заменена кубическим сглаживанием: pow —
   трансцендентная функция, на пиксель её вызывать незачем. */
float pBottom(float x){
  if (x < -C_HALF || x > C_HALF) return 2.0;
  float t = clamp((abs(x) - 1.9) / 0.55, 0.0, 1.0);
  float s = t * t * (3.0 - 2.0 * t);
  return ${glslF(BOTTOM_BASE)} + ${glslF(BOTTOM_RISE)} * (s * 0.78 + t * 0.22);
}

/* Подоконник — для стекла, форму кузова не задаёт. */
float pBelt(float x){
  return ${glslF(beltAt(0))} + ${glslF(0.075)} * clamp((-x - 0.3) / 2.15, 0.0, 1.0);
}

/* Вырез арки над колесом. */
float pArch(vec2 p, float axle){
  vec2 d = vec2(p.x - axle, (p.y - C_TYRE_R) * C_ARCH_SQ);
  return length(d) - C_ARCH_R;
}

/* Силуэт кузова: 0 внутри, > 0 снаружи. */
float carProfile(vec2 p){
  float body = max(pBottom(p.x) - p.y, p.y - pTop(p.x));
  /* обе арки одним min по расстоянию до оси: max(archF, archR) — это
     «вырез там, где ближе к оси», без двух разных вычитаний */
  float arch = min(pArch(p, C_AXLE_F), pArch(p, C_AXLE_R));
  return max(max(body, -arch), -p.y);
}

/* Остекление — для блика на стёклах, не для формы. */
float carCabin(vec2 p){
  float s = max(pBelt(p.x) - p.y, p.y - (pTop(p.x) - 0.02));
  s = max(s, ${glslF(-CABIN.front)} - p.x);
  s = max(s, p.x - ${glslF(CABIN.rear)});
  return s;
}

/* Колёса: центр на оси, радиус по паспортному диаметру. */
float carWheels(vec2 p){
  float a = length(p - vec2(C_AXLE_F, C_TYRE_R)) - C_TYRE_R;
  float b = length(p - vec2(C_AXLE_R, C_TYRE_R)) - C_TYRE_R;
  return min(a, b);
}
`;

/* ------------------------------------------------------------------ JS */

/**
 * Та же функция, что `carProfile` в GLSL, на JS — для гейта. Гейт рендерит
 * GLSL в headless Chromium и сверяет маски: IoU ≥ 0,99 по сетке 400×160.
 * Копия на JS нужна именно как независимая реализация: если она сойдётся с
 * шейдером, значит формула записана одинаково и там, и там.
 */
export function carProfileJS(x: number, y: number): number {
  let body = Math.max(bottomAt(x) - y, y - topAt(x));
  for (const axle of CAR.axles) {
    const arch = Math.hypot(x - axle, (y - CAR.tyre * 0.5) * ARCH.squashY) - ARCH.radius;
    body = Math.max(body, -arch);
  }
  return Math.max(body, -y);
}

export function carCabinJS(x: number, y: number): number {
  let s = Math.max(beltAt(x) - y, y - (topAt(x) - 0.02));
  s = Math.max(s, -CABIN.front - x);
  s = Math.max(s, x - CABIN.rear);
  return s;
}

export function carWheelsJS(x: number, y: number): number {
  const r = CAR.tyre * 0.5;
  return Math.min(
    Math.hypot(x - CAR.axles[0], y - r) - r,
    Math.hypot(x - CAR.axles[1], y - r) - r,
  );
}

/**
 * Габариты по той же функции, что рисует шейдер: длина, высота и отношения.
 * Считается сеткой 2 мм — точность выше, чем нужно для допуска ±2 %.
 */
export function measureJS(step = 0.003): Record<string, number> {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let x = -CAR.length / 2 - 0.05; x <= CAR.length / 2 + 0.05; x += step) {
    for (let y = 0; y <= CAR.height + 0.05; y += step) {
      if (carProfileJS(x, y) <= 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const length = maxX - minX;
  const height = maxY;
  return {
    length,
    height,
    lengthToHeight: length / height,
    wheelbaseToLength: CAR.wheelbase / length,
    wheelToHeight: CAR.tyre / height,
    clearance: CAR.clearance,
    archGap: CAR.archGap,
    minX,
    maxX,
  };
}
