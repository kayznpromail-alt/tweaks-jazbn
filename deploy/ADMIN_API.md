# API admin (pour brancher ton panel existant)

Base : `https://api.edgey.shop/admin` (ou `https://IP.sslip.io/admin` avant le domaine).
Chaque requête envoie le jeton admin : `Authorization: Bearer <ADMIN_TOKEN>` (valeur dans `.env` sur le VPS).

⚠️ Appelle ces routes **depuis le serveur de ton panel**, jamais depuis du JavaScript public : le jeton donne
tous les droits. Sans `ADMIN_TOKEN` dans `.env`, toutes ces routes répondent 404.

| Méthode | Route | Corps (JSON) | Réponse |
|---|---|---|---|
| GET | `/stats` | – | `accounts`, `activeAccounts24h`, `tokensOwed`, `revenueEur`, `revenue30dEur`, `payments30d`, `requests24h`, `tokens24h`, `charged24h` |
| GET | `/accounts?limit=50` | – | `{ accounts: [compte…] }` (les plus récents) |
| POST | `/lookup` | `{ "number": "1234 5678 9012 3456" }` | compte, ou 404 |
| POST | `/accounts` | – | `{ number, account }` : crée un compte (le numéro n'est donné qu'ici) |
| GET | `/accounts/:id` | – | compte + `apiKeys`, `payments`, `usage` (50 derniers) |
| POST | `/accounts/:id/credit` | `{ "packEur": 65, "note": "paypal" }` ou `{ "tokens": 200000000, "eur": 25, "note": "…" }` | compte mis à jour. `tokens` négatif = correction (jamais sous 0) |
| POST | `/accounts/:id/status` | `{ "disabled": true }` | compte mis à jour (bloquer déconnecte aussi le client) |
| GET | `/payments?limit=50` | – | `{ payments: [...] }` (tous comptes) |

Un **compte** ressemble à :

```json
{ "id": 12, "balance": 500000000, "paidEur": 65, "disabled": false,
  "createdAt": 1790708740617, "keys": 2, "lastRequestAt": 1790712345678 }
```

Les dates sont en millisecondes (timestamp Unix). Les numéros d'accès ne sont jamais stockés en clair :
pour retrouver un client, utilise `/lookup` avec le numéro qu'il te donne.

Exemple (créditer un pack de 65 € au compte 12) :

```sh
curl -X POST https://api.edgey.shop/admin/accounts/12/credit \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"packEur":65,"note":"paypal discord"}'
```

Erreurs : `401 unauthorized` (mauvais jeton, bloqué après 20 échecs / 15 min), `404 not_found`,
`400 invalid_amount | unknown_pack | balance_would_go_negative | invalid_number`.
