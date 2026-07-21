# Incident — « Erreur de validation » à la création produit (récidive du 2026-07-21)

> Diagnostic + correctif sur `fix/product-create-validation-errors`
> (base : `fix/fiche-produit-corrections`). Voir aussi
> `INCIDENT-2026-07-19-P0-creation-produit.md` (même famille de cause).

## Symptôme (terrain, 2026-07-21)

Back-Office déployé (`app.addxintelligence.com`) → « Nouvelle fiche produit » →
Enregistrer → **« Erreur de validation »**, sans aucun champ identifié.
Repro utilisateur : nom + EAN + marque + statut Actif + nom court renseignés,
type simple, catégorie « Aucune », autres onglets partiellement vides.

## Cause racine — dérive de déploiement frontend/backend (sens inverse du 2026-07-19)

Empreinte des routes du backend live (2026-07-21, lecture seule, identique sur
`api.addxintelligence.com` et `caisse-backend-production.up.railway.app`) :

| Route sonde | Présente ? | Interprétation |
|---|---|---|
| `GET /api/products/catalog-stats` (L1.4a) | ✅ 401 | lignée catalog-refonte |
| `GET /api/products/:id/variants` / `components` | ✅ 401 | ≥ Bloc 5 / packs |
| `GET /api/products/:id/media` (L4) | ❌ 404 | **antérieur à L4** |
| `GET /api/products/:id/barcodes` (Lot A) | ❌ 404 | antérieur au Lot A |
| `GET /api/stock/journal/health` (main 1767) | ❌ 404 | antérieur au merge stock-journal |

Ordre des commits : `dcfbe53 (L1.4a) → e7dcf2a (L1.4b) → 696e624 (L1.5) → 0d98468
(L2 — champs DTO fiche) → 798afc1 (L4) → Lots A…J`. Le backend live est donc
**bloqué entre L1.5 et L2**, alors que le bundle Vercel (fiche ERP @ `3dc502f`,
redéployé lors du P0 du 2026-07-19) envoie TOUJOURS `shortName`, `productType`,
`isSeasonal` (+ champs Lot 2/E/I remplis). La ValidationPipe globale
(`whitelist + forbidNonWhitelisted`) rejette ces propriétés inconnues :
`property shortName should not exist`, … → 400 `VALIDATION_ERROR` → le
Back-Office n'affichait que le `message` générique « Erreur de validation. »

**Aucune saisie ne peut réussir depuis ce bundle tant que le backend live n'est
pas ≥ L2** — le problème n'a jamais été un champ mal rempli.

## Correctif code (cette branche)

1. **Backend** — `validationExceptionFactory` : la 400 expose désormais
   `fields: { champ: [messages] }` (en plus de `details`, inchangé) ;
   validation EAN stricte à la création (`IsGtinBarcode` : EAN-8 / UPC-A-12 /
   EAN-13, clé de contrôle mod-10, message français explicite).
2. **Back-Office** — validation client complète de la fiche
   (`utils/ficheValidation.ts` + `utils/gtin.ts`) : champ fautif surligné en
   rouge, message sous le champ, bandeau « Impossible d'enregistrer : N champs
   doivent être corrigés » avec liste cliquable, ouverture automatique de
   l'onglet du premier champ invalide + focus ; mapping des 400/409 serveur vers
   les champs (`fields` structurés OU `details` plats des anciens serveurs) ;
   doublon EAN/SKU (409) affiché sous le bon champ ; **les propriétés refusées
   (`should not exist`) produisent un bandeau explicite « versions de
   l'interface et du serveur désalignées »** au lieu du message générique —
   cette classe d'incident devient auto-diagnostiquée à l'écran.
3. Bugs corrigés au passage : TVA 0 % et seuils 0 retombaient silencieusement
   sur les défauts serveur (`|| undefined` sur des valeurs 0).

## Remise en service prod (Tier-2 — GO owner nominatif requis, non exécuté ici)

Le correctif code ne suffit PAS à rétablir la création sur le déployé : il faut
**aligner le backend live sur la lignée fiche ERP** (≥ `3dc502f`, idéalement
cette branche une fois mergée dans `fix/fiche-produit-corrections`), puis
redéployer le Back-Office depuis la même lignée. Migrations 1759→1767
additives, déjà partiellement appliquées en prod (cf. incident 2026-07-19).

## Vérifications (2026-07-21, local, base jetable `caisse_fix_validation`)

- Backend : 124 suites / 1 091 tests verts (dont 19 nouveaux
  `create-product.contract.spec.ts`) ; lint 0 erreur ; tsc OK.
- Back-Office : 14 fichiers / 112 tests vitest verts (dont 19 nouveaux
  `ficheValidation.test.ts`) ; lint 0 erreur ; tsc OK.
- E2E UI (migrations 1700→1767 + seed) : scénario utilisateur exact → **201** ;
  EAN lettres/clé fausse → messages précis ; prix manquant → ouverture auto
  Tarification + focus ; 2 erreurs multi-onglets → bandeau « 2 champs » +
  liste cliquable ; création complète → fiche créée et relue en base.
