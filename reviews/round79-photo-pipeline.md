# Круг 79 — приёмка фото-пайплайна

**Вердикт: приёмка не начата — принимать нечего.**
Публикации нет: ни в `preview/github-pages`, ни на живом сайте нет ни `/manage/`, ни
`/cases/<slug>/`, ни `cases.json`, ни контракта `cases-schema.ts`. По заданию
(`prompts/86-task-r79-review-a9.md`, раздел «Если чего-то нет — не начинай») я остановился
до прогона сценария владельца.

Формально, если считать это отказом в приёмке: **REQUEST CHANGES**, один блокер —
«круга 79 в опубликованной ветке нет».

Сверено: `origin/preview/github-pages` = `945b605` («Merge pull request #31 from
sledovatel61/publish-r78-cat», 2026-11-17). Живой сайт: https://sledovatel61.github.io/avtotehservis/

## Блокеры

| # | Что | Где | Как воспроизвести | Ожидалось |
|---|---|---|---|---|
| 1 | Нет страницы владельца `/manage/` | `site/public/manage/index.html` отсутствует в `origin/preview/github-pages` | `git cat-file -e origin/preview/github-pages:site/public/manage/index.html` → exit 1; `fetch https://sledovatel61.github.io/avtotehservis/manage/` → «Ошибка 404» | Статика с токеном, кропом, подписью и публикацией |
| 2 | Нет страницы кейса | `site/src/pages/cases/[slug].astro`, `site/src/shared/cases-schema.ts`, `site/content/cases.json` в preview отсутствуют | `git ls-tree -r --name-only origin/preview/github-pages \| grep cases` → только `content/merged-r26/a7/05-cases.md` и старые `admin/cases/*` | `/cases/<slug>/` со слайдером «до/после», схема и данные |
| 3 | Нет гейта веса и инструкции владельцу | `site/scripts/check-media-budget.mjs`, `docs/16-photo-admin-manual.md` в preview отсутствуют | тот же `git cat-file -e` → exit 1 | Гейты 400/700 МБ и инструкция «токен = доступ к сайту» |
| 4 | Фото работ в репозитории нет | `site/public/media/**` — 0 файлов в preview | `git ls-tree -r --name-only origin/preview/github-pages \| grep -c '^site/public/media/'` → `0` | Кадры владельца в репозитории, не в D1 |

Блокеры 1–4 — одна причина: мержа круга 79 не было. Это не дефект кода, а отсутствие
предмета приёмки, поэтому в Major/Minor ничего не заносится: проверять было нечего.

## Что при этом видно в репозитории

| Где | Что | Статус |
|---|---|---|
| PR #32, `arena/c0d7d4ba-avtotehservis` → `preview/github-pages` | работа A5: `site/src/shared/cases-schema.ts`, `site/src/pages/cases/[slug].astro`, `site/src/client/cases.ts`, `CaseCard.astro`, `cases.css`, `site/content/cases.json`, правки `index.astro` / `about.astro` / `sitemap.xml.ts`, 912 добавлений, 38 файлов | **открыт, не смержен**, mergeable |
| открытые PR | работы A7 (`site/public/manage/*`) и A8 (`.gitignore` для `site/public/media`, `check-media-budget.mjs`, `docs/16-photo-admin-manual.md`) **не видны ни в одном открытом PR** | нет предмета для проверки даже в виде PR |
| живой сайт | `sitemap.xml` — 43 адреса, ни одного `/cases/`; главная по-прежнему со иллюстрациями `ab-case-*` | соответствует preview `945b605` |

Вывод: даже если смержить PR #32 прямо сейчас, `/manage/` и гейты веса придут не с ним —
приёмка будет неполной. Для старта нужны минимум: PR A5 + PR A7 (или их объединённый
вариант) + PR A8.

## Что проверено (фон, без приёмки)

| Проверка | Инструмент | Результат |
|---|---|---|
| Есть ли `site/src/shared/cases-schema.ts` в preview | `git cat-file -e origin/preview/github-pages:…` | нет (exit 1) |
| Есть ли `site/src/pages/cases/[slug].astro` | то же | нет |
| Есть ли `site/public/manage/index.html` и `manage/github.js` | то же | нет |
| Есть ли `site/content/cases.json` | то же | нет |
| Есть ли `docs/15-photo-pipeline.md`, `docs/16-photo-admin-manual.md` | то же | нет |
| Есть ли `site/scripts/check-media-budget.mjs` | то же | нет |
| Сколько файлов в `site/public/media/` | `git ls-tree -r` + `grep -c` | 0 |
| Живой `/manage/` | GET через инструмент загрузки страниц | HTTP-страница «Ошибка 404» |
| Живой `/cases/` | то же | «Ошибка 404» |
| Живой `sitemap.xml` | то же | 43 `<loc>`, `cases` — 0 совпадений |
| Список открытых PR | `gh pr list --state open` | A5 — #32; A7/A8 не найдены |

## Чего проверить не смог

Всё содержательное — потому что предмета нет: сценарий владельца (токен, загрузка 5-МБ фото,
кроп, подпись, публикация, сайт через 2 минуты), слайдер без JS и с клавиатуры на
360/768/1280, вес кадра 1600 px, поведение при 30 и 100 кейсах, удаление кейса, HEIC,
две вкладки, упавший Actions, слова-гейты в новых текстах.

Отдельно, чтобы не было сюрпризом при следующем заходе:

- **Живой сайт из песочницы напрямую не открывается** (`curl` к
  `sledovatel61.github.io` возвращает `000`: в песочнице разрешены только github.com,
  codeload, api.github.com, npm, pypi). Страницы я смотрел через инструмент загрузки
  страниц — он отдаёт HTML, но не даёт отключить JS, нажать Tab или измерить 44 px.
  Значит три пункта задания (клавиатура, без JS, геометрия кнопок) придётся проверять
  локальной сборкой preview-ветки — прошу на следующий круг положить в ветку `dist`/`pages-dist`
  или разрешить `npm ci` + `build:pages` (в этой сессии `site/node_modules` ставится, но без
  Chromium: `check-voyah-layout`/`check-price-tables` падают на `libnss3.so`).
- **Токена GitHub у меня нет** и запрашивать его в чате я не буду. Для следующего круга нужен
  либо тестовый fine-grained токен, выданный оркестратором вне чата, либо явное «работай на
  моке `fetch`» — тогда сценарий публикации будет описан как проверенный на моке, без слова
  «вживую».
- **Ветка.** Сессионная ветка зафиксирована как `arena/1c747bd0-avtotehservis`, создавать
  `agent/79-review` в этой сессии нельзя (ограничение окружения: работа идёт только в
  текущей ветке, PR не открывается). Отчёт лежит здесь; при переносе в `agent/79-review`
  содержимое то же.

## Что нужно от оркестратора, чтобы приёмка началась

1. Смержить (или дать ссылку на PR) работу A5 — #32 сейчас открыт.
2. Дать PR A7 со страницей `/manage/` — без неё основной сценарий владельца проверять не на чем.
3. Дать PR A8 с гейтом `check-media-budget.mjs`, правкой `.gitignore` и
   `docs/16-photo-admin-manual.md`.
4. Сообщить SHA `preview/github-pages` после мержа и подтвердить, что GitHub Pages
   пересобрался (иначе проверять буду сборку, а не живой сайт).
5. Решить вопрос с токеном: тестовый fine-grained или явный мок.

После этого приёмка пройдёт по полному плану задания: сценарий владельца по шагам,
слайдер без JS и с клавиатуры, вес и бюджет, безопасность токена, поведение при 30/100
кейсах, при удалении, при HEIC, при двух вкладках и при упавшей сборке.
