## Périmètre

Réconciliation **option A** : replay ADDITIF des livrables validés (app mobile de pilotage « The Wesley Control » + WebAuthn/passkeys) sur une branche fraîche depuis `main`, plutôt qu'un merge in-place de la branche `feat/external-wiring-fallbacks-2026-07` (qui butait sur 50 conflits dont le cœur fiscal NF525).

- **App mobile pilotage** (lecture seule) : vue d'ensemble, comparateur multi-magasins, produits, catégories, heatmap, alertes — remplace l'app inventaire (seule zone avec suppressions).
- **WebAuthn/FIDO2** (Face ID / Touch ID / Windows Hello / clé) : module `auth/webauthn`, `createSessionForEmployee`, migration **1759** (au-dessus de 1758), droits relus en base.
- **Module `mobile-cockpit`** complet (alertes + analytics `GET /mobile/v1/analytics/*`).

## Recâblages schéma (arbitrage « lignée officielle gagne »)

Les migrations branche 1723/1726/1727/1728/1729 **ne sont PAS rejouées** (main les couvre déjà). Le code analytics a été adapté au schéma `main` :
- `variant_label` → `variant_name`
- `products.brand` (varchar) → jointure `brands` + `brand_id`
- `price_override_minor_units` → prix de base (main = table `store_product_prices`)

## Nature du diff

**100 % additif hors `packages/mobile`** : 0 suppression hors mobile (vérifié), 21 suppressions dans mobile = remplacement inventaire→pilotage. Modifs hors-mobile = câblage additif (`app.module`, `auth.module`, `auth.service`, deps).

## Preuves

- tsc backend + mobile = 0 ; **suite backend 118 suites / 1022 PASS** ; **front 452 tests** (backoffice 78 + pos-desktop 335 + mobile 39) ; builds nest + vite = 0.
- Migration base vierge unifiée = **40 migrations** (lignée main + **1759 en tête après 1758**), idempotence « No migrations pending ».
- **Runtime** (backend sur base seedée schéma-main) : `/analytics/products` remonte la marque « Haribo » via la jointure `brands`, produit sans marque = `null` (LEFT JOIN OK), filtre `q=haribo` OK, variante « Format XL » via `variant_name`.

## Prérequis PROD (gated — GO humain requis, NE PAS faire au merge)

1. Variables Railway `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGINS` (https). Voir `packages/backend/docs/GO_WEBAUTHN_PROD.md`.
2. Migration **1759** sur la base cible via `migration:run` standard (PAS `run-gate2.sh`, obsolète).

## Reste hors périmètre de cette PR

~260 fichiers backend de la branche divergente (integration, comptamax, sales-ai, 5 features fiscales à double implémentation) — réconciliation gated (décisions produit fiscales). Dossier d'arbitrage : `packages/backend/docs/RECONCILIATION_AUDIT.md`.

Branche session `feat/external-wiring-fallbacks-2026-07` et tag `backup/pre-reconcile-20260714` conservés comme archive.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
