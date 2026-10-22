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