#!/bin/sh
# Publishes a new app image on the server, used by the GitHub Actions deploy (and by hand if needed).
# Usage: ./deploy/deploy.sh ghcr.io/usuario/crab-finance:<commit>
# Order: migrations once -> app servers -> health check. If the new version never gets healthy, the previous one returns.
set -eu
cd "$(dirname "$0")/.."
image="${1:?Informe a imagem, por exemplo ghcr.io/usuario/crab-finance:abc123}"
from_env() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1; }
replicas="${APP_REPLICAS:-$(from_env APP_REPLICAS)}"
replicas="${replicas:-2}"
compose() { docker compose -f compose.yaml -f compose.prod.yaml "$@"; }
previous="$(cat .deploy-image 2>/dev/null || true)"

start() {
  export APP_IMAGE="$1"
  # DEPLOY_SKIP_PULL=1 uses an image built on this machine instead of the registry.
  [ "${DEPLOY_SKIP_PULL:-}" = 1 ] || compose pull migrate app
  compose build backup
  compose up -d --no-build --remove-orphans --scale app="$replicas"
}
healthy() {
  for _ in $(seq 1 30); do
    total=$(compose ps app --format '{{.Health}}' | wc -l)
    ok=$(compose ps app --format '{{.Health}}' | grep -c '^healthy$' || true)
    [ "$total" -gt 0 ] && [ "$ok" -eq "$total" ] && return 0
    sleep 3
  done
  return 1
}

echo "Publicando $image ($replicas servidores do app)..."
start "$image"
if healthy; then
  echo "$image" > .deploy-image
  docker image prune -f >/dev/null
  echo "Publicado: $image"
  exit 0
fi

echo "A nova versão não ficou saudável. Logs:"
compose logs --tail 80 app
if [ -n "$previous" ]; then
  echo "Voltando para $previous..."
  # Migrations are never undone; write them so the previous version still works (add columns before removing old ones).
  start "$previous"
  healthy && echo "Versão anterior restaurada: $previous"
fi
exit 1
