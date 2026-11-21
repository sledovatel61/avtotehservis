# Архив сайта ats-rostov.ru: скачать всё с GitHub на свой компьютер

**Что получится:** в папке `C:\ATS-архив\2026-11-20\` два zip-файла.

| Файл | Что внутри | Кому |
|---|---|---|
| `ats-rostov.ru-сайт-2026-11-20.zip` (~15 МБ) | готовые страницы сайта — то, что видят посетители. Открывается двойным щелчком по `start.cmd` | заказчику, себе в резерв |
| `ats-rostov-исходники-2026-11-20.zip` (~25 МБ) | код сайта без внутренних рабочих папок; из него можно собрать сайт заново | разработчику, если сайт будет переезжать |

Порядок: поставить три программы → скопировать один промпт в Клайн → проверить.
Промпт сам создаёт служебные файлы для просмотра, ничего дополнительно искать не нужно.

---

## 1. Что поставить на компьютер (один раз, 10 минут)

| Программа | Зачем | Где взять |
|---|---|---|
| **Git** | скачать репозиторий | https://git-scm.com/download/win — установка «далее-далее» |
| **GitHub CLI (`gh`)** | скачать готовую сборку сайта с сервера GitHub | в PowerShell: `winget install --id GitHub.cli -e` или https://cli.github.com |
| **Node.js LTS** | посмотреть архив локально и, при необходимости, собрать сайт заново | https://nodejs.org — кнопка LTS |
| **7-Zip** | необязательно: если Windows не откроет zip | https://7-zip.org |

Проверка: откройте PowerShell и выполните три команды — каждая должна ответить номером версии.

```powershell
git --version
gh --version
node -v
```

После установки закройте и снова откройте PowerShell, иначе команды не найдутся.

**Один раз войдите в GitHub.** Репозиторий публичный, но готовую сборку GitHub отдаёт только вошедшему пользователю.

```powershell
gh auth login -h github.com -p https -w
```

Откроется браузер, нажмите «Authorize» и вернитесь в PowerShell.

---

## 2. Промпт для Клайна — копировать целиком

Вставьте всё, что ниже, одним сообщением в чат Клайна. Если нужен другой диск, замените `C:\ATS-архив` на `D:\ATS-архив` во всём тексте.

~~~~
Ты помогаешь сделать резервную копию сайта ats-rostov.ru на моём компьютере.
Система: Windows, терминал PowerShell. Отвечай по-русски, коротко и по делу.

ЧТО НУЖНО ПОЛУЧИТЬ
Папка C:\ATS-архив\2026-11-20 с двумя zip-файлами:
  1) ats-rostov.ru-сайт-2026-11-20.zip — готовые страницы сайта и скрипт локального просмотра;
  2) ats-rostov-исходники-2026-11-20.zip — код сайта без внутренних рабочих папок.
Рядом оставь рабочие каталоги source\, client\, source-clean\ и файл SHA256SUMS.txt.

ИСХОДНЫЕ ДАННЫЕ (проверено, не переспрашивай)
- Репозиторий: https://github.com/sledovatel61/avtotehservis (публичный)
- Рабочая ветка: preview/github-pages
- Сайт собирается workflow .github/workflows/pages.yml («Publish client preview»),
  имя артефакта с готовым сайтом — github-pages (внутри один файл artifact.tar)
- Живой сайт: https://ats-rostov.ru

ПРАВИЛА
- Ничего не удаляй и не меняй за пределами C:\ATS-архив.
- Не делай git push и git commit, не меняй файлы в репозитории.
- После каждого шага печатай одной строкой, что получилось.
- Если команда упала — покажи текст ошибки целиком, предложи два варианта решения и жди моего ответа.
- Интерактивные команды без предупреждения не запускай: gh auth login выполняю я сам.
- В конце обязательно выполни раздел ПРОВЕРКА и покажи отчёт.

ШАГ 0. Инструменты
Выполни: git --version; gh --version; node -v
Если gh не найден — скажи мне выполнить winget install --id GitHub.cli -e и остановись.
Если node не найден — предупреди, что локальный просмотр не заработает, но продолжай.
Выполни: gh auth status
Если вход не выполнен — остановись и попроси меня выполнить gh auth login -h github.com -p https -w

ШАГ 1. Папки
$ROOT = "C:\ATS-архив\2026-11-20"
Создай $ROOT, $ROOT\temp и $ROOT\client.

ШАГ 2. Исходники (клон без истории, чтобы не тянуть лишнее)
git clone --depth 1 --branch preview/github-pages https://github.com/sledovatel61/avtotehservis.git "$ROOT\source"
Проверь, что существует $ROOT\source\site\package.json. Клон занимает около 800 МБ — это нормально.

ШАГ 3. Готовая сборка сайта с сервера GitHub
$id = gh run list --repo sledovatel61/avtotehservis --workflow pages.yml --limit 10 --json databaseId,conclusion --jq "[.[] | select(.conclusion==\"success\")][0].databaseId"
Напечатай $id. Если он пустой — переходи к ШАГУ 3б и скажи об этом.
gh run download $id --repo sledovatel61/avtotehservis -n github-pages -D "$ROOT\temp\artifact"
В папке должен появиться файл artifact.tar. Распакуй его в $ROOT\client\site:
New-Item -ItemType Directory -Force -Path "$ROOT\client\site" | Out-Null
tar -xf "$ROOT\temp\artifact\artifact.tar" -C "$ROOT\client\site"
Проверь, что есть $ROOT\client\site\index.html.

ШАГ 3б. Если артефакт недоступен (истёк срок хранения или скачивание упало)
Собери сайт из исходников:
  cd "$ROOT\source\site"
  npm ci
  $env:PUBLIC_ORIGIN = "https://ats-rostov.ru"
  npm run build:pages
Затем скопируй содержимое $ROOT\source\site\pages-dist в $ROOT\client\site.
Признак успеха — строка «Exported 45 public pages + 404».

ШАГ 4. Служебные файлы для просмотра
Создай в корне $ROOT\client три файла с содержимым из блоков ниже, байт-в-байт,
кодировка UTF-8 (без BOM). Ничего в них не переписывай и не «улучшай».
Если в клоне есть папка $ROOT\source\docs\archive-pack — можно скопировать файлы оттуда.
Затем удали папку $ROOT\client\site\manage: это служебная панель владельца, заказчику она не нужна.
Если после удаления остались битые ссылки на /manage — не исправляй, просто скажи мне.

Файл serve.mjs:
```js
/* Мини-сервер для просмотра архива сайта на своём компьютере.
 *
 * Зачем: сайт собран как статический, но все адреса в нём начинаются с корня
 * (`/img/...`, `/prices/`). Если открыть index.html двойным щелчком, браузер ищет
 * `C:\img\...` и страница остаётся без картинок и стилей. Поэтому архив смотрят
 * через этот файл: он раздаёт папку `site` по адресу http://localhost:8080.
 *
 * Запуск:  node serve.mjs        (или start.cmd — то же самое двойным щелчком)
 * Порт можно поменять:  set PORT=8081 && node serve.mjs
 *
 * Ничего не устанавливает, никуда не ходит в интернет, только читает файлы рядом.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = existsSync(join(HERE, 'site')) ? join(HERE, 'site') : HERE;
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/** Безопасный путь внутри ROOT: `..` и абсолютные имена отбрасываем. */
function resolveInside(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const target = normalize(join(ROOT, clean));
  return target.startsWith(ROOT + sep) || target === ROOT ? target : null;
}

function send(res, file) {
  const ext = extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  let file = resolveInside(req.url || '/');
  if (!file) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403');
    return;
  }
  try {
    if (existsSync(file) && statSync(file).isDirectory()) {
      const index = join(file, 'index.html');
      if (existsSync(index)) {
        send(res, index);
        return;
      }
      file = file.replace(/[/\\]$/, '') + '.html';
      if (existsSync(file)) {
        send(res, file);
        return;
      }
    } else if (existsSync(file)) {
      send(res, file);
      return;
    }
  } catch {
    /* упадём в 404 ниже */
  }
  const notFound = join(ROOT, '404.html');
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  if (existsSync(notFound)) createReadStream(notFound).pipe(res);
  else res.end('404');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Архив сайта открыт:  http://localhost:' + PORT);
  console.log('  Папка с файлами:     ' + ROOT);
  console.log('');
  console.log('  Чтобы остановить — закройте это окно или нажмите Ctrl+C.');
  console.log('');
});
```

Файл start.cmd:
```bat
@echo off
chcp 65001 >nul
title Архив сайта АТС — локальный просмотр
cd /d "%~dp0"

rem Открывает архив сайта в браузере. Нужен установленный Node.js (node --version).
rem Если Node нет — откроется этот файл в блокноте с объяснением, что делать.

where node >nul 2>nul
if errorlevel 1 goto nonode

start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:8080"
node serve.mjs
goto end

:nonode
echo.
echo   Не найден Node.js — без него локальный просмотр не запустится.
echo.
echo   Что делать:
echo     1. Поставьте Node.js LTS с https://nodejs.org (кнопка "LTS", установка "далее-далее").
echo     2. Закройте это окно и снова запустите start.cmd.
echo.
echo   Либо просто откройте живой сайт: https://ats-rostov.ru
echo.
pause

:end
```

Файл ЭТА-ПАПКА-СНАЧАЛА.txt:
```
АРХИВ САЙТА ats-rostov.ru
=========================

Что в этой папке
----------------
site\        — сам сайт: все страницы, стили, картинки (то, что видят посетители)
serve.mjs    — маленький локальный сервер, чтобы архив открывался правильно
start.cmd    — запускает просмотр одним двойным щелчком
ЭТА-ПАПКА-СНАЧАЛА.txt — этот файл

Как посмотреть
--------------
1. Двойной щелчок по start.cmd.
2. Через 2 секунды сам откроется браузер: http://localhost:8080
3. Закрыть просмотр — закрыть чёрное окно (или Ctrl+C в нём).

Почему нельзя открыть site\index.html двойным щелчком?
Все ссылки на сайте начинаются с корня (/img/..., /prices/). Браузер в режиме
файла ищет их на диске C:\ и страница остаётся без картинок и стилей.
Локальный сервер отдаёт архив так же, как настоящий хостинг.

Если Node.js не установлен
--------------------------
start.cmd скажет об этом и предложит поставить Node.js LTS с https://nodejs.org.
Либо просто откройте живой сайт: https://ats-rostov.ru

Дата архива: указана в имени zip-файла.
```

ШАГ 5. Архив для заказчика
Compress-Archive -Path "$ROOT\client\*" -DestinationPath "$ROOT\ats-rostov.ru-сайт-2026-11-20.zip" -CompressionLevel Optimal
Проверь размер: должен быть от 10 до 40 МБ.

ШАГ 6. Исходники без внутренних папок
Скопируй $ROOT\source в $ROOT\source-clean, затем удали из копии:
  .git, node_modules, site\node_modules, site\dist, site\pages-dist,
  prompts, promts, evaluation, reviews, agents-output, mockups, reference, result.zip, docs
(чего-то из списка может не быть — такие пункты просто пропусти).
Папку docs удаляем целиком: там рабочие заметки, брифы и переписка по проекту.
Оставь: AGENTS.md, README.md, site\, relay\, .github\, .gitignore
Создай в $ROOT\source-clean файл ЧТО-ЭТО.txt с текстом:
  Исходники сайта ats-rostov.ru на 20.11.2026.
  Сайт: Astro + TypeScript. Сборка: cd site; npm ci; npm run build:pages — результат в site/pages-dist.
  Публикация: workflow .github/workflows/pages.yml на GitHub Pages.
  Прослойка заявок (Cloudflare Worker): папка relay, инструкция внутри relay/README.md.
  Установка на обычный сервер: site/deploy/deploy.md.
  Секретов в архиве нет: ключи Telegram, почты и Cloudflare живут в настройках Cloudflare и GitHub.
Затем:
Compress-Archive -Path "$ROOT\source-clean\*" -DestinationPath "$ROOT\ats-rostov-исходники-2026-11-20.zip" -CompressionLevel Optimal
Проверь размер: должен быть от 15 до 80 МБ.

ШАГ 7. Контрольные суммы
Посчитай SHA-256 обоих zip и запиши в $ROOT\SHA256SUMS.txt строками «хеш  имя-файла».

ШАГ 8. ПРОВЕРКА (обязательно, ответь таблицей «пункт — да/нет — подробности»)
1. $ROOT\client\site\index.html существует.
2. В $ROOT\client\site есть папки img, _astro, fonts и файлы robots.txt, sitemap.xml, 404.html.
3. Файл $ROOT\client\site\img\k103-facade-640.webp существует (свежие фото сервиса).
4. В $ROOT\client\site нет папки manage.
5. Число html-файлов в $ROOT\client\site не меньше 45.
6. В $ROOT\source-clean нет папок .git, node_modules, prompts, evaluation, reviews, docs.
7. В $ROOT\source-clean есть site\package.json, relay\README.md и ЧТО-ЭТО.txt.
8. В обоих архивах нет файлов .env (кроме .env.example), .pem и .key — проверь распаковкой.
9. Оба zip открываются: распакуй по одному файлу из каждого во временную папку.

ШАГ 9. Проверка просмотра
Запусти $ROOT\client\start.cmd, дождись строки «Архив сайта открыт: http://localhost:8080»
и проверь, что адреса http://localhost:8080/ и http://localhost:8080/about отвечают кодом 200.
Затем останови сервер.

ФИНАЛЬНЫЙ ОТЧЁТ
Напиши: путь к папке, два пути к zip с размерами, таблицу проверки из 9 пунктов,
что не получилось и что мне сделать руками. Ничего не удаляй после отчёта.
~~~~

---

## 3. Как проверить, что архив рабочий

Откройте `C:\ATS-архив\2026-11-20\client\start.cmd`. Через пару секунд откроется браузер на `http://localhost:8080`.

- [ ] главная: фото фасада, вывеска, три телефона;
- [ ] «О компании» (`/about`): блок «Как выглядит сервис» с четырьмя фотографиями;
- [ ] «Цены» и «Контакты» открываются;
- [ ] картинки и шрифты на месте.

**Почему нельзя просто открыть `index.html` двойным щелчком.** Все адреса внутри сайта начинаются с корня: `/img/...`, `/prices/`. В режиме файла браузер ищет их на диске `C:\`, и страница остаётся без картинок. `start.cmd` поднимает локальный мини-сервер — он отдаёт файлы так же, как настоящий хостинг. Интернет для просмотра не нужен.

---

## 4. Если Клайн не справится — те же шаги руками

**Сколько места нужно:** временно около 1 ГБ. В репозитории лежат рабочие материалы проекта (ревью, оценки, брифы) — они весят больше самого сайта. После сборки папки `source` и `source-clean` можно удалить: останутся два zip примерно на 40 МБ.

```powershell
# 1. папки
$ROOT = "C:\ATS-архив\2026-11-20"
New-Item -ItemType Directory -Force -Path "$ROOT\temp","$ROOT\client" | Out-Null

# 2. исходники без истории
git clone --depth 1 --branch preview/github-pages https://github.com/sledovatel61/avtotehservis.git "$ROOT\source"

# 3. готовая сборка с GitHub
$id = gh run list --repo sledovatel61/avtotehservis --workflow pages.yml --limit 10 --json databaseId,conclusion --jq "[.[] | select(.conclusion==\"success\")][0].databaseId"
$id
gh run download $id --repo sledovatel61/avtotehservis -n github-pages -D "$ROOT\temp\artifact"
New-Item -ItemType Directory -Force -Path "$ROOT\client\site" | Out-Null
tar -xf "$ROOT\temp\artifact\artifact.tar" -C "$ROOT\client\site"

# 4. служебные файлы (если папка есть в клоне)
Copy-Item "$ROOT\source\docs\archive-pack\*" "$ROOT\client\" -Force -ErrorAction SilentlyContinue
Remove-Item "$ROOT\client\site\manage" -Recurse -Force -ErrorAction SilentlyContinue

# 5. архив для заказчика
Compress-Archive -Path "$ROOT\client\*" -DestinationPath "$ROOT\ats-rostov.ru-сайт-2026-11-20.zip" -CompressionLevel Optimal

# 6. исходники без внутренних папок
Copy-Item "$ROOT\source" "$ROOT\source-clean" -Recurse
Remove-Item "$ROOT\source-clean\.git","$ROOT\source-clean\site\dist","$ROOT\source-clean\site\pages-dist",
  "$ROOT\source-clean\prompts","$ROOT\source-clean\promts","$ROOT\source-clean\evaluation",
  "$ROOT\source-clean\reviews","$ROOT\source-clean\agents-output","$ROOT\source-clean\mockups",
  "$ROOT\source-clean\reference","$ROOT\source-clean\docs","$ROOT\source-clean\result.zip" -Recurse -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$ROOT\source-clean\*" -DestinationPath "$ROOT\ats-rostov-исходники-2026-11-20.zip" -CompressionLevel Optimal

# 7. контрольные суммы
Get-FileHash "$ROOT\*.zip" -Algorithm SHA256 | ForEach-Object { "$($_.Hash)  $(Split-Path $_.Path -Leaf)" } |
  Set-Content "$ROOT\SHA256SUMS.txt"
```

**Если готовая сборка не скачивается** (GitHub хранит артефакты 90 дней), соберите сайт сами:

```powershell
cd "$ROOT\source\site"
npm ci
$env:PUBLIC_ORIGIN = "https://ats-rostov.ru"
npm run build:pages
# результат — site\pages-dist; скопируйте его содержимое в $ROOT\client\site
```

Служебные файлы (`serve.mjs`, `start.cmd`, памятку) при ручном пути возьмите из блоков в разделе 2: скопируйте текст в блокнот и сохраните под нужным именем.

---

## 5. Что отдавать заказчику

Два файла плюс короткое письмо:

> Здравствуйте! Направляю архив сайта ats-rostov.ru по состоянию на 20 ноября 2026 года.
>
> 1. `ats-rostov.ru-сайт-2026-11-20.zip` — готовый сайт. Чтобы посмотреть: распакуйте, запустите `start.cmd`, откроется браузер.
> 2. `ats-rostov-исходники-2026-11-20.zip` — исходный код. Внутри `ЧТО-ЭТО.txt`: как собрать сайт заново и как он публикуется. Пригодится, если сайт будет переезжать на другой хостинг или его будет дорабатывать другой разработчик.
>
> Контрольные суммы в `SHA256SUMS.txt` — чтобы убедиться, что файлы не повредились при передаче. Сайт продолжает работать по адресу https://ats-rostov.ru.

## 6. Чего в архиве нет и почему

Так и скажите заказчику, чтобы не было вопросов.

| Чего нет | Где живёт | Почему |
|---|---|---|
| Ключи Telegram, почты, Cloudflare | в настройках GitHub и Cloudflare | секреты в код не кладут: иначе их увидит любой, кто откроет архив |
| Заявки клиентов и отзывы с сайта | Cloudflare KV (хранилище воркера) | это персональные данные, а не часть сайта — см. раздел 8 |
| Аккаунты Яндекс.Метрики и Директа | в аккаунте `pavel.yakovenko@mail.ru` | доступы не передаются вместе с файлами |
| Домен `ats-rostov.ru` | регистратор домена | домен — отдельный договор, не файл |

---

## 7. Что важно знать про публичность репозитория

Репозиторий **сейчас публичный**: любой может открыть https://github.com/sledovatel61/avtotehservis и прочитать не только код, но и внутренние заметки (брифы, ревью, переписку по задачам). Секретов там нет, но заметки внутренние.

Если это нежелательно:

1. Сначала перенесите сайт на другой хостинг (Cloudflare Pages или Netlify — оба бесплатны и собирают проект из того же репозитория). На бесплатном плане **GitHub Pages работает только с публичными репозиториями**: закроете репозиторий — сайт на Pages может отключиться.
2. Затем: Settings → General → внизу Danger Zone → **Change visibility** → Private.
3. Проверьте, что сайт открывается по адресу `ats-rostov.ru` (домен переносится в настройках DNS).

Пока вы этого не сделали, менять ничего не обязательно: сайт и архив работают как обычно.

---

## 8. Если понадобится архив заявок и отзывов (отдельная задача)

Заявки и отзывы лежат не на GitHub, а в Cloudflare KV. Их бэкап делается только с вашими доступами Cloudflare и в архив сайта не входит:

1. Войдите в Cloudflare: `npx wrangler login` (откроется браузер).
2. Посмотрите список хранилищ: `npx wrangler kv namespace list`.
3. Выгрузите ключи нужного хранилища: `npx wrangler kv key list --namespace-id=<id из шага 2>`.
4. Значение читается отдельно: `npx wrangler kv key get "<ключ>" --namespace-id=<id> --remote > файл.json`.

В новых версиях `wrangler` синтаксис немного меняется — если команда не узнаётся, посмотрите `npx wrangler kv --help`. Эти данные содержат телефоны и имена клиентов: храните архив заявок отдельно от сайта и не передавайте третьим лицам.

---

## 9. Частые ошибки и что делать

| Что видите | Причина | Решение |
|---|---|---|
| `gh: команда не найдена` | GitHub CLI поставлен, а PowerShell открыт до установки | закройте и откройте PowerShell заново |
| `gh auth status` → `not logged in` | не выполнен вход | `gh auth login -h github.com -p https -w` |
| `gh run download` → `no valid artifacts found` | артефакт старше 90 дней или сборка упала | соберите сайт сами — раздел 4 |
| `fatal: destination path already exists` | папка `source` уже есть | удалите `C:\ATS-архив` и начните заново |
| страницы без картинок | открыли `index.html` двойным щелчком | запускайте `start.cmd` |
| `start.cmd` пишет, что нет Node.js | Node не установлен | поставьте с https://nodejs.org (LTS) или откройте живой сайт |
| `npm ci` падает на `better-sqlite3` | нет Visual Studio Build Tools | не нужно для архива: сборка лежит в `pages-dist` или скачивается с GitHub |
| клон занимает почти гигабайт | в репозитории есть папки `evaluation`, `reviews`, `docs` | после сборки удалите `source` и `source-clean` |
| `Compress-Archive` ругается на размер | старая версия PowerShell | используйте 7-Zip: правый клик → «7-Zip» → «Добавить в архив» |

---

## 10. Что внутри репозитория (для справки)

```
site/               сам сайт: страницы (src/pages), стили, картинки (public/img),
                    тексты и цены (content/), скрипты проверок, тесты
site/pages-dist     готовая сборка (появляется после npm run build:pages)
site/deploy/        установка на обычный сервер: nginx + systemd, по шагам
relay/              прослойка заявок на Cloudflare Workers: сайт → Telegram и почта
.github/            автопубликация сайта на GitHub Pages
docs/               внутренние заметки по проекту — заказчику не отдаём
docs/archive-pack/  служебные файлы для просмотра архива: serve.mjs, start.cmd, памятка
```

Проверить, что живой сайт совпадает с архивом: откройте https://ats-rostov.ru и `http://localhost:8080`, сравните главную страницу — тексты и подвал должны совпадать.
