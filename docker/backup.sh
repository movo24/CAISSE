#!/bin/bash
# ── backup.sh — CAISSE Postgres backup/restore (docker-compose path) ──────────
# Usage: ./docker/backup.sh                 → take a compressed dump now
#        ./docker/backup.sh list            → list existing backups
#        ./docker/backup.sh restore <file>  → restore a dump (asks confirmation)
#
# P285 (bloc A5). Dumps go to docker/backups/ (gitignored). Retention: keeps the
# last 14 dumps. For the Neon/Railway path, use pg_dump against DATABASE_URL and
# Neon PITR instead (see packages/backend/RUNBOOK.md §Backup).
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR="docker/backups"
CONTAINER="caisse-postgres"
ENV_FILE="docker/.env.production"
mkdir -p "$BACKUP_DIR"

db_user() { grep -E "^DB_USER=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '"' || true; }
DB_USER="${DB_USER:-$(db_user)}"; DB_USER="${DB_USER:-caisse}"
DB_NAME="${DB_NAME:-caisse}"

case "${1:-dump}" in
  list)
    ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null || echo "No backups in $BACKUP_DIR."
    ;;
  restore)
    FILE="${2:?usage: backup.sh restore <file.sql.gz>}"
    [ -f "$FILE" ] || { echo "ERROR: $FILE not found."; exit 1; }
    echo "⚠️  This will OVERWRITE database '$DB_NAME' in container '$CONTAINER'."
    printf "Type 'restore' to confirm: "
    read -r answer
    [ "$answer" = "restore" ] || { echo "Aborted."; exit 1; }
    gunzip -c "$FILE" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"
    echo "Restore complete from $FILE."
    ;;
  dump|*)
    docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$" || { echo "ERROR: container ${CONTAINER} not running."; exit 1; }
    STAMP=$(date +%Y%m%d-%H%M%S)
    OUT="$BACKUP_DIR/caisse-${STAMP}.sql.gz"
    docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner | gzip > "$OUT"
    # integrity: non-empty and gunzip-able
    [ -s "$OUT" ] && gunzip -t "$OUT" || { echo "ERROR: dump integrity check failed ($OUT)."; exit 1; }
    echo "Backup OK: $OUT ($(du -h "$OUT" | cut -f1))"
    # retention: keep last 14
    ls -1t "$BACKUP_DIR"/caisse-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
    ;;
esac
