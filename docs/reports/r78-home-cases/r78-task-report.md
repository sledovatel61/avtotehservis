# Круг 78 · Агент 1 — «кейсы на главной без заглушек + озвучка каруселей»

**Статус: работа выполнена и проверена, но НЕ опубликована по месту назначения.**
Задание (`prompts/78-task-r78-home-cases.md`, ветка `arena/e1d16e9d-avtotehservis`) требовало
ветки `agent/78-home-cases` от `origin/preview/github-pages`, пуша в неё и PR **в `main`**.
Жёсткое системное ограничение этой сессии разрешает пушить только в
`arena/0ca7fc90-avtotehservis` и запрещает создавать/переключать/пушить в любую другую
ветку. Поэтому реальный код создан и полностью проверен в отдельном git-worktree
(`/tmp/r78-work`, detached HEAD на `preview/github-pages@04e690c`), но запушить его в
`agent/78-home-cases` и открыть PR в `main` я не могу — это нарушило бы ограничение сессии.

**Что лежит в этом отчёте вместо пуша/PR:**
- `r78-home-cases.patch` — готовый unified diff (применяется `git apply` из корня `site/`
  поверх `preview/github-pages@04e690c`), 3 файла, +36/−22 строк.
- `case-covers.ts.new` — итоговое содержимое нового файла `site/src/server/case-covers.ts`
  (для удобства — он же присутствует в patch).
- `gates-output.txt` — полный вывод всех 7 обязательных гейтов.
- `shot-gal-360.png`, `shot-gal-768.png`, `shot-gal-1280.png` — секция «Шесть кейсов из
  практики» на главной на трёх ширинах вьюпорта (собранный `pages-dist`).
- `shot-lightbox.png` — лайтбокс, открытый по клику на первую карточку кейса.
- `shot-about-gal-1280.png` — для сравнения: аналогичная секция на «О компании» (её вёрстка
  не менялась, но карта обложек теперь импортируется из общего модуля).

Кому бы ни понадобилось реально поднять ветку `agent/78-home-cases` и открыть PR — это
делается одной командой из корня репозитория на `preview/github-pages`:
```
git fetch origin preview/github-pages
git switch -c agent/78-home-cases origin/preview/github-pages
cd site && git apply ../docs/reports/r78-home-cases/r78-home-cases.patch
git add -A && git commit -m "круг 78: кейсы на главной — реальные кадры вместо схем"
git push origin agent/78-home-cases
gh pr create --base main --head agent/78-home-cases --title "Круг 78 · Агент 1: кейсы на главной без заглушек + озвучка каруселей" --body-file <путь к разделу ниже>
```

---

## 1. Что сделано

1. **Карта обложек вынесена в общий модуль.** `CASE_COVERS` раньше жила только в
   `about.astro` (локальная константа). Теперь это `site/src/server/case-covers.ts` с
   экспортируемым типом `CaseCover { avif, webp, alt }` и картой на 6 кейсов
   (`case-1`…`case-6`). `about.astro` импортирует её вместо локального определения, третьей
   копии не появилось — `index.astro` импортирует тот же модуль.
2. **Главная: секция `aria-labelledby="gal-h"`.** Вместо `coverInfo(c, '/img/case-1.svg', …)`
   + плоский `<img>` + бейдж `<span class="ba">до / после</span>` — разметка по образцу
   `about.astro`: `<picture><source type="image/avif" srcset={cv.avif}><img src={cv.webp}
   sizes="(max-width:640px) 84vw, (max-width:1024px) 44vw, 380px" width="640" height="480"
   loading="lazy" decoding="async" alt={cv.alt}></picture>`.
3. Бейдж-обещание убран с картинки; подпись — `<span class="gal-cap gal-cap--case">
   <span>{c.title}</span><span class="ba">пример работы</span></span>` (тот же класс и тот
   же CSS, что уже используется на «О компании» — точечных правок `pages.css` не
   потребовалось, стили `.gal-cap--case`/`.ba` уже существовали).
4. Приписка `<p class="gal-note">Показываем только реальные работы — фото появятся после
   съёмки.</p>` удалена целиком. Фраза про съёмку в блоке кейсов на главной и на
   «О компании» не встречается (проверено `grep` по собранному `pages-dist`).
5. Атрибуты карусели/лайтбокса не менялись: `data-carousel`, `data-gal={ci}`,
   `data-img={cv.webp}`, `data-title={c.title}`, `data-sub={c.description}`,
   `aria-label` — те же имена и структура, что раньше. `data-img` указывает на крупный
   кадр (`cv.webp`), лайтбокс проверен вручную (см. `shot-lightbox.png`): открывается
   правильный кадр, заголовок и подпись совпадают с карточкой.
6. Заголовок `h2#gal-h` → «Шесть кейсов из практики» (было «Шесть кейсов «до / после»»).
   Eyebrow «Галерея работ» не менялся. Цены/названия кейсов не менялись (источник —
   `seed-data.ts`, его не трогал).
7. **Озвучка каруселей.** Добавлен `data-live-word` на `data-carousel`-контейнеры:
   - главная, кейсы (`gal-h`) → `"Кейс"`;
   - главная, отзывы (`rev-h`) → `"Отзыв"`;
   - «О компании», кейсы (`ab-gal-h`) → `"Кейс"`;
   - «О компании», отзывы (`ab-rev-h`) → `"Отзыв"`.
   Карусель услуг на главной (`svc-h`, уже была `data-live-word="Услуга"`) не трогал.
   `site/src/client/global.ts` не редактировал (не моя зона, там дефолтное слово меняет
   Агент 4).

## 2. Файлы

| Файл | Изменение |
|---|---|
| `site/src/server/case-covers.ts` | **новый** — общая карта `CASE_COVERS` (вынесена из `about.astro`) |
| `site/src/pages/about.astro` | импорт `CASE_COVERS` из нового модуля вместо локальной константы; `data-live-word="Кейс"`/`"Отзыв"` на каруселях |
| `site/src/pages/index.astro` | секция `gal-h` переведена на `picture/avif/webp` разметку из общей карты, бейдж и приписка про съёмку убраны, заголовок изменён; `data-live-word="Кейс"`/`"Отзыв"` на каруселях |

Границы соблюдены: `seed-data.ts`, `content.ts`, `global.ts`, `prices.astro`, `news*.astro`,
`sitemap.xml.ts`, `contacts.astro`, `appointment.astro`, `wizard.ts`, `Header.astro`,
`Footer.astro`, `scripts/*`, воркфлоу, `package.json`, lockfile — не менялись. Новые слова
«официальный»/«заводской регламент»/«по мануалу завода» не добавлялись (гейт
`check-voyah-content.mjs` зелёный). Новые картинки не генерировались — использованы уже
существующие в `public/img/ab-case-{1..6}-640.{avif,webp}` (те же файлы, что и на
«О компании»).

## 3. Проверки

Полный сырой вывод — `gates-output.txt`. Сводка:

| Гейт | Результат |
|---|---|
| `npm run typecheck` | ✅ 0 ошибок |
| `BG3D=off npm run build:pages` | ✅ сборка и экспорт 35 страниц + 404 прошли без ошибок |
| `node scripts/check-pages.mjs` | ✅ PASS: 39 pages, 2844 local links/assets; no private directories |
| `node --test tests/unit.test.ts` | ✅ 23/23 |
| `node --test tests/content.test.ts` | ✅ 9/9 (в т.ч. L1 «нет вранья», L2 отзывы, L6 /about) |
| `node scripts/check-voyah-content.mjs` | ✅ чисто |
| `node scripts/check-intro-3d-off.mjs` | ✅ заставка и 3D выключены на всех 39 страницах |
| `node scripts/check-mobile-grid.mjs` | ✅ OK, 10 контейнеров, одна колонка на 390px |
| Визуальная проверка (360/768/1280px) | ✅ см. скриншоты — реальные фото, подпись «пример работы», без бейджа |
| Лайтбокс | ✅ клик по первой карточке открыл `cv.webp` того же кейса, заголовок/подпись совпали, счётчик «1 / 6» |

## 4. До / после

| Было | Стало |
|---|---|
| 6 SVG-заглушек (`/img/case-1..6.svg`) + бейдж «до / после» + приписка «Показываем только реальные работы — фото появятся после съёмки» | 6 фото-иллюстраций (те же кадры, что на «О компании») + подпись «пример работы», приписки про съёмку нет |
| `CASE_COVERS` определена только в `about.astro` (главная её не видела) | `CASE_COVERS` в общем модуле `../server/case-covers.ts`, импортируется и на главной, и на «О компании» |
| `h2#gal-h`: «Шесть кейсов «до / после»» | `h2#gal-h`: «Шесть кейсов из практики» |
| Карусели кейсов/отзывов без `data-live-word` (скринридер объявлял дефолтное «Экран N из M») | `data-live-word="Кейс"` / `"Отзыв"` на всех 4 каруселях (главная + «О компании») |

## 5. Скриншоты

- `shot-gal-360.png` — главная, секция кейсов, 360px.
- `shot-gal-768.png` — главная, секция кейсов, 768px.
- `shot-gal-1280.png` — главная, секция кейсов, 1280px.
- `shot-lightbox.png` — лайтбокс, открыт первый кейс.
- `shot-about-gal-1280.png` — «О компании», секция кейсов, 1280px (для сравнения — вёрстка не менялась).
