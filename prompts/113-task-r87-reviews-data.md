# Круг 87 · Агент 10 «хранилище и гейты» — отзывы как данные

**Ветка:** от `origin/preview/github-pages`, имя `agent/87-reviews-data`. PR — в `preview/github-pages`.
**Роль прежняя:** в кругах 85–86 ты делал `prices.json` → `prices-schema.ts` → `prices-store.ts` → `check-prices-sync.mjs`. Здесь ровно та же работа, но для отзывов.
**Кто ещё в круге:** Агент 5 (страница и форма), Агент 11 (прослойка), Агент 7 (`/manage/`), Агент 12 (приёмка). Агент 6 недоступен — независимое ревью не запускается.

## Задача

Сделать `site/content/reviews.json` единственным источником правды для отзывов — как `cases.json` и `prices.json`. Ты делаешь **только данные, схему, чтение и гейты**. Страницу рисует Агент 5, вкладку админки — Агент 7. Они импортируют твою схему, поэтому сначала мержится твой PR.

### A. Схема `site/src/shared/reviews-schema.ts`

По образцу `site/src/shared/cases-schema.ts`:

```ts
export interface SiteReview {
  id: string;            // r-YYYY-MM-DD-NNN, стабильный, уникальный
  author: string;        // 2–40 знаков, «Павел И.»
  text: string;          // 20–1500 знаков
  rating: number;        // целое 1–5
  source: 'site' | 'yandex' | '2gis' | 'demo';
  source_url: string | null;
  published_at: string;  // YYYY-MM-DD
  status: 'published' | 'hidden';
  demo: boolean;
}
export interface ReviewsFile { updated_at: string; items: SiteReview[] }
```

- `parseReviewsFile(json: unknown): { file: ReviewsFile; errors: string[] }` — мягкая валидация: битая запись отбрасывается с сообщением, остальные читаются. Битый JSON → пустой файл + одна ошибка, **без исключения**.
- Дубли `id` → остаётся первый, второй отбрасывается с ошибкой.
- `rating` вне 1–5, дата не `YYYY-MM-DD`, `status`/`source` не из перечня → запись отбрасывается.
- Хелперы: `publishedReviews(file, {includeDemo})` (сортировка `published_at` desc, при равенстве — по `id` desc), `reviewsStats(items)` → `{count, average, byRating}` (среднее с одним знаком после запятой, `null` при пустом списке).
- `EMPTY_REVIEWS_FILE` — как в кейсах, на случай отсутствия файла.

### B. Чтение `site/src/server/reviews-store.ts`

По образцу `site/src/server/cases-store.ts`:

- путь по умолчанию `site/content/reviews.json`, переопределяется `REVIEWS_FILE` (для тестов и предпросмотра);
- кэш на процесс + проверка `mtime`, файл читается один раз, а не на каждый вызов;
- `listPublishedSiteReviews()` → `SiteReview[]` с учётом `PUBLIC_DEMO_REVIEWS` (`'1'` — демо попадают в выдачу, иначе нет);
- `reviewsDiagnostics()` → `{count, published, hidden, demoCount, errors, updated_at, path}`;
- сайт **не падает** никогда: нет файла, пусто, битый JSON → `[]` и ошибки в диагностике.

### C. Данные `site/content/reviews.json`

6 демо-записей, чтобы раздел не был пустым: `demo: true`, `source: "demo"`, `status: "published"`, `rating` 4–5, даты — последние два месяца (не «сегодня» у всех: разнести по 3–4 неделям). Темы — работы, которые сервис реально делает: шиномонтаж, тормоза, подвеска, ТО, развал-схождение, диагностика. Имена: «Павел И.», «Марина С.», «Дмитрий К.», «Ольга В.», «Артём Л.», «Сергей Н.».

Тон — живой, конкретный, без «лучший сервис в городе» и без обещаний, которых сервис не давал. Ни одного реального имени/телефона/номера машины.

### D. Гейт `site/scripts/check-reviews.mjs`

По образцу `check-cases.mjs`/`check-prices-sync.mjs`:

- без флагов: проверяет схему файла и печатает сводку (`опубликовано N, скрыто M, примеров K`), при ошибках — код 1;
- `--strict`: **падает**, если остался хотя бы один `demo: true` (этот режим включим при переезде на домен);
- `--count`: печатает только число опубликованных (для отчётов).

Подключить в `.github/workflows/pages.yml` **без** `--strict` (мягко), отдельной строкой после `check-pages.mjs`. В `site/package.json` — строку `test:reviews`, если у проекта есть такой стиль.

### E. Сборка

`site/scripts/export-pages.mjs`: прокинуть `PUBLIC_DEMO_REVIEWS` в окружение рендера (одна строка, рядом с существующими переменными), чтобы демо-сборка на превью показывала примеры. Боевая сборка без переменной — демо не показываются.

**Не трогать** `base`/`publicOrigin` — это зона отдельного задания по переезду (`prompts/108`).

### F. Тесты `site/tests/reviews-data.test.ts` (`node --test`)

1. Валидный файл → `items` целиком, `errors` пуст.
2. Битый JSON → пусто + ошибка, без исключения.
3. `rating: 9` → запись отброшена, остальные живы.
4. Дубль `id` → второй отброшен, в `errors` понятное сообщение.
5. `publishedReviews`: `hidden` не попадает; демо не попадают без флага и попадают с `PUBLIC_DEMO_REVIEWS=1`.
6. Сортировка: новые выше, при равных датах — по `id`.
7. `reviewsStats`: среднее, распределение по звёздам, пустой список → `null`.
8. Store: отсутствующий файл → `[]`; `REVIEWS_FILE` подменяет путь; повторное чтение берёт кэш и обновляется после изменения `mtime`.
9. `check-reviews.mjs --strict` → код 1 при демо и 0 без них.

## Проверка (приложить вывод)

```bash
cd site && npm ci && npm run typecheck
node --test tests/reviews-data.test.ts
node scripts/check-reviews.mjs && node scripts/check-reviews.mjs --strict; echo "strict exit=$?"
PUBLIC_LEADS_ENDPOINT=https://ats-leads.ats439.workers.dev npm run build:pages
node scripts/check-pages.mjs && node scripts/check-cases.mjs
```

## Чего НЕ делать

- Не рисовать страницу `/otzyvy` и не делать форму — это Агент 5.
- Не трогать `site/public/manage/**` — Агент 7.
- Не трогать `relay/**` — Агент 11.
- Не менять фразу «Читайте отзывы на Яндекс.Картах — там же оценки и схема проезда.» (требование владельца) — она в шаблонах Агента 5, ты её не касаешься.
- Не переносить тексты отзывов с Яндекса/2ГИС и не выдумывать «настоящие» отзывы: только `demo: true` с пометкой.
- Не делать `git reset --hard`.
