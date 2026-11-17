/* Скриншоты мокапа: страница (1440/390), секция главной, два интро (кадр в середине сцены),
   шапка с семью пунктами (1440/1024) и мобильное меню (390).
   Запуск: node shot.cjs   → shots/*.png */
const puppeteer = require('/tmp/w28/site/node_modules/puppeteer-core');
const path = require('path');
const dir = __dirname;
const F = (f) => 'file://' + path.join(dir, f);
const shots = path.join(dir, 'shots');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });

  const open = async (url, w, h = 900, dpr = 1) => {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
    await p.goto(url, { waitUntil: 'networkidle0' });
    await p.evaluate(async () => { await document.fonts.ready; });
    // прогрев изображений, чтобы на скриншоте не было «пустых» мест
    await p.evaluate(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; i.decoding = 'sync'; });
      for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); }
      scrollTo(0, 0); await new Promise(r => setTimeout(r, 300));
    });
    return p;
  };

  /* 1. Страница /voyah-free, первый экран 1440 */
  let p = await open(F('index.html'), 1440, 950);
  await p.screenshot({ path: `${shots}/page-1440-hero.png` });
  /* полный экран страницы 1440 — одним длинным кадром (для README — миниатюра) */
  await p.screenshot({ path: `${shots}/page-1440-full.png`, fullPage: true });
  await p.close();

  /* 2. Страница 390 — первый экран + полная */
  p = await open(F('index.html'), 390, 844, 2);
  await p.screenshot({ path: `${shots}/page-390-hero.png` });
  await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.querySelector('#price').offsetTop - 80); });
  await sleep(400);
  await p.screenshot({ path: `${shots}/page-390-price.png` });
  await p.close();
  p = await open(F('index.html'), 390, 844, 1);
  await p.screenshot({ path: `${shots}/page-390-full.png`, fullPage: true });
  await p.close();

  /* 3. Секция главной */
  p = await open(F('home-section.html'), 1440, 900);
  await p.screenshot({ path: `${shots}/home-section-1440.png`, fullPage: true });
  await p.close();
  p = await open(F('home-section.html'), 390, 844, 2);
  await p.screenshot({ path: `${shots}/home-section-390.png` });
  await p.close();

  /* 4. Шапка с семью пунктами: 1440 и 1024 */
  for (const w of [1440, 1024]) {
    p = await open(F('index.html'), w, 620);
    await p.screenshot({ path: `${shots}/header-${w}.png`, clip: { x: 0, y: 0, width: w, height: 112 } });
    await p.close();
  }
  /* мобильное меню: 390, открыть бургер */
  p = await open(F('index.html'), 390, 844, 2);
  await p.click('#burger');
  await sleep(400);
  await p.screenshot({ path: `${shots}/header-390-menu.png` });
  await p.close();

  /* 5. Интро: кадр в середине сцены (~1,2 с) */
  const introShot = async (file, out, ms) => {
    const pp = await b.newPage();
    await pp.setViewport({ width: 1440, height: 900 });
    /* кадр считаем от старта сцены: сеть и шрифты съедают время, и «1,9 с» уезжало
       в момент, когда интро уже ушло */
    await pp.goto(F(file) + '?replay', { waitUntil: 'domcontentloaded' });
    await pp.evaluate(async () => { document.documentElement.style.scrollBehavior='auto'; await document.fonts.ready; });
    const spent = await pp.evaluate(() => performance.now());
    await sleep(Math.max(0, ms - spent));
    await pp.screenshot({ path: `${shots}/${out}` });
    await pp.close();
  };
  await introShot('intro-a.html', 'intro-a-1200ms.png', 1200);
  await introShot('intro-a.html', 'intro-a-1900ms.png', 1900);
  await introShot('intro-b.html', 'intro-b-900ms.png', 900);
  await introShot('intro-b.html', 'intro-b-1600ms.png', 1600);

  await b.close();
  console.log('shots: ok');
})();
