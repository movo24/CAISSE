# TECHNICAL_DEBT.md — Dette technique (vérifié 2026-06-28)

> Honnêteté : un item reste ouvert tant qu'il n'est pas prouvé résolu (commit + test).

| ID | Dette | Sévérité | Preuve / Localisation | Statut |
|---|---|---|---|---|
| TD-INT-RELAY | Publication outbox HTTP réelle vers Comptamax/TimeWin/Analytik R | 🟡 | `outbox-publisher.ts` (HttpOutboxPublisher + factory env-gated) ; mécaniques POST+HMAC prouvées loopback `outbox-publisher.spec.ts` 5 tests (P171) | Gated — fournir `OUTBOX_PUBLISH_URL`+`OUTBOX_PUBLISH_SECRET` puis `OUTBOX_RELAY_ENABLED=true` (secrets, hors sandbox) |
| MIGRATION-1725 | Table `integration_events` non créée en base cible | 🟡 | SQL up()/down() prouvé sur pg-mem `migration-1725-outbox.spec.ts` 3 tests (P176) + parité entité 17 col (P177) | Gated — `migration:run` sur base cible (Postgres, non-root en sandbox) |
| TD-FRONT-INVENTORY-VARIANCE | Écran écart d'inventaire (comptage physique vs système) absent/mort | 🟡 | helper `stock-variance.ts` (5 tests) + `POST /stock/variance` + `InventoryVariancePage.tsx` routée/nav | ✅ RÉSOLU P153/155 (commits f28fded→4dd79e3) |
| TD-FE-OFFLINE-DISCOUNT | Remise responsable hors-ligne (PIN serveur invérifiable) | 🟡 | arbitrage : `manual-discount-guard.ts` (bloque offline) câblé POSPage (bouton + garde vente) | ✅ RÉSOLU P159 (commit 7938cb6) — décision : interdire hors-ligne |
| TD-FE-ROLLUP-NATIVE | Build/vitest front non exécutables en sandbox (binaire natif rollup) | 🟢 | binaire `@rollup/rollup-linux-arm64-gnu` installé (P169) → vitest **42 tests PASS** (backoffice 19 + pos 23) + `vite build` **2× verts** (backoffice 1988 / pos 2082 modules) + steps CI (P166) | ✅ RÉSOLU P169 — gate prouvé exécutable (sandbox + CI) |
| TD-DOC-DRIFT | CLAUDE.md sous-compte modules (37→40), entités (45→47), migrations (11→16), tests (405→~488) | 🟠 | comparaison audit vs CLAUDE.md | Ouvert |
| TD-API-MAP | Détail méthode/payload/erreurs/rôle par route | 🟠 | `POS_API_MAP.md` | ✅ RÉSOLU P289 — `POS_API_MAP_DETAILED.md` généré depuis le code (42 controllers/230 routes, guards+rôles+tenant+DTO) via `npm run api:map` |
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
| TD-RESP-PIN | Anti-bruteforce PIN responsable | 🟠 | `sales/pin-attempt-limiter.ts` | ✅ RÉSOLU P316 — verrou par magasin (5 échecs → 15 min, fail-closed sans bcrypt pendant le verrou, succès = reset, 4 tests). Limite honnête : in-memory (mono-instance, posture ALLOW_INMEMORY_CACHE) |
| TD-054D-TERMINAL | `createSale` ne reçoit pas le terminal/caisse id → absent de l'audit remise. | 🟡 | `sales.service.ts`, `sales.controller.ts`, `pos-session` | Ouvert |
| TD-054E-APPLY | Endpoint back-office autorise/audite une remise mais ne l'applique pas encore à une vente/ticket précis. | 🟡 | `backoffice-discounts/` | Ouvert |

| TD-081-MOVEMENT | `createSale` décrémente le stock en SQL brut sans écrire de `stock_movement` ni déclencher d'alerte (n'appelle pas `stockService`). Pas de journal de mouvement à la vente. | 🟠 | `sales.service.ts` L596 | Ouvert |
| TD-082-MOVEMENT | `returns.service` restocke (`+qty`) sans ligne `stock_movement`. | 🟠 | `returns.service.ts` L189 | Ouvert |
| TD-083-BASELINE | ~~Alerte "20%" sans baseline~~. **Résolu** : décision « 20% d'un par/max » → colonne `stock_baseline_quantity` + migration `1721000000000` + `effectiveAlertThreshold` branché (getAlerts/decrementStock). Reste : test runtime + exécuter la migration en local. | 🟡 | `product.entity.ts`, migration `1721000000000`, `stock.service.ts` | Implémenté — runtime/migration à valider local |
| TD-066-SKU | Pas de champ SKU (seul EAN existe). Dédup nom/EAN OK ; SKU n/a. | 🟡 | `product.entity.ts`, `products.service.ts` | Ouvert |
| TD-STOCK-TWO-SYSTEMS | **Deux systèmes de stock parallèles** : (1) `products.stockQuantity` (clé magasin) utilisé par `createSale`/`returns`/`stock.service` ; (2) journal canonique `stock_movements`+`stock_balance` (clé `stock_locations`) utilisé seulement par `stock-locations`. Le commentaire de `stock_movements` prétend que les ventes sont « auto-created by SalesService » → **FAUX**. Brancher POS-081/082 exigeait d'unifier. | 🔴 | `stock-movement-journal.ts` | ✅ RÉSOLU P306 (GO option 1) — journal append-only alimenté par les 5 chemins (vente, retour, ajustement, apply inventaire, sync offline), même transaction, location magasin paresseuse, balance = projection reconstruite (`journalNetQuantities`) ; preuves pg-mem + e2e |

| TD-017-SESSION-LINK | Lien vente↔session POS | 🟠 | migration 1726, `sales.service`, `pos-session` | ✅ RÉSOLU P312 — colonne `pos_session_id` nullable (migration 1726, additive/réversible, NON jouée sur cible = même gate que 1725) ; stamp best-effort dans createSale (session active du (store,terminal), jamais bloquant, hors empreinte fiscale) ; `GET /api/pos-sessions/:id/cash-summary` (ventes complétées stampées : count, cash, total) ; prouvé e2e 10/10 |

| TD-073-USAGE-LIMIT | ~~Pas de champ usage~~. **Résolu (exclusion)** : `usage_limit`/`usage_count` (migration 1724) + `getActivePromos` exclut les promos au plafond. Tests 14/14. | ✅ | `promo-rule.entity.ts`, migration 1724, `promotions.service.ts` | Résolu (exclusion) |
| TD-073-USAGE-INCREMENT | Incrément `usage_count` à l'application d'une promo | 🟠 | `sales.service.createSale` | ✅ RÉSOLU P297 — UPDATE atomique dans la transaction de vente (1 usage/promo/vente, ids distincts, tenant-scoped) ; prouvé e2e : cap 1 → vente 1 remisée + count 0→1, vente 2 plein tarif + count reste 1 |
| TD-073-STACKING | ~~Cumul promos~~. **Résolu** : `applyPromos` retourne `dedupeBestPerProduct` (anti-cumul). Prouvé par `promotions.service.spec` **11/11** (test anti-stacking inclus), exécuté en sandbox. | ✅ | `promotions.service.applyPromos`, `promo-policy.ts` | Résolu |
| TD-018-FILTERS-RUNTIME | Filtres historique ventes | 🟡 | `sales-history-filters.pgmem.spec.ts` | ✅ RÉSOLU P315 — prouvés sur SQL réel (tenant, tri DESC, employeeId, bornes from/to inclusives, status, combinaison AND) — 4 tests pg-mem |

| TD-TAX-DUP | Deux formules TVA : `sales/tax.ts` (gross×r/(100+r), liée au hash fiscal) vs `shared/utils/money.ts#extractTax` (net-first). Peuvent différer de 1 centime en cas-limite. Réconciliation = décision fiscale (ne PAS changer le hash sans procédure). | 🟡 | `sales/tax.ts`, `shared/utils/money.ts` | Ouvert — décision fiscale |

| TD-AUDIT-HASH-DUP | Deux copies de la formule de hash audit : `audit/audit-hash.ts` (backend, utilisée) et `shared/utils/hash.ts#createAuditHash` (non importée par le backend). Identiques, et désormais VERROUILLÉES : `audit-hash-drift-guard.spec.ts` (P314, 8 tests adversariaux) échoue à la première dérive. Unification physique = décision build (inchangé). | 🟡 | `audit/audit-hash.ts`, `shared/utils/hash.ts` | 🔒 Risque neutralisé P314 (guard) — unification reste ouverte |

| TD-066-NAME-WIRING | ~~Helper non branché~~. **Résolu** : dédup nom normalisé branchée dans `products.service.create` (+ colonne `normalized_name` migration 1722, sync update). Tests `products.service.spec` 7/7. | ✅ | `products.service.ts`, migration 1722 | Résolu |
| TD-066-LEGACY-BACKFILL | Backfill accent-insensible des lignes héritées 1722 | 🟡 | `scripts/backfill-normalized-names.ts` | ✅ RÉSOLU P309 (script livré, prouvé pg-mem 2 tests : plan+apply idempotent, collisions même-magasin QUARANTAINÉES pour arbitrage humain, jamais fusion silencieuse ; dry-run par défaut, `BACKFILL_APPLY=true` pour appliquer) — exécution base cible = gated DATABASE_URL+GO |

| TD-061-OVERRIDE | ~~Pas de mécanisme override~~. **Résolu** : colonne `price_override_minor_units` (migration 1723) + `resolveEffectivePrice` (override>global) branché dans `createSale`. Tests 4/4. UI back-office livrée P310 (champ override en édition, vide = prix global, null explicite pour effacer). | ✅ | `product.entity.ts`, migration 1723, `price-resolve.ts` | Résolu (UI à faire) |

| TD-055-QUIET-HOURS-WIRING | Helper quiet-hours/fériés branché dans le sweep | 🟡 | `shift-reminders/` | ✅ RÉSOLU P292 — câblé en pure config env (fenêtre vide par défaut = zéro changement sans config), 4 tests de wiring (suppression fenêtre/férié, défaut jamais supprimé, sweep supprimé n appelle même pas TW24) |

| TD-094-FREQ-ENDPOINT | ~~Endpoint non livré~~. **Résolu (PAQUET 36)** : `GET /api/customer-visits/:customerId/frequency` (JwtAuthGuard+RolesGuard `manager` fail-closed) + anti-IDOR `canAccessCustomer` (4/4, customer hors store → Forbidden, admin bypass) + `getFrequencySecured`. tsc clean. Runtime DB à valider local. | ✅ | `customer-visits.controller.ts`, `customer-access.ts`, `customer-visits.service.ts` | Résolu |
| TD-VISIT-SEGMENT-THRESHOLDS | Seuils segment `new/regular/occasional/at_risk` = **défauts provisoires à ratifier** (décision produit). Vérifié : `segment` **non consommé** pour piloter un comportement (reporting-only). Ne PAS l'utiliser pour fidélité/relance sans ratification. | 🟡 | `customer-visits/visit-frequency.ts` | Ouvert — à ratifier |
| TD-GIT-DANGLING | Refs git bloquées (FUSE) | 🔴 | GIT_RECOVERY.md | ✅ RÉSOLU P272 — locks supprimés, historique restauré du bundle sur `recovery/pos-audit-session`, commits normaux depuis ; GIT_RECOVERY.md conservé comme historique |

## Dette résolue (traçabilité)

| ID | Item | Résolution |
|---|---|---|
| TD-DEAD-PERMISSIONS | `common/guards/permissions.ts` = code mort (hasMinRole/ROLE_HIERARCHY dupliquant role-hierarchy.ts, importé par personne) | ✅ Supprimé P192 ; matrice de permissions préservée dans `role-hierarchy.ts` ; source de vérité unique pour la hiérarchie de rôles. Non-régression P193 (155 suites/1080 tests, 0 impact). |
| TD-FE-DEAD-SWITCHERS | `StoreSwitcher.tsx` (supplanté par le Scope Switcher inline du Layout) + `AppSwitcher.tsx` (bascule pos/timewin24 hors périmètre back-office) = composants morts jamais montés | ✅ Supprimés P196 ; tsc EXIT 0 + vitest 19, 0 impact. |
| TD-FE-ORPHAN-UTIL | `utils/safeErrorMessage.ts` = util anti-crash React #310 inutilisé | ✅ Branché P197 dans ProductsPage + ConnectedAppsPage + testé (4 tests) ; passe d'orphelin à utilisé. |

## Règle

Chaque nouvelle dette détectée pendant un paquet est ajoutée ici avec ID, preuve, sévérité, statut.
| TD-PRODUCT-VARIANTS | Variantes produit (déclinaisons SKU : taille/parfum/format) — la règle produit dit « variantes OUI » mais AUCUN modèle de variante n'existe (seul `unit_type` unit/weight). Vérifié P290 : zéro entité/colonne/écran variante. | 🟠 | `product.entity.ts` | ✅ RÉSOLU P327 (GO option A) — migration 1727 (4 colonnes nullables + table suppliers, dry-run pg-mem), module suppliers (CRUD tenant, nom unique/magasin, soft-delete), DTOs produits étendus, champs marque/variante au back-office, doublons couverts par l unique (ean,store) PAR variante ; reste UI : sélecteur fournisseur + regroupement visuel parent (client API prêt) |

## TD-DEAD-UPDATESTOCK (P339)
`products.service.updateStock` n'a aucun appelant (grep src, hors définition). Ni audité ni exposé. À supprimer lors d'un prochain nettoyage volontaire (pas de suppression opportuniste en cycle audit).

## TD-054D-TERMINAL — CLOS (P349)
Voir EXECUTION_LOG PAQUET 349.

## TD-055-QUIET-HOURS-WIRING — CLOS (P349)
Voir EXECUTION_LOG PAQUET 349.

## TD-042-EXECUTOR (P352)
Exécuteur de capture différée au retour réseau (consomme les ordres `card_deferred_capture` de la file offline → stripe-terminal avec la clé déterministe → `settleDeferredCapture`) + câblage UI usePayment. Nécessite un TPE réel pour la preuve de bout en bout — le moteur de décision/issue est déjà prouvé (12/12).
