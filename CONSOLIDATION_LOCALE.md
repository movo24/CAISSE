# CONSOLIDATION_LOCALE.md — Bascule locale (2026-06-28)

> Document unique de passation. État git prouvé dans `GIT_RECOVERY.md`.
> **Règle** : aucune migration ni build n'a été exécuté dans le sandbox (interdit + FUSE).

## 1. Inventaire commité vs en attente

| Élément | État réel |
|---|---|
| **PAQUET 1** (gouvernance, 12 fichiers `.md`) | ✅ **COMMITÉ** sur la branche → `c55e6c5` (= HEAD) |
| **PAQUETS 2 → 35** (tout le code + tests + docs MAJ) | ⏳ **NON COMMITÉ** — dans le working tree (36 `M` + 70 `??`) ; aussi présents en commits **pendants** non référencés |
| Branche | `fix/ticket-number-sequence-cursor` @ `c55e6c5` (jamais avancée) |

⇒ **Rien des paquets 2→35 n'est sur la branche.** La récupération se fait via le working tree (cf. `GIT_RECOVERY.md` §3).

## 2. Ce qui est PROUVÉ dans le sandbox (et ce qui ne l'est pas)

**Prouvé (exécuté, sorties réelles)** :
- Tests unitaires purs + services à repo mocké : exécutés en 3 lots → **223 PASS** (PAQUET 29) ; suites individuelles re-prouvées à chaque paquet.
- `tsc --noEmit -p tsconfig.json` → **EXIT 0** après chaque paquet (typecheck backend complet).
- `npm rebuild bcrypt` (Linux) pour permettre l'exécution jest.

**NON prouvé (à faire en local)** :
- Suites **lourdes** (pg-mem / NestTestingModule complet : `sale-transaction`, `fiscal`, `test/*.spec.ts`) — dépassent la limite 45 s/commande du sandbox.
- **Migrations 1721, 1722, 1723, 1724 : NON REJOUÉES = NON PROUVÉES** (aucune DB en sandbox).
- Runtime DB des nouveaux endpoints reporting (`accounting-export`, `payments-breakdown`, `sales-by-employee`).
- Connectivité live TimeWin24 / Stripe (paiement réel) — interdits/non testés.

## 3. Migrations ajoutées (réversibles, additives) — À REJOUER EN LOCAL

| Migration | Objet | Statut |
|---|---|---|
| `1721000000000-AddStockBaseline` | `products.stock_baseline_quantity` (alerte 20%) | non rejouée = non prouvée |
| `1722000000000-AddProductNormalizedName` | `products.normalized_name` + index (dédup) | non rejouée = non prouvée |
| `1723000000000-AddProductPriceOverride` | `products.price_override_minor_units` | non rejouée = non prouvée |
| `1724000000000-AddPromoUsageLimit` | `promo_rules.usage_limit/usage_count` | non rejouée = non prouvée |

Toutes ont un `down()` (réversible). Backfills additifs/non destructifs.

## 4. Séquence de validation locale (app desktop fermée)

```bash
cd ~/CAISSE
# A. Sécuriser le travail (voir GIT_RECOVERY.md §3)
rm -f .git/index.lock .git/HEAD.lock .git/refs/heads/*.lock 2>/dev/null
git add -A && git commit -m "POS audit session — paquets 2→35"

# B. Tests backend COMPLETS (lève la limite sandbox)
cd packages/backend && npm run test:backend          # doit être vert AVANT merge

# C. Migrations en DEV (jamais prod ici)
npm run migration:run                                 # applique 1721→1724
#   rollback test conseillé : npm run migration:revert (×4) puis migration:run

# D. Build
npm run build:backend

# E. (optionnel) lint
cd ../.. && npm run lint
```

Ne PAS faire en prod sans GO explicite (DNS, déploiement, migration prod).

## 5. Reste ouvert (voir TECHNICAL_DEBT.md)

- `TD-STOCK-TWO-SYSTEMS` (gate archi : journal `stock_movements` à la vente).
- `TD-073-USAGE-INCREMENT` (décompte usage promo à l'application).
- `TD-094-FREQ-ENDPOINT` (endpoint fréquence client + anti-IDOR/RBAC — **non livré**).
- `TD-VISIT-SEGMENT-THRESHOLDS` (seuils segmentation provisoires à ratifier).
- `TD-COMPTAMAX` / Paywin24 (intégrations externes — envoi non branché).
- `TD-055-QUIET-HOURS-WIRING`, `TD-066-LEGACY-BACKFILL`, `TD-061-UI`, `TD-018-FILTERS-RUNTIME`.
