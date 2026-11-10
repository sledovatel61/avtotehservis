/**
 * Кадр первого экрана Voyah Free с 3D-фоном и без — для сравнения глазами.
 * Нужен, когда владелец решает «включать фон или нет»: цифры fps без картинки
 * ничего не говорят. Запуск и требования к libnss3 — см. шапку scripts/intro-stills.mjs.
 *   BASE=http://127.0.0.1:4321 OUT=../docs/reports/r31 LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/bg3d-hero-shot.mjs
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const OUT = resolve(process.env.OUT || join(import.meta.dirname, '..', '..', 'docs/reports/r31'));
await mkdir(OUT, { recursive: true });

/* В песочнице GPU нет: Chromium рисует через SwiftShader, и собственный watchdog
   движка обязан его погасить (12–15 к/с при цели 60). Чтобы снять КАРТИНКУ, а не
   пустой градиент, подменяем только то, по чему гейт узнаёт программный растеризатор
   и слабое железо. FPS при этом честно не измеряется — это не замер, это открытка. */
const SPOOF = () => {
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

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  headless: 'shell',
  defaultViewport: null,
});

try {
  for (const [name, path, w, h] of JSON.parse(process.env.SHOTS || JSON.stringify([
    ['with-bg-1440', '/voyah-free?intro=0', 1440, 900],
    ['with-bg-390', '/voyah-free?intro=0', 390, 844],
  ]))) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(SPOOF);
    await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 90000 });
    /* ждём, пока движок реально нарисует (data-bg3d-state="on"), но не дольше 15 с:
       если watchdog успел погасить — снимем то, что есть, и скажем об этом */
    let state = '';
    for (let i = 0; i < 30; i++) {
      state = await page.evaluate(() => document.querySelector('[data-bg3d]')?.dataset.bg3dState ?? '');
      if (state === 'on') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    /* снимаем СРАЗУ, как только сцена нарисована: в песочнице watchdog гасит фон
       через 3–4 с (SwiftShader ~5–15 к/с), и поздний кадр — это пустой градиент */
    await new Promise((r) => setTimeout(r, 900));
    const info = await page.evaluate(() => {
      const host = document.querySelector('[data-bg3d]');
      const c = document.querySelector('canvas.bg3d-canvas');
      return {
        state: host?.dataset.bg3dState, tier: host?.dataset.bg3dTier,
        autooff: host?.dataset.bg3dAutooff, canvas: c ? [c.width, c.height] : null,
        photoHidden: getComputedStyle(document.querySelector('.v-hero-bg picture') || document.body).display === 'none',
      };
    });
    await page.screenshot({ path: join(OUT, `${name}.jpg`) });
    console.log(name, JSON.stringify(info));
    await page.close();
  }
} finally {
  await browser.close();
}
