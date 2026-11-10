/**
 * Динамический порт профиля кузова для замера 3D-фона (задание №55, фаза 2).
 *
 * Это НЕ копия `tools/bg3d/ref.mjs` (порт сцены, принят от владельца как есть) и НЕ
 * копия геометрии: все формулы, сегменты и константы берутся из единственного
 * источника `src/client/car-profile.ts`. Файл отвечает на один вопрос —
 * **сколько операций стоит обращение к силуэту в конкретной точке**.
 *
 * Зачем он нужен рядом с принятой моделью
 * ---------------------------------------
 * В `tools/bg3d/ref.mjs` стоимость обращения к профилю — константа
 * `PROFILE_COST = { inst: 145, scalar: 130 }`, снятая со статического подсчёта
 * SPIR-V (`scripts/bg3d-shader-check.mjs`, колонка «арифм.» по функциям:
 * pTop 101 + pBottom 17 + pArch×2 10 + carProfile 12 + carSdf 5 = 145).
 * Статика отвечает на вопрос «сколько операций компилятор уложил в тела функций».
 * Для `pTop` это ВСЯ if-лесенка из десяти сегментов сразу.
 *
 * На пиксель исполняется не всё:
 *   • `pTop` — десять `if (k < edge) { … return … }`: в точке x исполняются
 *     сравнения до своего сегмента (в среднем половина) и ровно ОДНО тело ветви;
 *   • `pBottom` — при |x| > C_HALF возвращается 2.0 сразу, без сглаживания.
 *
 * Поэтому динамическая стоимость ниже статической, и именно она ближе к тому, что
 * делает GPU на боковом силуэте: k меняется от пикселя к пикселю плавно
 * (сегмент 0,65 м ≈ 90 px экрана), warp почти не расходится, обе ветви одной
 * итерации лесенки одновременно не исполняются.
 *
 * Файл считает ОБА числа из одного текста профиля, чтобы разница была видна,
 * а не спрятана в константе:
 *   • `profileCostDynamic(x, y)` — исполненная ветвь (нижняя, реалистичная граница);
 *   • `profileCostStatic()`      — все ветви подряд (верхняя, консервативная граница;
 *                                  должна совпадать с PROFILE_COST из ref.mjs).
 *
 * Правила счёта — те же, что в `tools/bg3d/ref.mjs` и `tools/intro/ref.mjs`:
 * одна векторная операция = 1 inst, компонентные операции = scalar.
 *   • `clamp(x, a, b)` — 1 inst, 1 scalar (FClamp);
 *   • `length(vec2)` — 1 inst, 4 scalar (два умножения, сложение, sqrt);
 *   • скалярные `+ - * / min max abs` — 1 inst, 1 scalar;
 *   • сравнение в `if` — 1 inst, 1 scalar;
 *   • `vec2(...)`-конструктор — 1 inst, 2 scalar;
 *   • константы (`C_HALF`, коэффициенты Эрмита) операций не стоят: компилятор
 *     держит их в OpConstant, а деление на константу заменяет умножением;
 *   • `OpFunctionCall` — 1 inst (учтены в `carProfileDynamic`).
 */

const profile = await import('../../src/client/car-profile.ts');

export const HALF_LENGTH = profile.CAR.length / 2;
export const TYRE_R = profile.CAR.tyre / 2;
export const ARCH_R = profile.ARCH.radius;
export const ARCH_SQ = profile.ARCH.squashY;
export const AXLE_F = profile.CAR.axles[0];
export const AXLE_R = profile.CAR.axles[1];
export const BELT_BASE = profile.beltAt(0);
export const TOP_SEGMENTS = profile.TOP_SEGMENTS;
export const TOP_LAST = TOP_SEGMENTS[TOP_SEGMENTS.length - 1];
export const TOP_K0 = TOP_SEGMENTS[0].x0;
export const TOP_K1 = TOP_LAST.x0 + TOP_LAST.h;

/* BOTTOM_BASE/BOTTOM_RISE в модуле не экспортируются (внутренние константы), но
   `bottomAt` — их JS-зеркало. Берём значения из него, НЕ переписывая цифры руками:
   поменяет владелец клиренс или подъём юбки — порт подхватит сам. */
export const BOTTOM_BASE = profile.bottomAt(0);                            /* t = 0 */
export const BOTTOM_RISE = profile.bottomAt(HALF_LENGTH * 0.9999) - BOTTOM_BASE;   /* t = 1 */
export const BOTTOM_SPAN = 0.55;

/* ---------- счётчик (свой, чтобы не мешать талли сцены) ---------- */

const PT = { inst: 0, scalar: 0 };
function t(inst, scalar = inst) { PT.inst += inst; PT.scalar += scalar; }
export function resetProfileTally() { PT.inst = 0; PT.scalar = 0; }
export function profileTally() { return { inst: PT.inst, scalar: PT.scalar }; }

/* ---------- функции профиля ---------- */

/**
 * Число операций в теле i-го сегмента: `a + t*(b + t*(c + t*d))`.
 * Нулевые коэффициенты в код не попадают (см. `segGlsl` в car-profile.ts),
 * поэтому стоимость ветви зависит от сегмента — считаем по факту, а не «6 на все».
 */
export function segBodyCost(i) {
  const g = TOP_SEGMENTS[i];
  let ops;
  if (Math.abs(g.d) >= 1e-4) ops = 6;          /* a + t*(b + t*(c + t*d)) */
  else if (Math.abs(g.c) >= 1e-4) ops = 4;     /* a + t*(b + t*c) */
  else if (Math.abs(g.b) >= 1e-4) ops = 2;     /* a + t*b */
  else ops = 0;                                /* только константа a */
  return { inst: ops, scalar: ops, ops };
}

/**
 * float pTop(float x) — ДИНАМИКА: сравнения до своей ветви + тело ветви.
 * Порядок операций ровно как в GLSL:
 *   `float k = clamp(x, x0[0], x0[last]+h[last]);`              → 1 (FClamp);
 *   `if (k < edge_i) { float t = (k - x0_i) / h_i; return …; }`  → по одному
 *     сравнению на каждый ПРОЙДЕННЫЙ сегмент плюс своё, затем 2 на `t`
 *     (вычитание и умножение на 1/h — деление на константу компилятор
 *     превращает в умножение) и 2·(число ненулевых коэффициентов) на полином.
 *
 * За пределами базы GLSL всё равно возвращает значение крайнего сегмента (clamp),
 * тогда как JS-зеркало `topAt` отдаёт заглушку −1. Это различие зеркал, не
 * геометрии: порт следует GLSL, потому что меряет он GLSL.
 */
export function pTopDynamic(x) {
  const k = Math.min(Math.max(x, TOP_K0), TOP_K1);
  t(1, 1);                                     /* clamp(x, k0, k1) */
  let i = TOP_SEGMENTS.findIndex((g) => k < g.x0 + g.h);
  if (i < 0) i = TOP_SEGMENTS.length - 1;
  t(i + 1, i + 1);                             /* сравнения лесенки, включая своё */
  t(2, 2);                                     /* float t = (k - x0) / h */
  const body = segBodyCost(i);
  t(body.inst, body.scalar);
  return pTopValue(x);
}

/** float pTop(float x) — СТАТИКА: все 10 сравнений и все 10 тел подряд. */
export function pTopStatic(x) {
  t(1, 1);                                     /* clamp */
  for (let i = 0; i < TOP_SEGMENTS.length; i++) {
    t(1, 1);                                   /* if (k < edge_i) */
    t(2, 2);                                   /* float t = (k - x0_i) / h_i */
    const body = segBodyCost(i);
    t(body.inst, body.scalar);
  }
  return pTopValue(x);
}

/** Значение pTop (clamp + полином сегмента) без талли. */
export function pTopValue(x) {
  const k = Math.min(Math.max(x, TOP_K0), TOP_K1);
  for (const g of TOP_SEGMENTS) {
    if (k < g.x0 + g.h) {
      const tt = (k - g.x0) / g.h;
      return g.a + tt * (g.b + tt * (g.c + tt * g.d));
    }
  }
  return TOP_LAST.a;
}

/** float pBottom(float x) — с ранним выходом за пределами базы. */
export function pBottomDynamic(x, { earlyReturn = true } = {}) {
  t(3, 3);                                     /* x < -C_HALF, x > C_HALF, || */
  if (earlyReturn && (x < -HALF_LENGTH || x > HALF_LENGTH)) return 2.0;
  t(4, 4);                                     /* abs(x), -1.9, /0.55, clamp */
  t(4, 4);                                     /* t*t, 2.0*t, 3.0-…, t*t*(…) */
  t(5, 5);                                     /* s*0.78, t*0.22, сумма, RISE*…, BASE+… */
  return profile.bottomAt(x);
}

/** float pBelt(float x) — подоконник (в форму кузова не входит, его зовёт carCabin). */
export function pBeltDynamic(x) {
  t(5, 5);                                     /* -x, -0.3, /2.15, clamp, 0.075 * … */
  t(1, 1);                                     /* BASE + … */
  return pBeltValue(x);
}

/** Значение pBelt без талли. */
export function pBeltValue(x) {
  /* в GLSL — clamp(…, 0.0, 1.0): JS-зеркало `beltAt` в модуле написано через
     max(0, …) без верхней границы, и за пределами базы (x < -2.45) они расходятся
     на 0,075·Δ. Порт следует GLSL, потому что меряет GLSL; расхождение зеркала
     помечено как замечание владельцу в отчёте (файл чужой — не правим). */
  return BELT_BASE + 0.075 * Math.min(Math.max((-x - 0.3) / 2.15, 0), 1);
}

/** float pArch(vec2 p, float axle). */
export function pArchDynamic(px, py, axle) {
  t(3, 3);                                     /* p.x - axle, p.y - C_TYRE_R, * C_ARCH_SQ */
  t(1, 2);                                     /* vec2 d */
  t(1, 4);                                     /* length(d) */
  t(1, 1);                                     /* - C_ARCH_R */
  return pArchValue(px, py, axle);
}

/** Значение pArch без талли. */
export function pArchValue(px, py, axle) {
  const dx = px - axle, dy = (py - TYRE_R) * ARCH_SQ;
  return Math.sqrt(dx * dx + dy * dy) - ARCH_R;
}

/** float carProfile(vec2 p) — силуэт: 0 внутри, > 0 снаружи. */
export function carProfileDynamic(px, py, opts = {}) {
  const top = opts.staticTop ? pTopStatic(px) : pTopDynamic(px);
  const bot = pBottomDynamic(px, opts);
  t(3, 3);                                     /* pBottom - p.y, p.y - pTop, max(…) = body */
  const archF = pArchDynamic(px, py, AXLE_F);
  const archR = pArchDynamic(px, py, AXLE_R);
  t(1, 1);                                     /* min(archF, archR) */
  t(4, 4);                                     /* -arch, max(body, -arch), -p.y, max(…) */
  t(4, 4);                                     /* четыре OpFunctionCall: pTop, pBottom, pArch ×2 */
  const body = Math.max(bot - py, py - top);
  return Math.max(Math.max(body, -Math.min(archF, archR)), -py);
}

/**
 * float carCabin(vec2 p) — остекление. В силуэт не входит (шейдер фона его не зовёт:
 * в `bg3d/shader.ts` есть только `carSdf`), но стоимость нужна для полноты сверки
 * со статикой SPIR-V и на случай, если кабина вернётся в кадр.
 */
export function carCabinDynamic(px, py, opts = {}) {
  const belt = pBeltDynamic(px);
  const top = opts.staticTop ? pTopStatic(px) : pTopDynamic(px);
  t(4, 4);                                     /* pBelt - p.y, p.y - (pTop - 0.02), max, pTop - 0.02 */
  t(2, 2);                                     /* -CABIN.front - p.x, max */
  t(2, 2);                                     /* p.x - CABIN.rear, max */
  t(3, 3);                                     /* три OpFunctionCall: pBelt, pTop ×2 */
  const CABIN = profile.CABIN;
  let s = Math.max(belt - py, py - (top - 0.02));
  s = Math.max(s, -CABIN.front - px);
  return Math.max(s, px - CABIN.rear);
}

/**
 * float carWheels(vec2 p) — колёса. Шейдер фона считает их собственной функцией
 * `wheel()` (со спиралью и диском), а не этой, поэтому стоимость приводится
 * отдельно: она нужна, чтобы объяснить разбивку SPIR-V по функциям.
 */
export function carWheelsDynamic(px, py) {
  t(2, 4);                                     /* p - vec2(C_AXLE_F, C_TYRE_R) */
  t(1, 4);                                     /* length */
  t(1, 1);                                     /* - C_TYRE_R */
  t(2, 4);
  t(1, 4);
  t(1, 1);
  t(1, 1);                                     /* min(a, b) */
  const a = Math.hypot(px - AXLE_F, py - TYRE_R) - TYRE_R;
  const b = Math.hypot(px - AXLE_R, py - TYRE_R) - TYRE_R;
  return Math.min(a, b);
}

/**
 * Стоимость ОДНОГО обращения к силуэту в точке (x, y) в метрах модуля:
 * возвращает и значение, и талли.
 */
export function profileCostDynamic(x, y, opts = {}) {
  resetProfileTally();
  const sd = carProfileDynamic(x, y, opts);
  return { sd, ...profileTally() };
}

/** Статическая стоимость обращения к силуэту (все ветви подряд). */
export function profileCostStatic(x = 0, y = 0.8) {
  return profileCostDynamic(x, y, { staticTop: true, earlyReturn: false });
}

/**
 * Средняя динамика по кадру: pTop исполняет разное число сравнений в зависимости
 * от x, pBottom — от попадания за базу, поэтому «одна точка» ничего не доказывает.
 * Усредняем по сетке, которая повторяет распределение пикселей вдоль кузова.
 */
export function profileCostAverage({ n = 64, yBottom = -0.05, yTop = 1.75 } = {}) {
  let inst = 0, scalar = 0, count = 0;
  const perX = [];
  for (let i = 0; i < n; i++) {
    const x = -HALF_LENGTH + (2 * HALF_LENGTH * (i + 0.5)) / n;
    let xi = 0, xs = 0;
    for (let j = 0; j < n; j++) {
      const y = yBottom + ((yTop - yBottom) * (j + 0.5)) / n;
      const c = profileCostDynamic(x, y);
      xi += c.inst; xs += c.scalar;
      inst += c.inst; scalar += c.scalar; count++;
    }
    perX.push({ x: Number(x.toFixed(4)), instPerCall: xi / n, scalarPerCall: xs / n });
  }
  const stat = profileCostStatic();
  return {
    samples: count,
    dynamic: { inst: inst / count, scalar: scalar / count },
    static: { inst: stat.inst, scalar: stat.scalar },
    perX,
  };
}

/**
 * Сверка значений порта с JS-зеркалами модуля: порт обязан возвращать ТУ ЖЕ
 * геометрию, иначе оп/px снят с другой машины. Возвращает худшие |Δ| в метрах.
 */
export function selfCheckGeometry(samples = 20000) {
  let dBottom = 0, dBelt = 0, dProfile = 0, dArch = 0, dTop = 0;
  for (let i = 0; i < samples; i++) {
    /* база кузова: за её пределами JS-зеркала модуля возвращают заглушки (−1 и 2),
       а GLSL продолжает форму через clamp — сверяем там, где обе стороны про геометрию */
    const x = -HALF_LENGTH + 2 * HALF_LENGTH * Math.random();
    const y = -0.05 + 1.85 * Math.random();
    resetProfileTally();
    dBottom = Math.max(dBottom, Math.abs(pBottomDynamic(x) - profile.bottomAt(x)));
    dBelt = Math.max(dBelt, Math.abs(pBeltValue(x) - profile.beltAt(x)));
    dTop = Math.max(dTop, Math.abs(pTopValue(x) - profile.topAt(x)));
    dArch = Math.max(dArch, Math.abs(pArchValue(x, y, AXLE_F)
      - (Math.hypot(x - AXLE_F, (y - TYRE_R) * ARCH_SQ) - ARCH_R)));
    resetProfileTally();
    dProfile = Math.max(dProfile, Math.abs(carProfileDynamic(x, y) - profile.carProfileJS(x, y)));
  }
  return { dBottom, dBelt, dTop, dArch, dProfile, samples };
}
