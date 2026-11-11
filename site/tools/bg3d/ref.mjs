/**
 * CPU-порт фрагментного шейдера `src/client/bg3d/shader.ts` — строка в строку.
 *
 * Зачем он нужен, если есть GPU-шейдер:
 *
 *  1. **Считать стоимость кадра.** В песочнице нет GPU, поэтому «сколько операций на пиксель»
 *     измеряется здесь: порт считает две метрики — `inst` (инструкции в гранулярности SPIR-V: одна
 *     векторная операция = одна инструкция) и `scalar` (компонентные операции: vec3 * scalar = 3).
 *     Первая сверяется со статическим подсчётом glslang (scripts/bg3d-shader-check.mjs),
 *     вторая идёт в модель fps. Сверка сошлась: hash21 = 7 инструкций и там, и там,
 *     vnoise = 16 (см. отчёт §2).
 *
 *  2. **Показать, как это выглядит**, без GPU: `renderFrame()` пишет настоящий PNG
 *     (tools/bg3d/frames.mjs). Это не «мокап в фотошопе» и не генерация картинки —
 *     это ровно та математика, что исполняется на GPU, посчитанная на CPU.
 *
 * Порт намеренно не оптимизирован: оптимизация скрыла бы число операций.
 * Все `t(inst, scalar)` стоят рядом со строкой, к которой относятся, — их можно
 * пересчитать руками по исходному GLSL.
 */

export const T = { inst: 0, scalar: 0, pixels: 0 };
export function resetTally() { T.inst = 0; T.scalar = 0; T.pixels = 0; }
function t(inst, scalar = inst) { T.inst += inst; T.scalar += scalar; }

/* ---------- встроенные функции GLSL ---------- */
const fract = (v) => v - Math.floor(v);
/* smoothstep в GLSL: t = clamp((x-e0)/(e1-e0)); t*t*(3-2t) */
function smoothstep(e0, e1, x) {
  const d = e1 - e0;
  const tt = Math.min(1, Math.max(0, (x - e0) / (d === 0 ? 0 : d)));
  return tt * tt * (3 - 2 * tt);
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, tt) => a + (b - a) * tt;

/* ---------- шум ---------- */

/** float hash21(vec2 p) — SPIR-V: 7 инструкций, 10 компонентных. */
export function hash21(px, py) {
  let x = fract(px * 0.3183099);
  let y = fract(py * 0.3678794);
  t(2, 4);                                   /* p * vec2(...) + fract: 2 инструкции, 4 компонентных */
  x *= 17; y *= 17;
  t(1, 2);                                   /* p *= 17.0 (VectorTimesScalar) */
  const r = fract(x * y * (x + y));
  t(4, 4);                                   /* mul, add, mul, fract */
  return r;
}

/** float vnoise(vec2 p) — SPIR-V: 16 инструкций (включая 4 вызова hash21), 27 своих компонентных. */
export function vnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  t(1, 2);                                   /* floor(vec2) */
  const fx = px - ix, fy = py - iy;
  t(1, 2);                                   /* fract(vec2) */
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  t(4, 8);                                   /* f*f*(3-2f) по двум компонентам */
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  t(7, 6);                                   /* 4 вызова (4 инструкции) + 3 сложения vec2 (3 инструкции, 6 компонентных) */
  const r = mix(mix(a, b, ux), mix(c, d, ux), uy);
  t(3, 9);                                   /* 3 × mix */
  return r;
}

/* ---------- SDF ---------- */

/** SPIR-V: sdRoundBox 9 инструкций, sdCircle 2, sdSeg 10, smin 10. */
export function sdRoundBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  t(3, 6);                                   /* abs(vec2), - b + r (2 инструкции, 4 компонентных) */
  const mx = Math.max(qx, 0), my = Math.max(qy, 0);
  const inner = Math.min(Math.max(qx, qy), 0);
  t(3, 3);                                   /* max(qx,qy), min(...,0), max(q,0) как vec2 → 3 инструкции */
  const len = Math.sqrt(mx * mx + my * my);
  t(1, 4);                                   /* length(max(q,0)): 2 mul + add + sqrt */
  return inner + len - r;
}

export function sdCircle(px, py, r) {
  const len = Math.sqrt(px * px + py * py);
  t(1, 3);                                   /* length(p) */
  return len - r;
}

export function sdSeg(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay;
  const bax = bx - ax, bay = by - ay;
  t(2, 4);                                   /* p-a, b-a */
  const dot = pax * bax + pay * bay;
  const dotbb = bax * bax + bay * bay;
  t(1, 5);                                   /* dot(pa,ba) (1 инструкция, 3 компонентных) + dot(ba,ba) */
  const h = Math.min(1, Math.max(0, dot / dotbb));
  t(2, 2);                                   /* div + clamp */
  const dx = pax - bax * h, dy = pay - bay * h;
  t(2, 4);                                   /* ba*h, pa - ... */
  const len = Math.sqrt(dx * dx + dy * dy);
  t(1, 4);                                   /* length */
  return len - r;
}

export function smin(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + 0.5 * (b - a) / k));
  t(5, 5);                                   /* b-a, *0.5, +0.5, /k, clamp */
  const r = mix(b, a, h) - k * h * (1 - h);
  t(5, 5);                                   /* mix(3) + (1-h), k*h*(1-h), вычитание */
  return r;
}

/* ---------- профиль машины: тот же модуль, что у шейдера ----------
   Порт обязан считать ТУ ЖЕ геометрию, иначе оп/px и кадры врут. Поэтому он
   не повторяет формулы, а берёт их из единственного источника —
   `src/client/car-profile.ts` (задание №54). */
const profile = await import('../../src/client/car-profile.ts');
export const CAR_SCALE = profile.SCALE.bg3d;
export const CAR_GROUND = profile.SCENE.ground;
export const CAR_TYRE_R = profile.CAR.tyre / 2;
export const CAR_AXLE_F = profile.SCENE.axleFront;
export const CAR_AXLE_R = profile.SCENE.axleRear;

/**
 * Стоимость одного обращения к профилю, посчитанная по SPIR-V
 * (`scripts/bg3d-shader-check.mjs`, byFunc), а не на глаз:
 * pTop 101 + pBottom 17 + pArch×2 10 + carProfile 12 + carSdf 5 = 145 арифм.
 * Если профиль в шейдере поменяется, эти числа надо пересчитать — иначе
 * оп/px разойдётся с компилятором, а бюджет держится именно на них.
 */
export const PROFILE_COST = { inst: 145, scalar: 130 };

/**
 * Стоимость carTrim() — по SPIR-V, как и PROFILE_COST. Внутри: один pTop (101)
 * плюс pBelt (8), две прямые стоек (по 4), два max/smoothstep-каскада и сборка vec4.
 * Пересчитывается при любом изменении carTrim в car-profile.ts, иначе оп/px
 * разойдётся с компилятором, а бюджет держится именно на этих числах.
 */
export const TRIM_COST = { inst: 132, scalar: 120 };
function profileCalls() { t(PROFILE_COST.inst, PROFILE_COST.scalar); }

/** float carSdf(vec2 q) — единицы сцены → метры модуля → carProfile(). */
export function carSdf(qx, qy) {
  t(4, 4);                                           /* /CAR_UNITS, -CAR_GROUND, вызов, *CAR_UNITS */
  profileCalls();
  return profile.carProfileJS(qx / CAR_SCALE, (qy - CAR_GROUND) / CAR_SCALE) * CAR_SCALE;
}

/* ---------- палитра (из tokens.css) ---------- */
export const PALETTE = {
  night: [0x0b / 255, 0x14 / 255, 0x10 / 255],
  deep: [0x10 / 255, 0x20 / 255, 0x1a / 255],
  brass: [0xe0 / 255, 0xa9 / 255, 0x6d / 255],
  copper: [0xc8 / 255, 0x7f / 255, 0x45 / 255],
  mist: [0xb7 / 255, 0xc4 / 255, 0xbb / 255],
  danger: [0xe8 / 255, 0x83 / 255, 0x6b / 255],
};

/**
 * Один пиксель. Координаты: uvx/uvy — 0..1 (как vUv), fcx/fcy — физические пиксели
 * (как gl_FragCoord). Возвращает [r,g,b] в 0..1.
 *
 * U: { res:[w,h], time, scroll, pointer:[x,y], mode:0|1, quality:0|1|2, fade }
 */
export function shadePixel(uvx, uvy, fcx, fcy, U) {
  const P = PALETTE;
  const [rw, rh] = U.res;
  const aspect = rw / Math.max(rh, 1);
  t(2, 2);                                   /* max + div */

  let px = (uvx - 0.5) * 2;
  let py = (uvy - 0.5) * 2;
  t(2, 4);                                   /* (vUv-0.5)*2.0 */
  px *= aspect;
  t(1, 1);

  const baseR = mix(P.night[0], P.deep[0], clamp01(uvy));
  const baseG = mix(P.night[1], P.deep[1], clamp01(uvy));
  const baseB = mix(P.night[2], P.deep[2], clamp01(uvy));
  t(2, 11);                                  /* clamp(1 инструкция, 2 компонентных) + mix(vec3) = 9 компонентных */
  let cR = baseR, cG = baseG, cB = baseB;

  const tm = U.time;
  const hy = 0.10 + U.pointer[1] * 0.03 - U.scroll * 0.22;
  t(4, 4);

  /* ---------- воздух/стена над горизонтом ---------- */
  const kk = clamp01((py - hy) / Math.max(1.0 - hy, 0.001));
  t(4, 5);
  const pw = Math.pow(kk, 0.75);
  t(1, 4);                                   /* pow */
  cR = mix(P.deep[0], P.night[0], pw);
  cG = mix(P.deep[1], P.night[1], pw);
  cB = mix(P.deep[2], P.night[2], pw);
  t(1, 9);                                   /* mix(vec3) */
  const shaft = vnoise(px * 1.25 + tm * 0.017, py * 0.55 - tm * 0.031);
  t(7, 7);                                   /* аргументы vec2 + вызов */
  const mk = 1.0 - kk;
  cR += P.mist[0] * 0.055 * shaft * mk;
  cG += P.mist[1] * 0.055 * shaft * mk;
  cB += P.mist[2] * 0.055 * shaft * mk;
  t(5, 13);
  /* вертикальные лучи от ламп */
  const ray = vnoise(px * 0.85 - tm * 0.008, 1.5);
  t(4, 3);                                   /* аргументы (3) + вызов */
  const rayM = 0.045 * ray * mk * smoothstep(0.0, 0.6, py);
  t(5, 8);                                   /* smoothstep + 4 умножения */
  cR += P.brass[0] * rayM;
  cG += P.brass[1] * rayM;
  cB += P.brass[2] * rayM;
  t(3, 6);
  const glx = (px - 0.78) * 0.85, gly = (py - 0.62) * 1.50;
  const glen = Math.sqrt(glx * glx + gly * gly);
  const glow = Math.exp(-glen * 1.35);
  t(8, 14);
  cR += P.copper[0] * 0.34 * glow;
  cG += P.copper[1] * 0.34 * glow;
  cB += P.copper[2] * 0.34 * glow;
  t(3, 9);

  /* ---------- пол ---------- */
  if (py < hy) {
    t(1, 1);                                 /* сравнение ветки */
    const dd = Math.max(hy - py, 0.030);
    const z = 1.0 / dd;
    const fog = Math.exp(-z * 0.055);
    t(6, 8);                                 /* max, sub, div, mul, negate, exp */
    const fuvx = px * z * 0.55 + U.pointer[0] * 0.60;
    const fuvy = z * 0.55 - tm * 0.22;
    t(6, 6);
    const n1 = vnoise(fuvx * 1.60, fuvy * 1.60);
    t(3, 3);
    let dust = n1;
    if (U.quality > 0.5) {
      t(1, 1);
      const n2 = vnoise(fuvx * 4.30 + 11.7, fuvy * 4.30 + 11.7);
      t(5, 5);
      dust = n1 * 0.62 + n2 * 0.38;
      t(4, 4);
    }
    const dustMix = 0.35 + dust * 0.85;
    cR = mix(P.night[0], P.deep[0], dustMix);
    cG = mix(P.night[1], P.deep[1], dustMix);
    cB = mix(P.night[2], P.deep[2], dustMix);
    t(3, 13);
    if (U.quality > 1.5) {
      t(1, 1);
      const wet = vnoise(fuvx * 6.0, fuvy * 0.55 - tm * 0.50);
      t(5, 5);
      cR += P.brass[0] * 0.14 * wet * fog;
      cG += P.brass[1] * 0.14 * wet * fog;
      cB += P.brass[2] * 0.14 * wet * fog;
      t(4, 12);
    }
    const plx = (px - 0.42) * 0.70, ply = (py + 0.46) * 1.25;
    const plen = Math.sqrt(plx * plx + ply * ply);
    const pool = Math.exp(-plen * 1.05);
    t(8, 14);
    const fogMix = 0.30 + 0.70 * fog;
    cR += P.copper[0] * 0.70 * pool * fogMix;
    cG += P.copper[1] * 0.70 * pool * fogMix;
    cB += P.copper[2] * 0.70 * pool * fogMix;
    t(5, 13);
    const clx = (px + 0.72) * 0.80, cly = (py + 0.30) * 1.60;
    const clen = Math.sqrt(clx * clx + cly * cly);
    const cool = Math.exp(-clen * 1.30);
    t(8, 14);
    cR += P.mist[0] * 0.075 * cool * fogMix;
    cG += P.mist[1] * 0.075 * cool * fogMix;
    cB += P.mist[2] * 0.075 * cool * fogMix;
    t(4, 12);
    const dark = 0.45 + 0.55 * fog;
    cR = mix(P.deep[0] * 0.85, cR, dark);
    cG = mix(P.deep[1] * 0.85, cG, dark);
    cB = mix(P.deep[2] * 0.85, cB, dark);
    t(6, 12);
  }

  /* ---------- дымка у горизонта ---------- */
  const haze = Math.exp(-Math.abs(py - hy) * 9.0);
  cR += P.brass[0] * 0.22 * haze;
  cG += P.brass[1] * 0.22 * haze;
  cB += P.brass[2] * 0.22 * haze;
  t(8, 12);

  /* ---------- вариант B: силуэт в глубине ---------- */
  if (U.mode > 0.5) {
    t(1, 1);
    cR *= 0.22; cG *= 0.22; cB *= 0.22;      /* сцена B тёмная, как в проде */
    t(0, 3);
  }
  if (U.mode > 0.5 && !U.noCar) {
    const depth = 0.58;
    const sc = mix(0.80, 0.46, depth);
    t(1, 3);
    /* как в шейдере: на узком кадре силуэт тянем к центру и приподнимаем */
    const aspectR = U.res[0] / Math.max(U.res[1], 1);
    const wide = smoothstep(0.46, 1.40, aspectR);
    const kx = mix(0.35, 1.0, wide);
    const ky = mix(0.55, 1.0, wide);
    const scA = sc * mix(0.62, 1.0, smoothstep(0.40, 0.86, aspectR));
    const lift = (1.0 - wide) * 0.28;
    const cpx = (0.24 + U.pointer[0] * 0.10 * (1.0 - depth)) * kx;
    const cpy = hy - 0.155 - U.scroll * 0.05 + U.pointer[1] * 0.035 - (1.0 - ky) * 0.30 + lift;
    t(9, 9);
    const qx = (px - cpx) / scA;
    const qy = (py - cpy) / scA;
    t(4, 4);
    const fogC = Math.exp(-depth * 1.15);
    t(3, 4);

    const gy = qy - CAR_GROUND;
    /* как в шейдере: полуширина 0,55 L (a = 0.716), ниже земли тени нет */
    const shd = Math.exp(-(qx * qx * 0.716 + gy * gy * 90.0))
      * smoothstep(-0.055, -0.006, gy) * (1.0 - smoothstep(0.14, 0.30, gy));
    t(12, 14);
    const shdMul = 1.0 - 0.16 * shd;
    cR *= shdMul; cG *= shdMul; cB *= shdMul;
    t(4, 5);

    const sd = carSdf(qx, qy);
    t(1, 0);                                 /* вызов */
    const inside = 1.0 - smoothstep(-0.004, 0.004, sd);
    t(3, 6);                                 /* smoothstep (1 инструкция, ~5 компонентных) + вычитание */

    /* ---- тон кузова: четыре участка по X и три по Y (задание №57) ---- */
    const zn = Math.min(1.6, Math.max(0.0, (qy - CAR_GROUND) / (CAR_TYRE_R * CAR_SCALE * 2.0)));
    t(4, 4);
    const skirt = 1.0 - smoothstep(0.16, 0.26, zn);
    const sill  = 1.0 - smoothstep(0.26, 0.44, zn);
    const beltZ = smoothstep(0.62, 0.72, zn);
    t(3, 3);
    const bodyScale =
      (0.85 + 0.18 * smoothstep(-0.30, 0.42, qy))
      * (0.94 + 0.16 * smoothstep(0.55, 0.98, qy))
      * (1.0 - 0.26 * smoothstep(0.30, 0.86, -qx / CAR_SCALE))
      * (1.0 - 0.10 * smoothstep(0.30, 1.00, qx / CAR_SCALE))
      * (1.0 - 0.10 * skirt - 0.06 * sill);
    t(11, 11);
    let bodyR = mix(P.night[0], P.mist[0], 0.52) * bodyScale * 1.15;
    let bodyG = mix(P.night[1], P.mist[1], 0.52) * bodyScale * 1.15;
    let bodyB = mix(P.night[2], P.mist[2], 0.52) * bodyScale * 1.15;
    t(3, 12);

    /* ---- carTrim: стекло, стойки, подоконник (один pTop) ----
       Только на пикселях машины (inside > 0.002), как и в шейдере: машина — ~7 % кадра. */
    if (inside <= 0.002) {
      const atmo0 = 0.35 * (1 - fogC);
      const bSCALE0 = 0.55 + 0.45 * fogC;
      const inMix0 = inside;   /* как в шейдере: mix(col, тело, inside) */
      cR = mix(cR, mix(bodyR, cR, atmo0) * bSCALE0, inMix0);
      cG = mix(cG, mix(bodyG, cG, atmo0) * bSCALE0, inMix0);
      cB = mix(cB, mix(bodyB, cB, atmo0) * bSCALE0, inMix0);
      t(5, 21);
      var skipBody = true;
    } else { var skipBody = false; }
    if (!skipBody) {
    const tx = qx / CAR_SCALE, ty = (qy - CAR_GROUND) / CAR_SCALE;
    t(3, 4);
    const [trimGlass, trimPillar, trimBelt, trimTop] = profile.carTrimJS(tx, ty);
    t(TRIM_COST.inst, TRIM_COST.scalar);
    const glassMix = trimGlass * beltZ;
    bodyR = mix(bodyR, P.night[0] * 0.55, glassMix);
    bodyG = mix(bodyG, P.night[1] * 0.55, glassMix);
    bodyB = mix(bodyB, P.night[2] * 0.55, glassMix);
    t(4, 15);
    const topGl = 1.0 - smoothstep(0.010, 0.055, trimTop - ty);
    t(3, 3);
    const glint = 0.42 * trimGlass * topGl;
    bodyR += P.mist[0] * glint; bodyG += P.mist[1] * glint; bodyB += P.mist[2] * glint;
    t(3, 9);
    const lower = 1.0 - smoothstep(0.002, 0.009, Math.abs(ty - trimBelt));
    t(3, 4);
    const orn = 0.26 * trimPillar + 0.18 * lower * (Math.abs(tx) <= 1.30 ? 1 : 0);
    bodyR += P.mist[0] * orn; bodyG += P.mist[1] * orn; bodyB += P.mist[2] * orn;
    t(8, 21);

    /* ---- детали тоном (задание №57 §2.5) ---- */
    const qxm = tx, zig = ty;
    /* светлая кромка над юбкой: по ней низ машины отделяется от пола */
    const rimLow = (1.0 - smoothstep(0.0, 0.016, Math.abs(zig - 0.225))) * (Math.abs(qxm) <= 1.62 ? 1 : 0);
    const rimLowK = 0.42 * rimLow;
    bodyR += P.mist[0] * rimLowK; bodyG += P.mist[1] * rimLowK; bodyB += P.mist[2] * rimLowK;
    t(6, 9);
    t(6, 15);
    const mold1 = (1.0 - smoothstep(0.0, 0.012, Math.abs(zig - 0.315))) * (Math.abs(qxm) <= 1.45 && qxm <= 0.30 ? 1 : 0);
    const mold2 = (1.0 - smoothstep(0.0, 0.010, Math.abs(zig - 0.255))) * (Math.abs(qxm) <= 1.45 && qxm <= 0.30 ? 1 : 0);
    const mold = Math.min(1.0, Math.max(0.0, mold1 + mold2));
    const moldK = 1.0 - 0.30 * mold;
    bodyR *= moldK; bodyG *= moldK; bodyB *= moldK;
    t(12, 18);
    const seamRaw = 1.0 - smoothstep(0.003, 0.014, Math.abs(qxm - 0.18));
    const seam = seamRaw * (1.0 - smoothstep(0.62, 0.78, zig)) * (1.0 - smoothstep(0.30, 0.40, -zig + 0.30));
    const hdx = qxm + 0.36, hdy = zig - 0.80;
    const hnd = 1.0 - smoothstep(0.0, 0.030, Math.sqrt(hdx * hdx + hdy * hdy));
    t(11, 15);
    const det1 = 0.10 * seam + 0.16 * hnd;
    bodyR += P.mist[0] * det1; bodyG += P.mist[1] * det1; bodyB += P.mist[2] * det1;
    t(3, 9);
    /* штамповка крыла: та же полоса, что pFender в GLSL */
    const fdx = Math.abs(CAR_AXLE_F * CAR_SCALE - qx), fdy = Math.abs(qy - (CAR_GROUND + CAR_TYRE_R * CAR_SCALE + 0.0));
    const fA = Math.min(Math.abs(CAR_AXLE_F * CAR_SCALE - qx) - 0.10 * CAR_SCALE, Math.abs((qy - CAR_GROUND) / CAR_SCALE - (profile.CAR.tyre / 2 + profile.ARCH.radius * 0.55)) - 0.045);
    const fB = Math.min(Math.abs(CAR_AXLE_R * CAR_SCALE - qx) - 0.10 * CAR_SCALE, Math.abs((qy - CAR_GROUND) / CAR_SCALE - (profile.CAR.tyre / 2 + profile.ARCH.radius * 0.55)) - 0.045);
    const fend = 1.0 - smoothstep(0.0, 0.016, Math.abs(Math.min(fA, fB)));
    void fdx; void fdy;
    const fendK = 0.10 * fend;
    bodyR += P.mist[0] * fendK; bodyG += P.mist[1] * fendK; bodyB += P.mist[2] * fendK;
    t(12, 18);
    const lamp = (qxm >= -1.86 && qxm <= -1.06 ? 1 : 0) * (1.0 - smoothstep(0.004, 0.022, Math.abs(zig - 0.905))) * (1 - beltZ);
    bodyR = mix(bodyR, P.danger[0] * 0.55, lamp);
    bodyG = mix(bodyG, P.danger[1] * 0.55, lamp);
    bodyB = mix(bodyB, P.danger[2] * 0.55, lamp);
    t(6, 14);
    const mdx = (qxm - 0.74) * 1.5, mdy = zig - 1.06;
    const mir = 1.0 - smoothstep(0.0, 0.058, Math.sqrt(mdx * mdx + mdy * mdy));
    bodyR = mix(bodyR, P.night[0] * 0.50, mir);
    bodyG = mix(bodyG, P.night[1] * 0.50, mir);
    bodyB = mix(bodyB, P.night[2] * 0.50, mir);
    t(8, 16);
    const ndx = (qxm + 1.42) * 2.4, ndy = zig - 1.655;
    const fin = 1.0 - smoothstep(0.0, 0.040, Math.sqrt(ndx * ndx + ndy * ndy));
    bodyR = mix(bodyR, P.night[0] * 0.55, fin);
    bodyG = mix(bodyG, P.night[1] * 0.55, fin);
    bodyB = mix(bodyB, P.night[2] * 0.55, fin);
    t(8, 16);

    if (process.env.DBG && Math.abs(qx - Number(process.env.DBG_X)) < 0.01 && Math.abs(qy - Number(process.env.DBG_Y)) < 0.01) {
      console.log('[dbg] inside', inside, 'bodyR', bodyR, 'glass', trimGlass, 'beltZ', beltZ, 'ty', ty, 'trimTop', trimTop);
    }
    const atmo = 0.35 * (1 - fogC);
    const bScale = 0.55 + 0.45 * fogC;
    const inMix = inside;    /* как в шейдере: mix(col, тело, inside) */
    cR = mix(cR, mix(bodyR, cR, atmo) * bScale, inMix);
    cG = mix(cG, mix(bodyG, cG, atmo) * bScale, inMix);
    cB = mix(cB, mix(bodyB, cB, atmo) * bScale, inMix);
    t(9, 27);
    }

    /* колёса: wheel() с диском 0,689 радиуса шины, пятью спицами и суппортом */
    for (const wx of [CAR_AXLE_F, CAR_AXLE_R]) {
      const rTyre = CAR_TYRE_R * CAR_SCALE;
      const rRim = 0.689 * rTyre;
      const dx = qx - wx, dy = qy - (CAR_GROUND + rTyre);
      const dl = Math.sqrt(dx * dx + dy * dy);
      const tyre = 1.0 - smoothstep(rTyre - 0.010, rTyre, dl);
      cR = mix(cR, P.night[0] * 0.02, tyre);
      cG = mix(cG, P.night[1] * 0.02, tyre);
      cB = mix(cB, P.night[2] * 0.02, tyre);
      const side = tyre * smoothstep(-0.10, 0.80, dy / rTyre);
      const sideK = 0.10 * side * fogC;
      cR += P.mist[0] * sideK; cG += P.mist[1] * sideK; cB += P.mist[2] * sideK;
      t(12, 24);
      if (tyre < 0.002) { t(1, 1); continue; }
      const rim = (1.0 - smoothstep(rRim - 0.004, rRim, dl)) * tyre;
      cR = mix(cR, P.night[0] * 0.02, rim * fogC);
      cG = mix(cG, P.night[1] * 0.02, rim * fogC);
      cB = mix(cB, P.night[2] * 0.02, rim * fogC);
      t(7, 18);
      const ux = dx / Math.max(dl, 0.0001), uy = dy / Math.max(dl, 0.0001);
      const sp = Math.max(
        ux * 1.0000 + uy * 0.0000,
        Math.max(
          ux * 0.3090 + uy * 0.9511,
          Math.max(
            ux * -0.8090 + uy * 0.5878,
            Math.max(ux * -0.8090 + uy * -0.5878, ux * 0.3090 + uy * -0.9511),
          ),
        ),
      );
      t(16, 26);
      const spoke = smoothstep(0.940, 0.985, sp) * rim;
      cR = mix(cR, P.mist[0] * 0.30, spoke * fogC * 0.85);
      cG = mix(cG, P.mist[1] * 0.30, spoke * fogC * 0.85);
      cB = mix(cB, P.mist[2] * 0.30, spoke * fogC * 0.85);
      t(7, 18);
      const disc = (1.0 - smoothstep(rRim * 0.60, rRim * 0.68, dl)) * rim;
      cR = mix(cR, P.copper[0] * 0.16, disc * fogC * 0.55);
      cG = mix(cG, P.copper[1] * 0.16, disc * fogC * 0.55);
      cB = mix(cB, P.copper[2] * 0.16, disc * fogC * 0.55);
      t(7, 18);
      const cdx = dx - rRim * 0.42, cdy = dy + rRim * 0.52;
      const cal = (1.0 - smoothstep(rRim * 0.62, rRim * 0.78, Math.sqrt(cdx * cdx + cdy * cdy))) * rim;
      cR = mix(cR, P.danger[0] * 0.40, cal * fogC * 0.45);
      cG = mix(cG, P.danger[1] * 0.40, cal * fogC * 0.45);
      cB = mix(cB, P.danger[2] * 0.40, cal * fogC * 0.45);
      t(10, 24);
      const lip = (1.0 - smoothstep(0.0, 0.010, Math.abs(dl - rRim * 0.995))) * tyre;
      cR = mix(cR, P.mist[0] * 0.22, lip * fogC * 0.50);
      cG = mix(cG, P.mist[1] * 0.22, lip * fogC * 0.50);
      cB = mix(cB, P.mist[2] * 0.22, lip * fogC * 0.50);
      t(8, 21);
    }

    /* контровой свет по кромке */
    const edge = 1.0 - smoothstep(0.0, 0.016, Math.abs(sd));
    const up = smoothstep(-0.25, 0.30, qy);
    t(5, 12);
    const rimR = mix(P.copper[0], P.brass[0], up) * edge * (0.30 + 0.62 * fogC) * (0.30 + 0.70 * up);
    const rimG = mix(P.copper[1], P.brass[1], up) * edge * (0.30 + 0.62 * fogC) * (0.30 + 0.70 * up);
    const rimB = mix(P.copper[2], P.brass[2], up) * edge * (0.30 + 0.62 * fogC) * (0.30 + 0.70 * up);
    t(6, 30);
    cR += rimR; cG += rimG; cB += rimB;
    t(2, 3);

    /* фары и габариты */
    const hlx = (qx - 0.86) * 1.0, hly = (qy - (-0.03)) * 2.6;
    const hl = Math.exp(-Math.sqrt(hlx * hlx + hly * hly) * 16.0);
    t(7, 12);
    const hlI = 0.50 * hl * inside;
    cR += P.brass[0] * hlI; cG += P.brass[1] * hlI; cB += P.brass[2] * hlI;
    t(4, 12);
    const tlx = (qx + 0.88) * 1.0, tly = (qy + 0.02) * 2.8;
    const tl = Math.exp(-Math.sqrt(tlx * tlx + tly * tly) * 15.0);
    t(7, 12);
    const tlI = 0.36 * tl * inside;
    cR += P.danger[0] * tlI; cG += P.danger[1] * tlI; cB += P.danger[2] * tlI;
    t(4, 12);

    /* отражение в мокром асфальте */
    if (U.quality > 1.5) {
      t(1, 1);
      const rg = 2.0 * CAR_GROUND - qy;
      if (rg > CAR_GROUND) {
        t(3, 3);
        const wob = vnoise(qy * 3.1, tm * 0.7);
        t(4, 4);
        const rqx = qx + (wob - 0.5) * 0.09;
        const rqy = rg;
        t(4, 4);
        const rsd = carSdf(rqx, rqy);
        t(1, 0);
        const fade = Math.exp(-Math.max(CAR_GROUND - qy, 0.0) * 3.4);
        t(5, 6);
        const rIn = (1.0 - smoothstep(-0.006, 0.012, rsd)) * fade;
        t(4, 8);
        cR = mix(cR, bodyR * 0.42, rIn * 0.40);
        cG = mix(cG, bodyG * 0.42, rIn * 0.40);
        cB = mix(cB, bodyB * 0.42, rIn * 0.40);
        t(7, 21);
        const redge = (1.0 - smoothstep(0.0, 0.030, Math.abs(rsd))) * rIn * 0.16;
        const rR = mix(P.copper[0], P.brass[0], 0.5) * redge;
        const rG = mix(P.copper[1], P.brass[1], 0.5) * redge;
        const rB = mix(P.copper[2], P.brass[2], 0.5) * redge;
        t(8, 24);
        cR += rR; cG += rG; cB += rB;
        t(2, 3);
      }
    }
  }

  /* ---------- виньетка, появление, дизеринг ---------- */
  const vx = px * 0.60, vy = py * 0.95;
  const vig = smoothstep(1.75, 0.30, Math.sqrt(vx * vx + vy * vy));
  t(4, 9);
  const vm = 0.68 + 0.32 * vig;
  cR *= vm; cG *= vm; cB *= vm;
  t(4, 5);

  cR = mix(baseR, cR, U.fade);
  cG = mix(baseG, cG, U.fade);
  cB = mix(baseB, cB, U.fade);
  t(2, 9);

  const dith = (hash21(fcx, fcy) - 0.5) * (1.0 / 255.0);
  t(4, 5);
  cR += dith; cG += dith; cB += dith;
  t(2, 3);

  T.pixels++;
  return [cR, cG, cB];
}

/** Кадр целиком. Возвращает Uint8Array(RGB) и статистику операций. */
export function renderFrame(opts) {
  const { width, height, variant = 'silhouette', quality = 2, time = 0, scroll = 0, pointer = [0, 0], fade = 1, car = true } = opts;
  const U = {
    res: [width, height],
    time,
    scroll,
    pointer,
    mode: variant === 'silhouette' ? 1 : 0,
    /* car: false — та же сцена и то же затухание, но силуэт не рисуется. Нужно
       замеру (scripts/bg3d-car-measure.mjs): маска машины = разница кадра с машиной
       и без неё. Без этого «маска» ловит тень, прожекторы и дизеринг. */
    noCar: car === false,
    quality,
    fade,
  };
  const out = new Uint8Array(width * height * 3);
  const before = { inst: T.inst, scalar: T.scalar, pixels: T.pixels };
  let maxInst = 0, minInst = Infinity, maxScalar = 0;
  for (let y = 0; y < height; y++) {
    /* gl_FragCoord.y растёт снизу, vUv.y — тоже; строку изображения пишем сверху вниз */
    const uvy = 1 - (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const uvx = (x + 0.5) / width;
      const i0 = T.inst;
      const s0 = T.scalar;
      const [r, g, b] = shadePixel(uvx, uvy, x + 0.5, height - (y + 0.5), U);
      const di = T.inst - i0, ds = T.scalar - s0;
      if (di > maxInst) maxInst = di;
      if (di < minInst) minInst = di;
      if (ds > maxScalar) maxScalar = ds;
      const o = (y * width + x) * 3;
      out[o] = Math.max(0, Math.min(255, Math.round(r * 255)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
    }
  }
  return {
    data: out,
    width,
    height,
    pixels: T.pixels - before.pixels,
    ops: {
      instTotal: T.inst - before.inst,
      scalarTotal: T.scalar - before.scalar,
      instPerPx: (T.inst - before.inst) / (T.pixels - before.pixels),
      scalarPerPx: (T.scalar - before.scalar) / (T.pixels - before.pixels),
      instPerPxMax: maxInst,
      instPerPxMin: minInst === Infinity ? 0 : minInst,
      scalarPerPxMax: maxScalar,
    },
  };
}
