# ats-leads — прослойка «сайт на GitHub Pages → Telegram»

Сайт статический, сервера у него нет, поэтому заявки принимает маленький Cloudflare Worker.
Он проверяет данные, отбивает спам и отправляет заявку сообщением в Telegram.

```
форма на сайте  →  POST https://ats-leads.<аккаунт>.workers.dev/leads  →  Telegram (чат владельца)
```

Контракт запроса и ответа — из задания 80-1 (`prompts/97-task-r80-leads-relay-site.md`):
поля те же, что у серверной формы, менять их нельзя.

| Метод | Ответ |
|---|---|
| `GET /health` | `{ ok, service: 'ats-leads', time, telegram, kv }` |
| `GET /slots?date=ГГГГ-ММ-ДД` | `{ date, slots: [{ time, available, reason? }] }` — оставлено для совместимости |
| `POST /leads` | `201 { ticket, lead_id: 0, status: 'accepted', duplicate }` |
| ошибка полей | `400 { error: { code: 'validation', message, fields } }` |
| старый текст согласия | `400 { error: { code: 'consent_version' } }` |
| спам | `201` с талоном, но сообщение не отправляется (бот не должен понять, что его раскусили) |
| лимит | `429 { error: { code: 'too_many' } }` + `Retry-After` |
| Telegram недоступен | `502 { error: { code: 'telegram' } }` — форма предложит позвонить |

## Что нужно до деплоя

1. Аккаунт Cloudflare (бесплатного тарифа хватает: 100 000 запросов в сутки).
2. Токен бота от **@BotFather** — только в секрет, никогда в репозиторий.
3. `chat_id` получателя: личный чат (боту сначала нужно нажать Start) или группа
   (добавить бота и написать `/start@имя_бота`, id будет отрицательным, `-100…`).
   Как достать: `https://api.telegram.org/bot<ТОКЕН>/getUpdates` → `"chat":{"id":…}`.

## Деплой

### Вариант А — через GitHub Actions (рекомендуется, ничего ставить не надо)

Workflow `.github/workflows/relay.yml` заливает воркер сам. Нужно один раз добавить в
**Settings → Secrets and variables → Actions** четыре секрета:

| секрет | обязателен | откуда |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | да | My Profile → API Tokens → Create Token → шаблон **Edit Cloudflare Workers** |
| `BOT_TOKEN` | да | @BotFather, `/newbot` или `/token` |
| `TELEGRAM_CHAT_ID` | да | число из `getUpdates` (личный чат) или `-100…`/`-5…` (группа) |
| `CLOUDFLARE_ACCOUNT_ID` | нет | если не задан, workflow определяет его сам по токену |

Дальше — **Actions → Deploy leads relay → Run workflow** (или любой push в `preview/github-pages`,
если менялось в `relay/`). В логе будет адрес воркера `https://ats-leads.<аккаунт>.workers.dev`.

#### Если в аккаунте нет доменов

Шаблон **Edit Cloudflare Workers** добавляет политику *Zone → Workers Routes Write* с выбором
конкретной зоны. У нового аккаунта зон нет — выпадающий список пуст, и кнопка «Continue to summary»
не пускает («Choose a zone resource»). Для выкатки воркера на `*.workers.dev` зоны не нужны:

1. В поле **Token name** напишите `ats-leads` — без имени токен не создать.
2. В блоке **Edit Zone policy** нажмите иконку удаления (корзина) — политика уйдёт.
3. Оставьте **Account policy** (Workers Scripts: Edit, Workers KV Storage: Edit, Account Settings:
   Read) и **User policy** (User Details: Read, Memberships: Read). В Account policy ресурс —
   **Include → All accounts** либо ваш аккаунт.
4. **Continue to summary → Create Token**, токен копируется один раз.

### Вариант Б — локально

```bash
cd relay
npm install                      # wrangler + typescript
npx wrangler login               # один раз, откроется браузер
npx wrangler secret put BOT_TOKEN          # вставить токен
npx wrangler secret put TELEGRAM_CHAT_ID   # вставить chat_id
npx wrangler deploy
```

После `deploy` wrangler напишет адрес вида
`https://ats-leads.<аккаунт>.workers.dev` — это и есть `PUBLIC_LEADS_ENDPOINT` для сайта.

### Проверка

```bash
curl -s https://ats-leads.<аккаунт>.workers.dev/health
# {"ok":true,"service":"ats-leads","time":"…","telegram":true,"kv":false,"reviews":true,"reviewsKv":false}
```

`telegram:false` — не заданы секреты. Дальше живая проверка: отправить заявку с сайта
(или `curl`-ом с телом из `test/relay.test.ts`) и убедиться, что сообщение пришло в чат.

### KV (необязательно, но желательно)

Без KV лимиты и идемпотентность живут в памяти изолята и сбрасываются при его перезапуске:
повторная отправка может создать второе сообщение, а лимит — обнулиться. С KV они живут
в хранилище.

```bash
npx wrangler kv namespace create ATS_KV
# в выводе будет id — вписать в wrangler.toml, раскомментировав [[kv_namespaces]]
npx wrangler deploy
```

## Включение на сайте

Сайт включает прослойку одной переменной сборки (см. `site/src/shared/leads-endpoint.ts`):

1. В GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**
   `PUBLIC_LEADS_ENDPOINT` = `https://ats-leads.<аккаунт>.workers.dev` (без слэша в конце).
2. В `.github/workflows/pages.yml` шаг сборки должен её пробрасывать:

   ```yaml
   - run: npm run build:pages
     working-directory: site
     env:
       PUBLIC_LEADS_ENDPOINT: ${{ vars.PUBLIC_LEADS_ENDPOINT }}
   ```

3. Пересобрать превью (push в `preview/github-pages`). Проверка: в исходниках страницы
   появился адрес воркера, демо-плашка на отправке больше не показывается, заявка приходит
   в Telegram.

Пока переменная не задана, сайт остаётся в демо-режиме — это нормальное состояние.

Когда появится домен, добавить его origin в `ALLOWED_ORIGINS` в `wrangler.toml` и передеплоить:
без этого браузер заблокирует запрос (CORS).

## Отзывы

`POST /reviews` — приём отзывов с сайта. Отзыв **не публикуется автоматически**: у воркера
нет доступа к репозиторию, и это осознанно. Прослойка только проверяет текст и отправляет
уведомление владельцу — в ту же группу Telegram и, если настроена почта, письмом. Дальше
человек открывает админку → «Отзывы» и решает, публиковать ли.

### Контракт

Запрос: `application/json`, **не больше 8 КБ** (иначе `413`).

```json
{ "author": "Павел И.", "text": "Текст 20–1500 знаков", "rating": 5,
  "consent": true, "consentVersion": "2026-11-20", "honeypot": "", "page": "/otzyvy" }
```

| Код | Тело | Когда |
|---|---|---|
| `201` | `{"ok":true,"status":"pending","id":"<uuid>"}` | принято и отправлено владельцу |
| `400` | `{"error":"validation","fields":{"text":"too_short"}}` | не прошла проверка полей |
| `400` | `{"error":"link_not_allowed","fields":{"text":"link_not_allowed"}}` | в тексте или имени ссылка |
| `400` | `{"error":"consent_version"}` | `consentVersion` ≠ `CONSENT_VERSION` воркера |
| `403` | `{"error":"origin"}` | `Origin` не из `ALLOWED_ORIGINS` |
| `413` | `{"error":"too_large"}` | тело больше 8 КБ |
| `429` | `{"error":"rate_limit","retryAfter":60}` | больше 3 отзывов за 10 минут с одного адреса |
| `503` | `{"error":"delivery_failed"}` | ни Telegram, ни почта не приняли |

Коды полей в `fields`: `required`, `too_short`, `too_long`, `out_of_range`,
`repeated_lines`, `link_not_allowed`, `bad_json`.

Правила:

- `author` — 2–40 знаков после `trim`; угловые скобки вырезаются;
- `text` — 20–1500 знаков; HTML не принимается (скобки вырезаются), ссылки
  (`http`, `www`, `t.me`, домен вида `example.ru`) → `400 link_not_allowed`;
  больше трёх одинаковых строк подряд → `400` (накрутка);
- `rating` — целое 1–5, **обязательно**: значения по умолчанию нет, иначе пропуск поля
  превращался бы в «пять звёзд»;
- `consent` — строго `true`;
- `consentVersion` — должен совпадать с `CONSENT_VERSION` воркера;
- `honeypot` непустой → `201` и **ни одного** сообщения (тихая ловушка для ботов:
  по ответу её не отличить от обычного приёма);
- пустой `page` заменяется на `/otzyvy`.

### Доставка и повторы

Сначала Telegram, параллельно — почта (если задан `BREVO_API_KEY` или `RESEND_API_KEY`).
Отзыв считается принятым, если сработал **хотя бы один** канал. Тема письма —
`Новый отзыв на сайте — АвтоТехСервис`, вложений нет; адреса `EMAIL_TO`/`EMAIL_FROM` те же,
что у заявок.

Повторная отправка того же отзыва в течение 24 часов не дублирует уведомление: ключ
`review:<sha256(author|text|rating)>` в KV (`ATS_KV`), без KV — в памяти изолята.
Ответ в обоих случаях `201` с тем же `id` — человек не должен видеть ошибку из-за
двойного клика.

### Лимиты и приватность

- 3 отзыва с одного адреса за 10 минут. Счётчик — тот же механизм, что у заявок
  (`rl:review:<hash(ip)>`): с KV лимит общий для всех изолятов, без KV — в памяти
  одного изолята, то есть **не глобальный** (при всплеске трафика запросы попадают
  в разные изоляты и лимит считается независимо в каждом).
- `Origin` проверяется до чтения тела: чужой сайт не тратит наш лимит.
- CORS — только по списку `ALLOWED_ORIGINS`. Новый домен дописывает владелец
  в `wrangler.toml` при переезде; хардкода адресов в коде нет.
- `OPTIONS /reviews` → `204` с теми же заголовками.
- В логах только `id`, длина текста и результат доставки. Ни текста отзыва,
  ни имени там нет — они уходят только в Telegram и на почту владельца.
- `/health` отдаёт `"reviews": true` и `"reviewsKv": false|true` рядом с прежними
  полями (`telegram`, `email`, `consentVersion`, `kv`).

### Проверка curl-ом

```bash
curl -i -X POST https://ats-leads.ats439.workers.dev/reviews \
  -H 'content-type: application/json' \
  -H 'origin: https://sledovatel61.github.io' \
  -d '{"author":"Павел И.","text":"Менял масло и колодки, всё сделали быстро и аккуратно","rating":5,"consent":true,"consentVersion":"2026-11-20","honeypot":"","page":"/otzyvy"}'
# HTTP/1.1 201 Created
# {"ok":true,"status":"pending","id":"…"}
```

Запрос должен уходить **с заголовком `origin` из списка** — без него будет `403`
(так отсекаются запросы не с сайта). После `201` сообщение «⭐ Новый отзыв с сайта
(на модерации)» появляется в группе, письмо — на `EMAIL_TO`, если почта включена.
Повтор того же запроса даст тот же `id` и не продублирует уведомление.

### Что делать при `503`

`503 delivery_failed` значит, что **ни один** канал не принял уведомление — отзыв
не сохранён нигде, и человеку честно предложено повторить позже. Что проверить:

1. `/health` → `telegram`: если `false`, не заданы `BOT_TOKEN`/`TELEGRAM_CHAT_ID`
   (Actions → «Deploy leads relay» → шаг «Push secrets to worker»).
2. Если `telegram: true`, а `503` повторяется — смотреть логи воркера:
   `wrangler tail` или дашборд Cloudflare → Workers → `ats-leads` → Logs.
   Строки `[reviews] telegram failed <id> …` и `[reviews] email failed <id> …`
   содержат код ошибки, но не текст отзыва.
3. Токен бота не перевыпускать: его смена — отдельное решение владельца.
   Чаще всего помогает повторный запуск workflow с секретами.

## Разработка

```bash
npm test          # 58 тестов (заявки, слоты, отзывы), сеть подменена — наружу ничего не уходит
npm run typecheck # tsc по src/
npx wrangler dev  # локальный запуск, секреты берутся из .dev.vars
```

Для локального запуска создайте `relay/.dev.vars` (в git не попадает):

```
BOT_TOKEN=…
TELEGRAM_CHAT_ID=…
```

## Что важно помнить

- **Токен — это пароль от бота.** Только `wrangler secret put`, никаких токенов в коде,
  в `wrangler.toml`, в issues и в чатах. Если засветился — `/revoke` в BotFather.
- Телефоны в логи не пишутся: только коды ошибок, IP — в виде хэша.
- Время визита на сайте — **пожелание** клиента (сервис работает в порядке живой очереди),
  в сообщении это прямо написано: «Время предварительное — подтвердить звонком».
- Фото в режиме прослойки не передаются (`relayMode` в клиенте их не отправляет): Worker
  не хранит файлы. Если понадобятся — отдельная задача с R2.

## Фотографии в заявке

Шаг 2 формы записи принимает до 3 фотографий. Снимок сжимается в браузере
(canvas, длинная сторона 1600 px, JPEG 0.82), поэтому с телефона в сервис уходит
~300–500 КБ вместо 4 МБ. Метаданные (включая GPS/EXIF) при перекодировании теряются.

Заявка с фото отправляется как `multipart/form-data`:

| Поле | Что это |
|---|---|
| `payload` | JSON заявки — ровно тот же контракт, что и раньше |
| `photo` | файлы, до 3 штук, только изображения |

Без фото клиент присылает прежний JSON — старый контракт остаётся рабочим.
Воркер проверяет: не больше 3 файлов, только `image/*` (SVG не принимается),
не больше 6 МБ на файл и 20 МБ на запрос. После отправки текста заявки фото уходят
в группу отдельными сообщениями `sendPhoto` с подписью «Фото N к заявке A-ММДД-XXXX».
Если фото не доставились, заявка всё равно считается принятой: текст с телефоном
уже в группе, клиент получает `201`.

## Дубль заявки на почту

Каждая заявка уходит в Telegram **и** письмом на `Pavel.yakovenko@mail.ru`
(адрес задан переменной `EMAIL_TO` в `wrangler.toml`). Фото прикладываются
к письму вложениями (до 3 штук, каждая уже сжата в браузере).

Смысл дубля: если Telegram недоступен или сообщение в группе потерялось,
заявка всё равно остаётся у владельца в почте. Логика доставки:

| Что произошло | Ответ клиенту |
|---|---|
| дошли оба канала | 201, `delivered: {telegram: true, email: true}` |
| дошёл только Telegram или только почта | 201, во втором канале `false` |
| не дошёл ни один | 502, клиент видит «позвоните нам» |

### Как включить (один раз, 10 минут)

Worker не умеет SMTP, поэтому письмо идёт через HTTP-API почтового сервиса.
Поддерживаются два — включается тот, чей ключ лежит в секретах GitHub.

**Вариант 1 — Resend (проще, без домена).**

1. Зарегистрироваться на https://resend.com **на адрес `Pavel.yakovenko@mail.ru`** —
   это важно: без своего домена Resend разрешает отправку с `onboarding@resend.dev`
   только на адрес владельца аккаунта, а нам именно туда и нужно.
2. API Keys → Create API Key → скопировать ключ (`re_…`).
3. GitHub → `sledovatel61/avtotehservis` → Settings → Secrets and variables → Actions →
   New repository secret: имя `RESEND_API_KEY`, значение — ключ.
4. Запустить workflow «Deploy leads relay» (Actions → Run workflow) — он сам
   положит ключ в воркер. В логе шага «Push secrets to worker» будет «Почта: Resend подключён».
5. Проверить: `https://ats-leads.ats439.workers.dev/health` → `"email":"resend"`.

**Вариант 2 — Brevo (если нужен свой отправитель).**

1. Регистрация на https://brevo.com → Senders → добавить `Pavel.yakovenko@mail.ru`
   и подтвердить письмом (домен не нужен, это «single sender»).
2. SMTP & API → API Keys → создать ключ.
3. Секрет GitHub `BREVO_API_KEY` (как в п. 3 выше), запустить деплой.
4. Если хотите другой адрес отправителя — переменная `EMAIL_FROM` в `wrangler.toml`
   (адрес должен быть подтверждён в Brevo).

### Что писать в ответ не нужно

Ключ — это секрет: он живёт в GitHub Secrets и в воркере, в репозиторий и в чат
он не попадает. В письме и в логах воркера ключа нет.
