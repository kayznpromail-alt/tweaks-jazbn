#!/usr/bin/env bash
# One-shot install of the edgey API on a fresh Ubuntu/Debian VPS. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/kayznpromail-alt/tweaks-jazbn/main/deploy/install.sh | bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kayznpromail-alt/tweaks-jazbn.git}"
BRANCH="${BRANCH:-main}"
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
if [ ! -d "$DIR/.git" ]; then git clone -q --branch "$BRANCH" "$REPO_URL" "$DIR"; fi
# Always follow $BRANCH, whatever the repo's default branch is (.env and data/ are untracked and kept).
git -C "$DIR" fetch -q origin "$BRANCH"
git -C "$DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
cd "$DIR/deploy"

if [ ! -f .env ]; then
  IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
  echo
  echo "Domaine de l'API : tape api.edgey.shop si son DNS pointe deja vers $IP,"
  read -rp "sinon appuie sur Entree pour utiliser ${IP}.sslip.io : " DOMAIN </dev/tty
  DOMAIN="${DOMAIN:-$IP.sslip.io}"
  read -rp "Adresse de l'API du fournisseur (ex: https://api.fournisseur.com) : " UPSTREAM </dev/tty
  [ -n "$UPSTREAM" ] || { echo "Adresse vide, abandon."; exit 1; }
  read -rsp "Colle ta cle API du fournisseur (elle ne s'affiche pas) puis Entree : " KEY </dev/tty
  echo
  [ -n "$KEY" ] || { echo "Cle vide, abandon."; exit 1; }

  grep -vE '^(API_DOMAIN|PUBLIC_API_URL|UPSTREAM_BASE|UPSTREAM_API_KEY|SECRET_PEPPER|ADMIN_TOKEN)=' .env.example > .env
  {
    echo "API_DOMAIN=$DOMAIN"
    echo "PUBLIC_API_URL=https://$DOMAIN"
    echo "UPSTREAM_BASE=$UPSTREAM"
    echo "UPSTREAM_API_KEY=$KEY"
    echo "SECRET_PEPPER=$(openssl rand -hex 32)"
    echo "ADMIN_TOKEN=$(openssl rand -hex 24)"
  } >> .env
  chmod 600 .env
fi
DOMAIN="$(grep '^API_DOMAIN=' .env | cut -d= -f2)"

# The API container runs as the unprivileged "node" user (uid 1000).
mkdir -p data caddy
chown 1000:1000 data

# Front server: reuse nginx if it already runs on this VPS (it owns ports 80/443),
# otherwise let Caddy handle HTTPS.
sed -i '/^COMPOSE_PROFILES=/d' .env
if systemctl is-active --quiet nginx; then
  echo "==> nginx detecte : l'API passe par nginx (le reste de nginx n'est pas modifie)"
  docker compose --profile caddy rm -sf caddy >/dev/null 2>&1 || true
else
  echo "COMPOSE_PROFILES=caddy" >> .env
fi

echo "==> Demarrage (le premier build prend 1 a 2 minutes)"
docker compose up -d --build

if systemctl is-active --quiet nginx; then
  cat > /etc/nginx/conf.d/edgey-api.conf <<'NGINX'
# edgey API (written by /opt/edgey/deploy/install.sh)
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Stream model answers to the client as they arrive.
        proxy_buffering off;
        proxy_read_timeout 600s;
        client_max_body_size 20m;
    }
}
NGINX
  sed -i "s/__DOMAIN__/$DOMAIN/" /etc/nginx/conf.d/edgey-api.conf
  if ! nginx -t 2>/dev/null; then
    rm -f /etc/nginx/conf.d/edgey-api.conf
    echo "La config nginx ne passe pas, fichier retire (nginx n'a pas ete touche)."; exit 1
  fi
  systemctl reload nginx
  echo "==> Certificat HTTPS"
  dpkg -s python3-certbot-nginx >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email \
    --keep-until-expiring --redirect
fi

echo "==> Verification"
for _ in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then
    echo
    echo "OK : https://$DOMAIN/health repond."
    echo "Donne cette adresse a Claude : https://$DOMAIN"
    echo "Mot de passe du panel /admin (garde-le pour toi) : $(grep '^ADMIN_TOKEN=' .env | cut -d= -f2)"
    exit 0
  fi
  sleep 4
done
echo "Pas encore de reponse sur https://$DOMAIN/health."
echo "Regarde les logs : cd $DIR/deploy && docker compose logs --tail=50"
exit 1
