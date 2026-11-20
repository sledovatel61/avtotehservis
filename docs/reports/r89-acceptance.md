# Круг 89 · Приёмка №2 — **принимаю, когда PR #101 будет смержен**

## Вердикт

**Правка 135 корректна и проверена — но она не в базе.** PR **#101** («Круг 89 (135): noindex в экспорте — только на превью») открыт, дым-тест зелёный, но **не смержен**. В `preview/github-pages` (`eae5d54`) файл `site/scripts/export-pages.mjs` по-прежнему содержит безусловную установку `noindex` (строки 99–101), `isPublicProduction` отсутствует, теста `export-robots.test.ts` нет.

Поэтому приёмка сделана **в двух состояниях**, и разница принципиальная:

| Состояние | Что увидят поисковики | Вывод |
|---|---|---|
| `preview/github-pages` как есть (`eae5d54`) | `noindex, nofollow` на каждой странице | **не принимаю** |
| база + патч из PR #101 | боевые страницы открыты, превью закрыто | **принимаю** |

Всё, что в базе **не** зависит от 135, проверено и работает: SEO статьи (§2), RSS (§3), аналитика и согласие (§4), регрессии (§5). Остаётся одна вещь — нажать «Merge» на #101.

---

## Главное: PR #101 закрывает 135 ровно по заданию

Проверил код, применил патч к базе и собрал обе сборки.

```js
// site/scripts/export-pages.mjs — появилось
export function isPublicProduction({ publicOrigin, base } = {}) {
  const origin = typeof publicOrigin === 'string' ? publicOrigin.trim().replace(/\/+$/, '') : '';
  const isCustomOrigin = origin !== '' && origin !== DEFAULT_PUBLIC_ORIGIN;
  const isRootBase = base === '/' || base === '';
  return isCustomOrigin && isRootBase;
}
export function applyRobotsMeta(doc, { production } = {}) {
  if (production) return;                     // боевой: мета-теги не трогаем
  doc.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove());
  const robots = doc.createElement('meta');
  robots.name = 'robots'; robots.content = 'noindex, nofollow';
  doc.head.append(robots);
}
```

Плюсы, которые стоит отметить:

- **Логика не задвоена.** `robotsTxt` переписан через тот же предикат — третьей копии правил не появилось, как и требовало задание.
- **`robots.test.ts` не тронут** и зелёный — прежние результаты `robotsTxt` сохранены для всех входов.
- **Домен + префикс** (`https://ats-rostov.ru` + `/avtotehservis`) — не боевой режим, а ошибка конфигурации. Это правильно: угадывать по такому сочетанию нельзя.
- **`data-demo` и `data-preview` не тронуты**, `canonical`/`og:*` «заодно» не правились.
- **Гейт в `check-pages.mjs`** с разумным исключением служебного: `/manage/**`, `404.html` и meta-refresh заглушки переездов (у них `noindex, follow` намеренный).
- **Бонусом решена проблема JSON-LD** (в базе, не в PR): раньше `ld+json` вырезался целиком, теперь остаётся и адреса переписываются на адрес публикации.

### Мутационная проверка гейта (доказательство, что он не декоративный)

Искусственно вернул старый дефект (`if (false) return;` вместо `if (production) return;`) и пересобрал боевую сборку:

```
$ node scripts/check-pages.mjs
AssertionError: FAIL: боевая сборка закрыта от индексации (meta robots noindex): .../pages-dist/about/index.html
EXIT=1
```

Гейт падает с внятным сообщением и указывает файл. После проверки исходник восстановлен. **Дефект не вернётся незамеченным.**

---

## Таблица проверок

### 1. Индексация

| Проверка | Чем | Результат |
|---|---|---|
| Боевая сборка: `noindex` вне `/manage` | `grep -rl 'name="robots" content="noindex' pages-dist --include=*.html \| grep -v '^pages-dist/manage/'` | **0 страниц** ✅ |
| Что дали 4 «ложных» попадания | разбор по файлам | 3 meta-refresh заглушки переезда (`noindex, follow`) + `404.html` — намеренно, гейт их исключает ✅ |
| Статья: `meta robots` | `grep '<meta name="robots"'` | **тега нет** ✅ |
| `robots.txt` боевой | `cat pages-dist/robots.txt` | `Allow: /`, `Disallow: /manage`, `Sitemap: https://ats-rostov.ru/sitemap.xml` ✅ |
| Превью: `noindex` на публичных | обход 48 страниц | **48 из 48** с `noindex` ✅ |
| Превью: `robots.txt` | `cat` | `Disallow: /` ✅ |
| Гейт боевой сборки | `PUBLIC_ORIGIN=… BASE=/ node scripts/check-pages.mjs` | **PASS**: 50 страниц, 3985 ссылок ✅ |
| Гейт превью | `node scripts/check-pages.mjs` | **PASS** ✅ |
| Гейт ловит дефект | мутант | **FAIL** с указанием файла ✅ |
| `canonical` = `og:url`, без query | разбор `<head>` | `https://ats-rostov.ru/news/kondicioner-voyah-free` — совпадают ✅ |
| sitemap: статьи, `lastmod` | `grep` | 21 запись с `/news/`, `<lastmod>2026-12-04</lastmod>` ✅ |
| sitemap: листинги и пагинация | наличие файлов | `news/`, `news/page/2/`, `news/cat/sovety/` — все есть ✅ |

### 2. SEO статьи

| Проверка | Ожидание | Факт |
|---|---|---|
| JSON-LD тип | `BlogPosting`, не `NewsArticle` | **BlogPosting** ✅ |
| Поля `BlogPosting` | `dateModified`, `publisher.logo`, `mainEntityOfPage` | все на месте: `dateModified: 2026-12-04T09:00:00+03:00`, `publisher.logo.url = https://ats-rostov.ru/img/logo.svg`, `mainEntityOfPage` = `WebPage` с `@id` ✅ |
| Всего `ld+json` блоков | `BlogPosting` + `BreadcrumbList` | 2 блока: `BlogPosting`, `BreadcrumbList` (+ `ImageObject`, `Organization`, `ListItem`) ✅ |
| `og:image` | обложка статьи | `https://ats-rostov.ru/img/vy-art-kondicioner-1600.webp` ✅ (было общий `og.png`) |
| `og:type` | `article` | `article` ✅ |
| `article:published_time` / `modified_time` | оба | `2026-12-04T09:00:00+03:00` / `2026-12-04T09:00:00+03:00` ✅ |
| `<title>` | ≤ 70, из `seo_title` | 69 знаков ✅ |
| `description` | ≤ 200 | 145 знаков ✅ |

### 3. RSS

| Проверка | Ожидание | Факт |
|---|---|---|
| Файл | `pages-dist/news/rss.xml` | есть, 10 923 байта ✅ |
| `<item>` | ≤ 20 | **15** ✅ |
| XML парсится | парсером | `ET.parse` → ok, `channel` и 15 `item` ✅ |
| Адреса | абсолютные, с доменом | все `https://ats-rostov.ru/news/…` ✅ |
| Черновиков нет | 0 | published 15, draft 0, item 15, пересечение с драфтами **0** ✅ |
| `Content-Type` | `application/rss+xml` | задан в `src/pages/news/rss.xml.ts:24` ✅ |
| `link rel="alternate"` | в `<head>` | `<link rel="alternate" type="application/rss+xml" … href="/news/rss.xml">` ✅ |
| Ссылка в подвале | есть | `rss.xml` в `index.html` ✅ |
| `atom:link rel=self` | есть | присутствует ✅ |

### 4. Аналитика и согласие

| Проверка | Ожидание | Факт |
|---|---|---|
| Без `PUBLIC_YM_ID`/`PUBLIC_GA_ID`: `mc.yandex`, `ym(`, `gtag(`, `googletagmanager` | **ноль** | **0 в HTML**; единственные вхождения — в JS-бандле `Base.astro…js` (код загрузчика), статических `<script src="…mc.yandex…">` в разметке **нет** ✅ |
| `data-ym`/`data-ga` без ID | пусто | `data-ym=""`, `data-ga=""` ✅ |
| С `PUBLIC_YM_ID=test123`: `data-ym` | есть | `data-ym="test123"`, `data-ga="G-TEST123"` ✅ |
| С ID: скрипт не вставлен статически | нет | `grep 'src=".*mc\.yandex'` → **пусто**, `ym(` в HTML → **0** ✅ |
| Баннер на публичных | есть | `/`, `/news/`, статья, `/about` — все ✅ |
| Баннер на `/manage/` | нет | **нет** ✅ |
| `/privacy/`: `id="cookies"` | есть | ✅ |
| `/privacy/`: «Метрика», «Google Analytics», `ats_consent` | все | ✅ |
| Старая фраза «Отдельный баннер о cookies поэтому не показывается» | убрана | **убрана** ✅ |
| `policy_version` | `2026-11-21` | «Версия 2026-11-21» ✅ |
| `consent_version` в формах | `2026-11-20` — **не изменился** | `/appointment`, `/contacts`, `/otzyvy` = `2026-11-20` = `relay/wrangler.toml` ✅ |

### 5. Регрессии

| Проверка | Ожидание | Факт |
|---|---|---|
| `npm run typecheck` | 0 | **0** ✅ |
| `npm run build` | 0 | **0** ✅ |
| `build:pages` | 0 | **0**, 45 страниц + 404 ✅ |
| `node --test tests/*.test.ts` | 363 + новые, 0 fail | **370 / 370**, 0 fail ✅ |
| `export-robots.test.ts` | новый, зелёный | **7 / 7** ✅ |
| `check-pages` | PASS | PASS в обоих режимах ✅ |
| `check-news --strict` | PASS | **0** ✅ |
| `check-reviews`, `check-reviews-artifact` | PASS | **0**, **0** ✅ |
| `check-prices-sync --refs-only` | PASS | **0** ✅ |
| `check-analytics` (+`--self-test`) | PASS | **0**, **0** ✅ |
| `check-cases`, `check-media-budget` | PASS | **0**, **0** ✅ |
| `/manage/` — вкладки | 4 | photos, prices, reviews, news ✅ |
| Заявка с формы | проходит | `201`, талон `A-1120-9590`, Telegram доставлен ✅ |
| `<title>` листингов уникальны | да | `/news/` «…о ремонте и сезоне», `/news/page/2` «…— страница 2», `/news/cat/sovety` «…: Советы» ✅ |

---

## Дефекты

**Один, и он блокирующий.**

### Б1. PR #101 не смержен — в базе `noindex` на каждой странице

**Где:** `site/scripts/export-pages.mjs:99-101` в `preview/github-pages` (`eae5d54`).

```js
doc.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove());
const robots = doc.createElement('meta');
robots.name = 'robots'; robots.content = 'noindex, nofollow'; doc.head.append(robots);
```

**Воспроизведение:** собрать боевую сборку (`PUBLIC_ORIGIN=https://ats-rostov.ru PUBLIC_BASE_PATH=/`) и открыть любую статью — в `<head>` будет `noindex, nofollow`.

**Ожидаемое:** боевые страницы открыты (как после патча #101).
**Фактическое:** закрыт весь сайт.

**Критичность:** блокер. `robots.txt` разрешает обход, sitemap подан, `BlogPosting` и `og:image` в порядке — но пока в HTML стоит `noindex`, ни Google, ни Яндекс страницу не возьмут. Всё, что сделано в кругах 88–89 по поиску, без этой правки не работает.

**Кому:** не код — **оркестратору**. Работа А10 готова и проверена: **смержить PR #101**.

### Замечание (не блокер, не расхождение с брифом)

Без `PUBLIC_YM_ID`/`PUBLIC_GA_ID` строки `mc.yandex`, `gtag(`, `googletagmanager` встречаются в **одном** файле — JS-бандле `_astro/Base.astro…js`. Это код загрузчика, который читает пустые `data-ym=""` / `data-ga=""` и ничего не грузит; в HTML счётчиков нет, `check-analytics` PASS. Формально формулировка задания («в артефакте **ноль** вхождений») относится к разметке, и она выполнена. Отмечаю, чтобы при следующей приёмке не было сюрприза от `grep` по всему `pages-dist`.

---

## Что осталось владельцу

1. **Смержить PR #101** — это последний технический блокер индексации. После мержа пересобрать и проверить, что на домене в `<head>` статьи нет `noindex`. Могу сделать это сам, если скажете.
2. **Создать счётчик Яндекс.Метрики** → номер в `PUBLIC_YM_ID`.
3. **Создать ресурс GA4** → `G-…` в `PUBLIC_GA_ID`.
4. **Google Search Console:** подтвердить домен (`PUBLIC_GOOGLE_SITE_VERIFICATION`), отправить `https://ats-rostov.ru/sitemap.xml`.
5. **Яндекс.Вебмастер:** то же (`PUBLIC_YANDEX_VERIFICATION`), регион — Ростов-на-Дону.
6. **После подключения счётчиков** — открыть сайт в приватном окне, проверить баннер; нажать «Только необходимые» и убедиться в DevTools → Network, что нет запросов к `mc.yandex.ru` и `googletagmanager.com`; затем «Принять все» и проверить визит в обоих кабинетах; отозвать согласие через «Настройки cookies» и убедиться, что `_ym_*` и `_ga*` почищены после перезагрузки.
7. **Живые отзывы** (остаётся с круга 88): заменить демо настоящими в админке.

---

## Чем подтверждено (вывод команд)

```
# боевая сборка с патчем #101
PUBLIC_ORIGIN=https://ats-rostov.ru PUBLIC_BASE_PATH=/ PUBLIC_DEMO_REVIEWS=0 \
  PUBLIC_LEADS_ENDPOINT=https://ats-leads.ats439.workers.dev npm run build:pages
→ Exported 45 public pages + 404

grep -rl 'name="robots" content="noindex' pages-dist --include=*.html | grep -v '^pages-dist/manage/'
→ pages-dist/services/remont-shin/index.html        (meta-refresh заглушка)
  pages-dist/services/hodovaya-tormoza/index.html   (meta-refresh заглушка)
  pages-dist/services/elektrika/index.html          (meta-refresh заглушка)
  pages-dist/404.html                                (404)
настоящих публичных страниц: 0

PUBLIC_ORIGIN=https://ats-rostov.ru PUBLIC_BASE_PATH=/ node scripts/check-pages.mjs
→ PASS: 50 pages, 3985 local links/assets; manage is noindex; published cases and sitemap checked.
→ EXIT=0

# мутант (старый дефект)
→ AssertionError: FAIL: боевая сборка закрыта от индексации (meta robots noindex): .../about/index.html
→ EXIT=1

# превью
PUBLIC_DEMO_REVIEWS=1 PUBLIC_ORIGIN=https://sledovatel61.github.io PUBLIC_BASE_PATH=/avtotehservis … build:pages
→ страниц 48, без noindex: 0 · robots.txt: Disallow: / · check-pages EXIT=0

# SEO статьи
title len 69 (≤70) · description len 145 (≤200)
canonical = og:url = https://ats-rostov.ru/news/kondicioner-voyah-free
og:type=article · article:published_time=2026-12-04T09:00:00+03:00 · article:modified_time=то же
og:image = https://ats-rostov.ru/img/vy-art-kondicioner-1600.webp
ld+json: BlogPosting + BreadcrumbList
BlogPosting: dateModified, publisher.logo(url=…/img/logo.svg), mainEntityOfPage(WebPage @id), image

# RSS
pages-dist/news/rss.xml — 10 923 байта, <item> = 15 (≤20), XML парсится,
все ссылки https://ats-rostov.ru/news/…, черновиков 0, atom:link rel=self

# аналитика
без ID:  data-ym=""  data-ga=""  · статических <script src="…mc.yandex…"> в HTML — 0 · check-analytics PASS
с  ID:  data-ym="test123"  data-ga="G-TEST123" · ym( в HTML — 0 (грузится только после согласия)
баннер: /, /news/, статья, /about — есть; /manage/ — нет
/privacy/: id="cookies", «Метрика», «Google Analytics», ats_consent — есть;
           «Отдельный баннер о cookies поэтому не показывается» — убрана
policy_version = 2026-11-21 · consent_version = 2026-11-20 (не изменился)

# регрессии
typecheck 0 · build 0 · build:pages 0 · tests 370/370 (export-robots 7/7)
check-pages / check-news --strict / check-reviews / check-reviews-artifact /
check-prices-sync --refs-only / check-analytics (+--self-test) / check-cases /
check-media-budget — все EXIT=0
POST /leads → 201 {"ticket":"A-1120-9590","delivered":{"telegram":true}}
```

### Фрагмент `<head>` боевой статьи (после патча #101)

```html
<title>Кондиционер Voyah Free: сколько фреона и поиск утечки — АвтоТехСервис</title>
<meta name="description" content="Сколько хладагента в системе Voyah Free…">
<link rel="canonical" href="https://ats-rostov.ru/news/kondicioner-voyah-free">
<meta property="og:type" content="article">
<meta property="og:image" content="https://ats-rostov.ru/img/vy-art-kondicioner-1600.webp">
<meta property="article:published_time" content="2026-12-04T09:00:00+03:00">
<meta property="article:modified_time" content="2026-12-04T09:00:00+03:00">
<link rel="alternate" type="application/rss+xml" title="Полезное — АвтоТехСервис" href="/news/rss.xml">
<!-- meta robots отсутствует -->
```

### Первые строки RSS

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>АвтоТехСервис: Полезное — статьи о ремонте и обслуживании</title>
    <link>https://ats-rostov.ru/news</link>
    <language>ru</language>
    <lastBuildDate>Fri, 04 Dec 2026 09:00:00 +0300</lastBuildDate>
    <atom:link href="https://ats-rostov.ru/news/rss.xml" rel="self" type="application/rss+xml"/>
    <item>
      <title>Кондиционер Voyah Free: сколько фреона и поиск утечки</title>
      <link>https://ats-rostov.ru/news/kondicioner-voyah-free</link>
      <guid isPermaLink="true">https://ats-rostov.ru/news/kondicioner-voyah-free</guid>
      <pubDate>Fri, 04 Dec 2026 09:00:00 +0300</pubDate>
```

---

## Итог одной строкой

**Принимаю после мержа PR #101:** правка 135 сделана правильно и защищена гейтом (проверено мутантом), SEO статьи, RSS и согласие на cookies полностью соответствуют заданию, 370/370 тестов и 9 гейтов зелёные, `consent_version` не тронут, заявка проходит — но пока #101 открыт, боевой сайт остаётся закрытым от индексации, и это единственное, что мешает сказать «принимаю» без оговорок.

Код, тесты и гейты не правил. `promts/` не трогал (папки больше нет), отчёт — только в `docs/reports/`.
