# Круг 89 · Агент 12 «приёмка» — повторная проверка после 132, 133 и 135

**Ветка:** `agent/89-acceptance-2`, от `origin/preview/github-pages`. В PR — **только** отчёт `docs/reports/r89-acceptance.md`.
**Когда браться:** после мержа `prompts/135` (закрытие `noindex` в статическом экспорте).
**Что уже в базе:** А10 (статьи в `site/content/news.json`), А7 (вкладка «Полезное» в `/manage/`), А5 (SEO в `prompts/132` + Метрика/GA и cookies в `prompts/133`).

---

## Что изменилось с прошлой приёмки

Прошлый отчёт (PR #97) закрыт: он писался до мержа 132/133 и лежал в удалённой папке `promts/`. Его вывод про `noindex` был верным и стал отдельным заданием `prompts/135` — проверь, что оно действительно закрыто.

## Проверки

### 1. Индексация (главное)

На **боевой** сборке (`PUBLIC_ORIGIN=https://ats-rostov.ru PUBLIC_BASE_PATH=/`):

- ни в одном HTML, кроме `pages-dist/manage/**`, нет `name="robots" content="noindex`;
- `robots.txt` — `Allow: /`, `Disallow: /manage`, `Sitemap: https://ats-rostov.ru/sitemap.xml`;
- `canonical` абсолютный и без query; `og:url` совпадает;
- `sitemap.xml`: 15 статей, `lastmod` = дата изменения, листинги и пагинация на месте;
- на превью — наоборот, `noindex` на каждой публичной странице.

### 2. SEO статьи

`/news/<slug>/` в артефакте: `BlogPosting` (не `NewsArticle`), `dateModified`, `publisher.logo`, `mainEntityOfPage`; `og:image` = обложка статьи (`/img/…` или `/media/news/…`), `og:type=article`, `article:published_time`, `article:modified_time`; `<title>` ≤ 70 из `seo_title`; `description` ≤ 200.

### 3. RSS

`pages-dist/news/rss.xml` существует, `Content-Type` корректен, ≤ 20 `<item>`, XML парсится, адреса абсолютные и с префиксом публикации, черновиков нет; в `<head>` есть `link rel="alternate"`, в подвале — ссылка на ленту.

### 4. Аналитика и согласие

- Без `PUBLIC_YM_ID`/`PUBLIC_GA_ID`: в артефакте **ноль** вхождений `mc.yandex`, `ym(`, `gtag`, `googletagmanager`.
- С `PUBLIC_YM_ID=test123`: `data-ym` есть, но скрипт в HTML **не вставлен статически** (грузится только после согласия).
- Баннер на всех публичных страницах, кроме `/manage/`.
- `/privacy/` содержит `id="cookies"`, «Метрика», «Google Analytics», `ats_consent`; прежней фразы «Отдельный баннер о cookies поэтому не показывается» нет.
- `consent_version` в формах = `2026-11-20` (не изменился!), `policy_version` = `2026-11-21`. Заявка с формы проходит (проверить на локальном сервере, не на домене).

### 5. Регрессии

`node --test tests/*.test.ts` (база 363 + новые, 0 fail), `check-pages`, `check-news --strict`, `check-reviews`, `check-reviews-artifact`, `check-prices-sync --refs-only`, `check-analytics` (+`--self-test`), `check-cases`, `check-media-budget` — все PASS. `/manage/` — четыре вкладки, сохранение статьи создаёт один коммит.

## Формат отчёта

`docs/reports/r89-acceptance.md`, первая строка — вердикт. Дальше: таблица «проверка / чем / результат», дефекты с файлом и строкой, что осталось владельцу. Никаких «пожеланий».

## Запрещено

- Править код, тесты, гейты. Только отчёт.
- Писать в `promts/` (папки больше нет), пользоваться скриншотами вместо URL и вывода команд.
- Считать «работает», если проверено только на локальной сборке без боевого режима.
