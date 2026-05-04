#!/bin/sh
# Nightly Postgres backup script. Runs inside the `backup` docker-compose
# service via cron. Keeps the last 7 daily, 4 weekly, 12 monthly dumps.
#
# Each dump is a compressed pg_dump file named YYYY-MM-DD_HH-MM-SS.sql.gz.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PGHOST="${PGHOST:-db}"
PGUSER="${PGUSER:-hireops}"
PGDATABASE="${PGDATABASE:-hireops}"
TIMESTAMP="$(date -u +%Y-%m-%d_%H-%M-%S)"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"

DUMP_FILE="$BACKUP_DIR/daily/${TIMESTAMP}.sql.gz"
echo "[$(date -u)] Starting backup → $DUMP_FILE"

# PGPASSWORD comes from env (compose: POSTGRES_PASSWORD)
pg_dump --no-owner --no-acl -h "$PGHOST" -U "$PGUSER" "$PGDATABASE" | gzip > "$DUMP_FILE"
SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
echo "[$(date -u)] Dump complete: $DUMP_FILE ($SIZE)"

# Promote to weekly on Sunday, monthly on the 1st
DOW="$(date -u +%u)"
DOM="$(date -u +%d)"
if [ "$DOW" = "7" ]; then
    cp "$DUMP_FILE" "$BACKUP_DIR/weekly/${TIMESTAMP}.sql.gz"
fi
if [ "$DOM" = "01" ]; then
    cp "$DUMP_FILE" "$BACKUP_DIR/monthly/${TIMESTAMP}.sql.gz"
fi

# Retention: 7 daily / 4 weekly / 12 monthly
ls -1t "$BACKUP_DIR/daily"/*.sql.gz   2>/dev/null | tail -n +8  | xargs -r rm -f
ls -1t "$BACKUP_DIR/weekly"/*.sql.gz  2>/dev/null | tail -n +5  | xargs -r rm -f
ls -1t "$BACKUP_DIR/monthly"/*.sql.gz 2>/dev/null | tail -n +13 | xargs -r rm -f

echo "[$(date -u)] Retention pass complete"
echo "  daily:   $(ls -1 "$BACKUP_DIR/daily"   | wc -l) files"
echo "  weekly:  $(ls -1 "$BACKUP_DIR/weekly"  | wc -l) files"
echo "  monthly: $(ls -1 "$BACKUP_DIR/monthly" | wc -l) files"
