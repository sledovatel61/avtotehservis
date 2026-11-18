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
# {"ok":true,"service":"ats-leads","time":"…","telegram":true,"kv":false}
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

## Разработка

```bash
npm test          # 21 тест, сеть подменена — наружу ничего не уходит
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
