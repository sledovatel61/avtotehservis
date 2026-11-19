# Круг 85 — задания агентам: цены и услуги правятся из админки

Владелец: «У Паши есть доступ к админке с фото. Давай добавь туда возможность менять цены:
открыл — видит текущие цены по каждой категории, ввёл новую, нажал „Сохранить“. И чтобы
можно было добавлять услуги с ценами в любую категорию. Сам работу не делай, поручай
агентам и напиши, кому именно».

Решения по уточнениям владельца (19.11):

- новая услуга = **строка в прайсе** (название + цена в категории); карточку услуги и
  отдельную страницу не создаём;
- **категории** (ТО, Тормоза, …) мастер не создаёт и не удаляет — только позиции внутри;
- **тексты не редактируются**, но цифры не должны дублироваться: мастер меняет цену в
  прайсе, и она обновляется в карточках услуг, на главной, на «О компании», на Voyah Free.
  Один и тот же ценник — одно место. Отсюда у круга есть нулевой шаг: хранилище цен.

---

## Кому что

| Агент | Задание | Ветка | Что закрывает | Куда PR |
|---|---|---|---|---|
| **Агент 10** «прайс-хранилище» | `prompts/100-task-r85-prices-store.md` | `agent/85-prices-store` | `site/content/prices.json` + `src/shared/prices-schema.ts` + `src/server/prices-store.ts`; **все** страницы рендерят цифры оттуда, ни одной суммы в `.astro` и сиде | `preview/github-pages` |
| **Агент 11** «админка цен» | `prompts/101-task-r85-prices-admin.md` | `agent/85-prices-admin` | раздел `/admin/prices` («Цены и услуги») в серверной админке: правка цен по категориям, добавление строки, скрытие, журнал, выгрузка файла | `preview/github-pages` |
| **Агент 7** «мастерская `/manage/`» | `prompts/102-task-r85-prices-manage.md` | `agent/85-prices-manage` | вкладка «Цены и услуги» на `/manage/` — той админке, куда Паша уже заходит с телефона: та же правка, сохранение одним коммитом в GitHub | `preview/github-pages` |

Три агента работают **параллельно**, зоны файлов не пересекаются:

- Агент 10: `site/src/pages/{prices,voyah-free,index,about,services*}.astro`,
  `site/src/server/{prices-store.ts,prices.ts,seed-data.ts}`, `site/src/shared/prices-schema.ts`,
  `site/content/prices.json`, `site/scripts/check-price*.mjs`, `site/tests/prices.test.ts`.
- Агент 11: `site/src/pages/admin/**`, `site/src/layouts/Admin.astro`,
  `site/src/server/prices-admin-store.ts`, `site/tests/prices-admin.test.ts`.
- Агент 7: `site/public/manage/**`, `site/tests/manage-prices.test.ts`.

Общая точка — контракт `prices.json` (задание 85-1 §3). Его никто не «улучшает» в одиночку:
если агенту кажется, что поля не хватает, он пишет в PR, а не меняет формат.

`site/package.json` (строка `test`) трогают Агент 10 и Агент 11 — предупреди их, что конфликт
в этой строке разрешаем минимальной правкой.

---

## Готовые сообщения (копировать целиком в отдельный чат)

### Агенту 10 — прайс-хранилище

```
Ты Агент 10 круга 85 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis).
Твоё задание целиком — в файле prompts/100-task-r85-prices-store.md:

  git fetch origin preview/github-pages:refs/remotes/origin/preview-gp
  git show origin/preview-gp:prompts/100-task-r85-prices-store.md > /tmp/task.md

Работай строго по нему. Коротко: собрать все цены сайта в site/content/prices.json,
написать src/shared/prices-schema.ts и src/server/prices-store.ts и перевести на них
/prices, /voyah-free, главную, /about, карточки услуг и сид описаний услуг — так, чтобы
в исходниках не осталось ни одной суммы, только {{price:<id>}}.

Ветка: agent/85-prices-store от origin/preview/github-pages. PR в preview/github-pages,
не мержить — публикует оркестратор. Твои файлы: страницы с ценами, server/prices*,
server/seed-data.ts, shared/prices-schema.ts, content/prices.json, scripts/check-price*.mjs,
tests/prices.test.ts. НЕ трогай pages/admin/**, layouts/Admin.astro, public/manage/**,
migrations/** — их параллельно правят другие агенты.

Гейты: npm run typecheck, npm run build, PUBLIC_LEADS_ENDPOINT=https://ats-leads.ats439.workers.dev
npm run build:pages, node scripts/check-prices-sync.mjs --self-test,
node scripts/check-price-disclaimer.mjs --self-test, node scripts/check-pages.mjs,
node --test tests/prices.test.ts. Все должны быть зелёные.

В отчёте PR: сколько позиций перенёс, где страницы расходились между собой (это и есть
причина задачи), что осталось текстом.
```

### Агенту 11 — админка цен

```
Ты Агент 11 круга 85 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis).
Твоё задание целиком — в файле prompts/101-task-r85-prices-admin.md:

  git fetch origin preview/github-pages:refs/remotes/origin/preview-gp
  git show origin/preview-gp:prompts/101-task-r85-prices-admin.md > /tmp/task.md

Коротко: раздел «Цены и услуги» в существующей админке /admin — список всех цен сайта по
категориям, поле «новая цена» и кнопка «Сохранить», добавление новой строки в категорию,
скрытие строки, журнал действий, выгрузка файла цен. Всё по-русски, мобильно, без новых
зависимостей. Источник правды — site/content/prices.json и контракт §3 задания 85-1.

Ветка: agent/85-prices-admin от origin/preview/github-pages. PR в preview/github-pages,
не мержить. Твои файлы: pages/admin/prices/**, layouts/Admin.astro, server/prices-admin-store.ts,
tests/prices-admin.test.ts. НЕ трогай страницы сайта с ценами, seed-data, public/manage/**.

Гейты: npm run typecheck, npm run build, node --test tests/prices-admin.test.ts.
В PR опиши проверенный руками сценарий: правка цены → сохранение → дата → запись в журнале →
новая цифра на /prices; добавление и скрытие строки; мобильный вид 390 px.
```

### Агенту 7 — мастерская /manage/

```
Ты Агент 7 круга 85 на сайте «АвтоТехСервис» (репозиторий sledovatel61/avtotehservis).
Ты же делал фотомастерскую /manage/ в круге 79 — теперь в неё нужна вкладка цен.
Задание целиком — в файле prompts/102-task-r85-prices-manage.md:

  git fetch origin preview/github-pages:refs/remotes/origin/preview-gp
  git show origin/preview-gp:prompts/102-task-r85-prices-manage.md > /tmp/task.md

Коротко: на /manage/ переключатель «Фото работ» / «Цены и услуги»; во второй вкладке —
все цены сайта по категориям, текущая цена, поле новой, «Сохранить», «Добавить услугу»,
«Скрыть строку». Сохранение — одним коммитом в site/content/prices.json (сверить sha,
не затирать чужие правки), после — «Сайт обновится через 1–2 минуты» и ссылка на прайс.
Без сборки, зависимостей и CDN; 360 px — первичный размер.

Ветка: agent/85-prices-manage от origin/preview/github-pages. PR в preview/github-pages,
не мержить. Твои файлы: site/public/manage/** и site/tests/manage-prices.test.ts.

Обязательно: тест site/tests/manage-prices.test.ts сверяет твою валидацию
(manage/prices-schema.js) с site/src/shared/prices-schema.ts — вердикты обязаны совпадать.
Фото-часть должна работать как раньше; check-cases.mjs, check-pages.mjs,
check-media-budget.mjs — зелёные.
```

---

## Порядок мержа и проверки (оркестратор)

1. **Агент 10 первым.** От него зависит файл и схема. Проверяю фактический дифф:
   `git diff origin/preview-gp...agent/85-prices-store --stat`, глазами — `prices.json`
   против прежних цифр (ни одна цена не «поехала»), гейты, `grep -rc '₽' src | grep -v ':0'`
   → только `src/server/prices.ts`.
2. **Агент 11 вторым**, ребейз на свежий `preview/github-pages`; смотрю, что запись
   атомарная, что нет второго источника правды, что в интерфейсе нет технических слов.
3. **Агент 7 третьим**, ребейз; проверяю вкладку на 360 px, сохранение в реальную ветку
   (тестовый репозиторий/фикстура), сохранность фото-части.
4. `npm ci && npm run typecheck && npm run build && build:pages`, все гейты
   (`check-price-disclaimer`, `check-prices-sync`, `check-pages`, `check-cascade`,
   `check-mobile-grid`, `check-news-mobile`, `check-header-fluid`), тесты цен.
5. Merge → pages-ран зелёный → живая проверка `/prices`, `/voyah-free`, `/`, `/about`,
   `/services/<slug>`, `/manage/#prices` (страница статическая, отдаётся, вход по токену),
   `/admin/prices` (на сервере разработчика).

## Что сказать Паше, когда выйдет

- Заходить туда же, где фото: `https://sledovatel61.github.io/avtotehservis/manage/`,
  вкладка **«Цены и услуги»**.
- Слева категории: прайс, шины, Voyah Free, плашки на главной. В строке видно, сколько
  стоит сейчас; вводите новую — «Сохранить».
- Новая услуга: внизу категории «Название работы» + «Цена» → «Добавить».
- После сохранения сайт обновляется за 1–2 минуты, дата «Цифры подтверждены …» меняется
  сама; цена сразу новая везде — в прайсе, на карточках услуг, на главной, на Voyah.
- Категории (ТО, Тормоза, …) не удаляются и не создаются — если нужна новая, звонок
  разработчику. Ошиблись — «Скрыть» или просто поправьте снова.
