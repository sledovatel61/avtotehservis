# Круг 88 · Агент 5 «разработчик сайта» — ошибки формы отзыва: показать, что именно не так

**Ветка:** от `origin/preview/github-pages`, имя `agent/88-form-errors`. PR — в `preview/github-pages`.
**Что уже сделано тобой:** страница `/otzyvy` и форма (PR #76) — в `preview/github-pages`.
**Объём:** `site/src/client/review-form.ts`, `site/src/pages/otzyvy.astro` (только атрибуты/тексты, если понадобится), новый тест. Гейты и сборку не трогать — там Агент 10.

## Что не так (проверено при приёмке PR #76)

Форма ждёт от воркера **вложенный** ответ, как у заявок:

```ts
const j = await res.json() as { error?: { message?: string; fields?: Record<string, string> } };
const fields = j?.error?.fields ?? {};
```

А `POST /reviews` (PR #73) отдаёт **плоский**, по заданию №110:

| Код | Тело |
|---|---|
| `400` | `{"error":"validation","fields":{"text":"too_short"}}` |
| `400` | `{"error":"link_not_allowed","fields":{"text":"link_not_allowed"}}` |
| `400` | `{"error":"consent_version"}` |
| `403` | `{"error":"origin"}` |
| `413` | `{"error":"too_large"}` |
| `429` | `{"error":"rate_limit","retryAfter":60}` + заголовок `retry-after` |
| `503` | `{"error":"delivery_failed"}` |

Следствия: `j.error.fields` = `undefined` → под полями **ничего не подсвечивается**, а вместо причины человек видит общее «Отзыв не принят — проверьте текст и оценку». Плюс в `fields` лежат **коды** (`too_short`, `repeated_lines`), а не русские тексты, и ключ согласия — `consentVersion`, а не `consent`.

Ещё: `retry-after` читается только из заголовка. Если воркер отдаст `429` без заголовка (или прокси его срежет), секунды не покажутся — надо падать на `retryAfter` из тела.

## Задача

1. Разбирать **оба** формата: плоский (`{error:'validation', fields:{…}}`) и вложенный (`{error:{code,message,fields}}`) — форма ходит в один и тот же воркер, и стойкость к обоим форматам дешевле, чем ещё один разбор полётов.
2. Коды полей → русские тексты (ключи `author`, `text`, `rating`, `consent`, `consentVersion`):

| Поле | Код | Текст под полем |
|---|---|---|
| `author` | `required` | Укажите имя |
| `author` | `too_short` | Имя — от 2 до 40 символов |
| `author` | `too_long` | Имя — до 40 символов |
| `author` | `link_not_allowed` | Ссылки в имени не нужны — уберите адрес |
| `text` | `required` | Напишите текст отзыва |
| `text` | `too_short` | Текст — от 20 знаков: что делали и как приняли |
| `text` | `too_long` | Текст — до 1500 знаков |
| `text` | `repeated_lines` | Похоже на повтор одного и того же — напишите своими словами |
| `text` | `link_not_allowed` | Ссылки в отзыве не нужны — уберите `http`, `www`, `t.me` |
| `rating` | `required`, `out_of_range` | Поставьте оценку от 1 до 5 |
| `consent` / `consentVersion` | `required` | Поставьте галочку согласия |

Неизвестный код или неизвестное поле — не выдумывать текст, показать общее сообщение (как сейчас).
3. Отдельные сообщения для статусов:
   - `400 {"error":"consent_version"}` → «Документ согласия обновился. Обновите страницу и подтвердите согласие ещё раз.»
   - `403 {"error":"origin"}` → «Отправка с этого адреса недоступна. Напишите нам на {email} или позвоните: {phone}.»
   - `413 {"error":"too_large"}` → «Отзыв слишком длинный — сократите до 1500 знаков.»
   - `503 {"error":"delivery_failed"}` → «Не получилось передать отзыв. Попробуйте через минуту или позвоните: {phone}.»
4. `429`: секунды брать из заголовка `retry-after`, а если его нет — из тела `retryAfter`. Диапазон разумный: 1–3600, иначе не показывать число.
5. Ничего не менять в разметке формы, CSP и `data-consent-version` — они в порядке. Оценка по-прежнему без дефолта.

## Тесты `site/tests/review-form-errors.test.ts`

Как у `tests/reviews-page.test.ts`: поднимается собранный сервер, страница `/otzyvy` открывается в jsdom, `fetch` подменяется. **Перед запуском нужен `npm run build`** — иначе `fetch failed`, это штатное поведение, не дефект.

Кейсы (минимум 8):
1. `400 {error:'validation', fields:{text:'too_short'}}` → под полем текста русский текст, фокус на нём.
2. `400 {error:'link_not_allowed', fields:{text:'link_not_allowed'}}` → под текстом про ссылки.
3. `400 {error:'validation', fields:{author:'too_long'}}` → под именем «до 40 символов».
4. `400 {error:'consent_version'}` → сообщение про обновление страницы, без подсветки полей.
5. `403 {error:'origin'}` → сообщение с почтой и телефоном.
6. `413 {error:'too_large'}` → «слишком длинный».
7. `503 {error:'delivery_failed'}` → «попробуйте через минуту».
8. `429` с телом `{error:'rate_limit', retryAfter:120}` и **без** заголовка → «через 120 с».
9. Вложенный формат `{error:{code:'validation',fields:{text:'too_short'}}}` (на будущее) → тот же русский текст.
10. Успех `201` → благодарность, поля очищены.

## Проверка перед PR

```
cd site
npm ci
npm run typecheck
npm run build
node --test tests/review-form-errors.test.ts tests/reviews-page.test.ts
PUBLIC_LEADS_ENDPOINT=https://ats-leads.ats439.workers.dev PUBLIC_DEMO_REVIEWS=1 npm run build:pages
node scripts/check-pages.mjs
```

Все 10 старых тестов `reviews-page.test.ts` должны остаться зелёными. В теле PR — вывод `typecheck`, `build`, обеих групп тестов.

## Чего не делать

- Не менять воркер (`relay/**`) — его правит Агент 11.
- Не менять админку (`site/public/manage/**`) — Агент 7.
- Не трогать `scripts/check-reviews.mjs` и `pages.yml` — Агент 10.
- Не менять тексты страницы, порядок блоков, стили и фразу про Яндекс.Карты на главной.
