# Круг 88 · сообщения Агентам 5, 7 и 10 (копировать целиком)

Агент 11 — отдельно, `prompts/117-message-r88-agent11.md`.

Все четыре задания можно отправлять **одновременно**: файлы не пересекаются.

| Агент | Ветка | Задание | Файлы | Пересечения |
|---|---|---|---|---|
| 11 | `agent/88-origins-domain` | `prompts/116` | `relay/**` | нет |
| 5 | `agent/88-form-errors` | `prompts/118` | `site/src/client/review-form.ts`, `site/tests/review-form-errors.test.ts` | нет |
| 7 | `agent/88-admin-reviews-fix` | `prompts/119` | `site/public/manage/reviews.js`, `site/tests/manage-reviews.test.ts`, `docs/manage-reviews.md` | нет |
| 10 | `agent/88-demo-gate` | `prompts/120` | `site/scripts/check-reviews-artifact.mjs`, `pages.yml`, `site/tests/reviews-artifact.test.ts`, `docs/domain-switch.md` | нет |

Порядок мержа после приёмки: **11 → 5 → 7 → 10** (у 10 меняется CI-гейт, его лучше ставить последним, чтобы не ловить падения сборки на чужих ветках).

---

## Агент 5 (разработчик сайта)

---

Круг 88, роль прежняя — сайт (`site/`). Задание: `prompts/118-task-r88-form-errors.md` в репозитории (ветка `arena/4a0a6bfb-avtotehservis`, PR #71). Ветка для работы — `agent/88-form-errors` от `origin/preview/github-pages`, PR туда же.

При приёмке PR #76 нашёлся разрыв контракта: форма ждёт от воркера `{error:{message,fields}}`, а `POST /reviews` отдаёт плоское `{error:'validation', fields:{text:'too_short'}}` с **кодами** вместо русских текстов. Итог — при ошибке сервера человек видит «Отзыв не принят» и ни одной подсветки под полями.

Сделай:

1. Разбирать оба формата (плоский от воркера и вложенный на будущее).
2. Таблица «код → русский текст» из задания (author/text/rating/consent/consentVersion: `required`, `too_short`, `too_long`, `link_not_allowed`, `repeated_lines`, `out_of_range`).
3. Отдельные сообщения для `consent_version` («документ обновился, обновите страницу»), `origin` (`403` — с почтой и телефоном), `too_large` (`413`), `delivery_failed` (`503`).
4. `429`: секунды из заголовка `retry-after`, а если его нет — из тела `retryAfter`.
5. Новый тест `site/tests/review-form-errors.test.ts` — 10 кейсов из задания. Старые 10 тестов `reviews-page.test.ts` должны остаться зелёными. Перед тестами нужен `npm run build` (иначе `fetch failed` — это норма).

Ветку веди от `origin/preview/github-pages`, в теле PR — вывод `npm run typecheck`, `npm run build`, обеих групп тестов.

Не трогать: `relay/**` (Агент 11), `site/public/manage/**` (Агент 7), `scripts/check-reviews*.mjs` и `pages.yml` (Агент 10), разметку и тексты страницы, фразу про Яндекс.Карты.

---

## Агент 7 (мастерская `/manage/`)

---

Круг 88, роль прежняя — админка `/manage/`. Задание: `prompts/119-task-r88-admin-reviews-fix.md` в репозитории (ветка `arena/4a0a6bfb-avtotehservis`, PR #71). Ветка — `agent/88-admin-reviews-fix` от `origin/preview/github-pages`.

Два дефекта, оба видны при приёмке PR #74:

1. **Оценка подставляется пятёркой.** «+ Добавить отзыв» создаёт `rating: 5`, список оценки вообще без пустого варианта, а «Разобрать» делает `rating: parsed.rating ?? 5`. Правило владельца: выдуманные оценки запрещены — в том числе в админке. Нужно пустое значение по умолчанию (`null`), пункт «— выберите оценку —» первым в списке и блокировка сохранения, пока оценка не выбрана. При разборе Telegram без оценки — тоже `null`, а не 5.
2. **«Разобрать» не разбирает настоящее сообщение.** Реальный формат (`relay/src/telegram.ts`): `⭐ Новый отзыв с сайта (на модерации)`, пустая строка, `Оценка: 5/5 ⭐⭐⭐⭐⭐`, `Имя: Павел И.`, `Отзыв:` + текст, `Источник: /otzyvy`, `Согласие на обработку ПД: …`, `Опубликовать: админка → Отзывы`. Текущий разбор ждёт строку ровно `Оценка: 5/5` (звёздочки ломают совпадение), а заголовок, `Источник:`, `Согласие…` и `Опубликовать…` уезжают в текст отзыва, то есть в публикацию. Перепиши `parseTelegram()`: оценка шаблоном `Оценка:\s*([1-5])\s*/\s*5` в любом месте строки, имя из `Имя:`, текст — от строки `Отзыв:` до первой служебной, служебные строки выбрасывать.
3. Тесты в `site/tests/manage-reviews.test.ts` — 5 новых кейсов из задания, включая дословное сообщение выше → `{author:'Павел И.', rating:5, text:'…'}`. 90 старых проверок (`manage-reviews` + `manage-prices`) должны остаться зелёными.
4. `docs/manage-reviews.md` — один абзац: вставлять сообщение целиком, оценку при необходимости выбирать руками, пятёрка не подставляется.

Не трогать: `relay/**`, `site/content/reviews.json`, `/otzyvy`, гейты и `pages.yml`.

---

## Агент 10 (данные, схема, гейты)

---

Круг 88, роль прежняя — данные и гейты. Задание: `prompts/120-task-r88-demo-gate.md` в репозитории (ветка `arena/4a0a6bfb-avtotehservis`, PR #71). Ветка — `agent/88-demo-gate` от `origin/preview/github-pages`.

Задача одна: сделать невозможным попадание демо-отзывов на боевой домен, если владелец забудет переменную.

Сейчас защита — только `PUBLIC_DEMO_REVIEWS=0`, которую надо не забыть создать вручную. Нужен гейт по **собранному артефакту**: новый `site/scripts/check-reviews-artifact.mjs` — при `PUBLIC_BASE_PATH=/` в `pages-dist/otzyvy/index.html` не должно быть ни одного чипа `rev-demo` и ни одного текста записей с `demo: true` из `site/content/reviews.json`; на превью-сборке скрипт печатает сводку и выходит с 0. Флаг `--require-empty` — принудительно боевой режим.

Плюс: шаг `node scripts/check-reviews-artifact.mjs` в `pages.yml` после `check-reviews.mjs` (с `PUBLIC_BASE_PATH` в `env`, иначе скрипт не поймёт, боевая ли сборка), тест `site/tests/reviews-artifact.test.ts` с четырьмя кейсами из задания (превью + демо → 0; домен + демо → 1; домен без демо → 0; нет `pages-dist` → 2) и одна строка в `docs/domain-switch.md`: если забыть `PUBLIC_DEMO_REVIEWS`, упадёт гейт — это защита.

Не трогать: UI `/otzyvy`, форму, админку (там параллельно Агенты 5 и 7), `reviews.json` и схему, логику `PUBLIC_ORIGIN`/`PUBLIC_BASE_PATH` из PR #75.
