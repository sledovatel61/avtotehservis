/* Интро «вход в раздел Voyah Free» (круг 30).
   Настоящая 3D-заставка на сыром WebGL2: свой код, без three.js и вообще без
   библиотек. Геометрия — raymarching SDF в одном фрагментном шейдере, кадр
   собирается тремя проходами (сцена → яркий проход в ¼ разрешения → композит
   с bloom и тонмаппингом), текстов из файлов нет — всё процедурное.

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

import { CAR, carGlsl } from './car-profile';

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

float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
${carGlsl(CAR)}

/* дешёвое отсечение: всё, что дальше габаритного бокса, считается по боксу */
float map(vec3 p){
  float bx = carBoxDist(p);
  if (bx > 0.03) return bx;
  return sdCarProfile(p);
}

void camera(float t, out vec3 ro, out vec3 ta){
  float e = t * t * (3.0 - 2.0 * t);
  float yaw = mix(-0.40, 0.12, e);
  float rad = mix(6.35, 5.05, e);
  float pit = mix(0.13, 0.22, e);
  ta = vec3(0.0, 0.80, 0.0);
  ro = ta + vec3(sin(yaw) * cos(pit), sin(pit), cos(yaw) * cos(pit)) * rad;
}

void main(){
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  vec3 ro, ta;
  camera(uT, ro, ta);
  vec3 fw = normalize(ta - ro);
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 up = cross(fw, rt);
  vec3 rd = normalize(fw * 1.80 + rt * uv.x + up * uv.y);

  float sweep    = mix(3.10, -3.10, smoothstep(0.09, 0.63, uT));
  float dissolve = smoothstep(0.80, 1.0, uT);
  float flash    = exp(-pow((uT - 0.760) / 0.045, 2.0));
  float glowIn   = smoothstep(0.0, 0.15, uT);

  const vec3 NEON  = vec3(0.30, 0.85, 1.00);
  const vec3 WHITE = vec3(0.90, 0.98, 1.00);
  const vec3 BRASS = vec3(1.00, 0.74, 0.40);

  vec3 col = vec3(0.0);

  /* пол: неоновая сетка, уходящая в глубину */
  if (rd.y < -0.0001) {
    float tf = -ro.y / rd.y;
    if (tf > 0.0 && tf < 40.0) {
      vec3 fp = ro + rd * tf;
      float gx = abs(fract(fp.x * 0.8 + 0.5) - 0.5);
      float gz = abs(fract(fp.z * 0.8 + 0.5) - 0.5);
      float g = smoothstep(0.035, 0.0, gx) + smoothstep(0.035, 0.0, gz);
      float fade = exp(-length(fp.xz) * 0.20) * glowIn;
      col += NEON * g * 0.13 * fade;
      col += NEON * 0.035 * exp(-length(fp.xz) * 0.55) * glowIn;
    }
  }

  /* марш по SDF */
  float t = 0.0;
  float halo = 0.0;
  bool hit = false;
  for (int i = 0; i < 36; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    /* ореол без exp(): в программном растеризаторе трансцендентные дороже всего */
    halo += 1.0 / (1.0 + max(d, 0.0) * 22.0) * 0.014;
    if (d < 0.0024 + t * 0.0014) { hit = true; break; }
    t += max(d, 0.0015);
    if (t > 18.0) break;
  }

  col += NEON * halo * 0.30 * glowIn;

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = carNormal(p);
    float rv = smoothstep(sweep, sweep + 0.45, p.x);
    float head = exp(-abs(p.x - sweep) * 9.0);
    float dith = smoothstep(dissolve - 0.30, dissolve, hash13(floor(p * 5.0)));
    float fade = 1.0 - smoothstep(0.88, 1.0, uT);
    float side = smoothstep(0.45, 0.65, abs(p.z));

    /* ширина линии — постоянная по экрану */
    float secX = abs(fract(p.x / 0.22 + 0.5) - 0.5) * 0.22;
    float fw = fwidth(secX);
    float wpx = max(fw * 0.95, 0.0012);
    float secFade = 1.0 - smoothstep(0.015, 0.05, fw);
    float lines = smoothstep(wpx, 0.0, secX) * 0.9 * secFade;

    /* подоконный пояс (beltline) — линия от фары через ручки к фонарю */
    float belt = abs(p.y - 1.06);
    lines += smoothstep(max(fwidth(belt) * 0.9, 0.0012), 0.0, belt) * side * 1.15;

    /* стыки дверей: передняя кромка, средняя стойка, задняя дверь */
    float seamD = min(min(abs(p.x - 0.55), abs(p.x + 0.18)), abs(p.x + 1.15));
    float seam = smoothstep(max(fwidth(seamD) * 0.85, 0.0012), 0.0, seamD) * side * smoothstep(1.02, 0.94, p.y) * 0.75;
    lines += seam;

    /* остекление: контур между подоконной линией и крышей, в пределах кабины */
    float gIn = min(carTop(p.x) - 0.05 - p.y, p.y - 1.075);
    float gX = smoothstep(-1.92, -1.74, p.x) * smoothstep(0.62, 0.50, p.x);
    lines += smoothstep(max(fwidth(gIn) * 0.9, 0.0015), 0.0, abs(gIn)) * side * gX * 1.0;

    /* фары: узкие «прищуренные» полосы на крыле и фонарь во всю корму */
    float drl = smoothstep(0.016, 0.0, abs(p.y - 0.99)) * smoothstep(2.02, 2.14, p.x);
    drl += smoothstep(0.014, 0.0, abs(p.y - 0.95)) * smoothstep(-2.02, -2.14, p.x);
    drl *= smoothstep(0.55, 0.70, abs(p.z));

    /* диск колеса: два обода + 5 спиц (в неоне читается как колесо, не «бублик») */
    float wr = length(p.xy - vec2(sign(p.x) * 1.48, 0.369));
    float face = smoothstep(0.80, 0.90, abs(p.z));
    float rims = (smoothstep(0.012, 0.0, abs(wr - 0.252)) + smoothstep(0.010, 0.0, abs(wr - 0.338))) * face * step(wr, 0.352);
    float ang = atan(p.y - 0.369, abs(p.x) - 1.48);
    float spoke = abs(fract(ang / 1.25664 + 0.5) - 0.5) * 1.25664;
    rims += smoothstep(0.055, 0.0, spoke) * step(wr, 0.25) * step(0.04, wr) * face * 0.9;

    float rim = pow(1.0 - abs(dot(n, rd)), 3.0);
    float fres = 1.0 - abs(dot(n, rd));

    vec3 c = vec3(0.0);
    /* лёгкая «голограмма»: слабая заливка поверхности */
    c += vec3(0.010, 0.040, 0.055) * fres * rv;
    c += NEON * lines * (1.45 + head * 4.0) * rv;
    c += WHITE * head * 0.65 * rv;
    c += WHITE * drl * 2.6 * rv;
    c += NEON * rims * 1.3 * rv;
    c += NEON * rim * 0.62 * (0.26 + 0.74 * glowIn);
    c += BRASS * rim * 0.12 * smoothstep(0.35, 0.85, uT);
    c *= dith * fade;
    c += WHITE * flash * (0.22 + rim * 1.8);
    col += c;
  }

  /* световая «плоскость сканера», проходящая сквозь кузов */
  if (abs(rd.x) > 0.0001) {
    float ts = (sweep - ro.x) / rd.x;
    if (ts > 0.0 && uT > 0.06 && uT < 0.72) {
      vec3 ps = ro + rd * ts;
      float r2 = length(ps.yz - vec2(1.05, 0.0));
      col += NEON * 0.085 * exp(-r2 * 1.4) * glowIn;
    }
  }

  col += NEON * flash * 0.07;
  /* лёгкий дизеринг: убирает полосы на градиентах неона */
  col += (hash13(vec3(gl_FragCoord.xy, uT)) - 0.5) / 255.0;
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
    const uBrightTex = gl.getUniformLocation(progBright, 'uTex');
    const uBrightTexel = gl.getUniformLocation(progBright, 'uTexel');
    const uBrightRes = gl.getUniformLocation(progBright, 'uRes');
    const uCompScene = gl.getUniformLocation(progComp, 'uScene');
    const uCompBloom = gl.getUniformLocation(progComp, 'uBloom');
    const uCompRes = gl.getUniformLocation(progComp, 'uRes');

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
    let scale = quick ? 0.46 : 0.52;

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
      draw(t);
      box.classList.remove('is-wait');
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
      if (frames === 4 || frames === 12 || frames === 30) {
        const avg = acc / (frames === 4 ? 3 : frames === 12 ? 8 : 18);
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
