# Демоверсия для согласования

Адрес: https://sledovatel61.github.io/avtotehservis/

GitHub Settings → Pages → Source: GitHub Actions, без Custom domain.
Workflow `Publish client preview` запускается при push в `preview/github-pages`.
Если deployment заблокирован правилами environment, в Settings → Environments →
github-pages разрешите ветку `preview/github-pages` в Deployment branches and tags.

Локально из каталога site:

```sh
npm ci
npm run build:pages
node scripts/check-pages.mjs
```

Экспорт создаёт временную изолированную БД с seed и seed:demo, собирает SSR,
сохраняет публичные страницы из sitemap и переносит ресурсы в pages-dist.
БД и сервер не публикуются. Изменения содержимого требуют новой сборки.
Изменения main необходимо переносить в preview/github-pages отдельно.

На всех страницах есть предупреждение о демонстрации. Отправка сообщений,
заявок и загрузка файлов отключены; время записи вымышленное.
Демо-новости, отзывы и изображения — заглушки, не реальные данные сервиса.
noindex и robots.txt запрещают индексацию, но не ограничивают публичный доступ.
Секреты и персональные данные в содержимом демоверсии размещать нельзя.
Основная команда npm run build по-прежнему собирает серверную версию.
## Публикация из ветки оркестратора

Ветка `arena/*` не входит в Deployment branches and tags окружения `github-pages`, поэтому прямой пуш
в неё Pages не публикует (job падает с «Branch ... is not allowed to deploy to github-pages»), а менять
правила окружения токену недоступно (`403 Resource not accessible by integration`).
Обновление живой страницы делается без переключения рабочей ветки: дерево берётся из текущего HEAD,
а служебные файлы preview-ветки возвращаются в коммит через временный индекс.

```sh
export GIT_INDEX_FILE=/tmp/prev.idx && rm -f /tmp/prev.idx
git read-tree HEAD
git show origin/preview/github-pages:.github/workflows/pages.yml > /tmp/pages.yml
git show origin/preview/github-pages:site/deploy/github-pages.md > /tmp/gp.md
git update-index --add --cacheinfo 100644,$(git hash-object -w /tmp/pages.yml),.github/workflows/pages.yml
git update-index --add --cacheinfo 100644,$(git hash-object -w /tmp/gp.md),site/deploy/github-pages.md
TREE=$(git write-tree) && PREV=$(git rev-parse origin/preview/github-pages)
COMMIT=$(git commit-tree "$TREE" -p "$PREV" -m "Публикация превью: <круг>")
unset GIT_INDEX_FILE
git update-ref refs/heads/preview/github-pages "$COMMIT"
git push origin refs/heads/preview/github-pages:refs/heads/preview/github-pages
```

Дальше — `gh run watch <run-id> --exit-status`, проверка деплоя
(`gh api repos/.../deployments?environment=github-pages`) и живой страницы `https://sledovatel61.github.io/avtotehservis/`.
