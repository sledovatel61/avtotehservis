import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { applyRobotsMeta, isPublicProduction, robotsTxt } from '../scripts/export-pages.mjs';

function docWith(html: string): Document {
  return new JSDOM(html).window.document;
}

function robotsMetas(doc: Document): string[] {
  return [...doc.querySelectorAll('meta[name="robots"]')].map((el) => el.getAttribute('content') ?? '');
}

describe('isPublicProduction / applyRobotsMeta — noindex только на превью (круг 89, 135)', () => {
  it('1. боевой домен в корне → production', () => {
    assert.equal(isPublicProduction({ publicOrigin: 'https://ats-rostov.ru', base: '/' }), true);
    assert.equal(isPublicProduction({ publicOrigin: 'https://ats-rostov.ru', base: '' }), true);
  });

  it('2. дефолтный github.io с префиксом → не production', () => {
    assert.equal(
      isPublicProduction({ publicOrigin: 'https://sledovatel61.github.io', base: '/avtotehservis' }),
      false,
    );
  });

  it('3. домен + префикс — ошибка конфигурации, не production', () => {
    assert.equal(isPublicProduction({ publicOrigin: 'https://ats-rostov.ru', base: '/avtotehservis' }), false);
  });

  it('4. пустой origin → не production', () => {
    assert.equal(isPublicProduction({ publicOrigin: '', base: '/' }), false);
    assert.equal(isPublicProduction({}), false);
    assert.equal(isPublicProduction(), false);
  });

  it('5. applyRobotsMeta: production не трогает теги, превью ставит ровно один noindex,nofollow', () => {
    // Документ с исходным index,follow
    const withMeta = docWith(
      '<!doctype html><html><head><meta name="robots" content="index, follow"></head><body></body></html>',
    );
    applyRobotsMeta(withMeta, { production: true });
    assert.deepEqual(robotsMetas(withMeta), ['index, follow']);
    applyRobotsMeta(withMeta, { production: false });
    assert.deepEqual(robotsMetas(withMeta), ['noindex, nofollow']);

    // Документ без мета-тега
    const withoutMeta = docWith('<!doctype html><html><head><title>t</title></head><body></body></html>');
    applyRobotsMeta(withoutMeta, { production: true });
    assert.deepEqual(robotsMetas(withoutMeta), []);
    applyRobotsMeta(withoutMeta, { production: false });
    assert.deepEqual(robotsMetas(withoutMeta), ['noindex, nofollow']);

    // Служебная страница со своим noindex: production сохраняет, превью нормализует к одному
    const service = docWith(
      '<!doctype html><html><head><meta name="robots" content="noindex, nofollow"></head><body></body></html>',
    );
    applyRobotsMeta(service, { production: true });
    assert.deepEqual(robotsMetas(service), ['noindex, nofollow']);
    applyRobotsMeta(service, { production: false });
    assert.deepEqual(robotsMetas(service), ['noindex, nofollow']);
  });

  it('6. robotsTxt на тех же входах не регрессировал', () => {
    assert.equal(
      robotsTxt({ publicOrigin: 'https://ats-rostov.ru', base: '/' }),
      'User-agent: *\nAllow: /\nDisallow: /manage\n\nSitemap: https://ats-rostov.ru/sitemap.xml\n',
    );
    assert.equal(
      robotsTxt({ publicOrigin: 'https://sledovatel61.github.io', base: '/avtotehservis' }),
      'User-agent: *\nDisallow: /\n',
    );
    assert.equal(
      robotsTxt({ publicOrigin: 'https://ats-rostov.ru', base: '/avtotehservis' }),
      'User-agent: *\nDisallow: /\n',
    );
    assert.equal(robotsTxt({ publicOrigin: '', base: '/' }), 'User-agent: *\nDisallow: /\n');
  });

  it('7. артефакт pages-dist (если собран): режим по robots.txt, noindex соответствует режиму', () => {
    const pagesDist = path.resolve(import.meta.dirname, '../pages-dist');
    const robotsPath = path.join(pagesDist, 'robots.txt');
    if (!fs.existsSync(robotsPath)) return;

    const isProd = fs.readFileSync(robotsPath, 'utf8').includes('Allow: /');
    const htmlFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.html')) htmlFiles.push(p);
      }
    };
    walk(pagesDist);
    assert.ok(htmlFiles.length > 0, 'в pages-dist есть HTML');

    for (const file of htmlFiles) {
      const rel = path.relative(pagesDist, file).split(path.sep).join('/');
      if (rel.startsWith('manage/') || rel === '404.html') continue;
      const html = fs.readFileSync(file, 'utf8');
      if (/<meta http-equiv="refresh"/i.test(html)) continue; // заглушки переездов
      const hasNoindex = /<meta name="robots" content="[^"]*noindex/i.test(html);
      if (isProd) {
        assert.ok(!hasNoindex, `${rel}: боевая сборка, а страница закрыта noindex`);
      } else {
        assert.ok(hasNoindex, `${rel}: превью-сборка, а страница без noindex`);
      }
    }
  });
});
