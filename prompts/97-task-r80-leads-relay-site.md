# Задание 80-1 · Агент 5 — подготовить сайт к приёму заявок без своего сервера

Владелец решил: заявки с сайта должны приходить в Telegram. Сайт живёт на GitHub Pages — там нет
сервера, поэтому между формой и Telegram встанет **небольшая прослойка** (Cloudflare Worker,
её пишу я, оркестратор). Твоя часть — подготовить сайт так, чтобы включение прослойки было
одной настройкой, а не переделкой.

**Ветка-источник:** `origin/preview/github-pages` = **`ff64c95`**.

Пока прослойки нет, сайт должен вести себя ровно как сейчас: демо-плашка, формы ничего
не отправляют, все гейты зелёные. Прослойка включается **одной переменной сборки**
`PUBLIC_LEADS_ENDPOINT` — без неё ничего не меняется.

---

## 1. Контракт прослойки (согласован, менять нельзя)

База: `https://<адрес-прослойки>` — приходит из `PUBLIC_LEADS_ENDPOINT` без завершающего слэша.

| Метод и путь | Ответ |
|---|---|
| `GET /health` | `{ ok: true, service: 'ats-leads', time: '<ISO>' }` |
| `GET /slots?date=ГГГГ-ММ-ДД` | `{ date, slots: [{ time: '09:00', available: true, reason?: 'past' \| 'closed' }] }`; ошибка — `400 { error: { code: 'bad_date', message } }` |
| `POST /leads` | `201 { ticket: 'A-1811-4821', lead_id: 0, status: 'accepted', duplicate: false }` |
| ошибка валидации | `400 { error: { code: 'validation', message, fields: { '<поле>': '<текст по-русски>' } } }` |
| лимит | `429 { error: { code: 'too_many', message } }` + заголовок `Retry-After` |
| бот | `200 { ticket, status: 'accepted' }` — форма показывает успех, но заявки нет |

Тело `POST /leads` — **точно то же**, что сайт отправляет сейчас в `/api/leads`
(`bookingSchema` / `messageSchema` в `site/src/server/validation.ts`): для записи — `car`,
`services`, `preferred`, `photos`, для вопроса — `message`; в обоих случаях `name`, `phone`,
`contact_method`, `consent`, `consent_version`, `page`, `idempotency_key`, `honeypot`,
`form_started_at`. Ничего не переименовывай и не добавляй.

Сайт обращается к ней **с другого домена**, поэтому:
- только `Content-Type: application/json`, без cookies и без `credentials`;
- CORS-преflight (`OPTIONS`) обрабатывает прослойка, тебе ничего делать не нужно;
- адрес прослойки — не секрет, но и не обязателен: без неё сайт остаётся в демо-режиме.

## 2. Что сделать

### 2.1. Одна точка настройки адреса

Новый модуль `site/src/shared/leads-endpoint.ts`:

- читает `import.meta.env.PUBLIC_LEADS_ENDPOINT` (build-time), обрезает хвостовой `/`;
- экспортирует `LEADS_BASE: string` (пустая строка, если не задан) и `leadsUrl(path)`:
  без базы → `/api/leads`, `/api/slots` (как сейчас); с базой → `${LEADS_BASE}/leads`, `${LEADS_BASE}/slots`;
- экспортирует `relayMode: boolean` = `LEADS_BASE !== ''`.

Оба клиента — `site/src/client/contacts-form.ts` и `site/src/client/wizard.ts` — берут адреса
только оттуда. Никаких захардкоженных `'/api/leads'` в клиентских файлах больше быть не должно.

### 2.2. Ответы и ошибки

Поведение при ответе прослойки должно совпадать с нынешним серверным:

- `201` и `ticket` → экран успеха, номер заявки, очистка полей, новый `idempotency_key`;
- `200` (бот) → **тот же** экран успеха, номер показываем (это защита от перебора: бот не должен
  понять, что его раскусили);
- `400` с `fields` → ошибки у полей, как сейчас; `consent_version` — отдельным сообщением;
- `429` → сообщение «Слишком много заявок с вашего адреса. Повторите позже или позвоните нам.»
  и, если есть `Retry-After`, не давать отправлять повторно раньше (кнопка с отсчётом
  или просто блокировка до истечения — на твой вкус, но текст должен быть понятным);
- сеть/`5xx`/таймаут → нынешний экран ошибки с телефоном. **Добавь таймаут запроса** (12 с),
  иначе на плохой связи кнопка висит бесконечно.

### 2.3. Фотографии в мастере записи

`/api/uploads` на Pages нет, и прослойка фото не принимает. В `relayMode`:

- блок загрузки фото в мастере записи **скрыть** (не «выключить и оставить битым»);
- вместо него — короткая честная строка: фото можно прислать в Telegram или показать мастеру
  при визите; ссылка на Telegram сервиса уже есть на сайте;
- в демо-режиме (без прослойки) блок остаётся как есть — не ломай текущий вид.

### 2.4. Демо-плашка

Плашку «Демонстрационная версия… Заявки и сообщения не отправляются» вставляет
`site/scripts/export-pages.mjs`. Она должна появляться **только** когда `relayMode === false`.
Если прослойка настроена — плашки нет (иначе сайт будет врать, что заявки не отправляются).

Атрибут `data-preview="true"` в `<body>` **оставь всегда**: на нём держатся отступы
(`--hdr`/`--demo-h`) и проверка `check-pages.mjs`. Проверь, что при отсутствии плашки
вёрстка не съезжает: `check-hero-layout`, `check-cascade`, `check-mobile-grid` должны быть
зелёными в обоих режимах.

### 2.5. Гейт конфигурации

Новый `site/scripts/check-leads-config.mjs`, запускается после сборки. Проверяет:

1. без `PUBLIC_LEADS_ENDPOINT`: в собранном клиентском JS есть `/api/leads`, плашка есть
   в каждом HTML, эндпоинта прослойки нигде нет;
2. с `PUBLIC_LEADS_ENDPOINT`: в клиентском JS есть адрес прослойки и нет `/api/leads`
   (кроме серверных файлов, которые на Pages не попадают), плашки нет ни в одном HTML;
3. адрес прослойки — только `https://`, без хвостового слэша и без пробелов; `http://` — ошибка;
4. в собранных файлах нет строк, похожих на токен бота (`\d{8,10}:[A-Za-z0-9_-]{35}`)
   и нет слова `BOT_TOKEN` — на случай, если кто-то однажды вставит секрет в клиент.

Код выхода 1 при нарушении, как у остальных гейтов. Подключи к `npm run build:pages`-цепочке
не надо — им пользуются руками и в CI отдельным шагом (шаг добавит оркестратор).

### 2.6. Тесты

В `site/tests/photo-pipeline.test.ts` не лезь. Добавь отдельный `site/tests/leads-endpoint.test.ts`
(5–8 проверок): разрешение адресов с базой и без, обрезка слэшей, `relayMode`, что `http://`
отвергается, что тело заявки не меняется (сверка с `bookingSchema`/`messageSchema` через
`parse` — валидный payload проходит, испорченный нет).

## 3. Границы

- Твои файлы: `site/src/shared/leads-endpoint.ts` (новый), `site/src/client/contacts-form.ts`,
  `site/src/client/wizard.ts`, `site/src/pages/appointment.astro` и `contacts.astro` (только
  если нужен скрытый блок/подсказка), `site/scripts/export-pages.mjs`,
  `site/scripts/check-leads-config.mjs` (новый), `site/tests/leads-endpoint.test.ts` (новый).
- Не трогать: `site/public/manage/**`, `site/src/server/**` (сервер остаётся как есть и должен
  продолжать работать при `PUBLIC_LEADS_ENDPOINT` не заданном), `.github/**`, `docs/**`,
  `site/content/cases.json`, `.gitignore`.
- Не менять тексты согласия, политики, телефоны и цены.
- Запрещено: `git reset --hard`, `--force`, пуш в `preview/github-pages`, мерж PR.
- Секретов в репозитории быть не должно: ни токена бота, ни ключей Cloudflare.

## 4. Проверки

```bash
cd site
npm ci
npm run typecheck
BG3D=off npm run build:pages                 # режим без прослойки
node scripts/check-pages.mjs
node scripts/check-leads-config.mjs
node --test tests/leads-endpoint.test.ts
node scripts/check-hero-layout.mjs && node scripts/check-cascade.mjs && node scripts/check-mobile-grid.mjs

PUBLIC_LEADS_ENDPOINT=https://leads.example.workers.dev BG3D=off npm run build:pages   # режим с прослойкой
node scripts/check-pages.mjs
node scripts/check-leads-config.mjs
node scripts/check-hero-layout.mjs && node scripts/check-cascade.mjs && node scripts/check-mobile-grid.mjs
```

Оба прогона должны быть зелёными. Отдельно, в конце, верни сборку в режим без прослойки
(`BG3D=off npm run build:pages`), чтобы `pages-dist` не остался с тестовым адресом.

Плюс прогон формы в jsdom (или в браузере) против мока прослойки: успех `201`, бот `200`,
`400` с полями, `429`, обрыв сети — во всех случаях правильный экран и текст.

## 5. Отчёт

Таблица «что сделано → чем проверено», вывод обоих прогонов сборки и гейтов, скриншот или
описание экранов успеха/ошибки в режиме прослойки. Отдельно скажи, что показалось неудобным
в контракте прослойки (если такое есть) — контракт ещё можно поправить, пока она не написана.

Ветка — твоя сессионная, от `origin/preview/github-pages` (`ff64c95`). Коммить и пушь в неё,
PR не обязателен: я заберу файлы и опубликую.
