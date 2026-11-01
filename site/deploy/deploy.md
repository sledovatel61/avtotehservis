# Деплой на VPS — АвтоТехСервис

Целевая конфигурация: VPS в РФ (ориентир — Beget 2 ядра / 2 ГБ), Debian 12 или Ubuntu 22.04/24.04, nginx + systemd + Let's Encrypt, один процесс Node. Приложение не работает от root; БД и медиа — в `/var/lib/avtotehservis`.

> Домен пока не зарегистрирован (`avtotehservis.ru` занят с 2014 года; рабочий вариант — `avtotehservis439.ru`). До появления домена сайт работает по `PUBLIC_SITE_URL` с временным адресом; ниже все места с `DOMAIN` помечены.

## 1. Системные пакеты

```bash
apt update && apt install -y curl git nginx certbot python3-certbot-nginx build-essential
# Node.js 24.x (maintenance LTS) — через NodeSource:
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node -v   # ожидается v24.x
```

`better-sqlite3` и `sharp` ставят готовые бинарники (prebuilds); `build-essential` нужен на случай самостоятельной сборки.

## 2. Пользователь и каталоги

```bash
useradd --system --create-home --home-dir /var/www/avtotehservis --shell /usr/sbin/nologin avtotehservis
mkdir -p /var/lib/avtotehservis/data /var/lib/avtotehservis/media /etc/avtotehservis /var/backups/avtotehservis
chown -R avtotehservis:avtotehservis /var/lib/avtotehservis /var/www/avtotehservis
chmod 700 /var/lib/avtotehservis /etc/avtotehservis
```

## 3. Код и сборка

```bash
cd /var/www/avtotehservis
git clone https://github.com/sledovatel61/avtotehservis.git repo   # или git pull при обновлении
cd repo/site
npm ci                       # точные версии из package-lock.json; ignore-scripts задан в site/.npmrc
                             # (better-sqlite3 использует готовые prebuilds, компилятор на VPS не нужен)
npm run build                # → dist/ (сервер + клиент)
chown -R avtotehservis:avtotehservis /var/www/avtotehservis/repo
```

## 4. Переменные окружения

```bash
cp .env.example /etc/avtotehservis/env
# заполнить:
#   PUBLIC_SITE_URL=https://DOMAIN            (до регистрации домена — http://IP-адрес:4321 для проверки)
#   HOST=127.0.0.1  PORT=4321
#   DATA_DIR=/var/lib/avtotehservis/data
#   MEDIA_DIR=/var/lib/avtotehservis/media
#   BOT_TOKEN=…  TELEGRAM_CHAT_ID=…           (выдаст владелец: @BotFather → токен; chat_id — получить у бота)
#   SMTP_HOST=smtp.mail.ru  SMTP_PORT=465  SMTP_SECURE=true
#   SMTP_USER=avtotehservis439@mail.ru  SMTP_PASS=<пароль приложения mail.ru>
#   MAIL_FROM="АвтоТехСервис <avtotehservis439@mail.ru>"  MAIL_TO=avtotehservis439@mail.ru
#   SESSION_SECRET=$(openssl rand -hex 32)
# Лимиты RATE_LIMIT_* заполнять НЕ нужно (в .env.example они закомментированы):
# значения по умолчанию из src/server/ratelimit.ts действуют, если переменная
# не задана ИЛИ пуста (limitFromEnv). Меняйте их только осознанно, числом > 0.
chmod 600 /etc/avtotehservis/env
chown root:avtotehservis /etc/avtotehservis/env
```

Секреты — только в этом файле. В git он не попадает (в репозитории только `.env.example` без значений).

## 5. База данных и администратор

Миграции — отдельной командой, не автоматически при старте:

```bash
sudo -u avtotehservis bash -c 'set -a; . /etc/avtotehservis/env; set +a; cd /var/www/avtotehservis/repo/site && npm run migrate && npm run seed'
sudo -u avtotehservis bash -c 'set -a; . /etc/avtotehservis/env; set +a; cd /var/www/avtotehservis/repo/site && npm run admin:create -- owner "<пароль ≥12 символов>"'
```

Пароль печатается один раз — передайте владельцу по защищённому каналу. Вход: `/admin/login`.

## 6. systemd

```bash
cp deploy/avtotehservis.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now avtotehservis
systemctl status avtotehservis --no-pager
curl -s http://127.0.0.1:4321/api/health   # {"status":"ok","db":true,"schema":true,"data_writable":true,"media_writable":true,…}
# status=degraded и HTTP 503 — если БД не читается, схема не накатана (забыли npm run migrate)
# или каталоги DATA_DIR/MEDIA_DIR не доступны на запись пользователю avtotehservis.
```

Логи — journald: `journalctl -u avtotehservis -f`. В логах нет полных телефонов (маскируются) и секретов.

## 7. nginx + TLS

```bash
cp deploy/nginx.conf /etc/nginx/sites-available/avtotehservis.conf
ln -s /etc/nginx/sites-available/avtotehservis.conf /etc/nginx/sites-enabled/
# до получения сертификата закомментируйте ssl-строки server-блока 443 или используйте временный HTTP-режим
nginx -t && systemctl reload nginx
mkdir -p /var/www/certbot
certbot certonly --webroot -w /var/www/certbot -d DOMAIN --agree-tos -m EMAIL
# подставить DOMAIN в nginx.conf (server_name + пути /etc/letsencrypt/live/DOMAIN/…), раскомментировать 443
nginx -t && systemctl reload nginx
```

Про HTTP/2: в конфиге используется `listen 443 ssl http2;`, а не `http2 on;` — директива
`http2 on` появилась только в nginx 1.25.1, а Debian 12 поставляет nginx 1.22, Ubuntu 22.04 — 1.18,
Ubuntu 24.04 — 1.24. Старый синтаксис работает на всех поддерживаемых дистрибутивах (на nginx
≥1.25.1 он помечен устаревшим, но продолжает действовать — при желании замените на `http2 on;`).

Честная оговорка: `nginx -t` в песочнице разработки выполнить было нельзя (nginx там не
установлен), поэтому конфигурация проверена только чтением. Перед `systemctl reload nginx`
на сервере обязательно выполните `nginx -t` — синтаксис проверяется за секунду.

IP-заголовки: nginx **перезаписывает** `X-Real-IP` и `X-Forwarded-For` значением
`$remote_addr` (а не `$proxy_add_x_forwarded_for`, который дописывает реальный адрес
в конец клиентского заголовка). Приложение (`clientIp()` в `src/server/http.ts`) берёт
сначала `X-Real-IP`, иначе **последний** элемент `X-Forwarded-For`; от этого значения
зависят квоты заявок/загрузок и блокировка входа в админку. Пока прокси ровно один
(наш nginx), подделать IP извне нельзя — значение перезаписывается. При появлении
второго прокси/CDN перед nginx пересмотрите оба `location` в `nginx.conf` и `clientIp()`.

HSTS приложение добавляет само, когда `PUBLIC_SITE_URL` начинается с `https:`.

## 8. Бэкапы

```bash
cp deploy/backup.cron /etc/cron.d/avtotehservis-backup
# проверить вручную:
sudo -u avtotehservis SITE_DIR=/var/www/avtotehservis/repo/site DATA_DIR=/var/lib/avtotehservis/data \
  MEDIA_DIR=/var/lib/avtotehservis/media BACKUP_DIR=/var/backups/avtotehservis \
  bash /var/www/avtotehservis/repo/site/scripts/backup.sh
```

Ежедневно 03:15, хранение 14 дней, каждая копия проверяется `PRAGMA integrity_check`. Журнал — `/var/log/avtotehservis-backup.log`.

### Восстановление (проверено на копии 21.10.2026)

```bash
STOP_SERVICE=1 DATA_DIR=/var/lib/avtotehservis/data MEDIA_DIR=/var/lib/avtotehservis/media \
  bash /var/www/avtotehservis/repo/site/scripts/restore.sh /var/backups/avtotehservis/<метка>
```

Скрипт останавливает сервис, сохраняет текущую БД в `pre-restore-*`, копирует бэкап, проверяет целостность и запускает сервис.

## 9. Обновление и откат

```bash
cd /var/www/avtotehservis/repo && git fetch && git log --oneline -5   # выбрать коммит
git checkout <коммит> && cd site
npm ci && npm run build
sudo -u avtotehservis bash -c 'set -a; . /etc/avtotehservis/env; set +a; cd /var/www/avtotehservis/repo/site && npm run migrate'
systemctl restart avtotehservis
curl -s http://127.0.0.1:4321/api/health
```

Откат — предыдущий коммит + пересборка + restart. Миграции совместимы вперёд (только добавляют таблицы/колонки), даунгрейд не требуется.

## 10. Проверка после деплоя

1. `GET /api/health` → `{"status":"ok"}`.
2. Открыть сайт, пройти форму записи → получить номер `A-DDMM-XXXX`.
3. Убедиться, что заявка пришла в Telegram и на почту (или в админке `/admin/leads` доставка `sent`).
4. Войти в `/admin`, опубликовать тестовый кейс с телефона, засечь время (цель ≤ 60 с), снять с публикации.
5. Проверить заголовки: `curl -I https://DOMAIN/` — CSP, HSTS, nosniff.
6. Запустить `scripts/backup.sh` и `scripts/restore.sh` на копии.
