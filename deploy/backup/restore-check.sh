#!/bin/sh
# Proves a backup can be restored: decrypts it into a scratch database, compares it with production and drops it.
set -eu -o pipefail
file="$1"
scratch="restore_check_$(date -u +%s)"
cleanup() { dropdb --if-exists "$scratch" 2>/dev/null || true; }
trap cleanup EXIT
createdb "$scratch"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$file" | pg_restore --no-owner --exit-on-error -d "$scratch"
count() { psql -d "$1" -Atc "SELECT (SELECT count(*) FROM \"_prisma_migrations\") || '/' || (SELECT count(*) FROM \"User\")"; }
restored=$(count "$scratch")
live=$(count "$PGDATABASE")
echo "Restauração testada: migrations/usuários no backup = $restored, no banco = $live"
[ "${restored%%/*}" = "${live%%/*}" ] || { echo "ERRO: o backup não tem as mesmas migrations do banco."; exit 1; }
