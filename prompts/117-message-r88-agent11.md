# Круг 88 · сообщение Агенту 11 (копировать целиком)

---

Круг 88, твоя роль прежняя — серверная часть (воркер `relay/**`). Задание: `prompts/116-task-r88-origins-domain.md` в репозитории (ветка `arena/4a0a6bfb-avtotehservis`, она же в PR #71; если файла не видно — читай его по прямой ссылке на GitHub в этой ветке).

Коротко: владелец подключил домен **`ats-rostov.ru`**, сайт переезжает с `sledovatel61.github.io/avtotehservis/` на корень домена. В твоём PR #73 (уже в `preview/github-pages`) в `relay/src/origins.ts` остался хардкод `DEFAULT_ORIGINS` с `https://sledovatel61.github.io`. Из-за него после переезда форма отзывов получит 403 — нужен фикс одной темой, без расширения объёма.

Сделай:

1. `relay/src/origins.ts` — убрать `DEFAULT_ORIGINS`. Источник только `env.ALLOWED_ORIGINS` (split по запятым, trim). Пустой список = ни один origin не разрешён (fail-closed), локальная разработка задаёт список в `.dev.vars`.
2. `relay/wrangler.toml` — `ALLOWED_ORIGINS = "https://ats-rostov.ru,https://www.ats-rostov.ru,https://sledovatel61.github.io,http://localhost:4321,http://127.0.0.1:4321"`.
3. Новый `relay/tests/origins.test.ts` — 8 проверок из задания (главная: без `ALLOWED_ORIGINS` превью-адрес больше не разрешён; с доменом — `POST /reviews` проходит).
4. `relay/README.md` — одна строка: список источников только из `ALLOWED_ORIGINS`, пустой = отказ.

Ветка от `origin/preview/github-pages`, имя `agent/88-origins-domain`, PR туда же. В теле PR — вывод `npx tsc --noEmit`, `node --test tests/*.test.ts`, `npx wrangler deploy --dry-run`.

Не менять: контракт `/reviews`, лимиты, тексты писем, `CONSENT_VERSION`; `site/**` не трогать (там Агент 5), `KV` не «чинить» — `reviewsKv: false` на превью это норма, лимиты в памяти изолята.

Деплой после мержа сделает workflow, `wrangler deploy` руками не запускай.
