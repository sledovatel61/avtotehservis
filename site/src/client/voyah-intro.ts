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

const VERT = `#version 300 es
void main(){
  /* полноэкранный треугольник без буферов и атрибутов: 3 вершины по gl_VertexID */
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 uRes;
uniform float uT;
uniform sampler2D uMark;
uniform float uMarkOn;

/* Сцена — фронтальный кадр в hero-единицах 1920×1080 (docs/brand/voyah/refs/r31/FRONT.md).
   Никакого объёма: слои фона, кузов как силуэт, полоса ДХО, знак, отражение в полу. */

const float BW   = 1150.0;   /* ширина кузова на кадре (FRONT.md §2.4) */
const float BX   = 960.0;    /* его ось */
const float BY0  = 95.0;     /* верх крыши */
const float BH   = 715.0;    /* высота до низа бампера */
const float BOT  = 810.0;    /* низ бампера */
const float FLOOR = 730.0;   /* линия пола 0,676 H */
const vec3  BODY  = vec3(0.004, 0.004, 0.004);
const vec3  WARM  = vec3(1.00, 0.26, 0.10);
const vec3  WHITE = vec3(1.00, 0.98, 0.96);

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float sdBox(vec2 p, vec2 b, float r){
  vec2 d = abs(p) - b + r;
  return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r;
}

/* Полуширина кузова от t (доля высоты от крыши вниз): таблица FRONT.md §2.1–2.2,
   пересчитанная в пиксели кадра. Крыша узкая (0,196 W), плечи расходятся к t ≈ 0,65,
   низ бампера подбирается внутрь — это и есть «широкий, но не квадратный» фронт. */
float halfW(float t){
  /* полуширина по строкам кадра: снято с hero-front-red.png (run-маска кузова) */
  float w = 330.0;
  w += 3.0 * clamp((t - 0.000) / 0.035, 0.0, 1.0);
  w += 28.0 * clamp((t - 0.035) / 0.056, 0.0, 1.0);
  w += 22.0 * clamp((t - 0.091) / 0.056, 0.0, 1.0);
  w += 19.0 * clamp((t - 0.147) / 0.056, 0.0, 1.0);
  w += 19.0 * clamp((t - 0.203) / 0.056, 0.0, 1.0);
  w += 9.0 * clamp((t - 0.259) / 0.056, 0.0, 1.0);
  w += 101.0 * clamp((t - 0.315) / 0.112, 0.0, 1.0);
  w += 29.0 * clamp((t - 0.427) / 0.111, 0.0, 1.0);
  w += 13.0 * clamp((t - 0.538) / 0.112, 0.0, 1.0);
  w += 5.0 * clamp((t - 0.650) / 0.112, 0.0, 1.0);
  w += 2.0 * clamp((t - 0.762) / 0.238, 0.0, 1.0);
  return w;
}

/* Силуэт кузова: > 0 внутри. Крыша и низ — горизонтальные кромки, бока — по halfW,
   углы скруглены smin-ом, зеркала — отдельные «лопасти» выше линии капота (§2.3). */
float bodySd(vec2 p){
  float t = clamp((p.y - BY0) / BH, 0.0, 1.0);
  float dSide = halfW(t) - abs(p.x - BX);
  float dEdge = min(p.y - BY0, BOT - p.y);
  float d = smin(dSide, dEdge, 26.0);
  /* знак sdBox — «минус внутри», у d — «плюс внутри»: объединение через max(d, −mir) */
  float mir = sdBox(vec2(abs(p.x - BX) - 466.0, p.y - 232.0), vec2(74.0, 50.0), 46.0);
  return max(d, -mir);
}

/* Слои кузова и света. Те же функции зовёт отражение в полу, поэтому они вынесены. */
void layers(vec2 p, float t, out float body, out vec3 light){
  body = 0.0;
  light = vec3(0.0);

  float d = bodySd(p);
  float inside = smoothstep(-1.6, 1.6, d);

  /* кузов наливается почти чёрным снизу вверх (uT 0,46–0,70) */
  float fillY = mix(840.0, 40.0, smoothstep(0.46, 0.70, t));
  body = inside * smoothstep(fillY - 26.0, fillY + 26.0, p.y);
  /* низ уходит в тень пола, а не обрывается линией */
  body *= smoothstep(BOT + 30.0, BOT - 55.0, p.y);

  /* контровой свет: обводит кромку от макушки крыши вниз по стойкам и плечам */
  float rimProg = smoothstep(0.42, 0.68, t);
  float trace = length(vec2((p.x - BX) * 0.90, (p.y - BY0) * 1.02)) / 700.0;
  float shown = smoothstep(trace, trace + 0.10, rimProg);
  float ad = abs(d);
  light += WARM * exp(-ad * 0.16) * shown * 0.26;
  light += vec3(1.00, 0.56, 0.38) * smoothstep(2.0, 0.0, ad) * shown * 0.80;

  /* тёплый отблеск на капоте над полосой */
  light += WARM * exp(-abs(p.y - 422.0) / 30.0) * inside * smoothstep(0.40, 0.60, t) * 0.14;

  /* полоса ДХО: две половины, разрыв по центру, подъём ≈3,5° к краю (§3) */
  float reveal = smoothstep(0.12, 0.44, t);
  float mx = abs(p.x - BX);
  float sy = 450.0 - (mx - 51.0) * 0.0625;   /* разрыв по центру ≈102 px, как на эталоне */
  float along = (mx - 51.0) / 491.0;
  float on = step(0.0, along) * step(along, 1.0);
  float cut = smoothstep(along - 0.015, along + 0.015, reveal);
  light += WHITE * smoothstep(3.7, 1.9, abs(p.y - sy)) * on * cut * 1.75;

  /* «искра» на кончике прорисовки */
  float spark = exp(-length(vec2((along - reveal) * 512.0, p.y - sy)) * 0.16)
              * step(0.02, reveal) * (1.0 - smoothstep(0.90, 1.0, reveal));
  light += WHITE * spark * 3.2;

  /* «бровь» над внешним концом (uT 0,22–0,34) */
  float browIn = smoothstep(0.22, 0.34, t);
  float browX = smoothstep(392.0, 408.0, mx) * (1.0 - smoothstep(534.0, 548.0, mx));
  float browY = 412.0 - (mx - 30.0) * 0.02;
  light += WHITE * smoothstep(2.6, 1.2, abs(p.y - browY)) * browX * browIn * 0.8;

  /* знак: контур → заливка, одна вспышка ореола. Форма — текстура принятого SVG (§4) */
  vec2 ec = vec2(BX, 497.0);
  vec2 eh = vec2(30.4, 42.7);               /* 85 px по высоте, пропорция 0,712 */
  vec2 euv = vec2((p.x - ec.x) / (eh.x * 2.0) + 0.5, 0.5 - (p.y - ec.y) / (eh.y * 2.0));
  float inBox = step(0.0, euv.x) * step(euv.x, 1.0) * step(0.0, euv.y) * step(euv.y, 1.0);
  float a = texture(uMark, clamp(euv, 0.0, 1.0)).a * inBox * uMarkOn;
  light += WHITE * clamp(a * (1.0 - a) * 4.0, 0.0, 1.0) * smoothstep(0.34, 0.42, t) * 1.4;
  light += vec3(0.88, 0.96, 1.00) * a * smoothstep(0.42, 0.50, t) * 1.55;
  light += vec3(0.55, 0.75, 1.00) * exp(-length(p - ec) * 0.10)
         * exp(-pow((t - 0.44) / 0.04, 2.0)) * 1.1;
}

/* Фон: тёплый градиент с виньеткой (§5), пол чуть светлее, к концу — ночь #070B12 */
vec3 bgAt(vec2 p, float t){
  vec2 q = vec2((p.x - BX) / 1400.0, (p.y - 120.0) / 700.0);
  float r = clamp(length(q), 0.0, 1.35);
  vec3 c = mix(vec3(0.455, 0.059, 0.012), vec3(0.141, 0.020, 0.012), smoothstep(0.0, 1.15, r));
  c *= mix(1.0, 0.70, smoothstep(-200.0, 700.0, p.x - BX));      /* правый край темнее */
  c *= 1.0 + 0.22 * smoothstep(FLOOR - 60.0, FLOOR + 140.0, p.y);
  c *= smoothstep(0.0, 0.18, t);
  return c;
}

void main(){
  /* gl_FragCoord.y растёт вверх, а hero-y — вниз от крыши: переворачиваем */
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float aspect = uRes.x / uRes.y;
  vec2 p;
  if (aspect >= 0.85) {
    /* ландшафт: «cover», середина полосы (960, 448) → (vw/2, 0,415 vh) */
    float s = max(uRes.x / 1920.0, uRes.y / 1080.0);
    p = (frag - vec2(uRes.x * 0.5, uRes.y * 0.415)) / s + vec2(BX, 448.0);
  } else {
    /* портрет: кузов 1,55 ширины экрана, крыша на 0,30 vh (§6) */
    float k = 1.55 * uRes.x / BW;
    p = (frag - vec2(uRes.x * 0.5, uRes.y * 0.30)) / k + vec2(BX, BY0);
  }
  float t = clamp(uT, 0.0, 1.0);

  float body;
  vec3 light;
  layers(p, t, body, light);

  float nightK = smoothstep(0.72, 1.0, t);
  vec3 col = mix(bgAt(p, t), vec3(0.0322, 0.0504, 0.0826), nightK);   /* = #070B12 после финального композита */
  col = mix(col, BODY, clamp(body, 0.0, 1.0));

  /* отражение в полу: зеркальная копия силуэта, размытая по вертикали (§7) */
  float reflIn = smoothstep(0.60, 0.82, t);
  if (p.y > FLOOR && reflIn > 0.002) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 3; i++) {
      float o = float(i - 1) * 10.0;
      vec2 pm = vec2(p.x + o * 0.25, 2.0 * FLOOR - p.y - o);
      float b2;
      vec3 l2;
      layers(pm, t, b2, l2);
      float w = 1.0 - 0.30 * abs(float(i - 1));
      acc += (l2 + vec3(0.02) * b2) * w;
      wsum += w;
    }
    float depth = clamp((p.y - FLOOR) / 280.0, 0.0, 1.0);
    col += acc / wsum * 0.40 * reflIn * (1.0 - depth * 0.8);
  }

  col += light;
  col *= mix(1.0, 0.62, nightK);
  /* лёгкий дизеринг: убирает полосы на красном градиенте */
  col += (hash12(frag + t * 91.0) - 0.5) / 255.0;
  O = vec4(max(col, 0.0), 1.0);
}`;

/* bloom: яркий проход по горизонтали в четверть разрешения */
const BRIGHT_FS = `#version 300 es
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
const COMP_FS = `#version 300 es
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

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData =
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
const params = new URLSearchParams(location.search);

if (!reduced && !saveData && params.get('intro') !== '0') boot();

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

  box.addEventListener('click', onSkip);
  window.addEventListener('keydown', onKey);
  window.addEventListener('wheel', onSkip, { passive: true });
  window.addEventListener('touchmove', onSkip, { passive: true });
  window.addEventListener('resize', onResize);
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
    const whenMark = (cb: () => void): void => { if (markDone) cb(); else markWaiters.push(cb); };
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
        mark.ready = true;
      } catch {
        /* знак не поднялся — сцена идёт без него, кадр не ломается */
      }
      markSettle();
    };
    markImg.addEventListener('error', markSettle, { once: true });
    markImg.src = '/img/vy-mark-light.svg';

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
    let scale = quick ? 0.55 : 0.62;

    const alloc = (): boolean => {
      const cssW = box.clientWidth || innerWidth;
      const cssH = box.clientHeight || innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
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
      whenMark(() => {
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
          scale = Math.max(0.4, scale - 0.1);
          acc = 0;
          tuned++;
          alloc();
        } else if (avg < 13 && tuned === 0 && scale < (quick ? 0.7 : 0.8)) {
          scale = Math.min(quick ? 0.7 : 0.8, scale + 0.08);
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
