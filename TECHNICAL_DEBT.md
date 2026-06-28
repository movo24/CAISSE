# TECHNICAL_DEBT.md — Dette technique (vérifié 2026-06-28)

> Honnêteté : un item reste ouvert tant qu'il n'est pas prouvé résolu (commit + test).

| ID | Dette | Sévérité | Preuve / Localisation | Statut |
|---|---|---|---|---|
| TD-DOC-DRIFT | CLAUDE.md sous-compte modules (37→40), entités (45→47), migrations (11→16), tests (405→~488) | 🟠 | comparaison audit vs CLAUDE.md | Ouvert |
| TD-API-MAP | Détail méthode/payload/erreurs/rôle manquant pour la plupart des 213 routes | 🟠 | `POS_API_MAP.md` | Ouvert |
| TD-MOBILE-COCKPIT | ~~`GET /api/mobile/v1/alerts` inexistant~~. **Résolu** : module `mobile-cockpit` créé (read-only, manager+, stock+anomalies, shaper testé 6/6, tsc clean). Runtime DB à valider local. | 🟡 | `modules/mobile-cockpit/` | Implémenté |
| TD-112-MORE-ALERTS | Cockpit agrège stock + anomalies vente ; alertes paiement/fermeture pas encore (pas de source dédiée). | 🟡 | `mobile-cockpit.service` | Ouvert |
| TD-PAYWIN | Paywin24 non branché (aucune réf code) | 🟠 | grep `paywin` = 0 | Ouvert (futur) |
| TD-COMPTAMAX | Comptamax24 non branché (aucune réf code) | 🟠 | grep `comptamax` = 0 | Ouvert (futur) |
| TD-OFFLINE-TESTS | Tests offline auto non confirmés | 🟠 | `POS_OFFLINE_STRATEGY.md` | Ouvert |
| TD-PAYMENT-TESTS | Tests paiement simulé à étendre | 🟠 | `POS_PAYMENT_STRATEGY.md` | Ouvert |
| TD-FULL-SUITE-CI | Suite complète non confirmée verte (sandbox 45 s) | 🟠 | `PROJECT_STATUS.md` §3 | Ouvert |
| TD-BCRYPT-NATIVE | `bcrypt` natif lié à la plateforme (rebuild requis hors macOS) | 🟡 | `invalid ELF header` | Atténué (rebuild Linux) |
| TD-SEC-AVRIL | Points sécurité avril (PIN500, receipts public/XSS, secrets git) | 🔴/🟠 | `POS_SECURITY.md` | À vérifier |
| TD-FRONT-ERRORS | Erreurs avalées (StockAlertsPage, LabelsPage) | 🟠 | AUDIT-FINAL avril | À vérifier |
| TD-DEAD-BUTTONS | Boutons exports inactifs (Produits/Reports) | 🟡 | AUDIT-FINAL avril | À vérifier |
| TD-UNTRACKED | `InventoryVariancePage.tsx` non commité, `RAPPORT_20H.md` non suivi | 🟡 | `git status` | Ouvert |
| TD-DISCOUNT-CAP | Plafond remise 30% : moteur + distribution **testés 25/25**, câblage caisse + back-office **branchés & tsc clean**. Reste : test runtime vente en local. | 🟡 | `discount-policy.ts`, `sales.service.ts`, `backoffice-discounts/` | Largement traité |
| TD-054B-RUNTIME | Câblage `createSale` (distribution remise/lignes/TVA) non couvert par test exécuté ici (spec lourde > 45 s sandbox). | 🟠 | `sales.service.ts` | À tester localement (`npm run test:backend`) |
| TD-RESP-PIN | Vérif PIN responsable sans rate-limit / lockout sur tentatives. | 🟠 | `sales.service.verifyResponsablePin` | Ouvert — ne PAS déclarer "sécurité terminée" |
| TD-054D-TERMINAL | `createSale` ne reçoit pas le terminal/caisse id → absent de l'audit remise. | 🟡 | `sales.service.ts`, `sales.controller.ts`, `pos-session` | Ouvert |
| TD-054E-APPLY | Endpoint back-office autorise/audite une remise mais ne l'applique pas encore à une vente/ticket précis. | 🟡 | `backoffice-discounts/` | Ouvert |

| TD-081-MOVEMENT | `createSale` décrémente le stock en SQL brut sans écrire de `stock_movement` ni déclencher d'alerte (n'appelle pas `stockService`). Pas de journal de mouvement à la vente. | 🟠 | `sales.service.ts` L596 | Ouvert |
| TD-082-MOVEMENT | `returns.service` restocke (`+qty`) sans ligne `stock_movement`. | 🟠 | `returns.service.ts` L189 | Ouvert |
| TD-083-BASELINE | ~~Alerte "20%" sans baseline~~. **Résolu** : décision « 20% d'un par/max » → colonne `stock_baseline_quantity` + migration `1721000000000` + `effectiveAlertThreshold` branché (getAlerts/decrementStock). Reste : test runtime + exécuter la migration en local. | 🟡 | `product.entity.ts`, migration `1721000000000`, `stock.service.ts` | Implémenté — runtime/migration à valider local |
| TD-066-SKU | Pas de champ SKU (seul EAN existe). Dédup nom/EAN OK ; SKU n/a. | 🟡 | `product.entity.ts`, `products.service.ts` | Ouvert |
| TD-STOCK-TWO-SYSTEMS | **Deux systèmes de stock parallèles** : (1) `products.stockQuantity` (clé magasin) utilisé par `createSale`/`returns`/`stock.service` ; (2) journal canonique `stock_movements`+`stock_balance` (clé `stock_locations`) utilisé seulement par `stock-locations`. Le commentaire de `stock_movements` prétend que les ventes sont « auto-created by SalesService » → **FAUX**. Brancher POS-081/082 (journal mouvement à la vente/retour) exige d'unifier les deux systèmes (mapping magasin→location). | 🔴 | `sales.service.ts`, `stock-movement.entity.ts`, `stock-locations` | **Décision d'architecture non tranchée — GATE** (non exécuté). Voir dossier ci-dessous. |

| TD-017-SESSION-LINK | Pas de lien vente↔session POS : impossible d'agréger les ventes cash d'une session pour le comptage sans ce lien. | 🟠 | `sale.entity.ts` (pas de `pos_session_id`), `pos-session` | Ouvert (préalable POS-017b) |

| TD-073-USAGE-LIMIT | ~~Pas de champ usage~~. **Résolu (exclusion)** : `usage_limit`/`usage_count` (migration 1724) + `getActivePromos` exclut les promos au plafond. Tests 14/14. | ✅ | `promo-rule.entity.ts`, migration 1724, `promotions.service.ts` | Résolu (exclusion) |
| TD-073-USAGE-INCREMENT | L'incrément de `usage_count` à chaque application de promo n'est pas câblé (write money-path, à tester local). Sans lui, le plafond ne décompte pas. | 🟠 | `sales.service.createSale` / `applyPromos` | Ouvert |
| TD-073-STACKING | ~~Cumul promos~~. **Résolu** : `applyPromos` retourne `dedupeBestPerProduct` (anti-cumul). Prouvé par `promotions.service.spec` **11/11** (test anti-stacking inclus), exécuté en sandbox. | ✅ | `promotions.service.applyPromos`, `promo-policy.ts` | Résolu |
| TD-018-FILTERS-RUNTIME | Filtres historique ventes (employeeId/from/to/status) ajoutés + tsc clean, mais non testés runtime ici (DB). | 🟡 | `sales.service.findByStore`, `sales.controller` | À valider local |

| TD-TAX-DUP | Deux formules TVA : `sales/tax.ts` (gross×r/(100+r), liée au hash fiscal) vs `shared/utils/money.ts#extractTax` (net-first). Peuvent différer de 1 centime en cas-limite. Réconciliation = décision fiscale (ne PAS changer le hash sans procédure). | 🟡 | `sales/tax.ts`, `shared/utils/money.ts` | Ouvert — décision fiscale |

| TD-AUDIT-HASH-DUP | Deux copies de la formule de hash audit : `audit/audit-hash.ts` (backend, utilisée) et `shared/utils/hash.ts#createAuditHash` (non importée par le backend). Identiques aujourd'hui ; risque de dérive. Le backend n'importe pas `@caisse/shared` → unification = décision build. | 🟡 | `audit/audit-hash.ts`, `shared/utils/hash.ts` | Ouvert |

| TD-066-NAME-WIRING | ~~Helper non branché~~. **Résolu** : dédup nom normalisé branchée dans `products.service.create` (+ colonne `normalized_name` migration 1722, sync update). Tests `products.service.spec` 7/7. | ✅ | `products.service.ts`, migration 1722 | Résolu |
| TD-066-LEGACY-BACKFILL | Backfill migration 1722 = `lower(trim(name))` (accents non repliés pour les lignes héritées). Un script one-off appliquant `normalizeName()` aux lignes existantes reste à faire pour une dédup accent-insensible rétroactive. | 🟡 | migration 1722, `name-normalize.ts` | Ouvert |

| TD-061-OVERRIDE | ~~Pas de mécanisme override~~. **Résolu** : colonne `price_override_minor_units` (migration 1723) + `resolveEffectivePrice` (override>global) branché dans `createSale`. Tests 4/4. Reste : UI back-office pour saisir l'override (`TD-061-UI`). | ✅ | `product.entity.ts`, migration 1723, `price-resolve.ts` | Résolu (UI à faire) |

| TD-055-QUIET-HOURS-WIRING | Helper quiet-hours/fériés testé mais non branché dans le sweep `shift-reminders` (fenêtre + calendrier fériés = config/décision). | 🟡 | `shift-reminders/quiet-hours.ts`, `shift-reminder.service.ts` | Ouvert |

| TD-094-FREQ-ENDPOINT | ~~Endpoint non livré~~. **Résolu (PAQUET 36)** : `GET /api/customer-visits/:customerId/frequency` (JwtAuthGuard+RolesGuard `manager` fail-closed) + anti-IDOR `canAccessCustomer` (4/4, customer hors store → Forbidden, admin bypass) + `getFrequencySecured`. tsc clean. Runtime DB à valider local. | ✅ | `customer-visits.controller.ts`, `customer-access.ts`, `customer-visits.service.ts` | Résolu |
| TD-VISIT-SEGMENT-THRESHOLDS | Seuils segment `new/regular/occasional/at_risk` = **défauts provisoires à ratifier** (décision produit). Vérifié : `segment` **non consommé** pour piloter un comportement (reporting-only). Ne PAS l'utiliser pour fidélité/relance sans ratification. | 🟡 | `customer-visits/visit-frequency.ts` | Ouvert — à ratifier |
| TD-GIT-DANGLING | Paquets 2→35 **non commités sur branche** : working tree (source de vérité) + commits **pendants** non référencés (FUSE bloque `index.lock`/`HEAD.lock`). Branche = `c55e6c5` (PAQUET 1). | 🔴 | `git status`/`reflog` (cf. GIT_RECOVERY.md) | Ouvert — résoudre en local AVANT tout nouveau paquet |

## Règle

Chaque nouvelle dette détectée pendant un paquet est ajoutée ici avec ID, preuve, sévérité, statut.
