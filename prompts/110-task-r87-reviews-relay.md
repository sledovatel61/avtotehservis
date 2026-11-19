# Круг 87 · Агент 11 «серверная часть» — приём отзывов в прослойке

**Ветка:** от `origin/preview/github-pages`, имя `agent/87-reviews-relay`. PR — в `preview/github-pages`.
**Роль прежняя:** в круге 85 ты делал серверный раздел `/admin/prices` (`site/src/pages/admin/**`, `src/server/prices-admin-store.ts`). Здесь — серверный код прослойки: `relay/**`, где уже живут `/leads` и `/slots`.
**Кто ещё в круге:** Агент 10 (данные сайта), Агент 5 (форма на сайте), Агент 7 (`/manage/`), Агент 12 (приёмка).

## Задача

Новый эндпоинт **`POST /reviews`** в Cloudflare Worker. Обработчик — отдельным модулем `relay/src/reviews.ts` по образцу `relay/src/slots.ts`, подключение — в `relay/src/index.ts`.

### Контракт

Запрос: `application/json`, ≤ 8 КБ (иначе `413`).

```json
{ "author": "Павел И.", "text": "Текст 20–1500 знаков", "rating": 5,
  "consent": true, "consentVersion": "2026-11-20", "honeypot": "", "page": "/otzyvy" }
```

| Код | Тело | Когда |
|---|---|---|
| `201` | `{"ok":true,"status":"pending","id":"<uuid>"}` | принято и отправлено владельцу |
| `400` | `{"error":"validation","fields":{"text":"too_short"}}` | не прошла валидация |
| `400` | `{"error":"consent_version"}` | `consentVersion` ≠ `env.CONSENT_VERSION` |
| `403` | `{"error":"origin"}` | `Origin` не из `ALLOWED_ORIGINS` |
| `429` | `{"error":"rate_limit","retryAfter":60}` | больше лимита |
| `503` | `{"error":"delivery_failed"}` | ни Telegram, ни почта не приняли |

### Валидация (`relay/src/validate.ts`)

- `author`: trim, 2–40 знаков; вырезать `<>`; ссылки → `400 link_not_allowed`.
- `text`: trim, **20–1500** знаков; без HTML (`<>` вырезать); без ссылок (`http`, `www`, `t.me`) → `400 link_not_allowed`; не более 3 одинаковых строк подряд.
- `rating`: целое 1–5, обязательно (никакого значения по умолчанию).
- `consent`: строго `true`.
- `honeypot` непустой → `201 {"ok":true,"status":"pending","id":"…"}` и **ничего** не отправлять (тихая ловушка).

### Доставка владельцу

Отзыв не публикуется — только уведомление, модерация руками в `/manage/` → «Отзывы».

1. Telegram (существующий `relay/src/telegram.ts`, та же группа):
   `⭐ Новый отзыв с сайта (на модерации)` · `Оценка: 5/5` · `Имя: Павел И.` · текст · `Опубликовать: админка → Отзывы`.
   `link_preview_options: {is_disabled: true}` как у заявок. Обязательно экранировать HTML так же, как в заявках.
2. Почта (`relay/src/email.ts`, если ключ есть): тема `Новый отзыв на сайте — АвтоТехСервис`, те же поля, без вложений. Использовать `EMAIL_TO`/`EMAIL_FROM`, ничего не менять.
3. Идемпотентность: при включённом KV (`ATS_KV`) ключ `review:<sha256(author|text|rating)>`, TTL 24 ч — повтор не дублирует уведомление, ответ всё равно `201`. Без KV — память изолята, как у заявок.

### CORS, лимиты, приватность

- `Access-Control-Allow-Origin` — по существующему списку `ALLOWED_ORIGINS`; хардкодом не расширять (новый домен владелец добавит при переезде).
- `OPTIONS /reviews` → `204` с теми же заголовками.
- Лимит: **3 отзыва с одного IP за 10 минут** → `429`. Переиспользуй механику лимитов заявок; если её нет — map с TTL в памяти изолята и честная пометка в README, что лимит не глобальный.
- В логах нет текста отзыва и имени: только `id`, длина и результат доставки.
- `/health` дополнить `"reviews": true` и `"reviewsKv": false|true`, не ломая существующие поля (`telegram`, `email`, `consentVersion` читает владелец).

### Документация

`relay/README.md`: раздел «Отзывы» — контракт, лимиты, что делать при `503`, как проверить curl-ом.

## Тесты `relay/tests/reviews.test.ts` (`node --test` с моками `fetch`)

1. Валидный отзыв → 201, Telegram вызван один раз, текст совпадает.
2. `rating: 0` / `6` → 400 `validation`.
3. `text` 19 знаков → 400; 20 → 201; 1501 → 400.
4. `consent: false` → 400.
5. Неверный `consentVersion` → 400 `consent_version`.
6. `honeypot` непустой → 201 и **ноль** вызовов Telegram и почты.
7. Ссылка в тексте → 400 `link_not_allowed`.
8. Чужой `Origin` → 403.
9. Четвёртый запрос за 10 минут с одного IP → 429.
10. Telegram упал, почта прошла → 201; упали оба → 503.
11. Тело > 8 КБ → 413.

## Проверка

```bash
cd relay && npm ci && npx tsc --noEmit && node --test tests/*.test.ts
npx wrangler deploy --dry-run --outdir /tmp/relay-dry
```

После мержа: Actions → **Deploy leads relay** → Run workflow; затем
`curl -s https://ats-leads.ats439.workers.dev/health` → `"reviews":true`, а `telegram` и `email` — как были.

## Чего НЕ делать

- Не публиковать отзыв автоматически: у воркера нет доступа к репозиторию, и это осознанно.
- Не менять контракт `/leads` и `/slots`, не трогать тексты писем по заявкам.
- Не перевыпускать токен бота, не менять `EMAIL_TO`.
- Не расширять `ALLOWED_ORIGINS` — это делает владелец при переезде на домен.
- Не трогать `site/**` — там Агенты 10, 5 и 7.
