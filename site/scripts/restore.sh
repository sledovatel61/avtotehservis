#!/usr/bin/env bash
# Восстановление из бэкапа: ./restore.sh /var/backups/avtotehservis/20261021-031500
# Останавливать сервис не обязательно для проверки, но для боевого восстановления — обязательно.
set -euo pipefail

SRC="${1:?Укажите каталог бэкапа, например /var/backups/avtotehservis/20261021-031500}"
DATA_DIR="${DATA_DIR:-/var/lib/avtotehservis/data}"
MEDIA_DIR="${MEDIA_DIR:-/var/lib/avtotehservis/media}"
STOP_SERVICE="${STOP_SERVICE:-1}"

[ -f "$SRC/OK" ] || { echo "[restore] в бэкапе нет отметки OK — восстановлению не подлежит"; exit 1; }

if [ "$STOP_SERVICE" = "1" ] && systemctl list-unit-files 2>/dev/null | grep -q '^avtotehservis.service'; then
  systemctl stop avtotehservis
fi

mkdir -p "$DATA_DIR" "$MEDIA_DIR"
# Текущее состояние — в сторону (не затираем безвозвратно)
SAFETY="$DATA_DIR/pre-restore-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SAFETY"
[ -f "$DATA_DIR/site.sqlite3" ] && cp "$DATA_DIR/site.sqlite3" "$SAFETY/" || true

cp "$SRC/site.sqlite3" "$DATA_DIR/site.sqlite3"
rm -f "$DATA_DIR/site.sqlite3-wal" "$DATA_DIR/site.sqlite3-shm"
if [ -f "$SRC/media.tar.gz" ]; then
  tar -xzf "$SRC/media.tar.gz" -C "$MEDIA_DIR"
fi

# Проверка после восстановления
cd "$(dirname "$0")/.."
node -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.argv[1], { readonly: true });
  const r = db.pragma("integrity_check");
  const leads = db.prepare("SELECT COUNT(*) c FROM leads").get().c;
  console.log("[restore] integrity:", r[0] && r[0].integrity_check, "leads=" + leads);
  db.close();
' "$DATA_DIR/site.sqlite3"

if [ "$STOP_SERVICE" = "1" ] && systemctl list-unit-files 2>/dev/null | grep -q '^avtotehservis.service'; then
  systemctl start avtotehservis
fi
echo "[restore] готово. Прежняя БД сохранена в $SAFETY"
