#!/bin/sh
# Restores an encrypted backup over PGDATABASE. Usage: restore.sh FILE --confirmar
# Stop the app first (docker compose stop app) so nobody writes during the restore.
set -eu -o pipefail
[ "${2:-}" = "--confirmar" ] || { echo "Isto substitui os dados de $PGDATABASE. Rode: restore.sh $1 --confirmar"; exit 1; }
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$1" | pg_restore --clean --if-exists --no-owner --exit-on-error -d "$PGDATABASE"
echo "Restaurado: $1"
