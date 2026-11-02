#!/bin/sh
# Runs the backup every day at BACKUP_TIME (UTC, HH:MM). 06:00 UTC = 03:00 in Brasília.
set -eu
: "${BACKUP_TIME:=06:00}"
echo "Backup diário às $BACKUP_TIME UTC."
# Optional dead man's switch (e.g. healthchecks.io): warns you when a day passes without a successful backup.
notify() { if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then curl -fsS -m 10 "$BACKUP_HEALTHCHECK_URL$1" >/dev/null || true; fi; }
run() { if /scripts/backup.sh; then notify ""; else echo "Backup falhou; veja as mensagens acima."; notify /fail; fi; }
if [ "${BACKUP_ON_START:-false}" = true ]; then run; fi
while true; do
  if [ "$(date -u +%H:%M)" = "$BACKUP_TIME" ]; then
    run
    sleep 61
  fi
  sleep 20
done
