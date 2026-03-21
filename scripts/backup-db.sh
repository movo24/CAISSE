#!/bin/bash
# ── CAISSE DB Backup Script ──
# Usage:
#   ./scripts/backup-db.sh                  # manual backup
#   crontab: 0 3 * * * /path/to/backup-db.sh  # daily 3am
#
# Restore:
#   docker exec -i caisse-postgres psql -U caisse -d caisse < backups/caisse_2026-03-21_03-00.sql

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
CONTAINER="${DB_CONTAINER:-caisse-postgres}"
DB_USER="${DB_USER:-caisse}"
DB_NAME="${DB_NAME:-caisse}"
KEEP_DAYS="${KEEP_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y-%m-%d_%H-%M)
FILENAME="caisse_${TIMESTAMP}.sql"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

echo "[BACKUP] Starting backup: ${FILENAME}"

# Dump with clean (drop+create) for easy restore
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --clean --if-exists --no-owner --no-privileges \
  > "$FILEPATH"

# Compress
gzip "$FILEPATH"
FINAL="${FILEPATH}.gz"
SIZE=$(du -h "$FINAL" | cut -f1)

echo "[BACKUP] Done: ${FINAL} (${SIZE})"

# Cleanup old backups
DELETED=$(find "$BACKUP_DIR" -name "caisse_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[BACKUP] Cleaned ${DELETED} backups older than ${KEEP_DAYS} days"
fi

echo "[BACKUP] Complete. Restore with:"
echo "  gunzip -k ${FINAL} && docker exec -i ${CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} < ${FILEPATH}"
