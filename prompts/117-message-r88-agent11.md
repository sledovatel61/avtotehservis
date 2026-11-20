# Круг 88 · сообщение Агенту 11 (копировать целиком)

---

Круг 88, роль прежняя — серверная часть (воркер `relay/**`). Задание: `prompts/116-task-r88-origins-domain.md` в репозитории (ветка `arena/4a0a6bfb-avtotehservis`, PR #71).

Коротко: владелец подключил домен **`ats-rostov.ru`**, сайт переезжает с `sledovatel61.github.io/avtotehservis/` на корень домена. В твоём коде после PR #73 остались три долга, все в `relay/**`:

1. `relay/src/origins.ts` — `DEFAULT_ORIGINS` с хардкодом `https://sledovatel61.github.io`. Убрать полностью: единственный источник — `env.ALLOWED_ORIGINS` (split по запятым, trim). Пустой список = ни один origin не разрешён (fail-closed), локальная разработка задаёт список в `.dev.vars`.
2. `relay/wrangler.toml` — `ALLOWED_ORIGINS = "https://ats-rostov.ru,https://www.ats-rostov.ru,https://sledovatel61.github.io,http://localhost:4321,http://127.0.0.1:4321"` (превью оставить: старый адрес редиректит, а браузер сохраняет Origin исходной страницы).
3. `relay/src/index.ts`, `corsHeaders()` — добавить `'access-control-expose-headers': 'retry-after'`. Без этого браузер не видит `Retry-After` на `429`, и форма показывает «Слишком часто» без секунд.

Плюс по возможности включи KV для лимитов (`npx wrangler kv namespace create ATS_KV`, id в `wrangler.toml`, `/health` → `"reviewsKv": true`). Уже подключённые к проекту Cloudflare права могут не давать доступа к KV — тогда просто напиши это в PR, не блокируйся и ничего не выдумывай.

Тесты: новый `relay/tests/origins.test.ts` — 9 проверок из задания (главная: без `ALLOWED_ORIGINS` превью-адрес больше не разрешён; с доменом `POST /reviews` отдаёт `201`; `OPTIONS /reviews` отдаёт `access-control-expose-headers`). Существующие `reviews.test.ts` и `leads.test.ts` должны остаться зелёными — если они полагались на хардкод, пусть задают `ALLOWED_ORIGINS` в моке `env` явно.

Ветка от `origin/preview/github-pages`, имя `agent/88-origins-domain`, PR туда же. В теле PR — вывод `npx tsc --noEmit`, `node --test tests/*.test.ts`, `npx wrangler deploy --dry-run --outdir /tmp/relay-dry`.

Не менять: контракт `/reviews`, лимиты, тексты уведомлений, формат письма, `CONSENT_VERSION`. `site/**` не трогать — там параллельно работают Агенты 5, 7 и 10.

Деплой после мержа сделает workflow «Deploy leads relay», `wrangler deploy` руками не запускай.
