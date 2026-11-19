import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { robotsTxt } from '../scripts/export-pages.mjs';
import { readPublicPath } from '../scripts/lib/public-path.mjs';

describe('robotsTxt — генерация robots.txt по режиму сборки (круг 88)', () => {
  it('1. превью (дефолтный origin и base="/avtotehservis") → Disallow: /, без Allow: и Sitemap:', () => {
    const txt = robotsTxt({
      publicOrigin: 'https://sledovatel61.github.io',
      base: '/avtotehservis',
    });
    assert.equal(txt, 'User-agent: *\nDisallow: /\n');
    const lines = txt.trim().split('\n');
    assert.ok(lines.includes('User-agent: *'));
    assert.ok(lines.includes('Disallow: /'));
    assert.ok(!txt.includes('Allow:'));
    assert.ok(!txt.includes('Sitemap:'));
  });

  it('2. боевой домен (origin="https://ats-rostov.ru", base="/") → Allow: /, Disallow: /manage, Sitemap и нет Disallow: /', () => {
    const txt = robotsTxt({
      publicOrigin: 'https://ats-rostov.ru',
      base: '/',
    });
    assert.equal(
      txt,
      'User-agent: *\nAllow: /\nDisallow: /manage\n\nSitemap: https://ats-rostov.ru/sitemap.xml\n',
    );
    const lines = txt.split('\n').map((l) => l.trim());
    assert.ok(lines.includes('User-agent: *'));
    assert.ok(lines.includes('Allow: /'));
    assert.ok(lines.includes('Disallow: /manage'));
    assert.ok(lines.includes('Sitemap: https://ats-rostov.ru/sitemap.xml'));
    assert.ok(!lines.includes('Disallow: /'), 'не должно быть строки Disallow: / без /manage');
  });

  it('3. пустые значения (дефолты) → как превью (закрыто)', () => {
    assert.equal(robotsTxt(), 'User-agent: *\nDisallow: /\n');
    assert.equal(robotsTxt({}), 'User-agent: *\nDisallow: /\n');
    assert.equal(robotsTxt({ publicOrigin: '', base: '' }), 'User-agent: *\nDisallow: /\n');
    assert.equal(robotsTxt(readPublicPath({})), 'User-agent: *\nDisallow: /\n');
  });

  it('4. домен, но префикс (origin="https://ats-rostov.ru", base="/avtotehservis") → как превью (закрыто)', () => {
    const txt = robotsTxt({
      publicOrigin: 'https://ats-rostov.ru',
      base: '/avtotehservis',
    });
    assert.equal(txt, 'User-agent: *\nDisallow: /\n');
    assert.ok(!txt.includes('Allow:'));
    assert.ok(!txt.includes('Sitemap:'));
  });

  it('5. артефакт pages-dist/robots.txt (если собран) совпадает с robotsTxt(readPublicPath(...))', () => {
    const pagesDist = path.resolve(import.meta.dirname, '../pages-dist');
    const robotsPath = path.join(pagesDist, 'robots.txt');
    if (!fs.existsSync(robotsPath)) return;

    const actual = fs.readFileSync(robotsPath, 'utf8');
    const cnamePath = path.join(pagesDist, 'CNAME');
    const env = { ...process.env };
    if (!env.PUBLIC_ORIGIN && !env.PUBLIC_BASE_PATH && fs.existsSync(cnamePath)) {
      const host = fs.readFileSync(cnamePath, 'utf8').trim();
      if (host) {
        env.PUBLIC_ORIGIN = `https://${host}`;
        env.PUBLIC_BASE_PATH = '/';
      }
    }
    const expected = robotsTxt(readPublicPath(env));
    assert.equal(actual, expected);
  });
});
