# Приёмка круга 6 (пусковой круг, `08b5b47`)

Дата: 22.10.2026. Проверял оркестратор, не по отчёту A5. Ветка `arena/c0d7d4ba-avtotehservis`,
коммиты `f797a49` (smoke), `a601c84` (docs/13), `2f2b2bb` (демо-сид), `08b5b47` (подсказка canonical).
Вердикт: **принято**, дефектов уровня блокера/мажора нет.

## Что проверялось и как

Worktree `/tmp/rr10` на `08b5b47`, чистая БД `/tmp/rr10data`, сервер на `:4390`.

| Проверка | Результат |
|---|---|
| `npm ci` + `npm run typecheck` | 0 ошибок |
| `npm test` | **58/58** (было 57, добавлен тест демо-сида) |
| `npm run build` с `PUBLIC_SITE_URL=http://localhost:4390` | Complete |
| `npm run smoke -- http://localhost:4390` | **14/14 ok**, код выхода 0 |
| smoke без верного `PUBLIC_SITE_URL` | 13 ok + 1 FAIL canonical с подсказкой «пересоберите» → код 1 (правильное поведение) |
| smoke против мёртвого порта | 14 FAIL, код выхода 1 |
| `npm run seed:demo` | 3 новости + 3 отзыва, помечены; предупреждение в консоли |
| Пометки на сайте | на `/` отзывы подписаны «Демо-отзыв (вымышленный…)», на `/news` слаги `demo-*` |
| `npm run seed:demo:clear` | удалил только помеченное: 3→0 и 3→0; повторный `seed:demo` вернул 3/3 |
| Регресс заявки | `POST /api/leads` → 201, `A-2210-7714` |
| Регресс админки | вход `owner` → 302 → `/admin` 200 |
| `docs/13-launch-checklist.md` | 8 разделов, команды сверены с `deploy.md` и скриптами: `smoke`, `seed:demo`, `backup.cron`, `restore.sh`, `admin:create`; тесты SMTP и Telegram — без создания заявки |

## Замечания (не блокируют)

1. **Smoke и canonical.** Canonical берётся из `PUBLIC_SITE_URL` **на сборке**; `.env` при `npm run build`
   не читается (проверено: `.env` c `PUBLIC_SITE_URL=http://localhost:4444` → в бандле остался
   `localhost:4321`). Значит, на сервере env должен быть в окружении **до** `npm run build`, а в
   подсказке smoke стоит это писать прямым текстом. Формально дефект документации, не кода.
   → записано в задание локальному ревьюеру как проверка.
2. **`npm run smoke` без аргумента** бьёт в `http://localhost:4321` — совпадает с дефолтом `PORT`, ок.

## Перенос в нашу ветку

`git checkout 08b5b47 -- site docs/13-launch-checklist.md`: 5 изменённых/новых файлов
(`site/scripts/smoke.mjs`, `site/scripts/seed-demo.ts`, `site/package.json`, `site/README.md`,
`site/tests/unit.test.ts`, `docs/13-launch-checklist.md`), удалений нет, диф с веткой A5 пуст.
PR #5 остаётся открытым, ветка A5 жива.
