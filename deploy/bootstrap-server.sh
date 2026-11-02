#!/bin/sh
# Prepares a fresh Ubuntu 24.04 server (AWS Lightsail/EC2 or any VPS) to run CRAB FINANCE. Run once, as root:
#   curl -fsSL https://raw.githubusercontent.com/<usuario>/<repo>/main/deploy/bootstrap-server.sh | sudo DEPLOY_PUBLIC_KEY="ssh-ed25519 AAAA..." sh
# Installs Docker from Docker's own repository, creates the "deploy" user used by GitHub Actions,
# adds swap, turns on automatic security updates and a firewall that only opens SSH, HTTP and HTTPS.
set -eu

[ "$(id -u)" -eq 0 ] || { echo "Rode como root (sudo)."; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
[ "$ID" = ubuntu ] || { echo "Este script é para Ubuntu (encontrado: $ID)."; exit 1; }
app_dir="${APP_DIR:-/opt/crab-finance}"
export DEBIAN_FRONTEND=noninteractive

echo "==> Atualizando o sistema"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl ufw unattended-upgrades

echo "==> Instalando Docker e Docker Compose (repositório oficial do Docker)"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
# Container logs rotate instead of filling the disk.
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
JSON
systemctl restart docker

echo "==> Usuário de deploy"
if ! id deploy >/dev/null 2>&1; then useradd --create-home --shell /bin/bash deploy; fi
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if [ -n "${DEPLOY_PUBLIC_KEY:-}" ]; then
  touch /home/deploy/.ssh/authorized_keys
  grep -qxF "$DEPLOY_PUBLIC_KEY" /home/deploy/.ssh/authorized_keys || echo "$DEPLOY_PUBLIC_KEY" >> /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys
  chmod 600 /home/deploy/.ssh/authorized_keys
else
  echo "AVISO: DEPLOY_PUBLIC_KEY vazio; adicione a chave pública do GitHub Actions em /home/deploy/.ssh/authorized_keys."
fi
install -d -m 750 -o deploy -g deploy "$app_dir"

echo "==> Swap de 2 GB (evita falta de memória em picos e builds)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Atualizações automáticas de segurança"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Firewall: só SSH, HTTP e HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> SSH só com chave (sem senha)"
mkdir -p /etc/ssh/sshd_config.d
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/90-crab-finance.conf
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

echo
echo "Servidor pronto. Próximo passo: criar $app_dir/.env (veja DEPLOY.md) como usuário deploy."
docker --version
docker compose version
