# Задание 85-1 · Агент 10 «прайс-хранилище» — одна база цен для всего сайта

Владелец сервиса устал руками править цены в пяти файлах и хочет, чтобы это делал мастер
через админку. Но прежде чем давать кнопку «Сохранить», нужно, чтобы **у каждой цифры на сайте
было одно место рождения**. Это задание — про него. Админку делают другие агенты параллельно,
по контракту из §3; тебе кнопки делать не нужно, но контракт сломать нельзя.

**Ветка:** `agent/85-prices-store` от `origin/preview/github-pages` (`afd9966` или новее).
**PR:** в `preview/github-pages`. Не мержить — публикует оркестратор.

---

## 1. Задача в одном абзаце

Сейчас цены живут в `src/pages/prices.astro` (GROUPS, TYRE_SET, WHEEL_REPAIR, TYRE_EXTRA),
в `src/pages/voyah-free.astro` (массив `PRICE` + «от 2000 ₽» + суммы внутри абзацев),
в `src/pages/index.astro` (три карточки направлений, три плашки Voyah, абзац про услуги),
в `src/pages/about.astro` (два абзаца), в `src/pages/services/[slug].astro` (`price_from`)
и в `src/server/seed-data.ts` (описания восьми услуг, раздел «# Цены на работы»).
Один и тот же ценник записан 6 раз и уже разъехался. Нужно: **все цифры в одном
`site/content/prices.json`**, страницы рендерят их оттуда, ни в одном `.astro` и ни в одном
сиде не остаётся ни одного «₽» с суммой.

## 2. Что должно получиться (проверяемое)

1. `site/content/prices.json` — единственный файл с цифрами. Схема — §3, ровно как там,
   без «улучшений»: под неё уже пишут две админки.
2. `src/shared/prices-schema.ts` + `src/server/prices-store.ts` — чтение, валидация,
   подстановка. Кэш по mtime, как в `src/server/cases-store.ts` (читай его и повторяй
   решения: файла нет / битый JSON / битая запись — страница не падает).
3. Все страницы из §4 рендерят числа из хранилища. Формулировки, примечания групп,
   сноски и FAQ остаются текстом в коде — их правит разработчик, не мастер.
4. **Инвариант:** в `src/pages/**`, `src/components/**`, `src/layouts/**`, `src/server/**`
   (кроме `server/prices.ts` с текстами пометок) не остаётся ни одного символа «₽»
   с суммой — только `{{price:…}}`-ссылки и тексты пометок. Это проверяет гейт §5.
5. `PRICE_UPDATED` больше не константа в `server/prices.ts`, а дата из `prices.json`
   (`updated_at`): сохранил цены — дата на `/prices` и `/services` обновилась сама.
   Тексты пометок (`PRICE_DISCLAIMER*`) остаются в `server/prices.ts` (круг 84), их не трогай.
6. Ничего не сломалось визуально: `/prices` выглядит ровно как сейчас (8 групп, 10 таблиц,
   sticky-навигация, 5 сносок, FAQ), `/voyah-free` — как сейчас, главная — как сейчас.

## 3. Контракт `site/content/prices.json` (менять нельзя — под него пишут админки)

```json
{
  "version": 1,
  "updated_at": "2026-11-21",
  "groups": [
    {
      "id": "to",
      "title": "ТО и жидкости",
      "service": "to-maslo",
      "items": [
        { "id": "oil-sedan", "name": "Замена масла в двигателе, седан", "price": "1000–1300 ₽" }
      ]
    }
  ],
  "tyres": {
    "set":    [ { "id": "set-r13",   "radius": "R13",     "passenger": "1800 ₽", "crossover": "2000 ₽" } ],
    "repair": [ { "id": "rep-r13",   "range": "R13–R15",  "price": "600 ₽" } ],
    "extra":  [ { "id": "extra-set", "name": "Смена колёс, седан", "price": "1000 ₽" } ]
  },
  "voyah": [
    { "id": "voyah-oil", "name": "Масло в двигателе + все фильтры",
      "note": "масляный, воздушный, салонный", "price": "2000 ₽" }
  ],
  "featured": [
    { "id": "voyah-oil-chip", "ref": "voyah-oil", "title": "Масло ДВС", "note": "+ все фильтры" }
  ]
}
```

Правила:

- `groups[].id` — латиница/цифры/дефис, стабильные: `to`, `tormoza`, `podveska`, `grm`,
  `diagnostika`, `kondicioner`, `svarka`, `shiny`. Порядок массива = порядок на странице;
  `shiny` рисуется своей разметкой (три таблицы), остальные — обычной.
- `groups[].title` — заголовок группы на `/prices` (у `shiny`: «Шины и колёса»).
  `groups[].service` — слаг услуги для ссылки «Страница услуги: …».
- `items[].id` — **уникален по всему файлу** (в группах, шинах, Voyah). `name` — название
  работы, `price` — строка как её видит клиент: `1200 ₽`, `от 1500 ₽ за место`,
  `2200–4000 ₽`, `15 000 ₽`. Никаких «руб.» и «RUB».
- `featured[].ref` — id из `voyah`; цена плашки на главной **выводится из позиции**, чтобы
  одно и то же число не жило дважды.
- `updated_at` — `ГГГГ-ММ-ДД`, дата сохранения. Ставится при сохранении (админкой) или
  вручную при правке файла.

`src/shared/prices-schema.ts` должен экспортировать:

```ts
export interface PriceItem { id: string; name: string; price: string }
export interface PriceGroup { id: string; title: string; service: string; items: PriceItem[] }
export interface TyreSetRow { id: string; radius: string; passenger: string; crossover: string }
export interface TyreRepairRow { id: string; range: string; price: string }
export interface TyreExtraRow { id: string; name: string; price: string }
export interface VoyahItem { id: string; name: string; note: string; price: string }
export interface FeaturedChip { id: string; ref: string; title: string; note: string }
export interface PricesFile { version: 1; updated_at: string; groups: PriceGroup[]; tyres: { set: TyreSetRow[]; repair: TyreRepairRow[]; extra: TyreExtraRow[] }; voyah: VoyahItem[]; featured: FeaturedChip[] }

export const PRICE_LIMITS: { name: [number, number]; price: [number, number]; title: [number, number] };
export function validatePrices(value: unknown): { ok: true; data: PricesFile } | { ok: false; errors: string[] };
export function slugifyRu(text: string): string;              // «Замена масла» → «zamena-masla»
export function minPrice(prices: PricesFile, groupId: string): string | null;  // для «от … ₽»
export function priceIndexOf(prices: PricesFile): Map<string, string>;        // id → price
export function fillPrices(text: string, prices: PricesFile): string;         // {{price:id}} → «1200 ₽»
export function missingPriceRefs(text: string, prices: PricesFile): string[]; // проверка на билде
```

`fillPrices` заменяет **только** полные вхождения `{{price:<id>}}`; неизвестный id —
оставляет как есть, но `missingPriceRefs` его вернёт, и гейт упадёт (лучше упасть на сборке,
чем показать клиенту `{{price:…}}`).

`src/server/prices-store.ts` — как `cases-store.ts`: `pricesFilePath()`
(`PRICES_FILE` из env → тесты и предпросмотр), кэш по mtime, `getPrices()` всегда отдаёт
валидный `PricesFile` или бросает **понятную** ошибку с именами битых полей.

## 4. Файлы, которые ты правишь (только эти)

| Файл | Что делать |
|---|---|
| `site/content/prices.json` | новый, данные переносишь из перечисленных ниже файлов, цифры **один в один** как сейчас |
| `site/src/shared/prices-schema.ts` | новый, контракт §3 |
| `site/src/server/prices-store.ts` | новый, чтение/кэш/валидация |
| `site/src/server/prices.ts` | `PRICE_UPDATED`/`PRICE_UPDATED_RU`/`PRICE_UPDATED_LABEL` — теперь из `prices.json`; тексты пометок не менять |
| `site/src/pages/prices.astro` | `GROUPS`/`TYRE_*` → из хранилища; примечания групп, сноски, FAQ и разметка — как есть |
| `site/src/pages/voyah-free.astro` | массив `PRICE` → из хранилища; «от 2000 ₽» в правом блоке — `minPrice(voyah)`; суммы внутри абзацев → `{{price:…}}` |
| `site/src/pages/index.astro` | три карточки направлений, три плашки Voyah (из `featured`), абзац `.svc-intro` — числа через `{{price:…}}` или из хранилища |
| `site/src/pages/about.astro` | два абзаца с суммами → `{{price:…}}` |
| `site/src/pages/services.astro`, `site/src/pages/services/[slug].astro` | `price_from` → минимум по группе услуги (фолбэк на значение из БД, если группы нет); описания из БД прогонять через `fillPrices` **до** markdown |
| `site/src/server/seed-data.ts` | в `short` и `description` восьми услуг суммы заменить на `{{price:…}}`, раздел «# Цены на работы» оставить, но с подстановками |
| `site/scripts/check-price-disclaimer.mjs` | дата теперь из JSON: проверять формат `updated_at` и что на `/prices` напечатана именно она |
| `site/scripts/check-prices-sync.mjs` | новый гейт + `--self-test`, см. §5 |
| `site/tests/prices.test.ts` | новый: схема, `fillPrices`, `minPrice`, битые файлы, `validatePrices` на 8–10 фикстурах |

**Не трогай:** `src/pages/admin/**`, `src/layouts/Admin.astro`, `site/public/manage/**`,
`src/server/db.ts`, `migrations/**`, `package.json` (кроме строки `test`, куда добавишь
свои гейты — туда же дописывается Агент 11, конфликт разрешай минимальной правкой).
Админки пишут `prices.json` по этому контракту — тебе не нужно их ждать.

## 5. Гейт `scripts/check-prices-sync.mjs`

Проверки (все — по исходникам и по собранному `pages-dist`, без браузера, чтобы гейт
работал в CI на Pages):

1. `prices.json` валиден по `validatePrices`, id уникальны, `featured[].ref` существует,
   `updated_at` формата `ГГГГ-ММ-ДД`.
2. Ни в одном файле `src/pages/**`, `src/components/**`, `src/layouts/**`,
   `src/server/**` нет «₽» с цифрой рядом — кроме `src/server/prices.ts` и комментариев
   (`//`, `/*`, `*`). Разрешение: файл `src/server/seed-data.ts` тоже проверяется.
3. Каждая ссылка `{{price:<id>}}` в проекте существует в `prices.json`.
4. В `pages-dist/prices/index.html` нет `{{price:` и нет «остатков» — все подставились;
   числа из JSON присутствуют в HTML (выборочно 10 позиций из разных групп).
5. На `/prices` напечатана дата из `updated_at` (сравнение с собранным файлом).
6. **Синхронность:** число из `prices.json` для `oil-sedan` = числу в HTML `/prices`,
   в HTML карточки `/services/to-maslo` и в HTML главной — если эти страницы его содержат.

`--self-test`: 4 мутанта (убрать `₽`-инвариант, подсунуть неизвестный `{{price:…}}`,
разъехавшаяся дата, дубль id), каждый обязан ронять гейт. Аргументируй в шапке файла,
как в `check-price-disclaimer.mjs`.

Добавь `node scripts/check-prices-sync.mjs && node scripts/check-prices-sync.mjs --self-test`
в `npm run test` и свои проверки в `tests/prices.test.ts`.

## 6. Приёмка (что я проверю у тебя лично)

```
npm ci
npm run typecheck
npm run build
PUBLIC_LEADS_ENDPOINT=https://ats-leads.ats439.workers.dev npm run build:pages
node scripts/check-prices-sync.mjs --self-test
node scripts/check-price-disclaimer.mjs --self-test
node scripts/check-pages.mjs && node scripts/check-cascade.mjs && node scripts/check-mobile-grid.mjs
node scripts/check-news-mobile.mjs && node scripts/check-header-fluid.mjs
node --test tests/prices.test.ts
```

Плюс `grep -rc '₽' src/pages src/server src/components | grep -v ':0'` — должен остаться
только `src/server/prices.ts`. Плюс живая проверка: `/prices`, `/voyah-free`, `/`,
`/about`, `/services/shinomontazh` — те же цифры, что в `prices.json`.

В отчёте PR: сколько позиций перенёс, где были расхождения между страницами (это интересно
владельцу — значит, сайт уже врал), и что осталось текстом (примечания, сноски, FAQ).

## 7. Чего делать нельзя

- Менять формулировки прайса, названия работ и порядок групп «по ходу дела». Задача —
  перенести как есть; если видишь явную опечатку — напиши в PR, не правь.
- Тянуть новые зависимости. Никаких CMS, API, «сразу в базу».
- Оставлять цифру в двух местах «на время»: либо в JSON, либо `{{price:…}}`.
- Ломать публичные тексты пометки о справочных ценах (круг 84, PR #55).
- Коммитить `site/data/**`, `pages-dist/**`, `node_modules/**`.
