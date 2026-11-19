# Задание A14 (круг 87): приём отзывов в прослойке (Cloudflare Worker)

**Ветка:** от `origin/preview/github-pages`, имя `agent/r87-reviews-relay`. PR — в `preview/github-pages`.
**Роль:** бэкенд прослойки. Форму рисует A13 (`prompts/109`), админку — A15 (`prompts/111`).

## Что нужно

Новый эндпоинт **`POST /reviews`** в `relay/src/index.ts` (вынести обработчик в `relay/src/reviews.ts` по образцу `relay/src/slots.ts`).

### Контракт

Запрос (JSON, `Content-Type: application/json`):

```json
{
  "author": "Павел И.",
  "text": "Текст отзыва 20–1500 знаков",
  "rating": 5,
  "consent": true,
  "consentVersion": "2026-11-20",
  "honeypot": "",
  "page": "/otzyvy"
}
```

Ответы:

| Код | Тело | Когда |
|---|---|---|
| `201` | `{"ok":true,"status":"pending","id":"<uuid>"}` | принято, отправлено владельцу |
| `400` | `{"error":"validation","fields":{"text":"too_short"}}` | не прошла валидация |
| `400` | `{"error":"consent_version"}` | `consentVersion` ≠ `env.CONSENT_VERSION` |
| `403` | `{"error":"origin"}` | `Origin` не из `ALLOWED_ORIGINS` |
| `429` | `{"error":"rate_limit","retryAfter":60}` | больше лимита |
| `503` | `{"error":"delivery_failed"}` | ни Telegram, ни почта не приняли |

### Валидация (`relay/src/validate.ts`)

- `author`: строка, trim, 2–40 знаков; запрещены `<>`, ссылки (`http`), эмодзи-спам > 3 подряд; обрезать пробелы, `\n` схлопнуть.
- `text`: trim, **20–1500** знаков; без HTML-тегов (вырезать `<>`); без ссылок (если есть `http`/`www` → `400 link_not_allowed`); не более 3 повторяющихся строк.
- `rating`: целое 1–5, обязательно (не по умолчанию 5).
- `consent`: строго `true`.
- `honeypot`: если непусто — вернуть **`201 {"ok":true,"status":"pending","id":"…"}`** и ничего не отправлять (тихая ловушка; не палимся).
- Размер тела ≤ 8 КБ; иначе `413`.

### Доставка владельцу

Отзыв **не публикуется** — только уведомление и модерация руками.

1. Telegram (в существующую группу, `relay/src/telegram.ts`): сообщение
   `⭐ Новый отзыв с сайта (на модерации)\nОценка: 5/5\nИмя: Павел И.\n\nТекст…\n\nОпубликовать: админка → Отзывы (/manage/#reviews)`.
   `link_preview_options: {is_disabled: true}` как у заявок.
2. Почта (если есть ключ, `relay/src/email.ts`): тема `Новый отзыв на сайте — АвтоТехСервис`, в теле те же поля. Использовать существующий механизм `emailFrom`/`EMAIL_TO`, вложения не нужны.
3. Идемпотентность: если включён KV (`ATS_KV`), ключ `review:<sha256(author|text|rating)>` с TTL 24 ч — повторный тот же отзыв не дублирует уведомление, ответ всё равно `201`. Без KV работает в памяти изолята, как у заявок.

### CORS и защита

- `Access-Control-Allow-Origin` — по существующему списку `ALLOWED_ORIGINS` (не расширять хардкодом; новый домен владелец добавит сам при переезде).
- `OPTIONS /reviews` → `204` с теми же заголовками.
- Rate limit: **3 отзыва с одного IP за 10 минут**, затем `429`. Переиспользуй `relay/src/`-механику лимитов заявок, если она есть; если нет — простая map с TTL в памяти изолята и честная пометка в README, что это не глобальный лимит.
- Никаких секретов и PII в логах: текст отзыва в `console.log` не писать, только `id`, длину и результат доставки.
- `/health` дополнить полем `"reviews":true` (и `"reviewsKv":false|true`) — не ломая текущие поля, их читает владелец.

### Документация

- `relay/README.md`: раздел «Отзывы» — контракт, лимиты, что делать при `503`.
- `docs/email-setup.md` — **не трогать** (у владельца своя инструкция, A14 её не переписывает).

## Тесты (`relay/tests/reviews.test.ts`, если в проекте есть тесты воркера; иначе — `node --test` c моками fetch)

1. Валидный отзыв → 201, Telegram вызван один раз, текст совпадает.
2. `rating: 0` / `6` → 400 `validation`.
3. `text` 19 знаков → 400; 20 → 201; 1501 → 400.
4. `consent: false` → 400.
5. Неверный `consentVersion` → 400 `consent_version`.
6. `honeypot` непустой → 201 и **ноль** вызовов Telegram/почты.
7. Ссылка в тексте → 400 `link_not_allowed`.
8. Чужой `Origin` → 403.
9. Четвёртый запрос за 10 минут с одного IP → 429.
10. Telegram упал, почта прошла → 201 (доставка считается успешной); упали оба → 503.

## Проверка

```bash
cd relay && npm ci && npx tsc --noEmit && node --test tests/*.test.ts
npx wrangler deploy --dry-run --outdir /tmp/relay-dry
```

После мержа: Actions → **Deploy leads relay** → Run workflow; затем
`curl -s https://ats-leads.ats439.workers.dev/health` → в ответе `"reviews":true`, а `telegram` и `email` — как были.

## Чего НЕ делать

- Не публиковать отзыв автоматически и не писать его в `site/content/reviews.json` из воркера (у воркера нет доступа к репозиторию).
- Не менять контракт `/leads` и `/slots`, не трогать текст писем-заявок.
- Не перевыпускать токен бота, не менять `EMAIL_TO`.
- Не расширять `ALLOWED_ORIGINS` — это делает владелец при переезде на домен.
