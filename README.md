# cli.edgey.shop

Dashboard EDGEY CLI en [Astro](https://astro.build) : HTML statique, quasi zéro JS.

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # génère dist/
```

- `src/pages/` : `index` = connexion (page d'accueil), `overview`, `api`, `setup`, `models`, `activity`, `404`
- `src/components/` : header, icônes, cartes et blocs réutilisables
- `src/layouts/` : `Shell` (base commune : intro, transitions, styles) et `Base` (dashboard)
- `src/data/site.ts` : URL de l'API, wallet, clés et modèles (vides pour l'instant)

## API (serveur)

`server/` contient la passerelle `api.edgey.shop` : comptes à 16 chiffres, clés `sk_edgey_…`,
décompte des tokens × multiplicateur, relais vers le fournisseur, NOWPayments.
Tests : `cd server && npm install && npm test`. Mise en ligne : voir `deploy/DEPLOY.md`.
`shared/catalog.json` (modèles, packs, cryptos) est lu par le site et par le serveur.
