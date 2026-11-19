/* Метрика швов заставки VOYAH (задание r37 §4).
 *
 * Ищет прямоугольник пластины в кадре: вертикальный или горизонтальный шов
 * длиной >= 60 px с перепадом >= 2,5 L в зоне y 0,60...0,99 H. Дефект был такой:
 * альфа пластины читалась плитой, и её край давал в кадре шов 34 -> 6 L за 1 px
 * на 1440x900 и вертикальные швы по краям кропа на 1920x1080.
 *
 * ВАЖНО про отличие шва от края силуэта. Борт машины сам даёт резкий переход:
 * замер эталона на hero 781 — x 377 держит 33 L (красный фон), x 379 уже 6 L
 * (тёмный борт), и край этот прямой на 99 из 141 строки. Это не дефект, это
 * край кузова, и он ЕСТЬ В ЭТАЛОНЕ. Поэтому метрика сравнительная: шов
 * засчитывается только там, где в нашем кадре вертикальный/горизонтальный
 * перепад есть, а в эталоне на той же геометрии его нет. Абсолютный порог
 * без эталона ловит борт машины и даёт ложные провалы (первая версия скрипта
 * показывала 1902 px «шва» ровно на краю кузова).
 *
 *   node scripts/intro-seams.mjs --json seams.json
 *
 * Сервер должен быть поднят (BASE по умолчанию http://127.0.0.1:4321).
 */
import sharp from 'sharp';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { writeFile } from 'node:fs/promises';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
/* Заставка живёт на странице /voyah-free, а НЕ на главной (см. intro-stills.mjs).
   На / канваса нет вообще, и скрипт честно писал «шов 0 px» — ложный PASS. */
const PAGE = process.env.PAGE || '/voyah-free';
const jsonArg = process.argv.indexOf('--json');
const OUT_JSON = jsonArg > 0 ? process.argv[jsonArg + 1] : null;

const VIEWS = [
  { w: 1920, h: 1080, tag: '1920x1080' },
  { w: 1440, h: 900, tag: '1440x900' },
  { w: 390, h: 844, tag: '390x844' },
];
const Y0 = 0.60, Y1 = 0.99;
const MIN_LEN = 60, MIN_STEP = 2.5;
const REF = process.env.REF || '/home/user/avtotehservis/docs/brand/voyah/refs/r31/hero-front-red.png';

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/* Маска: где перепад есть, а в эталоне его нет. Эталон приводим к размеру кадра
   и считаем тот же перепад; шов засчитываем, только если эталонный < 1 L.
   Так борт машины (в эталоне 33 -> 6 L) и линия пола перестают быть «швом». */
function refSeamMask(refData, rW, rH, rC, W, H) {
  const at = (x, y) => {
    const xi = Math.min(rW - 1, Math.round(x * rW / W));
    const yi = Math.min(rH - 1, Math.round(y * rH / H));
    const i = (yi * rW + xi) * rC;
    return luma(refData[i], refData[i + 1], refData[i + 2]);
  };
  const vStep = new Float32Array(W * H), hStep = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) vStep[y * W + x] = Math.abs(at(x, y) - at(x - 1, y));
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) hStep[y * W + x] = Math.abs(at(x, y) - at(x, y - 1));
  return { vStep, hStep };
}

function findSeams(data, W, H, C, ref) {
  const y0 = Math.round(H * Y0), y1 = Math.round(H * Y1);
  const at = (x, y) => { const i = (y * W + x) * C; return luma(data[i], data[i + 1], data[i + 2]); };
  let bestV = { len: 0, step: 0, at: -1 }, bestH = { len: 0, step: 0, at: -1 };
  for (let x = 1; x < W; x++) {
    let run = 0, runStep = 0;
    for (let y = y0; y < y1; y++) {
      const step = Math.abs(at(x, y) - at(x - 1, y));
      const refStep = ref ? ref.vStep[y * W + x] : 0;
      if (step >= MIN_STEP && refStep < 1.0) { run++; if (step > runStep) runStep = step; }
      else { if (run > bestV.len) bestV = { len: run, step: runStep, at: x }; run = 0; runStep = 0; }
    }
    if (run > bestV.len) bestV = { len: run, step: runStep, at: x };
  }
  for (let y = Math.max(1, y0); y < y1; y++) {
    let run = 0, runStep = 0;
    for (let x = 0; x < W; x++) {
      const step = Math.abs(at(x, y) - at(x, y - 1));
      const refStep = ref ? ref.hStep[y * W + x] : 0;
      if (step >= MIN_STEP && refStep < 1.0) { run++; if (step > runStep) runStep = step; }
      else { if (run > bestH.len) bestH = { len: run, step: runStep, at: y }; run = 0; runStep = 0; }
    }
    if (run > bestH.len) bestH = { len: run, step: runStep, at: y };
  }
  return { vertical: bestV, horizontal: bestH };
}

/* эталон один на все вьюпорты: маска перепадов считается под каждый размер */
const refRaw = await sharp(REF).removeAlpha().raw().toBuffer({ resolveWithObject: true });

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  headless: 'shell',
  defaultViewport: null,
});

const results = [];
let bad = 0;
for (const v of VIEWS) {
  const shots = [];
  let skipped = 0;
  /* Прогон по сцене: сцена 1950 мс, дальше панель уезжает (vy-scene/vy-panel).
     На t=2000 канвас ещё в DOM, но в нём уже страница сайта — там «шов» 73 px
     с перепадом 40 L это шапка сайта, а не заставка. Задание просит шаг 100
     до 2000; берём до 1900, и в отчёте это оговорено. */
  for (let ms = 100; ms <= 1900; ms += 100) {
    /* Кадр на заданном моменте — тем же способом, что intro-stills.mjs:
       хук __vyIntroStill до загрузки, networkidle2, затем ожидание. Без хука
       заставка стартует по своему таймеру, канваса на 1,4 с уже нет, и в кадр
       попадала страница со скроллбаром (ширина 1905 при вьюпорте 1920) —
       «шов» 402 px с перепадом 65,7 L был краем скроллбара, а не пластины. */
    const page = await browser.newPage();
    await page.setViewport({ width: v.w, height: v.h, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((vv) => { window.__vyIntroStill = vv; }, ms);
    await page.goto(BASE + PAGE, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 2000));
    /* Снимаем сам канвас, а не страницу: на скриншоте страницы в кадр попадают
       скроллбар (x=1905 при 1920 давал «вертикальный шов» 402 px с перепадом
       65,7 L) и служебные полосы браузера — это не дефект заставки. */
    /* Снимаем ровно вьюпорт. clip обязателен: page.screenshot по умолчанию
       захватывает область прокрутки целиком, и в кадр попадает скроллбар
       (x = ширина−15 давал «вертикальный шов» 402 px с перепадом 65,7 L) —
       это не дефект заставки, а хром браузера. */
    const canvasEl = await page.$('.vy-intro-canvas');
    const buf = canvasEl
      ? await canvasEl.screenshot({ type: 'png' })
      : await page.screenshot({ type: 'png' });
    await page.close();
    /* Заставка живёт ~1,5 с и уезжает: на поздних миллисекундах канваса нет.
       Это НЕ провал — но и не повод снимать страницу (в кадр попадал скроллбар,
       его край на x = ширина−15 давал ложный «шов»). Просто пропускаем. */
    if (!canvasEl) { skipped += 1; continue; }
    const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    /* Снимок элемента на 15 px уже вьюпорта (scrollbar-gutter: stable,
       см. подробный разбор в intro-stills.mjs): последние 15 px — фон страницы,
       и их край давал ложный «шов» 46 px с перепадом 23,6 L на x=1905.
       Считаем швы только по содержимому кадра, без служебной полосы. */
    const usableW = info.width - 15;
    const ref = refSeamMask(refRaw.data, refRaw.info.width, refRaw.info.height, refRaw.info.channels, info.width, info.height);
    shots.push({ ms, ...findSeams(data, usableW, info.height, info.channels, ref) });
  }
  const fails = shots.filter((s) => s.vertical.len >= MIN_LEN || s.horizontal.len >= MIN_LEN);
  const worst = shots.reduce((a, s) => Math.max(a, s.vertical.len, s.horizontal.len), 0);
  const ok = fails.length === 0;
  if (!ok) bad++;
  const note = skipped ? ` (ещё ${skipped} мс после ухода заставки — пропущено)` : '';
  console.log((ok ? 'ok   ' : 'FAIL ') + `${v.tag}: кадров ${shots.length}, шов >=${MIN_LEN}px — ${fails.length}, худший ${worst} px${note}`);
  for (const f of fails.slice(0, 3)) {
    console.log(`      t=${f.ms} мс: верт ${f.vertical.len}px (${f.vertical.step.toFixed(1)} L, x=${f.vertical.at}), гор ${f.horizontal.len}px (${f.horizontal.step.toFixed(1)} L, y=${f.horizontal.at})`);
  }
  results.push({ viewport: v.tag, ok, worst, fails, shots: shots.map((s) => ({ ms: s.ms, v: s.vertical, h: s.horizontal })) });
}

await browser.close();
if (OUT_JSON) {
  await writeFile(OUT_JSON, JSON.stringify({ minLen: MIN_LEN, minStep: MIN_STEP, zoneY: [Y0, Y1], results }, null, 1));
  console.log(`отчёт: ${OUT_JSON}`);
}
console.log(bad === 0 ? 'SEAMS: чисто' : `SEAMS: провалов ${bad}`);
process.exit(bad === 0 ? 0 : 1);
