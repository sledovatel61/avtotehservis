# Задание 79 · Агент 8 — гейты, тесты и инструкция для владельца

Ты **Агент 8** («сторож и инструкция») на сайте автосервиса «АвтоТехСервис» (Ростов-на-Дону).
Ты закрываешь круг 79: фото работ теперь живут в репозитории и публикуются на GitHub Pages,
и эту схему нужно защитить гейтами, покрыть тестами и объяснить владельцу человеческим языком.

**Когда стартовать:** Агент 5 (витрина, `cases.json`) и Агент 7 (админка `/manage/`) уже смержены
оркестратором в `preview/github-pages`. Ветвись от свежего `origin/preview/github-pages` — в нём
уже есть `site/src/shared/cases-schema.ts`, `site/src/server/cases-store.ts`,
`site/src/pages/cases/[slug].astro`, `site/public/manage/**`, `site/content/cases.json`.

Если чего-то из этого нет — **не пиши свои версии**, остановись и напиши оркестратору, чего не хватает.

---

## 1. Что сделать

### 1.1 `.gitignore` — фото должны попадать в git

Сейчас `site/.gitignore` содержит строку `media/`, которая глушит и `site/public/media/`.
Нужно:

- заменить `media/` на `/media/` (серверный `MEDIA_DIR` в корне `site/`), сохранив негации
  `!migrations/`, `!migrations/*.sql`, `!src/pages/media/`, `!src/pages/admin/media/`;
- добавить комментарий: «фото кейсов лежат в public/media и обязаны попадать в git — иначе
  на статике их нет»;
- проверить: `git check-ignore -v site/public/media/cases/x/y-after-960.webp` **не должен**
  находить правило.

Корневой `.gitignore` (`uploads/`, `media/`) не трогай — он про серверные каталоги.

### 1.2 `site/scripts/check-media-budget.mjs`

Считает вес и состав фото кейсов, не требует puppeteer, запускается на Node:

- обход `site/public/media/**` (исключая `.gitkeep`);
- суммарный вес: **предупреждение** от 400 МБ, **ошибка (exit 1)** от 700 МБ;
- ошибка, если один файл > 800 КБ;
- ошибка, если у фото нет пары `-480` / `-960` / `-1600` (все три ширины обязательны);
- ошибка, если в `site/public/media/cases/` есть каталог слага, которого нет в `cases.json`
  (сироты после удаления кейса);
- печатает таблицу «папка — файлов — МБ» и итог. Флаг `--json` — машинный вывод (для тестов).

### 1.3 `site/scripts/check-cases.mjs`

Проверяет `site/content/cases.json` и соответствие файлов контракту:

- JSON разбирается, `version === 1`, `cases` — массив;
- каждое поле по §2 контракта (см. `site/src/shared/cases-schema.ts` — используй
  `parseCasesFile`, а не свою копию правил);
- для каждого `SitePhoto` существуют все три файла и размеры `w`/`h` совпадают с реальными
  (ширину/высоту WebP читай из заголовка файла без зависимостей: VP8/VP8L/VP8X — или через
  `sharp` из `site/node_modules`, он уже в зависимостях);
- alt не пустой, не длиннее 160 символов и не содержит «официальный»;
- `slug` уникален, `mode` и наборы `before/after/photos` согласованы (`single` → фото только
  в `photos`; `before_after` → хотя бы один кадр в `after`);
- «черновик» (`draft`) не должен появляться на сайте: проверь по `pages-dist`, что файла
  `pages-dist/cases/<slug>/index.html` нет;
- `--json` для тестов, человеческий отчёт по умолчанию, exit 1 при ошибках.

### 1.4 `site/tests/photo-pipeline.test.ts`

`node --test`, без сети и без браузера:

1. `parseCasesFile`: валидный минимальный файл; отсутствие `alt`; неверный `base`; `w/h` ≤ 0;
   `mode: single` с непустым `before` — какие поля отбрасываются и какие ошибки в `errors`.
2. `photoPath` / `photoSrcset`: точные строки, `ext` по умолчанию `webp`, `jpg` при `ext: 'jpg'`.
3. `caseCover`: `cover`, иначе первый `after`, иначе первый `photos`.
4. `orderCases`: `sort` вверх, при равенстве `published_at` вниз.
5. `cases-store` с `CASES_FILE`: временный файл во `mkdtemp`; битый JSON → пустой список и
   предупреждение (не исключение); фильтр `draft`; кэш инвалидируется при изменении `mtime`
   (измени файл, дождись `utimes`, прочитай снова).
6. Бюджет: `check-media-budget.mjs --json` на временном каталоге (3 файла по 100 КБ) — без ошибок;
   на файле 900 КБ — exit 1.

Тест не должен требовать `npm ci` дважды и не должен писать в `site/public`.

### 1.5 `docs/16-photo-admin-manual.md` — инструкция для владельца

Без технического жаргона, шаги и скриншоты-описания (скриншоты не вставлять, описать словами):

1. Что такое `/manage/` и где кнопка (полный адрес).
2. Один раз: как выпустить токен GitHub (5 шагов, с пометкой «срок 90 дней, потом повторить»).
3. Как добавить кейс с парой фото: «как было» / «как стало», кроп, подпись, обложка.
4. Как добавить кейс с одним фото.
5. «Опубликовать» → что произойдёт (1–2 минуты), как проверить, что всё вышло.
6. Что делать, если сборка упала: ссылка на Actions, что искать, кого звать.
7. Лимиты: 10 фото на кейс, 15 МБ на файл, общий бюджет репозитория 400 МБ —
   «если перевалит, скажите, разгрузим старые исходники».
8. Что нельзя: грузить чужие/стоковые фото, ставить подписи «официальный сервис».

Плюс короткая памятка «если фото не появилось» — 5 самых частых причин.

### 1.6 `docs/15-photo-pipeline.md`

Сверить с фактами после мержа: если имена файлов/поля разошлись с контрактом — поправь документ
(это документ оркестратора, правки по факту допустимы, но только по факту; выдумывать не надо).

### 1.7 `site/scripts/check-pages.mjs`

Добавь проверки (точечно, не переписывая скрипт):

- `pages-dist/manage/index.html` существует и содержит `noindex`;
- `pages-dist/manage/` не ссылается на `/admin`;
- для каждого опубликованного кейса есть `pages-dist/cases/<slug>/index.html`;
- в этом HTML есть `srcset` с тремя ширинами и нет ссылок на `/img/ab-case-*`
  (реальный кейс не должен рисоваться иллюстрацией);
- `pages-dist/sitemap.xml` содержит `/cases/<slug>`.

---

## 2. Границы: что нельзя

- Не менять `site/src/pages/**` и `site/src/server/**` — если витрина или админка расходятся
  с контрактом, это **баг Агентов 5/7**: опиши его в PR и в отчёте, не правь молча.
- Не менять `site/public/manage/**`.
- Не менять `site/scripts/export-pages.mjs`, `.github/**`, `package.json`, lockfile.
- Не менять `seed-data.ts`, `gen-seed-data.mjs`.
- Запрещено: `git reset --hard`, `git push --force`, коммит в `preview/github-pages`, мерж PR.

---

## 3. Зона ответственности (файлы)

Создаёшь:
- `site/scripts/check-media-budget.mjs`
- `site/scripts/check-cases.mjs`
- `site/tests/photo-pipeline.test.ts`
- `docs/16-photo-admin-manual.md`

Правишь точечно:
- `site/.gitignore`
- `site/scripts/check-pages.mjs`
- `docs/15-photo-pipeline.md` (только расхождения с фактом)
- при необходимости — `site/package.json` **запрещено**; новые гейты запускаются вручную
  и оркестратор добавит их в общий прогон.

---

## 4. Ветка, коммиты, PR

```bash
git fetch origin preview/github-pages:refs/remotes/origin/preview/github-pages
git switch -c agent/79-media-gates origin/preview/github-pages
cd site && npm ci
```

- Пуш: `git push origin agent/79-media-gates`.
- PR: `gh pr create --base preview/github-pages --head agent/79-media-gates --title "…" --body-file /tmp/pr79-a7.md`.
  **Не мержить.**

---

## 5. Гейты (прогнать, вывод приложить)

```bash
cd site
npm run typecheck
BG3D=off npm run build:pages
node scripts/check-pages.mjs
node scripts/check-cases.mjs
node scripts/check-media-budget.mjs
node --test tests/photo-pipeline.test.ts
node --test tests/unit.test.ts
node --test tests/content.test.ts
node scripts/check-voyah-content.mjs
node scripts/check-intro-3d-off.mjs
node scripts/check-mobile-grid.mjs
git check-ignore -v site/public/media/cases/demo/demo-after-480.webp || echo "не игнорируется — ок"
```

Плюс самопроверка гейтов: временно испорть копию `cases.json` (нет alt), убедись, что
`check-cases.mjs` падает с понятным сообщением; временно положи файл 900 КБ — `check-media-budget.mjs`
падает. Верни всё как было (`git checkout --`), коммит с мусором не делай.

---

## 6. Отчёт в PR

```
## Что сделано
## Гейты: что ловят и как чинить
## Тесты: список кейсов
## Инструкция: на что смотреть владельцу
## Найденные расхождения с контрактом (для оркестратора)
## Проверки (таблица)
```

## 7. Окружение

- Публикуется только `preview/github-pages`.
- Не подтягивай чужие агентские ветки.
- `check-price-tables.mjs` в песочнице не работает (`libnss3.so`) — это известное, не регрессия.
- `tests/seed.test.ts` содержит устаревшее ожидание (5 статей вместо 15) — не твоя зона,
  не правь.
