# Почта не приходит: Resend отвечает 403

**Симптом.** Заявка мгновенно появляется в Telegram, письма нет; в списке
[resend.com/emails](https://resend.com/emails) пусто; на сайте всё «зелёное» —
`/health` показывает `"email":"resend"` и правильный `emailTo`.

**Что показывает диагностика.** `/health` воркера отдаёт:

```json
{"email":"resend","emailLastError":"email_resend_http:403","emailLastErrorAt":"2026-11-20T08:28:07.799Z"}
```

403 — отказ Resend **до** постановки письма в очередь. Поэтому в списке писем пусто:
сервис не принял запрос, а не «принял и не доставил».

**Причина.** Без подтверждённого домена бесплатный Resend разрешает отправку
только с `onboarding@resend.dev` и **только на адрес владельца аккаунта**.
Если аккаунт заведён на другой ящик, любой другой получатель получает 403
(«You can only send testing emails to your own email address»).

## Как починить — вариант А (правильный, 15 минут)

Письма пойдут с адреса сервиса, а не «onboarding», и на любой ящик.

1. `resend.com` → **Domains** → **Add Domain** → `ats-rostov.ru` → **Add**.
2. Resend покажет 3–4 DNS-записи (MX и TXT для `send`, TXT DKIM `resend._domainkey`).
3. Рег.ру → домен `ats-rostov.ru` → **DNS-серверы и зона** → добавить эти записи
   как есть (тип, имя, значение). Ключи GitHub Pages (A и CNAME `www`) не трогать.
4. Вернуться в Resend → **Verify DNS Records** → статус **Verified** (обычно 5–30 минут).
5. GitHub → Settings → Secrets and variables → Actions → **New repository secret**:
   `EMAIL_FROM` = `АвтоТехСервис <no-reply@ats-rostov.ru>`.
   Workflow `Deploy leads relay` сам положит его в воркер (шаг «Push secrets to worker»).
6. Любой push в `relay/` (или ручной запуск workflow) перезапускает воркер.
7. Проверка: новая заявка → `/health` → `emailLastOk` со свежим временем,
   `emailLastError` пустой.

## Как починить — вариант Б (быстро, 5 минут, без DNS)

Подходит, если письма нужны «хоть как-то» и согласен отправитель `onboarding@resend.dev`.

1. Проверить, на какой ящик зарегистрирован аккаунт Resend: `resend.com` →
   **Settings** → данные аккаунта.
2. Если это не `Pavel.yakovenko@mail.ru` — либо сменить адрес аккаунта на него и
   подтвердить письмом, либо завести новый аккаунт сразу на этот ящик и взять
   новый ключ `re_…`.
3. Обновить GitHub Secret `RESEND_API_KEY` новым ключом.
4. Перезапустить workflow `Deploy leads relay`.

Минус варианта Б: письма уходят с `onboarding@resend.dev`, Mail.ru часто кладёт их
в «Спам», а отправлять можно только на свой же адрес.

## Что уже сделано в коде

- Воркер запоминает результат последней отправки и отдаёт его в `/health`:
  `emailLastOk`, `emailLastError`, `emailLastErrorAt` (`relay/src/mail-status.ts`).
  В значениях только код и время — ни адресов, ни имён, ни текста заявок.
- `EMAIL_FROM` и `EMAIL_TO` теперь доезжают до воркера из GitHub Secrets
  (`.github/workflows/relay.yml`), раньше они игнорировались.
- Brevo в проекте закрыт навсегда, резервного канала нет: Telegram остаётся
  основным, почта — дублем.
