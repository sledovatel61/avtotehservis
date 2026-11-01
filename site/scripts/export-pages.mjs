/** Render the existing SSR site against an isolated demo DB; publish HTML/assets only. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { JSDOM } from 'jsdom';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'pages-dist');
const temp = await mkdtemp(join(tmpdir(), 'ats-pages-'));
const base = '/avtotehservis';
const publicOrigin = 'https://sledovatel61.github.io';
const port = process.env.PREVIEW_PORT || '4337';
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_DIR: join(temp, 'data'), MEDIA_DIR: join(temp, 'media'), PUBLIC_SITE_URL: publicOrigin, HOST: '127.0.0.1', PORT: port };
const run = (args) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${args.join(' ')} exited ${code}`)));
});
let server;
try {
  await run(['scripts/migrate.ts']);
  await run(['scripts/seed.ts']);
  await run(['scripts/seed-demo.ts']);
  await run(['node_modules/astro/bin/astro.mjs', 'build']);
  server = spawn(process.execPath, ['dist/server/entry.mjs'], { cwd: root, env, stdio: 'inherit' });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error('Preview server did not start');
  await rm(output, { recursive: true, force: true });
  await cp(join(root, 'dist/client'), output, { recursive: true });
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  const routes = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  if (!routes.includes('/') || routes.length < 8) throw new Error('Incomplete sitemap');
  const prefix = (value) => value.startsWith('/') && !value.startsWith('//') ? base + value : value;
  for (const route of [...new Set([...routes, '/404'])]) {
    const response = await fetch(origin + route);
    if (!response.ok && route !== '/404') throw new Error(`Failed page: ${route} (${response.status})`);
    const dom = new JSDOM(await response.text());
    const doc = dom.window.document;
    doc.body.dataset.preview = 'true';
    doc.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove());
    const robots = doc.createElement('meta');
    robots.name = 'robots'; robots.content = 'noindex, nofollow'; doc.head.append(robots);
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => el.remove());
    for (const el of doc.querySelectorAll('[href], [src], [poster], [srcset]')) {
      for (const attr of ['href', 'src', 'poster']) {
        const value = el.getAttribute(attr);
        if (value) el.setAttribute(attr, prefix(value));
      }
      const srcset = el.getAttribute('srcset');
      if (srcset) el.setAttribute('srcset', srcset.replace(/(^|,\s*)(\/[^/])/g, `$1${base}$2`));
    }
    for (const el of doc.querySelectorAll('link[rel="canonical"], meta[property="og:url"]')) {
      el.setAttribute(el.tagName === 'LINK' ? 'href' : 'content', publicOrigin + base + (route === '/' ? '/' : route));
    }
    for (const el of doc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) {
      el.setAttribute('content', publicOrigin + base + '/img/og.png');
    }
    doc.querySelectorAll('a[href*="/admin"]').forEach((el) => el.remove());
    doc.querySelectorAll('input[type="file"]').forEach((el) => { el.disabled = true; });
    const notice = doc.createElement('p');
    /* раунд 15: плашка — отдельной полосой НАД шапкой (фон --deep, свой отступ),
       иначе её вторая строка наезжает на меню на 1024–1279 px */
    notice.className = 'demo-notice container';
    notice.textContent = 'Демонстрационная версия для согласования. Заявки и сообщения не отправляются. Время записи — пример.';
    const header = doc.querySelector('header');
    if (header) header.parentNode?.insertBefore(notice, header); else doc.querySelector('main')?.prepend(notice);
    const file = route === '/404' ? join(output, '404.html') : join(output, route.slice(1), 'index.html');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, dom.serialize());
    dom.window.close();
  }
  async function fixCss(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await fixCss(path);
      else if (entry.name.endsWith('.css')) {
        const css = await readFile(path, 'utf8');
        /* РАУНД 17 / приёмка: минцификатор переписывает declaration внутри @supports в
           image-set("/img/x.avif" 1x type("image/avif")) — без url(), поэтому прежняя
           замена промахивалась и фон секции 404-ился на Pages. Префиксуем оба вида. */
        const fixed = css
          .replace(/url\((["']?)\/(?!\/)/g, `url($1${base}/`)
          .replace(/(image-set\(\s*)(["'])\/(?!\/)/g, `$1$2${base}/`)
          .replace(/(,\s*)(["'])\/(?!\/)(?=[^"']*\.(?:avif|webp|png|jpe?g|svg|woff2?)["'])/g, `$1$2${base}/`);
        await writeFile(path, fixed);
      }
    }
  }
  await fixCss(output);
  await writeFile(join(output, '.nojekyll'), '');
  await writeFile(join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  console.log(`Exported ${routes.length} public pages + 404 to ${output}`);
} finally {
  if (server) {
    server.kill();
    await new Promise((r) => server.once('exit', r));
  }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}