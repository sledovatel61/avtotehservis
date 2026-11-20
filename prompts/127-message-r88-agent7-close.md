# Круг 88 · сообщение Агенту 7 (закрытие `/admin/cases`, копировать целиком)

---

Круг 88, роль прежняя — мастерская `/manage/` и админка. Задание: `prompts/126-task-r88-close-admin-cases.md` (ветка `arena/4abd532a-avtotehservis`; файл также лежит в `preview/github-pages` после мержа). Ветка для работы — `agent/88-close-admin-cases` от `origin/preview/github-pages`, PR туда же.

Владелец принял решение: **закрыть `/admin/cases`**. Причина — два хранилища работ: витрина читает `site/content/cases.json` (круг 79), а `/admin/cases` пишет в SQLite-таблицу `cases` и на сайт не влияет вообще. Пока файл работ непустой, работа, опубликованная через `/admin/cases`, на сайте не появится никогда — а человек будет уверен, что опубликовал. Рабочий путь один: `/manage/` → «Фото работ».

Сделай:

1. **Убрать маршруты**: удалить `site/src/pages/admin/cases/index.astro`, `new.astro`, `[id].astro`. В `site/src/middleware.ts` добавить 301: `/admin/cases`, `/admin/cases/new`, `/admin/cases/<что угодно>` → `/manage/#photos`. Редирект — до проверки сессии. База, миграции, сид и `content/cases.json` остаются; код защиты медиа в `/admin/media` не трогать.
2. **Админка без следов**: в `site/src/layouts/Admin.astro` убрать пункт «Кейсы»; в `site/src/pages/admin/index.astro` убрать плитку «Черновиков кейсов» и запрос `draftCases`, вместо неё подсказка со ссылкой на `/manage/#photos`.
3. **Тот же капкан в отзывах — в этой же ветке**: `/admin/reviews` пишет в SQLite `reviews`, а публичная `/otzyvy` читает файл `content/reviews.json`, то есть «опубликованный» там отзыв на сайте не появится. Удалить `site/src/pages/admin/reviews/**`, 301 `/admin/reviews` и `/admin/reviews/*` → `/manage/#reviews`, убрать пункт «Отзывы» из навигации и плитку «Отзывов на модерации», в подсказке написать «Отзывы — в `/manage/` → «Отзывы»». В `/manage/` ничего не менять.
4. **Тесты** (`site/tests/admin.test.ts`): старый тест про обложку медиа сейчас делает `POST /admin/cases/<id>` с `action=cover` — маршрута больше нет, переписать этот шаг на прямую привязку в БД (`UPDATE media SET attached_to='case:<id>'`), остальные ассерты («удаление обложки отклоняется») сохранить дословно. Добавить: 301 с `/admin/cases`, `/admin/cases/new`, `/admin/cases/123` (с сессией и без) на `/manage/#photos`; 301 с `/admin/reviews` на `/manage/#reviews`; в HTML дашборда нет ссылок `/admin/cases` и `/admin/reviews` и нет пунктов «Кейсы»/«Отзывы» в навигации.
5. **Документация**: `docs/13-launch-checklist.md:120`, `docs/15-photo-pipeline.md`, `docs/16-photo-admin-manual.md`, `docs/17-photo-admin-dev-notes.md` — заменить инструкции «зайти в `/admin/cases`» на `/manage/` → «Фото работ» и пометить, что раздел закрыт 19.11.2026 и отдаёт 301.

Проверка: `npm ci`, `npm run typecheck`, `npm run build`, `PUBLIC_DEMO_REVIEWS=1 npm run build:pages`, `node scripts/check-pages.mjs`, `node --test tests/admin.test.ts`, `node --test tests/*.test.ts` — ожидается 0 падений (сейчас база 306/306 зелёная, значит любое падение — твоё). В теле PR — вывод команд и `grep -rn "admin/cases" site/src site/public docs` (рабочих ссылок быть не должно).

Не трогать: `/manage/**`, `relay/**`, `content/reviews.json`, гейты, `pages.yml`, публичные страницы. Тесты не ослаблять: единственное разрешённое изменение в старом тесте — способ привязки медиа к кейсу.
