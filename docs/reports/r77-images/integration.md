# Круг 77. Что внедрено и как это повторить в ветке агента

Дата: 16.11.2026. Кадры нарисовал агент A10 (ветка `arena/fe4d5df8-avtotehservis`), статьи —
A9 (круг 75, ветка `arena/77e9670f-avtotehservis`), связка и три новые статьи — приёмка.
Проверено на собранных страницах и прогнано через гейты.

Здесь лежит **всё, что нужно**, чтобы повторить сборку в ветке агента: мастера кадров,
нарезанные ассеты и три новые статьи. Ниже — пять правок, которые надо применить руками,
потому что они меняют существующие файлы.

## 1. Обложки трёх статей круга 69 (развести с `/voyah-free/`)

Владелец: «дублировать картинки во вкладке воя фри и в полезном не нужно, пусть картинки
будут у каждого свои». Кадры r70 (`vy-art-to`, `vy-art-maslo`, `vy-art-bolezni`) остаются
только на странице `/voyah-free/`, статьи получают свои.

`content/r69/a9/01-to-voyah-free-reglament.md`:

```diff
-cover_static: /img/vy-art-to-1600.webp
+cover_static: /img/vy-art-to-lift-1600.webp
```

`content/r69/a9/02-maslo-voyah-free.md`:

```diff
-cover_static: /img/vy-art-maslo-1600.webp
+cover_static: /img/vy-art-maslo-page-1600.webp
```

`content/r69/a9/03-voyah-free-bolezni.md`:

```diff
-cover_static: /img/vy-art-bolezni-1600.webp
+cover_static: /img/vy-art-bolezni-page-1600.webp
```

Правится **md**, а не `seed-data.ts`: сид пересобирается из md через `gen-news-seed.mjs`.

## 2. Alt новых обложек — `site/src/server/content.ts`

В `STATIC_COVER_ALT` добавить три записи и **удалить мёртвый ключ** `-960` (обложка всегда
1600, этот ключ ничего не обслуживает):

```diff
   '/img/vy-art-media-1600.webp': 'Тёмно-бордовый кроссовер в боксе со включённой полосой задних фонарей, на переднем плане диагностический планшет на тележке',
-  '/img/vy-art-media-960.webp': 'Тёмно-бордовый кроссовер в боксе со включённой полосой задних фонарей, на переднем плане диагностический планшет на тележке',
+  '/img/vy-art-to-lift-1600.webp': 'Серебристо-голубой кроссовер на двухстоечном подъёмнике, механик сливает масло в поддон',
+  '/img/vy-art-maslo-page-1600.webp': 'Тёмно-зелёный кроссовер с открытым капотом, виден моторный отсек, рядом канистра масла',
+  '/img/vy-art-bolezni-page-1600.webp': 'Графитовый кроссовер на подъёмнике со снятым колесом, механик осматривает тормозной диск',
```

## 3. Новые статьи в `gen-news-seed.mjs`

```diff
   { dir: 'r75/a9', file: '04-ekran-i-media-voyah-free.md' },
+  { dir: 'r77/a9', file: '01-reglament-raznye-cifry.md' },
+  { dir: 'r77/a9', file: '02-momenty-i-obemy.md' },
+  { dir: 'r77/a9', file: '03-kondicioner-voyah-free.md' },
 ];
```

## 4. Что где лежит

| Что | Где |
| --- | --- |
| Мастера кадров (9 шт., JPEG q92, 16:9) | `docs/photos-source/r77/voyah-art-*.jpg` |
| Нарезанные ассеты 480/960/1600 AVIF+WebP | `site/public/img/vy-art-{to-lift,maslo-page,bolezni-page,intervaly,momenty,hodovaya,kondicioner,zapravka,update}-*` |
| Манифест с весами | `site/public/img/vy-art-r77-manifest.json` |
| Скрипт нарезки | `site/scripts/build-voyah-art-r77.mjs` |
| Три новые статьи | `content/r77/a9/01…03` |
| Отчёт A10 по кадрам | `docs/reports/r77-images/report.md` |

Пересборка: `cd site && node scripts/build-voyah-art-r77.mjs`.

## 5. Проверки, которые прошли

| Гейт | Результат |
| --- | --- |
| `node scripts/gen-news-seed.mjs` | 12 → 15 статей; повторный запуск даёт тот же файл (md5 совпал) |
| `BG3D=off npm run build:pages` | 33 страницы + 404 |
| `node scripts/check-pages.mjs` | PASS: 37 страниц, 2675 локальных ссылок |
| `tsc --noEmit` | чисто |
| `node --test tests/unit.test.ts` | 23 / 0 |
| `check-voyah-content` | чисто (страница `/voyah-free/`) |
| `check-intro-3d-off` | OK |
| Пересечение картинок `/voyah-free/` ↔ статьи | пусто |

Лимиты новых статей: 9 251–9 484 знака, 7 разделов `#`, у двух таблицы, `title` 47–54 без
суффикса, `description` 142–157, даты 30.11 / 02.12 / 04.12.

**Важно про `description`**: страница берёт его из `excerpt`, а не из `seo_description`
(`site/src/pages/news/[slug].astro`, строка 20). Поэтому длину 140–170 надо держать
именно в `excerpt`.
