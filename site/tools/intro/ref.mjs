/**
 * CPU-порт фрагментного шейдера заставки `SCENE_FS` из `src/client/voyah-intro.ts` —
 * строка в строку (задание №55, круг 31, фаза 1, §1.2: снять «до» по заставке).
 *
 * Зачем он нужен:
 *
 *  1. **Число «до» существует только сейчас.** A5 собирается править рейкастинг заставки
 *     (профиль кузова из `car-profile.ts`, другая высота, другое число шагов). После правки
 *     «до» не восстановить. Поэтому стоимость кадра текущей заставки измеряется и кладётся
 *     в отчёт вместе с методом, а не оценивается на глаз.
 *  2. **Сверить порт со статическим подсчётом.** Как в раунде 30 для фона: тот же glslang
 *     собирает SPIR-V по функциям (`scripts/measure-intro.mjs`), и числа порта сравниваются
 *     с числом инструкций компилятора. Расхождение объясняется, а не прячется.
 *
 * Метрики — те же две, что в `tools/bg3d/ref.mjs`, чтобы заставку можно было сравнить с фоном
 * одним языком:
 *   • `inst`   — инструкции в гранулярности SPIR-V: одна векторная операция = одна инструкция;
 *   • `scalar` — компонентные операции: `vec3 * scalar` = 3. Именно `scalar` идёт в модель fps.
 *
 * Порт намеренно НЕ оптимизирован: оптимизация скрыла бы число операций. Каждый `t(inst, scalar)`
 * стоит рядом со строкой GLSL, к которой относится, — их можно пересчитать руками по исходнику.
 *
 * Три места, где порт обязан объяснить расхождение с железом:
 *
 *   • **`fwidth`.** На GPU это производная по квадрату 2×2: значение берётся из соседних
 *     пикселей, которые исполняются как «помощники» (helper lanes) и на экране не видны.
 *     В порте сосчитан только сам `FWidth` (1 инструкция, 5 компонентных: два вычитания,
 *     два модуля, одно сложение), а значения соседей берутся из предварительного прогона
 *     `probeDerivatives()` по той же сетке, который в tally НЕ попадает. Марш у каждого
 *     пикселя свой, поэтому двойного счёта нет: N пикселей = N маршей, как и на GPU
 *     (стоимость probe-прогона печатается отдельно, чтобы её нельзя было потерять из виду).
 *   • **`smoothstep` с обратными краями** (`smoothstep(0.035, 0.0, gx)`, `smoothstep(0.98, 0.90, …)`):
 *     по спеке результат при edge0 ≥ edge1 не определён, драйверы считают ту же формулу и
 *     получают нисходящую рампу. Порт делает так же.
 *   • **Константы, которые драйвер сворачивает** (`normalize(vec2(-0.68, -0.73))` в `cabin()`):
 *     порт считает их как исполненные операции — так честнее для «до», но в SPIR-V их не будет.
 *     Это одна из причин Δ в сверке; вторая — CSE (`length(fp.xz)` в шейдере посчитан дважды).
 *
 * Исходник, с которого снят порт: `SCENE_FS`, строки 39–235 файла `site/src/client/voyah-intro.ts`
 * (база задания `92fb168`). Править чужой файл ради замера нельзя (§2 задания), поэтому порт
 * живёт рядом, а не в нём.
 */

/**
 * Что порт считает НЕИЗМЕННЫМ в живом исходнике `SCENE_FS`.
 *
 * Порт написан от конкретной версии шейдера (база задания `92fb168`). Когда A5 принесёт
 * правку — другое число шагов марша, другой профиль, другая высота кузова — порт молча
 * начнёт считать чужой шейдер, и «после» окажется липой. Поэтому `scripts/measure-intro.mjs`
 * сверяет каждый литерал ниже с текстом исходника и ПАДАЕТ, если хоть один не найден
 * (лечится либо правкой порта под новый шейдер, либо `--allow-stale` с пометкой в отчёте).
 *
 * Формат: [что, регулярка по исходнику]. Регулярки намеренно узкие — они должны ловить
 * именно изменение числа, а не перенос строки.
 */
export const PORT_SOURCE_LITERALS = [
  ['шагов марша — 72',                      /for\s*\(\s*int\s+i\s*=\s*0\s*;\s*i\s*<\s*72\s*;/],
  ['порог попадания 0.0016 + t*0.0012',     /d\s*<\s*0\.0016\s*\+\s*t\s*\*\s*0\.0012/],
  ['коэффициент шага d*0.85, минимум 0.0015', /max\s*\(\s*d\s*\*\s*0\.85\s*,\s*0\.0015\s*\)/],
  ['выход из марша t > 18.0',               /if\s*\(\s*t\s*>\s*18\.0\s*\)\s*break/],
  ['ореол exp(-max(d,0)*22)*0.014',         /exp\s*\(\s*-\s*max\s*\(\s*d\s*,\s*0\.0\s*\)\s*\*\s*22\.0\s*\)\s*\*\s*0\.014/],
  ['шаг центральной разности 0.0018',       /vec2\s+e\s*=\s*vec2\s*\(\s*0\.0018\s*,\s*-0\.0018\s*\)/],
  ['кузов: sdBox2(p - (0,0.70), (2.16,0.30), 0.17)', /sdBox2\s*\(\s*p\s*-\s*vec2\s*\(\s*0\.0\s*,\s*0\.70\s*\)\s*,\s*vec2\s*\(\s*2\.16\s*,\s*0\.30\s*\)\s*,\s*0\.17\s*\)/],
  ['капот: sdRot(p, (1.40,1.03), (0.72,0.12), -0.10, 0.10)', /sdRot\s*\(\s*p\s*,\s*vec2\s*\(\s*1\.40\s*,\s*1\.03\s*\)\s*,\s*vec2\s*\(\s*0\.72\s*,\s*0\.12\s*\)\s*,\s*-0\.10\s*,\s*0\.10\s*\)/],
  ['склейка кузова smin(…, 0.09) и smin(…, 0.07)', /smin\s*\(\s*bodyD\s*,\s*hoodD\s*,\s*0\.09\s*\)[\s\S]{0,80}smin\s*\(\s*d\s*,\s*cabin\s*\(\s*p\s*\)\s*,\s*0\.07\s*\)/],
  ['остекление: 1.66 / 1.02 / (0.10,1.66) / (-0.68,-0.73)', /1\.66\s*-\s*p\.y[\s\S]{0,200}vec2\s*\(\s*-0\.68\s*,\s*-0\.73\s*\)/],
  ['остекление: (-1.70,1.02) / (0.70,-0.71)', /vec2\s*\(\s*-1\.70\s*,\s*1\.02\s*\)[\s\S]{0,120}vec2\s*\(\s*0\.70\s*,\s*-0\.71\s*\)/],
  ['высота экструзии mix(0.95, 0.79, smoothstep(1.02, 1.18, p.y))', /mix\s*\(\s*0\.95\s*,\s*0\.79\s*,\s*smoothstep\s*\(\s*1\.02\s*,\s*1\.18\s*,\s*p\.y\s*\)\s*\)/],
  ['арки: sdCylZ(p, (±1.50,0.35), 0.46, 1.1)', /sdCylZ\s*\(\s*p\s*,\s*vec2\s*\(\s*1\.50\s*,\s*0\.35\s*\)\s*,\s*0\.46\s*,\s*1\.1\s*\)/],
  ['колёса: sdCylZ(p ∓ 0.80 по z, (±1.50,0.35), 0.355, 0.115)', /sdCylZ\s*\(\s*p\s*-\s*vec3\s*\(\s*0\.0\s*,\s*0\.0\s*,\s*0\.80\s*\)\s*,\s*vec2\s*\(\s*1\.50\s*,\s*0\.35\s*\)\s*,\s*0\.355\s*,\s*0\.115\s*\)/],
  ['камера: yaw mix(-0.40,0.12), rad mix(5.8,4.5), pit mix(0.13,0.22), ta (0,0.80,0)', /mix\s*\(\s*-0\.40\s*,\s*0\.12\s*,\s*e\s*\)[\s\S]{0,200}mix\s*\(\s*5\.8\s*,\s*4\.5\s*,\s*e\s*\)[\s\S]{0,200}mix\s*\(\s*0\.13\s*,\s*0\.22\s*,\s*e\s*\)/],
  ['объектив fw * 1.80',                    /fw\s*\*\s*1\.80/],
  ['fwidth берётся от secX, belt, seamD, cab', /fwidth\s*\(\s*secX\s*\)[\s\S]{0,400}fwidth\s*\(\s*belt\s*\)[\s\S]{0,400}fwidth\s*\(\s*seamD\s*\)[\s\S]{0,400}fwidth\s*\(\s*cab\s*\)/],
  ['дизеринг hash13(vec3(gl_FragCoord.xy, uT))/255', /hash13\s*\(\s*vec3\s*\(\s*gl_FragCoord\.xy\s*,\s*uT\s*\)\s*\)\s*-\s*0\.5\s*\)\s*\/\s*255\.0/],
];

/* ============================ счётчики ============================ */

export const T = { inst: 0, scalar: 0, pixels: 0 };
export function resetTally() { T.inst = 0; T.scalar = 0; T.pixels = 0; }
function t(inst, scalar = inst) { T.inst += inst; T.scalar += scalar; }

/** Сколько чего исполнилось — отдельно от стоимости, для отчёта. */
export const COUNT = {
  marchSteps: 0, marchItersMax: 0, hitPixels: 0, floorPixels: 0, scannerPixels: 0,
  normalAtCalls: 0, mapCalls: 0, fwidthCalls: 0,
};
export function resetCounts() { for (const k of Object.keys(COUNT)) COUNT[k] = 0; }

/* ===================== встроенные функции GLSL ===================== */

const fract = (v) => v - Math.floor(v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** smoothstep: t = clamp((x-e0)/(e1-e0), 0, 1); t*t*(3-2t). SPIR-V: 1 инструкция (FSmoothStep). */
function smoothstep(e0, e1, x) {
  t(1, 4);
  const d = e1 - e0;
  const tt = clamp01(d === 0 ? 0 : (x - e0) / d);
  return tt * tt * (3 - 2 * tt);
}
/** mix: a + (b - a) * t. SPIR-V: 1 инструкция (FMix), 3 компонентных на скаляр. */
function mixf(a, b, tt) { t(1, 3); return a + (b - a) * tt; }
/** pow: SPIR-V 1 инструкция (Pow), 4 компонентных. */
function powf(a, b) { t(1, 4); return Math.pow(a, b); }
/** exp: SPIR-V 1 инструкция (Exp), 4 компонентных. */
function expf(a) { t(1, 4); return Math.exp(a); }
/** length(vec2): 1 инструкция (Length) — 2 умножения, сложение, sqrt. */
function length2(x, y) { t(1, 4); return Math.sqrt(x * x + y * y); }
/** normalize(vec3): 1 инструкция (Normalize). */
function normalize3(x, y, z) { t(1, 9); const l = Math.sqrt(x * x + y * y + z * z) || 1e-12; return [x / l, y / l, z / l]; }
/** cross(vec3, vec3): 1 инструкция (Cross) — 6 умножений, 3 вычитания. */
function cross3(ax, ay, az, bx, by, bz) {
  t(1, 9);
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}
/** dot(vec3, vec3): 1 инструкция (Dot) — 3 умножения, 2 сложения. */
function dot3(ax, ay, az, bx, by, bz) { t(1, 5); return ax * bx + ay * by + az * bz; }
/** dot(vec2, vec2): 1 инструкция (Dot) — 2 умножения, 1 сложение. */
function dot2(ax, ay, bx, by) { t(1, 3); return ax * bx + ay * by; }
function signf(v) { t(1, 1); return v > 0 ? 1 : v < 0 ? -1 : 0; }
function stepf(edge, x) { t(1, 1); return x < edge ? 0 : 1; }

/* ============================ шейдер ============================ */

/** float hash13(vec3 p) — порт: 9 инструкций, 23 компонентных. */
export function hash13(px, py, pz) {
  let x = fract(px * 0.1031), y = fract(py * 0.1031), z = fract(pz * 0.1031);
  t(2, 6);                                   /* p * 0.1031 (1,3) + fract (1,3) */
  const yzx = [y, z, x];
  t(1, 3);                                   /* p.yzx — перестановка */
  const ax = yzx[0] + 33.33, ay = yzx[1] + 33.33, az = yzx[2] + 33.33;
  t(1, 3);                                   /* + 33.33 */
  const dp = x * ax + y * ay + z * az;
  t(1, 5);                                   /* dot(vec3, vec3) */
  x += dp; y += dp; z += dp;
  t(1, 3);                                   /* p += … */
  const r = fract((x + y) * z);
  t(3, 3);                                   /* p.x + p.y, * p.z, fract */
  return r;
}

/** float smin(float a, float b, float k) — 10 инструкций, 12 компонентных. */
export function smin(a, b, k) {
  /* ВАЖНО: в GLSL `0.5 + 0.5 * (b - a) / k` — делится только произведение, не сумма.
     Ошибка приоритета здесь превращает склейку в max() и «съедает» крышу кузова. */
  const h = clamp01(0.5 + 0.5 * (b - a) / k);
  t(5, 5);                                   /* b-a, *0.5, /k, +0.5, clamp */
  const m = b + (a - b) * h;
  t(1, 3);                                   /* mix(b, a, h) */
  const r = m - k * h * (1.0 - h);
  t(4, 4);                                   /* k*h, 1-h, умножение, вычитание */
  return r;
}

/** float sdBox2(vec2 p, vec2 b, float r) — 9 инструкций, 16 компонентных. */
export function sdBox2(px, py, bx, by, r) {
  const dx = Math.abs(px) - bx + r;
  const dy = Math.abs(py) - by + r;
  t(3, 6);                                   /* abs(p), - b, + r */
  const mx = Math.max(dx, 0), my = Math.max(dy, 0);
  t(1, 2);                                   /* max(d, vec2(0.0)) */
  const len = Math.sqrt(mx * mx + my * my);
  t(1, 4);                                   /* length(vec2) */
  const inner = Math.min(Math.max(dx, dy), 0);
  t(2, 2);                                   /* max(d.x, d.y), min(…, 0.0) */
  t(2, 2);                                   /* сложение, - r */
  return len + inner - r;
}

/** float sdRot(vec2 p, vec2 c, vec2 b, float a, float r) — 13 инструкций, 26 компонентных. */
export function sdRot(px, py, cx, cy, bx, by, a, r) {
  const qx0 = px - cx, qy0 = py - cy;
  t(1, 2);                                   /* p - c */
  const s = Math.sin(a), co = Math.cos(a);
  t(2, 2);                                   /* sin(a), cos(a) */
  const rx = co * qx0 + (-s) * qy0;
  const ry = s * qx0 + co * qy0;
  t(1, 6);                                   /* mat2(co, s, -s, co) * q */
  return sdBox2(rx, ry, bx, by, r);
}

/** float sdCylZ(vec3 p, vec2 c, float r, float hw) — 10 инструкций, 21 компонентная. */
export function sdCylZ(px, py, pz, cx, cy, r, hw) {
  const ex = px - cx, ey = py - cy;
  t(1, 2);                                   /* p.xy - c */
  const l = Math.sqrt(ex * ex + ey * ey);
  t(1, 4);                                   /* length(vec2) */
  const ax = Math.abs(l) - r;
  const ay = Math.abs(pz) - hw;
  t(3, 6);                                   /* vec2(l, p.z) (1,2), abs (1,2), - vec2(r, hw) (1,2) */
  const inner = Math.min(Math.max(ax, ay), 0);
  t(2, 2);                                   /* max(d.x, d.y), min(…, 0.0) */
  const mx = Math.max(ax, 0), my = Math.max(ay, 0);
  const len = Math.sqrt(mx * mx + my * my);
  t(2, 6);                                   /* max(d, vec2(0.0)) (1,2) + length (1,4) */
  t(1, 1);                                   /* сложение */
  return inner + len;
}

/** float sdExt(float dd, float z, float hz, float r) — 11 инструкций, 16 компонентных. */
export function sdExt(dd, z, hz, r) {
  const wx = dd + r;
  const wy = Math.abs(z) - (hz - r);
  t(4, 4);                                   /* dd + r, hz - r, abs(z), вычитание */
  t(1, 2);                                   /* vec2(wx, wy) */
  const inner = Math.min(Math.max(wx, wy), 0);
  t(2, 2);                                   /* max(w.x, w.y), min(…, 0.0) */
  const mx = Math.max(wx, 0), my = Math.max(wy, 0);
  const len = Math.sqrt(mx * mx + my * my);
  t(2, 6);                                   /* max(w, vec2(0.0)) (1,2) + length (1,4) */
  t(2, 2);                                   /* сложение, - r */
  return inner + len - r;
}

/** Нормали трапеции остекления: в GLSL это `normalize(vec2(…))` от констант (строки 76–77). */
const CABIN_NC = (() => { const l = Math.hypot(-0.68, -0.73); return [-0.68 / l, -0.73 / l]; })();
const CABIN_ND = (() => { const l = Math.hypot(0.70, -0.71); return [0.70 / l, -0.71 / l]; })();

/** float cabin(vec2 p) — 14 инструкций, 30 компонентных. */
export function cabin(px, py) {
  const a = 1.66 - py;
  t(1, 1);
  const b = py - 1.02;
  t(1, 1);
  const c = dot2(px - 0.10, py - 1.66, CABIN_NC[0], CABIN_NC[1]);
  t(1, 2);                                   /* p - vec2(0.10, 1.66) */
  t(1, 5);                                   /* normalize(vec2(-0.68,-0.73)) — драйвер свернёт */
  const d = dot2(px + 1.70, py - 1.02, CABIN_ND[0], CABIN_ND[1]);
  t(1, 2);                                   /* p - vec2(-1.70, 1.02) */
  t(1, 5);                                   /* normalize(vec2(0.70,-0.71)) — драйвер свернёт */
  const r = -Math.min(Math.min(a, b), Math.min(c, d));
  t(4, 4);                                   /* три min + отрицание */
  return r;
}

/** float prof(vec2 p) — профиль кроссовера сбоку: 55 инструкций, 96 компонентных.
 *  В заставке ДО правки A5 это своя таблица размеров, не `car-profile.ts` (§1.3).
 *  Порт: 57 инструкций, 98 компонентных. */
export function prof(px, py) {
  const bodyD = sdBox2(px, py - 0.70, 2.16, 0.30, 0.17);
  t(1, 2);                                   /* p - vec2(0.0, 0.70) */
  const hoodD = sdRot(px, py, 1.40, 1.03, 0.72, 0.12, -0.10, 0.10);
  const d1 = smin(bodyD, hoodD, 0.09);
  const cab = cabin(px, py);
  return smin(d1, cab, 0.07);
}

/** float map(vec3 p) — 143 инструкции, 269 компонентных на ОДИН вызов. */
export function map(px, py, pz) {
  COUNT.mapCalls++;
  const hz = mixf(0.95, 0.79, smoothstep(1.02, 1.18, py));
  t(1, 2);                                   /* p.xy */
  const dp = prof(px, py);
  let d = sdExt(dp, pz, hz, 0.075);
  d = Math.max(d, -sdCylZ(px, py, pz, 1.50, 0.35, 0.46, 1.1));
  t(2, 2);                                   /* отрицание + max */
  d = Math.max(d, -sdCylZ(px, py, pz, -1.50, 0.35, 0.46, 1.1));
  t(2, 2);
  let w = sdCylZ(px, py, pz - 0.80, 1.50, 0.35, 0.355, 0.115);
  t(1, 3);                                   /* p - vec3(0.0, 0.0, 0.80) */
  w = Math.min(w, sdCylZ(px, py, pz + 0.80, 1.50, 0.35, 0.355, 0.115));
  t(2, 4);                                   /* p - vec3(0.0, 0.0, -0.80) (1,3) + min (1,1) */
  w = Math.min(w, sdCylZ(px, py, pz - 0.80, -1.50, 0.35, 0.355, 0.115));
  t(2, 4);
  w = Math.min(w, sdCylZ(px, py, pz + 0.80, -1.50, 0.35, 0.355, 0.115));
  t(2, 4);
  const r = Math.min(d, w);
  t(1, 1);
  return r;
}

/** vec3 normalAt(vec3 p) — центральные разности: ЧЕТЫРЕ вызова map().
 *  Порт: 584 инструкции, 1118 компонентных (из них 4 × (p+e и map) = 572 / 1076). */
export function normalAt(px, py, pz) {
  COUNT.normalAtCalls++;
  const e = 0.0018;
  const a = map(px + e, py - e, pz - e);     /* e.xyy */
  const b = map(px - e, py - e, pz + e);     /* e.yyx */
  const c = map(px - e, py + e, pz - e);     /* e.yxy */
  const d = map(px + e, py + e, pz + e);     /* e.xxx */
  t(4, 12);                                  /* p + e.xyy, p + e.yyx, p + e.yxy, p + e.xxx */
  const nx = e * a + (-e) * b + (-e) * c + e * d;
  const ny = (-e) * a + (-e) * b + e * c + e * d;
  const nz = (-e) * a + e * b + (-e) * c + e * d;
  t(4, 12);                                  /* e.xyy * map(…) — четыре умножения vec3 на скаляр */
  t(3, 9);                                   /* три сложения vec3 */
  return normalize3(nx, ny, nz);
}

/** void camera(float t, out vec3 ro, out vec3 ta) — 17 инструкций, 31 компонентная. */
export function camera(ut) {
  const e = ut * ut * (3.0 - 2.0 * ut);
  t(4, 4);                                   /* t*t, 2*t, 3.0-…, умножение */
  const yaw = mixf(-0.40, 0.12, e);
  const rad = mixf(5.8, 4.5, e);
  const pit = mixf(0.13, 0.22, e);
  const tax = 0.0, tay = 0.80, taz = 0.0;
  t(1, 3);                                   /* ta = vec3(0.0, 0.80, 0.0) */
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pit), cp = Math.cos(pit);
  t(4, 4);                                   /* sin(yaw), cos(yaw), sin(pit), cos(pit) */
  const dirx = sy * cp, diry = sp, dirz = cy * cp;
  t(2, 2);                                   /* два умножения */
  t(1, 3);                                   /* vec3(dirx, diry, dirz) */
  const rox = tax + dirx * rad, roy = tay + diry * rad, roz = taz + dirz * rad;
  t(2, 6);                                   /* vec3(…) * rad (1,3) + ta + … (1,3) */
  return { ro: [rox, roy, roz], ta: [tax, tay, taz] };
}

/* ---------- производные (fwidth) ---------- */

/**
 * Сетка значений четырёх величин, от которых в шейдере берётся fwidth: secX, belt, seamD, cab.
 * Заполняется прогоном `probeDerivatives()` с ВЫКЛЮЧЕННЫМ tally, чтобы марш соседей не
 * посчитался дважды: на GPU соседние пиксели квадрата 2×2 всё равно исполняются
 * (helper lanes), а у нас каждый пиксель сетки исполняется ровно один раз.
 */
let DERIV = null;
export function setDerivSource(grid) { DERIV = grid; }

/** float fwidth(x) = |dFdx| + |dFdy| — SPIR-V: 1 инструкция (FWidth), 5 компонентных. */
function fwidthOf(key, gx, gy) {
  t(1, 5);
  COUNT.fwidthCalls++;
  if (!DERIV) return 0;
  const { width, height, data } = DERIV;
  const g = data[key];
  const i = gy * width + gx;
  const ix = gy * width + Math.min(gx + 1, width - 1);
  const iy = Math.min(gy + 1, height - 1) * width + gx;
  return Math.abs(g[ix] - g[i]) + Math.abs(g[iy] - g[i]);
}

/* ---------- главный проход ---------- */

export const NEON = [0.30, 0.85, 1.00];
export const WHITE = [0.90, 0.98, 1.00];
export const BRASS = [1.00, 0.74, 0.40];

/**
 * Один пиксель `void main()`.
 * @param fcx gl_FragCoord.x (центр пикселя: x + 0.5)
 * @param fcy gl_FragCoord.y (центр пикселя; в GL растёт снизу)
 * @param U   { res: [w, h], t: uT }
 * @param opts
 *   gx, gy   — индексы пикселя в сетке (строка сверху вниз): по ним fwidth берёт соседей;
 *   collect  — вернуть {color, deriv, hit, t, iters} вместо одного цвета;
 *   deriv    — посчитать значения для сетки производных (только в probe-прогоне, где tally выключен);
 *   once     — режим сверки со SPIR-V: марш ровно одна итерация, все ветки исполнены по разу.
 */
export function shadePixel(fcx, fcy, U, opts = {}) {
  const [rw, rh] = U.res;
  const uT = U.t;
  const gx = opts.gx ?? 0, gy = opts.gy ?? 0;
  const ONCE = !!opts.once;
  T.pixels++;

  /* vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y */
  const uvx = (fcx * 2.0 - rw) / rh;
  const uvy = (fcy * 2.0 - rh) / rh;
  t(3, 6);                                   /* * 2.0 (1,2), - uRes (1,2), / uRes.y (1,2) */

  const { ro, ta } = camera(uT);
  const fw = normalize3(ta[0] - ro[0], ta[1] - ro[1], ta[2] - ro[2]);
  t(1, 3);                                   /* ta - ro */
  const rt = normalize3(...cross3(0, 1, 0, fw[0], fw[1], fw[2]));
  const up = cross3(fw[0], fw[1], fw[2], rt[0], rt[1], rt[2]);
  const rwX = fw[0] * 1.80 + rt[0] * uvx + up[0] * uvy;
  const rwY = fw[1] * 1.80 + rt[1] * uvx + up[1] * uvy;
  const rwZ = fw[2] * 1.80 + rt[2] * uvx + up[2] * uvy;
  t(5, 15);                                  /* fw*1.80, rt*uv.x, up*uv.y, два сложения vec3 */
  /* ВАЖНО: дальше везде используется НОРМАЛИЗОВАННЫЙ rd — иначе марш шагает в |rd_raw| ≈ 1.8
     раза дальше и промахивается мимо поверхности (на этой ошибке порт сначала и попался). */
  const rd = normalize3(rwX, rwY, rwZ);
  const [rdx, rdy, rdz] = rd;

  const sweep = mixf(3.10, -3.10, smoothstep(0.09, 0.63, uT));
  const dissolve = smoothstep(0.80, 1.0, uT);
  const flash = expf(-powf((uT - 0.760) / 0.045, 2.0));
  t(2, 2);                                   /* uT - 0.760, / 0.045 */
  const glowIn = smoothstep(0.0, 0.15, uT);

  let colR = 0, colG = 0, colB = 0;
  t(1, 3);                                   /* vec3 col = vec3(0.0) */

  /* ---------- пол: неоновая сетка, уходящая в глубину ---------- */
  if (rdy < -0.0001 || ONCE) {
    t(1, 1);                                 /* сравнение */
    const tf = -ro[1] / rdy;
    t(2, 2);                                 /* отрицание, деление */
    if (tf > 0.0 || ONCE) t(1, 1);
    if (tf < 40.0 || ONCE) t(1, 1);
    if ((tf > 0.0 && tf < 40.0) || ONCE) {
      COUNT.floorPixels++;
      const fpx = ro[0] + rdx * tf, fpy = ro[1] + rdy * tf, fpz = ro[2] + rdz * tf;
      t(2, 6);                               /* rd * tf (1,3) + ro + … (1,3) */
      const gxA = Math.abs(fract(fpx * 0.8 + 0.5) - 0.5);
      t(5, 5);                               /* *0.8, +0.5, fract, -0.5, abs */
      const gzA = Math.abs(fract(fpz * 0.8 + 0.5) - 0.5);
      t(5, 5);
      const g = smoothstep(0.035, 0.0, gxA) + smoothstep(0.035, 0.0, gzA);
      t(1, 1);                               /* сложение */
      const lenA = length2(fpx, fpz);
      t(1, 2);                               /* fp.xz */
      const fade = expf(-lenA * 0.20) * glowIn;
      t(3, 3);                               /* отрицание, *0.20, *glowIn */
      const k1 = g * 0.13 * fade;
      t(2, 2);
      colR += NEON[0] * k1; colG += NEON[1] * k1; colB += NEON[2] * k1;
      t(2, 6);                               /* NEON * … (1,3), col += … (1,3) */
      const lenB = length2(fpx, fpz);        /* в GLSL length(fp.xz) написан дважды: драйвер сделает CSE */
      t(1, 2);                               /* fp.xz */
      const k2 = 0.035 * expf(-lenB * 0.55) * glowIn;
      t(4, 4);                               /* отрицание, *0.55, 0.035*…, *glowIn */
      colR += NEON[0] * k2; colG += NEON[1] * k2; colB += NEON[2] * k2;
      t(2, 6);                               /* NEON * … (1,3), col += … (1,3) */
      void fpy;
    }
  } else {
    t(1, 1);
  }

  /* ---------- марш по SDF ---------- */
  let mt = 0.0;
  let halo = 0.0;
  let hit = false;
  let iters = 0;
  for (let i = 0; i < (ONCE ? 1 : 72); i++) {
    iters++;
    COUNT.marchSteps++;
    t(2, 2);                                 /* i++ (OpIAdd) + условие цикла (OpBranchConditional) */
    const px = ro[0] + rdx * mt, py = ro[1] + rdy * mt, pz = ro[2] + rdz * mt;
    t(2, 6);                                 /* rd * t (1,3) + ro + … (1,3) */
    const d = map(px, py, pz);
    halo += expf(-Math.max(d, 0.0) * 22.0) * 0.014;
    t(4, 4);                                 /* max(d, 0.0), отрицание, *22.0, *0.014 */
    t(1, 1);                                 /* halo += … */
    const thr = 0.0016 + mt * 0.0012;
    t(2, 2);                                 /* t * 0.0012, сложение */
    if (d < thr || ONCE) {
      t(1, 1);                               /* сравнение */
      hit = true;
      break;
    }
    t(1, 1);                                 /* сравнение */
    mt += Math.max(d * 0.85, 0.0015);
    t(3, 3);                                 /* d * 0.85, max, += */
    if (mt > 18.0) { t(1, 1); break; }
    t(1, 1);                                 /* сравнение */
  }
  if (ONCE) hit = true;
  if (iters > COUNT.marchItersMax) COUNT.marchItersMax = iters;

  const kh = halo * 0.30 * glowIn;
  t(2, 2);
  colR += NEON[0] * kh; colG += NEON[1] * kh; colB += NEON[2] * kh;
  t(2, 6);

  /* ---------- попадание: линии кузова ---------- */
  const px = ro[0] + rdx * mt, py = ro[1] + rdy * mt, pz = ro[2] + rdz * mt;
  t(2, 6);                                   /* vec3 p = ro + rd * t */

  /* значения для сетки производных: на GPU их считают и helper-lane'ы, поэтому берём
     точку марша независимо от hit. Считаются только в probe-прогоне (opts.deriv),
     где tally выключен, — иначе cabin() попал бы в счётчик второй раз. */
  let deriv = null;
  if (opts.deriv) {
    deriv = {
      secX: Math.abs(fract(px / 0.22 + 0.5) - 0.5) * 0.22,
      belt: Math.abs(py - 1.00),
      seamD: Math.min(Math.min(Math.abs(px - 0.52), Math.abs(px - 0.06)), Math.abs(px - 0.66)),
      cab: cabin(px, py),
    };
  }

  if (hit || ONCE) {
    if (hit) COUNT.hitPixels++;
    t(1, 1);                                 /* if (hit) */
    const n = normalAt(px, py, pz);
    const rv = smoothstep(sweep, sweep + 0.45, px);
    t(1, 1);                                 /* sweep + 0.45 */
    const head = expf(-Math.abs(px - sweep) * 9.0);
    t(4, 4);                                 /* px - sweep, abs, отрицание, *9.0 */
    const dith = smoothstep(dissolve - 0.30, dissolve,
      hash13(Math.floor(px * 5.0), Math.floor(py * 5.0), Math.floor(pz * 5.0)));
    t(3, 7);                                 /* p * 5.0 (1,3), floor (1,3), dissolve - 0.30 (1,1) */
    const fade = 1.0 - smoothstep(0.88, 1.0, uT);
    t(1, 1);
    const side = smoothstep(0.45, 0.65, Math.abs(pz));
    t(1, 1);                                 /* abs(p.z) */

    /* ширина линии — постоянная по экрану */
    const secX = Math.abs(fract(px / 0.22 + 0.5) - 0.5) * 0.22;
    t(6, 6);                                 /* /0.22, +0.5, fract, -0.5, abs, *0.22 */
    const fwSec = fwidthOf('secX', gx, gy);
    const wpx = Math.max(fwSec * 0.95, 0.0012);
    t(2, 2);                                 /* fw * 0.95, max */
    const secFade = 1.0 - smoothstep(0.015, 0.05, fwSec);
    t(1, 1);
    let lines = smoothstep(wpx, 0.0, secX) * 0.9 * secFade;
    t(2, 2);                                 /* * 0.9, * secFade */

    const belt = Math.abs(py - 1.00);
    t(2, 2);                                 /* py - 1.00, abs */
    const fwBelt = fwidthOf('belt', gx, gy);
    lines += smoothstep(Math.max(fwBelt * 0.9, 0.0012), 0.0, belt) * side * 1.1;
    t(5, 5);                                 /* fw*0.9, max, *side, *1.1, += */

    const seamD = Math.min(Math.min(Math.abs(px - 0.52), Math.abs(px - 0.06)), Math.abs(px - 0.66));
    t(8, 8);                                 /* три вычитания, три abs, два min */
    const fwSeam = fwidthOf('seamD', gx, gy);
    const seam = smoothstep(Math.max(fwSeam * 0.85, 0.0012), 0.0, seamD)
      * side * smoothstep(0.98, 0.90, py) * 0.75;
    t(5, 5);                                 /* fw*0.85, max, *side, умножение, *0.75 */
    lines += seam;
    t(1, 1);

    const cab = cabin(px, py);
    t(1, 2);                                 /* p.xy */
    const fwCab = fwidthOf('cab', gx, gy);
    lines += smoothstep(Math.max(fwCab * 0.9, 0.0015), 0.0, Math.abs(cab - 0.05))
      * side * smoothstep(0.96, 1.02, py) * 1.0;
    t(8, 8);                                 /* cab-0.05, abs, fw*0.9, max, *side, умножение, *1.0, += */

    let drl = smoothstep(0.012, 0.0, Math.abs(py - 1.03)) * smoothstep(2.06, 2.18, px);
    t(3, 3);                                 /* py-1.03, abs, умножение */
    drl += smoothstep(0.010, 0.0, Math.abs(py - 1.06)) * smoothstep(-2.06, -2.18, px);
    t(4, 4);                                 /* py-1.06, abs, умножение, += */

    const sgn = signf(px);
    const wr = length2(px - sgn * 1.50, py - 0.35);
    t(5, 8);                                 /* sign, *1.50, vec2(…), p.xy, вычитание */
    const rims = (smoothstep(0.010, 0.0, Math.abs(wr - 0.195))
      + smoothstep(0.008, 0.0, Math.abs(wr - 0.285)))
      * smoothstep(0.55, 0.70, Math.abs(pz)) * stepf(wr, 0.34);
    t(9, 9);                                 /* два (вычитание+abs), сложение, abs(pz), два умножения, step */

    const nd = dot3(n[0], n[1], n[2], rdx, rdy, rdz);
    const rim = powf(1.0 - Math.abs(nd), 3.0);
    t(2, 2);                                 /* abs, 1.0 - … */
    const fres = 1.0 - Math.abs(dot3(n[0], n[1], n[2], rdx, rdy, rdz));
    t(1, 1);

    let cR = 0, cG = 0, cB = 0;
    t(1, 3);                                 /* vec3 c = vec3(0.0) */
    const k3 = fres * rv;
    t(1, 1);
    cR += 0.010 * k3; cG += 0.040 * k3; cB += 0.055 * k3;
    t(2, 6);                                 /* vec3(…) * k3 (1,3), c += … (1,3) */
    const k4 = lines * (1.45 + head * 4.0) * rv;
    t(4, 4);                                 /* head*4.0, 1.45+…, lines*…, *rv */
    cR += NEON[0] * k4; cG += NEON[1] * k4; cB += NEON[2] * k4;
    t(2, 6);                                 /* NEON * … (1,3), c += … (1,3) */
    const k5 = head * 0.65 * rv;
    t(2, 2);
    cR += WHITE[0] * k5; cG += WHITE[1] * k5; cB += WHITE[2] * k5;
    t(2, 6);
    const k6 = drl * 2.6 * rv;
    t(2, 2);
    cR += WHITE[0] * k6; cG += WHITE[1] * k6; cB += WHITE[2] * k6;
    t(2, 6);
    const k7 = rims * 1.3 * rv;
    t(2, 2);
    cR += NEON[0] * k7; cG += NEON[1] * k7; cB += NEON[2] * k7;
    t(2, 6);
    const k8 = rim * 0.62 * (0.26 + 0.74 * glowIn);
    t(4, 4);                                 /* 0.74*glowIn, 0.26+…, rim*0.62, умножение */
    cR += NEON[0] * k8; cG += NEON[1] * k8; cB += NEON[2] * k8;
    t(2, 6);
    const k9 = rim * 0.12 * smoothstep(0.35, 0.85, uT);
    t(2, 2);                                 /* rim*0.12, умножение */
    cR += BRASS[0] * k9; cG += BRASS[1] * k9; cB += BRASS[2] * k9;
    t(2, 6);
    const df = dith * fade;
    t(1, 1);
    cR *= df; cG *= df; cB *= df;
    t(1, 3);                                 /* c *= dith * fade */
    const k10 = flash * (0.22 + rim * 1.8);
    t(3, 3);                                 /* rim*1.8, 0.22+…, flash*… */
    cR += WHITE[0] * k10; cG += WHITE[1] * k10; cB += WHITE[2] * k10;
    t(2, 6);                                 /* WHITE * … (1,3), c += … (1,3) */
    colR += cR; colG += cG; colB += cB;
    t(1, 3);
  } else {
    t(1, 1);                                 /* ветка не взята: само сравнение исполнено */
  }

  /* ---------- световая «плоскость сканера», проходящая сквозь кузов ---------- */
  if (Math.abs(rdx) > 0.0001 || ONCE) {
    t(2, 2);                                 /* abs(rd.x), сравнение */
    const ts = (sweep - ro[0]) / rdx;
    t(2, 2);                                 /* вычитание, деление */
    if (ts > 0.0) t(1, 1);
    if (uT > 0.06) t(1, 1);
    if (uT < 0.72) t(1, 1);
    if ((ts > 0.0 && uT > 0.06 && uT < 0.72) || ONCE) {
      COUNT.scannerPixels++;
      const psx = ro[0] + rdx * ts, psy = ro[1] + rdy * ts, psz = ro[2] + rdz * ts;
      t(2, 6);                               /* rd * ts (1,3) + ro + … (1,3) */
      const r2 = length2(psy - 1.05, psz - 0.0);
    t(3, 8);                                 /* ps.yz (1,2), - vec2(1.05,0.0) (1,2), length (1,4) */
      const k11 = 0.085 * expf(-r2 * 1.4) * glowIn;
      t(4, 4);                               /* r2*1.4, отрицание, 0.085*…, *glowIn */
      colR += NEON[0] * k11; colG += NEON[1] * k11; colB += NEON[2] * k11;
      t(2, 6);                               /* NEON * … (1,3), col += … (1,3) */
      void psx;
    }
  } else {
    t(2, 2);
  }

  const k12 = flash * 0.07;
  t(1, 1);
  colR += NEON[0] * k12; colG += NEON[1] * k12; colB += NEON[2] * k12;
  t(2, 6);                                   /* NEON * flash * 0.07 (1,3), col += (1,3) */

  /* лёгкий дизеринг: убирает полосы на градиентах неона */
  const vec3x = fcx, vec3y = fcy, vec3z = uT;
  t(1, 3);                                   /* vec3(gl_FragCoord.xy, uT) */
  const dth = hash13(vec3x, vec3y, vec3z);
  const k13 = (dth - 0.5) / 255.0;
  t(2, 2);                                   /* - 0.5, / 255.0 */
  colR += k13; colG += k13; colB += k13;
  t(1, 3);                                   /* col += … (vec3) */

  const oR = Math.max(colR, 0), oG = Math.max(colG, 0), oB = Math.max(colB, 0);
  t(2, 7);                                   /* max(col, 0.0) (1,3) + vec4(…, 1.0) (1,4) */

  const color = [oR, oG, oB];
  if (opts.collect) return { color, deriv, hit, t: mt, iters };
  return color;
}

/* ============================ прогоны ============================ */

/**
 * Прогон по сетке с ВЫКЛЮЧЕННЫМ tally: собирает значения secX/belt/seamD/cab для fwidth.
 * Стоимость этого прогона в «операции на пиксель» не входит, но печатается отдельно
 * (это цена helper-lane'ов: на GPU она реальна, в нашей модели — за кадром).
 */
export function probeDerivatives(width, height, U) {
  const n = width * height;
  const data = {
    secX: new Float64Array(n), belt: new Float64Array(n),
    seamD: new Float64Array(n), cab: new Float64Array(n),
  };
  const savedTally = { ...T };
  const savedCounts = { ...COUNT };
  const savedDeriv = DERIV;
  resetTally();
  DERIV = null;                              /* в probe-прогоне fwidth не нужен: возвращает 0 */
  for (let y = 0; y < height; y++) {
    const fcy = height - (y + 0.5);          /* gl_FragCoord.y растёт снизу */
    for (let x = 0; x < width; x++) {
      const r = shadePixel(x + 0.5, fcy, U, { gx: x, gy: y, collect: true, deriv: true });
      const i = y * width + x;
      data.secX[i] = r.deriv.secX; data.belt[i] = r.deriv.belt;
      data.seamD[i] = r.deriv.seamD; data.cab[i] = r.deriv.cab;
    }
  }
  const probeCost = { ...T };
  DERIV = savedDeriv;
  Object.assign(T, savedTally);
  Object.assign(COUNT, savedCounts);
  return { width, height, data, probeCost };
}

/**
 * Измерительный прогон: tally включён, fwidth берётся из сетки производных.
 * @returns {{data:Uint8Array, ops:object, counts:object, grid:object, perPixel:object}}
 */
export function renderFrame({ width, height, t = 0.5, reuseDeriv = null, once = false }) {
  const U = { res: [width, height], t };
  const grid = reuseDeriv ?? probeDerivatives(width, height, U);
  setDerivSource(grid);

  const pixels = width * height;
  const out = new Uint8Array(pixels * 3);
  const inst = new Float64Array(pixels);
  const scalar = new Float64Array(pixels);
  const iters = new Uint16Array(pixels);

  resetTally();
  resetCounts();
  let maxInst = 0, minInst = Infinity, maxScalar = 0, maxIters = 0, hitPx = 0;
  for (let y = 0; y < height; y++) {
    const fcy = height - (y + 0.5);
    for (let x = 0; x < width; x++) {
      const i0 = T.inst, s0 = T.scalar;
      const r = shadePixel(x + 0.5, fcy, U, { gx: x, gy: y, collect: true, once });
      const di = T.inst - i0, ds = T.scalar - s0;
      const i = y * width + x;
      inst[i] = di; scalar[i] = ds; iters[i] = r.iters;
      if (di > maxInst) maxInst = di;
      if (di < minInst) minInst = di;
      if (ds > maxScalar) maxScalar = ds;
      if (r.iters > maxIters) maxIters = r.iters;
      if (r.hit) hitPx++;
      const o = i * 3;
      out[o] = Math.max(0, Math.min(255, Math.round(r.color[0] * 255)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(r.color[1] * 255)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(r.color[2] * 255)));
    }
  }

  const sorted = (a) => Float64Array.from(a).sort();
  const sI = sorted(inst), sS = sorted(scalar), sT = sorted(iters);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const sumIters = iters.reduce((p, c) => p + c, 0);

  return {
    data: out, width, height, time: t, pixels, once, grid,
    ops: {
      instTotal: T.inst, scalarTotal: T.scalar,
      instPerPx: T.inst / pixels, scalarPerPx: T.scalar / pixels,
      instPerPxMax: maxInst, instPerPxMin: minInst === Infinity ? 0 : minInst,
      scalarPerPxMax: maxScalar,
      instPerPxP50: q(sI, 0.5), scalarPerPxP50: q(sS, 0.5),
      instPerPxP95: q(sI, 0.95), scalarPerPxP95: q(sS, 0.95),
      marchItersAvg: sumIters / pixels, marchItersMax: maxIters, marchItersP95: q(sT, 0.95),
      hitPixels: hitPx, hitRatio: hitPx / pixels,
      probeCostPerPx: { inst: grid.probeCost.inst / pixels, scalar: grid.probeCost.scalar / pixels },
    },
    counts: { ...COUNT, fwidthPerPx: COUNT.fwidthCalls / pixels },
    perPixel: { inst, scalar, iters },
  };
}
