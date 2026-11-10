/* Профиль Voyah Free для 3D-заставки (круг 31, задание №52).
 *
 * Зачем отдельный модуль: форма машины — это данные (паспортные габариты +
 * опорные точки силуэта), а не литералы внутри шейдера. Из этих данных
 * собирается GLSL для заставки, из них же считаются числа для гейта
 * `scripts/check-car-profile.mjs`, и этот же модуль сможет взять 3D-фон
 * (задание №44, `client/bg3d`) — там силуэт сейчас читается как седан.
 *
 * Единицы: 1 единица сцены = 1 метр. Перед машины — +x, верх — +y, ширина — z.
 *
 * Габариты (паспорт Voyah Free):
 *   длина 4,905 · ширина 1,950 · высота 1,645 · база 2,960 · клиренс 0,180
 *   колея 1,654/1,648 · колесо 255/45 R20 → диаметр 0,7375
 *
 * Производные отношения, которые держит силуэт:
 *   длина/высота = 2,98 · база/длина = 0,603 · диаметр колеса/высота = 0,448
 */

export type Waypoint = readonly [x: number, y: number];

export type CarSpec = {
  /** длина, м */
  length: number;
  /** высота по крыше, м */
  height: number;
  /** ширина, м */
  width: number;
  /** колёсная база, м */
  wheelbase: number;
  /** диаметр колеса, м */
  wheelD: number;
  /** ширина шины, м */
  wheelW: number;
  /** клиренс (низ юбки между арками), м */
  clearance: number;
  /** зазор между шиной и аркой, м */
  archGap: number;
  /** колея передняя / задняя, м */
  trackF: number;
  trackR: number;
  /** x самой высокой точки крыши (кабина сдвинута назад: < 0) */
  roofPeakX: number;
  /** верхний контур: от передка (+x) к корме (−x) */
  top: readonly Waypoint[];
  /** нижний контур: от передка (+x) к корме (−x) */
  bottom: readonly Waypoint[];
};

/** Паспортные точки силуэта Voyah Free (сняты с профиля модели, не «на глаз»). */
export const CAR: CarSpec = {
  length: 4.905,
  height: 1.645,
  width: 1.95,
  wheelbase: 2.96,
  wheelD: 0.7375,
  wheelW: 0.255,
  clearance: 0.18,
  archGap: 0.035,
  trackF: 1.654,
  trackR: 1.648,
  roofPeakX: -0.35,
  /* верх: нос → капот → лобовое (30° от вертикали) → крыша → спойлер → корма (≈25°) */
  top: [
    [2.4525, 0.86],
    [2.28, 0.97],
    [1.95, 1.01],
    [1.15, 1.05],
    [0.7, 1.08],
    [0.39, 1.6],
    [-0.35, 1.645],
    [-1.05, 1.63],
    [-1.45, 1.58],
    [-1.75, 1.5],
    [-2.05, 1.05],
    [-2.28, 0.78],
    [-2.4525, 0.62],
  ],
  /* низ: бампер → юбка (клиренс) → бампер */
  bottom: [
    [2.4525, 0.42],
    [2.3, 0.26],
    [2.1, 0.19],
    [1.9, 0.18],
    [-1.9, 0.18],
    [-2.1, 0.2],
    [-2.3, 0.28],
    [-2.4525, 0.45],
  ],
};

export type CarMetrics = {
  length: number;
  height: number;
  roofTop: number;
  roofPeakX: number;
  clearance: number;
  wheelD: number;
  wheelbase: number;
  archGap: number;
  lengthOverHeight: number;
  baseOverLength: number;
  wheelOverHeight: number;
};

const round = (v: number, n = 3): number => Math.round(v * 10 ** n) / 10 ** n;

/** Числа силуэта — то же, что меряет гейт по картинке, но из данных. */
export function carMetrics(car: CarSpec = CAR): CarMetrics {
  const roofTop = Math.max(...car.top.map((p) => p[1]));
  const sill = Math.min(...car.bottom.map((p) => p[1]));
  return {
    length: car.length,
    height: car.height,
    roofTop,
    roofPeakX: car.roofPeakX,
    clearance: sill,
    wheelD: car.wheelD,
    wheelbase: car.wheelbase,
    archGap: car.archGap,
    lengthOverHeight: round(car.length / car.height),
    baseOverLength: round(car.wheelbase / car.length),
    wheelOverHeight: round(car.wheelD / car.height),
  };
}

/** Эталонные отношения из задания №52 (допуск в гейте ±2 %). */
export const TARGET = {
  lengthOverHeight: 2.98,
  baseOverLength: 0.603,
  wheelOverHeight: 0.448,
  roofTop: 1.645,
  clearance: 0.18,
  archGap: 0.035,
  roofPeakX: -0.35,
} as const;

const f = (v: number, n = 4): string => v.toFixed(n);


/**
 * Плоский силуэт сбоку (x,y) — то, что видит орто-камера.
 * Для боковой проекции силуэт 3D-кузова совпадает с этим 2D-контуром:
 * кузов — вытянутый профиль, колёса идут на всю ширину. Функция нужна
 * инструменту `scripts/car-profile.mjs` и гейту: по ней считаются длина,
 * высота, колесо и зазор арки без перспективы и без сглаживания.
 */
export function carSilhouetteGlsl(car: CarSpec = CAR): string {
  const ax = car.wheelbase / 2;
  const cy = car.wheelD / 2;
  const r = car.wheelD / 2;
  const arch = r + car.archGap;
  return `
float sdSide2D(vec2 p){
  float d = max(max(p.y - carTop(p.x), carBot(p.x) - p.y), abs(p.x) - ${f(car.length / 2)});
  float arch = min(length(p - vec2(${f(ax)}, ${f(cy)})) - ${f(arch)},
                   length(p + vec2(${f(ax)}, ${f(-cy)})) - ${f(arch)});
  float body = max(d, -arch);
  float wheel = min(length(p - vec2(${f(ax)}, ${f(cy)})) - ${f(r)},
                    length(p + vec2(${f(ax)}, ${f(-cy)})) - ${f(r)});
  return min(body, wheel);
}
`;
}

/**
 * GLSL-кусок с формой машины. Функции с префиксом `car*`, чтобы не спорить
 * с именами шейдера-хозяина: `carTop/carBot/carHalfW/sdCarProfile/carNormal`,
 * плюс `carBoxDist` — дешёвое отсечение по габаритному боксу.
 */
export function carGlsl(car: CarSpec = CAR): string {
  const top = car.top;
  const bottom = car.bottom;
  const axles = [
    car.wheelbase / 2,
    -car.wheelbase / 2,
  ];
  const cy = car.wheelD / 2;
  const r = car.wheelD / 2;
  const hwT = car.wheelW / 2;
  const archR = r + car.archGap;
  const zF = car.trackF / 2;
  const zR = car.trackR / 2;

  /* тело функции: старт в первой точке и приращения по сегментам (передок → корма) */
  const curve = (pts: readonly Waypoint[]): string => {
    const lines = [`  float y = ${f(pts[0][1])};`];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (b[1] === a[1]) continue;
      lines.push(`  y += ${f(b[1] - a[1])} * clamp((${f(a[0])} - x) / ${f(a[0] - b[0])}, 0.0, 1.0);`);
    }
    lines.push('  return y;');
    return lines.join('\n');
  };

  return `
float carTop(float x){
${curve(top)}
}
float carBot(float x){
${curve(bottom)}
}
float carHalfW(float x, float y){
  float w = ${f(car.width / 2)};
  w *= 1.0 - 0.180 * smoothstep(${f(car.length / 2 - 0.55)}, ${f(car.length / 2)}, abs(x));
  w *= 1.0 - 0.160 * smoothstep(1.05, ${f(car.height)}, y);
  return w;
}
float carCylZ(vec3 p, vec2 c, float r, float hw){
  vec2 d = abs(vec2(length(p.xy - c), p.z)) - vec2(r, hw);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0)));
}
float carBoxDist(vec3 p){
  vec3 q = abs(p - vec3(0.0, ${f(car.height / 2)}, 0.0)) - vec3(${f(car.length / 2)}, ${f(car.height / 2)}, ${f(car.width / 2)});
  return length(max(q, vec3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float sdCarProfile(vec3 p){
  /* профиль как высотное поле: верхняя и нижняя кромки — гладкие кривые,
     поэтому крыша выпуклая, а не «домиком», и стык капота без ступеньки */
  /* срез по габариту: за передком и кормой кривые ничего не значат */
  float d2 = max(max(p.y - carTop(p.x), carBot(p.x) - p.y), abs(p.x) - ${f(car.length / 2)}) * 0.62;
  vec2 q = vec2(d2, abs(p.z) - carHalfW(p.x, p.y));
  float body = min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - 0.055;
  /* арки: радиус колеса + зазор, юбка между арками остаётся */
  body = max(body, -carCylZ(p, vec2(${f(axles[0])}, ${f(cy)}), ${f(archR)}, 1.20));
  body = max(body, -carCylZ(p, vec2(${f(axles[1])}, ${f(cy)}), ${f(archR)}, 1.20));
  /* колёса: шина с фаской. Ось симметрии z → abs(p.z): два колеса на одной оси
     считаются одним цилиндром (вдвое меньше работы в марше) */
  float w = carCylZ(vec3(p.xy, abs(p.z) - ${f(zF)}), vec2(${f(axles[0])}, ${f(cy)}), ${f(r)}, ${f(hwT)});
  w = min(w, carCylZ(vec3(p.xy, abs(p.z) - ${f(zR)}), vec2(${f(axles[1])}, ${f(cy)}), ${f(r)}, ${f(hwT)}));
  return min(body, w);
}
vec3 carNormal(vec3 p){
  const vec2 e = vec2(0.0018, -0.0018);
  return normalize(
    e.xyy * sdCarProfile(p + e.xyy) +
    e.yyx * sdCarProfile(p + e.yyx) +
    e.yxy * sdCarProfile(p + e.yxy) +
    e.xxx * sdCarProfile(p + e.xxx));
}
`;
}
