import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  NEWS_CATEGORIES,
  NEWS_CATEGORY_SLUGS,
  draftItems,
  parseNewsDoc,
  publishedItems,
  validateNewsItem,
  type NewsDoc,
  type NewsItem,
} from '../src/shared/news-schema.ts';
import {
  coverInfo,
  getNews,
  listNews,
  newsCategoryCounts,
  newsCategoryPages,
  newsTotal,
  otherNews,
  readNewsDoc,
  resetNewsCache,
} from '../src/server/news-store.ts';
import { getPrices } from '../src/server/prices-store.ts';
import { GET as getSitemap } from '../src/pages/sitemap.xml.ts';

const VALID_BODY =
  '# Заголовок раздела статьи\n\n' +
  'Подробный текст статьи про техническое обслуживание и диагностику автомобиля в автосервисе на Портовой, 439. '.repeat(
    3,
  );

function makeItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    slug: 'testovaya-statya-1',
    title: 'Тестовая статья про обслуживание автомобиля',
    seo_title: null,
    excerpt: 'Короткое описание тестовой статьи для карточки в списке и мета-тега description.',
    category: 'sovety',
    body_md: VALID_BODY,
    cover: null,
    cover_static: '/img/news-1.svg',
    status: 'published',
    published_at: '2026-11-18 10:00',
    updated_at: '2026-11-18 10:00',
    ...overrides,
  };
}

describe('news-schema, news-store и check-news (круг 89)', () => {
  const origNewsFile = process.env.NEWS_FILE;

  afterEach(() => {
    if (origNewsFile === undefined) delete process.env.NEWS_FILE;
    else process.env.NEWS_FILE = origNewsFile;
    resetNewsCache();
  });

  it('1. site/content/news.json читается: 15 статей, все published, категории из NEWS_CATEGORIES, slug-и уникальны', () => {
    delete process.env.NEWS_FILE;
    resetNewsCache();

    const { doc, errors } = readNewsDoc();
    assert.deepEqual(errors, []);
    assert.equal(doc.version, 1);
    assert.equal(doc.items.length, 15);

    const allowedCats = new Set<string>(NEWS_CATEGORY_SLUGS);
    const slugs = new Set<string>();
    for (const item of doc.items) {
      assert.equal(item.status, 'published');
      assert.ok(allowedCats.has(item.category), `категория ${item.category} входит в NEWS_CATEGORIES (${NEWS_CATEGORIES.map((c) => c.slug).join(', ')})`);
      assert.ok(!slugs.has(item.slug), `slug ${item.slug} уникален`);
      slugs.add(item.slug);
    }
    assert.equal(slugs.size, 15);
    assert.equal(newsTotal(), 15);
  });

  it('2. fillPrices применён: плейсхолдеры {{price:…}} в title/excerpt/body_md заменяются суммами из prices.json', () => {
    const prices = getPrices();
    const firstGroupItem = prices.groups[0]?.items[0];
    assert.ok(firstGroupItem, 'в prices.json есть хотя бы одна позиция');
    const priceKey = firstGroupItem.id;
    const expectedPrice = firstGroupItem.price;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-prices-'));
    try {
      const file = path.join(tmpDir, 'news.json');
      const doc: NewsDoc = {
        version: 1,
        updated_at: '2026-11-21T09:00:00.000Z',
        items: [
          makeItem({
            slug: 'statya-s-cenoy',
            title: `Стоимость работы — {{price:${priceKey}}}`,
            excerpt: `Кратко: работа стоит {{price:${priceKey}}} по актуальному прайсу.`,
            body_md: `${VALID_BODY}\n\nЦена по прайсу: {{price:${priceKey}}}.`,
          }),
        ],
      };
      fs.writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');
      process.env.NEWS_FILE = file;
      resetNewsCache();

      const item = getNews('statya-s-cenoy');
      assert.ok(item);
      assert.ok(!item.title.includes('{{price:'));
      assert.ok(!item.excerpt.includes('{{price:'));
      assert.ok(!item.body_md.includes('{{price:'));
      assert.ok(item.title.includes(expectedPrice));
      assert.ok(item.excerpt.includes(expectedPrice));
      assert.ok(item.body_md.includes(expectedPrice));

      // И в штатном файле все 15 статей выдаются без сырых {{price:...}}
      delete process.env.NEWS_FILE;
      resetNewsCache();
      for (const n of listNews({ per: 100 }).items) {
        assert.ok(!n.title.includes('{{price:'), `в title ${n.slug} нет сырого {{price:`);
        assert.ok(!n.excerpt.includes('{{price:'), `в excerpt ${n.slug} нет сырого {{price:`);
        assert.ok(!n.body_md.includes('{{price:'), `в body_md ${n.slug} нет сырого {{price:`);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('3. черновик (status: "draft") отсутствует в listNews, newsTotal, sitemap-наборе и карте категорий', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-draft-'));
    try {
      const file = path.join(tmpDir, 'news.json');
      const doc: NewsDoc = {
        version: 1,
        updated_at: '2026-11-21T09:00:00.000Z',
        items: [
          makeItem({
            slug: 'opublikovannaya-statya',
            category: 'sovety',
            status: 'published',
            published_at: '2026-11-18 10:00',
            updated_at: '2026-11-20 12:00',
          }),
          makeItem({
            slug: 'sekretnyy-chernovik',
            category: 'servis',
            status: 'draft',
            published_at: null,
            updated_at: '2026-11-19 15:00',
          }),
        ],
      };
      fs.writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');
      process.env.NEWS_FILE = file;
      resetNewsCache();

      assert.equal(publishedItems(doc).length, 1);
      assert.equal(draftItems(doc).length, 1);
      assert.equal(newsTotal(), 1);
      const listed = listNews({ per: 50 });
      assert.equal(listed.total, 1);
      assert.deepEqual(
        listed.items.map((i) => i.slug),
        ['opublikovannaya-statya'],
      );
      assert.equal(getNews('sekretnyy-chernovik'), undefined);

      const counts = newsCategoryCounts();
      assert.equal(counts.sovety, 1);
      assert.equal(counts.servis ?? 0, 0);
      assert.equal(newsCategoryPages('sovety', 6), 1);
      assert.equal(newsCategoryPages('servis', 6), 0);

      // Проверим sitemap.xml: опубликованная есть с lastmod из updated_at, черновика нет
      const res = await getSitemap({ site: new URL('https://ats-rostov.ru') } as any);
      const xml = await res.text();
      assert.ok(xml.includes('<loc>https://ats-rostov.ru/news/opublikovannaya-statya</loc><lastmod>2026-11-20</lastmod>'));
      assert.ok(!xml.includes('sekretnyy-chernovik'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. parseNewsDoc бросает ошибку с внятным русским текстом на дубль slug, seo_title > 60, published без published_at, cover + cover_static одновременно', () => {
    // 4a. Дубль slug
    assert.throws(
      () =>
        parseNewsDoc({
          version: 1,
          updated_at: '2026-11-21T09:00:00.000Z',
          items: [makeItem({ slug: 'odinakovyy-slug' }), makeItem({ slug: 'odinakovyy-slug' })],
        }),
      /дубль slug «odinakovyy-slug»/,
    );

    // 4b. seo_title 61 символ
    assert.throws(
      () => validateNewsItem(makeItem({ seo_title: 'А'.repeat(61) })),
      /seo_title.*максимум 60/,
    );

    // 4c. status: 'published' без published_at
    assert.throws(
      () => validateNewsItem(makeItem({ status: 'published', published_at: null })),
      /published_at.*обязательна дата/,
    );

    // 4d. cover и cover_static одновременно
    assert.throws(
      () =>
        validateNewsItem(
          makeItem({
            cover: {
              base: 'ab12cd-cover',
              w: 1600,
              h: 900,
              ext: 'webp',
              alt: 'Описание кадра обложки статьи',
            },
            cover_static: '/img/news-1.svg',
          }),
        ),
      /cover и cover_static взаимоисключающие/,
    );
  });

  it('5. битый JSON не роняет listNews (отдаёт пустой список), но parseNewsDoc и check-news.mjs на нём падают', () => {
    assert.throws(() => parseNewsDoc('{ broken json'), /JSON не разобран/);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-broken-'));
    try {
      const brokenPath = path.join(tmpDir, 'broken-news.json');
      fs.writeFileSync(brokenPath, '{ broken json', 'utf8');
      process.env.NEWS_FILE = brokenPath;
      resetNewsCache();

      const res = listNews();
      assert.deepEqual(res.items, []);
      assert.equal(res.total, 0);
      assert.equal(newsTotal(), 0);

      const scriptPath = path.resolve(import.meta.dirname, '../scripts/check-news.mjs');
      const proc = spawnSync(process.execPath, [scriptPath, '--file', brokenPath], {
        encoding: 'utf8',
      });
      assert.equal(proc.status, 1);
      assert.match(proc.stderr, /JSON не разобран/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. coverInfo: статья с cover отдаёт srcset из трёх размеров и правильный alt; с cover_static — этот путь; без обложки — фолбэк', () => {
    const withCover = makeItem({
      slug: 'zamena-masla-test',
      cover: {
        base: 'a1b2c3-cover',
        w: 1600,
        h: 900,
        ext: 'webp',
        alt: 'Механик заливает моторное масло в двигатель на подъёмнике',
      },
      cover_static: null,
    });
    const cov1 = coverInfo(withCover, '/img/news-1.svg', withCover.title);
    assert.equal(cov1.src, '/media/news/zamena-masla-test/a1b2c3-cover-960.webp');
    assert.equal(cov1.lg, '/media/news/zamena-masla-test/a1b2c3-cover-1600.webp');
    assert.equal(
      cov1.srcset,
      '/media/news/zamena-masla-test/a1b2c3-cover-480.webp 480w, /media/news/zamena-masla-test/a1b2c3-cover-960.webp 960w, /media/news/zamena-masla-test/a1b2c3-cover-1600.webp 1600w',
    );
    assert.equal(cov1.alt, 'Механик заливает моторное масло в двигатель на подъёмнике');

    const withStatic = makeItem({
      cover: null,
      cover_static: '/img/vy-art-to-lift-1600.webp',
    });
    const cov2 = coverInfo(withStatic, '/img/news-1.svg', withStatic.title);
    assert.equal(cov2.src, '/img/vy-art-to-lift-1600.webp');
    assert.equal(cov2.lg, '/img/vy-art-to-lift-1600.webp');
    assert.equal(cov2.srcset, null);
    assert.ok(cov2.alt.includes('кроссовер на двухстоечном подъёмнике'));

    const withFallback = makeItem({
      cover: null,
      cover_static: null,
    });
    const cov3 = coverInfo(withFallback, '/img/news-3.svg', withFallback.title);
    assert.equal(cov3.src, '/img/news-3.svg');
    assert.equal(cov3.lg, '/img/news-3.svg');
    assert.equal(cov3.srcset, null);
    assert.equal(cov3.alt, withFallback.title);
  });

  it('7. otherNews не возвращает саму статью и уважает limit', () => {
    delete process.env.NEWS_FILE;
    resetNewsCache();

    const targetSlug = 'remen-grm-kogda-menat';
    const others3 = otherNews(targetSlug, 3);
    assert.equal(others3.length, 3);
    assert.ok(others3.every((n) => n.slug !== targetSlug));

    const others5 = otherNews(targetSlug, 5);
    assert.equal(others5.length, 5);
    assert.ok(others5.every((n) => n.slug !== targetSlug));
  });
});
