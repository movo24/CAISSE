# Tests UI Playwright — POS Caisse

Smoke réaliste du **parcours caisse critique** : login → scan produit → paiement espèces.

## Prérequis

1. **Backend local** sur `http://localhost:3001` avec données seed :
   ```bash
   # base locale + schéma + seed (une fois)
   cd packages/backend
   DATABASE_URL='postgresql://caisse:caisse@localhost:5432/caisse' \
     TYPEORM_SYNCHRONIZE=true TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT=tsconfig.json \
     npx ts-node -r tsconfig-paths/register src/database/seeds/seed.ts
   # lancer le backend
   npm run start:dev
   ```
   Le seed imprime le `Store ID` à utiliser (variable `E2E_STORE_ID`).

2. Le **serveur Vite** est démarré automatiquement par Playwright
   (`webServer` dans `playwright.config.ts`, avec `VITE_API_URL=http://localhost:3001`).
   Une instance déjà ouverte est réutilisée.

## Lancer

```bash
cd packages/pos-desktop
npm run test:e2e            # headless
npm run test:e2e:headed     # navigateur visible
npm run test:e2e:ui         # mode UI interactif Playwright
```

## Identifiants (surchargables)

| Variable        | Défaut (seed local)                      |
|-----------------|------------------------------------------|
| `E2E_STORE_ID`  | `93883cd9-5816-4b24-9436-f4f2fddbf2b6`   |
| `E2E_PIN`       | `1234`                                   |
| `E2E_EAN`       | `3760001000001` (T-Shirt Blanc, 29,90 €) |

Le `Store ID` par défaut est spécifique à un seed local : passez `E2E_STORE_ID`
pour pointer un autre jeu de données / une CI.

## Couverture actuelle vs à compléter

- ✅ login PIN → caisse
- ✅ scan produit → panier + total
- ✅ paiement espèces → panier vidé (vente enregistrée)
- ⏳ **à ajouter** : retour, émission d'avoir, paiement par avoir, clôture Z.
  Ces flux demandent des données seed dédiées (vente antérieure à retourner) et
  des sélecteurs d'écran supplémentaires — à faire dans une passe suivante.
