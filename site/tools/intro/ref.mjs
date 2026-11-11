/**
 * CPU-порт фрагментного шейдера заставки `SCENE_FS` из `src/client/voyah-intro.ts` —
 * редакция круга 33 (A12): машина стала ПЛАСТИНОЙ (`uBody` + `uBg`), формулы SDF
 * силуэта удалены.
 *
 * Что изменилось против порта круга 32:
 *   • нет функций `bodyOnly` / `railsSd` / `mirrorSd` / `sdQuad` / `sdSeg` / `sdBox` /
 *     `sideD` / `smin` / `halfW` / `rot2` / `finSd` — их вызовы ушли из сцены вместе
 *     с формулой силуэта. Оставлены только `hash12`, `hash21`, `vnoise`;
 *   • вместо арифметики силуэта — ВЫБОРКИ ТЕКСТУР. Они не входят в `scalar` (это не
 *     компонентная операция), а печатаются отдельно как `tex/px`, ровно как выборка
 *     знака в круге 32. Рядом с каждой стоит цена её фильтрации по альфе/цвету;
 *   • в сцене остался ОДИН цикл — три тапа отражения в полу.
 *
 * Метрики — те же, что с раунда 30: `inst` (гранулярность SPIR-V) и `scalar`
 * (компонентные операции, аршин бюджета ≤ 1798,8). Плюс `COUNT.tex` — выборки
 * текстур сцены, отдельной строкой.
 *
 * Порт намеренно НЕ оптимизирован: каждый `t(inst, scalar)` стоит рядом со строкой
 * GLSL и пересчитан руками по исходнику. Ветви, которые на GPU не исполняются
 * (отражение ниже линии пола, импульс контрового вне окна 0,42…0,68), в порте тоже
 * не исполняются и не считаются — как на железе.
 *
 * Сэмплеры подменяемые: пластины на CPU — это Lua-подобный «чёрный ящик», порт
 * спрашивает их через `setBodySampler` / `setBgSampler` (по умолчанию 0,0,0,0 —
 * замер снят без пластин, это влияет на ЦВЕТ пикселя, но не на число операций:
 * их количество от содержимого текстуры не зависит).
 */

/* ============================ счётчики ============================ */

export const T = { inst: 0, scalar: 0, pixels: 0 };
export function resetTally() { T.inst = 0; T.scalar = 0; T.pixels = 0; }
function t(inst, scalar = inst) { T.inst += inst; T.scalar += scalar; }

export const COUNT = {
  tex: 0, texBody: 0, texBg: 0, texMark: 0,
  layersCalls: 0, reflPixels: 0, bodyPixels: 0,
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
function maxf(a, b) { t(1, 1); return Math.max(a, b); }
function maxv3(a, b) { t(1, 3); return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]; }
/** выборка текстуры: НЕ арифметика, в scalar не входит; печатается отдельно. */
function tex(sampler, u, v, kind) {
  if (kind === 'body') COUNT.texBody++;
  else if (kind === 'bg') COUNT.texBg++;
  else COUNT.texMark++;
  COUNT.tex++;
  const fn = kind === 'body' ? BODY_SAMPLER : kind === 'bg' ? BG_SAMPLER : MARK_SAMPLER;
  return fn(u, v);
}

/* ============================ сэмплеры ============================ */

let MARK_SAMPLER = () => 0;
let BODY_SAMPLER = () => [0, 0, 0, 0];
let BG_SAMPLER = () => [0, 0, 0];
export function setMarkSampler(fn) { MARK_SAMPLER = fn; }
export function setBodySampler(fn) { BODY_SAMPLER = fn; }
export function setBgSampler(fn) { BG_SAMPLER = fn; }

/* ============================ константы ============================ */

/* hero-единицы кадра 1920×1080 (FRONT.md) */
export const BW = 1150.0, BX = 960.0, BY0 = 95.0, FLOOR = 730.0;
/* кроп body-пластины в hero-координатах: [372..1553] x [67..1080] */
export const BC0 = [372.0, 67.0];
export const BSZ = [1181.0, 1013.0];
export const COOL = [0.9098, 0.9412, 1.0];   /* #E8F0FF */
export const RIM = [0.4745, 0.0627, 0.0118]; /* палитра #791003 */
export const NIGHT = [0.0322, 0.0504, 0.0826];

/* ========================== шум (как в GLSL) ========================== */

export function hash12(px, py) {
  /* vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); */
  const x = fract(px * 0.1031), y = fract(py * 0.1031), z = fract(px * 0.1031);
  t(3, 3);                       /* vec3 * scalar */
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  t(2, 9);                       /* dot и сложение vec3 */
  const p3 = [fract(x + d), fract(y + d), fract(z + d)];
  t(3, 3);                       /* vec3 + scalar */
  return fract((p3[0] + p3[1]) * p3[2]);
}

export function hash21(px, py) {
  /* p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); */
  const ax = fract(px * 123.34), ay = fract(py * 456.21);
  t(2, 2);
  const d = ax * (ax + 45.32) + ay * (ay + 45.32);
  t(2, 4);
  return fract(fract(ax + d) * fract(ay + d));
}

export function vnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  let fx = fract(px), fy = fract(py);
  const h = hash21, m = mixf, s = smoothstep;
  /* f = f * f * (3.0 - 2.0 * f) — vec2 (3 операции на компоненту) */
  t(2, 6);
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return m(m(a, b, fx), m(c, d, fx), fy);
}

/* ============================ шейдер ============================ */

/** Тело с параллаксом от указателя: цвет в точке p берётся из пластины со сдвигом uPar. */
export function bodyAt(px, py, par = [0, 0]) {
  const u = (px - par[0] - BC0[0]) / BSZ[0];
  const v = (py - par[1] - BC0[1]) / BSZ[1];
  t(6, 6);                                 /* 4 вычитания/сложения + 2 деления (vec2) */
  const bt = tex(BODY_SAMPLER, u, v, 'body');
  /* хрома-страховка тёмного кузова: два mix + max + два smoothstep */
  const w = 1 - smoothstep(0.10, 0.13, bt[0]);
  const g = mixf(bt[1], Math.max(bt[1], bt[0] * 0.32), w);
  const b = mixf(bt[2], Math.max(bt[2], bt[0] * 0.52), w);
  t(3, 3);                                 /* bt.r * 0.32, * 0.52, w = 1 - ss */
  return [bt[0], g, b, bt[3]];
}

/**
 * Слои кузова и света. Возвращает { bcol, ba, light } — те же три выхода, что в GLSL.
 * `opts.once` — статический режим: каждая ветка исполнена по разу (как компилятор
 * в SPIR-V), нужно только для сверки функций, в динамике всегда false.
 */
export function layers(px, py, tt, opts = {}) {
  const once = !!opts.once;
  COUNT.layersCalls++;
  let bcol = [0, 0, 0], ba = 0, light = [0, 0, 0];
  if (px >= 0 && px < 1920 && py >= 0 && py < 1080) COUNT.bodyPixels++;
  const bt = bodyAt(px, py, opts.par ?? [0, 0]);

  /* проявление от полосы ДХО вверх и вниз, кромка с шумом */
  const mouth = Math.abs(py - 448.0);
  t(1, 1);
  const wob = (vnoise(px * 0.011, 3.7) - 0.5) * 30.0 + (vnoise(px * 0.041, 9.1) - 0.5) * 10.0;
  t(4, 4);
  const spread = smoothstep(0.44, 0.72, tt) * 470.0;
  t(1, 1);
  const bandRev = smoothstep(spread + 24.0, spread - 74.0, mouth + wob);
  t(2, 2);
  const poolRev = smoothstep(0.60, 0.82, tt) * smoothstep(800.0, 840.0, py);
  t(1, 1);
  /* заострение альфы пластины: без него кромка силуэта подмешивает 15 % фона */
  const aSharp = smoothstep(0.55, 0.80, bt[3]);
  const rev = Math.max(bandRev, poolRev);
  t(1, 1);
  ba = aSharp * BA_PLATE * rev;
  t(2, 2);
  bcol = [bt[0], bt[1], bt[2]];

  /* контровой 0,42-0,68: вспыхивает кромка пластины по градиенту альфы */
  const pulse = smoothstep(0.42, 0.52, tt) * (1.0 - smoothstep(0.60, 0.68, tt));
  t(2, 2);
  if (once || pulse > 0.002) {
    const rimProg = smoothstep(0.42, 0.68, tt);
    const trace = length2((px - BX) * 0.90, (py - BY0) * 1.02) / 700.0;
    t(3, 3);
    const shown = smoothstep(trace, trace + 0.10, rimProg);
    t(1, 1);
    const u = (px - (opts.par ?? [0, 0])[0] - BC0[0]) / BSZ[0];
    const v = (py - (opts.par ?? [0, 0])[1] - BC0[1]) / BSZ[1];
    t(6, 6);
    /* градиент альфы: 4 выборки, каждая сдвинута на 2,5 px по своей оси */
    const ax1 = tex(BODY_SAMPLER, u + 2.5 / BSZ[0], v, 'body')[3];
    const ax0 = tex(BODY_SAMPLER, u - 2.5 / BSZ[0], v, 'body')[3];
    const ay1 = tex(BODY_SAMPLER, u, v + 2.5 / BSZ[1], 'body')[3];
    const ay0 = tex(BODY_SAMPLER, u, v - 2.5 / BSZ[1], 'body')[3];
    const gx = ax1 - ax0, gy = ay1 - ay0;
    t(2, 2);
    const gl = Math.max(length2(gx, gy), 1e-5);
    t(1, 1);
    const nx = gx / gl, ny = gy / gl;
    t(2, 2);
    const aOut = tex(BODY_SAMPLER, u + nx * 7.0 / BSZ[0], v + ny * 7.0 / BSZ[1], 'body')[3];
    t(2, 2);
    const k = pulse * shown * (1.0 - bt[3]) * aOut * 0.55;
    t(4, 4);
    light = [light[0] + RIM[0] * k, light[1] + RIM[1] * k, light[2] + RIM[2] * k];
    t(1, 3);
  }

  /* полоса ДХО: клин горбом, скруглённые концы, ореол 0,12 — холодным COOL */
  const reveal = smoothstep(0.12, 0.44, tt);
  const mx = Math.abs(px - BX);
  t(1, 1);
  const knee = clamp((540.0 - mx) / 252.0, 0.0, 1.0);
  t(2, 2);
  const ssKnee = smoothstep(0.0, 1.0, knee);
  const sy = 447.7 - 31.2 * (1.0 - ssKnee);
  t(2, 2);
  const hw = 2.1 + 14.2 * knee * (1.0 - knee);
  t(3, 3);
  const axEnd = Math.max(Math.max(mx - 542.0, 51.0 - mx), 0.0);
  t(3, 3);
  const rBar = length2(axEnd, py - sy);
  t(1, 1);
  const cut = 1.0 - smoothstep(reveal * 542.0 - 6.0, reveal * 542.0 + 2.0, mx);
  t(2, 2);
  const coreBar = 1.0 - smoothstep(hw - 0.7, hw + 2.3, rBar);
  const glowBar = expf(-powf(rBar / 12.0, 2.0)) * cut * 0.12;
  t(4, 4);
  const addBar = coreBar * cut;
  t(1, 1);
  light = [light[0] + COOL[0] * (addBar + glowBar), light[1] + COOL[1] * (addBar + glowBar), light[2] + COOL[2] * (addBar + glowBar)];
  t(2, 6);

  /* «искра» на кончике прорисовки */
  const drawEnd = 51.0 + reveal * 491.0;
  t(1, 1);
  const sparkShape = expf(-length2((mx - drawEnd) * 1.04, py - sy) * 0.16);
  const sparkGate = stepf(0.02, reveal) * (1.0 - smoothstep(0.90, 1.0, reveal));
  t(2, 2);
  const spark = sparkShape * sparkGate * 3.2;
  t(2, 2);
  light = [light[0] + COOL[0] * spark, light[1] + COOL[1] * spark, light[2] + COOL[2] * spark];
  t(1, 3);

  /* знак: тот же SVG (mipmap), пропорция 75x93, ядро max(), свечение 0,32 */
  const ec = [961.0, 490.0], eh = [37.5, 46.5];
  const euvx = (px - ec[0]) / (eh[0] * 2.0) + 0.5;
  const euvy = 0.5 + (py - ec[1]) / (eh[1] * 2.0);
  t(6, 6);
  const inBox = stepf(0.0, euvx) * stepf(euvx, 1.0) * stepf(0.0, euvy) * stepf(euvy, 1.0);
  t(3, 3);
  const a = tex(MARK_SAMPLER, clamp(euvx, 0, 1), clamp(euvy, 0, 1), 'mark') * inBox * MARK_ON;
  t(4, 4);
  const ink = smoothstep(0.40, 0.60, a);
  const edge = clamp01(a * (1.0 - a) * 4.0);
  t(3, 3);
  const core = Math.max(ink * smoothstep(0.40, 0.48, tt),
    edge * smoothstep(0.34, 0.42, tt) * (1.0 - smoothstep(0.42, 0.50, tt)));
  t(3, 3);
  light = [light[0] + COOL[0] * core, light[1] + COOL[1] * core, light[2] + COOL[2] * core];
  t(1, 3);
  const ecLen = length2((px - ec[0]) / 1.5, py - ec[1]);
  const eGlow = expf(-powf(ecLen / 34.0, 2.0)) * smoothstep(0.42, 0.50, tt) * 0.32;
  t(6, 6);
  light = [light[0] + COOL[0] * eGlow, light[1] + COOL[1] * eGlow, light[2] + COOL[2] * eGlow];
  t(1, 3);

  return { bcol, ba, light };
}

/** Фон — пластина: градиент, пол, пятно света; проявление 0-0,18 как прежде. */
export function bgAt(px, py, tt) {
  const u = px / 1920.0, v = py / 1080.0;
  t(2, 2);
  const c = tex(BG_SAMPLER, u, v, 'bg');
  const k = smoothstep(0.0, 0.18, tt);
  const out = [c[0] * k, c[1] * k, c[2] * k];
  t(3, 3);
  return out;
}

/* ============================ пиксель ============================ */

export const BA_PLATE = 1.0;   /* uPlateOn по умолчанию: пластины загружены */
export const MARK_ON = 0.0;    /* замер снят без знака (как в круге 32) */

/**
 * Один пиксель сцены. `U = { res:[w,h], t, par?, plateOn? }`.
 * Возвращает [r,g,b] в 0..1 (после дизеринга, как в шейдере).
 */
export function shadePixel(fcx, fcy, U, opts = {}) {
  T.pixels++;   /* tally пикселей ведёт вызывающий; здесь только счёт вызовов */
  const res = U.res, tt = clamp01(U.t);
  const par = U.par ?? [0, 0];
  const plateOn = U.plateOn ?? 1;
  /* gl_FragCoord.y растёт вверх, hero-y — вниз: переворачиваем */
  const fx = fcx, fy = res[1] - fcy;
  t(1, 1);
  const aspect = res[0] / res[1];
  t(1, 1);
  let px, py;
  if (aspect >= 0.85) {
    const s = Math.max(res[0] / 1920.0, res[1] / 1080.0);
    t(3, 3);
    px = (fx - res[0] * 0.5) / s + BX;
    py = (fy - res[1] * 0.415) / s + 448.0;
    t(4, 4);
  } else {
    const k = 1.55 * res[0] / BW;
    t(2, 2);
    px = (fx - res[0] * 0.5) / k + BX;
    py = (fy - res[1] * 0.30) / k + BY0;
    t(4, 4);
  }

  const L = layers(px, py, tt, { par, once: opts.once });
  t(1, 1);                                     /* clamp(ba, 0, 1) */
  const ba = clamp01(L.ba * plateOn);

  const nightK = smoothstep(0.72, 1.0, tt);
  const bg = bgAt(px, py, tt);
  const base = mixv3(bg, NIGHT, nightK);
  let col = mixv3(base, L.bcol, ba);

  /* отражение в полу: три тапа пластины, размытие по вертикали, вес 0,38 */
  const reflIn = smoothstep(0.60, 0.82, tt);
  if (opts.once || (py > FLOOR && reflIn > 0.002)) {
    COUNT.reflPixels++;
    const spr = smoothstep(0.44, 0.72, tt) * 470.0;
    t(1, 1);
    let accR = 0, accG = 0, accB = 0, wsum = 0;
    for (let i = 0; i < 3; i++) {
      const o = (i - 1) * 10.0;
      t(1, 1);
      const pmx = px + o * 0.25;
      const pmy = 2.0 * FLOOR - py - o;
      t(3, 3);
      const rm = bodyAt(pmx, pmy, par);
      const ra = smoothstep(0.55, 0.80, rm[3]);
      const rev = smoothstep(spr + 24.0, spr - 74.0, Math.abs(pmy - 448.0));
      t(1, 1);
      const w = 1.0 - 0.30 * Math.abs(i - 1);
      t(2, 2);
      const k3 = rev * w;
      t(1, 1);
      accR += (rm[0] * ra + 0.02 * ra) * k3;
      accG += (rm[1] * ra + 0.02 * ra) * k3;
      accB += (rm[2] * ra + 0.02 * ra) * k3;
      t(9, 9);
      wsum += w;
      t(1, 1);
    }
    const gap = clamp01((py - FLOOR) / (1080.0 - FLOOR));
    const fade = 1.0 - smoothstep(0.60, 1.0, gap);
    t(3, 3);
    const m = 0.38 * reflIn * fade;
    t(2, 2);
    col = [col[0] + (accR / wsum) * m, col[1] + (accG / wsum) * m, col[2] + (accB / wsum) * m];
    t(4, 12);
  }

  col = [col[0] + L.light[0], col[1] + L.light[1], col[2] + L.light[2]];
  t(1, 3);
  const dim = mixf(1.0, 0.62, nightK);
  col = [col[0] * dim, col[1] * dim, col[2] * dim];
  t(1, 3);
  /* дизеринг: hash12(frag + t*91) - 0.5 */
  const dith = (hash12(fx + tt * 91.0, fy + tt * 91.0) - 0.5) / 255.0;
  t(2, 2);
  col = [col[0] + dith, col[1] + dith, col[2] + dith];
  t(1, 3);
  /* контракт замера: `color` — итоговый цвет пикселя, `body` — вес кузова после
     проявления (нужен `renderFrame` для «переходной зоны заливки»: там цвет меняется
     быстрее пикселя, и расхождение float32/float64 законно) */
  return {
    color: [Math.max(col[0], 0), Math.max(col[1], 0), Math.max(col[2], 0)],
    body: ba,
  };
}

/* ============================ кадр ============================ */

export function renderFrame({ width, height, t = 0.5, once = false, par = [0, 0], plateOn = 1 }) {
  const U = { res: [width, height], t, par, plateOn };
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

/* ==================== подтверждение «порт на живой сцене» ==================== */

/* ============================ вызов уровня main ============================ */

/**
 * Стоимость одного вызова `layers()` для статического сравнения со SPIR-V.
 *
 * Динамика и статика — РАЗНЫЕ числа, и это принципиально:
 *   • динамика считает только ветви, которые исполняются в данном пикселе (импульс
 *     контрового — только в окне 0,42…0,68, отражение — только ниже линии пола);
 *   • статика SPIR-V держит в теле функции обе ветви: компилятор не может выбросить
 *     ни одну, потому что условие зависит от пикселя и момента.
 *
 * Поэтому для сверки с glslang `layers` вызывается в центре кадра при uT = 0,5 —
 * ровно та точка, что и в `measure-intro.mjs` (режим `once`).
 */
export function layersCost() {
  resetTally(); resetCounts();
  layers(960, 400, 0.5, { once: true });
  return { inst: T.inst, scalar: T.scalar };
}

/** Динамическая стоимость одного вызова `layers()` в точке вне всех окон-гейтов. */
export function layersCostDynamic(px = 960, py = 500, tt = 0.5) {
  resetTally(); resetCounts();
  layers(px, py, tt);
  return { inst: T.inst, scalar: T.scalar };
}

/* ==================== литералы исходника ====================
   `measure-intro.mjs` проверяет, что порт снят с ТЕКУЩЕГО SCENE_FS, а не с прошлой
   редакции: каждый литерал обязан найтись в тексте шейдера. Окна `{0,N}` — не больше
   N символов между фрагментами (иначе совпадение случайно). */

export const PORT_SOURCE_LITERALS = [
  ['пластина кузова: выборка uBody по кропу BC0/BSZ',
    /texture\(uBody,\s*\(p\s*-\s*uPar\s*-\s*BC0\)\s*\/\s*BSZ\)/],
  ['хрома-страховка тёмного кузова (mix по r)',
    /bt\.g\s*=\s*mix\(bt\.g,\s*max\(bt\.g,\s*bt\.r\s*\*\s*0\.32\)/],
  ['заострение альфы пластины smoothstep(0.55, 0.80)',
    /smoothstep\(0\.55,\s*0\.80,\s*bt\.a\)/],
  ['проявление от полосы: mouth = abs(p.y - 448.0)',
    /float mouth\s*=\s*abs\(p\.y\s*-\s*448\.0\)/],
  ['сдвиг проявления: spread = smoothstep(0.44, 0.72, t) * 470.0',
    /float spread\s*=\s*smoothstep\(0\.44,\s*0\.72,\s*t\)\s*\*\s*470\.0/],
  ['пул пола: smoothstep(0.60, 0.82, t) * smoothstep(800.0, 840.0, p.y)',
    /smoothstep\(0\.60,\s*0\.82,\s*t\)\s*\*\s*smoothstep\(800\.0,\s*840\.0,\s*p\.y\)/],
  ['контровой: пульс 0,42-0,68',
    /smoothstep\(0\.42,\s*0\.52,\s*t\)\s*\*\s*\(1\.0\s*-\s*smoothstep\(0\.60,\s*0\.68,\s*t\)\)/],
  ['контровой: обвод от макушки, trace / 700',
    /length\(vec2\(\(p\.x\s*-\s*BX\)\s*\*\s*0\.90,\s*\(p\.y\s*-\s*BY0\)\s*\*\s*1\.02\)\)\s*\/\s*700\.0/],
  ['контровой: градиент альфы четырьмя выборками ±2,5 px',
    /texture\(uBody,\s*uv\s*\+\s*vec2\(2\.5\s*\/\s*BSZ\.x,\s*0\.0\)\)\.a/],
  ['контровой: вынос кромки на 7 px',
    /texture\(uBody,\s*uv\s*\+\s*n\s*\*\s*7\.0\s*\/\s*BSZ\)\.a/],
  ['ДХО: проявление 0.12-0.44',
    /smoothstep\(0\.12,\s*0\.44,\s*t\)/],
  ['ДХО: колено sy 447,7 − 31,2',
    /float sy\s*=\s*447\.7\s*-\s*31\.2/],
  ['ДХО: клин hw 2,1 + 14,2',
    /float hw\s*=\s*2\.1\s*\+\s*14\.2\s*\*\s*knee\s*\*\s*\(1\.0\s*-\s*knee\)/],
  ['ДХО: ореол exp(-(rBar/12)²) × 0,12',
    /exp\(-pow\(rBar\s*\/\s*12\.0,\s*2\.0\)\)\s*\*\s*cut\s*\*\s*0\.12/],
  ['ДХО: искра по кончику прорисовки',
    /float spark\s*=\s*exp\(-length\(vec2\(\(mx\s*-\s*drawEnd\)\s*\*\s*1\.04,\s*p\.y\s*-\s*sy\)\)\s*\*\s*0\.16\)/],
  ['знак: ec (961,490), eh (37.5,46.5)',
    /vec2 ec\s*=\s*vec2\(961\.0,\s*490\.0\);\s*vec2 eh\s*=\s*vec2\(37\.5,\s*46\.5\)/],
  ['знак: ядро через max()',
    /float core\s*=\s*max\(ink\s*\*\s*smoothstep\(0\.40,\s*0\.48,\s*t\),[\s\S]{0,140}?smoothstep\(0\.42,\s*0\.50,\s*t\)\)/],
  ['знак: свечение 0,32',
    /smoothstep\(0\.42,\s*0\.50,\s*t\)\s*\*\s*0\.32/],
  ['фон: пластина uBg с проявлением 0-0,18',
    /texture\(uBg,\s*p\s*\/\s*vec2\(1920\.0,\s*1080\.0\)\)\.rgb\s*\*\s*smoothstep\(0\.0,\s*0\.18,\s*t\)/],
  ['отражение: три тапа в цикле for (int i = 0; i < 3; i++)',
    /for\s*\(int i = 0; i < 3; i\+\+\)/],
  ['отражение: вес 0,38',
    /0\.38\s*\*\s*reflIn\s*\*\s*fade/],
  ['ночной цвет: mix к #070B12',
    /vec3\(0\.0322,\s*0\.0504,\s*0\.0826\)/],
  ['дизеринг: hash12(frag + t * 91.0)',
    /hash12\(frag\s*\+\s*t\s*\*\s*91\.0\)/],
];
