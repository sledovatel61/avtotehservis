import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const DIST = join(process.cwd(), 'pages-dist');
const OUT = join(process.cwd(), '..', 'evaluation', 'assets', 'r26');
await mkdir(OUT, { recursive: true });
const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.startsWith('/avtotehservis')) p = p.slice('/avtotehservis'.length) || '/';
  const file = join(DIST, p === '/' ? 'index.html' : /\.[a-z0-9]+$/i.test(p) ? p : join(p, 'index.html'));
  try { const b = await readFile(file);
    res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.avif') ? 'image/avif' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
    res.end(b); } catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise(r => server.listen(4335, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox'], headless: 'shell',
  env: { ...process.env, LD_LIBRARY_PATH: `/tmp/nss-libs:${process.env.LD_LIBRARY_PATH || ''}` },
  protocolTimeout: 600000 });
const PAGES = [['index','/'],['about','/about/'],['services','/services/'],['services-shinomontazh','/services/shinomontazh/'],['prices','/prices/'],['garantii','/garantii/'],['news','/news/'],['news-article','/news/remen-grm-kogda-menat/'],['contacts','/contacts/'],['appointment','/appointment/']];
for (const w of [1440, 390]) {
  for (const [name, path] of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 1 });
    await page.goto('http://127.0.0.1:4335' + path, { waitUntil: 'networkidle0' });
    await page.evaluate(async () => {
      const st = document.createElement('style');
      st.textContent = '.reveal{opacity:1 !important;transform:none !important;transition:none !important}';
      document.head.appendChild(st);
      await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 6000))]);
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
      await Promise.race([Promise.all([...document.images].map(i => i.decode().catch(() => {}))), new Promise(r => setTimeout(r, 8000))]);
      window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 200));
    });
    await page.screenshot({ path: join(OUT, `${name}-${w}.png`), fullPage: true });
    await page.close();
    console.log(`shot ${name}-${w}`);
  }
}
await browser.close(); server.close();
console.log('r26 shots done');
