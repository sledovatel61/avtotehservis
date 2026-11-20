# Круг 88 · Агент 11 «серверная часть» — убрать хардкод origin, домен, `Retry-After`

**Ветка:** от `origin/preview/github-pages`, имя `agent/88-origins-domain`. PR — в `preview/github-pages`.
**Что уже сделано тобой:** `POST /reviews` (PR #73) и `/leads`, `/slots` — всё в `preview/github-pages`.
**Объём:** только `relay/**`. Сайт (`site/**`) не трогать — там работа Агентов 5, 7 и 10.

## Зачем

Владелец купил и настроил домен **`ats-rostov.ru`** (A → `185.199.108–111.153`, `www` → CNAME `sledovatel61.github.io`). Сайт переезжает с `https://sledovatel61.github.io/avtotehservis/` на корень `https://ats-rostov.ru/`.

При приёмке PR #73 остались три долга, все внутри `relay/**`:

1. **Хардкод источников.** В `relay/src/origins.ts` есть `DEFAULT_ORIGINS = ['https://sledovatel61.github.io', …]`, и `allowedOrigins()` падает на него, если `ALLOWED_ORIGINS` пуст. После переезда форма отзывов получит `403 {"error":"origin"}`, пока кто-то не вспомнит про этот файл. По заданию было: «список — только из `ALLOWED_ORIGINS`, хардкода не должно быть».
2. **`wrangler.toml` без домена.** `ALLOWED_ORIGINS` содержит только превью и localhost.
3. **`Retry-After` не читается из браузера.** Воркер отдаёт заголовок `retry-after` на `429`, но без `access-control-expose-headers` кросс-доменный JS его не видит (заголовок не safelisted), поэтому форма показывает «Слишком часто» без числа секунд. Это одна строка в `corsHeaders()`.

## Задача 1 — `relay/src/origins.ts`: убрать `DEFAULT_ORIGINS`

1. `DEFAULT_ORIGINS` **удалить** полностью; единственный источник — `env.ALLOWED_ORIGINS`, split по запятым, `trim`, без пустых элементов.
2. Пустой/отсутствующий `ALLOWED_ORIGINS` → **ни один origin не разрешён** (fail-closed). Локальная разработка задаёт список в `.dev.vars` / `wrangler dev --var`, а не дефолтом в коде.
3. Сравнение — точное совпадение строки, без `www`-эвристик, без нормализации схемы/порта. `Origin` отсутствует → `false` (как сейчас).
4. Обновить комментарий в файле: список задаётся только в `wrangler.toml`, здесь дефолтов нет.
5. `relay/README.md`, раздел про CORS — одна строка: «Список источников — только `ALLOWED_ORIGINS`; пустой список = все запросы из браузера отклоняются (fail-closed)».

## Задача 2 — `relay/wrangler.toml`: домен в списке

```
ALLOWED_ORIGINS = "https://ats-rostov.ru,https://www.ats-rostov.ru,https://sledovatel61.github.io,http://localhost:4321,http://127.0.0.1:4321"
```

`sledovatel61.github.io` оставить: старый адрес ещё живёт и редиректит, а при редиректе браузер сохраняет `Origin` исходной страницы. Комментарий над строкой переписать: `ats-rostov.ru` — боевой домен, `sledovatel61.github.io` — превью.

## Задача 3 — `relay/src/index.ts`: `Retry-After` наружу

В `corsHeaders()` добавить:

```ts
'access-control-expose-headers': 'retry-after',
```

Ничего больше в CORS не менять. Существующий тест на заголовки (если есть) дополнить этой строкой.

## Задача 4 — тесты `relay/tests/origins.test.ts` (новый файл)

`node --test`, без сети:

1. `ALLOWED_ORIGINS` из трёх адресов → каждый разрешён, чужой — нет.
2. `ALLOWED_ORIGINS` не задан → `https://sledovatel61.github.io` **не** разрешён (до фикса разрешался хардкодом).
3. `ALLOWED_ORIGINS = ''` и `= ' , '` → не разрешено ничего.
4. Пробелы вокруг адресов не мешают: `" https://a.ru , https://b.ru "`.
5. `http://ats-rostov.ru` при списке с `https://ats-rostov.ru` → отказ.
6. `Origin` отсутствует → отказ.
7. `POST /reviews` с `Origin: https://ats-rostov.ru` (остальные поля валидные, доставка замокана) → `201`.
8. `OPTIONS /reviews` с разрешённым origin → `204` и `access-control-expose-headers: retry-after`.
9. Существующие `relay/tests/reviews.test.ts` и `leads.test.ts` не ломаются: если они полагались на хардкод, пусть задают `ALLOWED_ORIGINS` в моке `env` явно.

## Задача 5 — KV для лимитов (по возможности, не блокер)

Сейчас `/health` отдаёт `"reviewsKv": false`: лимит «3 отзыва за 10 минут» живёт в памяти изолята и на нескольких изолятах не общий. Попробуй включить:

```
npx wrangler kv namespace create ATS_KV
```

Полученный `id` вписать в закомментированный блок `[[kv_namespaces]]` в `wrangler.toml`, раскомментировать, задеплоить через PR (деплой сделает workflow). В теле PR написать, включилось ли (`/health` → `"reviewsKv": true`) или токен не даёт прав на KV — тогда просто оставить как есть и отметить в PR. **Ничего не выдумывать и id не подделывать.**

## Проверка перед PR

```
cd relay
npm ci
npx tsc --noEmit
node --test tests/*.test.ts
npx wrangler deploy --dry-run --outdir /tmp/relay-dry
grep -rn "sledovatel61.github.io" src/     # только в комментариях, не в коде
```

В теле PR — вывод всех пяти команд. Deploy после мержа сделает workflow «Deploy leads relay», руками `wrangler deploy` не запускать.

## Чего не делать

- Не менять контракт `/reviews`, лимиты, тексты уведомлений, `CONSENT_VERSION`, формат письма.
- Не трогать `site/**`, `docs/**`, `prompts/**`.
- Не добавлять секретов и не перевыпускать токен бота.
