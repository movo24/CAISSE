# Incident P0 — « Erreur de validation » à la création produit (Back-Office)

> Date : 2026-07-19 · Diagnostic complet, reproduction prouvée en local.
> Branche de diagnostic : `fix/p0-catalog-deploy-drift` (= `feat/catalog-refonte` @ `3dc502f` + ce dossier).

## Symptômes (terrain)

1. Impossible d'ajouter un produit : « Erreur de validation » au clic sur Ajouter.
2. Aucune des évolutions catalogue (titres, catégories, TVA, nouveaux champs) visible.
3. Impression d'une « ancienne version » du Back-Office.

## Cause racine — dérive de déploiement frontend/backend

| Composant | URL | État réel constaté |
|---|---|---|
| Backoffice déployé | `app.addxintelligence.com` | Bundle `index--oTkP3-v.js` **antérieur à la PR #46** (`dcf60ba`, alignement payload↔DTO) — aucune feature récente |
| Backend derrière `api.addxintelligence.com` | (visé par ce bundle) | Code **lignée `feat/catalog-refonte`** (route `/api/products/catalog-stats` présente = unique à cette branche ; `/api/pilotage/access/*` absent = antérieur au merge accès/audit) |
| Backend B Railway | `caisse-backend-production.up.railway.app` | Même empreinte de routes que ci-dessus |

Le vieux bundle soumet à la création :
```js
{ name, ean, price: <centimes>, stock: <int>, category: <string>, storeId: <uuid> }
```
Le backend actuel (ValidationPipe globale `whitelist + forbidNonWhitelisted`, `CreateProductDto`
exigeant `priceMinorUnits`) répond :

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Erreur de validation.",
  "statusCode": 400,
  "details": [
    "property price should not exist",
    "property stock should not exist",
    "property category should not exist",
    "property storeId should not exist",
    "priceMinorUnits must not be less than 0",
    "priceMinorUnits must be an integer number"
  ]
}
```
→ C'est exactement le message affiché en Back-Office (le message vient de
`packages/backend/src/main.ts` — exceptionFactory de la ValidationPipe).
**Aucune requête de création ne peut réussir depuis ce bundle** : la cause n'est pas un champ
mal rempli mais le contrat d'API obsolète du frontend déployé.

## Preuves (reproduction locale, 2026-07-19)

Environnement : worktree `feat/catalog-refonte` @ `3dc502f`, base Postgres jetable
`caisse_p0_repro` (migrations 1700→1767 OK), seed dev, backend :3101, backoffice Vite :5273.

1. **Repro exacte** : POST `/api/products` avec le payload du vieux bundle → 400 ci-dessus, à l'identique.
2. **Création API** : payload aligné (`priceMinorUnits: 250, taxRate: 5.5, categoryId, stockQuantity`) → **201 Created**.
3. **Création UI** : Produits → Nouveau produit → scan EAN `3760999000777` → fiche complète
   (onglets Général/Tarification/Stock/Fournisseurs/Packs/Variantes/Produits liés/Images/Logistique),
   TTC `2,50` @ TVA 5,5 % → HT calculé 2,37 € en direct → Enregistrer → **POST 201**.
4. **Modification UI** : TTC 2,50 → 3,00 → persisté (`priceMinorUnits: 300` relu en base via GET).
5. **Affichage** : le produit apparaît dans le Catalogue Produits (recherche, prix TTC, statut Actif,
   colonnes catégorie/marque/TVA).

## État des merges / migrations

- `feat/catalog-refonte` (migrations **1759000000000→1766**, arbre catégories, fiche ERP) :
  **NON mergée** dans `main`. `main` s'arrête à `1758` + `1767`.
- Le backend live (lignée catalog-refonte) **boote sans erreur** avec `migrationsRun: isProd`
  → les migrations catalogue sont **déjà appliquées sur la base de prod** depuis une branche
  non mergée (à régulariser par le merge).
- Bug TVA-en-string (#91, `fix(tva)` sur `main`) : **absent** de `catalog-refonte` — reproduit
  ici (`taxRate: "5.5"` renvoyé en string). Le merge `main` → `catalog-refonte` le corrigera.

## Blocage Tier-2 remonté (charte §1)

Le merge `origin/main` → `feat/catalog-refonte` produit un conflit **non trivial** :
`ProductEditPage.tsx` = **39 blocs** (add/add : fiche produit P1 de la PR #84 vs fiche ERP de la
refonte), + `api.ts` (4), + `productForm.ts`, `ProductsPage.tsx`, `main.tsx`,
`employee-store-access.entity.ts`, `PROJECT_STATUS.md` (1–2 chacun).
→ Arbitrage produit requis (quelle fiche fait foi) : **décision owner**, pas agent. Merge annulé proprement.

## Remise en service (gatée — GO nominatif owner requis pour chaque action)

1. **P0 immédiat** : redéployer le Back-Office (`app.addxintelligence.com`) depuis
   `feat/catalog-refonte` @ `3dc502f` (= cette branche), `VITE_API_URL=https://api.addxintelligence.com`.
   C'est exactement la combinaison validée en E2E ci-dessus (le backend live est déjà cette lignée).
2. **Ensuite** : arbitrer le conflit fiche produit → merge `main` ⇄ `catalog-refonte` → PR vers `main`
   (récupère le fix TVA #91 + régularise les migrations 1759–1766 déjà en prod).
3. Notes : session Railway CLI/MCP expirée localement (`railway login` à refaire) ;
   déploiements Railway = manuels (`serviceInstanceDeployV2`, cf. RUNBOOK).

## Garde-fou proposé (à discuter)

Dérive silencieuse frontend/backend = cause racine. Proposition : exposer le SHA de build
(backend `/api/health`, backoffice `meta` build) et l'afficher dans le Dashboard admin +
check de compatibilité au boot du backoffice. Non implémenté ici (hors périmètre minimal P0).
