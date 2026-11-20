# Архив сайта ats-rostov.ru: как скачать всё с GitHub на свой компьютер

**Что получится:** в папке `C:\ATS-архив\2026-11-20\` два zip-файла:

| Файл | Что внутри | Кому |
|---|---|---|
| `ats-rostov.ru-сайт-2026-11-20.zip` (~15 МБ) | готовые страницы сайта: то, что видят посетители. Открывается двойным щелчком по `start.cmd` | заказчику, себе в резерв |
| `ats-rostov-исходники-2026-11-20.zip` (~25 МБ) | код сайта без внутренних рабочих папок: из него можно собрать сайт заново | разработчику, если сайт будет переезжать |

Ниже — готовый промпт для Клайна. Скопируйте его целиком и вставьте в чат Клайна. Он всё сделает сам, а в конце пришлёт отчёт. Если Клайн не справится — в конце есть те же команды руками.

---

## 1. Что поставить на компьютер (один раз, 10 минут)

| Программа | Зачем | Где взять |
|---|---|---|
| **Git** | скачать репозиторий | https://git-scm.com/download/win (установка «далее-далее») |
| **GitHub CLI (`gh`)** | скачать готовую сборку сайта с сервера GitHub | `winget install --id GitHub.cli -e` в PowerShell или https://cli.github.com |
| **Node.js LTS** | посмотреть архив локально и, при необходимости, собрать сайт заново | https://nodejs.org (кнопка LTS) |
| **7-Zip** | если понадобится распаковать без Windows | https://7-zip.org |

Проверка: откройте PowerShell и выполните по очереди — каждая команда должна ответить номером версии:

```powershell
git --version
gh --version
node -v
```

После установки Git и `gh` закройте и снова откройте PowerShell, иначе команды не найдутся.

**Один раз войдите в GitHub** (нужно только для скачивания сборки; репозиторий публичный, но GitHub не отдаёт артефакты без входа):

```powershell
gh auth login -h github.com -p https -w
```

Откроется браузер, нажмите «Authorize» и вернитесь в PowerShell.

---

## 2. Промпт для Клайна — копировать целиком

> Вставьте этот текст в чат Клайна одним сообщением. Если у вас другой диск — замените `C:\ATS-архив` на `D:\ATS-архив` во всём тексте.

```
Ты помогаешь сделать резервную копию сайта ats-rostov.ru на моём компьютере.
Система: Windows, терминал PowerShell. Отвечай по-русски, коротко и по делу.

ЧТО НУЖНО ПОЛУЧИТЬ В ИТОГЕ
Папка C:\ATS-архив\2026-11-20 с двумя zip-файлами:
  1) ats-rostov.ru-сайт-2026-11-20.zip — готовые страницы сайта + скрипт локального просмотра;
  2) ats-rostov-исходники-2026-11-20.zip — код сайта без внутренних рабочих папок.
Внутри той же папки оставь рабочие каталоги source\, client\, source-clean\ и файл SHA256SUMS.txt.

ИСХОДНЫЕ ДАННЫЕ (проверено, не переспрашивай)
- Репозиторий: https://github.com/sledovatel61/avtotehservis (публичный)
- Ветка по умолчанию: preview/github-pages
- Сайт собирается workflow .github/workflows/pages.yml, имя сборки «Publish client preview»,
  имя артефакта с готовым сайтом — github-pages (внутри один файл artifact.tar)
- Живой адрес сайта: https://ats-rostov.ru

ПРАВИЛА
- Ничего не удаляй и не меняй за пределами C:\ATS-архив.
- Не делай git push, git commit и не меняй файлы в репозитории.
- После каждого шага печатай одной строкой, что получилось.
- Если команда упала — покажи текст ошибки целиком, предложи два варианта решения и жди моего ответа.
- Не запускай интерактивные команды без предупреждения: gh auth login выполняю я сам.
- В конце обязательно выполни раздел ПРОВЕРКА и покажи отчёт.

ШАГ 0. Инструменты
Выполни: git --version; gh --version; node -v
Если gh не найден — скажи мне поставить его командой winget install --id GitHub.cli -e и остановись.
Если node не найден — предупреди, что локальный просмотр не заработает, но продолжай.
Выполни: gh auth status
Если не залогинен — остановись и попроси меня выполнить gh auth login -h github.com -p https -w.

ШАГ 1. Папки
$ROOT = "C:\ATS-архив\2026-11-20"
Создай $ROOT, $ROOT\temp, $ROOT\client.

ШАГ 2. Исходники (клон без истории, чтобы не тянуть сотни мегабайт)
git clone --depth 1 --branch preview/github-pages https://github.com/sledovatel61/avtotehservis.git "$ROOT\source"
Проверь, что существует $ROOT\source\site\package.json.

ШАГ 3. Готовая сборка сайта с сервера GitHub
$id = gh run list --repo sledovatel61/avtotehservis --workflow pages.yml --limit 10 --json databaseId,conclusion --jq '[.[] | select(.conclusion=="success")][0].databaseId'
Если $id пустой — переходи к ШАГУ 3б и скажи об этом.
gh run download $id --repo sledovatel61/avtotehservis -n github-pages -D "$ROOT\temp\artifact"
В папке должен появиться файл artifact.tar. Распакуй его в $ROOT\client\site:
tar -xf "$ROOT\temp\artifact\artifact.tar" -C "$ROOT\client\site"
Проверь, что есть $ROOT\client\site\index.html.

ШАГ 3б. Если артефакта нет (истёк срок хранения или скачивание упало)
Собери сайт из исходников сам:
  cd "$ROOT\source\site"
  npm ci
  $env:PUBLIC_ORIGIN = "https://ats-rostov.ru"
  npm run build:pages
Затем скопируй содержимое $ROOT\source\site\pages-dist в $ROOT\client\site.
Сборка печатает «Exported 45 public pages + 404» — это нормальный результат.

ШАГ 4. Файлы для просмотра и служебная папка панели
Нужны три служебных файла: serve.mjs, start.cmd, ЭТА-ПАПКА-СНАЧАЛА.txt.
Сначала поищи их в клоне: $ROOT\source\docs\archive-pack\
Если папки нет — скачай по одному:
  $raw = "https://raw.githubusercontent.com/sledovatel61/avtotehservis/arena/ffa2735f-avtotehservis/docs/archive-pack"
  Invoke-WebRequest "$raw/serve.mjs" -OutFile "$ROOT\client\serve.mjs"
  Invoke-WebRequest "$raw/start.cmd" -OutFile "$ROOT\client\start.cmd"
  Invoke-WebRequest "$raw/%D0%AD%D0%A2%D0%90-%D0%9F%D0%90%D0%9F%D0%9A%D0%90-%D0%A1%D0%9D%D0%90%D0%A7%D0%90%D0%9B%D0%90.txt" -OutFile "$ROOT\client\ЭТА-ПАПКА-СНАЧАЛА.txt"
Если и это не получилось — продолжай без них и напиши об этом в отчёте: архив сайта всё равно годен.
Удали папку $ROOT\client\site\manage — это служебная панель владельца, заказчику она не нужна.
Если после удаления остались битые ссылки на /manage — не исправляй, просто скажи мне.

ШАГ 5. Архив для заказчика
Compress-Archive -Path "$ROOT\client\*" -DestinationPath "$ROOT\ats-rostov.ru-сайт-2026-11-20.zip" -CompressionLevel Optimal

ШАГ 6. Исходники без внутренних папок
Скопируй $ROOT\source в $ROOT\source-clean (без папки .git).
В $ROOT\source-clean удали: .git, node_modules, site\node_modules, site\dist, site\pages-dist,
prompts, promts, evaluation, reviews, agents-output, mockups, reference, result.zip
Папку docs удали целиком: там рабочие заметки, брифы и переписка по проекту, заказчику они не нужны.
Оставь: AGENTS.md, README.md, site\, relay\, .github\, .gitignore
Создай в $ROOT\source-clean файл ЧТО-ЭТО.txt с текстом:
  «Исходники сайта ats-rostov.ru на 20.11.2026.
   Сайт: Astro + TypeScript. Установка: cd site; npm ci; npm run build:pages — результат в site/pages-dist.
   Публикация: workflow .github/workflows/pages.yml на GitHub Pages.
   Прослойка заявок (Cloudflare Worker): папка relay, инструкция в relay/README.md.
   Секретов в архиве нет: ключи Telegram, почты и Cloudflare живут в настройках Cloudflare и GitHub.»
Compress-Archive -Path "$ROOT\source-clean\*" -DestinationPath "$ROOT\ats-rostov-исходники-2026-11-20.zip" -CompressionLevel Optimal

ШАГ 7. Контрольные суммы
Получи SHA-256 обоих zip файлов и запиши в $ROOT\SHA256SUMS.txt в виде «хеш  имя-файла».

ШАГ 8. ПРОВЕРКА (обязательно, покажи результат таблицей)
Проверь и напиши «да/нет» по каждому пункту:
1. $ROOT\client\site\index.html существует.
2. В $ROOT\client\site есть папки img, _astro, fonts и файлы robots.txt, sitemap.xml, 404.html.
3. Файл $ROOT\client\site\img\k103-facade-640.webp существует (свежие фото сервиса от 20.11).
4. Число html-файлов в $ROOT\client\site не меньше 45.
5. В $ROOT\source-clean нет папок .git, node_modules, prompts, evaluation, reviews, docs.
6. В $ROOT\source-clean\site\package.json существует, в $ROOT\source-clean\relay\README.md существует.
7. В архивах нет файлов .env (кроме .env.example) и нет файлов .pem, .key.
8. Размер первого zip от 10 до 40 МБ, второго — от 15 до 80 МБ.
9. Оба zip открываются: проверь через Expand-Archive одного файла из каждого архива во временную папку.

ЗАПУСК ПРОСМОТРА (после проверки)
Запусти $ROOT\client\start.cmd, дождись строки «Архив сайта открыт: http://localhost:8080»
и проверь, что страницы http://localhost:8080/ и http://localhost:8080/about отвечают кодом 200.
Затем останови сервер (Ctrl+C или закрой окно).

ФИНАЛЬНЫЙ ОТЧЁТ
Напиши: путь к папке, два пути к zip с размерами, результат проверки по 9 пунктам,
что не получилось и что я должен сделать руками. Ничего не удаляй после отчёта.
```

---

## 3. Если Клайн не справится — те же шаги руками

**Сколько места нужно:** временно около 1 ГБ. В репозитории лежат рабочие материалы проекта (ревью, оценки, брифы) — они весят больше самого сайта. После сборки архива папки `source` и `source-clean` можно удалить, останутся только два zip примерно на 40 МБ.

Откройте PowerShell и выполняйте по одной строке. Всё занимает 5–10 минут.

```powershell
# 1. папки
$ROOT = "C:\ATS-архив\2026-11-20"
New-Item -ItemType Directory -Force -Path "$ROOT\temp","$ROOT\client" | Out-Null

# 2. исходники (без истории — быстрее и меньше)
git clone --depth 1 --branch preview/github-pages https://github.com/sledovatel61/avtotehservis.git "$ROOT\source"

# 3. готовая сборка с GitHub: номер последней успешной сборки
$id = gh run list --repo sledovatel61/avtotehservis --workflow pages.yml --limit 10 --json databaseId,conclusion --jq '[.[] | select(.conclusion=="success")][0].databaseId'
$id
gh run download $id --repo sledovatel61/avtotehservis -n github-pages -D "$ROOT\temp\artifact"
tar -xf "$ROOT\temp\artifact\artifact.tar" -C "$ROOT\client\site"

# 4. файлы просмотра
Copy-Item "$ROOT\source\docs\archive-pack\*" "$ROOT\client\" -Force
Remove-Item "$ROOT\client\site\manage" -Recurse -Force

# 5. архив для заказчика
Compress-Archive -Path "$ROOT\client\*" -DestinationPath "$ROOT\ats-rostov.ru-сайт-2026-11-20.zip" -CompressionLevel Optimal
```

Дальше — исходники без внутренних папок (шаг 6 из промпта) и контрольные суммы. Проще всего взять оттуда же:

```powershell
Copy-Item "$ROOT\source" "$ROOT\source-clean" -Recurse
Remove-Item "$ROOT\source-clean\.git","$ROOT\source-clean\site\dist","$ROOT\source-clean\site\pages-dist",
  "$ROOT\source-clean\prompts","$ROOT\source-clean\promts","$ROOT\source-clean\evaluation",
  "$ROOT\source-clean\reviews","$ROOT\source-clean\agents-output","$ROOT\source-clean\mockups",
  "$ROOT\source-clean\reference","$ROOT\source-clean\docs","$ROOT\source-clean\result.zip" -Recurse -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$ROOT\source-clean\*" -DestinationPath "$ROOT\ats-rostov-исходники-2026-11-20.zip" -CompressionLevel Optimal

Get-FileHash "$ROOT\*.zip" -Algorithm SHA256 | ForEach-Object { "$($_.Hash)  $(Split-Path $_.Path -Leaf)" } |
  Set-Content "$ROOT\SHA256SUMS.txt"
```

**Если сборка с GitHub не скачивается** (артефакт живёт 90 дней, потом удаляется) — соберите сайт сами:

```powershell
cd "$ROOT\source\site"
npm ci
$env:PUBLIC_ORIGIN = "https://ats-rostov.ru"
npm run build:pages
# результат: site\pages-dist — скопируйте его содержимое в $ROOT\client\site
```

---

## 4. Как проверить, что архив рабочий

Откройте `C:\ATS-архив\2026-11-20\client\start.cmd`. Через пару секунд откроется браузер на `http://localhost:8080`. Проверьте:

- [ ] главная страница: фото фасада, вывеска, телефоны;
- [ ] «О компании» (`/about`): блок «Как выглядит сервис» с четырьмя фотографиями;
- [ ] «Цены» (`/prices`) и «Контакты» (`/contacts`) открываются;
- [ ] картинки и шрифты на месте (если видите пустые рамки — вы открыли `index.html` двойным щелчком, а не через `start.cmd`).

**Почему нельзя просто открыть `index.html`.** Все адреса внутри сайта начинаются с корня: `/img/...`, `/prices/`. В режиме файла браузер ищет их на диске `C:\` и страница остаётся без картинок. `start.cmd` поднимает локальный мини-сервер — он отдаёт файлы так же, как настоящий хостинг. Интернет для этого не нужен.

---

## 5. Что отдавать заказчику

**Отдавайте два файла и короткое письмо:**

> Здравствуйте! Направляю архив сайта ats-rostov.ru по состоянию на 20 ноября 2026 года.
> 1. `ats-rostov.ru-сайт-2026-11-20.zip` — готовый сайт. Чтобы посмотреть: распакуйте, запустите `start.cmd`, откроется браузер.
> 2. `ats-rostov-исходники-2026-11-20.zip` — исходный код. Внутри `ЧТО-ЭТО.txt`: как собрать сайт заново и как он публикуется. Пригодится, если сайт будет переезжать на другой хостинг или его будет дорабатывать другой разработчик.
> Контрольные суммы в `SHA256SUMS.txt` — чтобы убедиться, что файлы не повредились при передаче.
> Сайт продолжает работать по адресу https://ats-rostov.ru.

**Чего в архиве нет и почему — так и скажите заказчику, чтобы не было вопросов:**

| Чего нет | Где живёт | Почему |
|---|---|---|
| Ключи Telegram, почты, Cloudflare | в настройках GitHub и Cloudflare | секреты в код не кладут: иначе их увидит любой, кто откроет архив |
| Заявки клиентов и отзывы с сайта | Cloudflare KV (хранилище воркера) | это персональные данные, они не часть сайта — см. раздел 7 |
| Аккаунты Яндекс.Метрики и Директа | в ваших аккаунтах `pavel.yakovenko@mail.ru` | доступы не передаются вместе с файлами |
| Домен `ats-rostov.ru` | регистратор домена | домен — отдельный договор, не файл |

---

## 6. Что важно знать про публичность репозитория

Репозиторий **сейчас публичный**: любой человек может открыть https://github.com/sledovatel61/avtotehservis и прочитать не только код, но и внутренние заметки (брифы, ревью, переписку по задачам). Секретов там нет, но заметки — внутренние.

Если это нежелательно:

1. Сначала перенесите сайт на другой хостинг (Cloudflare Pages или Netlify — оба бесплатны и собирают проект из того же репозитория), потому что **на бесплатном плане GitHub Pages работает только с публичными репозиториями**: закроете репозиторий — сайт на Pages может отключиться.
2. Затем: Settings → General → внизу Danger Zone → **Change visibility** → Private.
3. Проверьте, что сайт на новом хостинге открывается по адресу `ats-rostov.ru` (домен переносится в настройках DNS).

Пока вы этого не сделали — сайт и архив работают как обычно, менять ничего не обязательно.

---

## 7. Если понадобится архив заявок и отзывов (отдельная задача)

Заявки и отзывы лежат не на GitHub, а в Cloudflare KV. Их бэкап делается только с вашими доступами Cloudflare и в архив сайта не входит:

1. Войдите в Cloudflare: `npx wrangler login` (откроется браузер).
2. Посмотрите список хранилищ: `npx wrangler kv namespace list`.
3. Выгрузите ключи нужного хранилища: `npx wrangler kv key list --namespace-id=<id из шага 2>`.
4. Каждое значение читается отдельно: `npx wrangler kv key get "<ключ>" --namespace-id=<id> --remote > файл.json`.

Синтаксис в новых версиях `wrangler` немного меняется — если команда не узнаётся, посмотрите `npx wrangler kv --help`. Эти данные содержат телефоны и имена клиентов: храните архив заявок отдельно от сайта и не передавайте третьим лицам.

---

## 8. Частые ошибки и что делать

| Что видите | Причина | Решение |
|---|---|---|
| `gh: команда не найдена` | GitHub CLI установлен, но PowerShell открыт до установки | закройте и откройте PowerShell заново |
| `gh auth status` → `not logged in` | не выполнен вход | `gh auth login -h github.com -p https -w` |
| `gh run download` → `no valid artifacts found` | артефакт старше 90 дней или сборка упала | соберите сайт сами — блок «Если сборка с GitHub не скачивается» |
| `fatal: destination path already exists` | папка `source` уже есть | удалите `C:\ATS-архив` и начните заново |
| Страницы без картинок | открыли `index.html` двойным щелчком | запускайте `start.cmd` |
| `start.cmd` пишет, что нет Node.js | Node не установлен | поставьте с https://nodejs.org (LTS) или откройте живой сайт |
| `npm ci` падает на `better-sqlite3` | нет Visual Studio Build Tools | не нужно для архива: сборка сайта уже лежит в `pages-dist` или скачивается из GitHub |
| Zip больше 2 ГБ и `Compress-Archive` ругается | старая версия PowerShell | используйте 7-Zip: правый клик → «7-Zip» → «Добавить в архив» |
| `Invoke-WebRequest` не скачивает служебные файлы | нет интернета или ссылка устарела | архив сайта всё равно годен: откройте живой сайт https://ats-rostov.ru |
| Клон занимает почти гигабайт | в репозитории есть рабочие папки `evaluation`, `reviews`, `docs` | после сборки архива удалите `source` и `source-clean` — останутся только zip |

---

## 9. Что внутри репозитория (для справки)

```
site/            сам сайт: страницы (src/pages), стили, картинки (public/img),
                 тексты и цены (content/), скрипты проверок, тесты
site/pages-dist  готовая сборка (появляется после npm run build:pages)
site/deploy/     инструкция по установке на обычный сервер (nginx + systemd)
relay/           прослойка заявок на Cloudflare Workers: сайт → Telegram и почта
.github/         автопубликация сайта на GitHub Pages
docs/            внутренние заметки по проекту — заказчику не отдаём
docs/archive-pack/  служебные файлы для просмотра архива: serve.mjs, start.cmd, памятка
```

Проверить, что живой сайт тот же, что в архиве: откройте https://ats-rostov.ru и `http://localhost:8080` и сравните главную страницу. Даты в подвале и тексты должны совпадать.
