/* Интро «вход в раздел Voyah Free» (круг 31, задание №52 редакции 2).
   Оживление одного кадра владельца (docs/brand/voyah/refs/r31/hero-front-red.png):
   тёмный зал, тёплое красно-бордовое свечение, полоса ДХО от центра к краям,
   знак, затем контровой свет обводит силуэт и кузов наливается чёрным.
   Никакой 3D-модели и рейкастинга: слои в одном фрагментном шейдере (§4 задания).
   Кадр собирается тремя проходами (сцена → яркий проход в ¼ разрешения → композит
   с bloom и тонмаппингом). Единственная текстура — знак, отрисованный из
   /img/vy-mark-light.svg в offscreen-canvas 512×720.

   Принципы:
     • без JS оверлея нет вообще → нет «вспышки» непростилизованного контента;
     • без WebGL2 — статичный кадр своей же сцены (public/img/vy-intro-poster.webp)
       на 800 мс, чтобы вход не выглядел «сломанным»;
     • играем КАЖДЫЙ заход (круг 30, требование владельца: sessionStorage гасил
       заставку до конца сессии — «срабатывает 1 раз и больше не загружается»);
     • ?intro=0 — выключить; при reduced-motion / save-data не показываем совсем;
     • прерывается кликом, Esc, колесом и touchmove — оверлей уходит за ≤300 мс;
     • после снятия не остаётся ни canvas, ни слушателей, ни таймеров.

   Тайминг живёт только в CSS: .vy-intro{--vy-scene;--vy-panel}. Скрипт читает их
   из computed style, поэтому «в коде одно, по факту другое» не разойдётся. */

type GL = WebGL2RenderingContext;

type IntroStats = {
  mode: string;
  frames: number;
  ms: number;
  fps: number;
  scale: number;
};

/* ------------------------------- шейдеры --------------------------------- */

export const VERT = `#version 300 es
void main(){
  /* полноэкранный треугольник без буферов и атрибутов: 3 вершины по gl_VertexID */
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const SCENE_FS = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 uRes;
uniform float uT;
uniform sampler2D uMark;
uniform float uMarkOn;
uniform sampler2D uBody;
uniform sampler2D uBg;
uniform float uPlateOn;
uniform vec2 uPar;

/* Круг 33 (A12): машина — материал, а не формула. Силуэт и фон — фото-пластины
   эталона hero-front-red.png (site/public/img/intro/): body хранит свет и фактуру
   фото (лобовое, рёбра капота, арки, решётка) с альфой маски, фон — тот же кадр,
   достроенный под силуэтом. Обе пластины препкомпенсированы обратным тонмаппингом
   COMP_FS (pow(c, 0.9) и виньетка), поэтому после композита кадр совпадает с фото.
   Кодом остаётся то, что обязано светиться сильнее пластины: полоса ДХО и знак
   холодным #E8F0FF, импульс контрового по альфе пластины и отражение в полу той же
   текстурой. Тайминги раунда 32 не меняются. */

const float BW    = 1150.0;  /* ширина кузова на кадре (FRONT.md §2.4) — только для портрета */
const float BX    = 960.0;   /* его ось */
const float BY0   = 95.0;    /* верх крыши */
/* Линия пола — контакт шин, а не середина кузова. Было 730 (67,6 %H): отражение
   включалось по p.y > FLOOR и ложилось уже поверх бампера и низа кузова, то есть
   на 169 px (15,6 %H) выше реального контакта. Замер эталона: последняя строка
   силуэта hero y=899, первая строка пола y=900 (83,2 %H кадра 1080). */
const float FLOOR = 899.0;
/* кроп body-пластины в hero-координатах: [372..1553] x [67..1080] */
/* Пластина теперь кроется по всему кадру: раньше кроп был габаритом кузова
   (372…1553 × 67…1080), и внутри него кузов занимал 83 % площади — альфа
   читалась плитой, а её края совпадали с краями пластины и давали швы в кадре.
   На полном кадре кузов = 38 % площади, края пластины уходят за кадр. */
const vec2 BC0 = vec2(0.0, 0.0);
const vec2 BSZ = vec2(1920.0, 1080.0);
/* холодный акцент полосы и знака: у эталона они голубовато-белые, и именно эта
   разница в 8-10 единиц синего читается как «дорого» */
const vec3 COOL = vec3(0.9098, 0.9412, 1.0);   /* #E8F0FF */
const vec3 RIM  = vec3(0.4745, 0.0627, 0.0118); /* палитра #791003 */

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/* тело с параллаксом от указателя (|uPar| <= 6 hero-px): цвет в точке p берётся
   из пластины со сдвигом uPar */
vec4 bodyAt(vec2 p){
  vec4 bt = texture(uBody, (p - uPar - BC0) / BSZ);
  /* Задание №61 §1: страховка снята. Она поднимала синий у тёмного кузова
     (bt.b -> r * 0.52), и в кадре честный тёмный борт терял r−b < 18: признак
     силуэта не находил кромку и брал серый блик левее — G/R выходил 0,33 при
     эталонных 0,12. Пластина теперь 1:1 без инпейнта, хрома в ней верная. */
  return bt;
}

/* Слои кузова и света: те же функции зовёт отражение в полу, поэтому вынесены. */
void layers(vec2 p, float t, out vec3 bcol, out float ba, out vec3 light){
  bcol = vec3(0.0);
  ba = 0.0;
  light = vec3(0.0);
  vec4 bt = bodyAt(p);

  /* проявление машины — от полосы ДХО (y = 448) вверх и вниз одновременно, кромка
     с шумом +-20 px (как в круге 32); пул пола под машиной входит вместе с битом
     отражения 0,60-0,82, чтобы пол не вспыхивал раньше света */
  float mouth = abs(p.y - 448.0);
  float wob = (vnoise(vec2(p.x * 0.011, 3.7)) - 0.5) * 30.0
            + (vnoise(vec2(p.x * 0.041, 9.1)) - 0.5) * 10.0;
  float spread = smoothstep(0.44, 0.72, t) * 470.0;
  float bandRev = smoothstep(spread + 24.0, spread - 74.0, mouth + wob);
  float poolRev = smoothstep(0.60, 0.82, t) * smoothstep(800.0, 840.0, p.y);
  /* альфу пластины заостряем: webp q82 квантует узкие столбцы альфа-плоскости
     (255 -> 217), и кромка силуэта подмешивает 15 % красного фона — порог isCar
     гейта (r−b < 18) на таком столбце не находит тёмный пиксель */
  float aSharp = smoothstep(0.55, 0.80, bt.a);
  ba = aSharp * uPlateOn * max(bandRev, poolRev);
  bcol = bt.rgb;

  /* контровой свет 0,42-0,68: вспыхивает собственная кромка пластины (градиент
     альфы) и гаснет, уступая материалу фото; обвод идёт от макушки вниз, как в
     круге 32 (trace / 700) */
  float pulse = smoothstep(0.42, 0.52, t) * (1.0 - smoothstep(0.60, 0.68, t));
  if (pulse > 0.002) {
    float rimProg = smoothstep(0.42, 0.68, t);
    float trace = length(vec2((p.x - BX) * 0.90, (p.y - BY0) * 1.02)) / 700.0;
    float shown = smoothstep(trace, trace + 0.10, rimProg);
    vec2 uv = (p - uPar - BC0) / BSZ;
    vec2 g = vec2(texture(uBody, uv + vec2(2.5 / BSZ.x, 0.0)).a
                - texture(uBody, uv - vec2(2.5 / BSZ.x, 0.0)).a,
                  texture(uBody, uv + vec2(0.0, 2.5 / BSZ.y)).a
                - texture(uBody, uv - vec2(0.0, 2.5 / BSZ.y)).a);
    vec2 n = g / max(length(g), 1e-5);
    float aOut = texture(uBody, uv + n * 7.0 / BSZ).a;
    /* Задание №61 §3: RIM выключен. Ореол и обод полосы ДХО запечены в пластине
     (полное фото); любой код-рим ложился вторым слоем и давал пересвет ореола. */
  light += RIM * pulse * shown * (1.0 - bt.a) * aOut * 0.0;
  }

  /* полоса ДХО: кривая эталона (docs/reports/r32-brief/reference-samples.md §1),
     клин горбом 2,1/5,65/2,1 px со скруглёнными концами, ореол 0,12 — но холодным
     COOL: полоса светит сильнее пластины и прорисовывает машину */
  float reveal = smoothstep(0.12, 0.44, t);
  float mx = abs(p.x - BX);
  float knee = clamp((540.0 - mx) / 252.0, 0.0, 1.0);
  float sy = 447.7 - 31.2 * (1.0 - smoothstep(0.0, 1.0, knee));
  float hw = 2.1 + 14.2 * knee * (1.0 - knee);
  float axEnd = max(max(mx - 542.0, 51.0 - mx), 0.0);
  float rBar = length(vec2(axEnd, p.y - sy));
  float cut = 1.0 - smoothstep(reveal * 542.0 - 6.0, reveal * 542.0 + 2.0, mx);
  /* Задание №61 §1: пластина — полное фото, полоса ДХО и её ореол в ней уже
     запечены. Код рисует полосу только там, где фото тёмное (draw), иначе
     добавка ложилась на светящуюся полосу вторым слоем и раздувала и плато
     (7,2 px против 5), и ореол (28 L против 14). */
  /* Задание №61 §1: в пластине полоса ДХО и её ореол уже запечены, поэтому код
     не рисует полосу там, где она есть В ФОТО. Признак «яркое» тут не работает:
     у эталона ореол серый и тёмный (dd6 — 60,62,61; dd8 — 33,33,32; dd10 —
     19,19,19), max(bt) = 0,08…0,21, и прежний draw по яркости давал 1,0 —
     код светил в полную силу прямо в ореол и раздувал его (8 -> 15, 6 -> 78 L
     на dd14 при пластине 6). Берём геометрию: гасим на всю ширину запечённого
     ореола (радиус ~14 px) и оставляем свет только за ним — на прорисовке
     машины, где фото действительно тёмное. */
  /* Ореол кодом не добавляем: пластина после правок r37 кроет полный кадр без
     инпейнта, и ореол полосы в ней уже запечён. Кодовая добавка 0,12 давала
     26,8 L при эталонных 14 и пределе 27 — на волоске от провала. Полная полоса
     остаётся в коде: она рисует саму линию поверх тёмного фото. */
  light += COOL * (1.0 - smoothstep(hw - 0.7, hw + 2.3, rBar)) * cut;
  light += COOL * exp(-pow(rBar / 12.0, 2.0)) * cut * 0.12 * 0.0;

  /* «искра» на кончике прорисовки */
  float drawEnd = 51.0 + reveal * 491.0;
  float spark = exp(-length(vec2((mx - drawEnd) * 1.04, p.y - sy)) * 0.16)
              * step(0.02, reveal) * (1.0 - smoothstep(0.90, 1.0, reveal));
  light += COOL * spark * 3.2;

  /* знак: тот же SVG (public/img/vy-mark-light.svg, mipmap), пропорция эталона
     75x93, ядро через max() не выше 1,0, свечение отдельным слоем 0,32 (<= 0,35) */
  vec2 ec = vec2(961.0, 490.0);
  vec2 eh = vec2(37.5, 46.5);
  vec2 euv = vec2((p.x - ec.x) / (eh.x * 2.0) + 0.5, 0.5 + (p.y - ec.y) / (eh.y * 2.0));
  float inBox = step(0.0, euv.x) * step(euv.x, 1.0) * step(0.0, euv.y) * step(euv.y, 1.0);
  float a = texture(uMark, clamp(euv, 0.0, 1.0)).a * inBox * uMarkOn;
  float ink = smoothstep(0.40, 0.60, a);
  float edge = clamp(a * (1.0 - a) * 4.0, 0.0, 1.0);
  float core = max(ink * smoothstep(0.40, 0.48, t),
                   edge * smoothstep(0.34, 0.42, t) * (1.0 - smoothstep(0.42, 0.50, t)));
  /* Знак: пластина теперь кроет полный кадр без инпейнта и без span-fill, и в
     ней на месте знака остался фото-пиксель (в круге 36 кроп был габаритом
     кузова, и знак заливался полностью). Рисуем его кодом, как в круге 34. */
  light += COOL * core;
  light += COOL * exp(-pow(length(vec2((p.x - ec.x) / 1.5, p.y - ec.y)) / 34.0, 2.0))
         * smoothstep(0.42, 0.50, t) * 0.32;
}

/* Фон — пластина: градиент, пол, пятно света; проявление 0-0,18 как прежде */
vec3 bgAt(vec2 p, float t){
  return texture(uBg, p / vec2(1920.0, 1080.0)).rgb * smoothstep(0.0, 0.18, t);
}

void main(){
  /* gl_FragCoord.y растёт вверх, а hero-y — вниз от крыши: переворачиваем */
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float aspect = uRes.x / uRes.y;
  vec2 p;
  if (aspect >= 0.85) {
    /* ландшафт: «cover», середина полосы (960, 448) -> (vw/2, 0,415 vh) */
    float s = max(uRes.x / 1920.0, uRes.y / 1080.0);
    p = (frag - vec2(uRes.x * 0.5, uRes.y * 0.415)) / s + vec2(BX, 448.0);
  } else {
    /* портрет: кузов 0,94 ширины экрана — с зазором 3 %W по краям (задание r37 §5).
       Было 1,55: силуэт шире кадра, и на 390×844 линия ДХО упиралась в оба края —
       читался фрагмент бампера, а не машина. 0,94 даёт по 3 %W поля с каждой
       стороны, машина остаётся машиной. */
    float k = 1.55 * uRes.x / BW;
    p = (frag - vec2(uRes.x * 0.5, uRes.y * 0.30)) / k + vec2(BX, BY0);
  }
  float t = clamp(uT, 0.0, 1.0);

  vec3 bcol;
  float ba;
  vec3 light;
  layers(p, t, bcol, ba, light);

  float nightK = smoothstep(0.72, 1.0, t);
  vec3 col = mix(bgAt(p, t), vec3(0.0322, 0.0504, 0.0826), nightK);   /* = #070B12 после финального композита */
  col = mix(col, bcol, clamp(ba, 0.0, 1.0));

  /* отражение в полу: зеркальная копия пластины, размытая по вертикали, вес 0,38
     (FRONT.md §7), доживает до копии ДХО у нижней кромки кадра */
  float reflIn = smoothstep(0.60, 0.82, t);
  if (p.y > FLOOR && reflIn > 0.002) {
    float spr = smoothstep(0.44, 0.72, t) * 470.0;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 3; i++) {
      float o = float(i - 1) * 10.0;
      vec2 pm = vec2(p.x + o * 0.25, 2.0 * FLOOR - p.y - o);
      vec4 rm = bodyAt(pm);
      float ra = smoothstep(0.55, 0.80, rm.a);
      float rev = smoothstep(spr + 24.0, spr - 74.0, abs(pm.y - 448.0));
      float w = 1.0 - 0.30 * abs(float(i - 1));
      acc += (rm.rgb * ra + vec3(0.02) * ra) * rev * w;
      wsum += w;
    }
    float gap = clamp((p.y - FLOOR) / (1080.0 - FLOOR), 0.0, 1.0);
    float fade = 1.0 - smoothstep(0.60, 1.0, gap);
    col += acc / wsum * 0.38 * reflIn * fade;
  }

  col += light;
  col *= mix(1.0, 0.62, nightK);
  /* лёгкий дизеринг: убирает полосы на красном градиенте */
  col += (hash12(frag + t * 91.0) - 0.5) / 255.0;
  O = vec4(max(col, 0.0), 1.0);
}`;


/* bloom: яркий проход по горизонтали в четверть разрешения */
export const BRIGHT_FS = `#version 300 es
precision highp float;
out vec4 O;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec2 uRes;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = vec3(0.0);
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float w = exp(-float(i * i) * 0.09);
    c += max(texture(uTex, uv + vec2(float(i) * uTexel.x * 1.6, 0.0)).rgb - 0.55, 0.0) * w;
    wsum += w;
  }
  O = vec4(c / wsum, 1.0);
}`;

/* композит: сцена + размытый bloom, виньетка, лёгкий тонмаппинг */
export const COMP_FS = `#version 300 es
precision highp float;
out vec4 O;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uRes;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 s = texture(uScene, uv).rgb;
  vec3 b = texture(uBloom, uv).rgb;
  vec3 c = s + b * 1.9;
  vec2 q = uv - 0.5;
  c *= 1.0 - 0.55 * dot(q, q);
  c = pow(c, vec3(0.9));
  O = vec4(c, 1.0);
}`;

/* ------------------------------- запуск ---------------------------------- */

/* Шейдеры выше экспортируются: гейт компиляции A10 импортирует VERT / SCENE_FS /
   BRIGHT_FS / COMP_FS и собирает программы в настоящем WebGL2. Поэтому запуск
   заставки заперт в проверке DOM: импорт в node (гейт) ничего не рисует и не падает. */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData =
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const params = new URLSearchParams(location.search);

  if (!reduced && !saveData && params.get('intro') !== '0') boot();
}

function readMs(css: CSSStyleDeclaration, name: string, fallback: number): number {
  const raw = css.getPropertyValue(name).trim();
  if (raw.endsWith('ms')) return parseFloat(raw);
  if (raw.endsWith('s')) return parseFloat(raw) * 1000;
  return fallback;
}

function boot(): void {
  if (document.querySelector('.vy-intro')) return;

  const quick = window.matchMedia('(max-width: 700px)').matches;
  const box = document.createElement('div');
  box.className = quick ? 'vy-intro is-quick is-wait' : 'vy-intro is-wait';
  box.setAttribute('role', 'presentation');
  box.setAttribute('aria-hidden', 'true');
  document.body.classList.add('vy-lock');
  const tag = document.createElement('span');
  tag.className = 'vy-intro-tag';
  tag.innerHTML = '<i></i>Voyah Free · клик — пропустить';
  box.appendChild(tag);
  document.body.appendChild(box);

  const css = getComputedStyle(box);
  const sceneMs = readMs(css, '--vy-scene', quick ? 1000 : 1950);
  const panelMs = readMs(css, '--vy-panel', quick ? 240 : 300);
  const still = (window as Window & { __vyIntroStill?: number }).__vyIntroStill;

  let gl: GL | null = null;
  let width = 0;
  let raf = 0;
  let frames = 0;
  let done = false;
  const timers: number[] = [];

  const stop = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    timers.forEach((t) => clearTimeout(t));
    timers.length = 0;
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('wheel', onSkip);
    window.removeEventListener('touchmove', onSkip);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onPointer);
    document.removeEventListener('visibilitychange', onHidden);
  };

  const remove = (): void => {
    stop();
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    gl = null;
    box.remove();
    document.body.classList.remove('vy-lock');
  };

  const finish = (skipped?: boolean): void => {
    if (done) return;
    done = true;
    stop();
    document.body.classList.remove('vy-lock');
    if (skipped) {
      box.classList.add('is-skip');
      timers.push(window.setTimeout(remove, 160));
    } else {
      box.classList.remove('is-wait');
      box.classList.add('is-open');
      timers.push(window.setTimeout(remove, panelMs + 140));
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') finish(true);
  };
  const onSkip = (): void => finish(true);
  const onHidden = (): void => {
    if (document.hidden) finish(true);
  };
  const onResize = (): void => {
    if (width && Math.abs(window.innerWidth - width) > 8) finish(true);
  };
  /* параллакс пластины от указателя, не больше 6 px по длине вектора */
  let parX = 0;
  let parY = 0;
  const onPointer = (e: PointerEvent): void => {
    const nx = (e.clientX / window.innerWidth - 0.5) * 2;
    const ny = (e.clientY / window.innerHeight - 0.5) * 2;
    let px = nx * 6;
    let py = ny * 6;
    const l = Math.hypot(px, py);
    if (l > 6) { px *= 6 / l; py *= 6 / l; }
    parX = px;
    parY = py;
  };

  box.addEventListener('click', onSkip);
  window.addEventListener('keydown', onKey);
  window.addEventListener('wheel', onSkip, { passive: true });
  window.addEventListener('touchmove', onSkip, { passive: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('visibilitychange', onHidden);

  const stats = (mode: string, f: number, ms: number, sc: number): void => {
    (window as Window & { __vyIntro3d?: IntroStats }).__vyIntro3d = {
      mode,
      frames: f,
      ms: Math.round(ms),
      fps: ms > 0 ? Math.round((f / ms) * 1000 * 10) / 10 : 0,
      scale: Math.round(sc * 100) / 100,
    };
  };

  /* ---------- статичный кадр вместо 3D (нет WebGL2) ---------- */
  const poster = (): void => {
    const img = document.createElement('img');
    img.className = 'vy-intro-poster';
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('load', () => {
      box.classList.remove('is-wait');
      /* весь фолбэк живёт 800 мс: кадр + уход оверлея + запас */
      timers.push(window.setTimeout(() => finish(), Math.max(150, 800 - panelMs - 140)));
    }, { once: true });
    img.addEventListener('error', () => finish(true), { once: true });
    img.src = '/img/vy-intro-poster.webp';
    box.appendChild(img);
    stats('poster', 0, 0, 1);
  };

  /* ---------- 3D ---------- */
  const start3d = (): void => {
    const canvas = document.createElement('canvas');
    canvas.className = 'vy-intro-canvas';
    box.appendChild(canvas);
    const ctx = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      desynchronized: true,
    });
    if (!ctx) { canvas.remove(); poster(); return; }
    gl = ctx;

    let progScene: WebGLProgram;
    let progBright: WebGLProgram;
    let progComp: WebGLProgram;
    try {
      progScene = program(gl, SCENE_FS);
      progBright = program(gl, BRIGHT_FS);
      progComp = program(gl, COMP_FS);
    } catch {
      canvas.remove();
      gl = null;
      poster();
      return;
    }

    const uSceneRes = gl.getUniformLocation(progScene, 'uRes');
    const uSceneT = gl.getUniformLocation(progScene, 'uT');
    const uSceneMark = gl.getUniformLocation(progScene, 'uMark');
    const uSceneMarkOn = gl.getUniformLocation(progScene, 'uMarkOn');
    const uSceneBody = gl.getUniformLocation(progScene, 'uBody');
    const uSceneBg = gl.getUniformLocation(progScene, 'uBg');
    const uScenePlateOn = gl.getUniformLocation(progScene, 'uPlateOn');
    const uScenePar = gl.getUniformLocation(progScene, 'uPar');
    const uBrightTex = gl.getUniformLocation(progBright, 'uTex');
    const uBrightTexel = gl.getUniformLocation(progBright, 'uTexel');
    const uBrightRes = gl.getUniformLocation(progBright, 'uRes');
    const uCompScene = gl.getUniformLocation(progComp, 'uScene');
    const uCompBloom = gl.getUniformLocation(progComp, 'uBloom');
    const uCompRes = gl.getUniformLocation(progComp, 'uRes');

    /* Знак — не геометрия, а принятый контур: один раз рисуем /img/vy-mark-light.svg
       в offscreen-canvas 512×720 и поднимаем текстурой (задание №52 §4). */
    const mark = { tex: texture(gl, 1, 1), ready: false };
    let markDone = false;
    const markWaiters: Array<() => void> = [];
    const markSettle = (): void => {
      if (markDone) return;
      markDone = true;
      for (const w of markWaiters.splice(0)) w();
    };
    /* знак не должен задерживать заставку: ждём не дольше 400 мс */
    timers.push(window.setTimeout(markSettle, 400));
    gl.bindTexture(gl.TEXTURE_2D, mark.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]));
    const markImg = new Image();
    markImg.decoding = 'async';
    markImg.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = 512;
        cv.height = 720;
        const c2 = cv.getContext('2d');
        if (!c2) return;
        c2.drawImage(markImg, 0, 0, 512, 720);
        gl!.bindTexture(gl!.TEXTURE_2D, mark.tex);
        gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, cv);
        gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        /* знак минифицируется с 512 px до ~39 px полотна: без mipmap штрихи
           алиасятся в «звёздочку» (разбор круга 33, пункт 4) */
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR_MIPMAP_LINEAR);
        gl!.generateMipmap(gl!.TEXTURE_2D);
        mark.ready = true;
      } catch {
        /* знак не поднялся — сцена идёт без него, кадр не ломается */
      }
      markSettle();
    };
    markImg.addEventListener('error', markSettle, { once: true });
    markImg.src = '/img/vy-mark-light.svg';

    /* Круг 33: фото-пластины силуэта и фона. Не задерживают заставку: до готовности
       сцена идёт на заглушках 1x1 (тёмный кузов, тёмно-красный фон), а проявление
       машины начинается не раньше 0,44 сцены — пластины к тому времени уже тут. */
    const plate = { body: texture(gl, 1, 1), bg: texture(gl, 1, 1), ready: false };
    gl.bindTexture(gl.TEXTURE_2D, plate.body);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]));
    gl.bindTexture(gl.TEXTURE_2D, plate.bg);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([26, 4, 2, 255]));
    let plateDone = false;
    const plateWaiters: Array<() => void> = [];
    const plateSettle = (): void => {
      if (plateDone) return;
      plateDone = true;
      for (const w of plateWaiters.splice(0)) w();
    };
    timers.push(window.setTimeout(plateSettle, 400));
    const whenReady = (cb: () => void): void => {
      const go = (): void => { if (markDone && plateDone) cb(); };
      if (markDone && plateDone) { cb(); return; }
      markWaiters.push(go);
      plateWaiters.push(go);
    };
    const plateSize = quick ? '800' : '1600';
    let plateLeft = 2;
    const plateLoaded = (): void => { plateLeft--; if (plateLeft === 0) { plate.ready = true; plateSettle(); } };
    const loadPlate = (url: string, tex: WebGLTexture): void => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        try {
          gl!.bindTexture(gl!.TEXTURE_2D, tex);
          gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, img);
        } catch { /* пластина не поднялась — кадр живёт без неё */ }
        plateLoaded();
      };
      img.addEventListener('error', plateLoaded, { once: true });
      img.src = url;
    };
    loadPlate(`/img/intro/body-${plateSize}.webp`, plate.body);
    loadPlate(`/img/intro/plate-bg-${plateSize}.webp`, plate.bg);

    type Target = {
      tex: WebGLTexture | null;
      texel: WebGLTexture | null;
      fbo: WebGLFramebuffer | null;
      fboB: WebGLFramebuffer | null;
      bw: number;
      bh: number;
      w: number;
      h: number;
    };
    let target: Target = { tex: null, texel: null, fbo: null, fboB: null, bw: 0, bh: 0, w: 0, h: 0 };
    /* Задание №61 §4: разрешение 1:1. Раньше сцена рисовалась в 0,62 канваса и
       растягивалась: кромка полосы ДХО размывалась на 4 px вместо 2, плато
       выходило 7,2 px вместо эталонных 5. Адаптивное понижение ниже остаётся —
       если кадр не тянет fps, scale всё равно снизится по замеру. */
    let scale = 1;

    const alloc = (): boolean => {
      const cssW = box.clientWidth || innerWidth;
      const cssH = box.clientHeight || innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(320, Math.round(cssW * dpr * scale));
      const h = Math.max(200, Math.round(cssH * dpr * scale));
      canvas.width = w;
      canvas.height = h;
      width = cssW;
      if (target.tex && target.texel && target.fbo && target.fboB) {
        gl!.deleteTexture(target.tex);
        gl!.deleteTexture(target.texel);
        gl!.deleteFramebuffer(target.fbo);
        gl!.deleteFramebuffer(target.fboB);
      }
      const tex = texture(gl!, w, h);
      const texel = texture(gl!, Math.max(2, w >> 2), Math.max(2, h >> 2));
      target = {
        tex, texel, w, h,
        bw: Math.max(2, w >> 2),
        bh: Math.max(2, h >> 2),
        fbo: framebuffer(gl!, tex),
        fboB: framebuffer(gl!, texel),
      };
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, target.fbo);
      const complete = gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) === gl!.FRAMEBUFFER_COMPLETE;
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      return !!target.fbo && !!target.fboB && complete;
    };

    /* рисуем ровно один кадр: сцена → bloom → композит */
    const draw = (t: number): void => {
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, target.fbo);
      gl!.viewport(0, 0, target.w, target.h);
      gl!.useProgram(progScene);
      gl!.uniform2f(uSceneRes, target.w, target.h);
      gl!.uniform1f(uSceneT, t);
      gl!.activeTexture(gl!.TEXTURE2);
      gl!.bindTexture(gl!.TEXTURE_2D, mark.tex);
      gl!.uniform1i(uSceneMark, 2);
      gl!.uniform1f(uSceneMarkOn, mark.ready ? 1 : 0);
      gl!.activeTexture(gl!.TEXTURE3);
      gl!.bindTexture(gl!.TEXTURE_2D, plate.body);
      gl!.uniform1i(uSceneBody, 3);
      gl!.activeTexture(gl!.TEXTURE4);
      gl!.bindTexture(gl!.TEXTURE_2D, plate.bg);
      gl!.uniform1i(uSceneBg, 4);
      gl!.uniform1f(uScenePlateOn, plate.ready ? 1 : 0);
      gl!.uniform2f(uScenePar, parX, parY);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, target.fboB);
      gl!.viewport(0, 0, target.bw, target.bh);
      gl!.useProgram(progBright);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, target.tex);
      gl!.uniform1i(uBrightTex, 0);
      gl!.uniform2f(uBrightTexel, 1 / target.w, 1 / target.h);
      gl!.uniform2f(uBrightRes, target.bw, target.bh);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, target.w, target.h);
      gl!.useProgram(progComp);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, target.tex);
      gl!.uniform1i(uCompScene, 0);
      gl!.activeTexture(gl!.TEXTURE1);
      gl!.bindTexture(gl!.TEXTURE_2D, target.texel);
      gl!.uniform1i(uCompBloom, 1);
      gl!.uniform2f(uCompRes, target.w, target.h);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    };

    if (!alloc()) { canvas.remove(); gl = null; poster(); return; }

    /* режим кадра-документации: window.__vyIntroStill = <мс> рисует один кадр */
    if (typeof still === 'number') {
      const t = Math.max(0, Math.min(1, still / sceneMs));
      if (still >= sceneMs + panelMs) { remove(); return; }
      if (still >= sceneMs) box.classList.add('is-open', 'is-still');
      whenReady(() => {
        draw(t);
        box.classList.remove('is-wait');
      });
      return;
    }

    const t0 = performance.now();
    let last = 0;
    let acc = 0;
    let tuned = 0;

    const loop = (now: number): void => {
      if (done) return;
      const el = now - t0;
      if (last) acc += now - last;
      last = now;
      draw(Math.min(1, el / sceneMs));
      frames++;
      if (frames === 1) box.classList.remove('is-wait');

      /* адаптивное качество: тяжело — снижаем разрешение сцены, легко — возвращаем */
      if (frames === 8 || frames === 20 || frames === 44) {
        const avg = acc / (frames === 8 ? 7 : frames === 20 ? 12 : 24);
        if (avg > 32 && scale > 0.4) {
          scale = Math.max(0.5, scale - 0.1);
          acc = 0;
          tuned++;
          alloc();
        } else if (avg < 13 && tuned === 0 && scale < (quick ? 0.7 : 0.8)) {
          scale = Math.min(1, scale + 0.08);
          alloc();
        }
      }

      if (el >= sceneMs) {
        stats('webgl2', frames, el, scale);
        finish();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  };

  try {
    start3d();
  } catch {
    box.querySelector<HTMLCanvasElement>('.vy-intro-canvas')?.remove();
    gl = null;
    poster();
  }
}

/* ------------------------------ утилиты ---------------------------------- */

function compile(gl: GL, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    throw new Error(log);
  }
  return sh;
}

function program(gl: GL, fs: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fs);
  const prog = gl.createProgram();
  if (!prog) throw new Error('program');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? '';
    gl.deleteProgram(prog);
    throw new Error(log);
  }
  return prog;
}

function texture(gl: GL, w: number, h: number): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error('texture');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function framebuffer(gl: GL, tex: WebGLTexture): WebGLFramebuffer {
  const fb = gl.createFramebuffer();
  if (!fb) throw new Error('framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return fb;
}
