#!/usr/bin/env bash
# One-shot install of the edgey API on a fresh Ubuntu/Debian VPS. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/kayznpromail-alt/tweaks-jazbn/main/deploy/install.sh | bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kayznpromail-alt/tweaks-jazbn.git}"
DIR="${DIR:-/opt/edgey}"

[ "$(id -u)" = 0 ] || { echo "Lance ce script en root (sudo -i)."; exit 1; }

echo "==> Paquets de base"
apt-get update -y >/dev/null
apt-get install -y git curl openssl ca-certificates >/dev/null

if ! command -v docker >/dev/null; then
  echo "==> Installation de Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi

echo "==> Code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone -q "$REPO_URL" "$DIR"; fi
cd "$DIR/deploy"

if [ ! -f .env ]; then
  IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
  echo
  echo "Domaine de l'API : tape api.edgeycli.com si son DNS pointe deja vers $IP,"
  read -rp "sinon appuie sur Entree pour utiliser ${IP}.sslip.io : " DOMAIN </dev/tty
  DOMAIN="${DOMAIN:-$IP.sslip.io}"
  read -rsp "Colle ta cle API dawvq (elle ne s'affiche pas) puis Entree : " KEY </dev/tty
  echo
  [ -n "$KEY" ] || { echo "Cle vide, abandon."; exit 1; }

  grep -vE '^(API_DOMAIN|PUBLIC_API_URL|UPSTREAM_API_KEY|SECRET_PEPPER)=' .env.example > .env
  {
    echo "API_DOMAIN=$DOMAIN"
    echo "PUBLIC_API_URL=https://$DOMAIN"
    echo "UPSTREAM_API_KEY=$KEY"
    echo "SECRET_PEPPER=$(openssl rand -hex 32)"
  } >> .env
  chmod 600 .env
fi
DOMAIN="$(grep '^API_DOMAIN=' .env | cut -d= -f2)"

# The API container runs as the unprivileged "node" user (uid 1000).
mkdir -p data caddy
chown 1000:1000 data

echo "==> Demarrage (le premier build prend 1 a 2 minutes)"
docker compose up -d --build

echo "==> Verification"
for _ in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then
    echo
    echo "OK : https://$DOMAIN/health repond."
    echo "Donne cette adresse a Claude : https://$DOMAIN"
    exit 0
  fi
  sleep 4
done
echo "Pas encore de reponse sur https://$DOMAIN/health."
echo "Regarde les logs : cd $DIR/deploy && docker compose logs --tail=50"
exit 1
