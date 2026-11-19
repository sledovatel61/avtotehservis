# Круг 88 · Агент 11 «серверная часть» — убрать хардкод origin и прописать домен

**Ветка:** от `origin/preview/github-pages`, имя `agent/88-origins-domain`. PR — в `preview/github-pages`.
**Роль прежняя:** ты делал `POST /reviews` (PR #73 уже в `preview/github-pages`).
**Объём:** только `relay/**`. Сайт (`site/**`) не трогать — там работа Агента 5 и 10.

## Зачем

Владелец подключил домен **`ats-rostov.ru`** (DNS: A на `185.199.108–111.153`, `www` → CNAME `sledovatel61.github.io`).
Сайт переезжает с `https://sledovatel61.github.io/avtotehservis/` на `https://ats-rostov.ru/`.

После приёмки PR #73 остался долг: в `relay/src/origins.ts` захардкожен список

```ts
const DEFAULT_ORIGINS = ['https://sledovatel61.github.io', 'http://localhost:4321', 'http://127.0.0.1:4321'];
```

Из-за него при переезде на домен форма отзывов получит **403 `{"error":"origin"}`**, пока кто-то не вспомнит про этот файл. Хардкода быть не должно: единственный источник — `env.ALLOWED_ORIGINS` (плюс локальные адреса для `wrangler dev`, если они нужны, — но только когда переменная пуста и `ENVIRONMENT` не production; иначе fail-closed).

## Задача 1 — `relay/src/origins.ts`

1. `DEFAULT_ORIGINS` **удалить**. Источник — только `env.ALLOWED_ORIGINS`, разбитый по запятым, с trim, без пустых элементов.
2. Пустой/отсутствующий `ALLOWED_ORIGINS` → **никакой origin не разрешён** (403 на всё). Локальная разработка задаёт список в `.dev.vars` / `wrangler dev --var`, а не дефолтом в коде.
3. Сравнение origin: точное совпадение строки, без `www`-эвристик и без подстановок; `Origin` отсутствует → 403 (как сейчас).
4. Если `Origin` разбирается в другой регистр/схему/порт — не считать совпадением.
5. В `README` (`relay/README.md`) в разделе про CORS добавить одну строку: «Список источников — только `ALLOWED_ORIGINS`; пустой список = все запросы из браузера отклоняются».

## Задача 2 — `relay/wrangler.toml`

```
ALLOWED_ORIGINS = "https://ats-rostov.ru,https://www.ats-rostov.ru,https://sledovatel61.github.io,http://localhost:4321,http://127.0.0.1:4321"
```

`https://sledovatel61.github.io` оставить: старый адрес ещё живёт и редиректит, а браузер при редиректе сохраняет `Origin` исходной страницы. Комментарий над строкой обновить: домен `ats-rostov.ru` — боевой, `sledovatel61.github.io` — превью.

## Задача 3 — тесты `relay/tests/origins.test.ts` (новый файл)

`node --test`, без сети:

1. `ALLOWED_ORIGINS` из трёх адресов → каждый разрешён, чужой — нет.
2. `ALLOWED_ORIGINS` не задан → `https://sledovatel61.github.io` **не** разрешён (раньше разрешался хардкодом).
3. `ALLOWED_ORIGINS = ''` и `' , '` → ничего не разрешено.
4. Пробелы вокруг адресов в переменной не мешают (`" https://a.ru , https://b.ru "`).
5. `http://ats-rostov.ru` при списке с `https://ats-rostov.ru` → отказ.
6. `Origin` отсутствует → отказ.
7. `POST /reviews` с `Origin: https://ats-rostov.ru` проходит проверку origin (остальные поля — валидные, доставка замокана) → `201`.
8. Существующие `relay/tests/reviews.test.ts` и `relay/tests/leads.test.ts` не ломаются: если они полагались на хардкод, переписать их так, чтобы они задавали `ALLOWED_ORIGINS` в моке `env` явно.

## Проверка перед PR

```
cd relay
npm ci
npx tsc --noEmit
node --test tests/*.test.ts
npx wrangler deploy --dry-run --outdir /tmp/relay-dry
grep -rn "sledovatel61.github.io" src/     # только в комментариях/README, не в коде
```

В теле PR — вывод всех четырёх команд. После мержа workflow «Deploy leads relay» выкатит воркер сам (push в `preview/github-pages` при изменении `relay/**`), `wrangler deploy` руками не запускать.

## Чего не делать

- Не менять контракт `/reviews`, лимиты, тексты уведомлений, `CONSENT_VERSION`.
- Не трогать `site/**`, `docs/**`, `prompts/**`.
- Не добавлять новые секреты и не перевыпускать токен бота.
- Не «чинить» заодно `KV` — `reviewsKv: false` на превью ожидаемо (KV не создан, лимиты живут в памяти изолята).
