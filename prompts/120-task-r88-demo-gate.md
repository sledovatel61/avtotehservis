# Круг 88 · Агент 10 «данные, схема, гейты» — на боевой сборке демо-отзывов быть не может

**Ветка:** от `origin/preview/github-pages`, имя `agent/88-demo-gate`. PR — в `preview/github-pages`.
**Что уже сделано тобой:** `reviews.json`, схема, `check-reviews.mjs`, вынос `PUBLIC_ORIGIN`/`PUBLIC_BASE_PATH` (PR #75) — в `preview/github-pages`.
**Объём:** `site/scripts/check-reviews.mjs` (или новый скрипт рядом), `.github/workflows/pages.yml`, тест, одна строка в `docs/domain-switch.md`. Воркер, `/otzyvy`, админку не трогать.

## Зачем

Правило владельца: **выдуманные оценки на боевом сайте запрещены**. Сейчас защита держится на переменной `PUBLIC_DEMO_REVIEWS=0`, которую надо не забыть создать в Settings → Variables. Если забыть — на домене `ats-rostov.ru` окажутся шесть отзывов «пример» и средняя 4,8 из выдуманных оценок. Забыть легко: переменных три, заполняются руками.

Нужен гейт, который делает это невозможным: **на сборке под собственный домен** (`PUBLIC_BASE_PATH=/`) в артефакте не должно остаться ни одного демо-отзыва.

`check-reviews.mjs --strict` уже падает, если в `reviews.json` есть `demo: true`, но в CI он запускается без флага (на превью демо нужны), и он смотрит файл, а не то, что реально попало на страницу.

## Задача

1. Новый скрипт `site/scripts/check-reviews-artifact.mjs` — проверка **собранного** `pages-dist`:
   - читает `pages-dist/otzyvy/index.html` (если файла нет — падать с понятным текстом);
   - если сборка боевая (`PUBLIC_BASE_PATH === '/'`), требует: **ноль** вхождений `rev-demo` (чип «пример») и **ноль** текстов записей с `demo: true` из `site/content/reviews.json` (берите подстроки первых 40 знаков текста, чтобы не зависеть от форматирования);
   - если сборка превью (`/avtotehservis`) — печатает сводку (`примеров N — превью, допустимо`) и выходит с кодом 0;
   - `--require-empty` — принудительно считать сборку боевой (для ручной проверки);
   - ошибки печатать списком: `ОШИБКА: на боевой сборке найден демо-отзыв «<id>»`.
2. `pages.yml`: после шага `node scripts/check-reviews.mjs` добавить шаг
   `- run: node scripts/check-reviews-artifact.mjs` с теми же `PUBLIC_BASE_PATH: ${{ vars.PUBLIC_BASE_PATH }}` в `env` (иначе скрипт не узнает, боевая ли сборка).
3. Скрипт должен экспортировать **чистую функцию** проверки, чтобы её тестировать без сборки:

   ```js
   // проверяет готовый HTML и данные, ничего не читает с диска
   export function findDemoInArtifact({ html, items, basePath })
   // → { ok: true, demoCount } | { ok: false, problems: ['демо-отзыв «r-2026-11-14-001» в /otzyvy', …] }
   ```

   CLI (`node scripts/check-reviews-artifact.mjs`) — тонкая обёртка: читает `pages-dist/otzyvy/index.html` и `site/content/reviews.json`, берёт `PUBLIC_BASE_PATH`, печатает результат, выходит 0/1/2.

4. Тест `site/tests/reviews-artifact.test.ts` — на чистой функции, без сборки:
   - `basePath='/avtotehservis'`, HTML с чипами `rev-demo` → `ok: true` (превью, демо разрешены);
   - `basePath='/'`, HTML с чипами → `ok: false`, в `problems` есть id демо-отзывов (это и есть защита от «забыл переменную»);
   - `basePath='/'`, HTML с шестью демо-записями в `items`, но без чипов и без текстов на странице → `ok: true` (в артефакт не попало — не страшно);
   - `basePath='/'`, HTML без чипа, но с текстом демо-отзыва → `ok: false` (ловит утечку текста без чипа);
   - файла `pages-dist/otzyvy/index.html` нет → CLI выходит 2 и пишет понятный текст.

   Отдельным кейсом (не в CI-тесте, а руками в PR) — реальные сборки из блока проверки ниже: превью + демо → 0, домен + демо → 1.
5. `docs/domain-switch.md` — в шаг 2 добавить одну строку: «Если `PUBLIC_DEMO_REVIEWS` забыть, сборка упадёт на гейте `check-reviews-artifact` — это защита, а не поломка».

## Проверка перед PR

```
cd site
npm ci
npm run typecheck
npm run build
PUBLIC_DEMO_REVIEWS=1 npm run build:pages
node scripts/check-reviews-artifact.mjs                     # 0 (превью)
PUBLIC_ORIGIN=https://ats-rostov.ru PUBLIC_BASE_PATH=/ PUBLIC_DEMO_REVIEWS=1 npm run build:pages
node scripts/check-reviews-artifact.mjs                     # 1 (защита сработала)
PUBLIC_ORIGIN=https://ats-rostov.ru PUBLIC_BASE_PATH=/ PUBLIC_DEMO_REVIEWS=0 npm run build:pages
node scripts/check-reviews-artifact.mjs                     # 0 (боевая чистая)
node --test tests/reviews-artifact.test.ts
```

В теле PR — вывод всех шести команд.

## Чего не делать

- Не менять UI `/otzyvy`, форму отзыва и админку (Агенты 5 и 7 работают там же параллельно).
- Не менять `reviews.json` и его схему.
- Не включать `--strict` для превью: демо-отзывы на превью нужны, их видит владелец.
- Не менять `PUBLIC_ORIGIN`/`PUBLIC_BASE_PATH` логику из PR #75.
