# Mettre l'API en ligne (api.edgey.shop)

Le serveur (`server/`) gère les comptes à 16 chiffres, les clés `sk_edgey_…`, le décompte des tokens
et relaie les requêtes vers ton fournisseur avec **ta** clé, qui ne quitte jamais le VPS.

## 1. Ce qu'il faut avant

- Un VPS **Ubuntu 24.04** (2 vCPU / 2–4 Go RAM suffisent), son IP publique et un accès SSH.
- Le domaine `cli.edgey.shop`. Dans ses DNS, ajoute un enregistrement **A** :
  `api` → IP du VPS. Chez Cloudflare, mets-le en **DNS only** (nuage gris).

## 2. Installer en une commande (recommandé)

Connecte-toi au VPS en root (`ssh root@IP_DU_VPS`), puis :

```sh
curl -fsSL https://raw.githubusercontent.com/kayznpromail-alt/tweaks-jazbn/main/deploy/install.sh | bash
```

Le script installe Docker, télécharge le code dans `/opt/edgey`, demande l'adresse et ta clé du fournisseur (clé invisible à l'écran),
génère le secret, et démarre tout. Sans domaine prêt, appuie sur Entrée : l'API sera servie en HTTPS sur
`IP.sslip.io` (par exemple `194.163.138.26.sslip.io`) en attendant `api.edgey.shop`.

Les commandes du quotidien ci-dessous se lancent alors depuis `/opt/edgey/deploy`.

## 2 bis. Installer à la main (sur le VPS, en SSH)

```sh
# Docker
curl -fsSL https://get.docker.com | sh

# Le code
git clone -b main https://github.com/kayznpromail-alt/tweaks-jazbn.git edgey
cd edgey/deploy

# La config
cp .env.example .env
openssl rand -hex 32        # copie le résultat dans SECRET_PEPPER
nano .env                   # UPSTREAM_BASE (adresse du fournisseur), UPSTREAM_API_KEY (ta clé), SECRET_PEPPER

# Lancer (le conteneur écrit en tant qu'utilisateur 1000)
mkdir -p data && chown 1000:1000 data
docker compose up -d --build
```

Vérifier : `curl https://api.edgey.shop/health` doit répondre `{"ok":true}`.

⚠️ Ne change jamais `SECRET_PEPPER` après le lancement : tous les numéros et toutes les clés deviendraient invalides.

## 3. Brancher le site

Dans `src/data/site.ts`, passe `API_ENABLED` à `true` et envoie sur `main`.
La connexion, les clés, le solde et le Top up utiliseront alors le vrai serveur.

## 4. Au quotidien (depuis `edgey/deploy`)

```sh
# Créditer une vente PayPal / carte faite sur Discord
docker compose exec api npm run -s admin -- pack "1234 5678 9012 3456" 25

# Montant libre (200M, 1.5B…) avec le prix payé en euros
docker compose exec api npm run -s admin -- credit "1234 5678 9012 3456" 200M 25 paypal

# Infos d'un compte, bloquer / débloquer
docker compose exec api npm run -s admin -- info "1234 5678 9012 3456"
docker compose exec api npm run -s admin -- disable "1234 5678 9012 3456"

# Tokens dus à tous tes clients : ton wallet chez le fournisseur doit toujours couvrir ce total
docker compose exec api npm run -s admin -- stats

# Mettre à jour après un changement du code
git pull && docker compose up -d --build

# Voir les logs
docker compose logs -f api
```

## 4 bis. Panel admin

Sur le site, `/admin` : stats, comptes, crédits manuels, blocage. Le mot de passe est `ADMIN_TOKEN`
dans `.env` (le script d'installation l'affiche à la fin). Pour le revoir : `grep ADMIN_TOKEN /opt/edgey/deploy/.env`.

## 5. Sauvegardes

Toute la base est dans `deploy/data/edgey.db`. Copie-la régulièrement ailleurs (au minimum une fois par jour).

## 6. NOWPayments (crypto), plus tard

1. Crée le compte NOWPayments, ajoute ton wallet de réception.
2. Dans *Settings → Payments*, génère une **API key** et un **IPN secret**.
3. Mets-les dans `.env` (`NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`), puis `docker compose up -d`.
4. L'URL de callback est déjà envoyée avec chaque paiement : `https://api.edgey.shop/webhooks/nowpayments`.

Un paiement n'est crédité qu'une fois, seulement quand NOWPayments le marque `finished` avec une signature valide.
