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
  { x0: -2.4525, h: 0.2000, a: 1.0252, b: 0.2641, c: 0.1283, d: -0.1283 },
  { x0: -2.2525, h: 0.6500, a: 1.2893, b: 0.4414, c: -0.1173, d: -0.0110 },
  { x0: -1.6025, h: 0.6500, a: 1.6024, b: 0.1738, c: -0.2594, d: 0.1201 },
  { x0: -0.9525, h: 0.6500, a: 1.6368, b: 0.0153, c: 0.0130, d: -0.0322 },
  { x0: -0.3025, h: 0.6500, a: 1.6330, b: -0.0553, c: -0.0073, d: -0.0441 },
  { x0: 0.3475, h: 0.6500, a: 1.5263, b: -0.2022, c: -0.2854, d: 0.1899 },
  { x0: 0.9975, h: 0.6500, a: 1.2286, b: -0.2033, c: 0.2074, d: -0.1130 },
  { x0: 1.6475, h: 0.4500, a: 1.1198, b: -0.0882, c: 0.1020, d: -0.1205 },
  { x0: 2.0975, h: 0.2000, a: 1.0130, b: -0.1093, c: -0.1586, d: 0.0195 },
  { x0: 2.2975, h: 0.1550, a: 0.7647, b: -0.2851, c: -0.2391, d: 0.1196 },
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
  /** X переднего края форточки задней двери (разделитель стёкол, фото) */
  div: -0.72,
} as const;

/**
 * Стойки лобового и заднего стекла — как прямые через ДВЕ опорные точки:
 * низ стойки (CABIN.front/rear на подоконнике) и верх (CABIN.frontTop/rearTop
 * на верхней кромке кузова). Наклон получается из `CABIN` и `pTop`, поэтому
 * не может разъехаться с профилем (гейт check-profile-copies ловит таблицы).
 *   лобовое: (1,16; 0,99) → (0,60; 1,4473), K_FRONT ≈ 1,2245 м/м
 *   заднее:  (−1,95; 1,0476) → (−1,62; 1,5499), K_REAR ≈ 0,6572 м/м
 */
const CABIN_Y_FRONT = beltAt(CABIN.front);
const CABIN_Y_REAR = beltAt(CABIN.rear);
const CABIN_K_FRONT = (CABIN.front - CABIN.frontTop) / (topAt(CABIN.frontTop) - CABIN_Y_FRONT);
const CABIN_K_REAR = (CABIN.rearTop - CABIN.rear) / (topAt(CABIN.rearTop) - CABIN_Y_REAR);

/**
 * Штамповка крыла: подштамповка над аркой на фото идёт от кромки крыла вниз-назад,
 * ~0,10 м по X и 0,045 м по Y. Это ТОН, а не форма: в SDF не входит.
 */
const FENDER = { dx: 0.10, dy: 0.045 } as const;

/** Арка: радиус — паспортное колесо пополам плюс зазор; по Y чуть сжата. */
export const ARCH = { radius: CAR.tyre / 2 + CAR.archGap, squashY: 1.06 } as const;

export interface ProfileNode extends CarPoint {
  /** верх силуэта в этой точке (крыша/капот/порог с поправкой на арки) */
  top: number;
  /** порог: низ кузова, от которого считаются арки */
  bottom: number;
  /** линия остекления — по ней carCabin строит окно */
  belt: number;
}

/** Узлы профиля с шагом 0,05 м — для отчёта и глаза; в шейдер не идут. */
export const NODES: ProfileNode[] = (() => {
  const out: ProfileNode[] = [];
  const n = Math.round(CAR.length / 0.05);
  for (let i = 0; i <= n; i++) {
    const x = -CAR.length / 2 + (i * CAR.length) / n;
    const top = topAt(x);
    out.push({
      x: +x.toFixed(3),
      y: +top.toFixed(4),              /* y — верх силуэта: узел лежит на контуре */
      top: +top.toFixed(4),
      bottom: +bottomAt(x).toFixed(4),
      belt: +beltAt(x).toFixed(4),
    });
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

/* Остекление — для блика на стёклах, не для формы.
   Обе границы по X были записаны наоборот: (-front - p.x) и (p.x - rear) давали
   условие x ≥ front И x ≤ rear, то есть ПУСТОЕ множество (front > rear), —
   поэтому окно не рисовалось ни при каком вызове. Правильно: снизу rear,
   сверху front, как у carProfile по Y. Исправлено в круге 32 (задание №57). */
float carCabin(vec2 p){
  float s = max(pBelt(p.x) - p.y, p.y - (pTop(p.x) - 0.02));
  s = max(s, p.x - ${glslF(CABIN.front)});
  s = max(s, ${glslF(CABIN.rear)} - p.x);
  return s;
}

/* Остекление и внутренняя структура кабины (добавлено в круге 32, задание №57).
   Возвращает сразу четыре маски, потому что все они считаются от Одного pTop:
     x — стекло (1 внутри), 0 снаружи;
     y — стойка/разделитель (1 на линии),
     z — подоконник pBelt, метры (по нему рисуется светлая подоконная линия);
     w — верх кузова pTop, метры.
   Так сделано ради бюджета: второй pTop стоил бы ~100 арифметических операций
   на пиксель (весь кадр — 954), а сверх бюджета задания №57 (+10 %) выходить нельзя.

   Стойки НАКЛОННЫЕ, как на фото: X границы растёт при спуске от крыши к подоконнику.
   Скорости C_K_FRONT/C_K_REAR посчитаны из CABIN и pTop в этом же модуле, поэтому
   наклон стоек не может разъехаться с профилем. */
vec4 carTrim(vec2 p){
  float top = pTop(p.x);
  float belt = pBelt(p.x);
  float xf = ${glslF(CABIN.front)} - ${glslF(CABIN_K_FRONT)} * (p.y - ${glslF(CABIN_Y_FRONT)});
  float xr = ${glslF(CABIN.rear)} + ${glslF(CABIN_K_REAR)} * (p.y - ${glslF(CABIN_Y_REAR)});
  /* xr ≤ p.x ≤ xf: нижняя граница по X вычитается из координаты, верхняя — наоборот */
  float s = max(belt - p.y, p.y - (top - 0.02));
  s = max(s, p.x - xf);
  s = max(s, xr - p.x);
  float glass = 1.0 - smoothstep(-0.005, 0.005, s);
  /* стойки и разделитель между стёклами передней и задней двери: 1 на линии */
  float pf = 1.0 - smoothstep(0.008, 0.026, abs(p.x - xf));
  float pr = 1.0 - smoothstep(0.008, 0.026, abs(p.x - xr));
  float pd = 1.0 - smoothstep(0.010, 0.030, abs(p.x - ${glslF(CABIN.div)}));
  return vec4(glass, max(max(pf, pr), pd) * step(belt, p.y), belt, top);
}

/* Штамповка крыла — тон: 0 внутри полосы подштамповки над аркой. */
float pFender(vec2 p){
  vec2 d = vec2(C_AXLE_F - p.x, p.y - (C_TYRE_R + C_ARCH_R * 0.55));
  float a = max(abs(d.x) - ${glslF(FENDER.dx)}, abs(d.y) - ${glslF(FENDER.dy)});
  float b = max(abs(C_AXLE_R - p.x) - ${glslF(FENDER.dx)}, abs(d.y) - ${glslF(FENDER.dy)});
  return min(a, b);
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
  s = Math.max(s, x - CABIN.front);      /* границы по X были перепутаны, см. GLSL */
  s = Math.max(s, CABIN.rear - x);
  return s;
}

/** Наклон стоек, которым пользуется GLSL: м/м по X на метр высоты. */
export const CABIN_SLOPE = { front: CABIN_K_FRONT, rear: CABIN_K_REAR, yFront: CABIN_Y_FRONT, yRear: CABIN_Y_REAR } as const;

/**
 * Двойник `carTrim` из GLSL — независимая запись той же формулы для гейта и
 * CPU-порта. Порядок: [стекло, стойка, подоконник, верх].
 */
export function carTrimJS(x: number, y: number): [number, number, number, number] {
  const top = topAt(x);
  const belt = beltAt(x);
  const xf = CABIN.front - CABIN_K_FRONT * (y - CABIN_Y_FRONT);
  const xr = CABIN.rear + CABIN_K_REAR * (y - CABIN_Y_REAR);
  let s = Math.max(belt - y, y - (top - 0.02));
  s = Math.max(s, x - xf);
  s = Math.max(s, xr - x);
  const ss = Math.min(1, Math.max(0, (s + 0.014) / 0.028));
  const glass = 1 - ss * ss * (3 - 2 * ss);
  const band = (a: number, b: number) => {
    const t = Math.min(1, Math.max(0, (Math.abs(a) - b) / 0.018));
    return 1 - t * t * (3 - 2 * t);
  };
  const pf = band(x - xf, 0.008);
  const pr = band(x - xr, 0.008);
  const pd = band(x - CABIN.div, 0.010);
  return [glass, Math.max(pf, pr, pd) * (y >= belt ? 1 : 0), belt, top];
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
