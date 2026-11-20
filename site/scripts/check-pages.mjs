import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { readPublicPath } from './lib/public-path.mjs';
import { isPublicProduction } from './export-pages.mjs';

const root = resolve(import.meta.dirname, '../pages-dist');
const { base, publicOrigin, cnameHost } = readPublicPath(process.env);
/* Круг 89 (135): режим — теми же переменными, что robots.txt и экспорт мета-тегов. */
const production = isPublicProduction({ publicOrigin, base });
const basePrefix = `${base}/`;
let pages = 0;
let links = 0;
async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      assert.ok(!['admin', 'api', 'server', 'data'].includes(entry.name), `Private directory: ${file}`);
      await walk(file);
    } else if (entry.name.endsWith('.html')) {
      pages++;
      const dom = new JSDOM(await readFile(file, 'utf8'));
      assert.equal(dom.window.document.body.dataset.preview, 'true');
      /* Круг 89 (135): дефект «noindex на каждой странице боевой сборки» жил с
         переезда на домен и нашёлся только при приёмке. Гейт: на боевой сборке
         ни одна публичная страница не закрыта от индексации, на превью —
         закрыта каждая. Служебное не проверяем: /manage/** (свой noindex),
         404.html и meta-refresh заглушки переездов (noindex у них намеренный). */
      const rel = file.slice(root.length + 1).split('\\').join('/');
      const isServicePage =
        rel.startsWith('manage/') ||
        rel === '404.html' ||
        Boolean(dom.window.document.querySelector('meta[http-equiv="refresh"]'));
      if (!isServicePage) {
        const robotsMetas = [...dom.window.document.querySelectorAll('meta[name="robots"]')]
          .map((el) => el.getAttribute('content') ?? '');
        if (production) {
          assert.ok(
            !robotsMetas.some((c) => /noindex/i.test(c)),
            `FAIL: боевая сборка закрыта от индексации (meta robots noindex): ${file}`,
          );
        } else {
          assert.ok(
            robotsMetas.some((c) => /noindex/i.test(c)),
            `FAIL: превью-страница без meta robots noindex: ${file}`,
          );
        }
      }
      /* data-img/data-cover: адреса картинок лайтбокса. Гейт не проверял их — из-за этого
         на Pages «увеличенный» сертификат открывался пустой рамкой (путь без базового префикса). */
      for (const el of dom.window.document.querySelectorAll('[href], [src], [poster], [data-img], [data-cover]')) {
        for (const attr of ['href', 'src', 'poster', 'data-img', 'data-cover']) {
          const value = el.getAttribute(attr);
          if (!value?.startsWith('/') || value.startsWith('//')) continue;
          assert.ok(value.startsWith(basePrefix), `Unprefixed URL: ${value} in ${file}`);
          const path = join(root, decodeURIComponent(value.split(/[?#]/)[0].slice(basePrefix.length)));
          assert.ok(await exists(path) || await exists(join(path, 'index.html')), `Broken link: ${value} in ${file}`);
          links++;
        }
      }
      for (const el of dom.window.document.querySelectorAll('[srcset]')) {
        for (const part of (el.getAttribute('srcset') || '').split(',')) {
          const value = part.trim().split(/\s+/)[0];
          if (!value.startsWith('/') || value.startsWith('//')) continue;
          assert.ok(value.startsWith(basePrefix), `Unprefixed srcset URL: ${value} in ${file}`);
          const path = join(root, decodeURIComponent(value.slice(basePrefix.length)));
          assert.ok(await exists(path), `Broken srcset asset: ${value} in ${file}`);
          links++;
        }
      }
      dom.window.close();
    } else if (entry.name.endsWith('.js')) {
      /* Круг 31: адреса картинок, собранные В САМОМ JS (заставка берёт постер и текстуру
         знака в рантайме), префикс не получали — на Pages они отдавали 404, и заставка
         рисовалась без эмблемы. Проверяем только каталоги ассетов: `/api/...` на статике
         всё равно не работает, его отсутствие — не регресс публикации. */
      const js = await readFile(file, 'utf8');
      for (const m of js.matchAll(/(["'`])(\/(?:img|fonts|audio|video|media)\/[^"'`$\s]*)/g)) {
        const value = m[2];
        assert.ok(value.startsWith(basePrefix), `Unprefixed JS asset: ${value} in ${file}`);
        const path = join(root, decodeURIComponent(value.slice(basePrefix.length)));
        assert.ok(await exists(path), `Broken JS asset: ${value} in ${file}`);
        links++;
      }
    } else if (entry.name.endsWith('.css')) {
      /* РАУНД 17 / приёмка: регресс на главный дефект круга — фон секции ссылался на /img/…
         без префикса и на Pages отдавал 404. Проверяем ОБА вида ссылок: url(…) и
         image-set("/img/…") — второй появляется после минцификации @supports. */
      const css = await readFile(file, 'utf8');
      const refs = [
        ...[...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]),
        ...[...css.matchAll(/image-set\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
        ...[...css.matchAll(/,\s*["']([^"']+\.(?:avif|webp|png|jpe?g|svg|woff2?))["']/g)].map((m) => m[1]),
      ];
      for (const value of refs) {
        const rootRelative = value.startsWith('/') && !value.startsWith('//');
        if (!rootRelative) continue;                  // data:, http(s):, относительные — не наши
        assert.ok(value.startsWith(basePrefix), `Unprefixed CSS asset: ${value} in ${file}`);
        const path = join(root, decodeURIComponent(value.slice(basePrefix.length)));
        assert.ok(await exists(path), `Broken CSS asset: ${value} in ${file}`);
        links++;
      }
    }
  }
}
await walk(root);

const cnamePath = join(root, 'CNAME');
if (cnameHost) {
  assert.ok(await exists(cnamePath), `Missing pages-dist/CNAME for custom domain ${cnameHost}`);
  assert.equal((await readFile(cnamePath, 'utf8')).trim(), cnameHost, 'CNAME content mismatch');
} else {
  assert.ok(!(await exists(cnamePath)), 'Unexpected pages-dist/CNAME for default github.io origin');
}

// /manage/ доступна по прямой ссылке для владельца, но не должна индексироваться.
const manageDir = join(root, 'manage');
const manageIndex = join(manageDir, 'index.html');
assert.ok(await exists(manageIndex), 'Missing pages-dist/manage/index.html');
const manageHtml = await readFile(manageIndex, 'utf8');
const manageDom = new JSDOM(manageHtml);
const robots = manageDom.window.document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '';
assert.match(robots, /noindex/i, 'Manage page must contain robots noindex');
manageDom.window.close();
async function assertNoAdminReferences(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await assertNoAdminReferences(file);
    else {
      const text = await readFile(file, 'utf8');
      assert.ok(!/(?:href|src|action)\s*=\s*["'][^"']*\/admin(?:[/?#"']|$)/i.test(text), `Manage asset references /admin: ${file}`);
      assert.ok(!/(?:https?:[^\s"']+)?\/admin(?:[/?#"']|$)/i.test(text), `Manage asset contains /admin URL: ${file}`);
    }
  }
}
await assertNoAdminReferences(manageDir);

// Страницы опубликованных кейсов должны содержать реальные фото, а не старые иллюстрации.
const casesFile = JSON.parse(await readFile(resolve(import.meta.dirname, '../content/cases.json'), 'utf8'));
assert.equal(casesFile.version, 1, 'cases.json version must be 1');
assert.ok(Array.isArray(casesFile.cases), 'cases.json cases must be an array');
const sitemapPath = join(root, 'sitemap.xml');
assert.ok(await exists(sitemapPath), 'Missing pages-dist/sitemap.xml');
const sitemap = await readFile(sitemapPath, 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1].replace(/&amp;/g, '&'));
assert.ok(sitemapUrls.length, 'sitemap.xml contains no loc entries');
const sitemapUrlObjects = sitemapUrls.map((value) => new URL(value));
const homePath = sitemapUrlObjects
  .map((url) => url.pathname)
  .filter((pathname) => pathname.endsWith('/'))
  .sort((a, b) => a.length - b.length)[0] ?? '/';
const basePath = homePath.replace(/\/+$/, '');
function routeFromSitemap(value) {
  let pathname = decodeURIComponent(new URL(value).pathname);
  if (basePath && pathname === basePath) pathname = '';
  else if (basePath && pathname.startsWith(`${basePath}/`)) pathname = pathname.slice(basePath.length);
  return pathname.replace(/^\/+|\/+$/g, '');
}
function outputPageForSitemapUrl(value) {
  const route = routeFromSitemap(value);
  return route ? join(root, route, 'index.html') : join(root, 'index.html');
}
function lastRouteSegment(value) {
  const route = routeFromSitemap(value);
  return route.split('/').filter(Boolean).at(-1) ?? '';
}
for (const item of casesFile.cases.filter((entry) => entry?.status === 'published')) {
  const slug = String(item.slug ?? '');
  assert.match(slug, /^[a-z0-9-]{3,60}$/, 'Published case must have a safe slug');
  const listedUrls = sitemapUrls.filter((value) => lastRouteSegment(value) === slug);
  assert.ok(listedUrls.length, `${slug}: published work is missing from sitemap.xml`);
  const candidates = [];
  for (const value of listedUrls) {
    const file = outputPageForSitemapUrl(value);
    if (await exists(file)) candidates.push({ value, file, html: await readFile(file, 'utf8') });
  }
  const casePath = `/media/cases/${slug}/`;
  const page = candidates.find(({ html }) => html.includes(casePath));
  assert.ok(page, `${slug}: no sitemap-linked page with this work's media was found`);
  const dom = new JSDOM(page.html);
  const srcsets = [...dom.window.document.querySelectorAll('[srcset]')].map((el) => el.getAttribute('srcset') ?? '');
  const hasThreeWidths = srcsets.some((srcset) => {
    const widths = new Set(srcset.split(',').map((part) => part.trim().match(/(?:^|\s)(480|960|1600)w$/)?.[1]).filter(Boolean));
    return ['480', '960', '1600'].every((width) => widths.has(width));
  });
  assert.ok(hasThreeWidths, `${slug}: no srcset containing 480w, 960w and 1600w`);
  for (const el of dom.window.document.querySelectorAll('[src], [srcset], [data-img], [data-cover]')) {
    for (const attr of ['src', 'srcset', 'data-img', 'data-cover']) {
      const value = el.getAttribute(attr) ?? '';
      assert.ok(!/(?:^|\/)img\/ab-case-[^/?#\s]*/i.test(value), `${slug}: legacy illustration used instead of case photo: ${value}`);
    }
  }
  dom.window.close();
}

assert.ok(pages >= 9);
console.log(`PASS: ${pages} pages, ${links} local links/assets; manage is noindex; published cases and sitemap checked.`);