# Круг 88 · Агент 10 «данные и гейты» — `robots.txt` закрывает боевой домен от поиска

**Ветка:** от `origin/preview/github-pages`, имя `agent/88-robots`. PR — в `preview/github-pages`.
**Объём:** `site/scripts/export-pages.mjs` (одна функция), тест, `.github/workflows/pages.yml` — только если понадобится. Больше ничего.

## Проблема (нашёл Агент 12 при приёмке, подтверждено на живом домене)

`site/scripts/export-pages.mjs:172` жёстко пишет в артефакт:

```js
await writeFile(join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
```

Для превью это правильно: превью не должно попадать в поиск. Но теперь **тот же файл отдаётся с `https://ats-rostov.ru/robots.txt`** — проверено живьём:

```
$ curl https://ats-rostov.ru/robots.txt
User-agent: *
Disallow: /
```

То есть боевой сайт закрыт от Яндекс.Карт, Google и всех остальных. Сайт на домене живёт с 19.11, а его не проиндексируют, пока это не исправлено. Это последний блокер запуска.

## Задача 1 — `robots.txt` зависит от режима сборки

В `export-pages.mjs` писать по правилу (значения уже есть в `./lib/public-path.mjs` — используй `readPublicPath(process.env)`):

| Режим | Условие | Содержимое `robots.txt` |
|---|---|---|
| Превью | `publicOrigin` — дефолтный (`https://sledovatel61.github.io`) **или** `base !== '/'` | `User-agent: *` + `Disallow: /` (как сейчас) |
| Боевой | `publicOrigin` задан и не дефолтный (`https://ats-rostov.ru`) **и** `base === '/'` | `User-agent: *` + `Allow: /` + пустая строка + `Sitemap: <publicOrigin>/sitemap.xml` |

Точный ожидаемый файл для боевой сборки:

```
User-agent: *
Allow: /
Disallow: /manage

Sitemap: https://ats-rostov.ru/sitemap.xml
```

`Disallow: /manage` — обязательно: мастерская не для индексации (у неё уже `noindex`, но `robots` надёжнее). Ничего другого не закрывать: `/admin` в статике нет вовсе.

Никаких «угадываний» по содержимому `pages-dist` — только по тем же переменным, что задают `CNAME` и префикс.

## Задача 2 — тест `site/tests/robots.test.ts`

Проверять **чистую функцию** (вынеси её, например `export function robotsTxt({ publicOrigin, base })`), без сборки:

1. `{ publicOrigin: 'https://sledovatel61.github.io', base: '/avtotehservis' }` → `Disallow: /`, строки `Allow:` и `Sitemap:` нет.
2. `{ publicOrigin: 'https://ats-rostov.ru', base: '/' }` → `Allow: /`, `Disallow: /manage`, `Sitemap: https://ats-rostov.ru/sitemap.xml`, и **нет** строки `Disallow: /` без `/manage` (проверить именно так, чтобы не поймать подстроку).
3. Пустые значения (дефолты) → как превью.
4. `{ publicOrigin: 'https://ats-rostov.ru', base: '/avtotehservis' }` (домен, но префикс) → как превью: закрыто. Такое сочетание — ошибка конфигурации, и `robots` не должен её «исправлять» в пользу индексации.

Плюс одна проверка по артефакту (в том же файле, при наличии `pages-dist`): содержимое `pages-dist/robots.txt` совпадает с `robotsTxt(readPublicPath(...))` для текущих переменных.

## Задача 3 — `check-pages.mjs` (по желанию, если просто)

Если в `check-pages.mjs` уже есть проверка `robots.txt` — дополнить: на боевой сборке (`PUBLIC_BASE_PATH=/`) в нём не должно быть `Disallow: /` без `/manage`. Если проверки нет, добавлять не нужно — хватит теста.

## Проверка перед PR

```
cd site
npm ci
npm run typecheck
npm run build
PUBLIC_LEADS_ENDPOINT=https://ats-leads.ats439.workers.dev PUBLIC_DEMO_REVIEWS=1 npm run build:pages
cat pages-dist/robots.txt                                   # Disallow: /
PUBLIC_ORIGIN=https://ats-rostov.ru PUBLIC_BASE_PATH=/ PUBLIC_DEMO_REVIEWS=0 PUBLIC_LEADS_ENDPOINT=https://ats-leads.ats439.workers.dev npm run build:pages
cat pages-dist/robots.txt                                   # Allow: / + Disallow: /manage + Sitemap
node scripts/check-pages.mjs                                # с PUBLIC_ORIGIN/PUBLIC_BASE_PATH
node --test tests/robots.test.ts tests/reviews-artifact.test.ts
node --test tests/*.test.ts                                 # ожидается 311/311 + новые
```

В теле PR — вывод всех команд и оба `robots.txt` целиком. После мержа гейт в `pages.yml` проверит это на следующей сборке; снаружи проверю `https://ats-rostov.ru/robots.txt`.

## Чего не делать

- Не менять `CNAME`, `sitemap.xml`, префиксы, `PUBLIC_DEMO_REVIEWS` и логику `public-path.mjs` (она из PR #75 и работает).
- Не трогать `relay/**`, `/manage/**`, `/admin/**`, `reviews.json`, `pages.yml` (кроме случая, если тебе правда нужен новый шаг — тогда обосновать в PR).
- Не добавлять `Disallow` для публичных страниц и не закрывать `/otzyvy`.
- Не удалять закрытие для превью: превью в поиске не нужно.
