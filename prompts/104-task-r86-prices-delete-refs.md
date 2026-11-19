# Круг 86 · Агент 12 — удаление позиции прайса и защита ссылок

Ветка: `agent/86-prices-refs`, база — `origin/preview/github-pages` (`04286d1`).
PR — в `preview/github-pages`.

## Зачем

Владелец (Паша) правит цены сам через `/manage/#prices` и уже наткнулся на две вещи:

1. позицию нельзя **удалить** — только «Скрыть», поэтому его тестовая строка «ТЕСТ / 100 ₽»
   осталась в прайсе навсегда;
2. цену можно менять, но если удалить/переименовать позицию, на которую ссылаются тексты
   страниц (`{{price:pads-front}}` и родственные токены), сайт покажет сырой токен
   `{{price:pads-front}}` вместо цены, а гейт `check-prices-sync` покраснеет.

Твоя задача — подготовить **данные и проверки**, чтобы интерфейс (Агент 13) мог безопасно
удалять и переименовывать позиции. Интерфейс ты **не трогаешь**.

## Факты о текущем состоянии (проверено 19.11)

- `site/content/prices.json`: 7 групп, 73 «штатных» позиции **плюс тестовая строка владельца**
  `{"id":"test","name":"ТЕСТ","price":"100 ₽"}` в группе `podveska` (итого 74) и его тестовая
  правка `shocks-front` = `1800–2501 ₽`. **Эти данные — не твои: не правь, не удаляй, не
  «исправляй» `prices.json`.** Формат файла после сохранения из админки — расширенный JSON с
  отступом 2 (по одной строке на поле), это нормально.
- `site/scripts/check-prices-sync.mjs` сейчас жёстко ждёт `podveska: 11` и `totalCount === 73`,
  то есть **уже краснеет** из-за тестовой строки. Это и есть первое, что надо чинить: гейт не
  должен зависеть от того, сколько строк владелец добавил или удалил.
- `site/src/shared/prices-schema.ts` и его браузерный близнец
  `site/public/manage/prices-schema.js` — общий контракт. `PRICE_LIMITS` в них обязан совпадать
  (это уже проверяет `tests/manage-prices.test.ts`, но этот файл принадлежит Агенту 13 —
  **не редактируй его**, свои проверки клади в новый `tests/prices-delete.test.ts`).
- `priceIndexOf()` строит карту цен **с алиасами**: `id`, `slugifyRu(name)` для обычных позиций,
  `<id>`, `<id>-pass`, `<id>-cross`, `<id>a`, `<id>b` для комплектов, `remont-<slug>` для ремонта
  колёс, `slugifyRu(name)` для Voyah. Значит токен в тексте может ссылаться не на `id`, а на
  **алиас-слаг названия**: переименование такой позиции ломает текст так же, как удаление.
  Это ключевой факт для всей задачи.

## Что сделать

### 1. Гейт `site/scripts/check-prices-sync.mjs` перестаёт считать строки

- Убрать `EXPECTED_GROUP_COUNTS` и магические `73 / 8 / 3 / 4 / 15 / 3` из проверки состава.
- Оставить/добавить проверки, которые не зависят от количества работ владельца:
  - `validatePrices()` проходит;
  - набор и порядок **групп** фиксированы (`to, tormoza, podveska, grm, diagnostika,
    kondicioner, svarka`) — категории владелец не создаёт и не удаляет;
  - в каждой группе 1…`PRICE_LIMITS.maxGroupItems` позиций (пустая группа — ошибка с понятным
    текстом «В категории «Тормоза» не осталось ни одной работы»);
  - `tyres.set/repair/extra`, `voyah`, `featured` — в пределах лимитов схемы;
  - общее число позиций и `updated_at` печатать в лог, но **не сравнивать с константой**.
- `--self-test` обязан остаться зелёным и получить новые кейсы: (а) удалена одна позиция —
  гейт зелёный; (б) в группе ноль позиций — гейт красный; (в) в тексте остался нераскрытый
  токен — `--refs-only` красный.

### 2. Новый модуль `site/scripts/lib/price-refs.mjs` — кто ссылается на позицию

Экспорт:

```js
export function collectPriceRefs(prices, { roots, exclude }) // → { refs: {...}, generated_at }
export async function buildPriceRefs({ siteRoot })           // читает файлы, возвращает объект
export async function writePriceRefs({ siteRoot, outFile })  // пишет JSON
```

- Обход: `site/src/**/*.{astro,ts,tsx,js,md,mdx}` и `site/content/**/*.{json,md}`, кроме
  `site/content/prices.json`, кроме админских путей из `isAdminPath()`
  (`src/pages/admin/**`, `src/client/admin*`, `public/manage/**`,
  `src/server/prices-admin-store.ts`).
- Каждый токен (`{{price|from|From|span|between|pair|sum|tyre:...}}`, регэксп — из
  `prices-schema.ts`, не переписывать) раскрывается через `priceIndexOf(prices)`: id может быть
  алиасом. Для каждой найденной ссылки записываем владельца-позицию и способ совпадения:

```json
{
  "generated_at": "2026-11-19",
  "prices_updated_at": "2026-11-19",
  "refs": {
    "pads-front": [
      { "file": "src/pages/services/tormoza.astro", "line": 42, "token": "{{price:pads-front}}", "matched": "id" }
    ],
    "oil-sedan": [
      { "file": "src/pages/index.astro", "line": 88, "token": "{{from:zamena-masla-v-dvigatele-sedan}}", "matched": "alias" }
    ]
  },
  "featured": { "voyah-oil": ["chip-oil"] }
}
```

- В `refs` попадают только позиции, у которых есть хотя бы одна ссылка. `matched: "alias"` —
  ссылка по слагу названия: удалять **и** переименовывать такую позицию нельзя без правки текстов.
- `featured` — плашки на главной, они ссылаются на `voyah[].id` через `featured[].ref`.

### 3. Файл ссылок доезжает до браузера и до сборки

- В `site/scripts/export-pages.mjs` после копирования и правок JS **дописать**
  `pages-dist/manage/price-refs.json` (вызвать `writePriceRefs`) — до `console.log('Exported …')`,
  чтобы файл попал в артефакт Pages и в `check-pages.mjs` не считался лишним.
- Для локальной разработки: `npm run build:refs` → `site/public/manage/price-refs.json`,
  путь добавить в `site/.gitignore` (файл генерируемый, в репозиторий не кладём).
  Если файла нет — `/manage/` обязан работать (Агент 13 обработает 404).
- В `site/package.json` добавить скрипт `"build:refs": "node scripts/build-price-refs.mjs"`
  (тонкий CLI-враппер над модулем) и **включить в строку `test` два новых теста**:
  `tests/prices-delete.test.ts` и уже существующий `tests/manage-prices.test.ts`.
  Строку `test` правь минимально, это единственная общая точка с Агентом 13.

### 4. `--refs-only` для CI: сырых токенов на сайте быть не должно

- В `check-prices-sync.mjs` добавить режим `node scripts/check-prices-sync.mjs --refs-only`:
  - в `pages-dist/**/*.html` не осталось `{{` / `}}` (любой нераскрытый токен — FAIL с путём
    страницы и текстом токена);
  - `missingPriceRefs(text, prices)` в исходниках даёт пустой список для каждого файла из тех же
    корней, что и в §2;
  - вывод короткий, код выхода 1 при любой находке.
- В `.github/workflows/pages.yml` добавить шаг `- run: node scripts/check-prices-sync.mjs --refs-only`
  (`working-directory: site`) **после** `npm run build:pages` и до `upload-pages-artifact`.
  Комментарий в workflow: «если владелец удалил позицию, на которую ссылаются тексты, сборка
  падает и сайт остаётся на предыдущей версии — лучше так, чем сырой `{{price:…}}` в прайсе».
- Полный прогон гейта (`node scripts/check-prices-sync.mjs`) в CI **не добавлять**: он сверяет
  тексты страниц и слишком тяжёл для каждой правки цены.

### 5. Схема: удаление и переименование как операции

В `site/src/shared/prices-schema.ts` **и** в `site/public/manage/prices-schema.js` (зеркально,
одинаковое поведение и тексты ошибок):

```ts
export type PriceKind = 'group' | 'set' | 'repair' | 'extra' | 'voyah';
export function findPriceItem(prices, kind, catId, id): PriceItem | undefined
export function removePriceItem(prices, kind, catId, id):
  { ok: true; value: PricesFile } | { ok: false; errors: string[] }
export function renamePriceItem(prices, kind, catId, id, patch): /* то же */
```

- `removePriceItem` возвращает **новый** объект (не мутирует вход), позиция исчезает из массива;
  если после удаления группа пуста — это допустимо (проверка пустой группы живёт в гейте, не в
  схеме: владелец имеет право удалить всё и добавить заново);
- `removePriceItem` отказывает, если на позицию ссылается `featured[].ref`
  («Сначала уберите плашку «…» на главной»);
- `renamePriceItem` не меняет `id` никогда; принимает только разрешённые поля
  (`name`/`note` для group/voyah, `radius`/`passenger`/`crossover` для set, `range`/`price` для
  repair, `price` для всех) и валидирует их теми же лимитами, что `validatePrices`;
- оба помощника не знают про тексты сайта — про ссылки знает интерфейс по `price-refs.json`.

### 6. `site/src/server/prices-store.ts`: те же операции для серверной админки

- `removePriceItem(kind, catId, id)` и `renamePriceItem(kind, catId, id, patch)` — читают
  `getPrices()`, применяют помощники из §5, пишут `writePricesFile()` (атомарная запись уже есть),
  бросают `Error` с понятным русским текстом при отказе.
- Экспортировать новые помощники из `prices-store.ts` рядом с остальными.
- UI серверной админки (`src/pages/admin/**`) **не трогать** — это отдельная задача.

## Тесты (новый файл `site/tests/prices-delete.test.ts`)

1. `removePriceItem` убирает позицию, не мутирует исходный объект, остальные позиции целы.
2. Удаление последней позиции группы проходит схему (`validatePrices` ok).
3. Удаление при ссылке из `featured` — отказ с текстом про плашку.
4. `renamePriceItem` меняет `name`/`price`, `id` остаётся прежним; невалидное название/цена — отказ.
5. Паритет TS ↔ браузерный `prices-schema.js` на всех кейсах §5 (одинаковый `ok` и одинаковый
   набор ошибок).
6. `collectPriceRefs` на фикстурах: ссылка по `id` → `matched: "id"`; ссылка по слагу названия →
   `matched: "alias"`; `{{tyre:set-r16}}` → ссылка на `set-r16`; `featured.ref` → в `featured`;
   админские файлы в отчёт не попадают.
7. `prices-store` на временном `PRICES_FILE`: удаление и переименование пишут файл, кэш
   сбрасывается, повторное чтение отдаёт новое значение.

## Чего не делать

- Не менять `site/content/prices.json` (там данные владельца, включая «ТЕСТ / 100 ₽» и
  `1800–2501 ₽`).
- Не трогать `site/public/manage/{prices.js,manage.css,index.html,app.js}` и
  `site/tests/manage-prices.test.ts` — это зона Агента 13.
- Не переписывать регэксп токенов и семантику `fillPrices` — на них завязаны тексты страниц.
- Не менять формат `prices.json` (никаких новых обязательных полей; неизвестные поля сохраняются).
- Не добавлять в схему обязательные поля и не ужесточать лимиты без нужды: владелец правит цены
  каждый день.

## Критерии приёмки

- `npm run typecheck`, `npm run build`, `PUBLIC_LEADS_ENDPOINT=https://ats-leads.ats439.workers.dev npm run build:pages` — 0.
- `node scripts/check-prices-sync.mjs` — 0 **на текущем `prices.json` с тестовой строкой**,
  `--self-test` — 0, `--refs-only` — 0.
- `node --test tests/prices.test.ts tests/prices-delete.test.ts tests/manage-prices.test.ts` — все pass.
- Остальные гейты (`check-pages`, `check-cases`, `check-price-disclaimer`, `check-media-budget`,
  `check-cascade`, `check-mobile-grid`, `check-safe-zone`, `check-header-fluid`, `check-hero-layout`,
  `check-news-mobile`, `check-intro-3d-off`) — 0.
- Текст 48 страниц в `pages-dist` не изменился (сравнение со сборкой базы: снять теги/скрипты).
- В PR — таблица «файл → что изменено → чем проверено» и явная строка: «`prices.json` не изменён».
