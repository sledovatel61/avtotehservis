# Круг 89 · Агент 10 «данные и гейты» — «Полезное» переезжает в файл

**Ветка:** `agent/89-news-store` от `origin/preview/github-pages`. PR — в `preview/github-pages`.
**Читать первым:** `prompts/129-r89-brief.md` §2–§3 — там схема `news.json` и почему статьи уходят из SQLite.
**Зависимости:** нет. От тебя зависят Агент 7 (формат файла) и Агент 5 (чтение статей).

---

## Что не так сейчас

`/admin/news` пишет `INSERT INTO news(...)` в SQLite. На боевом домене админки нет: `export-pages.mjs` при каждой сборке создаёт временную базу во `tmp`, накатывает `migrate.ts` + `seed.ts` из `seed-data.ts` и экспортирует HTML. Значит, статья, созданная Пашей через админку, **физически не может попасть на сайт** — база умирает вместе со сборкой. Источник контента должен быть файлом в репозитории, как `cases.json`, `prices.json`, `reviews.json`.

## Задача 1 — `site/content/news.json`

Перенести все **15** статей из `site/src/server/seed-data.ts` (ключ `"news"`) в новый файл по схеме из брифа §3.

Требования:

- Ничего не переписывать: `title`, `excerpt`, `body_md`, `category`, `cover_static`, `published_at` — байт в байт как в сиде (включая `{{price:…}}` внутри текста).
- Поля сида `id`, `cover_media_id` в файл не переносятся; `status` — `published` у всех; `updated_at` = `published_at`.
- Добавить `seo_title: null` и `cover: null` всем — новые поля, чтобы редактор не изобретал их при первом сохранении.
- Порядок — по `published_at` desc, затем `slug`.
- Файл пишется как `JSON.stringify(doc, null, 2) + '\n'` — как остальные файлы `site/content/`.
- Миграцию сделать **скриптом** (`site/scripts/gen-news-json.mjs`), а не руками: скрипт читает `seed-data.ts`, пишет `news.json` и печатает `15 → 15`. Скрипт остаётся в репозитории и должен быть идемпотентным (второй запуск — пустой диф). Обоснование: при следующем переносе или проверке видно, откуда взялись данные.

`seed-data.ts` **не трогать**: сид — часть схемы, его удаление запрещено. Статьи в сиде остаются историческим источником, страницы читают только файл.

## Задача 2 — схема `site/src/shared/news-schema.ts`

По образцу `cases-schema.ts` / `reviews-schema.ts`. Экспорт:

- типы `NewsItem`, `NewsDoc`, `NewsCover`;
- `parseNewsDoc(raw: unknown): NewsDoc` — бросает `Error` с понятным русским текстом на первом нарушении;
- `validateNewsItem(item)` — все правила §3 (slug, уникальность проверяется на уровне документа, `seo_title ≤ 60`, `excerpt ≤ 300`, `body_md` 200–40000, `category ∈ NEWS_CATEGORIES`, `cover`/`cover_static` взаимоисключающие, `alt` 3–160, `published_at` — реальная дата формата `YYYY-MM-DD HH:MM`);
- `publishedItems(doc)` — `status === 'published'`, сортировка `published_at` desc, `slug` asc;
- `draftItems(doc)`;
- `NEWS_CATEGORY_SLUGS` — вынести из `content.ts` или импортировать оттуда, чтобы список категорий остался **в одном месте**. `NEWS_CATEGORIES` в `content.ts` не удалять — её использует админка и тесты.

Схема — чистые функции, без `node:fs`, чтобы её тянули и сайт, и `manage`/тесты.

## Задача 3 — `site/src/server/news-store.ts`

Чтение файла с кэшем по `mtime`, как `reviews-store.ts` / `cases-store.ts`. Экспорт с **теми же сигнатурами**, что у функций в `content.ts`, чтобы страницы меняли только импорт:

```ts
listNews(opts?: { category?: string | null; page?: number; per?: number }): { items: NewsItem[]; total: number; pages: number }
getNews(slug: string): NewsItem | undefined
otherNews(slug: string, limit?: number): NewsItem[]
newsCategoryCounts(): Record<string, number>
newsTotal(): number
newsCategoryPages(category: string, per: number): number   // для sitemap
coverInfo(item, fallbackSrc, title): CoverInfo             // см. ниже
```

Детали:

- `fillPrices` применять к `title`, `excerpt`, `body_md` — как это делает `mapNewsRow` сейчас. Без этого `{{price:…}}` уедет в HTML сырым текстом.
- `coverInfo` — версия из `content.ts`, но без обращения к таблице `media` (в файле нет `cover_media_id`):
  - `cover` задан → `src = /media/news/<slug>/<base>-960.<ext>`, `srcset` 480/960/1600, `lg` = 1600, `alt` = `cover.alt`;
  - иначе `cover_static`; иначе `fallbackSrc`.
- Битый файл или не прошедшая схему запись **не должны ронять сайт**: логируем в `console.warn` и отдаём пустой список/пропускаем запись. Исключение — режим гейта (`check-news.mjs`), там падаем.
- Кэш инвалидируется по `mtime`, но не чаще одного `stat` на вызов, как в существующих сторах.

`content.ts` **не удалять и не ломать**: его функции (`listNews` из БД, `mapNewsRow`, `NEWS_CATEGORIES`) остаются для админки и старых тестов. Страницы и sitemap переключаются на `news-store.ts`.

## Задача 4 — страницы и sitemap читают файл

- `site/src/pages/news.astro`, `news/[slug].astro`, `news/cat/[cat].astro`, `news/cat/[cat]/page/[page].astro`, `news/page/[page].astro` — импорт из `news-store.ts`. Вёрстку не менять (оформление — задача Агента 5).
- `site/src/pages/sitemap.xml.ts` — статьи и пагинация из файла; `lastmod` = `updated_at.slice(0,10)`, иначе `published_at`. Черновики не попадают.
- `site/scripts/export-pages.mjs` — маршруты статей берутся из sitemap, так что отдельных правок не требуется; **убедись прогоном**, что число страниц `/news/<slug>` в `pages-dist` равно числу `published` в файле.

## Задача 5 — `/admin/news` закрывается

- В `site/src/middleware.ts` `legacyRedirect` (там уже есть `/admin/cases*` → `/manage/#photos` и `/admin/reviews*` → `/manage/#reviews`) добавить `/admin/news*` → `/manage/#news`, 301, **до проверки сессии**. И `/admin` (корень) — оставить как есть.
- `site/src/layouts/Admin.astro` — убрать пункт навигации «Новости», если он есть.
- `site/src/pages/admin/index.astro` — если есть плитка/ссылка на новости, заменить подсказкой «Статьи — в мастерской: `/manage/` → «Полезное»», как сделано для работ и отзывов.
- Сами страницы `site/src/pages/admin/news/**` удалить (как в круге 88 поступили с `cases`/`reviews`). Тесты, которые их дёргают, переписать на проверку 301 — **не удалять проверки, а перевести на редирект**.

## Задача 6 — гейт `site/scripts/check-news.mjs`

- `node scripts/check-news.mjs` — валидирует `site/content/news.json` схемой, печатает `ok: N статей (published M, draft K)`, падает при дубле slug / битой дате / неизвестной категории.
- `--strict` — дополнительно проверяет артефакт: для каждого `draft` в `pages-dist/news/<slug>/index.html` файла **нет**; для каждого `published` — есть. Требует собранного `pages-dist` (как `check-reviews-artifact.mjs`).
- `--count` — только число published (для CI/логов).
- Шаг добавить в `.github/workflows/pages.yml` после `check-reviews-artifact.mjs`: сначала `node scripts/check-news.mjs`, затем `node scripts/check-news.mjs --strict`.
- Проверить, что `check-prices-sync.mjs --refs-only` видит ссылки `{{price:…}}` в новом файле: `REFS_ROOTS` уже включает `site/content`, но прогони и подтверди в PR.

## Задача 7 — тесты `site/tests/news-data.test.ts`

Обязательные случаи:

1. Файл читается, статей 15, все `published`, категории только из `NEWS_CATEGORIES`, slug-и уникальны.
2. `fillPrices` применён: в `body_md` любой статьи с `{{price:` в исходнике плейсхолдеров в выдаче нет, вместо них суммы из `prices.json`.
3. Черновик (`status: 'draft'`) отсутствует в `listNews`, `newsTotal`, sitemap-наборе и карте категорий.
4. Дубль slug / `seo_title` 61 символ / `status: 'published'` без `published_at` / `cover` и `cover_static` одновременно — `parseNewsDoc` бросает ошибку с внятным текстом.
5. Битый JSON не роняет `listNews` (пустой список), но `check-news.mjs` на нём падает (проверять вызовом чистого `parseNewsDoc` + отдельно, если просто, прогоном скрипта).
6. `coverInfo`: статья с `cover` отдаёт srcset из трёх размеров и правильный `alt`; статья с `cover_static` — этот путь; статья без обложки — фолбэк.
7. `otherNews` не возвращает саму статью и уважает `limit`.

## Проверка перед PR

```
cd site
npm ci
npm run typecheck
npm run build
PUBLIC_DEMO_REVIEWS=1 PUBLIC_ORIGIN=https://sledovatel61.github.io PUBLIC_BASE_PATH=/avtotehservis npm run build:pages
node scripts/check-news.mjs && node scripts/check-news.mjs --strict
node scripts/check-pages.mjs        # с теми же PUBLIC_ORIGIN/PUBLIC_BASE_PATH
node scripts/check-prices-sync.mjs --refs-only
node --test tests/*.test.ts         # база 311/311; ожидается 311 + новые, 0 fail
```

В PR: вывод всех команд, `diff` числа статей (`15 → 15`), список изменённых файлов. Отдельной строкой — сколько страниц `/news/*` в `pages-dist` до и после.

## Запрещено

- Трогать `CNAME`, `robots.txt`, `site/public/media/**`, `relay/**`, `/manage/**`, `reviews.json`, `prices.json`, `cases.json`.
- Удалять сид, миграции, таблицу `news` и функции `content.ts`.
- Менять вёрстку и SEO-разметку статей — это Агент 5 (`prompts/132`).
- Ослаблять существующие тесты, чтобы «стало зелёным».
