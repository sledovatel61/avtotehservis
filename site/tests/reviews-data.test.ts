import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  type ReviewsFile,
  type SiteReview,
  EMPTY_REVIEWS_FILE,
  parseReviewsFile,
  publishedReviews,
  reviewsStats,
} from '../src/shared/reviews-schema.ts';
import {
  readReviewsFile,
  listPublishedSiteReviews,
  reviewsDiagnostics,
  resetReviewsCache,
} from '../src/server/reviews-store.ts';
import { checkReviewsFile } from '../scripts/check-reviews.mjs';

function makeValidItems(): SiteReview[] {
  return [
    {
      id: 'r-2026-10-10-001',
      author: 'Иван П.',
      text: 'Приезжал на плановое ТО и замену масла в двигателе, всё выполнили аккуратно и без задержек.',
      rating: 5,
      source: 'site',
      source_url: null,
      published_at: '2026-10-10',
      status: 'published',
      demo: false,
    },
    {
      id: 'r-2026-11-02-001',
      author: 'Елена В.',
      text: 'Меняли передние тормозные колодки и обслуживали суппорты. Показали старые детали, рекомендую.',
      rating: 4,
      source: 'yandex',
      source_url: 'https://yandex.ru/maps/org/example/reviews',
      published_at: '2026-11-02',
      status: 'published',
      demo: false,
    },
    {
      id: 'r-2026-11-05-001',
      author: 'Павел И.',
      text: 'Демо-запись для проверки фильтрации примеров на странице отзывов и в строгом гейте.',
      rating: 5,
      source: 'demo',
      source_url: null,
      published_at: '2026-11-05',
      status: 'published',
      demo: true,
    },
    {
      id: 'r-2026-11-08-001',
      author: 'Алексей К.',
      text: 'Скрытый отзыв, который ожидает проверки или снят с публикации владельцем в админке.',
      rating: 3,
      source: 'site',
      source_url: null,
      published_at: '2026-11-08',
      status: 'hidden',
      demo: false,
    },
  ];
}

describe('reviews-schema, reviews-store и check-reviews (круг 87)', () => {
  const origReviewsFile = process.env.REVIEWS_FILE;
  const origDemoFlag = process.env.PUBLIC_DEMO_REVIEWS;

  afterEach(() => {
    if (origReviewsFile === undefined) delete process.env.REVIEWS_FILE;
    else process.env.REVIEWS_FILE = origReviewsFile;
    if (origDemoFlag === undefined) delete process.env.PUBLIC_DEMO_REVIEWS;
    else process.env.PUBLIC_DEMO_REVIEWS = origDemoFlag;
    resetReviewsCache();
  });

  it('1. валидный файл (и штатный site/content/reviews.json) → items целиком, errors пуст', () => {
    const raw: ReviewsFile = {
      updated_at: '2026-11-19',
      items: makeValidItems(),
    };
    const res = parseReviewsFile(raw);
    assert.deepEqual(res.errors, []);
    assert.equal(res.file.updated_at, '2026-11-19');
    assert.equal(res.file.items.length, 4);
    assert.deepEqual(res.file.items, raw.items);

    // Штатный site/content/reviews.json содержит 6 демо-отзывов без ошибок схемы
    const repoFile = readReviewsFile();
    assert.deepEqual(repoFile.errors, []);
    assert.equal(repoFile.file.items.length, 6);
    assert.ok(repoFile.file.items.every((r) => r.demo === true && r.source === 'demo'));
  });

  it('2. битый JSON → пусто + одна ошибка, без исключения', () => {
    const resBrokenStr = parseReviewsFile('{ "updated_at": "2026-11-19", "items": [');
    assert.deepEqual(resBrokenStr.file, EMPTY_REVIEWS_FILE);
    assert.equal(resBrokenStr.errors.length, 1);
    assert.match(resBrokenStr.errors[0], /JSON не разобран/);

    const resNull = parseReviewsFile(null);
    assert.deepEqual(resNull.file, EMPTY_REVIEWS_FILE);
    assert.equal(resNull.errors.length, 1);

    // И через reviews-store на файле с битым JSON — не бросает, отдаёт [] и ошибку в диагностике
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-broken-'));
    try {
      const brokenPath = path.join(tmpDir, 'reviews.json');
      fs.writeFileSync(brokenPath, '{not valid json', 'utf8');
      process.env.REVIEWS_FILE = brokenPath;
      resetReviewsCache();

      assert.deepEqual(listPublishedSiteReviews({ includeDemo: true }), []);
      const diag = reviewsDiagnostics();
      assert.equal(diag.count, 0);
      assert.equal(diag.errors.length, 1);
      assert.match(diag.errors[0], /JSON не разобран/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('3. rating: 9 (и другие невалидные поля) → запись отброшена, остальные живы', () => {
    const items = makeValidItems();
    const raw = {
      updated_at: '2026-11-19',
      items: [
        items[0],
        {
          ...items[1],
          id: 'r-2026-11-03-001',
          rating: 9,
        },
        items[2],
      ],
    };
    const res = parseReviewsFile(raw);
    assert.equal(res.file.items.length, 2);
    assert.deepEqual(
      res.file.items.map((r) => r.id),
      [items[0].id, items[2].id],
    );
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0], /items\[1\]\.rating.*от 1 до 5/);
  });

  it('4. дубль id → остаётся первый, второй отброшен, в errors понятное сообщение', () => {
    const items = makeValidItems();
    const duplicate = {
      ...items[1],
      id: items[0].id,
      author: 'Дубликат И.',
    };
    const res = parseReviewsFile({
      updated_at: '2026-11-19',
      items: [items[0], duplicate, items[2]],
    });
    assert.equal(res.file.items.length, 2);
    assert.equal(res.file.items[0].author, 'Иван П.');
    assert.equal(res.file.items[1].id, items[2].id);
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0], /items\[1\]\.id: дубль «r-2026-10-10-001» — запись отброшена/);
  });

  it('5. publishedReviews и store: hidden не попадает; демо не попадают без флага и попадают с PUBLIC_DEMO_REVIEWS=1', () => {
    const file: ReviewsFile = {
      updated_at: '2026-11-19',
      items: makeValidItems(),
    };

    const withoutDemo = publishedReviews(file, { includeDemo: false });
    assert.deepEqual(
      withoutDemo.map((r) => r.id),
      ['r-2026-11-02-001', 'r-2026-10-10-001'],
    );
    assert.ok(withoutDemo.every((r) => r.status === 'published' && !r.demo));

    const withDemo = publishedReviews(file, { includeDemo: true });
    assert.deepEqual(
      withDemo.map((r) => r.id),
      ['r-2026-11-05-001', 'r-2026-11-02-001', 'r-2026-10-10-001'],
    );

    // Проверка listPublishedSiteReviews с переменной окружения PUBLIC_DEMO_REVIEWS
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-flag-'));
    try {
      const p = path.join(tmpDir, 'reviews.json');
      fs.writeFileSync(p, JSON.stringify(file, null, 2), 'utf8');
      process.env.REVIEWS_FILE = p;
      resetReviewsCache();

      delete process.env.PUBLIC_DEMO_REVIEWS;
      assert.equal(listPublishedSiteReviews().length, 2);

      process.env.PUBLIC_DEMO_REVIEWS = '1';
      assert.equal(listPublishedSiteReviews().length, 3);

      /* Боевой домен: примеры не показываем даже с флагом, иначе они уедут
         на ats-rostov.ru как отзывы клиентов. */
      process.env.PUBLIC_SITE_URL = 'https://ats-rostov.ru';
      assert.equal(listPublishedSiteReviews().length, 2, 'на ats-rostov.ru демо нет');
      process.env.PUBLIC_SITE_URL = 'https://www.ats-rostov.ru/';
      assert.equal(listPublishedSiteReviews().length, 2, 'www.ats-rostov.ru — тоже боевой');
      process.env.PUBLIC_SITE_URL = 'https://sledovatel61.github.io/avtotehservis/';
      assert.equal(listPublishedSiteReviews().length, 3, 'превью показывает примеры');
      /* Явный includeDemo не должен обходить запрет для боевого домена. */
      process.env.PUBLIC_SITE_URL = 'https://ats-rostov.ru';
      assert.equal(listPublishedSiteReviews({ includeDemo: true }).length, 2);
      delete process.env.PUBLIC_SITE_URL;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.PUBLIC_DEMO_REVIEWS;
      delete process.env.REVIEWS_FILE;
      resetReviewsCache();
    }
  });

  it('6. сортировка: новые выше (published_at desc), при равных датах — по id desc', () => {
    const base = makeValidItems()[0];
    const file: ReviewsFile = {
      updated_at: '2026-11-19',
      items: [
        { ...base, id: 'r-2026-10-15-001', published_at: '2026-10-15' },
        { ...base, id: 'r-2026-11-01-001', published_at: '2026-11-01' },
        { ...base, id: 'r-2026-11-01-003', published_at: '2026-11-01' },
        { ...base, id: 'r-2026-11-01-002', published_at: '2026-11-01' },
      ],
    };
    const ordered = publishedReviews(file, { includeDemo: false });
    assert.deepEqual(
      ordered.map((r) => r.id),
      [
        'r-2026-11-01-003',
        'r-2026-11-01-002',
        'r-2026-11-01-001',
        'r-2026-10-15-001',
      ],
    );
  });

  it('7. reviewsStats: среднее с одним знаком после запятой, распределение по звёздам, пустой список → null', () => {
    const empty = reviewsStats([]);
    assert.equal(empty.count, 0);
    assert.equal(empty.average, null);
    assert.deepEqual(empty.byRating, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

    const base = makeValidItems()[0];
    const stats = reviewsStats([
      { ...base, id: 'r-1', rating: 5 },
      { ...base, id: 'r-2', rating: 5 },
      { ...base, id: 'r-3', rating: 4 },
    ]);
    assert.equal(stats.count, 3);
    assert.equal(stats.average, 4.7);
    assert.deepEqual(stats.byRating, { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 });
  });

  it('8. store: отсутствующий файл → []; REVIEWS_FILE подменяет путь; повторное чтение берёт кэш и обновляется после изменения mtime', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-store-'));
    try {
      const missingPath = path.join(tmpDir, 'no-such-reviews.json');
      process.env.REVIEWS_FILE = missingPath;
      resetReviewsCache();

      assert.deepEqual(listPublishedSiteReviews({ includeDemo: true }), []);
      const missingDiag = reviewsDiagnostics();
      assert.equal(missingDiag.count, 0);
      assert.equal(missingDiag.path, missingPath);
      assert.ok(missingDiag.errors.length > 0);

      // Записываем файл и проверяем кэш + обновление по mtime
      const customPath = path.join(tmpDir, 'custom-reviews.json');
      process.env.REVIEWS_FILE = customPath;
      resetReviewsCache();

      const initialFile: ReviewsFile = {
        updated_at: '2026-11-18',
        items: [makeValidItems()[0]],
      };
      fs.writeFileSync(customPath, JSON.stringify(initialFile, null, 2), 'utf8');

      const firstRead = readReviewsFile();
      assert.equal(firstRead.fromCache, false);
      assert.equal(firstRead.file.items.length, 1);

      const secondRead = readReviewsFile();
      assert.equal(secondRead.fromCache, true);
      assert.equal(secondRead.file, firstRead.file);

      // Обновляем файл и сдвигаем mtime вперёд на 2 секунды
      const updatedFile: ReviewsFile = {
        updated_at: '2026-11-19',
        items: [makeValidItems()[0], makeValidItems()[1]],
      };
      fs.writeFileSync(customPath, JSON.stringify(updatedFile, null, 2), 'utf8');
      const futureTime = new Date(Date.now() + 2000);
      fs.utimesSync(customPath, futureTime, futureTime);

      const thirdRead = readReviewsFile();
      assert.equal(thirdRead.fromCache, false);
      assert.equal(thirdRead.file.items.length, 2);
      assert.equal(thirdRead.file.updated_at, '2026-11-19');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('9. check-reviews.mjs --strict → код 1 при демо и 0 без них', () => {
    const scriptPath = path.resolve(import.meta.dirname, '../scripts/check-reviews.mjs');
    const repoReviewsPath = path.resolve(import.meta.dirname, '../content/reviews.json');

    // На штатном файле с 6 демо: обычный режим → 0, --strict → 1
    const normalCheck = checkReviewsFile(repoReviewsPath, { strict: false });
    assert.equal(normalCheck.ok, true);
    assert.equal(normalCheck.summary.demoCount, 6);

    const strictWithDemo = spawnSync(process.execPath, [scriptPath, '--strict', '--file', repoReviewsPath], {
      encoding: 'utf8',
    });
    assert.equal(strictWithDemo.status, 1);
    assert.match(strictWithDemo.stderr, /demo: true/);

    // На файле без демо: --strict → 0, --count печатает число опубликованных
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-strict-'));
    try {
      const realOnlyPath = path.join(tmpDir, 'real-reviews.json');
      const realOnlyFile: ReviewsFile = {
        updated_at: '2026-11-19',
        items: makeValidItems().filter((r) => !r.demo),
      };
      fs.writeFileSync(realOnlyPath, JSON.stringify(realOnlyFile, null, 2), 'utf8');

      const strictReal = spawnSync(process.execPath, [scriptPath, '--strict', '--file', realOnlyPath], {
        encoding: 'utf8',
      });
      assert.equal(strictReal.status, 0);
      assert.match(strictReal.stdout, /опубликовано 2, скрыто 1, примеров 0/);

      const countReal = spawnSync(process.execPath, [scriptPath, '--count', '--file', realOnlyPath], {
        encoding: 'utf8',
      });
      assert.equal(countReal.status, 0);
      assert.equal(countReal.stdout.trim(), '2');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('10. без переменной PUBLIC_DEMO_REVIEWS (дефолт export-pages.mjs ? "") → listPublishedSiteReviews() не отдаёт демо', () => {
    delete process.env.REVIEWS_FILE;
    delete process.env.PUBLIC_DEMO_REVIEWS;
    resetReviewsCache();

    // На штатном reviews.json (6 демо-записей) без PUBLIC_DEMO_REVIEWS выдача пуста
    assert.deepEqual(listPublishedSiteReviews(), []);

    // И при пустой строке PUBLIC_DEMO_REVIEWS="" (как подставляет export-pages.mjs по умолчанию) — тоже пуста
    process.env.PUBLIC_DEMO_REVIEWS = process.env.PUBLIC_DEMO_REVIEWS ?? '';
    assert.deepEqual(listPublishedSiteReviews(), []);

    // Проверим также, что в export-pages.mjs прописан дефолт ?? '' (а не ?? '1')
    const exportPagesSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, '../scripts/export-pages.mjs'),
      'utf8',
    );
    assert.match(exportPagesSrc, /PUBLIC_DEMO_REVIEWS:\s*process\.env\.PUBLIC_DEMO_REVIEWS\s*\?\?\s*''/);
  });

  it('11. с PUBLIC_DEMO_REVIEWS=1 → listPublishedSiteReviews() отдаёт демо-отзывы', () => {
    delete process.env.REVIEWS_FILE;
    process.env.PUBLIC_DEMO_REVIEWS = '1';
    resetReviewsCache();

    const published = listPublishedSiteReviews();
    assert.equal(published.length, 6);
    assert.ok(published.every((r) => r.demo === true && r.status === 'published'));
  });
});
