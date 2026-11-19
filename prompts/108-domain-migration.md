# Задание агенту: вынести адрес публикации в переменные (подготовка переезда на свой домен)

**Ветка:** от `origin/preview/github-pages`, имя `agent/domain-base-param`. PR — в `preview/github-pages`.
**Почему сейчас:** владелец покупает домен (`avtotehservis439.ru` или `ats439.ru`). Сайт сегодня живёт на подпути `https://sledovatel61.github.io/avtotehservis/`, а на своём домене будет в корне. Нужно, чтобы переключение было одной переменной, а не правкой кода в спешке.

## Жёсткие требования

1. **Поведение по умолчанию не меняется.** Без новых переменных сборка даёт ровно тот же `pages-dist`, что и сейчас: ссылки `/avtotehservis/…`, canonical `https://sledovatel61.github.io/avtotehservis/…`, sitemap, редиректы. Докажи это диффом: собери `pages-dist` на базе и на своей ветке, сравни побайтово (кроме ожидаемых меток времени, если они есть — тогда перечисли, что именно отличается).
2. **Никаких хардкодов нового домена.** Владелец ещё не выбрал имя. В коде — только `PUBLIC_ORIGIN` / `PUBLIC_BASE_PATH` с текущими значениями по умолчанию.
3. `git reset --hard` не использовать. Не трогать `site/public/manage/**` по существу (это не про базовый путь: там `/repos/sledovatel61/avtotehservis` — имя API, оно верное).

## Что сделать

### A. Источник истины по адресу

`site/scripts/export-pages.mjs`, строки 13–14:

```js
const base = '/avtotehservis';
const publicOrigin = 'https://sledovatel61.github.io';
```

Заменить на чтение окружения с проверкой:

- `PUBLIC_ORIGIN` → `publicOrigin`, по умолчанию `https://sledovatel61.github.io`; обязателен `https://`-схема, без завершающего `/`, иначе — падение сборки с внятным сообщением.
- `PUBLIC_BASE_PATH` → `base`, по умолчанию `/avtotehservis`. Допустимы: пустая строка (корень) либо `/segment` без завершающего `/`. Нормализуй (`'/'` → `''`, `'avtotehservis/'` → `/avtotehservis`). Невалидное — падение сборки.

Вынеси разбор в `site/scripts/lib/public-path.mjs` (экспорт `readPublicPath(env)` → `{ base, publicOrigin }`) и покрой тестом в `site/tests/` (`node --test`), кейсы: значения по умолчанию, пустой base, нормализация, отказ на `http://`, отказ на завершающий `/`, отказ на мусор.

### B. Все места, где этот путь используется

Грепом по репозиторию проверь и переведи на общий источник:

- `site/scripts/export-pages.mjs` — 9 вхождений `base` / `publicOrigin` (префиксы css/js/img/fonts/audio/video/media, `srcset`, canonical, `og:url`, `og:image`, sitemap, страницы-редиректы `<meta refresh>`);
- `site/scripts/check-pages.mjs` — 9 хардкодов `/avtotehservis`, проверки должны брать base из того же модуля, иначе после переезда приёмка упадёт на пустом месте;
- `site/scripts/serve-pages-preview.mjs` — локальный сервер обязан монтировать `pages-dist` под текущим base (3 вхождения);
- `site/scripts/check-dirs.mjs`, `check-price-tables.mjs`, `check-voyah-layout.mjs`, `check-news-mobile.mjs`, `check-mobile-grid.mjs`, `intro-seams.mjs`, `probe-contrast.mjs`, `measure-feats-zones.mjs`, `r26/r69/r70-shots.mjs`, `render-about/steps/svc.mjs` — здесь `/avtotehservis` встречается в путях к локальному превью и в комментариях. Приведи к общему источнику там, где это адрес публикации; комментарии не переписывай ради комментариев.
- `site/scripts/backup.sh`, `restore.sh` — 4 вхождения: если это пути внутри репозитория, оставь как есть и укажи в PR, что проверил.

### C. Домен в артефакте

GitHub Pages для своего домена ждёт файл `CNAME` в корне артефакта. Сделай так, чтобы при **заданном** `PUBLIC_ORIGIN` (не дефолтном `sledovatel61.github.io`) в `pages-dist` попадал `CNAME` с хостом из `PUBLIC_ORIGIN`, а при дефолтном — не попадал (иначе превью на github.io начнёт редиректить). Проверь, что `node scripts/check-pages.mjs` это не ломает.

### D. Workflow публикации

`.github/workflows/pages.yml`: добавь прокидывание `PUBLIC_ORIGIN` / `PUBLIC_BASE_PATH` из `vars.*` (по аналогии с `vars.PUBLIC_LEADS_ENDPOINT || 'https://ats-leads.ats439.workers.dev'`), с пустой строкой как значением по умолчанию:

```yaml
PUBLIC_ORIGIN: ${{ vars.PUBLIC_ORIGIN }}
PUBLIC_BASE_PATH: ${{ vars.PUBLIC_BASE_PATH }}
```

Учти: `vars.X` для незаданной переменной даёт пустую строку — это должно означать «по умолчанию», а не «корень». Разведи эти случаи явно в `readPublicPath` (например, пустая строка → дефолт, а корень задаётся литералом `/` или отдельным флагом) и опиши решение в PR.

## Проверка (обязательно приложить вывод)

```bash
git worktree add -f /tmp/wtbase origin/preview/github-pages
git worktree add -f /tmp/wtnew <твоя-ветка>
# в каждом: site → npm ci && npm run typecheck && PUBLIC_LEADS_ENDPOINT=https://ats-leads.ats439.workers.dev npm run build:pages
diff -r /tmp/wtbase/site/pages-dist /tmp/wtnew/site/pages-dist | head   # ожидаем пусто
```

Плюс контрольная сборка с переездом:

```bash
PUBLIC_ORIGIN=https://example.test PUBLIC_BASE_PATH= npm run build:pages
grep -rl '"/avtotehservis/' site/pages-dist | head    # ожидаем пусто
grep -c 'https://example.test/' site/pages-dist/sitemap.xml
cat site/pages-dist/CNAME                            # example.test
```

И штатный набор: `node scripts/check-prices-sync.mjs --refs-only`, `check-pages.mjs`, `check-intro-3d-off.mjs`, `check-cases.mjs`, `check-media-budget.mjs`, `node --test tests/*.test.ts`. Прогони его **дважды**: на дефолтном base и после правки — базовый прогон на `origin/preview/github-pages` должен дать те же цифры (сейчас там 245 тестов / 241 pass / 4 fail — `tests/integration.test.ts` падает и на базе, это известное).

## Чего НЕ делать

- Не менять `ALLOWED_ORIGINS` в `relay/wrangler.toml` — это отдельный шаг владельца после покупки домена (см. `docs/domain-migration.md`, шаг 5).
- Не покупать/не выбирать домен, не прописывать его нигде в коде.
- Не менять `base` на корень по умолчанию — превью обязано остаться рабочим.
- Не трогать дизайн, тексты, цены.

## Отчёт

В PR: таблица «файл → что изменилось → зачем»; вывод диффа `pages-dist` (пусто); вывод контрольной сборки на `example.test`; цифры тестов до/после; одна строка «как владельцу переключиться» (какие две переменные репозитория задать и что сделать в Settings → Pages).
