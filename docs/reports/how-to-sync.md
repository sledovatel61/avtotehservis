# Как агенту начать работу в этом репозитории

Короткая памятка. Проблема, на которую уже наткнулись A8 и A9: **сессионная ветка Arena
создаётся от `main`, а весь сайт живёт в `preview/github-pages`, и это две несвязанные
истории**. Обычный `git merge` отвечает `refusing to merge unrelated histories`, а
`--allow-unrelated-histories` даёт ~50 конфликтов и тащит в ветку мусор из `main`
(`result.zip`, старые копии файлов).

Правильный путь — не мержить истории, а поставить ветку на превью и забрать нужные файлы
путями.

## Шаг 1. Поставить ветку на превью

```bash
git fetch origin

# страховка: посмотреть, есть ли уже свои коммиты
git log --oneline -3        # у чистой ветки только «Add files via upload» (9da16de)
git status --porcelain      # должно быть пусто

# если своих коммитов нет — переводим ветку на превью
git switch --force-create arena/<свой-id> origin/preview/github-pages
```

Если git откажется переключаться из-за untracked-файлов («would be overwritten»), посмотри
`git status --short` и убери лишнее — эти файлы всё равно приедут из истории превью.

`switch --force-create` двигает ветку на превью. Старый коммит `main` никуда не девается,
он остаётся достижимым через `main`, поэтому «потерять» там нечего — но правило «не
делать `reset --hard` по работе» остаётся: если свои коммиты уже есть, сначала сделай
локальную страховку:

```bash
git branch backup-<свой-id>                 # локальная ветка-страховка
git switch --force-create arena/<свой-id> origin/preview/github-pages
git cherry-pick backup-<свой-id>~2..backup-<свой-id>   # вернуть свои коммиты поверх
```

## Шаг 2. Забрать материалы приёмки путями

Не мержить ветку приёмки целиком: она тоже от `main` и содержит старый срез `site/`.
Копируем только нужные файлы:

```bash
# A8 (разбор руководства)
git checkout origin/arena/e1d16e9d-avtotehservis -- \
  prompts/76-task-r76-manual-review.md \
  docs/reports/r76-assignment-message.md \
  docs/research/voyah-free-manual

# A9 (статьи по чату)
git checkout origin/arena/e1d16e9d-avtotehservis -- \
  prompts/75-task-r75-chat-useful.md \
  docs/reports/r75-assignment-message.md \
  docs/research/voyah-chat-r75 \
  docs/photos-source/r75 \
  site/scripts/build-voyah-art-r75.mjs \
  'site/public/img/vy-art-update-*' \
  'site/public/img/vy-art-connect-*' \
  'site/public/img/vy-art-app-*' \
  site/public/img/vy-art-r75-manifest.json
```

Кавычки вокруг путей с `*` обязательны — иначе glob раскроет шелл, а не git.

## Шаг 3. Проверить, что ветка выглядит нормально

```bash
git status --short
git diff --cached --stat origin/preview/github-pages   # только добавленные файлы, без удалений
```

Если в диффе появились удаления сотен файлов — значит ветка стоит не на превью, вернись
к шагу 1.

## Чего не делать

- `git reset --hard` по ветке, где уже есть работа (в этом репозитории так один раз
  удалили 1 529 файлов, включая страницу `/voyah-free/`).
- `git merge --allow-unrelated-histories origin/preview/github-pages` и его разрешение
  через `git checkout --theirs -- .`: получишь дерево превью, но с мусором из `main` и
  мутной историей.
- Пушить в `preview/github-pages` напрямую. Только PR из своей ветки.
