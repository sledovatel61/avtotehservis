# Круг 89 · Агент 5 «сайт» — SEO статей «Полезного»

**Ветка:** `agent/89-news-seo` от `origin/preview/github-pages`. PR — в `preview/github-pages`.
**Читать первым:** `prompts/129-r89-brief.md` §3 (схема файла) и §5 (SEO-требования).
**Зависимость:** мерж Агента 10 (`prompts/130`) — статьи читаются из `site/content/news.json` через `news-store.ts`. Без него ветку не начинать: иначе конфликт в `news.astro`.
**Не пересекаться** с `prompts/133` (метрика и cookies) — это отдельная ветка того же агента, мержится после. В `Base.astro` ты добавляешь только SEO-пропсы; сниппеты счётчиков — не твоя часть.

---

## Задача 1 — `BlogPosting` и корректные метаданные статьи

В `site/src/pages/news/[slug].astro` заменить `NewsArticle` на `BlogPosting`. Состав:

```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "<title, ≤ 110 знаков>",
  "description": "<excerpt>",
  "image": ["<абсолютный URL обложки 1200×630 или 1600>"],
  "datePublished": "<published_at ISO>",
  "dateModified": "<updated_at ISO>",
  "inLanguage": "ru",
  "author":   { "@type": "Organization", "name": "<site_name>", "url": "<origin>" },
  "publisher":{ "@type": "Organization", "name": "<site_name>", "logo": { "@type": "ImageObject", "url": "<origin>/img/logo.svg" } },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "<origin>/news/<slug>" }
}
```

- `logo` — существующий `site/public/img/logo.svg`; других ассетов не выдумывать.
- Даты — ISO (`YYYY-MM-DDTHH:MM:00+03:00`; часовой пояс сервиса — Москва). Не отдавать `2026-11-18 10:00` как есть.
- `BreadcrumbList` остаётся, но названия: «Главная», «Полезное», `<заголовок>`.
- Если `cover` нет (старая статья с `cover_static`) — в `image` идёт `cover_static` с абсолютным URL. Схема не должна врать про несуществующий файл.

## Задача 2 — `og:image` статьи

`Base.astro` сейчас жёстко:

```ts
const ogImage = new URL('/img/og.png', siteOrigin).href;
```

Добавить необязательный проп `ogImage?: string` (абсолютный или относительный путь): если задан — использовать его и для `og:image`, и для `twitter:image`. В статье передавать `<origin>/media/news/<slug>/<base>-og.jpg` (1200×630). Остальные страницы не трогать — у них остаётся `/img/og.png`.

Также добавить проп `modifiedTime?: string` → `<meta property="article:modified_time">`. `ogType="article"` и `publishedTime` уже есть.

## Задача 3 — `title` и `description`

- `<title>`: `seo_title ?? title` + ` — АвтоТехСервис`, при длине больше 70 знаков — обрезать по границе слова (не рвать слово, добавить `…`). Проверять на реальных 15 статьях, что ни один `<title>` не длиннее 70.
- `description` — `excerpt`, обрезка до 200 знаков по границе слова.
- В листинге `/news` и на страницах категорий/пагинации `<title>` сделать уникальным: «Полезное — страница 2», «Полезное: Советы» и т. п., чтобы страницы не конкурировали одинаковыми заголовками.
- Подписи раздела привести к «Полезному»: `<title>`, `page-head` (eyebrow/h1/lead уже про полезное), крошки, `BreadcrumbList` в `news.astro` (сейчас «Новости и акции»), `<h2 class="u-sr">`.

## Задача 4 — sitemap: актуальный `lastmod`

В `site/src/pages/sitemap.xml.ts` (после Агента 10) `lastmod` статьи = `updated_at.slice(0,10)`, иначе `published_at`. У листингов `/news`, `/news/page/N`, `/news/cat/<slug>` — `lastmod` = самая свежая `updated_at` раздела (это сигнал переобхода). Ничего не выдумывать: только даты из файла.

## Задача 5 — RSS `/news/rss.xml`

Новый эндпоинт `site/src/pages/news/rss.xml.ts`:

- RSS 2.0, `<?xml version="1.0" encoding="UTF-8"?>`, `channel` с `title`, `link`, `description`, `language=ru`, `lastBuildDate`, `atom:link rel="self"`;
- 20 последних **опубликованных** статей: `title`, `link` (абсолютный), `guid` (= link, `isPermaLink="true"`), `pubDate` (RFC 822), `description` (экранированный `excerpt`), `category`;
- XML-экранирование обязательно (`&`, `<`, `>`), проверять тестом;
- черновики и статьи без даты — не попадают.

**Важно:** статический экспорт копирует только то, что перечислено в sitemap, плюс отдельно обработанные файлы (`sitemap.xml`, `robots.txt`). Поэтому в `site/scripts/export-pages.mjs` нужно **явно** получить `/news/rss.xml` с локального сервера и записать в `pages-dist/news/rss.xml` с заменой префикса так же, как это сделано для `sitemap.xml` (см. блок «Кладём sitemap в публикацию с тем же префиксом»). Иначе лента будет отдавать 404 на Pages, а ссылка на неё — стоять в `<head>`.

Добавить в `<head>` (через `Base.astro`, проп или общий `<link>`): `<link rel="alternate" type="application/rss+xml" title="Полезное — АвтоТехСервис" href="/news/rss.xml">` — с учётом префикса публикации, как остальные ссылки (`readPublicPath`/существующий механизм). Ссылку на ленту — в подвал рядом с «Полезное».

## Задача 6 — верификация поисковиков

В `Base.astro` добавить условные мета-теги, только если переменные заданы:

- `PUBLIC_GOOGLE_SITE_VERIFICATION` → `<meta name="google-site-verification" content="…">`
- `PUBLIC_YANDEX_VERIFICATION` → `<meta name="yandex-verification" content="…">`

Значения передаются в сборку из переменных репозитория (`.github/workflows/pages.yml`): `${{ vars.PUBLIC_GOOGLE_SITE_VERIFICATION }}`, `${{ vars.PUBLIC_YANDEX_VERIFICATION }}`. Пусто — тега нет вовсе (не пустой `content=""`).

Это то, что реально даёт гугл-трафик: без подтверждённого ресурса в Search Console и отправленного `sitemap.xml` сайт в Google просто не появится, сколько бы ни было включено GA.

## Задача 7 — тесты `site/tests/news-seo.test.ts`

1. `jsonLdFor(item)` (вынеси чистую функцию) — `@type: 'BlogPosting'`, `dateModified` из `updated_at`, `publisher.logo.url` абсолютный, `mainEntityOfPage.@id` = `/news/<slug>`.
2. Даты в JSON-LD — валидный ISO: `!Number.isNaN(Date.parse(...))`.
3. `articleTitle(item)` — берёт `seo_title`, при пустом — `title`; обрезка по границе слова, длина ≤ 70.
4. `rssXml(items)` — экранирует `&`/`<`, не содержит черновиков, `pubDate` парсится, `guid` абсолютный.
5. `ogImageFor(item, origin)` — `-og.jpg` при `cover`, `cover_static` при старом формате.
6. Рендер `/news/<slug>/` в `pages-dist`: в HTML есть `og:image` с `-og.jpg`, `article:modified_time`, `BlogPosting`, нет `NewsArticle`.
7. `pages-dist/news/rss.xml` существует и содержит 20 или меньше `<item>` (или сколько статей есть).

Проверки по артефакту — пропускать, если `pages-dist` нет (как делают соседние тесты), но в PR приложить прогон с ним.

## Проверка перед PR

```
cd site
npm run typecheck
npm run build
PUBLIC_DEMO_REVIEWS=1 PUBLIC_ORIGIN=https://sledovatel61.github.io PUBLIC_BASE_PATH=/avtotehservis npm run build:pages
node scripts/check-pages.mjs
node --test tests/*.test.ts
```

Плюс `curl` по локальному серверу: `/news/rss.xml` отдаёт `application/rss+xml` (или `application/xml`), в HTML статьи — пять обязательных тегов. В PR — фрагменты HTML статьи и первые 20 строк RSS.

## Запрещено

- Ставить счётчики Метрики/GA и баннер cookies — это `prompts/133`.
- Менять `robots.txt`, `CNAME`, `relay/**`, `site/public/manage/**`, `news.json` (файл — зона Агента 10 и 7).
- Менять вёрстку карточек и статьи за пределами перечисленного: дизайн утверждён.
- Ослаблять существующие тесты (`check-news-mobile`, `check-pages`, `content.test.ts`).
