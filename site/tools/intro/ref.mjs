/**
 * CPU-порт фрагментного шейдера заставки `SCENE_FS` из `src/client/voyah-intro.ts` —
 * редакция круга 31 ПОСЛЕ правки A5 (фронтальный силуэт, задания №52 ред. 2 и №55 фаза 2).
 *
 * Этот файл заменил порт старого рейкастинга (72 шага марша, 3298 оп/px): сцена теперь
 * плоская — слои фона, силуэт кузова, ДХО, знак, отражение в полу. Марша нет вовсе,
 * поэтому прежние 18 литералов порта не сходятся и `measure-intro.mjs` на них падает —
 * так и задумано: порт обязан отказаться считать чужой шейдер, а не молчать.
 *
 * Метрики — те же две, что в раунде 30 и в фазе 1, чтобы все три числа жили в одних единицах:
 *   • `inst`   — инструкции в гранулярности SPIR-V: одна векторная операция = одна инструкция;
 *   • `scalar` — компонентные операции: `vec3 * scalar` = 3. Именно `scalar` — аршин бюджета.
 * Плюс `COUNT.tex` — выборки текстуры знака: это НЕ арифметика, в `scalar` не входит,
 * печатается отдельно (знак — альфа-маска SVG, выборка одна и только в коробке знака).
 *
 * Порт намеренно НЕ оптимизирован: каждый `t(inst, scalar)` стоит рядом со строкой GLSL
 * и пересчитывается руками по исходнику. Ветви, которые на GPU не исполняются
 * (рейлинги вне полосы крыши, зеркало вне пояса, отражение ниже линии пола),
 * в порте тоже не исполняются и не считаются — как на железе.
 *
 * Три места, где порт объясняет расхождение с железом:
 *   • **тернарники-гейты** (`p.y < 130.0 ? railsSd(p) : 9999.0`): динамика считает одну ветвь,
 *     статика SPIR-V — обе; сверка по функциям поэтому идёт только по листовым функциям,
 *     а верность `layers`/`main` доказывает сверка пикселей с драйвером (`--verify`);
 *   • **текстура знака**: в порте сэмплер подменяемый (`setMarkSampler`), по умолчанию 0 —
 *     замер снят без знака; коробка знака на 640×360 ≈ 20×28 px (0,24 % кадра), её вклад
 *     в среднее ≤ 0,1 оп/px, и он указан в отчёте отдельно, а не спрятан в среднем;
 *   • **константы, которые драйвер сворачивает** (`ctr` в `sdQuad`, палитры): порт считает
 *     их как написано — это верхняя оценка, и в сверке со SPIR-V они видны как Δ.
 *
 * Исходник: `SCENE_FS`, строки 42–302 файла `site/src/client/voyah-intro.ts`
 * (база круга 31 `21948b5`, экспорт появился у A5). Править чужой файл нельзя (§2 задания).
 */

/* ============================ счётчики ============================ */

export const T = { inst: 0, scalar: 0, pixels: 0 };
export function resetTally() { T.inst = 0; T.scalar = 0; T.pixels = 0; }
function t(inst, scalar = inst) { T.inst += inst; T.scalar += scalar; }

export const COUNT = {
  tex: 0, layersCalls: 0, reflPixels: 0, railPixels: 0, mirrorPixels: 0, markPixels: 0,
};
export function resetCounts() { for (const k of Object.keys(COUNT)) COUNT[k] = 0; }

/* ===================== встроенные функции GLSL ===================== */

const fract = (v) => v - Math.floor(v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** smoothstep: SPIR-V 1 инструкция (FSmoothStep), 4 компонентных на скаляр. */
function smoothstep(e0, e1, x) {
  t(1, 4);
  const d = e1 - e0;
  const tt = clamp01(d === 0 ? 0 : (x - e0) / d);
  return tt * tt * (3 - 2 * tt);
}
/** mix: SPIR-V 1 инструкция (FMix), 3 компонентных на скаляр, 9 на vec3. */
function mixf(a, b, tt) { t(1, 3); return a + (b - a) * tt; }
function mixv3(a, b, tt) { t(1, 9); return [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt, a[2] + (b[2] - a[2]) * tt]; }
/** exp: SPIR-V 1 инструкция (Exp), 4 компонентных. */
function expf(a) { t(1, 4); return Math.exp(a); }
/** pow: SPIR-V 1 инструкция (Pow), 4 компонентных. */
function powf(a, b) { t(1, 4); return Math.pow(a, b); }
/** length(vec2): 1 инструкция (Length) — 2 умножения, сложение, sqrt. */
function length2(x, y) { t(1, 4); return Math.sqrt(x * x + y * y); }
/** clamp(x, e0, e1): 1 инструкция (FClamp). */
function clampf(x, e0, e1) { t(1, 1); return clamp(x, e0, e1); }
function stepf(edge, x) { t(1, 1); return x < edge ? 0 : 1; }
function signf(v) { t(1, 1); return v > 0 ? 1 : v < 0 ? -1 : 0; }

/* ============================ шейдер ============================ */

/* hero-единицы кадра 1920×1080 (FRONT.md) */
export const BW = 1150.0, BX = 960.0, BY0 = 95.0, BH = 715.0, BOT = 810.0, FLOOR = 730.0;
export const BODY = [0.004, 0.004, 0.004];
export const WARM = [1.00, 0.26, 0.10];
export const WHITE = [1.00, 0.98, 0.96];
/* круг 32 (A12): кромка — #791003 без белого ядра, отблеск — тот же тон шире */
export const RIM = [0.4745, 0.0627, 0.0118];
export const SHEEN = [0.62, 0.085, 0.020];
/* нейтральная подсветка двери/стойки ниже отблеска (круг 32, правка 2) */
export const NEUT = [0.052, 0.048, 0.045];

/** float hash12(vec2 p) — 9 инструкций, 23 компонентных (как hash13 старой сцены). */
export function hash12(px, py) {
  let x = fract(px * 0.1031), y = fract(py * 0.1031), z = fract(px * 0.1031);
  t(2, 6);                                   /* vec3(p.xyx) * 0.1031 (1,3) + fract (1,3) */
  const yzx = [y, z, x];
  t(1, 3);                                   /* p3.yzx */
  const dp = x * (yzx[0] + 33.33) + y * (yzx[1] + 33.33) + z * (yzx[2] + 33.33);
  t(1, 3);                                   /* + 33.33 */
  t(1, 5);                                   /* dot(vec3, vec3) */
  x += dp; y += dp; z += dp;
  t(1, 3);                                   /* p3 += … */
  const r = fract((x + y) * z);
  t(3, 3);
  return r;
}

/** float smin(float a, float b, float k) — 10 инструкций, 12 компонентных.
 *  Приоритет как в GLSL: делится только произведение `0.5 * (b - a) / k`. */
export function smin(a, b, k) {
  const h = clamp01(0.5 + 0.5 * (b - a) / k);
  t(5, 5);                                   /* b-a, *0.5, /k, +0.5, clamp */
  const m = b + (a - b) * h;
  t(1, 3);                                   /* mix(b, a, h) */
  const r = m - k * h * (1.0 - h);
  t(4, 4);                                   /* k*h, 1-h, умножение, вычитание */
  return r;
}

/** float sdBox(vec2 p, vec2 b, float r) — 9 инструкций, 16 компонентных. */
export function sdBox(px, py, bx, by, r) {
  const dx = Math.abs(px) - bx + r;
  const dy = Math.abs(py) - by + r;
  t(3, 6);                                   /* abs(p), - b, + r */
  const mx = Math.max(dx, 0), my = Math.max(dy, 0);
  t(1, 2);
  const len = Math.sqrt(mx * mx + my * my);
  t(1, 4);                                   /* length(vec2) */
  const inner = Math.min(Math.max(dx, dy), 0);
  t(2, 2);
  t(2, 2);                                   /* сложение, - r */
  return len + inner - r;
}

/** float sideD(vec2 p, vec2 a, vec2 b) — 8 инструкций, 13 компонентных. */
export function sideD(px, py, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay;
  t(1, 2);                                   /* e = b - a */
  const num = ex * (py - ay) - ey * (px - ax);
  t(4, 4);                                   /* p.y-a.y, e.x*…, p.x-a.x, e.y*…, вычитание — ниже */
  t(1, 1);
  const le = Math.sqrt(ex * ex + ey * ey);
  t(1, 4);                                   /* length(e) */
  t(1, 1);                                   /* деление */
  return num / le;
}

/** float sdQuad(…) — выпуклый четырёхугольник со скруглением: 51 инструкция, 79 компонентных. */
export function sdQuad(px, py, a, b, c, d, r) {
  const ctrx = (a[0] + b[0] + c[0] + d[0]) * 0.25;
  const ctry = (a[1] + b[1] + c[1] + d[1]) * 0.25;
  t(4, 8);                                   /* (a+b+c+d) * 0.25 */
  const s = signf(sideD(ctrx, ctry, a[0], a[1], b[0], b[1]));
  const q1 = sideD(px, py, a[0], a[1], b[0], b[1]);
  const q2 = sideD(px, py, b[0], b[1], c[0], c[1]);
  const q3 = sideD(px, py, c[0], c[1], d[0], d[1]);
  const q4 = sideD(px, py, d[0], d[1], a[0], a[1]);
  const q = Math.max(Math.max(q1, q2), Math.max(q3, q4)) * s;
  t(3, 3);                                   /* два max + умножение на s */
  t(2, 2);                                   /* -(q + r) */
  return -(q + r);
}

/** float sdSeg(vec2 p, vec2 a, vec2 b, float r) — 11 инструкций, 22 компонентных. */
export function sdSeg(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay;
  const bax = bx - ax, bay = by - ay;
  t(2, 4);                                   /* pa = p - a, ba = b - a */
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay));
  t(4, 7);                                   /* dot(pa,ba) (1,3), dot(ba,ba) (1,3), деление (1,1) */
  t(1, 1);                                   /* clamp */
  const dx = pax - bax * h, dy = pay - bay * h;
  t(3, 6);                                   /* ba * h (1,2), pa - … (1,2)… */
  t(1, 2);
  const len = Math.sqrt(dx * dx + dy * dy);
  t(1, 4);                                   /* length */
  t(1, 1);                                   /* - r */
  return len - r;
}

/** float hash21(vec2 p) — 6 инструкций, 12 компонентных (без sin: см. комментарий шейдера). */
export function hash21(px, py) {
  let x = fract(px * 123.34), y = fract(py * 456.21);
  t(2, 4);                                   /* p * vec2(…) (1,2) + fract (1,2) */
  const dp = x * (px + 123.34 * 0 + x + 45.32) + y * (py * 0 + y + 45.32);
  /* p += dot(p, p + 45.32): dot = 2 умножения + сложение */
  t(1, 2);                                   /* p + 45.32 */
  t(1, 3);                                   /* dot(vec2, vec2) */
  x += dp; y += dp;
  t(1, 2);                                   /* p += … */
  const r = fract(x * y);
  t(2, 2);                                   /* умножение, fract */
  return r;
}

/** float vnoise(vec2 p) — 4 хеша + билинейка: 30 инструкций, 62 компонентных. */
export function vnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  t(1, 2);                                   /* floor(vec2) */
  let fx = px - ix, fy = py - iy;
  t(1, 2);                                   /* fract(vec2) */
  fx = fx * fx * (3.0 - 2.0 * fx);
  fy = fy * fy * (3.0 - 2.0 * fy);
  t(4, 8);                                   /* f*f*(3-2f) по двум компонентам */
  const a = hash21(ix, iy);
  const b = hash21(ix + 1.0, iy);
  const c = hash21(ix, iy + 1.0);
  const d = hash21(ix + 1.0, iy + 1.0);
  t(4, 4);                                   /* i + vec2(1,0) и т. д. — 4 сложения vec2 */
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  t(2, 6);                                   /* mix(a,b,f.x), mix(c,d,f.x) */
  const r = ab + (cd - ab) * fy;
  t(1, 3);                                   /* mix(…, f.y) */
  return r;
}

/* Круг 32 (A12): полуширина переснята по run-маске эталона — стойки линейны от
   макушки, плечо одним гладким разбегом, борт почти вертикален. Лесенки больше нет:
   три smoothstep вместо одиннадцати clamp-строк, и это Дешевле прежних 55/55. */

/** float halfW(float t) — 17 инструкций, 26 компонентных. */
export function halfW(tt) {
  const y = BY0 + tt * BH;
  t(2, 2);                                   /* t * BH, + BY0 */
  let w = Math.min(333.0 + Math.max(y - 120.0, 0.0) * 0.517, 430.0);
  t(5, 5);                                   /* y-120, max, *0.517, +333, min */
  w += 60.0 * smoothstep(300.0, 350.0, y);
  t(3, 6);                                   /* smoothstep (1,4), *60, += */
  w += 60.0 * smoothstep(330.0, 410.0, y);
  t(3, 6);
  w += 40.0 * smoothstep(390.0, 500.0, y);
  t(3, 6);
  t(1, 1);                                   /* min(w, 580.0) */
  return Math.min(w, 580.0);
}

/** float bodyOnly(vec2 p) — halfW + 12 инструкций, 14 компонентных своих. */
export function bodyOnly(px, py) {
  const tt = clampf((py - BY0) / BH, 0.0, 1.0);
  t(2, 2);                                   /* p.y - BY0, / BH (clamp посчитан) */
  const ax = Math.abs(px - BX);
  t(2, 2);                                   /* p.x - BX, abs */
  const dSide = halfW(tt) - ax;
  t(1, 1);
  const yTop = 97.0 + 9.0 * (ax / 333.0) * (ax / 333.0);
  t(4, 4);                                   /* ax/333, квадрат, *9, +97 */
  const dEdge = Math.min(py - yTop, BOT - py);
  t(3, 3);                                   /* два вычитания, min */
  return smin(dSide, dEdge, 44.0);
}

/** vec2 rot2(vec2 p, float a) — 8 инструкций, 8 компонентных (cos, sin, 6 «*»/«±»). */
export function rot2(px, py, a) {
  const c = Math.cos(a), sn = Math.sin(a);
  t(2, 2);                                   /* cos(a), sin(a) */
  const x = c * px - sn * py;
  t(3, 3);                                   /* c*p.x, s*p.y, вычитание */
  const y = sn * px + c * py;
  t(3, 3);                                   /* s*p.x, c*p.y, сложение */
  return [x, y];
}

/** float finSd(vec2 q, vec2 r) — 10 инструкций, 14 компонентных (деление, length, −1, min, «*»). */
export function finSd(qx, qy, rx, ry) {
  const sx = qx / rx, sy = qy / ry;
  t(2, 2);                                   /* q / r — покомпонентно */
  const len = length2(sx, sy);
  t(1, 1);                                   /* − 1.0 */
  const k = Math.min(rx, ry);
  t(1, 1);                                   /* min(r.x, r.y) — константы, но компилятор держит */
  t(1, 1);                                   /* × min(r) */
  return (len - 1.0) * k;
}

/**
 * float railsSd(vec2 p) — 37 инструкций, 45 компонентных.
 *
 * Круг 31, A5 ред. 3: вместо двух `sdBox` — два приплюснутых эллипса (`finSd`) с наклоном
 * ±0,10 рад. У эталона над крышей видна только верхняя половина плавника, концы уходят
 * в крышу без вертикальных торцов; у бокса торцы читались «болтом». Дороже боксов
 * (было 21/36) — это цена формы, и она видна в замере.
 */
export function railsSd(px, py) {
  const l = rot2(px - 653.5, py - 97.5, 0.10);
  t(2, 2);                                   /* vec2(p.x − 653.5, p.y − 97.5) */
  t(1, 2);                                   /* vec2 результата rot2 */
  const a = finSd(l[0], l[1], 16.0, 9.5);
  const r = rot2(px - 1264.0, py - 98.0, -0.10);
  t(2, 2);
  t(1, 2);
  const b = finSd(r[0], r[1], 15.0, 9.0);
  t(1, 1);                                   /* min(a, b) */
  return Math.min(a, b);
}

const MIR_A = [500.0, 236.0], MIR_B = [452.0, 240.0], MIR_C = [417.0, 296.0], MIR_D = [509.0, 313.0];

/** float mirrorSd(vec2 p) — круг 32 (A12): камень + губа + короткая ножка. */
export function mirrorSd(px, py) {
  const mx = Math.abs(px - BX);
  t(2, 2);                                   /* p.x - BX, abs */
  t(1, 2);                                   /* vec2(mx, p.y) */
  const cap = sdQuad(mx, py, MIR_A, MIR_B, MIR_C, MIR_D, 26.0);
  const lipB = finSd(mx - 462.0, py - 306.0, 50.0, 13.0);
  t(2, 2);                                   /* vec2(q.x − 462, q.y − 306) */
  t(1, 2);                                   /* vec2(50, 13) — константы, компилятор держит */
  const stone = smin(cap, lipB, 7.0);
  const leg = sdSeg(mx, py, 503.0, 303.0, 521.0, 331.0, 5.0);
  return smin(stone, leg, 6.0);
}

/* ---------- знак: сэмплер подменяемый, по умолчанию знак выключен ---------- */

let MARK = null;
/** Подменить альфа-маску знака (для сверки с кадром, где знак включён). */
export function setMarkSampler(fn) { MARK = fn; }
function markAlpha(u, v) {
  t(1, 1);                                   /* texture(uMark, …): 1 инструкция SPIR-V (OpImageSampleImplicit) */
  COUNT.tex++;
  if (!MARK) return 0;
  return MARK(u, v);
}

/** void layers(vec2 p, float t, out float body, out vec3 light). */
export function layers(px, py, tt) {
  COUNT.layersCalls++;
  let body = 0;
  let light = [0, 0, 0];
  t(2, 6);                                   /* body = 0.0, light = vec3(0.0) */

  /* ранние выходы по полосам кадра */
  /* Ранние выходы по полосам кадра — ТЕРНАРНИКИ, а не `if`: компилятор раскрывает их
     в OpSelect, то есть обе ветви исполняются в КАЖДОМ пикселе. Экономия здесь не
     в операциях (их столько же), а в том, что результат ветви выбрасывается.
     Порт считает обе ветви всегда — как GPU. (Урок раунда 30: не принимать комментарий
     исходника за поведение железа.) */
  const inRailBand = py < 130.0;
  t(1, 1);                                   /* сравнение */
  const dRail = railsSd(px, py);             /* ветвь 1 тернарника */
  const dRailSel = inRailBand ? dRail : 9999.0;
  if (inRailBand) COUNT.railPixels++;
  /* объединение кузова и плавника — ГЛАДКОЕ: `-smin(-bodyOnly(p), dRail, 3.0)`.
     Резкий `max` оставлял у плавника вертикальную ступеньку на стыке с крышей.
     Цена: smin вместо max (+9 инструкций на вызов, а вызовов — до четырёх на пиксель
     в полосе отражения). */
  const dBody = -smin(-bodyOnly(px, py), dRailSel, 3.0);
  t(3, 3);                                   /* отрицание bodyOnly, отрицание результата, OpSelect */
  const inMirBand = py > 190.0 && py < 372.0;
  t(3, 3);                                   /* два сравнения + && */
  const dMirSd = mirrorSd(px, py);           /* ветвь 1 тернарника */
  const dMirRaw = inMirBand ? dMirSd : 9999.0;
  if (inMirBand) COUNT.mirrorPixels++;
  const d = Math.max(dBody, -dMirRaw);
  t(3, 3);                                   /* отрицание, max, OpSelect */
  const inside = smoothstep(-1.6, 1.6, d);

  /* заливка кузова */
  const mouth = Math.abs(py - 448.0);
  t(2, 2);                                   /* p.y - 448, abs */
  const wob = (vnoise(px * 0.011, 3.7) - 0.5) * 30.0 + (vnoise(px * 0.041, 9.1) - 0.5) * 10.0;
  t(2, 2);                                   /* p.x * 0.011, p.x * 0.041 */
  t(2, 4);                                   /* два vec2(…, константа) */
  t(5, 5);                                   /* два (-0.5), два (*30 / *10), сложение */
  const spread = smoothstep(0.44, 0.72, tt) * 470.0;
  t(1, 1);                                   /* * 470 */
  const mouthEdge = smoothstep(spread + 24.0, spread - 74.0, mouth + wob);
  t(4, 4);                                   /* spread+24, spread-74, mouth+wob, умножение ниже */
  body = inside * mouthEdge;
  t(1, 1);
  /* BOT+40 и BOT-10 — константы; glslang держит их как OpConstant, операций нет */
  const floorFade = smoothstep(BOT + 40.0, BOT - 10.0, py);
  body *= floorFade;
  t(1, 1);

  /* контровой свет */
  const rimProg = smoothstep(0.42, 0.68, tt);
  const trace = length2((px - BX) * 0.90, (py - BY0) * 1.02) / 700.0;
  t(4, 4);                                   /* p.x-BX, *0.90, p.y-BY0, *1.02 */
  t(1, 1);                                   /* деление /700 */
  const shown = smoothstep(trace, trace + 0.10, rimProg);
  t(1, 1);                                   /* trace + 0.10 */
  const ad = Math.abs(dBody);
  t(1, 1);
  const outward = smoothstep(3.0, -3.0, dBody);
  const rimK = (0.14 * expf(-ad * 0.16) + 0.28 * expf(-ad * 0.055) * outward) * shown;
  t(7, 7);                                   /* два exp по 2 скаляра, *0.14, *0.28, *outward, сложение, *shown */
  const L1 = RIM.map((c) => c * rimK);
  t(1, 3);                                   /* RIM * … */
  light = [light[0] + L1[0], light[1] + L1[1], light[2] + L1[2]];
  t(1, 3);                                   /* light += RIM * … */

  /* свечение зеркала — только по внешней кромке */
  const dMir = Math.abs(dMirRaw);
  t(1, 1);
  const mirGlow = smoothstep(0.02, 0.40, (Math.abs(px - BX) - 452.0) / 94.0) * smoothstep(332.0, 292.0, py);
  t(4, 4);                                   /* abs(p.x-BX), -452, /94, умножение smoothstep'ов */
  t(1, 1);
  const L3 = RIM.map((c) => c * expf(-dMir * 0.18) * shown * 0.42 * mirGlow);
  t(5, 5);                                   /* -dMir, *0.18, *shown, *0.42, *mirGlow */
  t(1, 3);                                   /* RIM * … */
  light = [light[0] + L3[0], light[1] + L3[1], light[2] + L3[2]];
  t(1, 3);
  const mirCore = smoothstep(2.4, 0.0, dMir) * shown * 0.12 * mirGlow;
  t(3, 3);                                   /* *shown, *0.12, *mirGlow */
  light = [light[0] + RIM[0] * mirCore, light[1] + RIM[1] * mirCore, light[2] + RIM[2] * mirCore];
  t(1, 3);
  /* светлая кромка по нижней губе зеркала */
  const mirLip = smoothstep(2.2, 0.0, dMir) * smoothstep(276.0, 296.0, py) * shown;
  t(2, 2);                                   /* два smoothstep посчитаны как (1,4) каждый; здесь *shown и ниже *0.30 */
  const lipV = mirLip * 0.30;
  t(1, 1);
  light = [light[0] + 0.66 * lipV, light[1] + 0.086 * lipV, light[2] + 0.033 * lipV];
  t(1, 3);                                   /* light += vec3(…) * … */

  /* отблеск кузова: капот и плечи (круг 32, A12; правка 2 — σ 15 и один пик по x) */
  const grow = smoothstep(0.40, 0.60, tt);
  const sheenY = expf(-powf((py - 352.0) / 15.0, 2.0));
  t(3, 3);                                   /* p.y-352, /15, отрицание (pow/exp посчитаны) */
  const sxA = Math.abs(px - BX);
  t(2, 2);                                   /* p.x-BX, abs */
  const sh1 = expf(-powf((sxA - 300.0) / 75.0, 2.0)) * 0.45;
  t(4, 4);                                   /* -300, /75, отрицание, *0.45 (pow/exp посчитаны) */
  const sheenX = 0.05 + sh1;
  t(1, 1);                                   /* сложение */
  const sheenK = sheenY * sheenX * inside * grow;
  t(3, 3);                                   /* три умножения (smoothstep посчитан как (1,4)) */
  light = [light[0] + SHEEN[0] * sheenK, light[1] + SHEEN[1] * sheenK, light[2] + SHEEN[2] * sheenK];
  t(1, 3);
  /* нейтральная подсветка двери и стойки ниже отблеска (круг 32, правка 2) */
  const fillY = smoothstep(348.0, 404.0, py) * (1.0 - smoothstep(404.0, 428.0, py));
  t(2, 2);                                   /* 1.0-…, умножение (два smoothstep посчитаны сами) */
  const fillX = 0.30 + 0.70 * smoothstep(120.0, 470.0, sxA);
  t(2, 2);                                   /* *0.70, +0.30 */
  const fillK = fillY * fillX * inside * grow;
  t(3, 3);                                   /* три умножения */
  light = [light[0] + NEUT[0] * fillK, light[1] + NEUT[1] * fillK, light[2] + NEUT[2] * fillK];
  t(1, 3);

  /* полоса ДХО: кривая эталона, клин, скруглённые концы, ореол (круг 32, A12) */
  const reveal = smoothstep(0.12, 0.44, tt);
  const mx = Math.abs(px - BX);
  t(2, 2);                                   /* p.x - BX, abs */
  const knee = clampf((540.0 - mx) / 252.0, 0.0, 1.0);
  t(2, 2);                                   /* 540-mx, /252 (clamp посчитан) */
  const sy = 447.7 - 31.2 * (1.0 - smoothstep(0.0, 1.0, knee));
  t(3, 3);                                   /* 1.0-…, *31.2, вычитание */
  const hw = 2.1 + 14.2 * knee * (1.0 - knee);
  t(4, 4);                                   /* 1.0-knee, *knee, *14.2, +2.1 */
  const axEnd = Math.max(Math.max(mx - 542.0, 51.0 - mx), 0.0);
  t(4, 4);                                   /* mx-542, 51-mx, два max */
  const rBar = length2(axEnd, py - sy);
  t(1, 1);                                   /* p.y - sy (length посчитан) */
  const cut = 1.0 - smoothstep(reveal * 542.0 - 6.0, reveal * 542.0 + 2.0, mx);
  t(3, 3);                                   /* reveal*542-6, +2, 1.0-… */
  const barCore = (1.0 - smoothstep(hw - 0.7, hw + 2.3, rBar)) * cut;
  t(3, 3);                                   /* hw±, 1.0-…, *cut */
  light = [light[0] + WHITE[0] * barCore, light[1] + WHITE[1] * barCore, light[2] + WHITE[2] * barCore];
  t(1, 3);
  const barHalo = expf(-powf(rBar / 12.0, 2.0)) * cut * 0.12;
  t(3, 3);                                   /* /12, *cut, *0.12 (pow/exp посчитаны) */
  light = [light[0] + WHITE[0] * barHalo, light[1] + WHITE[1] * barHalo, light[2] + WHITE[2] * barHalo];
  t(1, 3);

  /* «искра» на кончике прорисовки */
  const drawEnd = 51.0 + reveal * 491.0;
  t(2, 2);                                   /* reveal*491, +51 */
  const spark = expf(-length2((mx - drawEnd) * 1.04, py - sy) * 0.16)
    * stepf(0.02, reveal) * (1.0 - smoothstep(0.90, 1.0, reveal));
  t(4, 4);                                   /* mx-drawEnd, *1.04, *0.16, отрицание */
  t(1, 2);                                   /* vec2(…, …) под length */
  t(2, 2);                                   /* два множителя (step, 1.0-…) */
  const sp = WHITE.map((c) => c * spark * 3.2);
  t(2, 2);                                   /* *3.2, WHITE * … */
  t(1, 3);
  light = [light[0] + sp[0], light[1] + sp[1], light[2] + sp[2]];
  t(1, 3);

  /* знак: пропорция эталона, без переворота, ядро через max() (круг 32, A12) */
  const ec = [961.0, 490.0];
  const eh = [37.5, 46.5];                   /* константы: в SPIR-V свернуты, порт не считает */
  const euvx = (px - ec[0]) / (eh[0] * 2.0) + 0.5;
  const euvy = 0.5 + (py - ec[1]) / (eh[1] * 2.0);
  t(5, 5);                                   /* p.x-ec.x, /75, +0.5, p.y-ec.y, /93 */
  t(1, 1);                                   /* 0.5 + … */
  t(2, 2);                                   /* eh.x*2 и eh.y*2 — glslang НЕ сворачивает: видно в SPIR-V */
  const inBox = stepf(0.0, euvx) * stepf(euvx, 1.0) * stepf(0.0, euvy) * stepf(euvy, 1.0);
  t(3, 3);                                   /* три умножения step */
  const aMark = markAlpha(clampf(euvx, 0, 1), clampf(euvy, 0, 1)) * inBox * 1.0;
  t(2, 2);                                   /* * inBox, * uMarkOn (clamp(euv) — FClamp над vec2) */
  if (aMark > 0) COUNT.markPixels++;
  const ink = smoothstep(0.40, 0.60, aMark);
  const edge = clampf(aMark * (1.0 - aMark) * 4.0, 0.0, 1.0);
  t(4, 4);                                   /* 1-a, *, *4, clamp */
  const core = Math.max(ink * smoothstep(0.40, 0.48, tt),
    edge * smoothstep(0.34, 0.42, tt) * (1.0 - smoothstep(0.42, 0.50, tt)));
  t(6, 6);                                   /* ink*ss, edge*ss, 1.0-ss, *, max — smoothstep'ы как (1,4) */
  light = [light[0] + WHITE[0] * core, light[1] + WHITE[1] * core, light[2] + WHITE[2] * core];
  t(1, 3);
  const glow = expf(-powf(length2((px - ec[0]) / 1.5, py - ec[1]) / 34.0, 2.0))
    * smoothstep(0.42, 0.50, tt) * 0.32;
  t(5, 5);                                   /* p.x-ec.x, /1.5, /34, отрицание, *ss*0.32 */
  t(1, 2);                                   /* vec2(…, …) под length */
  light = [light[0] + WHITE[0] * glow, light[1] + WHITE[1] * glow, light[2] + WHITE[2] * glow];
  t(1, 3);

  return { body, light };
}

/** vec3 bgAt(vec2 p, float t) — 34 инструкции, 60 компонентных. */
export function bgAt(px, py, tt) {
  const qx = (px - BX) / 1520.0, qy = (py - 120.0) / 780.0;
  t(4, 4);                                   /* два вычитания, два деления */
  const r = clampf(length2(qx, qy), 0.0, 1.45);
  t(1, 1);                                   /* clamp */
  let c = mixv3([0.520, 0.080, 0.020], [0.215, 0.034, 0.017], smoothstep(0.0, 1.10, r));
  const hz = [0.085, 0.013, 0.006];
  const e = expf(-Math.abs(py - 722.0) / 22.0);
  t(3, 3);                                   /* p.y-722, abs, /22, отрицание → 4 ниже */
  t(1, 1);
  c = [c[0] + hz[0] * e, c[1] + hz[1] * e, c[2] + hz[2] * e];
  t(1, 3);                                   /* c += vec3(…) * … */
  const pool = expf(-length2((px - BX) / 700.0, (py - 790.0) / 165.0) * 2.0);
  t(5, 5);                                   /* p.x-BX, /700, p.y-790, /165, *2.0, отрицание → 6 ниже */
  t(1, 1);
  const pl = [0.230, 0.040, 0.015];
  c = [c[0] + pl[0] * pool, c[1] + pl[1] * pool, c[2] + pl[2] * pool];
  t(1, 3);
  const fk = 1.0 + (0.55 - 1.0) * smoothstep(740.0, 1100.0, py);
  t(2, 2);                                   /* mix(1.0, 0.55, …) */
  c = [c[0] * fk, c[1] * fk, c[2] * fk];
  t(1, 3);                                   /* c *= … */
  const gk = smoothstep(0.0, 0.18, tt);
  c = [c[0] * gk, c[1] * gk, c[2] * gk];
  t(1, 3);                                   /* c *= … */
  return c;
}

/* ---------- главный проход ---------- */

/**
 * Один пиксель `void main()`.
 * @param fcx gl_FragCoord.x (центр пикселя)
 * @param fcy gl_FragCoord.y (центр пикселя; в GL растёт снизу — порт сам переворачивает в hero-y)
 * @param U   { res: [w, h], t: uT }
 * @param opts { collect, once } — `once` исполняет все ветки по разу для сверки со статикой SPIR-V.
 */
export function shadePixel(fcx, fcy, U, opts = {}) {
  const [rw, rh] = U.res;
  const ONCE = !!opts.once;
  T.pixels++;

  /* vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) */
  const fx = fcx, fy = rh - fcy;
  t(2, 4);                                   /* vec2 (1,2) + вычитание (1,2) */
  const aspect = rw / rh;
  t(1, 1);
  let px, py;
  if (aspect >= 0.85 || ONCE) {
    t(1, 1);                                 /* сравнение */
    const s = Math.max(rw / 1920.0, rh / 1080.0);
    t(3, 3);                                 /* два деления, max */
    px = (fx - rw * 0.5) / s + BX;
    py = (fy - rh * 0.415) / s + 448.0;
    t(6, 6);                                 /* rw*0.5, rh*0.415, два вычитания, два деления, два сложения → 8 ниже */
    t(2, 2);
  } else {
    t(1, 1);
    const k = 1.55 * rw / BW;
    t(2, 2);
    px = (fx - rw * 0.5) / k + BX;
    py = (fy - rh * 0.30) / k + BY0;
    t(8, 8);
  }
  const tt = clampf(U.t, 0.0, 1.0);

  const first = layers(px, py, tt);
  let body = first.body;
  let light = first.light;

  const nightK = smoothstep(0.72, 1.0, tt);
  let col = mixv3(bgAt(px, py, tt), [0.0322, 0.0504, 0.0826], nightK);
  const bk = clamp01(body);
  t(1, 1);                                   /* clamp(body, 0, 1) */
  col = mixv3(col, BODY, bk);

  /* отражение в полу: три зеркальных тапа layers() */
  const reflIn = smoothstep(0.60, 0.82, tt);
  const reflCond = py > FLOOR && reflIn > 0.002;
  t(3, 3);                                   /* p.y > FLOOR, reflIn > 0.002, && */
  if (reflCond || ONCE) {
    if (reflCond) COUNT.reflPixels++;
    let acc = [0, 0, 0];
    let wsum = 0;
    t(2, 6);                                 /* acc = vec3(0.0) (1,3), wsum = 0.0 (1,1)… */
    t(0, 2);                                 /* …плюс запись в стек: считаем как 2 компонентных */
    for (let i = 0; i < 3; i++) {
      t(2, 2);                               /* i++ (1,1), i < 3 (1,1) */
      const im1 = i - 1;
      const o = im1 * 10.0;
      t(2, 2);                               /* float(i-1), *10.0 */
      const pmx = px + o * 0.25;
      const pmy = 2.0 * FLOOR - py - o;
      t(5, 5);                               /* o*0.25, p.x+…, 2.0*FLOOR, -p.y, -o */
      t(1, 2);                               /* vec2 pm */
      const second = layers(pmx, pmy, tt);
      const w = 1.0 - 0.30 * Math.abs(im1);
      t(3, 3);                               /* abs(float(i-1)), *0.30, 1.0-… */
      const l2 = [second.light[0] + 0.02 * second.body, second.light[1] + 0.02 * second.body, second.light[2] + 0.02 * second.body];
      t(2, 6);                               /* vec3(0.02)*b2 (1,3), l2 + … (1,3) */
      acc = [acc[0] + l2[0] * w, acc[1] + l2[1] * w, acc[2] + l2[2] * w];
      t(2, 6);                               /* (l2)*w (1,3), acc += (1,3) */
      wsum += w;
      t(1, 1);
    }
    /* ред. 4: затухание до низа кадра (1080), а не до FLOOR+280 = 1010 —
       иначе зеркальная копия ДХО на y = 2*FLOOR-448 = 1012 отсекается (разбор §9) */
    const gap = clampf((py - FLOOR) / (1080.0 - FLOOR), 0.0, 1.0);
    t(2, 2);                                 /* p.y - FLOOR, /350.0 */
    const fade = 1.0 - smoothstep(0.60, 1.0, gap);
    t(1, 1);                                 /* 1.0 - smoothstep */
    const rk = 0.38 * reflIn * fade;
    t(2, 2);                                 /* *0.38, *reflIn */
    const quo = [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum];
    t(1, 3);                                 /* acc / wsum */
    const add = [quo[0] * rk, quo[1] * rk, quo[2] * rk];
    t(1, 3);                                 /* * (0.30*reflIn*pow) */
    col = [col[0] + add[0], col[1] + add[1], col[2] + add[2]];
    t(1, 3);                                 /* col += … */
  }

  col = [col[0] + light[0], col[1] + light[1], col[2] + light[2]];
  t(1, 3);                                   /* col += light */
  /* `light` накапливался в ~14 присваиваниях: каждое в SPIR-V — чтение и запись
     локального vec3 (OpLoad/OpStore), то есть память, а не арифметика. Порт считает
     только арифметику — как и договорились в раунде 30 (память уходит в регистры). */
  const nk = 1.0 + (0.62 - 1.0) * nightK;
  t(2, 2);                                   /* mix(1.0, 0.62, nightK) */
  col = [col[0] * nk, col[1] * nk, col[2] * nk];
  t(1, 3);                                   /* col *= … */
  const dth = hash12(fx + tt * 91.0, fy + tt * 91.0);
  t(3, 6);                                   /* t*91 (1,1) + frag + … (1,2) + vec2 (1,3) */
  const dk = (dth - 0.5) / 255.0;
  t(2, 2);
  col = [col[0] + dk, col[1] + dk, col[2] + dk];
  t(1, 3);
  const oR = Math.max(col[0], 0), oG = Math.max(col[1], 0), oB = Math.max(col[2], 0);
  t(2, 7);                                   /* max(col, 0.0) (1,3) + vec4(…, 1.0) (1,4) */

  const color = [oR, oG, oB];
  if (opts.collect) return { color, body, iters: 0, hit: body > 0.5 };
  return color;
}

/* ============================ прогоны ============================ */

/**
 * Измерительный прогон. fwidth в новой сцене нет, поэтому probe-прогон не нужен:
 * каждый пиксель считается ровно один раз, как на GPU.
 */
export function renderFrame({ width, height, t = 0.5, once = false }) {
  const U = { res: [width, height], t };
  const pixels = width * height;
  const out = new Uint8Array(pixels * 3);
  const inst = new Float64Array(pixels);
  const scalar = new Float64Array(pixels);
  /* 1 — пиксель в переходной зоне заливки кузова (0,02 < body < 0,98): там цвет меняется
     от фона к кузову на расстоянии меньше пикселя, и расхождение float32/float64 законно */
  const edgeZone = new Uint8Array(pixels);

  resetTally();
  resetCounts();
  let maxInst = 0, minInst = Infinity, maxScalar = 0;
  for (let y = 0; y < height; y++) {
    const fcy = height - (y + 0.5);
    for (let x = 0; x < width; x++) {
      const i0 = T.inst, s0 = T.scalar;
      const r = shadePixel(x + 0.5, fcy, U, { collect: true, once });
      const di = T.inst - i0, ds = T.scalar - s0;
      const i = y * width + x;
      inst[i] = di; scalar[i] = ds;
      edgeZone[i] = r.body > 0.02 && r.body < 0.98 ? 1 : 0;
      if (di > maxInst) maxInst = di;
      if (di < minInst) minInst = di;
      if (ds > maxScalar) maxScalar = ds;
      const o = i * 3;
      out[o] = Math.max(0, Math.min(255, Math.round(r.color[0] * 255)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(r.color[1] * 255)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(r.color[2] * 255)));
    }
  }

  const sorted = (a) => Float64Array.from(a).sort();
  const sI = sorted(inst), sS = sorted(scalar);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];

  return {
    data: out, width, height, time: t, pixels, once,
    ops: {
      instTotal: T.inst, scalarTotal: T.scalar,
      instPerPx: T.inst / pixels, scalarPerPx: T.scalar / pixels,
      instPerPxMax: maxInst, instPerPxMin: minInst === Infinity ? 0 : minInst,
      scalarPerPxMax: maxScalar,
      instPerPxP50: q(sI, 0.5), scalarPerPxP50: q(sS, 0.5),
      instPerPxP95: q(sI, 0.95), scalarPerPxP95: q(sS, 0.95),
      texPerPx: COUNT.tex / pixels,
      reflPixelsRatio: COUNT.reflPixels / pixels,
      layersPerPx: COUNT.layersCalls / pixels,
    },
    counts: { ...COUNT },
    perPixel: { inst, scalar, edgeZone },
  };
}

/* ============================ вызов уровня main ============================ */

/**
 * Стоимость одного вызова `layers()` для статического сравнения со SPIR-V.
 * Динамика (`layersCostDynamic`) и статика — РАЗНЫЕ числа, и это принципиально:
 *
 *   • динамика считает только те ветви тернарников-гейтов, которые исполняются
 *     в данном пикселе (рейлинги — только при p.y < 130, зеркало — только в поясе
 *     190…372). Так работает GPU: ветка не исполняется — её операций нет;
 *   • статика SPIR-V держит в теле функции ОБЕ ветви: компилятор не может выбросить
 *     ни одну, потому что условие зависит от координаты пикселя.
 *
 * Поэтому для сверки с glslang вызываем `layers` в точке у крыши в поясе зеркала
 * (px = BX − 500, py = 120): исполняются и `railsSd`, и `mirrorSd`.
 */
export function layersCost() {
  const i0 = T.inst, s0 = T.scalar;
  layers(460, 120, 0.5);
  return { inst: T.inst - i0, scalar: T.scalar - s0 };
}

/** Динамическая стоимость одного вызова `layers()` в точке вне обеих полос-гейтов. */
export function layersCostDynamic(px = 960, py = 500, tt = 0.5) {
  const i0 = T.inst, s0 = T.scalar;
  layers(px, py, tt);
  return { inst: T.inst - i0, scalar: T.scalar - s0 };
}

/* ---------- литералы, которые порт считает неизменными в живом SCENE_FS ---------- */

/**
 * Порт снят с конкретной редакции сцены (круг 31, A5 v2.1). Если сцену снова поменяют,
 * `measure-intro.mjs` упадёт по этим литералам, а не посчитает чужой шейдер молча.
 */
export const PORT_SOURCE_LITERALS = [
  ['кадр 1920×1080: BW 1150, BX 960, BY0 95, BH 715, BOT 810, FLOOR 730',
    /const float BW\s+= 1150\.0;[\s\S]{0,600}const float FLOOR = 730\.0;/],
  ['полуширина: стойки 333+0,517·(y−120) до 430, плечо 60/60/40, борт 580 (круг 32)',
    /float w = min\(333\.0 \+ max\(y - 120\.0, 0\.0\) \* 0\.517, 430\.0\);[\s\S]{0,300}40\.0 \* smoothstep\(390\.0, 500\.0, y\)/],
  ['кузов: купол yTop 97+9·(ax/333)², smin(dSide, dEdge, 44.0) (круг 32)',
    /float yTop = 97\.0 \+ 9\.0 \* \(ax \/ 333\.0\) \* \(ax \/ 333\.0\);[\s\S]{0,160}smin\(dSide, dEdge, 44\.0\)/],
  ['плавники: finSd(rot2(653.5,97.5,0.10),16,9.5) и finSd(rot2(1264,98,-0.10),15,9)',
    /finSd\(rot2\(vec2\(p\.x - 653\.5, p\.y - 97\.5\), 0\.10\), vec2\(16\.0, 9\.5\)\)[\s\S]{0,160}finSd\(rot2\(vec2\(p\.x - 1264\.0, p\.y - 98\.0\), -0\.10\), vec2\(15\.0, 9\.0\)\)/],
  ['объединение с кузовом гладкое: -smin(-bodyOnly(p), dRail, 3.0)', /-smin\(-bodyOnly\(p\), dRail, 3\.0\)/],
  ['полосы-гейты: рейлинги p.y < 130, зеркало 190…372',
    /p\.y < 130\.0 \? railsSd\(p\) : 9999\.0[\s\S]{0,400}p\.y > 190\.0 && p\.y < 372\.0/],
  ['зеркало: камень (500,236)(452,240)(417,296)(509,313) r26 + губа finSd(462,306,50,13) + ножка (503,303)-(521,331) r5',
    /vec2 a = vec2\(500\.0, 236\.0\), b = vec2\(452\.0, 240\.0\), c = vec2\(417\.0, 296\.0\), d = vec2\(509.0, 313.0\)[\s\S]{0,420}sdSeg\(q, vec2\(503\.0, 303\.0\), vec2\(521\.0, 331\.0\), 5\.0\)/],
  ['заливка: mouth 448, wob 0.011/3.7 и 0.041/9.1, spread 0.44…0.72 × 470',
    /float mouth = abs\(p\.y - 448\.0\);[\s\S]{0,300}smoothstep\(0\.44, 0\.72, t\) \* 470\.0/],
  ['контровой свет: rimProg 0.42…0.68, trace /700, outward ss(3,−3,dBody), RIM·shown·(0.14·exp(-ad*0.16) + 0.28·exp(-ad*0.055)·outward) — узкий спад внутрь, пологое плато наружу, без белого ядра и без WARM',
    /smoothstep\(0\.42, 0\.68, t\)[\s\S]{0,1900}float outward = smoothstep\(3\.0, -3\.0, dBody\);\s*light \+= RIM \* shown \* \(0\.14 \* exp\(-ad \* 0\.16\) \+ 0\.28 \* exp\(-ad \* 0\.055\) \* outward\);/],
  ['свечение зеркала: 452/94, 332…292, RIM exp(-dMir*0.18)*0.42, RIM ss(2.4,0)*0.12, губа ss(2.2,0)*ss(276,296)*0.30',
    /\(abs\(p\.x - BX\) - 452\.0\) \/ 94\.0[\s\S]{0,260}RIM \* exp\(-dMir \* 0\.18\) \* shown \* 0\.42[\s\S]{0,120}smoothstep\(2\.4, 0\.0, dMir\) \* shown \* 0\.12[\s\S]{0,200}smoothstep\(276\.0, 296\.0, p\.y\) \* shown/],
  ['отблеск кузова: grow ss(0.40,0.60), sheenY exp(-((y-352)/15)²), sheenX 0,05+0,45·exp(-((ax-300)/75)²)',
    /float grow = smoothstep\(0\.40, 0\.60, t\);\s*float sheenY = exp\(-pow\(\(p\.y - 352\.0\) \/ 15\.0, 2\.0\)\);\s*float sheenX = 0\.05 \+ 0\.45 \* exp\(-pow\(\(abs\(p\.x - BX\) - 300\.0\) \/ 75\.0, 2\.0\)\);\s*light \+= SHEEN \* sheenY \* sheenX \* inside \* grow;/],
  ['нейтральная подсветка двери: fillY ss(348,404)·(1−ss(404,428)), fillX 0,30+0,70·ss(120,470), NEUT·inside·grow',
    /float fillY = smoothstep\(348\.0, 404\.0, p\.y\) \* \(1\.0 - smoothstep\(404\.0, 428\.0, p\.y\)\);\s*float fillX = 0\.30 \+ 0\.70 \* smoothstep\(120\.0, 470\.0, abs\(p\.x - BX\)\);\s*light \+= NEUT \* fillY \* fillX \* inside \* grow;/],
  ['ДХО: reveal 0.12…0.44, колено sy 447,7−31,2·(1−ss(knee)), клин hw 2,1+14,2·knee·(1−knee), концы axEnd, ядро ss(hw−0,7,hw+2,3), ореол exp(-(rBar/12)²)*0.12',
    /float reveal = smoothstep\(0\.12, 0\.44, t\);[\s\S]{0,500}447\.7 - 31\.2 \* \(1\.0 - smoothstep\(0\.0, 1\.0, knee\)\)[\s\S]{0,900}float hw = 2\.1 \+ 14\.2 \* knee \* \(1\.0 - knee\);[\s\S]{0,700}smoothstep\(hw - 0\.7, hw \+ 2\.3, rBar\)[\s\S]{0,400}light \+= WHITE \* exp\(-pow\(rBar \/ 12\.0, 2\.0\)\) \* cut \* 0\.12;/],
  ['искра: drawEnd 51+reveal*491, ×1.04, exp ×0.16, ×3.2, гаснет на reveal 0.90…1.0',
    /exp\(-length\(vec2\(\(mx - drawEnd\) \* 1\.04, p\.y - sy\)\) \* 0\.16\)/],
  ['знак: ec (961,490), eh (37.5,46.5), uv без переворота, ядро max(ink·ss, edge·ss·(1−ss)) = WHITE*core',
    /vec2 ec = vec2\(961\.0, 490\.0\);\s*vec2 eh = vec2\(37\.5, 46\.5\);[\s\S]{0,700}float core = max\(ink \* smoothstep\(0\.40, 0\.48, t\),[\s\S]{0,200}light \+= WHITE \* core;/],
  ['свечение знака: exp(-pow(length((x−ec)/1.5, y−ec)/34, 2)) · ss(0.42,0.50) · 0.32 (≤ 0.35)',
    /exp\(-pow\(length\(vec2\(\(p\.x - ec\.x\) \/ 1\.5, p\.y - ec\.y\)\) \/ 34\.0, 2\.0\)\)[\s\S]{0,120}\* 0\.32;/],
  ['фон: q /1520 и /780 от (960,120), горизонт 722/22, пул 700/790/165, низ 740…1100 ×0.55, ss(0,0.18)',
    /\(p\.x - BX\) \/ 1520\.0, \(p\.y - 120\.0\) \/ 780\.0[\s\S]{0,800}c \*= smoothstep\(0\.0, 0\.18, t\);/],
  ['ночь: ss(0.72,1.0) к #070B12 (0.0322,0.0504,0.0826), финал ×0.62',
    /smoothstep\(0\.72, 1\.0, t\)[\s\S]{0,200}vec3\(0\.0322, 0\.0504, 0\.0826\)[\s\S]{0,1600}mix\(1\.0, 0\.62, nightK\)/],
  ['отражение: ss(0.60,0.82), 3 тапа o=(i-1)*10, x+o*0.25, 2*FLOOR-y-o, w=1-0.3|i-1|, ×0.38, gap /(1080-FLOOR), fade 1-ss(0.60,1)',
    /smoothstep\(0\.60, 0\.82, t\)[\s\S]{0,500}for \(int i = 0; i < 3; i\+\+\)[\s\S]{0,700}gap = clamp\(\(p\.y - FLOOR\) \/ \(1080\.0 - FLOOR\)[\s\S]{0,200}0\.38 \* reflIn \* fade/],
  ['раскладка: ландшафт aspect ≥ 0.85, s = max(rx/1920, ry/1080), центр (0.5, 0.415); портрет k = 1.55 rx/BW, 0.30',
    /if \(aspect >= 0\.85\)[\s\S]{0,300}1\.55 \* uRes\.x \/ BW/],
  ['дизеринг: hash12(frag + t*91)/255', /hash12\(frag \+ t \* 91\.0\) - 0\.5\) \/ 255\.0/],
];
