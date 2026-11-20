/**
 * Круг 94: гейт «в статьях «Полезного» нет зашитых сумм».
 *
 * Зачем. Статьи в `content/news.json` попадают на сайт через `fillPrices()`.
 * Если сумма вписана цифрами («заправка — 2000 ₽»), то после правки цены
 * в `/manage/` → «Цены» статья продолжит показывать старую цифру. Сборка при
 * этом не падает: `check-prices-sync` проверяет страницы и исходники, а текст
 * статей лежит в JSON и в его обход не попадал.
 *
 * Правило: любая сумма в тексте статьи — только токеном `{{price:…}}`,
 * `{{from:…}}`, `{{pair:…}}`, `{{span:…}}`, `{{between:…}}`, `{{sum:…}}`,
 * `{{tyre:…}}` или `{{From:…}}`. Токен раскрывается из прайса при сборке.
 *
 * Что игнорируем:
 *   - цены внутри токенов (там нет ₽, но на всякий случай срезаем токены);
 *   - строки, где число с ₽ стоит в цитате требования или в примере заполнения —
 *     таких в статьях быть не должно, поэтому исключений нет.
 *
 * Запуск:
 *   node scripts/check-news-prices.mjs
 *   node scripts/check-news-prices.mjs --self-test
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(HERE, '..');
const NEWS_PATH = join(SITE_ROOT, 'content/news.json');

/** Поля статьи, которые видит посетитель. */
const FIELDS = ['title', 'excerpt', 'description', 'seo_title', 'seo_description', 'body_md'];

const TOKEN_RE = /\{\{[^{}]*\}\}/g;
/** Сумма «цифрами»: 2000 ₽, 15 000 ₽, 1800–2500 ₽, от 500 ₽. */
const AMOUNT_RE = /(?:от\s+)?\d[\d\u00a0 ]{0,7}\s*(?:[–—-]\s*\d[\d\u00a0 ]{0,7}\s*)?₽/gi;

/**
 * Ищет в тексте суммы, записанные цифрами.
 * @param {string} text
 * @returns {string[]} найденные фрагменты
 */
export function findHardcodedAmounts(text) {
  if (!text) return [];
  const withoutTokens = String(text).replace(TOKEN_RE, ' ');
  const found = [];
  for (const m of withoutTokens.matchAll(AMOUNT_RE)) {
    found.push(m[0].replace(/\s+/g, ' ').trim());
  }
  return found;
}

/**
 * Проверяет файл статей.
 * @param {any} news разобранный content/news.json
 * @returns {string[]} список нарушений
 */
export function checkNewsFile(news) {
  const errors = [];
  const items = Array.isArray(news) ? news : news?.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    return ['в content/news.json нет статей'];
  }
  for (const item of items) {
    const slug = item?.slug ?? '(без slug)';
    for (const field of FIELDS) {
      const text = item?.[field];
      if (typeof text !== 'string' || !text) continue;
      const found = findHardcodedAmounts(text);
      if (found.length > 0) {
        const uniq = [...new Set(found)];
        errors.push(`${slug} → ${field}: суммы цифрами вместо токена прайса: ${uniq.join(', ')}`);
      }
    }
  }
  return errors;
}

function selfTest() {
  const cases = [
    {
      name: 'чистая статья с токенами проходит',
      news: { items: [{ slug: 'ok', body_md: '- заправка — {{price:ac-refill}};' }] },
      ok: true,
    },
    {
      name: 'сумма цифрами ловится',
      news: { items: [{ slug: 'bad', body_md: '- заправка — 2000 ₽;' }] },
      ok: false,
    },
    {
      name: 'диапазон цифрами ловится',
      news: { items: [{ slug: 'bad2', excerpt: 'масло 1000–1300 ₽' }] },
      ok: false,
    },
    {
      name: '«от 500 ₽» ловится',
      news: { items: [{ slug: 'bad3', body_md: 'поиск утечки — от 500 ₽' }] },
      ok: false,
    },
    {
      name: 'сумма в заголовке ловится',
      news: { items: [{ slug: 'bad4', title: 'Сколько стоит диагностика за 800 ₽' }] },
      ok: false,
    },
    {
      name: 'пустой файл — ошибка',
      news: { items: [] },
      ok: false,
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const errors = checkNewsFile(c.news);
    const passed = c.ok ? errors.length === 0 : errors.length > 0;
    if (!passed) {
      failed += 1;
      console.error(`FAIL самопроверка: «${c.name}» — ожидали ${c.ok ? 'успех' : 'ошибку'}, получили: ${errors.join('; ') || '—'}`);
    }
  }
  if (failed > 0) {
    console.error(`check-news-prices: самопроверка провалена (${failed})`);
    process.exit(1);
  }
  console.log(`check-news-prices: самопроверка пройдена (${cases.length} случаев)`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  let news;
  try {
    news = JSON.parse(readFileSync(NEWS_PATH, 'utf8'));
  } catch (err) {
    console.error(`check-news-prices: не удалось прочитать content/news.json — ${err.message}`);
    process.exit(1);
  }
  const errors = checkNewsFile(news);
  if (errors.length > 0) {
    console.error('check-news-prices: в статьях зашиты суммы цифрами');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('Замените сумму на токен прайса, например {{price:ac-refill}}.');
    process.exit(1);
  }
  const count = (Array.isArray(news) ? news : news.items ?? []).length;
  console.log(`check-news-prices: OK (${count} статей, сумм цифрами нет)`);
}
