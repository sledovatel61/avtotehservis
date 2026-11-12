/**
 * Кадры 3D-заставки «в заданной миллисекунде» — инструмент для правки геометрии машины.
 *
 * Зачем: заставка живёт ~2,5 с и уезжает, поэтому глазами в браузере её силуэт почти
 * не рассмотреть, а сравнивать «на глаз по видео» бессмысленно. Скрипт ставит
 * `window.__vyIntroStill = <мс>` до загрузки страницы — заставка рисует ОДИН кадр
 * в этот момент сцены и остаётся на экране (режим кадра-документации, voyah-intro.ts).
 * Так геометрия проверяется по неподвижным кадрам, а не по ощущению.
 *
 * Запуск (нужен поднятый сервер; сборка уже содержит заставку):
 *   cd site && npm run build
 *   BG3D=off node dist/server/entry.mjs &          # http://127.0.0.1:4321
 *   LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/intro-stills.mjs
 *
 * Переменные:
 *   BASE   — адрес сервера (по умолчанию http://127.0.0.1:4321)
 *   PAGE   — путь страницы (по умолчанию /voyah-free)
 *   OUT    — куда складывать (по умолчанию ../docs/reports/r31/intro-after)
 *   STILLS — список миллисекунд через запятую (по умолчанию 150,400,700,950,1150)
 *   W, H   — размер окна (по умолчанию 1600×900)
 *
 * Про библиотеки Chromium: в песочнице у бинарника нет libnss3/libnspr4. Они лежат
 * внутри `@sparticuz/chromium` в архиве al2023.tar.br. Распаковать один раз:
 *   node -e "const fs=require('fs'),z=require('zlib');fs.createReadStream('node_modules/@sparticuz/chromium/bin/al2023.tar.br').pipe(z.createBrotliDecompress()).pipe(fs.createWriteStream('/tmp/al2023.tar'))"
 *   mkdir -p /tmp/al2023 && tar -xf /tmp/al2023.tar -C /tmp/al2023
 * и запускать с LD_LIBRARY_PATH=/tmp/al2023/lib.
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const PAGE = process.env.PAGE || '/voyah-free';
const OUT = resolve(process.env.OUT || join(import.meta.dirname, '..', '..', 'docs/reports/r31/intro-after'));
const STILLS = (process.env.STILLS || '150,400,700,950,1150').split(',').map(Number);
const W = Number(process.env.W || 1600);
const H = Number(process.env.H || 900);

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  /* SwiftShader: в песочнице нет GPU. Это НЕ показатель fps — только картинка.
     Для fps нужен живой ноутбук/телефон, см. scripts/bg3d-device-metrics.mjs */
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  headless: 'shell',
  defaultViewport: null,
});

try {
  for (const ms of STILLS) {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((v) => { window.__vyIntroStill = v; }, ms);
    await page.goto(BASE + PAGE, { waitUntil: 'networkidle2', timeout: 90000 });
    /* один кадр рисуется сразу, но шрифты и картинки догоняют — ждём и снимаем */
    await new Promise((r) => setTimeout(r, 2000));
    const state = await page.evaluate(() => ({
      canvas: !!document.querySelector('.vy-intro-canvas'),
      overlay: !!document.querySelector('.vy-intro'),
    }));
    const file = join(OUT, `still-${ms}.jpg`);
    /* Снимаем ЭЛЕМЕНТ .vy-intro-canvas, а не страницу (круг 32, A12).
       headless-shell отдаёт снимок layout-вьюпорта: при html{scrollbar-gutter:stable}
       это 1585 px, а остальные 15 px он добивает фоном страницы (--night #0B1410).
       Сама заставка при этом расписана до 1600 px (getBoundingClientRect и снимок
       элемента дают содержимое на x = 1596), то есть полоса — артефакт снимка, а не
       кадра: в живом браузере оверлей лежит поверх гуттера, а скроллбар рисуется
       ещё выше. Артефакт ломал гейт compare:intro: строка «купол крыши» берёт самый
       правый тёмный пиксель строки, а фон страницы проходит порог силуэта
       (r < 45, r−b < 18, g−b < 12) — ширина выходила 66,6 %W при любых 33,3 %W машины.
       Снимки страницы и элемента совпадают побайтово на всех x < 1585 (сверено:
       13 500 отличающихся пикселей из 1 440 000 — ровно 15 × 900). */
    const canvasEl = state.canvas ? await page.$('.vy-intro-canvas') : null;
    if (canvasEl) await canvasEl.screenshot({ path: file });
    else await page.screenshot({ path: file });
    console.log(`${ms} мс → ${file}`, JSON.stringify({ ...state, shot: canvasEl ? 'canvas' : 'page' }));
    await page.close();
  }
} finally {
  await browser.close();
}
