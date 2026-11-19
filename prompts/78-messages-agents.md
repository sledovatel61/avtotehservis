# Круг 78 — сообщения агентам (готовы к отправке)

Четыре агента работают параллельно, зоны файлов не пересекаются. Промпт — отдельный файл
в `prompts/`, ветка у каждого своя. Мержит и публикует оркестратор.

| Агент | Задание (промпт) | Ветка | Что закрывает |
|---|---|---|---|
| **Агент 1** «обложки и главная» | `prompts/78-task-r78-home-cases.md` | `agent/78-home-cases` | кейсы на главной без SVG-заглушек, бейдж «до / после» снят, озвучка каруселей (Кейс/Отзыв) |
| **Агент 2** «Полезное и прайс» | `prompts/79-task-r78-news-filter.md` | `agent/78-news-filter` | рабочий фильтр категорий по путям, «страница N из M», честная ссылка «Автокондиционеры» в прайсе |
| **Агент 3** «полировка» | `prompts/80-task-r78-site-polish.md` | `agent/78-site-polish` | служебные строки на «Контактах», дубль телефона в шапке/подвале, блок JSON из формы, подписи дней календаря |
| **Агент 4** «архив и порядок» | `prompts/81-task-r78-news-order-docs.md` | `agent/78-news-order` | статьи из будущего больше не первые, слово «Слайд» вместо «Экран», устаревшие `docs/12` и `docs/13` |

---

## Агент 1

```
Ты Агент 1 круга 78 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis).
Твоё задание целиком — в файле prompts/78-task-r78-home-cases.md ветки
arena/e1d16e9d-avtotehservis. Забери его так:

  git fetch origin arena/e1d16e9d-avtotehservis
  git show origin/arena/e1d16e9d-avtotehservis:prompts/78-task-r78-home-cases.md > /tmp/task.md

и работай строго по нему. Коротко: главная показывает шесть SVG-заглушек вместо кейсов —
ставь реальные кадры ab-case-* (карту вынеси в общий модуль, не копируй), убери бейдж
«до / после» и приписку про съёмку, добавь data-live-word «Кейс»/«Отзыв» каруселям на
главной и на «О компании».

Ветка: agent/78-home-cases от origin/preview/github-pages. Пуш только в неё, PR в main,
не мержить — публикует оркестратор. Твои файлы: index.astro, about.astro, новый
src/server/case-covers.ts. Чужие страницы (prices, news, contacts, appointment, wizard.ts,
content.ts, global.ts) не трогай — их правят другие агенты параллельно.

Гейты (все должны быть зелёные): npm run typecheck, BG3D=off npm run build:pages,
node scripts/check-pages.mjs, node --test tests/unit.test.ts, node --test tests/content.test.ts,
check-voyah-content, check-intro-3d-off, check-mobile-grid.

Отчёт — по шаблону §7 задания, с колонкой «до / после» и скриншотом карточек на 360 px.
```

---

## Агент 2

```
Ты Агент 2 круга 78 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis).
Твоё задание целиком — в prompts/79-task-r78-news-filter.md ветки
arena/e1d16e9d-avtotehservis:

  git fetch origin arena/e1d16e9d-avtotehservis
  git show origin/arena/e1d16e9d-avtotehservis:prompts/79-task-r78-news-filter.md > /tmp/task.md

Коротко: (1) чипы категорий в «Полезном» ведут на ?cat=, а GitHub Pages query игнорирует —
сделай настоящие адреса /news/cat/<slug>/ и /news/cat/<slug>/page/N/ по образцу уже
работающей пагинации, не забудь sitemap (экспорт рендерит только его адреса) и подпись
«Показано X из Y · страница N из M»; (2) в прайсе группа «Автокондиционеры» ссылается на
страницу «Диагностика» — сделай честную подпись ссылки. Услугу kondicioner НЕ включай:
«ровно 8 видимых услуг» — зафиксированное решение владельца, это проверяют content.test L3
и seed.test S2, тесты править нельзя.

Ветка: agent/78-news-filter от origin/preview/github-pages. Пуш только в неё, PR в main,
не мержить. Твои файлы: news.astro, news/page/[page].astro, новые news/cat/**, sitemap.xml.ts,
prices.astro. index/about/contacts/appointment/wizard.ts/content.ts/global.ts не трогай.

Гейты: typecheck, build:pages, check-pages, unit, content.test, seed.test, check-price-tables,
check-voyah-content, check-intro-3d-off. В отчёте — таблица новых адресов и объяснение,
почему ссылка прайса сделана именно так.
```

---

## Агент 3

```
Ты Агент 3 круга 78 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis).
Твоё задание целиком — в prompts/80-task-r78-site-polish.md ветки
arena/e1d16e9d-avtotehservis:

  git fetch origin arena/e1d16e9d-avtotehservis
  git show origin/arena/e1d16e9d-avtotehservis:prompts/80-task-r78-site-polish.md > /tmp/task.md

Коротко: на «Контактах» убрать служебную строку «График подтверждён владельцем 21.10.2026»
и технический абзац про «собственную SVG»; убрать вид дубля номера — в шапке, подвале и
карточке Telegram вместо «Telegram: +7 (951) 826-98-39» оставить понятное действие
«Написать в Telegram» (номер — в aria-label); удалить из формы записи демонстрационный блок
«Что уйдёт на сервер (JSON payload)»; добавить кнопкам календаря aria-label с полной датой
(«вторник, 17 ноября») вместо «вт17ноя».

Ветка: agent/78-site-polish от origin/preview/github-pages. Пуш только в неё, PR в main,
не мержить. Твои файлы: contacts.astro, appointment.astro, src/client/wizard.ts,
Header.astro, Footer.astro, стили .payload*. Телефоны/адрес/цены/график не менять,
сценарий формы не упрощать.

Гейты: typecheck, build:pages, check-pages, unit, e2e-form, admin.test, check-voyah-content,
check-intro-3d-off. Отдельно проверь, что отправка заявки не сломалась после удаления блока.
```

---

## Агент 4

```
Ты Агент 4 круга 78 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis).
Твоё задание целиком — в prompts/81-task-r78-news-order-docs.md ветки
arena/e1d16e9d-avtotehservis:

  git fetch origin arena/e1d16e9d-avtotehservis
  git show origin/arena/e1d16e9d-avtotehservis:prompts/81-task-r78-news-order-docs.md > /tmp/task.md

Коротко: (A) восемь статей датированы будущим (19.11–04.12) и стоят в «Полезном» первыми —
поправь сортировку в content.ts: сначала статьи с датой ≤ сейчас по убыванию, будущие после
них, даты не менять и статьи не скрывать, добавь тест в tests/unit.test.ts; (B) в global.ts
слово по умолчанию для каруселей «Экран» замени на «Слайд»; (C) приведи в соответствие с
фактами устаревший docs/12-content-checklist.md (в нём «прайса нет» при живом прайсе,
hero-1..3.svg при реальных фото) и добавь в docs/13-launch-checklist.md раздел «Канал приёмки
сейчас» про превью на GitHub Pages.

Ветка: agent/78-news-order от origin/preview/github-pages. Пуш только в неё, PR в main,
не мержить. Твои файлы: src/server/content.ts (только сортировка), src/client/global.ts
(одна строка), tests/unit.test.ts (только новый тест), docs/12, docs/13.

Гейты: typecheck, unit, build:pages, check-pages, content.test, seed.test,
check-voyah-content, check-intro-3d-off. В отчёте — первые 8 карточек /news/ до и после.
```

---

## Что делает оркестратор после PR

1. Ревью каждого PR по чек-листу (контент, доступность, мобайл, отсутствие чужих правок).
2. Черри-пик в `preview/github-pages` **по одному**, с прогоном гейтов после каждого:
   `typecheck` → `build:pages` → `check-pages` → `unit` → `content.test` → `check-voyah-content`
   → `check-intro-3d-off`.
3. Публикация: push в `preview/github-pages` → workflow «Publish client preview» → проверка
   живой страницы `fetch_page`.
4. Отчёт заказчику: что изменилось на превью, ссылки на страницы, что осталось.

> Важно: превью публикуется из `preview/github-pages`. Ветка агента сама ничего не публикует,
> поэтому «PR в main» — это форма приёмки, а не путь на сайт.
