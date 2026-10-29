#!/usr/bin/env bash
# Atualiza o Tio Patinhas no servidor (PythonAnywhere) com a última versão do GitHub.
# Uso, no console Bash do PythonAnywhere:  cd ~/tio-patinhas && ./atualizar.sh
# Depois, clique em "Reload" na aba Web.
set -euo pipefail
cd "$(dirname "$0")"
git pull
pip install -q -r requirements.txt
python manage.py migrate --noinput
python manage.py collectstatic --noinput
echo "Pronto! Agora clique em Reload na aba Web do PythonAnywhere."
