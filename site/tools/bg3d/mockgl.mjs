/**
 * Mock WebGL-контекста для тестов и замера жизненного цикла (задание №44).
 *
 * Зачем не headless-браузер: в песочнице нет ни Chrome, ни GPU, ни Mesa — поставить
 * Playwright с браузерами нельзя (домены загрузчиков вне белого списка). Поэтому
 * «память после 20 переходов» меряется так: jsdom + вот этот mock, который честно
 * считает созданные и удалённые GL-объекты, слушатели и живые экземпляры. Это не
 * подменяет замер на реальном устройстве (см. scripts/bg3d-device-metrics.mjs),
 * это проверяет именно то место, где утечка и рождается: destroy() после каждого
 * перехода.
 *
 * Mock отдаёт ровно тот набор вызовов, который использует engine.ts, и ведёт журнал:
 * какие объекты созданы, какие удалены, какие слушатели висят. Любая несимметричная
 * пара create/delete или забытый removeEventListener видна в отчёте.
 */
export function createMockGl(canvas, opts = {}) {
  const journal = {
    created: { shader: 0, program: 0, buffer: 0, vao: 0, query: 0, texture: 0 },
    deleted: { shader: 0, program: 0, buffer: 0, vao: 0, query: 0, texture: 0 },
    draws: 0,
    lost: 0,
    calls: {},
  };
  const live = { shader: new Set(), program: new Set(), buffer: new Set(), vao: new Set(), texture: new Set() };
  let id = 1;
  const next = (kind) => {
    const o = { __kind: kind, __id: id++ };
    journal.created[kind]++;
    live[kind].add(o);
    return o;
  };
  const drop = (kind, o) => {
    journal.deleted[kind]++;
    live[kind].delete(o);
  };
  const note = (name) => { journal.calls[name] = (journal.calls[name] ?? 0) + 1; };

  const VERTEX_SHADER = 35633, FRAGMENT_SHADER = 35632;
  const gl = {
    canvas,
    VERSION: 'MockGL 1.0 (jsdom)',
    VERTEX_SHADER,
    FRAGMENT_SHADER,
    LINK_STATUS: 0x8B82,
    COMPILE_STATUS: 0x8B81,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88E4,
    FLOAT: 0x1406,
    TRIANGLES: 4,
    /* создание/удаление */
    createShader: (t) => next('shader'),
    shaderSource: note.bind(null, 'shaderSource'),
    compileShader: note.bind(null, 'compileShader'),
    getShaderParameter: () => !(opts.compileFail),
    getShaderInfoLog: () => (opts.compileFail ? 'mock compile error' : ''),
    deleteShader: (o) => drop('shader', o),
    createProgram: () => next('program'),
    attachShader: note.bind(null, 'attachShader'),
    linkProgram: note.bind(null, 'linkProgram'),
    getProgramParameter: () => !(opts.linkFail),
    getProgramInfoLog: () => (opts.linkFail ? 'mock link error' : ''),
    deleteProgram: (o) => drop('program', o),
    useProgram: note.bind(null, 'useProgram'),
    createBuffer: () => next('buffer'),
    bindBuffer: note.bind(null, 'bindBuffer'),
    bufferData: note.bind(null, 'bufferData'),
    deleteBuffer: (o) => drop('buffer', o),
    createVertexArray: opts.webgl2 ? () => next('vao') : undefined,
    bindVertexArray: opts.webgl2 ? note.bind(null, 'bindVertexArray') : undefined,
    deleteVertexArray: opts.webgl2 ? (o) => drop('vao', o) : undefined,
    enableVertexAttribArray: note.bind(null, 'enableVertexAttribArray'),
    vertexAttribPointer: note.bind(null, 'vertexAttribPointer'),
    getAttribLocation: () => 0,
    getUniformLocation: (p, n) => ({ __uniform: n }),
    uniform1f: note.bind(null, 'uniform1f'),
    uniform1i: note.bind(null, 'uniform1i'),
    /* Текстура фото-пластины (круг 35, задание №62): считаем созданной и удалённой,
       иначе утечка текстуры при переходах по страницам осталась бы незамеченной. */
    TEXTURE_2D: 0x0DE1, TEXTURE0: 0x84C0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    CLAMP_TO_EDGE: 0x812F, LINEAR: 0x2601, LINEAR_MIPMAP_LINEAR: 0x2703,
    UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    createTexture: () => next('texture'),
    deleteTexture: (o) => drop('texture', o),
    bindTexture: note.bind(null, 'bindTexture'),
    activeTexture: note.bind(null, 'activeTexture'),
    pixelStorei: note.bind(null, 'pixelStorei'),
    texImage2D: note.bind(null, 'texImage2D'),
    texParameteri: note.bind(null, 'texParameteri'),
    generateMipmap: note.bind(null, 'generateMipmap'),
    uniform2f: note.bind(null, 'uniform2f'),
    uniform3fv: note.bind(null, 'uniform3fv'),
    viewport: note.bind(null, 'viewport'),
    drawArrays: () => { journal.draws++; },
    finish: note.bind(null, 'finish'),
    getParameter: (p) => {
      if (p === 0x1f01 /* VERSION */) return 'MockGL 1.0 (jsdom)';
      if (p === 0x8b84 /* UNMASKED_RENDERER */) return opts.renderer ?? 'Mock Renderer';
      if (p === 0x8b85 /* UNMASKED_VENDOR */) return opts.vendor ?? 'Mock Vendor';
      return null;
    },
    getExtension: (name) => {
      if (name === 'WEBGL_debug_renderer_info') {
        return { UNMASKED_RENDERER_WEBGL: 0x8b84, UNMASKED_VENDOR_WEBGL: 0x8b85 };
      }
      if (name === 'WEBGL_lose_context') {
        return {
          loseContext: () => { journal.lost++; canvas.dispatchEvent?.(new (canvas.ownerDocument?.defaultView?.Event ?? Event)('webglcontextlost', { cancelable: true })); },
          restoreContext: () => { /* noop */ },
        };
      }
      return null;   /* таймер-расширения нет: gpuMs останется null, как и должно */
    },
  };
  return { gl, journal, live };
}

/** Повесить mock на все канвасы документа jsdom. */
export function patchCanvas(win, opts = {}) {
  const made = [];
  const proto = win.HTMLCanvasElement.prototype;
  proto.getContext = function getContext(kind) {
    if (!/webgl/i.test(String(kind))) return null;
    const m = createMockGl(this, opts);
    made.push(m);
    return m.gl;
  };
  return {
    mocks: made,
    totals() {
      const t = { created: {}, deleted: {}, draws: 0, lost: 0 };
      for (const m of made) {
        for (const k of Object.keys(m.journal.created)) t.created[k] = (t.created[k] ?? 0) + m.journal.created[k];
        for (const k of Object.keys(m.journal.deleted)) t.deleted[k] = (t.deleted[k] ?? 0) + m.journal.deleted[k];
        t.draws += m.journal.draws;
        t.lost += m.journal.lost;
      }
      t.leaking = Object.keys(t.created).filter((k) => t.created[k] !== t.deleted[k]);
      return t;
    },
  };
}
