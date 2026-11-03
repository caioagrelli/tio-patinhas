#!/bin/sh
# Applies changes made to .env (new keys, SMTP, Google…): recreates the app with the image already published.
# Usage on the server, as the deploy user: cd /opt/crab-finance && ./deploy/restart.sh
set -eu
cd "$(dirname "$0")/.."
[ -f .deploy-image ] || { echo "Nenhuma versão publicada ainda (.deploy-image não existe)."; exit 1; }
APP_IMAGE="$(cat .deploy-image)"
export APP_IMAGE
replicas="$(sed -n 's/^APP_REPLICAS=//p' .env 2>/dev/null | tail -n 1)"
docker compose -f compose.yaml -f compose.prod.yaml up -d --no-build --no-deps --scale app="${replicas:-2}" app
echo "App reiniciado com $APP_IMAGE."
