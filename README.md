# edgeycli.com

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
