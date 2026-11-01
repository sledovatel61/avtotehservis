#!/usr/bin/env bash
# Ежедневный бэкап: SQLite (онлайн-копия через better-sqlite3 .backup) + медиа.
# Хранение: BACKUP_KEEP дней (по умолчанию 14). Каждый бэкап проверяется (integrity_check).
set -euo pipefail

SITE_DIR="${SITE_DIR:-/var/www/avtotehservis/repo/site}"
DATA_DIR="${DATA_DIR:-/var/lib/avtotehservis/data}"
MEDIA_DIR="${MEDIA_DIR:-/var/lib/avtotehservis/media}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/avtotehservis}"
KEEP_DAYS="${BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/$STAMP"

mkdir -p "$DEST"

# 1) БД — онлайн-копия (не копипаст файла: WAL может быть не сконсолидирован)
cd "$SITE_DIR"
node -e '
  const Database = require("better-sqlite3");
  const [src, dst] = process.argv.slice(1);
  const db = new Database(src, { readonly: true });
  db.backup(dst).then(() => { db.close(); }).catch((e) => { db.close(); process.exit(1); });
' "$DATA_DIR/site.sqlite3" "$DEST/site.sqlite3"

# 2) Проверка целостности копии ОБЯЗАТЕЛЬНА
INTEGRITY="$(node -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.argv[1], { readonly: true });
  const r = db.pragma("integrity_check");
  const leads = db.prepare("SELECT COUNT(*) c FROM leads").get().c;
  console.log((r[0] && r[0].integrity_check) + " leads=" + leads);
  db.close();
' "$DEST/site.sqlite3")"
echo "[backup] integrity: $INTEGRITY"
# Открывали копию на проверку — SQLite мог положить рядом пустые -wal/-shm; в архиве они не нужны (nit ревью round4).
rm -f "$DEST/site.sqlite3-wal" "$DEST/site.sqlite3-shm"
case "$INTEGRITY" in ok*) ;; *) echo "[backup] ПРОВЕРКА ЦЕЛОСТНОСТИ НЕ ПРОЙДЕНА"; exit 1;; esac

# 3) Медиа
if [ -d "$MEDIA_DIR" ]; then
  tar -czf "$DEST/media.tar.gz" -C "$MEDIA_DIR" .
fi

# 4) Отметка успеха + ротация
echo "$INTEGRITY" > "$DEST/OK"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "[backup] готово: $DEST ($(du -sh "$DEST" | cut -f1))"
