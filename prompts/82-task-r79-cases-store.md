# Задание 79 · Агент 5 — кейсы из `cases.json`: страницы кейсов и витрина

Ты **Агент 5** («хранилище и витрина») на сайте автосервиса «АвтоТехСервис» (Ростов-на-Дону,
Портовая, 439). Стек: Astro + Node (`output: 'server'`), SQLite для админки, публикация —
статический экспорт на GitHub Pages. Тексты по-русски, тон спокойный, без рекламных обещаний.

Ты один из трёх агентов круга 79: Агент 5 (этот файл), Агент 6 (админка `/manage/`),
Агент 7 (гейты и инструкция). Зоны файлов не пересекаются — **строго держись своей** (§5).

---

## 1. Задача

Сейчас кейсы «до / после» — это шесть жёстко прописанных записей в сиде и картинки-иллюстрации
`/img/ab-case-1..6-640.*` из карты `site/src/server/case-covers.ts`. Загруженные владельцем фото
на сайт не попадают вообще: страниц кейсов нет, витрина не смотрит на `cover_media_id`.

Нужно: научить сайт читать **`site/content/cases.json`** (файл в репозитории, его будет писать
админка Агента 6), нарисовать **страницу кейса**, показать реальные фото на главной и на
«О компании», и добавить страницы кейсов в `sitemap.xml` (иначе на Pages их физически не будет —
экспортёр публикует только маршруты из sitemap).

Обратная совместимость обязательна: если `cases.json` пуст или его нет, сайт выглядит как сейчас
(сид-кейсы + иллюстрации `CASE_COVERS`).

---

## 2. Контракт (не менять без оркестратора)

Файл `site/content/cases.json`:

```json
{
  "version": 1,
  "updated_at": "2026-11-17T16:00:00Z",
  "cases": [
    {
      "slug": "pores-po-bokovine",
      "title": "Порез по боковине: осмотрели и сказали прямо",
      "description": "Колёса · ремонт колеса R17 — 800 ₽ или замена шины, если ремонт небезопасен.",
      "service_slug": "balansirovka",
      "mode": "before_after",
      "status": "published",
      "published_at": "2026-11-17",
      "sort": 10,
      "cover": { "base": "ab12cd-after", "alt": "Порез на боковине после ремонта", "w": 1600, "h": 1200, "ext": "webp" },
      "before": [
        { "base": "ab12cd-before", "alt": "Порез на боковине до ремонта", "w": 1600, "h": 1200, "ext": "webp" }
      ],
      "after": [
        { "base": "ab12cd-after", "alt": "Тот же участок после вулканизации", "w": 1600, "h": 1200, "ext": "webp" }
      ],
      "photos": []
    }
  ]
}
```

Правила:

| Поле | Тип | Обяз. | Смысл |
|---|---|---|---|
| `slug` | `^[a-z0-9-]{3,60}$` | да | адрес `/cases/<slug>/` |
| `title` | строка 5–90 | да | заголовок кейса |
| `description` | строка 0–200 | да | одна строка под заголовком |
| `service_slug` | строка или `null` | нет | ссылка на услугу из `listCatalogServices()` |
| `mode` | `single` \| `before_after` | да | одно фото работы или пара |
| `status` | `draft` \| `published` | да | черновик на сайт не попадает |
| `published_at` | `YYYY-MM-DD` | да | дата работы |
| `sort` | число | да | меньше — выше; при равенстве свежее выше |
| `cover` | `SitePhoto` \| `null` | нет | обложка; по умолчанию первый `after`, иначе первый `photos` |
| `before` / `after` | `SitePhoto[]` | да (пустые допустимы) | кадры «как было» / «как стало» |
| `photos` | `SitePhoto[]` | да | кадры режима «одно фото» |

`SitePhoto`: `{ base, alt, w, h, ext? }`, где `base` = `^[a-z0-9]{4,12}-(before|after|single)$`,
`alt` — обязателен, 3–160 символов, `w`/`h` — размеры варианта 1600 (числа > 0), `ext` — `webp`
по умолчанию или `jpg`.

Адрес файла: `/media/cases/<slug>/<base>-<width>.<ext>`, ширины `480 · 960 · 1600`
(все варианты одной пропорции). Обложка на витрине — 640 px из варианта 960 (браузер ужмёт).

---

## 3. Что сделать

### 3.1 Схема и чтение

1. Новый `site/src/shared/cases-schema.ts` — **типы и чистые функции, без Node API**:
   - `export type PhotoExt = 'webp' | 'jpg'`
   - `export interface SitePhoto { base: string; alt: string; w: number; h: number; ext?: PhotoExt }`
   - `export interface SiteCase { slug; title; description; service_slug: string | null; mode: 'single' | 'before_after'; status: 'draft' | 'published'; published_at: string; sort: number; cover: SitePhoto | null; before: SitePhoto[]; after: SitePhoto[]; photos: SitePhoto[] }`
   - `export const PHOTO_WIDTHS = [480, 960, 1600] as const`
   - `photoPath(slug, photo, width)` → `/media/cases/<slug>/<base>-<width>.<ext>`
   - `photoSrcset(slug, photo)` → `"<480> 480w, <960> 960w, <1600> 1600w"`
   - `parseCasesFile(raw: unknown): { file: { version: number; updated_at: string; cases: SiteCase[] }; errors: string[] }`
     — не бросает исключений: битые записи отбрасывает, причины складывает в `errors`
     (например `cases[3].before[0].alt: пустая подпись`).
   - `caseCover(c: SiteCase): SitePhoto | null` — `cover ?? after[0] ?? photos[0] ?? before[0] ?? null`.
   - `orderCases(cases: SiteCase[])` — по `sort` возрастанию, затем `published_at` по убыванию.
2. Новый `site/src/server/cases-store.ts` (Node): читает файл
   `new URL('../../content/cases.json', import.meta.url)` — то есть `site/content/cases.json`.
   - `readCasesFile()` с кэшем на процесс и `mtime`-проверкой; файла нет → `{ version: 1, updated_at: '', cases: [] }`;
     битый JSON → пустой список + `console.warn` (страницы не должны падать).
   - `process.env.CASES_FILE` — путь к другому JSON (нужно для тестов и предпросмотра).
   - `listPublishedSiteCases(limit = 6)`, `getPublishedSiteCase(slug)`, `listSiteCaseSlugs()`.
   - Экспортирует `casesDiagnostics()` — `{ count, errors, updated_at }` (пригодится Агенту 7).
3. `site/content/cases.json` — создать с `{"version":1,"updated_at":"","cases":[]}`.
   Это не «пустой файл-заглушка»: админка Агента 6 будет писать сюда.

### 3.2 Страница кейса `/cases/<slug>/`

Новый `site/src/pages/cases/[slug].astro`:

- `output: 'server'`, поэтому `getStaticPaths` не нужен: рендерим по `Astro.params.slug`,
  ненайденный/черновой кейс → `Astro.redirect('/404')` не работает на статике, вместо этого
  `return Astro.rewrite('/404')` (проверь, что на текущей версии Astro 5 есть; если нет —
  `Astro.response.status = 404` и тот же контент, что у `404.astro`).
- Крошки: Главная / Кейсы / <заголовок> (визуально как на других страницах, `<nav class="crumbs container">`).
- `<Base page="cases" …>`: `page` может быть новым значением — проверь `Header.astro`, чтобы
  навигация не сломалась (подсветка пункта не обязательна).
- Заголовок `h1`, строка меты: услуга (ссылка на `/services/<slug>/`, если услуга существует),
  дата `fmtDateRu`, режим («до и после» / «фото работы»).
- `mode: 'before_after'` → блок сравнения (§3.3). Если в `before` или `after` пусто — блок
  не рисуем, показываем то, что есть, как обычную галерею (честно, без пустых рамок).
- `mode: 'single'` → большой кадр 16:10 (первый из `photos`, `sizes="(max-width:900px) 92vw, 860px"`).
- Остальные кадры (`photos` целиком; в `before_after` — все, кроме пары из слайдера) → сетка
  карточек с существующим лайтбоксом: `class="gal-card"`, `data-gal`, `data-img` (крупный вариант
  1600), `data-title`, `data-sub`, и `<script>import '../client/lightbox.ts';</script>`.
- Блок «Записаться»: телефон из `getSettings()` и ссылка `/appointment/` — как на других страницах,
  ничего нового не выдумывать.
- `title`/`description` страницы: из кейса, ≤ 60/160 символов (обрезать аккуратно по словам).
- JSON-LD: `BreadcrumbList` (Главная → Кейсы → кейс). Разметку `ImageObject` не добавлять.

### 3.3 Блок «до / после»

Требования: работает без JS, доступен с клавиатуры, не ломается на 360 px.

- Базовая разметка (без JS) — две фигуры в обычном потоке: «как было» и «как стало»,
  каждая `<figure>` с `<figcaption>`; `<picture>` с WebP + JPEG-фолбэком не нужен (WebP достаточно),
  но `srcset`/`sizes` обязательны, `width`/`height` из `w`/`h` (пропорция), `loading="lazy"`.
- JS-улучшение (`site/src/client/cases.ts`, подключается только на странице кейса):
  добавляет контейнеру класс `ba--slider`, накладывает кадры друг на друга, вставляет
  `<input type="range" min="0" max="100" value="50" aria-label="Сравнение: как было и как стало">`,
  двигает `clip-path` у верхнего слоя. Никаких библиотек, только DOM.
  Подписи «как было» / «как стало» остаются видимыми бейджами по краям.
- Тач: `pointerdown/move/up` на контейнере двигают ползунок; на 360 px слайдер остаётся
  горизонтальным (высота ~240 px), ничего не выезжает за экран.
- Уважай `prefers-reduced-motion`: без плавных переходов.

### 3.4 Витрина: главная и «О компании»

- `site/src/pages/index.astro`, секция `aria-labelledby="gal-h"`:
  - `const siteCases = listPublishedSiteCases(6)`.
  - Если `siteCases.length > 0` — рисуем **их**: карточка = `<a class="gal-card" href={`/cases/${c.slug}/`}>`
    с реальным кадром (`caseCover`), `data-cover` не нужен, лайтбокс на эти карточки не навешивается
    (переход на страницу кейса важнее).
  - Если пусто — прежний вид на `CASE_COVERS` и сид-кейсах, **без изменений**.
  - Заголовок: при реальных кейсах «Кейсы из практики», при иллюстрациях — нынешний
    «Шесть кейсов из практики». Подпись «пример работы» — только у иллюстраций.
  - Карусель должна работать и с одной карточкой: если кейсов ≤ 2, стрелки не рисуем
    (как сделано у отзывов).
- `site/src/pages/about.astro`, секция с `ab-gal-h`: то же правило. Заголовок и подпись — по тому же
  принципу. Разметка карточки — общая: вынеси её в новый компонент
  `site/src/components/CaseCard.astro` (пропсы `{ case, mode: 'link' | 'lightbox', staticCover? }`),
  чтобы не было третьей копии разметки.

### 3.5 Sitemap

`site/src/pages/sitemap.xml.ts`: добавить `/cases/<slug>` для опубликованных кейсов
(`listSiteCaseSlugs()`), `lastmod` = `published_at`. Страницы `/cases/` (листинг) **не делать** —
в навигации её нет, а пустой листинг на статике бесполезен. Если кейсов нет — sitemap не меняется.

### 3.6 Стили

Новый `site/src/styles/cases.css`, импортируется в `Base.astro` (одна строка `@import` уже
существующего файла — не ломай порядок каскада; проверь, как подключены другие стили).
Стили: карточка кейса, страница кейса, слайдер, сетка фото, адаптив 360 / 768 / 1280.
Используй существующие CSS-переменные (цвета, радиусы, тени) — никаких новых палитр.

---

## 4. Границы: что нельзя

- Не трогать: `site/src/pages/admin/**`, `site/src/pages/media/**`, `site/src/server/media.ts`,
  `site/src/server/video.ts`, `site/src/server/seed-data.ts`, `site/src/pages/prices.astro`,
  `news*.astro`, `contacts.astro`, `appointment.astro`, `voyah-free.astro`, `garantii.astro`,
  `site/scripts/**`, `.github/**`, `package.json`, lockfile, `site/content/cases.json` (кроме
  создания пустого файла), `site/public/manage/**`.
- Не менять `site/scripts/export-pages.mjs`, `case-covers.ts` (только читать), `sitemap.xml.ts` —
  кроме добавления кейсов.
- Новые слова-гейты запрещены: «официальный», «заводской регламент», «по мануалу завода».
  Слово «официальный» ловит `check-voyah-content.mjs`.
- Не выдумывать работы и цены: `cases.json` у Агента 6 заполнит владелец. В коде — только
  пустой список. Для скриншотов используй временный файл через `CASES_FILE` и **удали**
  временные картинки из `site/public/media/` до финального коммита.
- Запрещено: `git reset --hard`, `git push --force`, правки чужой ветки, мерж своего PR,
  пуш в `preview/github-pages`.

---

## 5. Зона ответственности (файлы)

Создаёшь:
- `site/src/shared/cases-schema.ts`
- `site/src/server/cases-store.ts`
- `site/src/pages/cases/[slug].astro`
- `site/src/components/CaseCard.astro`
- `site/src/client/cases.ts`
- `site/src/styles/cases.css`
- `site/content/cases.json` (пустой)

Правишь точечно:
- `site/src/pages/index.astro` (только секция `gal-h` + импорты)
- `site/src/pages/about.astro` (только секция `ab-gal-h` + импорты)
- `site/src/pages/sitemap.xml.ts` (только кейсы)
- `site/src/layouts/Base.astro` (только подключение `cases.css`)

Всё остальное — не твоё.

---

## 6. Ветка, коммиты, PR

```bash
git fetch origin preview/github-pages:refs/remotes/origin/preview/github-pages
git switch -c agent/79-cases-store origin/preview/github-pages
cd site && npm ci        # lockfile не менять
```

- Коммиты мелкими шагами, по-русски: «круг 79: чтение кейсов из cases.json», «круг 79: страница
  кейса и сравнение до/после», «круг 79: реальные кейсы на главной и „О компании“».
- Пуш: `git push origin agent/79-cases-store`.
- PR: `gh pr create --base preview/github-pages --head agent/79-cases-store --title "…" --body-file /tmp/pr79-a5.md`
  (тело из файла — backticks инлайном рвут команду). **Не мержить**: мерж и публикацию делает оркестратор.

---

## 7. Гейты (прогнать, вывод приложить)

```bash
cd site
npm run typecheck
BG3D=off npm run build:pages
node scripts/check-pages.mjs
node --test tests/unit.test.ts
node --test tests/content.test.ts
node scripts/check-voyah-content.mjs
node scripts/check-intro-3d-off.mjs
node scripts/check-mobile-grid.mjs
git check-ignore -v site/public/img/ab-case-1-640.webp   # не должно быть ignored
```

Плюс визуальная проверка собранного `pages-dist/index.html` и одной страницы кейса на 360 / 768 / 1280 px
(скриншоты в PR).

---

## 8. Отчёт в PR

```
## Что сделано
## Контракт (какие поля читаются)
## Файлы
## Проверки (таблица гейтов)
## До / после
| было | стало |
## Что не влезло / вопросы оркестратору
```

Отдельно напиши, что нужно от Агента 6 (какие поля `cases.json` он обязан заполнять) — это
единственная точка стыковки.

---

## 9. Окружение

- Ветка `preview/github-pages` — единственная, что публикуется. Твоя ветка ничего не публикует.
- Не подтягивай чужие агентские ветки.
- Не запускай `scripts/gen-seed-data.mjs` (перезапишет `seed-data.ts`).
- Сайт на 100 % статичен после экспорта: никаких серверных вызовов в клиентском коде.
