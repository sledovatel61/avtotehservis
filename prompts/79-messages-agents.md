# Круг 79 — сообщения агентам (готовы к отправке)

Нумерация сквозная по проекту (как в раундах 1–17), **не по кругу**:
**A5 — разработчик сайта**, **A6 — независимый ревьюер** (код не пишет),
**A7 и A8 — новые**, до этого круга в работе не участвовали.

| Агент | Роль | Задание (промпт) | Ветка | Когда стартует |
|---|---|---|---|---|
| **A5** | разработчик сайта — хранилище и витрина | `prompts/82-task-r79-cases-store.md` | `agent/79-cases-store` | сразу |
| **A7** | админка фото `/manage/` | `prompts/83-task-r79-photo-admin.md` | `agent/79-photo-admin` | сразу, параллельно с A5 |
| **A8** | гейты, тесты, инструкция | `prompts/84-task-r79-media-gates.md` | `agent/79-media-gates` | после мержа A5 и A7 |
| **A6** | приёмка | `prompts/85-task-r79-review.md` | `agent/79-review` | после публикации на Pages |

Правило круга: **A6 не пишет код**. Дефекты с приёмки уходят A5 / A7 (или оркестратору,
если это контракт), A6 проверяет исправление повторно.

---

## A5 (разработчик сайта)

```
Ты Агент 5 — разработчик сайта «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis).
Твой мокап заказчик выбрал 21.10.2026, ты ведёшь site/ с тех пор. Круг 79: кейсы «до / после»
переезжают из жёсткой карты CASE_COVERS в файл site/content/cases.json, который будет
заполнять владелец.

Задание целиком — в файле prompts/82-task-r79-cases-store.md ветки
arena/e1d16e9d-avtotehservis. Забери его так:

  git fetch origin arena/e1d16e9d-avtotehservis
  git show origin/arena/e1d16e9d-avtotehservis:prompts/82-task-r79-cases-store.md > /tmp/task.md

и работай строго по нему. Коротко: сайт должен читать site/content/cases.json, показывать
страницу кейса /cases/<slug>/ со сравнением «как было / как стало» (работает без JS, доступно
с клавиатуры), выводить реальные фото на главной и на «О компании» вместо иллюстраций
ab-case-*, и добавлять кейсы в sitemap.xml. Если cases.json пуст — сайт выглядит как сейчас,
это обязательное условие: превью у заказчика не должно сломаться.

Ветка: agent/79-cases-store от origin/preview/github-pages. Пуш только в неё, PR в
preview/github-pages, не мержить — публикует оркестратор.

Твои файлы: src/shared/cases-schema.ts, src/server/cases-store.ts, src/pages/cases/[slug].astro,
src/components/CaseCard.astro, src/client/cases.ts, src/styles/cases.css, пустой
site/content/cases.json + точечно index.astro, about.astro, sitemap.xml.ts, Base.astro.
Админку /manage/ пишет Агент 7 параллельно — site/public/manage/** не трогай.
Серверные media.ts, video.ts, seed-data.ts и все scripts/** не трогай: видео мы
выводим из оборота, отдельным шагом позже.

Гейты: npm run typecheck, BG3D=off npm run build:pages, node scripts/check-pages.mjs,
node --test tests/unit.test.ts, node --test tests/content.test.ts, check-voyah-content,
check-intro-3d-off, check-mobile-grid. Отчёт — по §8 задания, плюс раздел «что должен
заполнять Агент 7 в cases.json».
```

---

## A7 (админка фото, новый)

```
Ты Агент 7 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis). Раньше в проекте
ты не участвовал: A5 — разработчик сайта, A6 — ревьюер, ты — новый агент под отдельную задачу.

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
scripts/**, .github/**, .gitignore — не трогай. A5 параллельно делает витрину и читает
тот же cases.json — расхождение по полям сломает сайт, поэтому контракт не «улучшай».

Проверки: собрать статику (BG3D=off npm run build:pages), открыть /manage/ именно из
pages-dist через локальный http-сервер, проверить неверный токен, загрузку 5-МБ фото,
кроп/поворот, расчёт веса, обработку конфликта 422. check-pages.mjs должен быть зелёным.
Отчёт — §10 задания со скриншотами 360 px и 1280 px.
```

---

## A8 (гейты и инструкция, новый) — после мержа A5 и A7

```
Ты Агент 8 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis). Новый агент под
отдельную задачу: A5 — разработчик сайта, A6 — ревьюер, ты — гейты, тесты и инструкция.

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
A5, проверки в check-pages.mjs (manage без индексации, страницы кейсов, srcset, sitemap)
и инструкция владельцу docs/16-photo-admin-manual.md без технического жаргона.

Ветка: agent/79-media-gates от свежего origin/preview/github-pages. Пуш только в неё,
PR в preview/github-pages, не мержить.

Не правь site/src/** и site/public/manage/** — расхождения с контрактом описывай в отчёте,
это баги A5/A7. Не трогай export-pages.mjs, .github/**, package.json, seed-data.ts.

Гейты: typecheck, build:pages, check-pages, check-cases, check-media-budget,
node --test tests/photo-pipeline.test.ts, unit, content, check-voyah-content,
check-intro-3d-off, check-mobile-grid. Плюс самопроверка: испорченный cases.json и файл
900 КБ должны валить гейты.
```

---

## A6 (приёмка) — после публикации на Pages

```
Ты Агент 6, независимый ревьюер проекта «АвтоТехСервис» (sledovatel61/avtotehservis).
Круг 79: фото работ переехали в репозиторий, владелец грузит их сам с телефона через /manage/,
сайт показывает их на главной, на «О компании» и на странице кейса со сравнением
«как было / как стало».

Задание целиком — в prompts/85-task-r79-review.md ветки arena/e1d16e9d-avtotehservis:

  git fetch origin arena/e1d16e9d-avtotehservis
  git show origin/arena/e1d16e9d-avtotehservis:prompts/85-task-r79-review.md > /tmp/task.md

Ты код не пишешь — только проверяешь и пишешь отчёт. Главное, за что отвечаешь: пройти
сценарий владельца целиком (телефон, токен, загрузка 5-МБ фото, кроп, подпись, публикация,
сайт через 2 минуты), проверить слайдер без JS и с клавиатуры на 360/768/1280, вес фото,
безопасность токена (никуда кроме api.github.com, noindex, «Выйти» стирает), и отдельно —
что сломается при 30 и 100 кейсах, при удалении кейса, при HEIC с iPhone и при упавшей сборке.
Слова-гейты («официальный», «заводской регламент», «по мануалу завода») — тоже твоя зона.

Если реального токена нет — работай на моке fetch и честно напиши это в отчёте.

Вердикт: APPROVE / APPROVE WITH COMMENTS / REQUEST CHANGES. Отчёт —
reviews/round79-photo-pipeline.md в ветке agent/79-review от свежего origin/preview/github-pages.
Найденные дефекты не правь: они уходят A5 или A7, ты проверяешь исправление повторно.
Не мержить, не пушить в preview/github-pages.
```
