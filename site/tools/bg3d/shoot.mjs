/**
 * Контрольные кадры 3D-фона настоящей страницей (задание №55, фаза 2, §1.3).
 *
 *   node tools/bg3d/shoot.mjs --base http://127.0.0.1:4331 --out ../docs/reports/r31-bg3d/frames-bg3d
 *
 * Зачем это отдельный инструмент, а не «скриншот руками»
 * -----------------------------------------------------
 * Кадры в отчёте — доказательство, а не иллюстрация: из каждого снимка скрипт
 * вытаскивает состояние слоя (`data-bg3d-state`, `data-bg3d-tier`), размер буфера
 * канваса и строку renderer'а WebGL, и кладёт их рядом с PNG в JSON. Если фон на
 * кадре погашен гейтом, это видно в отчёте числом, а не на глаз.
 *
 * Браузер в песочнице рисует через SwiftShader (программный растеризатор), поэтому
 * нужен демо-показ: на стенде — `?demo=1`, на боевой странице — серверный
 * `BG3D_DEMO=1` (см. src/server/bg3d-config.ts). Частота кадров при этом низкая,
 * но геометрия и цвета те же, что на настоящем GPU: шейдер один и тот же.
 *
 * `preserveDrawingBuffer: false`, поэтому `toDataURL()` вне кадра даёт пустоту;
 * снимок берётся композитором (page.screenshot) после того, как слой отрисовал
 * несколько кадров, — состояние `on` и ненулевой буфер канваса это подтверждают.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const A = process.argv.slice(2);
const arg = (n, d = null) => { const i = A.indexOf(`--${n}`); return i >= 0 && A[i + 1] ? A[i + 1] : d; };
const flag = (n) => A.includes(`--${n}`);

const BASE = (arg('base', 'http://127.0.0.1:4331')).replace(/\/$/, '');
const OUT = resolve(process.cwd(), arg('out', '../docs/reports/r31-bg3d/frames-bg3d'));
const SETTLE = Number(arg('settle', 4000));
const JSON_OUT = arg('json', null);

/* ---------- набор кадров по заданию: стенд (оба варианта) и страница, 1440 и 390 ---------- */
const SHOTS = flag('no-default-shots') ? [] : [
  { name: 'stand-B-silhouette', path: '/lab/bg3d?variant=silhouette&demo=1&tier=high', w: 1440, h: 900, note: 'стенд, вариант B «силуэт в глубине», тир high' },
  { name: 'stand-A-depth', path: '/lab/bg3d?variant=depth&demo=1&tier=high', w: 1440, h: 900, note: 'стенд, вариант A «глубина», тир high' },
  { name: 'stand-B-silhouette-mobile', path: '/lab/bg3d?variant=silhouette&demo=1&tier=auto', w: 390, h: 844, note: 'стенд, вариант B, узкий экран 390 px' },
  { name: 'stand-A-depth-mobile', path: '/lab/bg3d?variant=depth&demo=1&tier=auto', w: 390, h: 844, note: 'стенд, вариант A, узкий экран 390 px' },
];
/* Дополнительные кадры: --shot "имя:/путь?query:1440x900:пояснение" (можно несколько). */
for (let i = 0; i < A.length; i++) {
  if (A[i] !== '--shot') continue;
  const [name, path, size, note] = A[i + 1].split(':');
  const [w, h] = String(size).split('x').map(Number);
  SHOTS.push({ name, path, w, h, note: note ?? '' });
}

/* ---------- браузер (рецепт запуска — как в scripts/measure-intro.mjs --verify) ---------- */
const { default: puppeteer } = await import('puppeteer-core');
const { default: chromium } = await import('@sparticuz/chromium');
const libDir = '/tmp/al2023';
const archive = join(HERE, '../../node_modules/@sparticuz/chromium/bin/al2023.tar.br');
if (!existsSync(join(libDir, 'lib', 'libnss3.so')) && existsSync(archive)) {
  mkdirSync(join(libDir, 'lib'), { recursive: true });
  const { createReadStream, createWriteStream } = await import('node:fs');
  const { createBrotliDecompress } = await import('node:zlib');
  const { pipeline } = await import('node:stream/promises');
  const { spawnSync } = await import('node:child_process');
  await pipeline(createReadStream(archive), createBrotliDecompress(), createWriteStream('/tmp/al2023.tar'));
  spawnSync('tar', ['-xf', '/tmp/al2023.tar', '-C', libDir], { stdio: 'ignore' });
}

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  defaultViewport: null,
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  env: existsSync(join(libDir, 'lib')) ? { ...process.env, LD_LIBRARY_PATH: join(libDir, 'lib') } : process.env,
});

const rows = [];
console.log(`\n== контрольные кадры 3D-фона: ${BASE} → ${OUT} ==`);

for (const shot of SHOTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: shot.w, height: shot.h, deviceScaleFactor: 1 });
  const url = BASE + shot.path;
  const started = Date.now();
  let httpStatus = null;
  /* `domcontentloaded`, а не `networkidle2`: в dev-режиме Vite держит открытый
     сокет HMR, а первый запрос к маршруту ещё и собирает его на лету — «сеть успокоилась»
     в таких условиях не наступает никогда, и кадр теряется на ровном месте. */
  let lastErr = null;
  for (let attempt = 1; attempt <= 2 && httpStatus === null; attempt++) {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      httpStatus = res?.status() ?? null;
    } catch (e) {
      lastErr = e;
    }
  }
  if (httpStatus === null) {
    console.log(`  ${shot.name.padEnd(26)} НЕ ЗАГРУЗИЛСЯ: ${String(lastErr?.message).slice(0, 90)}`);
    rows.push({ ...shot, url, error: String(lastErr?.message).slice(0, 200) });
    await page.close();
    continue;
  }

  /* ждём решения слоя: состояние появляется, когда gate.ts отработал */
  let state = null;
  try {
    await page.waitForFunction(
      () => document.querySelector('[data-bg3d-state]') !== null
        || document.querySelector('.bg3d canvas')?.width > 2,
      { timeout: 30000 },
    );
  } catch { /* слой мог быть выключен — это тоже результат, зафиксируем ниже */ }

  await new Promise((r) => setTimeout(r, SETTLE));

  const readInfo = () => page.evaluate(() => {
    const host = document.querySelector('.bg3d');
    const canvas = host?.querySelector('canvas');
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const cell = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
    const rect = host?.getBoundingClientRect();
    return {
      hostFound: !!host,
      state: host?.getAttribute('data-bg3d-state') ?? null,
      tier: host?.getAttribute('data-bg3d-tier') ?? null,
      demo: host?.getAttribute('data-bg3d-demo') ?? null,
      autoOff: host?.getAttribute('data-bg3d-autooff') ?? null,
      variant: host?.getAttribute('data-bg3d') ?? null,
      canvasW: canvas?.width ?? null,
      canvasH: canvas?.height ?? null,
      canvasCssW: rect ? Math.round(rect.width) : null,
      canvasCssH: rect ? Math.round(rect.height) : null,
      hostBox: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      renderer: dbg && gl ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      vendor: dbg && gl ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      webgl2: !!document.createElement('canvas').getContext('webgl2'),
      labReasons: cell('lab-reasons'),
      labFps: cell('m-fps'),
      labFrames: cell('m-frames'),
      labGpuMs: cell('m-gpu'),
      labRes: cell('m-res'),
      labState: cell('m-state'),
      offButtonVisible: !!host?.querySelector('.bg3d-off')?.offsetParent,
      scrollY: Math.round(window.scrollY),
      scrollX: Math.round(window.scrollX),
    };
  });

  let info = await readInfo();
  /* Хост почти всегда не целиком в первом экране: на стенде сверху панель метрик,
     на боевой странице — шапка и отступы. Вне экрана IntersectionObserver держит
     слой на паузе, а обрезка кадра ловит лишь полоску. Поэтому ставим хост верхом
     к верху экрана и даём наблюдателю снять паузу, прежде чем снимать кадр. */
  if (info.hostBox) {
    const target = Math.max(0, info.hostBox.y + info.scrollY - 10);
    if (Math.abs(info.scrollY - target) > 4) {
      await page.evaluate((y) => window.scrollTo(0, y), target);
      await new Promise((r) => setTimeout(r, Math.min(SETTLE, 2500)));
      info = await readInfo();
    }
  }

  const file = join(OUT, `${shot.name}-${shot.w}x${shot.h}.png`);
  await page.screenshot({ path: file });
  /* Кроп хоста берём снимком самого элемента, а не clip'ом страницы: clip считается
     в координатах документа и на коротких страницах упирается в предел прокрутки
     (мобильный стенд не может поднять хост к верху экрана), из-за чего в кадр
     приезжает панель стенда. elementHandle.screenshot() вырезает ровно границы
     элемента независимо от прокрутки и липких шапок. */
  /* Липкая панель стенда при прокрутке нависает над хостом и попадает в кроп
     (на мобильном она во весь экран). Для кропа хоста прячем её: полный кадр
     страницы ниже всё равно показывает стенд вместе с органами управления. */
  if (await page.$('.lab-bar')) {
    /* addStyleTag нельзя: CSP сайта `style-src 'self'` reject'ит внедрённый <style>.
       Правка через CSSOM (element.style) под CSP не попадает. */
    await page.evaluate(() => {
      const bar = document.querySelector('.lab-bar');
      if (bar) bar.style.display = 'none';
    });
    await new Promise((r) => setTimeout(r, 400));
  }
  let heroFile = null;
  const hostHandle = await page.$('.bg3d');
  if (hostHandle) {
    heroFile = join(OUT, `${shot.name}-${shot.w}x${shot.h}-hero.png`);
    await hostHandle.screenshot({ path: heroFile });
    await hostHandle.dispose();
  }

  const ok = info.state === 'on' && (info.canvasW ?? 0) > 2;
  rows.push({ ...shot, url, httpStatus, ms: Date.now() - started, ...info, ok, file, heroFile });
  console.log(`  ${shot.name.padEnd(26)} ${shot.w}×${shot.h}  состояние ${String(info.state).padEnd(5)} тир ${String(info.tier).padEnd(6)} `
    + `буфер ${info.canvasW}×${info.canvasH} css ${info.canvasCssW}×${info.canvasCssH}  ${ok ? 'ok' : 'ФОН НЕ РИСУЕТ'}`);
  if (info.labReasons) console.log(`      ${info.labReasons.slice(0, 150)}`);
  if (info.labFps) console.log(`      fps ${info.labFps} · кадров ${info.labFrames} · GPU ${info.labGpuMs} мс · ${info.labState}`);
  await page.close();
}

const renderer = rows.find((r) => r.renderer)?.renderer ?? null;
console.log(`\n  WebGL: ${renderer ?? 'нет контекста'} · webgl2 ${rows.some((r) => r.webgl2) ? 'есть' : 'нет'}`);
console.log(`  программный растеризатор (SwiftShader) → fps низкий, геометрия и цвет те же, что на GPU`);
const bad = rows.filter((r) => !r.ok);
console.log(`  ${bad.length === 0 ? 'ok  ' : 'FAIL'} кадры с рисующим фоном: ${rows.length - bad.length} из ${rows.length}`);

await browser.close();

if (JSON_OUT) {
  const out = resolve(process.cwd(), JSON_OUT);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    base: BASE, outDir: OUT, settleMs: SETTLE,
    renderer, webgl2: rows.some((r) => r.webgl2),
    note: 'браузер песочницы рисует через SwiftShader: fps не показателен, геометрия и цвет — те же',
    shots: rows,
  }, null, 2)}\n`);
  console.log(`\nотчёт: ${JSON_OUT}`);
}
