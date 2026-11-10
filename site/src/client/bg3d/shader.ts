/**
 * Шейдер 3D-фона (задание №44, раунд 30).
 *
 * Ограничения задания, которые заданы здесь жёстко:
 *  - **0 текстур**: ни одного `texture2D`/`sampler2D`. Всё — процедурная математика
 *    (value-noise на хеше, SDF-примитивы). Поэтому вес = текст шейдера, а не мегабайты картинок.
 *  - **один шейдер на два прототипа**: вариант A «глубина» и вариант B «силуэт в глубине»
 *    переключаются uniform'ом `uMode`, а не второй программой. Ветвление по uniform
 *    когерентно (все пиксели кадра идут одной веткой), поэтому второй вариант не удваивает
 *    стоимость первого на устройстве — он добавляет только свою ветку.
 *  - **ESSL 1.00** (`attribute`/`varying`/`gl_FragColor`): один и тот же исходник компилируется
 *    и в WebGL2, и в WebGL1-контексте (WebGL2 принимает ESSL 1.00). Отдельной ветки для
 *    старого Android не нужно.
 *  - **циклы только с константными границами** (требование ESSL 1.00) — циклов нет вовсе,
 *    всё развёрнуто явно.
 *
 * Палитра приходит uniform'ами из CSS-токенов (`--night`, `--deep`, `--brass`, `--copper`,
 * `--mist`, `--danger`), а не зашита здесь: если владелец поменяет палитру, фон поедет с ней.
 *
 * Базовый цвет `mix(uNight, uDeep, vUv.y)` — это ровно `linear-gradient(180deg, var(--deep),
 * var(--night))` из `.page-head` (pages.css:7). Поэтому «фон выключен» и «фон включён»
 * отличаются только глубиной, а не тоном страницы: переключение не выглядит прыжком.
 */

/** Один треугольник на весь экран: 3 вершины, 0 индексных буферов, 1 draw call. */
export const VERT = `precision highp float;
attribute vec2 aPos;
varying vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const FRAG = `precision highp float;

varying vec2 vUv;

uniform vec2  uRes;      /* физические пиксели канваса (уже с DPR и renderScale) */
uniform float uTime;     /* секунды с запуска, с накоплением только пока фон не на паузе */
uniform float uScroll;   /* 0..1 — насколько хост уехал вверх за край экрана */
uniform vec2  uPointer;  /* -1..1, сглаженное положение указателя */
uniform float uMode;     /* 0 = A «глубина», 1 = B «силуэт в глубине» */
uniform float uQuality;  /* 0 = low, 1 = mid, 2 = high — сколько слоёв шума и есть ли отражение */
uniform float uFade;     /* 0..1 — появление и уход фона */
uniform vec3  uNight;
uniform vec3  uDeep;
uniform vec3  uBrass;
uniform vec3  uCopper;
uniform vec3  uMist;
uniform vec3  uDanger;

/* ---------- шум ---------- */

/* Хеш без sin и без текстур: sin на мобильных GPU уходит в SFU и даёт полосы на больших
   площадях, а этот хеш — 6 арифметических операций и ровное зерно. */
float hash21(vec2 p){
  p = fract(p * vec2(0.3183099, 0.3678794));
  p *= 17.0;
  return fract(p.x * p.y * (p.x + p.y));
}

/* Value-noise: 4 хеша + билинейная интерполяция с smoothstep. Одна выборка ≈ 36 операций. */
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/* ---------- SDF-примитивы силуэта ---------- */

float sdRoundBox(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

float sdCircle(vec2 p, float r){
  return length(p) - r;
}

float sdSeg(vec2 p, vec2 a, vec2 b, float r){
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

/* Гладкое объединение: без него кузов и крыша стыкуются углами. */
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

/* Собирательный силуэт кроссовера, вид сбоку. q — локальные координаты, 0 = центр кузова.
   НИКАКИХ шильдиков, номеров, логотипов и читаемых элементов: правило арт-дирекшна
   (docs/art-direction/README.md) и запрет выдумывать бренды. Это не портрет Voyah Free,
   а «кроссовер в тумане» — см. вердикт, пункт про риск силуэта. */
float carSdf(vec2 q){
  float body  = sdRoundBox(q - vec2(0.0, -0.115), vec2(0.90, 0.145), 0.095);
  float cabin = sdRoundBox(q - vec2(-0.02, 0.10), vec2(0.46, 0.16), 0.085);
  /* Крышу делают два среза полуплоскостями: наклонное лобовое и пологая корма.
     Режем ТОЛЬКО кабину: на капот и корму срезы не должны распространяться. */
  float wind = (q.x - 0.40) * 0.55 + (q.y - 0.015) * 0.84;
  float rear = -(q.x + 0.50) * 0.40 + (q.y - 0.05) * 0.92;
  cabin = max(cabin, wind);
  cabin = max(cabin, rear);
  float hood  = sdSeg(q, vec2(0.46, 0.01), vec2(0.93, -0.10), 0.070);
  float tail  = sdSeg(q, vec2(-0.48, 0.03), vec2(-0.91, -0.11), 0.068);
  float s = smin(body, cabin, 0.06);
  s = smin(s, hood, 0.05);
  s = smin(s, tail, 0.05);
  s = max(s, -sdCircle(q - vec2( 0.56, -0.27), 0.235));   /* передняя арка */
  s = max(s, -sdCircle(q - vec2(-0.56, -0.27), 0.235));   /* задняя арка */
  return s;
}

/* Колесо: тёмная шина + чуть более светлый диск. Отдельной функцией, чтобы не писать цикл
   (в ESSL 1.00 границы цикла обязаны быть константами — проще развернуть). */
vec3 wheel(vec3 col, vec2 q, float wx, float fogC){
  float d = length(q - vec2(wx, -0.27));
  float tyre = 1.0 - smoothstep(0.166, 0.176, d);
  float rim  = 1.0 - smoothstep(0.068, 0.078, d);
  col = mix(col, uNight * 0.38, tyre * fogC);
  col = mix(col, uDeep * 1.10, rim * tyre * fogC * 0.5);
  return col;
}

void main(){
  vec2 res = uRes;
  float aspect = res.x / max(res.y, 1.0);
  vec2 p = (vUv - 0.5) * 2.0;
  p.x *= aspect;

  float t = uTime;
  /* Тон страницы = градиенту .page-head. К нему добавляется глубина, поэтому uFade
     плавит фон с выключенным состоянием без скачка яркости. */
  vec3 base = mix(uNight, uDeep, clamp(vUv.y, 0.0, 1.0));
  vec3 col = base;

  /* Горизонт: чуть выше центра, уходит вверх при скролле — это и есть параллакс глубины. */
  float hy = 0.10 + uPointer.y * 0.03 - uScroll * 0.22;

  /* ---------- воздух/стена над горизонтом (считаем всегда: дёшево, 1 шум) ---------- */
  float k = clamp((p.y - hy) / max(1.0 - hy, 0.001), 0.0, 1.0);
  col = mix(uDeep, uNight, pow(k, 0.75));
  float shaft = vnoise(vec2(p.x * 1.25 + t * 0.017, p.y * 0.55 - t * 0.031));
  col += uMist * 0.055 * shaft * (1.0 - k);
  /* вертикальные лучи от ламп: шум, вытянутый по вертикали */
  float ray = vnoise(vec2(p.x * 0.85 - t * 0.008, 1.5));
  col += uBrass * 0.045 * ray * (1.0 - k) * smoothstep(0.0, 0.6, p.y);
  float glow = exp(-length(vec2((p.x - 0.78) * 0.85, (p.y - 0.62) * 1.50)) * 1.35);
  col += uCopper * 0.34 * glow;

  /* ---------- пол: перспективная проекция к горизонту ---------- */
  if (p.y < hy) {
    float d = max(hy - p.y, 0.030);
    float z = 1.0 / d;                             /* ~1 у горизонта … ~33 у нижнего края */
    float fog = exp(-z * 0.055);
    vec2 fuv = vec2(p.x * z * 0.55 + uPointer.x * 0.60, z * 0.55 - t * 0.22);
    float n1 = vnoise(fuv * 1.60);
    float dust = n1;
    if (uQuality > 0.5) {
      dust = n1 * 0.62 + vnoise(fuv * 4.30 + 11.7) * 0.38;
    }
    col = mix(uNight, uDeep, 0.35 + dust * 0.85);
    if (uQuality > 1.5) {
      /* мокрые полосы вдоль направления движения — вытянутый шум по z */
      float wet = vnoise(vec2(fuv.x * 6.0, fuv.y * 0.55 - t * 0.50));
      col += uBrass * 0.14 * wet * fog;
    }
    /* лужа тёплого света от ламп бокса справа и холодный контр-свет слева:
       два источника дают объём, один — плоское пятно */
    float pool = exp(-length(vec2((p.x - 0.42) * 0.70, (p.y + 0.46) * 1.25)) * 1.05);
    col += uCopper * 0.70 * pool * (0.30 + 0.70 * fog);
    float cool = exp(-length(vec2((p.x + 0.72) * 0.80, (p.y + 0.30) * 1.60)) * 1.30);
    col += uMist * 0.075 * cool * (0.30 + 0.70 * fog);
    /* дальний план темнее и стремится к цвету стены: без этого у горизонта виден стык */
    col = mix(uDeep * 0.85, col, 0.45 + 0.55 * fog);
  }

  /* ---------- дымка у горизонта: заодно прячет стык пола и воздуха ---------- */
  col += uBrass * 0.22 * exp(-abs(p.y - hy) * 9.0);

  /* ---------- вариант B: силуэт в глубине ---------- */
  if (uMode > 0.5) {
    float depth = 0.58;                            /* 0 = вплотную, 1 = далеко */
    float sc = mix(0.80, 0.46, depth);
    vec2 cp = vec2(
      0.24 + uPointer.x * 0.10 * (1.0 - depth),
      hy - 0.155 - uScroll * 0.05 + uPointer.y * 0.035
    );
    vec2 q = (p - cp) / sc;
    /* атмосферная дымка: силуэт не «наклеен», а стоит в тумане и теряет контраст с глубиной */
    float fogC = exp(-depth * 1.15);

    /* контактная тень под машиной — до силуэта, чтобы легла на пол */
    /* Линия земли = низ колеса: -0.27 - 0.176 ≈ -0.44. Тень и отражение считаются от неё. */
    float gy = q.y + 0.44;
    float shd = exp(-(q.x * q.x * 0.75 + gy * gy * 20.0));
    col *= 1.0 - 0.62 * shd;

    float sd = carSdf(q);
    float inside = 1.0 - smoothstep(-0.004, 0.004, sd);
    /* Кузов темнее фона: это силуэт, а не «латунная машинка». Свет добавляет только кромка. */
    vec3 bodyCol = mix(uNight, uDeep, 0.30) * (0.30 + 0.32 * smoothstep(-0.40, 0.40, q.y));
    col = mix(col, mix(bodyCol, col, 0.35 * (1.0 - fogC)) * (0.55 + 0.45 * fogC), inside);

    /* колёса */
    col = wheel(col, q,  0.56, fogC);
    col = wheel(col, q, -0.56, fogC);

    /* контровой свет по кромке: сверху латунь, снизу медь. Нормаль не считаем —
       4 лишних вызова carSdf стоили бы ~120 операций на пиксель, а свет и так
       поставлен сверху-справа, поэтому хватает маски кромки и высоты. */
    float edge = 1.0 - smoothstep(0.0, 0.016, abs(sd));
    float up = smoothstep(-0.25, 0.30, q.y);
    col += mix(uCopper, uBrass, up) * edge * (0.30 + 0.62 * fogC) * (0.30 + 0.70 * up);

    /* фары и габариты: два мягких ореола, без источника света в кадре */
    float hl = exp(-length((q - vec2(0.90, -0.03)) * vec2(1.0, 2.6)) * 4.6);
    col += uBrass * 0.62 * hl;
    float tl = exp(-length((q - vec2(-0.92, -0.02)) * vec2(1.0, 2.8)) * 5.2);
    col += uDanger * 0.42 * tl;

    /* отражение в мокром асфальте — самый дорогой кусок B (второй проход carSdf),
       поэтому на low/mid его нет вовсе. */
    if (uQuality > 1.5) {
      float rg = -q.y - 0.88;                      /* зеркало относительно земли y = -0.44 */
      if (rg > -0.44) {
        vec2 rq = vec2(q.x + (vnoise(vec2(q.y * 3.1, t * 0.7)) - 0.5) * 0.09, rg);
        float rsd = carSdf(rq);
        float fade = exp(-max(-(q.y + 0.44), 0.0) * 3.4);
        float rIn = (1.0 - smoothstep(-0.006, 0.012, rsd)) * fade;
        col = mix(col, bodyCol * 0.42, rIn * 0.40);
        col += mix(uCopper, uBrass, 0.5) * (1.0 - smoothstep(0.0, 0.030, abs(rsd))) * rIn * 0.16;
      }
    }
  }

  /* ---------- виньетка, появление, дизеринг ---------- */
  float vig = smoothstep(1.75, 0.30, length(p * vec2(0.60, 0.95)));
  col *= 0.68 + 0.32 * vig;

  col = mix(base, col, uFade);

  /* Дизеринг обязателен: на 8-бит тёмный градиент даёт полосы уже на 300 px.
     Зерно неподвижно в кадре (hash от gl_FragCoord), поэтому не «кипит». */
  col += (hash21(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);

  gl_FragColor = vec4(col, 1.0);
}`;

/** Маркер для поиска чанка в `dist/` при замере веса (использует scripts/bg3d-measure.mjs). */
export const MARKER = 'carSdf';

/** Палитра по токенам src/styles/tokens.css. Держим здесь, чтобы не парсить CSS в рантайме. */
export const PALETTE: Record<string, [number, number, number]> = {
  night: [0x0b / 255, 0x14 / 255, 0x10 / 255],   /* #0B1410 */
  deep: [0x10 / 255, 0x20 / 255, 0x1a / 255],    /* #10201A */
  brass: [0xe0 / 255, 0xa9 / 255, 0x6d / 255],   /* #E0A96D */
  copper: [0xc8 / 255, 0x7f / 255, 0x45 / 255],  /* #C87F45 */
  mist: [0xb7 / 255, 0xc4 / 255, 0xbb / 255],    /* #B7C4BB */
  danger: [0xe8 / 255, 0x83 / 255, 0x6b / 255],  /* #E8836B */
};
