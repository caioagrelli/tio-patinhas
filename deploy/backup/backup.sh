#!/bin/sh
# Encrypted dump -> restore check in a scratch database -> copy off the server -> remove old copies.
# Connection: PGHOST, PGUSER, PGPASSWORD, PGDATABASE. Encryption: BACKUP_PASSPHRASE (keep it outside the server too).
set -eu -o pipefail
: "${BACKUP_PASSPHRASE:?Defina BACKUP_PASSPHRASE}"
dir=/backups
file="$dir/crab-finance-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"

mkdir -p "$dir"
pg_dump -Fc | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$file.tmp"
mv "$file.tmp" "$file"
echo "Backup criado: $file ($(du -h "$file" | cut -f1))"

/scripts/restore-check.sh "$file"

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone -q copy "$file" "$BACKUP_REMOTE"
  rclone -q delete --min-age "${BACKUP_KEEP_DAYS:-30}d" "$BACKUP_REMOTE"
  echo "Cópia enviada para $BACKUP_REMOTE (mantendo ${BACKUP_KEEP_DAYS:-30} dias)."
else
  echo "AVISO: BACKUP_REMOTE vazio; o backup ficou só neste servidor."
fi
find "$dir" -name '*.dump.enc' -mtime +"${BACKUP_LOCAL_KEEP_DAYS:-7}" -delete
