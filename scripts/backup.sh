#!/usr/bin/env bash
# Postgres logical backup. Compresses with gzip, tagged with UTC timestamp.
# Usage:
#   ./scripts/backup.sh                   # default container + db name
#   CONTAINER=cura-db DB=cura ./scripts/backup.sh
#
# Restoring:
#   gunzip -c ./backups/cura-YYYYMMDDTHHMMSSZ.sql.gz \
#     | docker exec -i cura-db pg_restore -U cura -d cura --no-owner --role=cura
#   (For plain SQL dumps use `psql` instead of `pg_restore`.)
set -euo pipefail

CONTAINER="${CONTAINER:-cura-db}"
DB="${DB:-cura}"
USER="${USER:-cura}"
OUT_DIR="${OUT_DIR:-./backups}"
FORMAT="${FORMAT:-custom}"  # "custom" → -Fc (pg_restore); "plain" → plain SQL

mkdir -p "${OUT_DIR}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
EXT="dump"
[[ "${FORMAT}" == "plain" ]] && EXT="sql"

OUT="${OUT_DIR}/cura-${TS}.${EXT}"

echo "[backup] container=${CONTAINER} db=${DB} user=${USER} format=${FORMAT} out=${OUT}"

if [[ "${FORMAT}" == "custom" ]]; then
  docker exec "${CONTAINER}" pg_dump -U "${USER}" -d "${DB}" -Fc --no-owner > "${OUT}"
else
  docker exec "${CONTAINER}" pg_dump -U "${USER}" -d "${DB}" --no-owner > "${OUT}"
fi

# Always gzip the artifact for size + integrity.
gzip -f "${OUT}"
echo "[backup] wrote ${OUT}.gz ($(du -h "${OUT}.gz" | cut -f1))"
