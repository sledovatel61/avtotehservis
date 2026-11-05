/* Круг 26 (задание №30): гейт страницы «Прайс» (/prices).
   Входы: собранный HTML site/pages-dist/prices/index.html, отдаётся локальным probe-сервером
   (base /avtotehservis срезается), рендер ТОЛЬКО Chromium (puppeteer-core 23 +
   @sparticuz/chromium 131, standing R20: sharp-моки рендером не считаются).
   Проверки:
     P1 структура: 6 групп-якорей (#to #tormoza #podveska #grm #diagnostika #shiny),
        8 таблиц .price-tbl, sticky-навигация из 6 ссылок, JSON-LD FAQPage + BreadcrumbList,
        4 вопроса FAQ, 5 сносок в .price-foot;
     P2 390 px: documentElement.scrollWidth ≤ 391 (страница не растягивается), у каждого
        .price-wrap overflow-x auto|scroll и при переполнении таблицы скролл доступен
        (scrollWidth ≥ clientWidth), правый край обёрток в пределах вьюпорта;
     P3 768/1024/1440: страница без горизонтального переполнения, таблицы видимы;
     P4 цифры прайса из a7/02 присутствуют в HTML (выборочные строки, сверенные с фото прайсов).
   --self-test: 4 мутанта (скрытый скролл, видимый скролл, растянутая группа, пропавший якорь),
   каждый обязан ронять гейт.
   Запуск: node scripts/check-price-tables.mjs [--self-test] */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'site', 'pages-dist');
const SITE = join(ROOT, 'site');
const PORT = 4327;

const ANCHORS = ['to', 'tormoza', 'podveska', 'grm', 'diagnostika', 'shiny'];
/* выборочные цифры a7/02, сверенные с фотографиями прайсов владельца (круг 26) */
const PRICES_SPOT = ['15 000', '3500–4500', '5000–6000', '6000–7000', '12 000–16 000',
  '2200', '3600', '2000–2500', '8000–9000', '500'];

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.startsWith('/avtotehservis')) p = p.slice('/avtotehservis'.length) || '/';
  const file = join(DIST, p === '/' ? 'index.html' : /\.[a-z0-9]+$/i.test(p) ? p : join(p, 'index.html'));
  try {
    const b = await readFile(file);
    res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.avif') ? 'image/avif' : file.endsWith('.webp') ? 'image/webp' : 'application/octet-stream');
    res.end(b);
  } catch { res.statusCode = 404; res.end('nf'); }
});

export async function checkPriceTables(opts = {}) {
  const fails = [];
  const htmlPath = join(DIST, 'prices', 'index.html');
  let html;
  try { html = (await readFile(htmlPath)).toString('utf8'); }
  catch { return { ok: false, fails: ['P1 нет собранного /prices (pages-dist/prices/index.html)'] }; }

  /* P1 структура */
  for (const a of ANCHORS) if (!html.includes(`id="${a}"`)) fails.push(`P1 нет якоря #${a}`);
  const tables = (html.match(/class="price-tbl"/g) || []).length;
  if (tables !== 8) fails.push(`P1 таблиц .price-tbl ${tables} ≠ 8`);
  const navLinks = (html.match(/class="price-nav-a" href="#/g) || []).length;
  if (navLinks !== 6) fails.push(`P1 ссылок в price-nav ${navLinks} ≠ 6`);
  /* JSON-LD в pages-dist не переносится export-pages (JSDOM теряет ld+json на всех
     страницах — см. about/index.html), поэтому проверяем разметку-источник: массив jsonLd
     в prices.astro обязан содержать FAQPage и BreadcrumbList; в SSR-HTML он попадает. */
  const astro = readFileSync(join(SITE, 'src', 'pages', 'prices.astro'), 'utf8');
  if (!astro.includes('FAQPage')) fails.push('P1 нет JSON-LD FAQPage в prices.astro');
  if (!astro.includes('BreadcrumbList')) fails.push('P1 нет JSON-LD BreadcrumbList в prices.astro');
  const faq = (html.match(/<details class="ab-acc"/g) || []).length;
  if (faq !== 4) fails.push(`P1 вопросов FAQ ${faq} ≠ 4`);
  const foot = (html.match(/<li>[^<]*<\/li>/g) || []).length;
  if (!/price-foot/.test(html) || foot < 5) fails.push(`P1 сносок в .price-foot ${foot} < 5`);

  /* P4 цифры a7 */
  for (const s of PRICES_SPOT) if (!html.includes(s)) fails.push(`P4 нет цифры прайса «${s}»`);

  if (opts.skipRender) return { ok: fails.length === 0, fails };

  /* P2/P3 рендер */
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
    args: [...chromium.args, '--no-sandbox'], headless: 'shell',
    env: { ...process.env, LD_LIBRARY_PATH: `/tmp/nss-libs:/tmp/nss-libs:/tmp/al2023-libs/lib:/tmp/al2-libs/lib:${process.env.LD_LIBRARY_PATH || ''}` },
    protocolTimeout: 300000 });
  try {
    for (const w of [390, 768, 1024, 1440]) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 1 });
      if (opts.mutate) await page.evaluateOnNewDocument(opts.mutate);
      await page.goto(`http://127.0.0.1:${PORT}/prices/`, { waitUntil: 'networkidle0' });
      await page.evaluate(async () => {
        const st = document.createElement('style');
        st.textContent = '.reveal{opacity:1 !important;transform:none !important;transition:none !important}';
        document.head.appendChild(st);
        await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 6000))]);
      });
      const g = await page.evaluate(() => {
        const de = document.documentElement;
        const wraps = [...document.querySelectorAll('.price-wrap')].map((el) => {
          const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
          return { ox: cs.overflowX, sw: el.scrollWidth, cw: el.clientWidth, right: r.right };
        });
        const nav = document.querySelector('.price-nav');
        const tbls = [...document.querySelectorAll('.price-tbl')].map((t) => t.getBoundingClientRect().width);
        const anchors = ['to', 'tormoza', 'podveska', 'grm', 'diagnostika', 'shiny']
          .filter((id) => !document.getElementById(id));
        return { scrollW: de.scrollWidth, innerW: window.innerWidth, wraps, navPos: nav ? getComputedStyle(nav).position : 'none', tbls, anchors };
      });
      if (g.scrollW > g.innerW + 1) fails.push(`P2 ${w}px: scrollWidth ${g.scrollW} > ${g.innerW} (страница растянута)`);
      if (w === 390) for (const id of g.anchors) fails.push(`P1 в DOM нет якоря #${id}`);
      if (w === 390) {
        if (g.scrollW > 391) fails.push(`P2 390px: scrollWidth ${g.scrollW} > 391`);
        for (const [i, wr] of g.wraps.entries()) {
          if (wr.ox !== 'auto' && wr.ox !== 'scroll') fails.push(`P2 390px: .price-wrap[${i}] overflow-x=${wr.ox} (не auto/scroll)`);
          if (wr.sw > wr.cw + 1 && wr.ox === 'hidden') fails.push(`P2 390px: .price-wrap[${i}] переполнен при overflow hidden`);
          if (wr.right > 391) fails.push(`P2 390px: .price-wrap[${i}] right=${wr.right.toFixed(0)} > 391`);
        }
      }
      if (w === 1440 && g.navPos !== 'sticky') fails.push(`P3 1440px: .price-nav position=${g.navPos} ≠ sticky`);
      if (g.tbls.some((tw) => tw <= 0)) fails.push(`P3 ${w}px: невидимая таблица`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { ok: fails.length === 0, fails };
}

/* ---------------- self-test ---------------- */
const MUTANTS = [
  ['1-скролл-скрыт', '.price-wrap{overflow-x:hidden !important}'],
  ['2-скролл-видимый-растягивает', '.price-wrap{overflow-x:visible !important}'],
  ['3-группа-шире-вьюпорта', '.price-grp{min-width:820px !important}'],
  ['4-якорь-грм-исчез', null, () => { document.querySelectorAll('#grm, [id="grm"]').forEach((e) => e.remove()); }],
];

async function selfTest() {
  const base = await checkPriceTables({});
  if (!base.ok) {
    console.log('check-price-tables: self-test — базовый прогон НЕ чист:');
    base.fails.forEach((f) => console.log('  ' + f));
    process.exit(1);
  }
  let fell = 0;
  for (const [name, css, fn] of MUTANTS) {
    /* evaluateOnNewDocument стартует ДО появления <head> — вешаем мутацию на
       documentElement с фолбэком на DOMContentLoaded */
    const mutate = fn
      ? `(() => { const run = ${fn.toString()}; if (document.body) run(); else document.addEventListener('DOMContentLoaded', run); })()`
      : `(() => { const run = () => { const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; (document.head || document.documentElement).appendChild(st); }; if (document.head) run(); else document.addEventListener('DOMContentLoaded', run); })()`;
    const r = await checkPriceTables({ mutate });
    if (r.ok) console.log(`МУТАНТ ВЫЖИЛ: ${name}`);
    else { fell++; console.log(`ok   ${name}: гейт упал (${r.fails[0]})`); }
  }
  if (fell !== MUTANTS.length) { console.log(`check-price-tables: ${fell}/${MUTANTS.length} мутантов — self-test провален`); process.exit(1); }
  console.log(`check-price-tables: ${fell}/${MUTANTS.length} мутантов роняют гейт, база чиста`);
}

if (process.argv[1] && process.argv[1].endsWith('check-price-tables.mjs')) {
  if (process.argv.includes('--self-test')) await selfTest();
  else {
    const r = await checkPriceTables();
    if (!r.ok) { r.fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1); }
    console.log('check-price-tables: OK — структура, 390px без растяжения, sticky-навигация, цифры a7');
  }
}
