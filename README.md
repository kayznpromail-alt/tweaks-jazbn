# edgeycli.com

Dashboard EDGEY CLI en [Astro](https://astro.build) : HTML statique, quasi zéro JS.

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # génère dist/
```

- `src/pages/` : une page par onglet (overview, keys, setup, models, activity)
- `src/components/` : header, icônes, cartes réutilisables
- `src/data/site.ts` : URL de l'API, modèles, clés (données de démo pour l'instant)
