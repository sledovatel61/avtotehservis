# Круг 89 · Агент 10 «данные и гейты» — `noindex` на каждой странице закрывает боевой сайт от поиска

**Ветка:** `agent/89-export-robots`, от `origin/preview/github-pages`. PR — в `preview/github-pages`.
**Объём:** `site/scripts/export-pages.mjs` (один блок), `site/tests/export-robots.test.ts` (новый), `.github/workflows/pages.yml` (если нужен шаг). Больше ничего.

---

## Проблема

`site/scripts/export-pages.mjs` при экспорте **каждой** страницы безусловно делает:

```js
doc.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove());
const robots = doc.createElement('meta');
robots.name = 'robots'; robots.content = 'noindex, nofollow'; doc.head.append(robots);
```

Проверено на боевой сборке (`PUBLIC_ORIGIN=https://ats-rostov.ru PUBLIC_BASE_PATH=/`):

```
$ grep -o '<meta name="robots"[^>]*>' pages-dist/news/kondicioner-voyah-free/index.html
<meta name="robots" content="noindex, nofollow">
```

То есть **весь боевой сайт закрыт от индексации на уровне страниц**. `robots.txt` уже открыт (`Allow: /`), sitemap на месте, `BlogPosting` и `og:image` статьи верные — но пока в HTML каждой страницы стоит `noindex`, ни Яндекс, ни Google страницу не возьмут. Это последний технический блокер SEO; всё, что делалось в кругах 88–89 по поиску, без этой правки не работает.

Для превью поведение менять не нужно: там `noindex` — правильный и намеренный.

## Задача

Сделать ровно то, что уже сделано для `robots.txt` в круге 88: **режим определяется теми же переменными**, а не догадкой по содержимому.

| Режим | Условие (как в `robotsTxt`) | Что делать с `<meta name="robots">` |
|---|---|---|
| Превью | `publicOrigin` пустой или равен `https://sledovatel61.github.io`, **или** `base !== '/'` | как сейчас: удалить все и поставить `noindex, nofollow` |
| Боевой | `publicOrigin` задан, не дефолтный, `base === '/'` | **не подменять**: оставить то, что отдал сервер |

Детали:

- «Оставить то, что отдал сервер» — значит не удалять исходные мета-теги (у `/manage` и `/admin` они свои, у остальных страниц `noindex` нет вовсе). Не добавлять `index, follow` насильно: если страница сама себя закрыла (`noindex` у служебных), это её решение.
- Логику режима не дублировать третий раз: в файле уже есть `robotsTxt({ publicOrigin, base })` и `readPublicPath(process.env)`. Вынеси общий предикат, например `isPublicProduction({ publicOrigin, base })`, и используй и в `robotsTxt`, и в новом блоке. Тест `site/tests/robots.test.ts` при этом должен остаться зелёным без правок.
- `doc.body.dataset.demo = '1'` **не трогать**: клиент гасит демо-режим сам, если включена прослойка (`isDemo = data-demo==='1' && !relayMode`), проверено живьём — формы на домене работают.
- `body.dataset.preview = 'true'` тоже оставить как есть.

## Тест `site/tests/export-robots.test.ts`

Чистые проверки (без сборки):

1. `isPublicProduction({ publicOrigin: 'https://ats-rostov.ru', base: '/' })` → `true`.
2. `isPublicProduction({ publicOrigin: 'https://sledovatel61.github.io', base: '/avtotehservis' })` → `false`.
3. `isPublicProduction({ publicOrigin: 'https://ats-rostov.ru', base: '/avtotehservis' })` → `false` (домен + префикс — это ошибка конфигурации, и закрывать/открывать по догадке нельзя).
4. `isPublicProduction({ publicOrigin: '', base: '/' })` → `false`.
5. `applyRobotsMeta(doc, { production })` на документе с `<meta name="robots" content="index, follow">` и без него:
   - `production: true` → мета-теги **не изменены** (тот же `content`, количество то же);
   - `production: false` → ровно один `noindex, nofollow`, исходные удалены.
6. `robotsTxt` для тех же входов даёт прежние результаты (не регрессировал).

Плюс проверка артефакта при наличии `pages-dist` (как в `robots.test.ts`): если текущая сборка боевая — ни в одном HTML нет `noindex, nofollow`, кроме файлов `/manage/**`; если превью — `noindex` есть на всех.

## Гейт

В `site/scripts/check-pages.mjs` добавить одну проверку (он уже умеет отличать режим по env):

- боевая сборка: `pages-dist/**/*.html`, кроме `pages-dist/manage/**`, не содержит `name="robots" content="noindex` → иначе `FAIL`;
- превью: наоборот, `noindex` обязателен на каждой публичной странице.

Причина: этот дефект жил с самого переезда на домен и был найден только при приёмке круга 89. Гейт стоит дешевле, чем ещё один месяц без индексации.

## Проверка перед PR

```
cd site
npm run typecheck
npm run build
# боевая
PUBLIC_ORIGIN=https://ats-rostov.ru PUBLIC_BASE_PATH=/ PUBLIC_DEMO_REVIEWS=0 \
  PUBLIC_LEADS_ENDPOINT=https://ats-leads.ats439.workers.dev npm run build:pages
grep -rl 'name="robots" content="noindex' pages-dist --include=*.html | grep -v '^pages-dist/manage/' ; echo "пусто = ок"
cat pages-dist/robots.txt
node scripts/check-pages.mjs
# превью
PUBLIC_DEMO_REVIEWS=1 PUBLIC_ORIGIN=https://sledovatel61.github.io PUBLIC_BASE_PATH=/avtotehservis npm run build:pages
grep -c 'noindex' pages-dist/index.html
node scripts/check-pages.mjs
node --test tests/*.test.ts        # база 363/363 + новые, 0 fail
```

В PR приложить: вывод обеих сборок, `grep` по артефакту, `robots.txt` в двух режимах, число тестов.

## Запрещено

- Менять `robotsTxt` и его тесты, `CNAME`, `relay/**`, `site/content/**`, `/manage/**`, статьи и SEO-разметку страниц.
- Ставить `canonical` или `og:*` «заодно».
- Убирать `data-demo` / `data-preview` (ими управляет клиент).
- Ослаблять существующие тесты и гейты.
