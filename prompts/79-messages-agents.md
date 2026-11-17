# Круг 79 — сообщения агентам (готовы к отправке)

Три агента. Первые два стартуют сразу и параллельно (зоны файлов не пересекаются),
третий — после того как оркестратор смержит Агента 5 и Агента 6 в `preview/github-pages`.

| Агент | Задание (промпт) | Ветка | Что делает |
|---|---|---|---|
| **Агент 5** «хранилище и витрина» | `prompts/82-task-r79-cases-store.md` | `agent/79-cases-store` | `cases.json`, страница кейса, слайдер «до / после», реальные фото на главной и «О компании», sitemap |
| **Агент 6** «фотомастерская» | `prompts/83-task-r79-photo-admin.md` | `agent/79-photo-admin` | `/manage/` на статике: токен, загрузка, кроп/поворот/яркость, WebP 480/960/1600, публикация одним коммитом |
| **Агент 7** «сторож и инструкция» | `prompts/84-task-r79-media-gates.md` | `agent/79-media-gates` | гейты бюджета и контракта, тесты, `.gitignore`, инструкция владельцу |

---

## Агент 5

```
Ты Агент 5 круга 79 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis).
Задание целиком — в файле prompts/82-task-r79-cases-store.md ветки
arena/e1d16e9d-avtotehservis. Забери его так:

  git fetch origin arena/e1d16e9d-avtotehservis
  git show origin/arena/e1d16e9d-avtotehservis:prompts/82-task-r79-cases-store.md > /tmp/task.md

и работай строго по нему. Коротко: сайт должен читать site/content/cases.json, показывать
страницу кейса /cases/<slug>/ со сравнением «как было / как стало» (работает без JS, доступно
с клавиатуры), выводить реальные фото на главной и на «О компании» вместо иллюстраций
ab-case-*, и добавлять кейсы в sitemap.xml. Если cases.json пуст — сайт выглядит как сейчас,
это обязательное условие.

Ветка: agent/79-cases-store от origin/preview/github-pages. Пуш только в неё, PR в
preview/github-pages, не мержить — публикует оркестратор.

Твои файлы: src/shared/cases-schema.ts, src/server/cases-store.ts, src/pages/cases/[slug].astro,
src/components/CaseCard.astro, src/client/cases.ts, src/styles/cases.css, пустой
site/content/cases.json + точечно index.astro, about.astro, sitemap.xml.ts, Base.astro.
Админку /manage/ пишет Агент 6 параллельно — site/public/manage/** не трогай.
Серверные media.ts, video.ts, seed-data.ts и все scripts/** не трогай.

Гейты: npm run typecheck, BG3D=off npm run build:pages, node scripts/check-pages.mjs,
node --test tests/unit.test.ts, node --test tests/content.test.ts, check-voyah-content,
check-intro-3d-off, check-mobile-grid. Отчёт — по §8 задания, плюс раздел «что должен
заполнять Агент 6 в cases.json».
```

---

## Агент 6

```
Ты Агент 6 круга 79 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis).
Задание целиком — в prompts/83-task-r79-photo-admin.md ветки arena/e1d16e9d-avtotehservis:

  git fetch origin arena/e1d16e9d-avtotehservis
  git show origin/arena/e1d16e9d-avtotehservis:prompts/83-task-r79-photo-admin.md > /tmp/task.md

Работай строго по нему. Коротко: нужна страница /manage/ — обычная статика в
site/public/manage/ (без сборки, без CDN, относительные пути), которая по личному токену
GitHub читает и пишет site/content/cases.json и файлы site/public/media/cases/<slug>/ в ветку
preview/github-pages одним коммитом через Git Data API. Владелец грузит фото с телефона:
режим «До и после» (две зоны) или «Одно фото работы», кроп с пресетами 4:3/1:1/3:4/16:9,
поворот на 90°, горизонт ±15°, яркость, обязательная подпись, выбор обложки, порядок.
На выходе три WebP 480/960/1600. Ошибки (401/403/404/409/сеть) — человеческим языком.

Ветка: agent/79-photo-admin от origin/preview/github-pages. Пуш только в неё,
PR в preview/github-pages, не мержить.

Твои файлы: только site/public/manage/index.html, manage.css, app.js, editor.js, github.js,
store.js, README.md. Контракт cases.json — §5 задания, менять нельзя. site/src/**,
scripts/**, .github/**, .gitignore — не трогай.

Проверки: собрать статику (BG3D=off npm run build:pages), открыть /manage/ именно из
pages-dist через локальный http-сервер, проверить неверный токен, загрузку 5-МБ фото,
кроп/поворот, расчёт веса, обработку конфликта 422. check-pages.mjs должен быть зелёным.
Отчёт — §10 задания со скриншотами 360 px и 1280 px.
```

---

## Агент 7 (старт после мержа Агентов 5 и 6)

```
Ты Агент 7 круга 79 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis).
Задание целиком — в prompts/84-task-r79-media-gates.md ветки arena/e1d16e9d-avtotehservis:

  git fetch origin arena/e1d16e9d-avtotehservis
  git show origin/arena/e1d16e9d-avtotehservis:prompts/84-task-r79-media-gates.md > /tmp/task.md

Стартуй только если в origin/preview/github-pages уже есть site/src/shared/cases-schema.ts,
site/src/pages/cases/[slug].astro и site/public/manage/index.html. Если чего-то нет —
остановись и напиши, чего не хватает, ничего не додумывай.

Коротко: фото теперь живут в репозитории и уезжают на Pages. Нужно защитить эту схему:
site/.gitignore (media/ → /media/, чтобы public/media попадал в git), два гейта —
check-media-budget.mjs (вес, пары ширин, сироты, лимит файла) и check-cases.mjs (контракт
cases.json + наличие файлов + размеры + alt), тест tests/photo-pipeline.test.ts на схеме
Агента 5, проверки в check-pages.mjs (manage без индексации, страницы кейсов, srcset,
sitemap) и инструкция владельцу docs/16-photo-admin-manual.md без технического жаргона.

Ветка: agent/79-media-gates от свежего origin/preview/github-pages. Пуш только в неё,
PR в preview/github-pages, не мержить.

Не правь site/src/** и site/public/manage/** — расхождения с контрактом описывай в отчёте,
это баги Агентов 5/6. Не трогай export-pages.mjs, .github/**, package.json, seed-data.ts.

Гейты: typecheck, build:pages, check-pages, check-cases, check-media-budget,
node --test tests/photo-pipeline.test.ts, unit, content, check-voyah-content,
check-intro-3d-off, check-mobile-grid. Плюс самопроверка: испорченный cases.json и файл
900 КБ должны валить гейты.
```
