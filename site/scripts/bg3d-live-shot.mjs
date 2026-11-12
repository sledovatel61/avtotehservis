#!/usr/bin/env node
/**
 * Живые кадры первого экрана Voyah Free с включённым 3D-фоном (круг 36, задание №63).
 *
 *   cd site && npm run build
 *   BG3D=voyah-free BG3D_DEMO=1 HOST=0.0.0.0 PORT=4399 node dist/server/entry.mjs &
 *   LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/bg3d-live-shot.mjs \
 *     --base http://127.0.0.1:4399 --out ../docs/reports/r36-live --name after
 *
 * Что делает и зачем именно так:
 *
 *  1. Открывает страницу под видом обычного десктопа (подменяет UNMASKED_RENDERER):
 *     без этого gate гасит фон на SwiftShader песочницы, и снимать нечего.
 *  2. Ждёт `data-bg3d-state="on"`, замораживает ВРЕМЯ сцены (`performance.now` →
 *     константа). Подмены requestAnimationFrame мало: движок считает simTime из
 *     performance.now, и между двумя снимками кадр успевал сдвинуться — «маска
 *     текста» ловила ещё и смену кадра, а число видимой доли прыгало 62 → 81 → 95 %
 *     на одном и том же коде.
 *  3. Снимает канвас целиком (клип по хосту) — кадр «как видит посетитель», плюс
 *     полный первый экран для средней яркости.
 *  4. Гасит текст (transition: none, чтобы не поймать полупрозрачные глифы) и снимает
 *     кадр БЕЗ текста — требование приёмки.
 *  5. По разнице двух кадров считает маску текста и по ней — видимую долю кузова и
 *     передней части (капот + линия ДХО, правая треть файла). Доля считается числом,
 *     это и есть приёмочное число круга.
 *  6. Пишет `--out/<имя>-<вьюпорт>.jpg`, `-notitle.jpg`, `-screen.png` и `live.json`.
 *
 * Ограничение, которое здесь не обходится: скриншот отдаётся в CSS-пикселях, поэтому
 * при dpr 2 канвас реально 2850×1534, а JPEG на диске — 1425×767. Числа 1:1 берутся
 * из `canvas.width`, а не из размера картинки.
 */
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const BASE = arg('base', 'http://127.0.0.1:4399');
const OUT = resolve(SITE, '..', arg('out', 'docs/reports/r36-live'));
const PATH_ = arg('path', '/voyah-free?intro=0');
const NAME = arg('name', 'live');

mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { id: '1440', w: 1440, h: 900, dpr: 1 },
  { id: '1440-dpr2', w: 1440, h: 900, dpr: 2 },
  { id: '390', w: 390, h: 844, dpr: 1 },
  { id: '390-dpr2', w: 390, h: 844, dpr: 2 },
];

/** Подмена рапорта о GPU: иначе gate честно решает, что WebGL слабый, и гасит слой. */
const fakeGpu = () => {
  const patch = (Ctor) => {
    if (!Ctor) return;
    const orig = Ctor.prototype.getParameter;
    Ctor.prototype.getParameter = function (p) {
      if (p === 0x9245) return 'Google Inc. (Intel)';
      if (p === 0x9246) return 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.1)';
      return orig.call(this, p);
    };
  };
  patch(window.WebGLRenderingContext);
  patch(window.WebGL2RenderingContext);
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8 });
};

/** Посадка пластины — та же арифметика, что в src/client/bg3d/plate.ts (иначе замер врёт). */
const plateModule = await import(join(SITE, 'src/client/bg3d/plate.ts'));
const PLATE = await (async () => {
  const { data, info } = await sharp(join(SITE, 'public/img/bg3d/car-800.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(info.width * info.height);
  for (let i = 0; i < mask.length; i++) if (data[i * 4 + 3] >= 128) mask[i] = 1;
  return { mask, w: info.width, h: info.height };
})();

/** Геометрия квада в пикселях кадра — из platePlacement, а не «примерно там же». */
function quadOf(cssW, cssH, dpr = 1) {
  const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
  const aspect = W / H;
  const place = plateModule.platePlacement(aspect, [0, 0], 0, 0.10);
  const hx = plateModule.PLATE_HALF_LEN * place.sc;
  const hyHalf = hx / plateModule.PLATE_ASPECT;
  const w = (2 * hx / aspect) * (W / 2);
  const h = (2 * hyHalf) * (H / 2);
  const cxPx = (place.cx / aspect + 1) / 2 * W;
  const cyPx = (1 - place.cy) / 2 * H;
  return { W, H, x0: Math.round(cxPx - w / 2), y0: Math.round(cyPx - h / 2), w: Math.round(w), h: Math.round(h) };
}

/** Яркость Y′ (0…255) — та же шкала, что в r34/r35 и в scripts/bg3d-tone.mjs. */
const toL = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Тон кадра: кузов по маске пластины ВЫШЕ линии земли (ниже — отражение), дверь
 * (нижняя половина квада), пол вне силуэта, контраст и средняя кадра.
 */
function tone(frame, quad, w, h) {
  const { data, info } = frame;
  const C = info.channels;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = toL(data[i * C], data[i * C + 1], data[i * C + 2]);
  const { x0, y0, w: qw, h: qh } = quad;
  const groundY = y0 + qh * plateModule.PLATE_GROUND_FRAC;
  const full = [], lower = [];
  for (let y = 0; y < qh; y++) {
    const sy = Math.min(PLATE.h - 1, (y * PLATE.h / qh) | 0);
    const ty = y0 + y;
    if (ty < 0 || ty >= h || ty >= groundY) continue;
    for (let x = 0; x < qw; x++) {
      const sx = Math.min(PLATE.w - 1, (x * PLATE.w / qw) | 0);
      if (!PLATE.mask[sy * PLATE.w + sx]) continue;
      const tx = x0 + x;
      if (tx < 0 || tx >= w) continue;
      full.push(L[ty * w + tx]);
      if (y >= qh * 0.5) lower.push(L[ty * w + tx]);
    }
  }
  const floorPx = [];
  for (let y = Math.max(0, Math.round(y0 + qh + 2)); y < Math.min(h, Math.round(y0 + qh + 16)); y++) {
    for (let x = Math.max(0, x0); x < Math.min(w, x0 + qw); x++) floorPx.push(L[y * w + x]);
  }
  if (floorPx.length < 50) {
    const yA = Math.max(0, Math.round(y0 + qh * 0.70)), yB = Math.min(h, Math.round(groundY));
    for (let y = yA; y < yB; y++) {
      for (let x = 0; x < Math.max(0, x0) - 1; x++) floorPx.push(L[y * w + x]);
      for (let x = Math.min(w, x0 + qw) + 1; x < w; x++) floorPx.push(L[y * w + x]);
    }
  }
  const mean = (a) => a.reduce((s2, v) => s2 + v, 0) / Math.max(a.length, 1);
  const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
  const fullM = mean(full), lowM = mean(lower), floorM = mean(floorPx);
  let rgbSum = 0;
  for (let i = 0; i < w * h; i++) rgbSum += (data[i * C] + data[i * C + 1] + data[i * C + 2]) / 3;
  return {
    bodyL: +fullM.toFixed(1), bodySigmaL: +(full.length ? sd(full) : 0).toFixed(1), bodyPx: full.length,
    bodyLowerL: +lowM.toFixed(1), bodyLowerSigmaL: +(lower.length ? sd(lower) : 0).toFixed(1),
    floorL: +floorM.toFixed(1), contrastL: +(fullM - floorM).toFixed(1),
    floorBodyContrastL: +(lowM - floorM).toFixed(1),
    frameMeanL: +mean(Array.from(L)).toFixed(2),
    frameMeanRgb: +(rgbSum / (w * h)).toFixed(2),
  };
}

/** Видимая доля кузова и передней части по маске текста. */
function visibility(quad, textMask, W, H) {
  const { x0, y0, w, h } = quad;
  let body = 0, bodyTotal = 0, nose = 0, noseTotal = 0;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(PLATE.h - 1, (y * PLATE.h / h) | 0);
    const ty = y0 + y;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(PLATE.w - 1, (x * PLATE.w / w) | 0);
      if (!PLATE.mask[sy * PLATE.w + sx]) continue;
      const isNose = sx > PLATE.w * 0.72;
      bodyTotal++; if (isNose) noseTotal++;
      const tx = x0 + x;
      if (tx >= 0 && tx < W && ty >= 0 && ty < H && !textMask[ty * W + tx]) { body++; if (isNose) nose++; }
    }
  }
  return {
    bodyVisiblePct: +(body / Math.max(bodyTotal, 1) * 100).toFixed(1),
    frontVisiblePct: +(nose / Math.max(noseTotal, 1) * 100).toFixed(1),
  };
}

/* Путь к браузеру можно задать явно: в песочнице @sparticuz/chromium распаковывает
   бинарник в /tmp, а если /tmp очистили — CHROMIUM_PATH указывает на распакованный
   заранее. Библиотеки (libnss3 и т.д.) — в /tmp/al2023/lib, LD_LIBRARY_PATH задаётся
   снаружи. */
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || await chromium.executablePath(),
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  headless: 'shell',
  defaultViewport: null,
});

const out = { base: BASE, path: PATH_, shots: [] };

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr });
  await page.evaluateOnNewDocument(fakeGpu);
  await page.goto(BASE + PATH_, { waitUntil: 'networkidle2', timeout: 120000 });
  for (let i = 0; i < 40; i++) {
    const state = await page.evaluate(() => document.querySelector('[data-bg3d]')?.dataset.bg3dState);
    if (state === 'on') break;
    await new Promise((r) => setTimeout(r, 400));
  }
  await new Promise((r) => setTimeout(r, 2600));
  const info = await page.evaluate(() => {
    const host = document.querySelector('[data-bg3d]');
    const cv = host?.querySelector('canvas');
    const hr = host.getBoundingClientRect();
    return {
      data: { ...host.dataset },
      hostCss: [Math.round(hr.width), Math.round(hr.height)],
      canvasAttr: cv ? [cv.width, cv.height] : null,
      dpr: window.devicePixelRatio,
      clip: { x: Math.round(hr.left), y: Math.round(hr.top), width: Math.round(hr.width), height: Math.round(hr.height) },
    };
  });

  /* 1:1 — проверяем числом, а не на слово: canvas = round(css×dpr) при dpr ≤ 2 */
  const expect = [Math.round(info.hostCss[0] * Math.min(info.dpr, 2)), Math.round(info.hostCss[1] * Math.min(info.dpr, 2))];
  const oneToOne = !!info.canvasAttr && info.canvasAttr[0] === expect[0] && info.canvasAttr[1] === expect[1];

  /* замораживаем время сцены: оба снимка показывают ОДИН И ТОТ ЖЕ кадр */
  await page.evaluate(() => { const frozen = performance.now(); performance.now = () => frozen; });
  await new Promise((r) => setTimeout(r, 300));

  const withText = join(OUT, `${NAME}-${vp.id}.png`);
  await page.screenshot({ path: withText, clip: info.clip });
  /* последний экран тоже JPEG: PNG в 1440×900 весит 1,9 МБ и в отчёте не нужен */
  const fullShot = join(OUT, `${NAME}-${vp.id}-screen.png`);
  await page.screenshot({ path: fullShot });

  /* Кадр БЕЗ текста — требование приёмки («кадр без текста на 390»). Гасим текст
     мгновенно (transition: none): с 400-мс переходом снимок через 250 мс ловил
     полупрозрачные глифы и маска текста выходила заниженной. */
  await page.evaluate(() => {
    for (const sel of ['.v-hero .v-eyebrow', '.v-hero h1', '.v-hero .v-lead', '.v-hero .v-btnrow', '.v-hero .v-hero-meta', '.bg3d-off']) {
      for (const el of document.querySelectorAll(sel)) {
        el.style.setProperty('transition', 'none', 'important');
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  });
  await new Promise((r) => setTimeout(r, 400));
  const noText = join(OUT, `${NAME}-${vp.id}-notitle.png`);
  await page.screenshot({ path: noText, clip: info.clip });
  await page.close();

  /* Маска текста = разница кадра С текстом и БЕЗ него. Это и есть требование задания
     («доля видимых пикселей кузова — числом, разница кадра с текстом и без»), и это
     точнее DOM-геометрии: строчный бокс включает интервалы и пробелы, а глифы — нет
     (на 390 DOM-маска давала 42,5 % «текста» против 21,9 % реальных глифов). */
  const A = await sharp(withText).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(noText).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = A.info.width, H = A.info.height;
  const textMask = new Uint8Array(W * H);
  let textPx = 0;
  for (let i = 0; i < W * H; i++) {
    const d = Math.abs(A.data[i * 3] - B.data[i * 3]) + Math.abs(A.data[i * 3 + 1] - B.data[i * 3 + 1]) + Math.abs(A.data[i * 3 + 2] - B.data[i * 3 + 2]);
    if (d > 20) { textMask[i] = 1; textPx++; }
  }
  const quad = quadOf(W, H);
  const vis = visibility(quad, textMask, W, H);
  const toneRow = tone(B, quad, W, H);   /* B — кадр без текста: тон меряем без глифов */

  await sharp(withText).jpeg({ quality: 92 }).toFile(join(OUT, `${NAME}-${vp.id}.jpg`));
  await sharp(noText).jpeg({ quality: 92 }).toFile(join(OUT, `${NAME}-${vp.id}-notitle.jpg`));
  /* PNG-исходники нужны только как вход для разницы кадров: после расчёта их не
     храним (по 1–2 МБ на кадр), в отчёт идут JPEG и последний экран в PNG. */
  if (!process.env.KEEP_PNG) {
    for (const f of [withText, noText]) { try { unlinkSync(f); } catch { /* уже нет */ } }
  }

  /* средняя яркость ПЕРВОГО ЭКРАНА целиком (шапка + герой), а не только канваса:
     именно её требует приёмка («средняя кадра ≥ 24,3 L») */
  const F = await sharp(fullShot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sumL = 0;
  for (let i = 0; i < F.info.width * F.info.height; i++) sumL += toL(F.data[i * 3], F.data[i * 3 + 1], F.data[i * 3 + 2]);
  const screenMeanL = +(sumL / (F.info.width * F.info.height)).toFixed(2);
  await sharp(fullShot).jpeg({ quality: 90 }).toFile(join(OUT, `${NAME}-${vp.id}-screen.jpg`));
  if (!process.env.KEEP_PNG) { try { unlinkSync(fullShot); } catch { /* уже нет */ } }

  const shot = {
    viewport: vp.id, css: [vp.w, vp.h], dpr: vp.dpr, hostCss: info.hostCss,
    canvas: info.canvasAttr, canvasExpected: expect, oneToOne,
    tier: info.data.bg3dTier, state: info.data.bg3dState,
    quad, textPct: +(textPx / (W * H) * 100).toFixed(1), ...vis,
    ...toneRow, screenMeanL, screen: `${NAME}-${vp.id}-screen.jpg`,
    frames: { withText: `${NAME}-${vp.id}.jpg`, noText: `${NAME}-${vp.id}-notitle.jpg` },
  };
  out.shots.push(shot);
  console.log(`${vp.id}: канвас ${info.canvasAttr?.join('×')} (ожидалось ${expect.join('×')}) ${oneToOne ? '1:1 ok' : 'НЕ 1:1'}`
    + ` · квад ${quad.w}×${quad.h} @${quad.x0},${quad.y0} · текст ${shot.textPct} % кадра`
    + ` · видно кузова ${shot.bodyVisiblePct} %, передней части ${shot.frontVisiblePct} %`
    + ` · кузов ${shot.bodyL} L σ ${shot.bodySigmaL} (дверь ${shot.bodyLowerL} L) · пол ${shot.floorL} L`
    + ` · контраст ${shot.contrastL} L · средняя кадра ${shot.frameMeanRgb} RGB / ${shot.frameMeanL} L`
    + ` · средняя первого экрана ${shot.screenMeanL} L`);
}

await browser.close();
writeFileSync(join(OUT, 'live.json'), JSON.stringify(out, null, 2));
console.log(`\nкадры и числа: ${OUT}`);
