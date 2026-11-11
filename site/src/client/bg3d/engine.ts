/**
 * Движок 3D-фона: WebGL-контекст, цикл кадра, пауза вне экрана, watchdog и полная уборка.
 *
 * Что здесь важно и почему (всё это пункты задания №44):
 *
 *  1. **Пауза вне экрана.** Два независимых источника: IntersectionObserver на хосте
 *     (фон уехал за край — кадры не рисуем) и `visibilitychange` (вкладка спрятана).
 *     rAF при этом не «висит» в ожидании: цикл останавливается совсем, `cancelAnimationFrame`
 *     вызывается явно. Время `uTime` накапливается только пока рисуем — после возврата
 *     фон продолжает движение с той же фазы, без скачка.
 *
 *  2. **Автоотключение на слабых устройствах.** Статическая часть — в gate.ts (до первого
 *     кадра). Динамическая — watchdog здесь: если за окно 1 с рисуем меньше 70 % целевой
 *     частоты, снижаем внутреннее разрешение (1.0 → 0.75 → 0.6 → 0.5), а если и на 0.5
 *     не хватает — гасим фон и запоминаем на сессию. Пользователь видит это как
 *     «фон сам выключился», а не как тормозящую страницу.
 *
 *  3. **Уборка.** `destroy()` удаляет шейдеры, программу, буфер, VAO, снимает все
 *     слушатели, разрывает observer'ы и в конце дёргает `WEBGL_lose_context.loseContext()`.
 *     Без последнего браузер держит память контекста до сборки мусора, и 20 переходов
 *     по страницам превращаются в 20 живых контекстов (в Chrome лимит ~16, дальше
 *     начинает убивать старые — вместе с чужими канвасами). Это ровно то место, где
 *     утечка и появляется, поэтому оно проверено тестом на 20 циклов.
 *
 *  4. **Стоимость кадра.** Один draw call, один треугольник на экран, 0 текстур,
 *     0 фреймбуферов, 0 post-process. Всё, что может быть лишним, выключено в
 *     атрибутах контекста: depth/stencil не нужны (рисуем один квад), antialias не нужен
 *     (фон мягкий, а MSAA ×4 — это ×4 памяти на кадр), `powerPreference: 'low-power'`
 *     держит ноутбук на встроенном GPU вместо дискретного — на батарее это заметно.
 */
import { fitScale } from './gate.ts';
import { FRAG, PALETTE, VERT } from './shader.ts';
import { PLATE_SRC, PLATE_SRCSET } from './plate-asset.ts';

export type Variant = 'depth' | 'silhouette';

export interface Bg3dStats {
  variant: Variant;
  tier: string;
  quality: number;
  fpsCap: number;
  /** CSS-размер хоста */
  cssWidth: number;
  cssHeight: number;
  /** физический размер канваса, которым рисуем */
  drawWidth: number;
  drawHeight: number;
  renderScale: number;
  /** масштаб, который подобрал пиксельный бюджет (1 = бюджет не связал) */
  budgetScale: number;
  dpr: number;
  /** сколько кадров нарисовано */
  frames: number;
  /** сколько кадров пропущено ограничителем частоты */
  skipped: number;
  /** сколько раз вставали на паузу (вне экрана / скрытая вкладка) */
  pauses: number;
  running: boolean;
  /** средняя и 95-я процентиль промежутка между кадрами, мс */
  frameMsAvg: number;
  frameMsP95: number;
  /** фактическая частота за последнее окно 1 с */
  fps: number;
  /** реальное время GPU на кадр, мс — только если есть EXT_disjoint_timer_query(_webgl2) */
  gpuMs: number | null;
  /** сколько миллисекунд фон суммарно рисовал (для расчёта энергии) */
  drawMs: number;
  /** сколько миллисекунд прожил экземпляр */
  uptimeMs: number;
  /** сколько раз watchdog снижал разрешение */
  degradations: number;
  renderer: string;
  vendor: string;
  glVersion: string;
  contextLost: number;
  destroyed: boolean;
  /** служебная пометка (причина паузы) — для лаборатории и отчёта */
  note?: string;
}

export interface Bg3dConfig {
  host: HTMLElement;
  variant?: Variant;
  tier?: string;
  quality?: 0 | 1 | 2;
  fpsCap?: number;
  renderScale?: number;
  dprCap?: number;
  motion?: 'animate' | 'static';
  /** множитель внутреннего разрешения для стресс-теста: >1 искусственно нагружает GPU,
   *  чтобы на сильной машине измерить пиксельную стоимость (см. отчёт, §метод) */
  stress?: number;
  /** измеренная стоимость кадра, скалярных оп/px (gate.OPS_PER_PX) */
  opsPerPx?: number;
  /** потолок скорости операций для тира, оп/с (gate.OPS_BUDGET) */
  opsBudget?: number;
  onAutoOff?: (reason: string) => void;
  onStats?: (s: Bg3dStats) => void;
  /** вызывается в конце destroy(): по нему вызывающая сторона убирает экземпляр из реестра */
  onDestroyed?: () => void;
  /** не создавать канвас самому, а взять существующий (страница отдаёт его из разметки) */
  canvas?: HTMLCanvasElement;
  /** не гасить сцену по низкому fps. Только демо-показ без GPU (серверный BG3D_DEMO=1):
   *  на SwiftShader watchdog сработает всегда, и владелец не увидит ровно ничего. */
  noWatchdog?: boolean;
}

const GL_ATTRS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  desynchronized: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'low-power',
  failIfMajorPerformanceCaveat: false,
};

/** Кольцо последних промежутков между кадрами для p95 без сортировки всего лога. */
class Ring {
  private buf: number[];
  private n = 0;
  constructor(size = 240) { this.buf = new Array<number>(size).fill(0); }
  push(v: number): void { this.buf[this.n % this.buf.length] = v; this.n++; }
  count(): number { return Math.min(this.n, this.buf.length); }
  avg(): number {
    const c = this.count();
    if (!c) return 0;
    let s = 0;
    for (let i = 0; i < c; i++) s += this.buf[i];
    return s / c;
  }
  p(q: number): number {
    const c = this.count();
    if (!c) return 0;
    const a = this.buf.slice(0, c).sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(q * a.length))];
  }
  reset(): void { this.n = 0; this.buf.fill(0); }
}

export class Bg3d {
  private cfg: Required<Pick<Bg3dConfig, 'variant' | 'quality' | 'fpsCap' | 'renderScale' | 'dprCap' | 'motion' | 'stress'>> & Bg3dConfig;
  private canvas: HTMLCanvasElement;
  private ownCanvas = false;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private vbo: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private running = false;
  private destroyed = false;
  private t0 = 0;
  private simTime = 0;
  private lastDraw = 0;
  private frames = 0;
  private skipped = 0;
  private pauses = 0;
  private degradations = 0;
  private contextLost = 0;
  private drawMs = 0;
  private ring = new Ring();
  private fpsWindowStart = 0;
  private fpsWindowFrames = 0;
  private fps = 0;
  private gpuMs: number | null = null;
  private timerQuery: unknown = null;
  private timerExt: { QUERY_RESULT_AVAILABLE_EXT: number; QUERY_RESULT_EXT: number; TIME_ELAPSED_EXT: number } | null = null;
  private fade = 0;
  private fadeDir = 1;
  private pointer = { x: 0, y: 0 };
  private pointerTarget = { x: 0, y: 0 };
  private scroll = 0;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private visible = true;
  private inView = true;
  private lastFrameAt: number | null = null;
  /** [цель, событие, обработчик, capture] — capture храним отдельно: снять слушателя
   *  нужно тем же флагом, а остальные опции (passive) при снятии не важны */
  private listeners: Array<[EventTarget, string, EventListenerOrEventListenerObject, boolean]> = [];
  private renderer = '';
  private vendor = '';
  private glVersion = '';
  private resizeQueued = false;
  private budgetScale = 1;
  private plateTex: WebGLTexture | null = null;
  private isWebGL2 = false;

  constructor(cfg: Bg3dConfig) {
    this.cfg = {
      variant: 'depth', quality: 2, fpsCap: 60, renderScale: 1, dprCap: 2, motion: 'animate', stress: 1,
      ...cfg,
    } as Bg3d['cfg'];
    this.canvas = cfg.canvas ?? document.createElement('canvas');
    if (!cfg.canvas) {
      this.ownCanvas = true;
      this.canvas.className = 'bg3d-canvas';
      this.canvas.setAttribute('aria-hidden', 'true');
      cfg.host.appendChild(this.canvas);
    }
  }

  /** false — если контекст не получен: страница остаётся с обычным CSS-градиентом. */
  init(): boolean {
    if (this.destroyed) return false;
    const gl = (this.canvas.getContext('webgl2', GL_ATTRS) ?? this.canvas.getContext('webgl', GL_ATTRS)
      ?? this.canvas.getContext('experimental-webgl', GL_ATTRS)) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) return false;
    this.gl = gl;
    this.isWebGL2 = typeof (gl as WebGL2RenderingContext).createVertexArray === 'function';

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    this.vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : '';
    this.glVersion = String(gl.getParameter(gl.VERSION));

    const vs = this.compile(gl.VERTEX_SHADER, VERT);
    const fs = this.compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const prog = gl.createProgram();
    if (!prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    /* шейдеры программе больше не нужны: удаляем сразу, это минус два объекта в памяти драйвера */
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    this.prog = prog;
    gl.useProgram(prog);

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    /* один треугольник вместо двух: меньше вершин и нет диагонали, на которой
       интерполяция varying даёт шов */
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const vao = (gl as WebGL2RenderingContext).createVertexArray?.();
    if (vao) {
      this.vao = vao;
      (gl as WebGL2RenderingContext).bindVertexArray(vao);
    }
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    if (vao) (gl as WebGL2RenderingContext).bindVertexArray(null);

    for (const n of ['uRes', 'uTime', 'uScroll', 'uPointer', 'uMode', 'uQuality', 'uFade', 'uNight', 'uDeep', 'uBrass', 'uCopper', 'uMist', 'uDanger', 'uPlate', 'uHasPlate']) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }
    gl.uniform1f(this.u.uMode, this.cfg.variant === 'silhouette' ? 1 : 0);
    gl.uniform1f(this.u.uQuality, this.cfg.quality);
    gl.uniform3fv(this.u.uNight, PALETTE.night);
    gl.uniform3fv(this.u.uDeep, PALETTE.deep);
    gl.uniform3fv(this.u.uBrass, PALETTE.brass);
    gl.uniform3fv(this.u.uCopper, PALETTE.copper);
    gl.uniform3fv(this.u.uMist, PALETTE.mist);
    gl.uniform3fv(this.u.uDanger, PALETTE.danger);
    gl.uniform1i(this.u.uPlate, 0);
    gl.uniform1f(this.u.uHasPlate, 0);
    /* Пластина грузится асинхронно: до её прихода кадр рисуется без машины (uHasPlate 0),
       а не с процедурным суррогатом. Так в кадре никогда не бывает «двух машин», а
       страница не ждёт картинку перед первым кадром. */
    void this.loadPlate();

    /* Замер реального времени GPU: расширение есть в Chrome (desktop и Android).
       Без него gpuMs остаётся null, и в отчёте честно пишется «не измерялось». */
    const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2') ?? gl.getExtension('EXT_disjoint_timer_query');
    if (tq && typeof (tq as { createTimeQueryEXT?: () => unknown }).createTimeQueryEXT === 'function') {
      this.timerExt = tq as unknown as { QUERY_RESULT_AVAILABLE_EXT: number; QUERY_RESULT_EXT: number; TIME_ELAPSED_EXT: number };
      this.timerQuery = (tq as { createTimeQueryEXT: () => unknown }).createTimeQueryEXT();
    }

    this.bind();
    this.resize();
    this.t0 = performance.now();
    this.fpsWindowStart = this.t0;
    return true;
  }

  /** Текстура пластины: 0 — ещё не загружена, 1 — загружена. */
  private plateReady = 0;
  private plateLoading = false;

  /**
   * Загрузка фото-пластины машины (круг 35, задание №62).
   *
   * Почему так, а не `new Image()` + `texImage2D` сразу. Пластина — обычный webp с
   * альфой; его надо декодировать и залить в текстуру. Мипмапы строит GPU
   * (`generateMipmap`), поэтому в браузере нет ни второй копии картинки, ни ручной
   * пирамиды: на уменьшении кадра выборка идёт из мипмапа и кромка не «звенит».
   * Разрешение текстуры берём ближайшее к 1600 (или 800 на узком экране): аспект
   * пластины не меняется, файлы отличаются только шириной.
   *
   * Пока картинка не пришла, кадр рисуется без машины: лучше пустая сцена, чем
   * процедурный суррогат рядом с фотопластиной.
   */
  private async loadPlate(): Promise<void> {
    const gl = this.gl;
    if (!gl || this.plateLoading || this.plateReady) return;
    /* В jsdom и в среде без DOM картинок нет вовсе: тогда пластина просто не грузится,
       а кадр рисуется без машины (uHasPlate 0). Без этой проверки замер жизненного
       цикла падал на `new Image()` вместо того, чтобы мерить уборку. */
    if (typeof Image === 'undefined') return;
    this.plateLoading = true;
    const img = new Image();
    img.decoding = 'async';
    img.src = window.innerWidth <= 640 ? PLATE_SRCSET[0] : PLATE_SRC;
    try {
      if (typeof img.decode === 'function') await img.decode();
      else await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('plate')); });
    } catch { this.plateLoading = false; return; }
    if (this.destroyed || !this.gl) { this.plateLoading = false; return; }
    const tex = gl.createTexture();
    if (!tex) { this.plateLoading = false; return; }
    this.plateTex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    /* UNPACK_FLIP_Y: vUv растёт снизу вверх, а картинка — сверху вниз */
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    /* NPOT: в WebGL1 мипмапы для не-степени-двух запрещены, поэтому REPEAT/мипмап
       включаем только там, где это законно (WebGL2 или POT-размер). */
    const pot = (v: number) => (v & (v - 1)) === 0;
    const canMip = this.isWebGL2 || (pot(img.naturalWidth) && pot(img.naturalHeight));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (canMip) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.drawFrame();
    this.plateLoading = false;
    this.plateReady = 1;
  }

  private compile(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
    return sh;
  }

  /* ---------- слушатели и наблюдатели ---------- */

  private on(t: EventTarget, ev: string, fn: EventListenerOrEventListenerObject, opt?: boolean | AddEventListenerOptions): void {
    t.addEventListener(ev, fn, opt);
    const capture = typeof opt === 'object' && opt !== null ? !!opt.capture : !!opt;
    this.listeners.push([t, ev, fn, capture]);
  }

  private bind(): void {
    /* Пауза вне экрана: threshold 0 — достаточно одного пикселя видимости. */
    if (typeof IntersectionObserver === 'function') {
      this.io = new IntersectionObserver((es) => {
        const was = this.inView;
        this.inView = es.some((e) => e.isIntersecting);
        if (was && !this.inView) this.suspend('вне экрана');
        else if (!was && this.inView) this.wake('вернулся в экран');
      }, { threshold: 0 });
      this.io.observe(this.cfg.host);
    }
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => {
        if (this.resizeQueued) return;
        this.resizeQueued = true;
        requestAnimationFrame(() => { this.resizeQueued = false; this.resize(); if (!this.running) this.drawFrame(); });
      });
      this.ro.observe(this.cfg.host);
    }
    this.on(document, 'visibilitychange', () => {
      this.visible = !document.hidden;
      if (!this.visible) this.suspend('вкладка скрыта');
      else this.wake('вкладка видима');
    });
    this.on(window, 'scroll', () => { this.readScroll(); }, { passive: true });
    this.on(window, 'pointermove', (e) => {
      const pe = e as PointerEvent;
      const r = this.cfg.host.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.pointerTarget.x = ((pe.clientX - r.left) / r.width) * 2 - 1;
      this.pointerTarget.y = 1 - (((pe.clientY - r.top) / r.height) * 2 - 1);
    }, { passive: true });
    this.on(this.canvas, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost++;
      this.suspend('потерян контекст WebGL');
    });
    this.on(this.canvas, 'webglcontextrestored', () => {
      /* Пересборка программы: состояние uniform'ов после восстановления теряется. */
      this.prog = null; this.vbo = null; this.vao = null; this.u = {};
      if (this.init()) this.wake('контекст восстановлен');
    });
    this.readScroll();
  }

  private readScroll(): void {
    const r = this.cfg.host.getBoundingClientRect();
    if (!r.height) return;
    /* 0 — хост целиком в экране, 1 — уехал вверх на свою высоту */
    this.scroll = Math.min(1, Math.max(0, -r.top / r.height));
  }

  /* ---------- пауза / пробуждение ---------- */

  private suspend(why: string): void {
    if (!this.running) return;
    this.running = false;
    this.pauses++;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.cfg.onStats?.(this.stats(why));
  }

  private wake(_why: string): void {
    if (this.destroyed || this.running || !this.inView || !this.visible) return;
    if (this.cfg.motion === 'static') { this.drawFrame(); return; }
    this.running = true;
    this.lastDraw = performance.now();
    this.lastFrameAt = null;
    this.fpsWindowStart = this.lastDraw;
    this.fpsWindowFrames = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  start(): void {
    if (this.destroyed || !this.gl) return;
    this.fadeDir = 1;
    if (this.cfg.motion === 'static') {
      /* reduced-motion: ровно один кадр и тишина. Никакого rAF, никакого uTime. */
      this.fade = 1;
      this.drawFrame();
      return;
    }
    this.wake('старт');
  }

  /** Плавное выключение: гасим fade, потом освобождаем контекст. */
  fadeOutThenDestroy(): void {
    if (this.destroyed) return;
    this.fadeDir = -1;
    if (!this.running) { this.running = true; this.lastDraw = performance.now(); this.raf = requestAnimationFrame(this.tick); }
  }

  private tick = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const cap = this.cfg.fpsCap > 0 ? this.cfg.fpsCap : 60;
    const minInterval = 1000 / cap - 1.5; /* 1,5 мс допуска: rAF не приходит точно в срок */
    if (now - this.lastDraw < minInterval) {
      this.skipped++;
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const dt = Math.min(0.1, (now - this.lastDraw) / 1000);
    this.lastDraw = now;
    /* промежуток между НАРИСОВАННЫМИ кадрами; после паузы первый отсчёт не берём —
       иначе в статистику попадает вся длительность простоя */
    if (this.frames > 0 && this.lastFrameAt !== null) this.ring.push(Math.min(500, now - this.lastFrameAt));
    this.lastFrameAt = now;
    this.drawMs += dt * 1000;
    this.frames++;
    this.fpsWindowFrames++;

    /* появление/уход */
    const fadeStep = dt / (this.fadeDir > 0 ? 0.6 : 0.3);
    this.fade = Math.min(1, Math.max(0, this.fade + fadeStep * this.fadeDir));

    /* сглаживание указателя: 8 % за кадр — движение фона не «дёргается» за мышью */
    this.pointer.x += (this.pointerTarget.x - this.pointer.x) * 0.08;
    this.pointer.y += (this.pointerTarget.y - this.pointer.y) * 0.08;
    this.simTime += dt;

    this.beginTimer();
    this.drawFrame();
    this.endTimer();

    if (now - this.fpsWindowStart >= 1000) {
      this.fps = (this.fpsWindowFrames * 1000) / (now - this.fpsWindowStart);
      this.fpsWindowStart = now;
      this.fpsWindowFrames = 0;
      this.watchdog(now);
      this.cfg.onStats?.(this.stats());
    }

    if (this.fadeDir < 0 && this.fade <= 0) { this.destroy(); return; }
    this.raf = requestAnimationFrame(this.tick);
  };

  /* ---------- watchdog: снижение разрешения, потом автоотключение ---------- */

  private watchdog(now: number): void {
    if (this.cfg.noWatchdog) return;
    if (this.cfg.motion === 'static') return;
    if (now - this.t0 < 1500) return;                       /* прогрев: первые кадры дорогие */
    const target = this.cfg.fpsCap > 0 ? this.cfg.fpsCap : 60;
    if (this.fps >= target * 0.7) return;                  /* всё хорошо */
    const next = this.cfg.renderScale * 0.75;
    if (next >= 0.5) {
      this.cfg.renderScale = Math.max(0.5, next);
      this.degradations++;
      this.ring.reset();
      this.resize();
      return;
    }
    this.running = false;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.cfg.onAutoOff?.(`watchdog: ${this.fps.toFixed(1)} к/с при цели ${target} даже на 50 % разрешения`);
    this.destroy();
  }

  /* ---------- размер ---------- */

  resize(): void {
    const gl = this.gl;
    if (!gl || this.destroyed) return;
    const r = this.cfg.host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, this.cfg.dprCap);
    const cssW = Math.max(1, Math.round(r.width || this.cfg.host.clientWidth || 1));
    const cssH = Math.max(1, Math.round(r.height || this.cfg.host.clientHeight || 1));
    /* Пиксельный бюджет: сколько пикселей тянет выбранный GPU-класс при нашей
       измеренной стоимости кадра. Движок знает реальные размеры канваса, gate — нет,
       поэтому бюджет применяется здесь, на каждом resize. */
    const budget = this.cfg.opsBudget ?? 0;
    const ops = this.cfg.opsPerPx ?? 0;
    const cap = this.cfg.fpsCap > 0 ? this.cfg.fpsCap : 60;
    this.budgetScale = budget > 0 && ops > 0
      ? fitScale({ cssWidth: cssW, cssHeight: cssH, dpr, fpsCap: cap, opsPerPx: ops, budget, min: 0.5, max: this.cfg.renderScale })
      : this.cfg.renderScale;
    const scale = Math.min(this.cfg.renderScale, this.budgetScale) * this.cfg.stress;
    const w = Math.max(1, Math.round(cssW * dpr * scale));
    const h = Math.max(1, Math.round(cssH * dpr * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(this.u.uRes, w, h);
    }
  }

  /* ---------- кадр ---------- */

  private beginTimer(): void {
    const gl = this.gl as WebGL2RenderingContext | null;
    const ext = this.timerExt;
    if (!gl || !ext || !this.timerQuery) return;
    try {
      const anyGl = gl as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (typeof anyGl.beginQuery === 'function') anyGl.beginQuery(ext.TIME_ELAPSED_EXT, this.timerQuery);
      else if (typeof anyGl.beginQueryEXT === 'function') anyGl.beginQueryEXT(ext.TIME_ELAPSED_EXT, this.timerQuery);
    } catch { this.timerExt = null; }
  }

  private endTimer(): void {
    const gl = this.gl as WebGL2RenderingContext | null;
    const ext = this.timerExt;
    if (!gl || !ext || !this.timerQuery) return;
    try {
      const anyGl = gl as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (typeof anyGl.endQuery === 'function') anyGl.endQuery(ext.TIME_ELAPSED_EXT);
      else if (typeof anyGl.endQueryEXT === 'function') anyGl.endQueryEXT(ext.TIME_ELAPSED_EXT);
      const avail = typeof anyGl.getQueryObjectEXT === 'function'
        ? (anyGl.getQueryObjectEXT as (q: unknown, p: number) => boolean)(this.timerQuery, ext.QUERY_RESULT_AVAILABLE_EXT)
        : false;
      if (avail) {
        const ns = typeof anyGl.getQueryObjectEXT === 'function'
          ? (anyGl.getQueryObjectEXT as (q: unknown, p: number) => number)(this.timerQuery, ext.QUERY_RESULT_EXT)
          : 0;
        if (ns > 0) this.gpuMs = ns / 1e6;
      }
    } catch { this.timerExt = null; }
  }

  drawFrame(): void {
    const gl = this.gl;
    if (!gl || !this.prog || this.destroyed) return;
    gl.useProgram(this.prog);
    if (this.vao) (gl as WebGL2RenderingContext).bindVertexArray(this.vao);
    else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      const aPos = gl.getAttribLocation(this.prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    }
    gl.uniform1f(this.u.uTime, this.simTime);
    gl.uniform1f(this.u.uScroll, this.scroll);
    gl.uniform2f(this.u.uPointer, this.pointer.x, this.pointer.y);
    gl.uniform1f(this.u.uFade, this.fade);
    /* Текстура пластины: юнит 0, только если она реально загружена. Без этого
       шейдер умножал бы кадр на неполную текстуру и машина «мерцала» бы белым. */
    if (this.plateTex && this.plateReady) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.plateTex);
      gl.uniform1i(this.u.uPlate, 0);
      gl.uniform1f(this.u.uHasPlate, 1);
    } else {
      gl.uniform1f(this.u.uHasPlate, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.vao) (gl as WebGL2RenderingContext).bindVertexArray(null);
  }

  /** Один кадр с произвольным временем — для снятия контрольных кадров и для reduced-motion. */
  renderOnce(time: number, fade = 1): void {
    this.simTime = time;
    this.fade = fade;
    this.drawFrame();
    this.gl?.finish();
  }

  /* ---------- статистика ---------- */

  stats(note?: string): Bg3dStats {
    const r = this.cfg.host.getBoundingClientRect();
    return {
      variant: this.cfg.variant,
      tier: this.cfg.tier ?? '',
      quality: this.cfg.quality,
      fpsCap: this.cfg.fpsCap,
      cssWidth: Math.round(r.width || 0),
      cssHeight: Math.round(r.height || 0),
      drawWidth: this.canvas.width,
      drawHeight: this.canvas.height,
      renderScale: Math.min(this.cfg.renderScale, this.budgetScale),
      budgetScale: this.budgetScale,
      dpr: Math.min(window.devicePixelRatio || 1, this.cfg.dprCap),
      frames: this.frames,
      skipped: this.skipped,
      pauses: this.pauses,
      running: this.running,
      frameMsAvg: this.ring.avg(),
      frameMsP95: this.ring.p(0.95),
      fps: this.fps,
      gpuMs: this.gpuMs,
      drawMs: this.drawMs,
      uptimeMs: performance.now() - this.t0,
      degradations: this.degradations,
      renderer: this.renderer,
      vendor: this.vendor,
      glVersion: this.glVersion,
      contextLost: this.contextLost,
      destroyed: this.destroyed,
      ...(note ? { note } : {}),
    };
  }

  /** Жив ли ещё экземпляр: нужно тесту на 20 переходов. */
  get alive(): boolean { return !this.destroyed && !!this.gl; }
  get instanceRunning(): boolean { return this.running; }
  get currentRenderScale(): number { return this.cfg.renderScale; }

  /* ---------- уборка ---------- */

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.running = false;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.io?.disconnect(); this.io = null;
    this.ro?.disconnect(); this.ro = null;
    for (const [t, ev, fn, capture] of this.listeners) t.removeEventListener(ev, fn, capture);
    this.listeners.length = 0;
    const gl = this.gl;
    if (gl) {
      if (this.vao) (gl as WebGL2RenderingContext).deleteVertexArray?.(this.vao);
      if (this.vbo) gl.deleteBuffer(this.vbo);
      if (this.plateTex) gl.deleteTexture(this.plateTex);
      if (this.prog) gl.deleteProgram(this.prog);
      /* 셰деры уже удалены в init() после линковки — проверяем, что не осталось ничего. */
      if (this.timerQuery) {
        const anyGl = gl as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (typeof anyGl.deleteQueryEXT === 'function') anyGl.deleteQueryEXT(this.timerQuery);
        else if (typeof anyGl.deleteQuery === 'function') anyGl.deleteQuery(this.timerQuery);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.useProgram(null);
      /* Последнее и главное: отдаём память контекста драйверу сразу, а не «когда GC захочет». */
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
    }
    this.timerQuery = null;
    this.timerExt = null;
    this.prog = null; this.vbo = null; this.vao = null; this.gl = null; this.u = {};
    this.plateTex = null; this.plateReady = 0;
    this.ring.reset();
    if (this.ownCanvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.cfg.onDestroyed?.();
  }
}
