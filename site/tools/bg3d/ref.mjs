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
/* Круг 35 (задание №62): посадка пластины берётся из того же модуля, что у шейдера —
   иначе кадр в отчёте и кадр на GPU разъедутся. */
const plateMod = await import('../../src/client/bg3d/plate.ts');
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

/* ---------- фото-пластина (круг 35, задание №62) ----------
   Порт обязан рисовать ТУ ЖЕ картинку, что GPU, иначе кадры в отчёте — не кадры.
   Поэтому пластина читается из того же файла, что уходит в браузер, и сэмплируется
   так же: билинейно, с мипмапами. Мипмапы строим сами (sharp может только уменьшать
   файл целиком), пирамиду до 1x1 — это дешевле, чем расхождение с GPU на кромке. */
/* Множитель тёмной сцены B. Один и тот же в шейдере, в порте и в замерах: пока в
   шейдере стояло 0.22, а в порте 1.0, кадр в отчёте был в 4,5 раза темнее прода
   (средняя по кадру 4,3 L против 13,5 L) — и все «числа контраста» мерили не сцену. */
export const SCENE_B_MUL = 0.22;

let PLATE = null;          /* { w, h, data: Uint8ClampedArray RGBA, mips: [...] } */
let PLATE_ERR = null;
export async function loadPlate(file) {
  const sharpMod = (await import('sharp')).default;
  const { data, info } = await sharpMod(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mips = [{ w: info.width, h: info.height, data }];
  let cur = { w: info.width, h: info.height, data };
  while (cur.w > 1 || cur.h > 1) {
    const nw = Math.max(1, cur.w >> 1), nh = Math.max(1, cur.h >> 1);
    const buf = Buffer.alloc(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      for (let c = 0; c < 4; c++) {
        let s2 = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(cur.w - 1, x * 2 + dx), sy = Math.min(cur.h - 1, y * 2 + dy);
          s2 += cur.data[(sy * cur.w + sx) * 4 + c];
        }
        buf[(y * nw + x) * 4 + c] = Math.round(s2 / 4);
      }
    }
    cur = { w: nw, h: nh, data: buf };
    mips.push(cur);
  }
  PLATE = { w: info.width, h: info.height, mips };
  return PLATE;
}
export function plateLoaded() { return !!PLATE; }
export function plateError() { return PLATE_ERR; }

/** Билинейная выборка с трилинейным переходом между мипмапами (как LINEAR_MIPMAP_LINEAR). */
function samplePlate(u, v) {
  if (!PLATE) return [0, 0, 0, 0];
  if (u < 0 || u > 1 || v < 0 || v > 1) return [0, 0, 0, 0];
  /* какой мипмап: по производной uv на пиксель считаем LOD приблизительно —
     в CPU-порте масштаб кадра известен, поэтому плотность выборки берём из него */
  const lod = PLATE_LOD;
  const i0 = Math.max(0, Math.min(PLATE.mips.length - 1, Math.floor(lod)));
  const i1 = Math.max(0, Math.min(PLATE.mips.length - 1, i0 + 1));
  const f = Math.max(0, Math.min(1, lod - i0));
  const a = sampleMip(PLATE.mips[i0], u, v);
  const b = sampleMip(PLATE.mips[i1], u, v);
  return [0, 1, 2, 3].map((k) => a[k] * (1 - f) + b[k] * f);
}
let PLATE_LOD = 0;
function sampleMip(mip, u, vIn) {
  /* GPU грузит текстуру с UNPACK_FLIP_Y: v=0 — низ картинки. В сыром буфере строка 0 —
     верх, поэтому здесь v переворачивается ровно один раз и больше нигде. */
  const v = 1 - vIn;
  const x = u * mip.w - 0.5, y = v * mip.h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const at = (xi, yi, c) => {
    const cx = Math.min(mip.w - 1, Math.max(0, xi)), cy = Math.min(mip.h - 1, Math.max(0, yi));
    return mip.data[(cy * mip.w + cx) * 4 + c] / 255;
  };
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    out[c] = (at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx) * (1 - fy)
           + (at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx) * fy;
  }
  return out;
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

  /* ---------- вариант B: машина в глубине ---------- */
  if (U.mode > 0.5) {
    /* Сцена B тёмная — как в проде. Множитель применяется ВСЕГДА, в том числе к кадру
       без машины (U.noCar): иначе кадр «без машины» отличался бы от «с машиной» по
       всему полю, и маска машины по разнице кадров мерила бы не машину, а яркость. */
    t(1, 1);
    cR *= SCENE_B_MUL; cG *= SCENE_B_MUL; cB *= SCENE_B_MUL;
    t(0, 3);
  }
  if (U.mode > 0.5) {
    const depth = 0.58;
    const sc0 = mix(0.80, 0.46, depth);
    t(1, 3);
    /* та же посадка, что в шейдере: коэффициенты — из plate.ts */
    const aspectR = U.res[0] / Math.max(U.res[1], 1);
    const place = plateMod.platePlacement(aspectR, U.pointer, U.scroll, hy);
    const sc = place.sc;
    t(9, 9);
    const fogC = Math.exp(-depth * 1.15);
    t(3, 4);


    /* геометрия квада — из того же модуля, что у шейдера */
    const half = plateMod.plateHalfSize(sc);
    const hx = half.hx, hyHalf = half.hy;
    /* Линия земли — из пластины (доля высоты файла, см. plate.ts): низ квада не совпадает
       с землёй, под ней лежит поле padding. */
    const groundLine = place.cy + hyHalf - plateMod.PLATE_GROUND_FRAC * 2.0 * hyHalf;
    const gy = py - groundLine;
    const gx = (px - place.cx) / Math.max(hx, 0.0001);
    t(9, 9);

    /* Полуширина тени на полувысоте 0,55·L, в нормировке gx = (p.x−cp.x)/hx:
       коэффициент = ln2 / (0,55·L_scene / PLATE_HALF_LEN)², sc сокращается. */
    const SHADOW_X = Math.LN2 / Math.pow(0.55 * profile.CAR.length * profile.SCALE.bg3d / plateMod.PLATE_HALF_LEN, 2);
    const shdRaw = Math.exp(-(gx * gx * SHADOW_X + gy * gy * (90.0 / Math.max(hx * hx, 0.0001))));
    const shd = shdRaw * smoothstep(-0.055, -0.006, gy) * (1.0 - smoothstep(0.14, 0.30, gy));
    /* тёмное пятно под машиной — то же, что occl в шейдере */
    const occl = Math.exp(-(gx * gx * 0.55 + gy * gy * (14.0 / Math.max(hx * hx, 0.0001))))
      * (1.0 - smoothstep(0.0, 0.06, gy));
    const occlK = (1.0 - 0.62 * occl) * (1.0 - 0.16 * shd);
    cR *= occlK; cG *= occlK; cB *= occlK;
    t(20, 26);

    /* ОДНА выборка пластины — ровно как texture2D в шейдере */
    const u = (px - place.cx) / (2.0 * hx) + 0.5;
    const v = (py - place.cy) / (2.0 * hyHalf) + 0.5;
    /* LOD: сколько текселей пластины приходится на пиксель кадра по X.
       UV = dx / (2hx), значит duv/dpx = 1/(2hx), а текселей на единицу uv — PLATE.w.
       Отсюда texels per pixel = PLATE.w / (2hx). Это ровно то, из чего GPU считает
       LOD сам; здесь — то же число, чтобы мипмап выбирался одинаково. */
    /* p-пространство в пиксели кадра: p.x пробегает [-aspect, aspect] на всю ширину */
    /* LOD как у GPU: берётся МАКСИМУМ из плотности по X и по Y, иначе на кадре, где
       пластина сжата по высоте сильнее, чем по ширине, CPU берёт слишком крупный
       мипмап и силуэт на кромке «расплывается» (h/L уезжал с 0,335 на 0,377). */
    const pxPerUnitX = U.res[0] / (2.0 * aspectR);
    const pxPerUnitY = U.res[1] / 2.0;
    const densX = (PLATE ? PLATE.w : 1) / Math.max(1e-6, 2.0 * hx) / pxPerUnitX;
    const densY = (PLATE ? PLATE.h : 1) / Math.max(1e-6, 2.0 * hyHalf) / pxPerUnitY;
    PLATE_LOD = Math.max(0, Math.log2(Math.max(densX, densY)));
    t(6, 6);
    /* Без машины (noCar) пластина не рисуется, но пол, тень и пятно под ней — остаются:
       тень лежит на полу и от наличия машины в кадре не зависит. Иначе маска машины
       по разнице кадров ловит тень и «высота» машины удваивается. */
    const tex = U.noCar ? [0, 0, 0, 0] : samplePlate(u, v);
    t(4, 4);
    const inQ = (u >= 0 && u <= 1 && v >= 0 && v <= 1) ? 1 : 0;
    const alpha = tex[3] * inQ;
    /* дымка — как в шейдере */
    const atmo = 0.30 * (1.0 - fogC);
    const bR = mix(tex[0], cR, atmo);
    const bG = mix(tex[1], cG, atmo);
    const bB = mix(tex[2], cB, atmo);
    cR = mix(cR, bR, alpha); cG = mix(cG, bG, alpha); cB = mix(cB, bB, alpha);
    t(12, 18);

    if (U.quality > 1.5 && U.reflection) {
      const groundY = groundLine - plateMod.PLATE_REFLECTION_GAP;   /* зазор как в шейдере */
      const rpY = 2.0 * groundY - py;
      const rv = (rpY - place.cy) / (2.0 * hyHalf) + 0.5;
      const rr = samplePlate(u, rv);
      const fade = Math.exp(-Math.max(-gy, 0.0) * 3.4);
      const k2 = rr[3] * inQ * 0.40 * fade;
      cR = mix(cR, mix(P.night[0], rr[0] * 0.42, 0.85), k2);
      cG = mix(cG, mix(P.night[1], rr[1] * 0.42, 0.85), k2);
      cB = mix(cB, mix(P.night[2], rr[2] * 0.42, 0.85), k2);
      t(18, 24);
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
    /* Отражение — отдельный флаг, а не побочный эффект качества: маска машины для
       замеров снимается кадром БЕЗ отражения (см. ниже), иначе отражение в мокром
       асфальте прирастает к силуэту и «высота» машины в маске удваивается. */
    reflection: opts.reflection !== false,
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
