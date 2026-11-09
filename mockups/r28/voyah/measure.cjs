/* Замер мокапа: горизонтальный скролл, шапка (семь пунктов), первый экран, прайс.
   Запуск: node shot.cjs [file|http] — по умолчанию file:// для index.html. */
const puppeteer = require('/tmp/w28/site/node_modules/puppeteer-core');
const path = require('path');
const URLS = {
  page: 'file://' + path.resolve(__dirname, 'index.html'),
  home: 'file://' + path.resolve(__dirname, 'home-section.html'),
  a: 'file://' + path.resolve(__dirname, 'intro-a.html'),
  b: 'file://' + path.resolve(__dirname, 'intro-b.html'),
};
(async () => {
  const b = await puppeteer.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
  const widths = [2560, 1920, 1440, 1360, 1280, 1200, 1024, 768, 390, 360];
  const out = {};
  const scrolls = {};
  /* сначала: горизонтальный скролл на всех четырёх файлах */
  for (const [key, url] of Object.entries(URLS)) {
    scrolls[key] = {};
    for (const w of widths) {
      const pp = await b.newPage();
      await pp.setViewport({ width: w, height: 800 });
      await pp.goto(url, { waitUntil: 'load' });
      await pp.evaluate(async () => { await document.fonts.ready; });
      scrolls[key][w] = await pp.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
      await pp.close();
    }
  }
  out._scroll = scrolls;
  for (const w of widths) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await p.goto(URLS.page, { waitUntil: 'networkidle0' });
    await p.evaluate(async () => { await document.fonts.ready; });
    out[w] = await p.evaluate(() => {
      const inner = document.querySelector('.hdr-in'), cta = document.querySelector('.hdr-cta'),
        nav = document.querySelector('.nav'), h1 = document.querySelector('h1');
      const ib = inner.getBoundingClientRect(), pad = parseFloat(getComputedStyle(inner).paddingRight) || 0;
      const cb = cta.getBoundingClientRect();
      const navLinks = [...document.querySelectorAll('.nav a')];
      const wrapped = navLinks.filter(a => a.getBoundingClientRect().height > 50).length;
      const hid = getComputedStyle(navLinks[0]).display === 'none' || navLinks[0].getBoundingClientRect().width === 0;
      return {
        sw: document.documentElement.scrollWidth, vw: innerWidth,
        hdr: getComputedStyle(document.querySelector('.hdr')).position,
        navVisible: !hid, navItems: navLinks.length, wrapped,
        ctaOver: Math.round(cb.right - (ib.right - pad)),
        ctaRight: Math.round(cb.right), contentRight: Math.round(ib.right - pad),
        h1: Math.round(h1.getBoundingClientRect().height),
        heroBottom: Math.round(document.querySelector('.v-hero').getBoundingClientRect().bottom),
        priceRows: document.querySelectorAll('.v-tbl tbody tr').length,
        details: document.querySelectorAll('.v-faq details').length,
        scrollH: document.documentElement.scrollHeight,
      };
    });
    await p.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
