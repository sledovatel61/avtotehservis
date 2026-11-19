/**
 * Кадры стенда /lab/bg3d (оба варианта фона) — чтобы владелец выбирал глазами.
 * Требует BG3D_LAB=1 (иначе стенд отдаёт 404). Про libnss3 — см. scripts/intro-stills.mjs.
 *   OUT=../docs/reports/r31 LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/bg3d-lab-shot.mjs
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const OUT = resolve(process.env.OUT || join(import.meta.dirname, '..', '..', 'docs/reports/r31'));
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  headless: 'shell', defaultViewport: null,
});

try {
  for (const variant of ['silhouette', 'depth']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/lab/bg3d?variant=${variant}&demo=1`, { waitUntil: 'networkidle2', timeout: 90000 });
    /* стенд рисует сцену под панелью — прокручиваем к ней и ждём пару секунд */
    await page.evaluate(() => document.querySelector('[data-bg3d]')?.scrollIntoView({ block: 'center' }));
    await new Promise((r) => setTimeout(r, 3500));
    const info = await page.evaluate(() => {
      const host = document.querySelector('[data-bg3d]');
      const c = document.querySelector('canvas.bg3d-canvas');
      return { state: host?.dataset.bg3dState, canvas: c ? [c.width, c.height] : null,
        live: (window.__bg3dDebug && window.__bg3dDebug.live()) ?? null };
    });
    await page.screenshot({ path: join(OUT, `lab-${variant}.jpg`) });
    console.log(variant, JSON.stringify(info));
    await page.close();
  }
} finally {
  await browser.close();
}
