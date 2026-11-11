/* Тесты 3D-фона (задание №44, раунд 30).

   Проверяют то, что можно проверить без GPU и браузера, и именно то, что обещано в задании:
     - шейдер: ноль текстур, вес в лимите 14 КБ gzip, ESSL 1.00 (WebGL1+WebGL2);
     - ворота gate.ts: reduced-motion, saveData, слабое устройство, программный растеризатор,
       низкая батарея, выключено пользователем, узкий экран — и что решение несёт измеренную
       стоимость кадра (оп/px) и бюджет тира;
     - fitScale: пиксельный бюджет режет масштаб по sqrt-закону и не уходит ниже пола;
     - серверный конфиг: по умолчанию фон выключен ВЕЗДЕ, включается только env BG3D
       и только для страниц из белого списка;
     - жизненный цикл в jsdom + mock-GL: кадры рисуются, после уборки не остаётся ни
       GL-объектов, ни слушателей, ни observer'ов, ни экземпляров (это «память после N переходов»
       для JS-стороны; полный прогон на 20 циклов — scripts/bg3d-measure.mjs);
     - кнопка «выключить»: пишет выбор в localStorage и гасит фон;
     - интеграция: собранная страница услуги отдаёт слой только когда BG3D разрешает.

   Реальные fps/батарею эти тесты не проверяют — их снимает scripts/bg3d-device-metrics.mjs
   на живом браузере, а модель считается в scripts/bg3d-measure.mjs. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { gzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';

const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'ats-bg3d-'));
const DIRS = { data: join(TMP, 'data'), media: join(TMP, 'media'), mail: join(TMP, 'mail') };
mkdirSync(DIRS.mail, { recursive: true });

const { VERT, FRAG } = await import('../src/client/bg3d/shader.ts');
import type { Bg3dEnv } from '../src/client/bg3d/gate.ts';
const { OPS_PER_PX, OPS_BUDGET, decideTier, fitScale, isBlockedRenderer } = await import('../src/client/bg3d/gate.ts');
const { bg3dFlag, bg3dFor, BG3D_PAGES } = await import('../src/server/bg3d-config.ts');

/* mock-GL лежит в tools/ (вне tsconfig include), поэтому импортируем по URL: типы не выводятся,
   описываем их сами — нам нужны только журнал объектов и патч канваса. */
interface MockJournal { created: Record<string, number>; deleted: Record<string, number>; draws: number; lost: number }
interface MockGl { journal: MockJournal }
interface CanvasPatch { mocks: MockGl[]; totals(): { created: Record<string, number>; deleted: Record<string, number>; draws: number; lost: number; leaking: string[] } }
const mockglUrl = new URL('../tools/bg3d/mockgl.mjs', import.meta.url).href;
const { patchCanvas } = await import(mockglUrl) as { patchCanvas: (win: unknown, opts?: Record<string, unknown>) => CanvasPatch };

/** «Нормальный десктоп»: всё включено, железо среднее-хорошее. От него отталкиваются сценарии. */
function env(over: Partial<Bg3dEnv> = {}): Bg3dEnv {
  return {
    deviceMemory: 8, hardwareConcurrency: 8, saveData: false, effectiveType: '4g',
    reducedMotion: false, webgl: true, webgl2: true, renderer: 'ANGLE (Intel(R) Iris(R) Xe Graphics)',
    vendor: 'Google Inc. (Intel)', width: 1280, height: 800, devicePixelRatio: 1,
    coarsePointer: false, isAppleMobile: false, userOff: false, sessionBlocked: false,
    featureEnabled: true, userAgent: 'test', ...over,
  } as Bg3dEnv;
}

/* ============================ 1. ШЕЙДЕР ============================ */

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/[^\n]*/g;

test('шейдер: одна текстура — фото-пластина, не больше двух выборок на пиксель', () => {
  /* Круг 35 (задание №62) сознательно отменяет правило «0 текстур» из раунда 30.
     Причина и числа — docs/reports/r35-bg-car/report.md: процедурный силуэт стоил
     936,8 оп/px и давал плоскую заливку внутри кузова (σ 10,7 L) при кромке-ступеньке.
     Новое правило проверяется так же строго, как старое:
       · текстура РОВНО одна и это пластина машины (uPlate);
       · выборок на пиксель не больше двух: основная всегда, отражение — только high;
       · вес шейдера остаётся под лимитом 14 КБ gzip (тест ниже). */
  const samplers = FRAG.match(/uniform\s+sampler2D\s+(\w+)\s*;/g) ?? [];
  assert.equal(samplers.length, 1, `sampler должен быть ровно один, найдено ${samplers.length}`);
  assert.match(FRAG, /uniform\s+sampler2D\s+uPlate\s*;/, 'единственный sampler — не uPlate');
  const samples = FRAG.match(/texture2D\s*\(/g) ?? [];
  assert.ok(samples.length <= 2, `выборок текстуры ${samples.length}, допускается 2 (основная + отражение)`);
  assert.equal(/uPlate/.test(VERT), false, 'в вершинном шейдере текстура не нужна');
  /* Ключевое требование задания: контуры кузова кодом не рисуются. */
  /* Проверяем КОД, а не комментарии: перед проверкой вырезаем блочные и строчные
     комментарии GLSL — иначе упоминание снятых функций в пояснении считалось бы кодом. */
  const code = FRAG.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
  for (const dead of ['carProfile(', 'carSdf(', 'sdRoundBox(', 'pFender(', 'carTrim(']) {
    assert.equal(code.includes(dead), false, `в шейдере остался процедурный силуэт: ${dead}`);
  }
  /* Альфа за пределами квада обязана быть нулевой — иначе пластина «течёт» за кромку. */
  assert.match(FRAG, /inQ/, 'нет маски квада inQ: альфа за пределами квада не гасится');
});

test('шейдер: вес вписывается в лимит 14 КБ gzip', () => {
  const gz = gzipSync(Buffer.from(VERT + '\n' + FRAG, 'utf8'), { level: 9 }).byteLength;
  assert.ok(gz <= 14 * 1024, `gzip ${gz} Б больше лимита ${14 * 1024} Б`);
  assert.ok(gz > 1024, 'шейдер подозрительно короткий — похоже, содержимое потерялось');
});

test('шейдер: ESSL 1.00 — без #version, с gl_FragColor и precision (WebGL1 и WebGL2)', () => {
  assert.equal(/#version/.test(FRAG + VERT), false, '#version в ESSL 1.00 не нужен и ломает WebGL1');
  assert.match(FRAG, /precision highp float;/);
  assert.match(FRAG, /gl_FragColor\s*=/);
  assert.match(VERT, /attribute\s+vec2\s+aPos|attribute\s+vec2\s+a_pos/);
});

test('шейдер: все uniform-ы на месте (вариант, качество, затухание, скролл, указатель)', () => {
  for (const u of ['uRes', 'uTime', 'uScroll', 'uPointer', 'uMode', 'uQuality', 'uFade']) {
    assert.match(FRAG, new RegExp(`uniform\\s+\\w+\\s+${u}\\s*;`), `нет uniform ${u}`);
  }
});

/* ============================ 2. СТОИМОСТЬ И БЮДЖЕТ ============================ */

test('стоимость кадра: вариант B «силуэт» дороже A «глубина», качество монотонно', () => {
  for (const q of [0, 1, 2] as const) {
    assert.ok(OPS_PER_PX.silhouette[q] > OPS_PER_PX.depth[q], `q${q}: B должен быть дороже A`);
  }
  for (const v of ['depth', 'silhouette'] as const) {
    assert.ok(OPS_PER_PX[v][0] < OPS_PER_PX[v][1] && OPS_PER_PX[v][1] < OPS_PER_PX[v][2], `${v}: стоимость должна расти с качеством`);
  }
});

test('бюджет тира: high > mid > low > off = 0', () => {
  assert.ok(OPS_BUDGET.high > OPS_BUDGET.mid && OPS_BUDGET.mid > OPS_BUDGET.low);
  assert.equal(OPS_BUDGET.off, 0);
});

test('fitScale: запас по бюджету не режет масштаб, нехватка — режет по sqrt и упирается в пол', () => {
  /* 1600×1000 @30 к/с с вариантом B (821 оп/px) — как раз тот размер, на котором
     бюджет mid (25 Гоп/с) начинает связывать: fit ≈ 0.80 */
  const base = { cssWidth: 1600, cssHeight: 1000, dpr: 1, fpsCap: 30, opsPerPx: 821, budget: OPS_BUDGET.mid, min: 0.5, max: 1 };
  const free = fitScale({ ...base, budget: 1e12 });
  assert.equal(free, 1, 'при огромном бюджете масштаб обязан остаться максимальным');

  const tight = fitScale(base);
  assert.ok(tight < 1 && tight >= 0.5, `масштаб ${tight} должен быть в (0.5, 1)`);

  /* вчетверо больше пикселей → вдвое меньший масштаб (sqrt-закон), пока не упрёмся в пол */
  const quad = fitScale({ ...base, cssHeight: base.cssHeight * 4 });
  const expected = Math.max(0.5, tight / 2 - 1e-9);
  assert.ok(Math.abs(quad - expected) < 1e-6, `ожидали ${expected}, получили ${quad}`);

  const floor = fitScale({ ...base, cssWidth: 7680, cssHeight: 4320 });
  assert.equal(floor, 0.5, 'ниже пола 0.5 масштаб не уходит');

  /* бюджет 0 (фон выключен) — масштаб не трогаем, решение уже принято */
  assert.equal(fitScale({ ...base, budget: 0 }), 1);
});

test('решение несёт измеренную стоимость кадра и бюджет своего тира', () => {
  for (const variant of ['depth', 'silhouette'] as const) {
    const d = decideTier(env(), variant);
    assert.equal(d.opsPerPx, OPS_PER_PX[variant][d.quality]);
    assert.equal(d.opsBudget, OPS_BUDGET[d.tier]);
    assert.ok(d.reasons.length >= 2, 'причины решения должны быть человекочитаемыми');
  }
});

/* ============================ 3. ВОРОТА ============================ */

test('ворота: сильный десктоп → high, 60 к/с, полный масштаб, движение есть', () => {
  const d = decideTier(env());
  assert.equal(d.tier, 'high');
  assert.equal(d.quality, 2);
  assert.equal(d.fpsCap, 60);
  assert.equal(d.renderScale, 1);
  assert.equal(d.motion, 'animate');
});

test('ворота: prefers-reduced-motion → один статичный кадр, а не пустое место', () => {
  const d = decideTier(env({ reducedMotion: true }));
  assert.equal(d.motion, 'static');
  assert.equal(d.fpsCap, 0, 'при static частота кадра обязана быть нулевой');
  assert.notEqual(d.tier, 'off', 'фон остаётся как статичная глубина');
  assert.ok(d.reasons.some((r) => r.includes('reduced-motion')), 'причина должна быть видна');
});

test('ворота: saveData и 2g — фон выключен', () => {
  assert.equal(decideTier(env({ saveData: true })).tier, 'off');
  assert.equal(decideTier(env({ effectiveType: '2g' })).tier, 'off');
  assert.equal(decideTier(env({ effectiveType: 'slow-2g' })).tier, 'off');
  assert.notEqual(decideTier(env({ effectiveType: '3g' })).tier, 'off', '3g — не запрет, а снижение тира');
});

test('ворота: выключено пользователем, watchdog-ом, флагом или отсутствием WebGL', () => {
  for (const over of [{ userOff: true }, { sessionBlocked: true }, { featureEnabled: false }, { webgl: false, webgl2: false }]) {
    assert.equal(decideTier(env(over)).tier, 'off', JSON.stringify(over));
  }
});

test('ворота: программный и древний растеризатор отсекаются, живой GPU — нет', () => {
  for (const r of ['Google SwiftShader', 'llvmpipe (LLVM 15.0.7)', 'Softpipe', 'Microsoft Basic Render Driver', 'VirtualBox Graphics Adapter', 'VMware SVGA 3D']) {
    assert.equal(isBlockedRenderer(r, ''), true, `${r} должен блокироваться`);
    assert.equal(decideTier(env({ renderer: r, vendor: '' })).tier, 'off', `${r}: фон обязан гаснуть`);
  }
  for (const r of ['ANGLE (Intel(R) UHD Graphics 620)', 'ANGLE (Qualcomm, Adreno (TM) 610)', 'Apple M1', 'GeForce GTX 1650/PCIe/SSE2']) {
    assert.equal(isBlockedRenderer(r, 'Google Inc.'), false, `${r} не должен блокироваться`);
  }
});

test('ворота: слабое устройство (2 ГБ, 2 потока, тач) — фон выключен', () => {
  const d = decideTier(env({ deviceMemory: 2, hardwareConcurrency: 2, coarsePointer: true, width: 393, height: 852 }));
  assert.equal(d.tier, 'off');
  assert.ok(d.reasons.some((r) => r.includes('слабое устройство')), 'причина должна назвать слабое устройство');
});

test('ворота: средний Android (4 ГБ, тач, WebGL2) — mid с резаным разрешением, не off', () => {
  const d = decideTier(env({ deviceMemory: 4, hardwareConcurrency: 8, coarsePointer: true, width: 393, height: 852, devicePixelRatio: 2.75 }), 'silhouette');
  assert.equal(d.tier, 'mid');
  assert.equal(d.quality, 1);
  assert.equal(d.fpsCap, 30);
  assert.equal(d.renderScale, 0.75);
  assert.equal(d.dprCap, 1.5);
});

test('ворота: низкая батарея без зарядки — off, на зарядке — не блокирует', () => {
  assert.equal(decideTier(env({ batteryLevel: 0.15, batteryCharging: false })).tier, 'off');
  assert.notEqual(decideTier(env({ batteryLevel: 0.15, batteryCharging: true })).tier, 'off');
  assert.notEqual(decideTier(env({ batteryLevel: 0.6, batteryCharging: false })).tier, 'off');
});

test('ворота: узкий экран (< 380px) — off, силуэт не читается', () => {
  assert.equal(decideTier(env({ width: 360, height: 800, coarsePointer: true })).tier, 'off');
  assert.notEqual(decideTier(env({ width: 393, height: 852, coarsePointer: true })).tier, 'off');
});

test('ворота: 4K-экран с высоким DPR режет площадь кадра', () => {
  const d = decideTier(env({ width: 3840, height: 2160, devicePixelRatio: 2 }));
  assert.ok(d.renderScale < 1, `масштаб ${d.renderScale} должен быть урезан`);
  assert.ok(d.reasons.some((r) => r.includes('площадь кадра ограничена')), 'причина должна объяснить резку');
});

/* ============================ 4. СЕРВЕРНЫЙ КОНФИГ ============================ */

test('конфиг: по умолчанию фон выключен везде', () => {
  assert.equal(bg3dFlag({}), 'off');
  assert.equal(bg3dFlag({ BG3D: '  off  ' }), 'off');
  assert.equal(bg3dFor('voyah-free', 'off').enabled, false);
  assert.equal(bg3dFor(undefined, '*').enabled, false, 'без slug включать нечего');
});

test('конфиг: включается только env и только для страниц белого списка', () => {
  assert.equal(bg3dFor('voyah-free', 'voyah-free').enabled, true);
  assert.equal(bg3dFor('voyah-free', 'voyah-free').variant, 'silhouette');
  assert.equal(bg3dFor('voyah-free', 'voyah-free:depth').variant, 'depth');
  assert.equal(bg3dFor('voyah-free', '*').enabled, true);
  assert.equal(bg3dFor('voyah-free', 'other-slug').enabled, false, 'флаг для другой страницы не должен включать эту');
  assert.equal(bg3dFor('diagnostika', '*').enabled, false, 'страница вне белого списка не включается даже при *');
  assert.ok(Object.keys(BG3D_PAGES).length > 0, 'белый список не должен быть пустым');
});

test('конфиг: неизвестный вариант в env откатывается к варианту страницы', () => {
  assert.equal(bg3dFor('voyah-free', 'voyah-free:garbage').variant, BG3D_PAGES['voyah-free']);
});

/* ============================ 5. ЖИЗНЕННЫЙ ЦИКЛ (jsdom + mock-GL) ============================ */

interface Harness {
  win: JSDOM['window'];
  patch: CanvasPatch;
  listeners: () => number;
  breakdown: Map<string, number>;
  obs: { ioCreated: number; ioDisconnected: number; roCreated: number; roDisconnected: number };
  mountAll: (featureEnabled: boolean) => unknown[];
  unmountAll: () => void;
  registry: { length: number };
  /** сколько слоёв сейчас рисует */
  live: () => number;
  makeHost: (opts?: { rect?: { width: number; height: number } }) => HTMLElement;
  setMatchMedia: (reducedMotion: boolean) => void;
  close: () => void;
}

async function harness(): Promise<Harness> {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost:4321/' });
  const win = dom.window;
  const g = globalThis as unknown as Record<string, unknown>;
  /* глобалы браузера, которых нет в Node. performance/navigator НЕ подменяем: jsdom-овская
     performance уводит jsdom в бесконечную рекурсию, а встроенных Node-овских достаточно. */
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'Event']) g[k] = (win as unknown as Record<string, unknown>)[k];
  g.requestAnimationFrame = win.requestAnimationFrame.bind(win);
  g.cancelAnimationFrame = win.cancelAnimationFrame.bind(win);
  g.HTMLElement = win.HTMLElement;
  /* Пластина грузится через `new Image()` (круг 35). В jsdom картинки не декодируются,
     поэтому промис загрузки просто не завершается — это нормально: тесты проверяют
     уборку и жизненный цикл, а не пиксели текстуры. */
  g.Image = win.Image;

  const obs = { ioCreated: 0, ioDisconnected: 0, roCreated: 0, roDisconnected: 0 };
  g.IntersectionObserver = class {
    cb: (e: unknown[], o: unknown) => void; target: unknown = null;
    constructor(cb: (e: unknown[], o: unknown) => void) { this.cb = cb; obs.ioCreated++; }
    observe(t: unknown): void { this.target = t; setTimeout(() => this.cb([{ isIntersecting: true, intersectionRatio: 1, target: this.target }], this), 0); }
    unobserve(): void {}
    takeRecords(): unknown[] { return []; }
    disconnect(): void { obs.ioDisconnected++; }
  };
  g.ResizeObserver = class {
    cb: (e: unknown[], o: unknown) => void;
    constructor(cb: (e: unknown[], o: unknown) => void) { this.cb = cb; obs.roCreated++; }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void { obs.roDisconnected++; }
  };

  /* счётчик живых слушателей с разбивкой «цель#событие» */
  let alive = 0;
  const breakdown = new Map<string, number>();
  type Listener = (this: unknown, t: string, ...a: unknown[]) => void;
  const proto = win.EventTarget.prototype as unknown as { addEventListener: Listener; removeEventListener: Listener };
  const origAdd: Listener = proto.addEventListener, origRemove: Listener = proto.removeEventListener;
  const tagOf = (target: unknown, type: string): string =>
    `${target === win ? 'window' : target === win.document ? 'document' : (target as { constructor?: { name?: string } })?.constructor?.name ?? '?'}#${type}`;
  const bump = (k: string, d: number): void => { const v = (breakdown.get(k) ?? 0) + d; if (v === 0) breakdown.delete(k); else breakdown.set(k, v); };
  proto.addEventListener = function (this: unknown, type: string, ...rest: unknown[]) { alive++; bump(tagOf(this, type), 1); return origAdd.call(this, type, ...rest); };
  proto.removeEventListener = function (this: unknown, type: string, ...rest: unknown[]) { alive--; bump(tagOf(this, type), -1); return origRemove.call(this, type, ...rest); };

  const patch = patchCanvas(win, { webgl2: true, renderer: 'Mock GPU (test harness)' });
  /* gate.ts решает по deviceMemory/hardwareConcurrency: в jsdom их нет */
  for (const [k, v] of [['deviceMemory', 8], ['hardwareConcurrency', 8]] as const) {
    try { Object.defineProperty(win.navigator, k, { value: v, configurable: true }); } catch { /* read-only */ }
  }
  let reducedMotion = false;
  const setMatchMedia = (rm: boolean): void => {
    reducedMotion = rm;
    (win as unknown as Record<string, unknown>).matchMedia = (q: string) => ({
      matches: rm && q.includes('prefers-reduced-motion'), media: q,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    });
  };
  setMatchMedia(false);

  const { mountAll, unmountAll, registry, liveInstances } = await import('../src/client/bg3d/index.ts?' + Math.random()) as {
    mountAll: (f: boolean) => unknown[]; unmountAll: () => void; registry: { length: number }; liveInstances: () => number;
  };

  const makeHost = (opts: { rect?: { width: number; height: number } } = {}): HTMLElement => {
    const host = win.document.createElement('div');
    host.dataset.bg3d = 'silhouette';
    host.className = 'bg3d';
    host.innerHTML = '<canvas class="bg3d-canvas" width="2" height="2"></canvas>'
      + '<button class="bg3d-off" type="button" hidden><span class="bg3d-off-text">Выключить 3D-фон</span></button>';
    /* jsdom отдаёт нулевой rect — без подмены движок решит, что хост 0×0, и не нарисует ничего */
    const r = opts.rect ?? { width: 1280, height: 300 };
    (host as unknown as Record<string, unknown>).getBoundingClientRect = () => ({ ...r, top: 0, left: 0, right: r.width, bottom: r.height, x: 0, y: 0, toJSON: () => ({}) });
    win.document.body.appendChild(host);
    return host;
  };

  /* прогрев: jsdom лениво вешает 9 собственных слушателей на window при первом обращении к DOM */
  const warm = makeHost();
  mountAll(true);
  await new Promise((r2) => setTimeout(r2, 40));
  unmountAll();
  warm.remove();
  await new Promise((r2) => setTimeout(r2, 10));
  patch.mocks.length = 0;
  breakdown.clear();
  alive = 0;
  obs.ioCreated = 0; obs.ioDisconnected = 0; obs.roCreated = 0; obs.roDisconnected = 0;

  return {
    win, patch, obs, breakdown, mountAll, unmountAll, registry, makeHost, setMatchMedia,
    listeners: () => alive,
    live: liveInstances,
    close: () => { try { win.close(); } catch { /* уже закрыт */ } },
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('жизненный цикл: фон рисуется, а после уборки не остаётся ничего', async () => {
  const h = await harness();
  try {
    let frames = 0;
    for (let i = 0; i < 5; i++) {
      const host = h.makeHost();
      const mounted = h.mountAll(true) as Array<{ stats: () => { frames: number } | null; decision: { tier: string } }>;
      await sleep(120);
      const st = mounted[0]?.stats();
      assert.ok(st, 'экземпляр должен отдавать статистику');
      frames += st?.frames ?? 0;
      h.unmountAll();
      host.remove();
      await sleep(10);
    }
    assert.ok(frames >= 5, `должно быть нарисовано хотя бы по кадру на цикл, а вышло ${frames}`);

    const t = h.patch.totals();
    assert.deepEqual(t.leaking, [], `несимметричные GL-объекты: ${JSON.stringify(t.leaking)} (${JSON.stringify(t.created)} / ${JSON.stringify(t.deleted)})`);
    assert.ok(t.created.program >= 5 && t.deleted.program >= 5, 'программы должны создаваться и удаляться');
    assert.equal(t.created.shader, t.deleted.shader, 'шейдеры удаляются после линковки');
    assert.ok(t.draws >= frames, 'drawArrays обязан вызываться');
    assert.equal(h.listeners(), 0, `остались живые слушатели: ${JSON.stringify([...h.breakdown.entries()])}`);
    assert.equal(h.registry.length, 0, 'реестр экземпляров должен быть пуст');
    assert.equal(h.obs.ioCreated, h.obs.ioDisconnected, 'IntersectionObserver не разорван');
    assert.equal(h.obs.roCreated, h.obs.roDisconnected, 'ResizeObserver не разорван');
    assert.ok(t.lost >= 10, `контексты должны помечаться потерянными (движок + проба gate), а вышло ${t.lost}`);
  } finally { h.close(); }
});

test('кнопка «выключить»: гасит фон, запоминает выбор, а уборка снимает слушатель', async () => {
  const h = await harness();
  try {
    const host = h.makeHost();
    h.mountAll(true);
    await sleep(120);
    assert.equal(h.live(), 1, 'фон должен рисовать');
    assert.equal(h.registry.length, 1);
    const btn = host.querySelector('.bg3d-off') as HTMLButtonElement;
    assert.ok(btn, 'кнопка «выключить» обязана быть в разметке слоя');
    assert.equal(btn.hidden, false, 'кнопка показывается, когда фон работает');

    btn.dispatchEvent(new h.win.Event('click', { bubbles: true }));
    await sleep(500);                              /* fade-out 0.3 с, затем destroy() */
    assert.equal(h.win.localStorage.getItem('ats.bg3d'), 'off', 'выбор пользователя должен сохраниться');
    assert.equal(host.dataset.bg3dState, 'off');
    assert.equal(h.live(), 0, 'движок погашен');
    /* слой остаётся в реестре намеренно: кнопка должна уметь включить фон обратно,
       значит её слушатель жив, пока слой в DOM, и снимается только при уборке */
    assert.equal(h.registry.length, 1, 'погашенный слой обязан остаться в реестре до unmountAll');
    assert.equal(h.listeners(), 1, 'слушатель кнопки жив, пока слой в DOM');
    assert.match(btn.textContent ?? '', /Включить/, 'подпись кнопки должна смениться на «включить»');

    h.unmountAll();
    host.remove();
    await sleep(20);
    assert.equal(h.registry.length, 0, 'после уборки реестр пуст');
    assert.equal(h.listeners(), 0, `слушатель кнопки не снят: ${JSON.stringify([...h.breakdown.entries()])}`);
  } finally { h.close(); }
});

test('выключено пользователем: фон не стартует, но кнопка «Включить» видна и работает', async () => {
  const h = await harness();
  try {
    h.win.localStorage.setItem('ats.bg3d', 'off');
    const host = h.makeHost();
    const mounted = h.mountAll(true) as Array<{ on: () => void; decision: { tier: string } }>;
    await sleep(80);
    assert.equal(h.live(), 0, 'при выборе «выключено» фон стартовать не должен');
    const btn = host.querySelector('.bg3d-off') as HTMLButtonElement;
    assert.equal(btn.hidden, false, 'кнопка обязана остаться: выбор пользователя обратим');
    assert.match(btn.textContent ?? '', /Включить 3D-фон/);
    assert.equal(btn.getAttribute('aria-pressed'), 'false');

    /* клик включает фон обратно: это единственный путь вернуть фон без перезагрузки */
    btn.dispatchEvent(new h.win.Event('click', { bubbles: true }));
    await sleep(150);
    assert.equal(h.win.localStorage.getItem('ats.bg3d'), 'on');
    assert.equal(h.live(), 1, 'после «включить» фон должен рисовать');
    void mounted;
    h.unmountAll();
    host.remove();
    await sleep(20);
    assert.equal(h.listeners(), 0);
  } finally { h.close(); }
});

test('reduced-motion в браузере: решение — статичный кадр', async () => {
  const h = await harness();
  try {
    h.setMatchMedia(true);
    const host = h.makeHost();
    const mounted = h.mountAll(true) as Array<{ decision: { motion: string; fpsCap: number; tier: string } }>;
    await sleep(120);
    assert.equal(mounted[0].decision.motion, 'static');
    assert.equal(mounted[0].decision.fpsCap, 0);
    const frames1 = (mounted[0] as unknown as { stats: () => { frames: number } | null }).stats()?.frames ?? 0;
    await sleep(300);
    const frames2 = (mounted[0] as unknown as { stats: () => { frames: number } | null }).stats()?.frames ?? 0;
    assert.ok(frames2 - frames1 <= 1, `при reduced-motion движение должно стоять: было ${frames1}, стало ${frames2}`);
    h.unmountAll();
    host.remove();
  } finally { h.close(); }
});

test('нет WebGL — слой не стартует, а уборка не оставляет слушателей', async () => {
  const h = await harness();
  try {
    /* гасим mock: контекст не отдаётся — как на устройстве без WebGL */
    (h.win.HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = () => null;
    const host = h.makeHost();
    h.mountAll(true);
    await sleep(80);
    assert.equal(h.live(), 0, 'без WebGL рисовать нечего');
    assert.equal(host.dataset.bg3dState, 'off', 'состояние слоя должно быть помечено');
    const btn = host.querySelector('.bg3d-off') as HTMLButtonElement;
    assert.equal(btn.hidden, true, 'мёртвая кнопка «включить» не должна показываться: включать нечем');
    /* слой зарегистрирован, даже когда ничего не стартовало: иначе unmountAll не снимет
       слушатель кнопки, и при клиентской навигации он будет копиться по одному на переход */
    assert.equal(h.registry.length, 1, 'незапущенный слой тоже должен убираться через unmountAll');
    h.unmountAll();
    host.remove();
    await sleep(20);
    assert.equal(h.registry.length, 0);
    assert.equal(h.listeners(), 0, `остались слушатели: ${JSON.stringify([...h.breakdown.entries()])}`);
    assert.equal(h.patch.totals().draws, 0, 'без контекста не должно быть ни одного drawArrays');
  } finally { h.close(); }
});

/* ============================ 6. ИНТЕГРАЦИЯ СО СТРАНИЦЕЙ ============================ */

function freePort(): Promise<number> {
  return new Promise((r, e) => {
    const s = net.createServer();
    s.once('error', e);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); });
  });
}

let port = 0, srv: ChildProcess | null = null, BASE = '';
const SLUG = Object.keys(BG3D_PAGES)[0] ?? 'voyah-free';
let otherSlug = '';

before(async () => {
  process.env.DATA_DIR = DIRS.data;
  process.env.MEDIA_DIR = DIRS.media;
  const { runMigrations } = await import('../scripts/migrate.ts');
  const { runSeed } = await import('../scripts/seed.ts');
  runMigrations();
  runSeed();
  const { db } = await import('../src/server/db.ts');
  const { allServiceSlugs } = await import('../src/server/services.ts');
  /* страницы Voyah Free в репозитории нет (см. evaluation/round30-bg-3d/task-as-received.md),
     поэтому для проверки интеграции заводим услугу с нужным slug в тестовой базе */
  db().prepare(`INSERT INTO services(slug,title,short,description,icon,grp,tag,sort,hidden,chip,seo_title,seo_description)
    VALUES(?,?,?,?,?,?,?,?,0,0,NULL,NULL)
    ON CONFLICT(slug) DO NOTHING`).run(SLUG, 'Voyah Free — диагностика и ремонт', 'Тестовая услуга', 'Описание для теста.', null, 'Тест', null, 1);
  otherSlug = allServiceSlugs().find((s) => s !== SLUG) ?? '';

  port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, [join(SITE_ROOT, 'dist/server/entry.mjs')], {
    cwd: SITE_ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), SMTP_JSON_DIR: DIRS.mail, SESSION_SECRET: 'bg3d-test', BG3D: '*' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr?.on('data', (d) => { if (process.env.TEST_DEBUG) console.error('[bg3d-srv]', String(d)); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch { /* ждём */ }
    await sleep(250);
  }
});

after(() => { srv?.kill('SIGKILL'); });

test('страница услуги при BG3D=* отдаёт слой: канвас, кнопку и отдельный чанк (без инлайн-скрипта)', async () => {
  const html = await (await fetch(`${BASE}/services/${SLUG}`)).text();
  assert.match(html, /data-bg3d="silhouette"/, 'слой не отрисован');
  assert.match(html, /<canvas class="bg3d-canvas"/, 'канвас слоя отсутствует');
  assert.match(html, /class="bg3d-off"/, 'кнопка «выключить» отсутствует');
  assert.match(html, /Выключить 3D-фон/, 'у кнопки нет доступного имени');
  assert.match(html, /aria-hidden="true"/, 'декоративный канвас должен быть скрыт от скринридера');
  /* CSP сайта запрещает инлайн-скрипты: скрипт слоя обязан быть внешним чанком */
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .filter((m) => m[1].includes('bg3d'));
  assert.deepEqual(inline, [], 'скрипт фона попал в страницу инлайном — CSP такое заблокирует');
  /* Astro отдаёт скрипт слоя отдельным чанком: в HTML виден вход Bg3dLayer, а сам фон
     (шейдер, gate, движок) приезжает его динамическим импортом */
  assert.match(html, /src="[^"]*Bg3dLayer[^"]*\.js"/, 'внешний чанк входа слоя не подключён');
  /* CSS слоя приезжает вместе с его JS-чанком (импорт из client/bg3d.ts), поэтому
     имя файла — по компоненту-входу, а не «bg3d.*». Так лишний CSS не попадает
     на страницы, где слой выключен (BG3D=off — значение по умолчанию). */
  assert.match(html, /href="[^"]*(bg3d|Bg3dLayer)[^"]*\.css"/, 'css слоя не подключён');
});

/* Круг 31: страница Voyah Free — отдельный файл src/pages/voyah-free.astro, а не запись
   в services. До этой проверки слой был подключён только к шаблону /services/<slug>,
   то есть включить фон на настоящей странице раздела было нечем. Проверяем оба адреса:
   у страницы и у «услуги» слой обязан появиться при BG3D=*. */
test('страница /voyah-free при BG3D=* получает слой в первом экране и прячет фото', async () => {
  const html = await (await fetch(`${BASE}/voyah-free`)).text();
  assert.match(html, /data-bg3d="silhouette"/, 'на /voyah-free слоя нет — фон включить нечем');
  assert.match(html, /v-hero--bg3d/, 'модификатор первого экрана не выставлен: фото не уступит место сцене');
  assert.match(html, /<canvas class="bg3d-canvas"/, 'канвас слоя отсутствует');
  /* слой должен стоять ВНУТРИ подложки героя: иначе тёмный градиент .v-hero::after
     окажется под сценой, и контраст заголовка поедет (гейт контраста это ловит) */
  const heroBg = html.slice(html.indexOf('v-hero-bg'));
  const canvasAt = heroBg.indexOf('bg3d-canvas');
  const pictureAt = heroBg.indexOf('<picture');
  assert.ok(canvasAt > 0 && pictureAt > canvasAt, 'слой и фото должны жить в одной подложке, слой — первым');
});

test('страница другой услуги слой не получает даже при BG3D=*', async () => {
  assert.ok(otherSlug, 'в тестовой базе нужна вторая услуга для сравнения');
  const html = await (await fetch(`${BASE}/services/${otherSlug}`)).text();
  assert.equal(/data-bg3d=/.test(html), false, 'белый список страниц не сработал');
});

test('слой не влияет на контент страницы: заголовок, хлебные крошки и форма на месте', async () => {
  const html = await (await fetch(`${BASE}/services/${SLUG}`)).text();
  assert.match(html, /Voyah Free/, 'заголовок услуги потерян');
  assert.match(html, /aria-label="Хлебные крошки"/, 'хлебные крошки потеряны');
});

/* ------------------------------------------------------------------ */
/* Круг 33, задание №60: единая линейка фото ↔ силуэт                 */
/* ------------------------------------------------------------------ */
test('линейка: форма силуэта против фото в одних координатах', async () => {
  /* Задание №60, шаг 1: гейт не должен быть «скриптом для отчёта» — он в тестах.
     Сравниваем в безразмерных долях (X — доля длины, Y — доля собственной
     высоты): фото перспективное, и абсолютные высоты в нём завышены на ~5 %. */
  const { renderFrame, loadPlate } = await import('../tools/bg3d/ref.mjs');
  /* Круг 35 (задание №62): силуэт теперь живёт в фото-пластине, поэтому порт обязан
     её загрузить — иначе «кадр с машиной» и «кадр без машины» совпадут, и маска будет
     пустой. Файл — тот же, что уходит в браузер. */
  await loadPlate(new URL('../public/img/bg3d/car-1600.webp', import.meta.url).pathname);
  const W = 640;
  const H = 360;
  const base = { width: W, height: H, variant: 'silhouette', quality: 2, time: 4, scroll: 0, pointer: [0.18, -0.08] };
  /* Отражение в мокром асфальте выключено в обоих кадрах: маска должна мерить САМУ
     машину. С отражением она читает «машина + отражение» и даёт h/L 0,377 при
     паспортных 0,335 — та же ошибка, что в круге 33 дала три разных числа. */
  const withCar = renderFrame({ ...base, car: true, reflection: false });
  const withoutCar = renderFrame({ ...base, car: false, reflection: false });
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const j = i * 3;
    const d = (Math.abs(withCar.data[j] - withoutCar.data[j])
      + Math.abs(withCar.data[j + 1] - withoutCar.data[j + 1])
      + Math.abs(withCar.data[j + 2] - withoutCar.data[j + 2])) / 3;
    mask[i] = d > 12 ? 1 : 0;
  }
  /* Габарит — по ВЕРХНЕЙ связной группе строк. Без этого маска захватывает
     отражение в мокром асфальте, и h/L выходит 0,469 вместо 0,339: ровно та
     ошибка, из-за которой в круге 33 три замера дали три разных числа. */
  const rowN = new Array(H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) rowN[y]++;
  const rowMax = Math.max(...rowN);
  const groups: Array<{ a: number; b: number; gap: number }> = [];
  let run: { a: number; b: number; gap: number } | null = null;
  for (let y = 0; y < H; y++) {
    if (rowN[y] >= Math.max(2, rowMax * 0.025)) {
      if (!run) run = { a: y, b: y, gap: 0 }; else { run.b = y; run.gap = 0; }
    } else if (run) { if (++run.gap >= 6) { groups.push(run); run = null; } }
  }
  if (run) groups.push(run);
  const band = groups.filter((g) => g.b - g.a >= 3)[0] ?? groups[0];
  assert.ok(band, 'силуэт не найден в CPU-кадре');

  let x0 = W, x1 = -1;
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = band.a; y <= band.b; y++) if (mask[y * W + x]) n++;
    if (n >= 2) { if (x < x0) x0 = x; x1 = x; }
  }
  const y0 = band.a;
  const y1 = band.b;
  const L = x1 - x0 + 1;
  const Hh = y1 - y0 + 1;
  /* h/L — главный числовой критерий задания: 0,335 ± 0,010 */
  const hOverL = Hh / L;
  assert.ok(Math.abs(hOverL - 0.335) <= 0.010,
    `h/L по CPU-кадру ${hOverL.toFixed(3)} должен быть 0,335 ± 0,010 (задание №60, шаг 1)`);
  /* верхняя кромка — в тех же координатах, что и в линейке */
  const profile: number[] = [];
  for (let i = 0; i <= 20; i++) {
    const x = Math.min(x1, x0 + Math.round((i / 20) * (L - 1)));
    let top = -1;
    for (let y = y0; y <= y1; y++) if (mask[y * W + x]) { top = y; break; }
    profile.push(top < 0 ? NaN : ((y1 - top) / Hh) * 100);
  }
  /* Крыша выше обоих концов. Кадр сцены развёрнут носом ВПРАВО, поэтому
     слева корма, справа нос: сравнивать «середину с капотом» по индексам
     нельзя, не зная ориентации. Проверяем то, что не зависит от неё.
     Берём ГРЕБЕНЬ по средней трети (30…70 %L), а не одну точку 50 %L: у этой
     машины заднее стекло срывается как раз у середины, и единственная выборка
     там садится на скат, а не на крышу. Гребень же — именно «арка»: он обязан
     быть выше ОБОИХ концов. */
  const crest = Math.max(...profile.slice(6, 15));
  const [endA, endB] = [profile[2], profile[18]];
  const highEnd = Math.max(endA, endB);
  const lowEnd = Math.min(endA, endB);
  /* Гребень выше ОБОИХ концов. Запас к высокому концу скромный (5 %H) намеренно:
     у этого кузова крыша тянется почти до кормы, и на 10 %L от хвоста кромка уже
     на 91 %H — «выше на 5» здесь как раз и означает «плато с уклоном к корме», а не
     клин. Низкий конец (нос) обязан отстоять far больше — 20 %H: если силуэт стал
     клином, именно там разница и схлопывается. */
  assert.ok(crest > highEnd + 5,
    `гребень крыши (${crest.toFixed(0)} %H) должен быть выше высокого конца (${highEnd.toFixed(0)} %H): крыша-арка, а не клин`);
  assert.ok(crest > lowEnd + 20,
    `гребень крыши (${crest.toFixed(0)} %H) должен быть на 20 %H выше низкого конца (${lowEnd.toFixed(0)} %H): силуэт схлопнулся в клин`);
  /* Ступеньки — только на участке 10…90 %L: на самих торцах силуэт падает
     отвесно (бампер), и это не дефект формы, а край. Шаг сетки — 5 %L, а не 10:
     на грубой сетке настоящий скат лобового (95 → 61 %H на 60…70 %L) читается как
     «ступенька» в 23 %H и рушит проверку формы там, где форма верна. Порог 18 %H
     на 5 %L ловит излом в две прямые, но пропускает покатый скат. */
  for (let i = 3; i < profile.length - 3; i++) {
    const d = Math.abs(profile[i] - profile[i - 1]);
    assert.ok(d < 18, `ступенька ${d.toFixed(0)} %H между ${(i - 1) * 5} и ${i * 5} %L — силуэт ломается`);
  }
  /* Клиренс: низ силуэта над землёй 3,7 %L = 11 %H (0,185 м при высоте 1,645). */
  let bottom = -1;
  const xMid = Math.round((x0 + x1) / 2);
  for (let y = y1; y >= y0; y--) if (mask[y * W + xMid]) { bottom = y; break; }
  const clearanceH = ((y1 - bottom) / Hh) * 100;
  assert.ok(clearanceH < 16, `низ кузова над землёй ${clearanceH.toFixed(1)} %H — это клиренс 0,185 м (11 %H), а не 0`);
});
