# POS_BLOCKS.md — Registre numéroté des blocs (vérifié 2026-06-28)

> Statut : ✅ Fait · 🔄 En cours · ⬜ À faire · ⚠️ À vérifier · ⛔ Bloqué réel
> Priorité : P0 (intégrité/sécurité/caisse) · P1 (cœur métier) · P2 (confort) · P3 (futur)
> **Honnêteté** : "⚠️ À vérifier" = le code existe mais n'est pas prouvé branché/testé ici. Aucun bloc n'est ✅ sans preuve (commit + test vert).

## Gouvernance (PAQUET 1 — en cours)

| # | Titre | Statut | Prio | Fichiers/preuve | Dépend. |
|---|---|---|---|---|---|
| POS-001 | Audit global read-only | ✅ | P0 | `PROJECT_STATUS.md` (faits vérifiés) | — |
| POS-002 | 12 fichiers de pilotage | 🔄 | P0 | les 12 `.md` racine | 001 |
| POS-003 | Registre des blocs numéroté | 🔄 | P0 | ce fichier | 001 |
| POS-004 | Aligner CLAUDE.md sur le réel (drift) | ⬜ | P1 | `CLAUDE.md` vs audit | 001 |
| POS-005 | EXECUTION_LOG + cadence paquets | 🔄 | P0 | `EXECUTION_LOG.md` | 002 |

## Socle POS desktop

| # | Titre | Statut | Prio | Localisation | Critère d'acceptation |
|---|---|---|---|---|---|
| POS-010 | App desktop Electron + dual-window | ⚠️ | P0 | `pos-desktop/src/main/*`, `ClientDisplayPage` | Lance POS + écran client |
| POS-011 | Écran caisse principal | ⚠️ | P0 | `POSPage.tsx`, `components/pos`, `ipad` | Saisie articles OK |
| POS-012 | Écran panier | ⚠️ | P0 | `useCart.ts`, layout | Ajout/retrait/qté |
| POS-013 | Écran paiement | ⚠️ | P0 | `usePayment.ts` | Choix moyen + validation |
| POS-014 | Écran/édition ticket | ⚠️ | P0 | `receipts`, `useBluetoothPrinter` | Ticket émis après paiement |
| POS-015 | Écran retour / annulation | ⚠️ | P0 | `ReturnModal.tsx`, `returns` | Avoir généré, NF525 OK |
| POS-016 | Ouverture / fermeture caisse | 🟡 (session OK, fond de caisse absent) | P0 | `pos-session` open/close terminal-bound (vérifié) ; **pas de fond de caisse/float** ni lien session↔ventes. Voir POS-017b. |
| POS-017 | Comptage espèces (midi + fermeture) | 🟡 cœur testé, wiring à faire | P1 | `pos-session/cash-count.ts` (`countCash`, `reconcileCash`) tests **8/8**. Persistance/endpoints = POS-017b. |
| POS-017b | Câblage comptage : champs session (float/counted/variance) + migration + endpoints + lien session↔ventes cash | ⬜ | P1 | `pos-session.entity`, migration, `pos-session.service` — nécessite lien vente↔session (absent aujourd'hui) → `TD-017-SESSION-LINK` |
| POS-018 | Historique ventes | ✅ filtres + DTO validé | P1 | `GET /api/sales` : page/limit/date + employeeId/from/to/status (`findByStore`). **POS-018b** : `ListSalesQueryDto` validé (types/bornes, limit≤100, UUID) câblé — spec 4/4. Admin cross-store. Runtime DB local. |
| POS-019 | Paramètres terminal | ⚠️ | P2 | `terminals`, `useDeviceProfile` | Config persistée |
| POS-020 | État connexion / mode dégradé | ⚠️ | P0 | `useOfflineMode`, `offlineStore` | Bascule offline visible |

## Matériel caisse

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-030 | Scanner code-barres | ⚠️ | P1 | `useScannerZXing`, `useBluetoothScanner` |
| POS-031 | Imprimante ESC/POS | ⚠️ | P1 | `useBluetoothPrinter` |
| POS-032 | Lecteur QR | ⚠️ | P2 | ZXing |
| POS-033 | TPE Stripe Terminal WisePad 3 | 🟡 idempotence PI testée ; paiement réel non testé | P0 | `stripe-terminal.service` + `payment-intent-key.ts` (clé idempotence déterministe, anti double-charge) **5/5** + régression service 4/4. POS hook `useStripeTerminal`. Paiement live interdit/non testé. |
| POS-034 | Passerelle mobile paiement iOS/Android | ⬜ | P2 | à définir |
| POS-035 | Gestion erreurs périphériques + reconnexion | ⚠️ | P1 | hooks HW |
| POS-036 | Réimpression ticket | ⚠️ | P2 | `receipts` |
| POS-037 | Tests matériel simulé (mocks) | ⬜ | P1 | à créer |

## Paiements

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-040 | Espèces (+ monnaie rendue) | ✅ testé | P0 | `sale-payment` + `payment-policy.validatePayments` (`changeMinorUnits`) — 7/7 |
| POS-041 | Carte / Stripe Terminal | 🟡 idempotence PI testée | P0 | `stripe-terminal` ; clé idempotence PaymentIntent testée (anti double-charge) ; tenant ownership check. Paiement réel non testé. |
| POS-042 | Paiement différé/offline carte | ⬜ | P1 | `POS_PAYMENT_STRATEGY.md` |
| POS-043 | Store credit / avoir | ✅ cap résiduel + DTO corrigé | P1 | `payment-policy` (avoir ≤ reste dû) testé. **Bug corrigé** : `SalePaymentDto` acceptait pas `store_credit` (rejet ValidationPipe) → `PAYMENT_METHODS` (incl. `store_credit`) + champ `creditNoteCode`. Specs 7/7. |
| POS-044 | Paiements mixtes | ✅ testé | P1 | `sale-payment` (multi) + `validatePayments` (cash+card+avoir) — testé |
| POS-045 | Annulation paiement | ✅ garde void cash (cf POS-052) | P0 | void interdit sur leg cash réalisé → passe par retour ; testé (voidSale guard) |
| POS-046 | Remboursement | ✅ math extrait+testé, régression OK | P1 | `returns.service` + `returns-policy.ts` (`returnableQuantity`, `computeLineRefund` proportionnel) — `returns-policy` 7/7 + `returns.service.spec` **17/17 sans régression** |
| POS-047 | Idempotence stricte (double paiement interdit) | ✅(code) ⚠️(test local) | P0 | `sales.service.ts` L176-184 replay + L350-355 in-tx + L509-519 persist même tx + expiry 7j + ConflictException |
| POS-048 | Cohérence paiement ≥ total avant finalisation | ✅ branché+testé | P0 | extrait en `payment-policy.validatePayments` (pur, **7/7**), appelé dans `createSale` (messages identiques → comportement préservé ; mapping BadRequestException). |
| POS-049 | Synchro paiement cloud | ⚠️ | P1 | `sync` |

## Règles caisse

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-050 | Sessions liées `(store_id, terminal_id)` | ⚠️ | P0 | `pos-session`, migration `1719...TerminalId` |
| POS-051 | Interdiction doublons sessions/ventes | ⚠️ | P0 | `idempotency-key` |
| POS-052 | Garde annulation espèces | ✅(code) ⚠️(test local) | P0 | `sales.service.ts` voidSale L948-965 (`cashRealized` → ConflictException) + limite void manager 500€ L916-927 |
| POS-053 | Remises internes interdites sauf code responsable | ⬜ | P1 | `sales-guards` |
| POS-054 | Politique remise (caisse 30% strict / justif 21-30% / back-office 100% admin) — **moteur pur** | ✅ code+test (14/14 vérifié) | P0 | `sales/discount-policy.ts` + `discount-policy.spec.ts` (matrice produit complète, exécutée verte dans le sandbox) |
| POS-054b | Câblage caisse : champs DTO (`manualDiscountMinorUnits`, `responsablePin`, `discountJustification`) + appel politique + distribution sur lignes (TVA cohérente) dans `createSale` | ✅ codé+branché, **tsc clean** ; ⚠️ test runtime vente à exécuter localement | P0 | `common/dto/sales.dto.ts`, `sales.service.ts` (bloc avant calcul totaux). N'altère PAS les promotions. |
| POS-054c | Vérification réelle du code responsable | ✅ branché (réel) | P0 | `sales.service.verifyResponsablePin` : PIN employé `manager`/`admin` (bcrypt `pin_hash`) du magasin. Pas de nouveau secret. Dette : rate-limit/lockout (`TD-RESP-PIN`). |
| POS-054d | Persistance audit remise (append-only) | ✅ branché (audit_entry) ; ⚠️ terminal id non threadé | P0 | `auditService.log` actions `manual_discount_applied` / `manual_discount_blocked` (caissier, responsable, %, motif, ticket, magasin). **Pas de migration** (audit_entry existant, hash-chain). Terminal id absent de `createSale` → `TD-054D-TERMINAL`. |
| POS-054e | Endpoint remise back-office (≤100%, admin only, motif+validateur+audit) | ✅ codé+branché+testé (5/5) | P1 | nouveau module `backoffice-discounts` : `POST /api/backoffice/discounts/authorize` (`@Roles('admin')`). Jamais 100% depuis caisse (channel séparé). Application à une vente = follow-up `TD-054E-APPLY`. |
| POS-055 | Jours fériés paramétrables + quiet hours alertes | 🟡 helper testé, non branché | P2 | `shift-reminders/quiet-hours.ts` (`isQuietHour` wrap-midnight, `isHoliday`) **5/5**. Câblage sweep + fenêtre/calendrier = `TD-055-QUIET-HOURS-WIRING`. |
| POS-056 | Audit log actions sensibles, aucune suppression silencieuse | ✅ primitives testées | P0 | `audit/audit-hash.ts` (`computeAuditHash`+`verifyAuditChain`) extrait+testé **8/8** ; `audit.service` refactor behavior-preserving (controller spec 6/6) ; entité append-only. Dup `shared.createAuditHash` → `TD-AUDIT-HASH-DUP`. |

## Produits / catalogue

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-060 | Produit parent + variantes/SKU | ⚠️ | P1 | `product`, `product-*` |
| POS-061 | Prix par magasin + override | ✅ override branché+testé | P1 | Prix par magasin (lignes scopées `storeId`) + **override prioritaire** : colonne `price_override_minor_units` (migration `1723`, nullable) + `resolveEffectivePrice` (override>global) **testé 4/4** + branché dans `createSale` (prix ligne effectif). Override NULL → prix global (aucun changement). |
| POS-062 | Marque / fournisseur / catégories / images | ⚠️ | P2 | `product-category`, `product` |
| POS-063 | TVA / prix TTC | ✅ extraction testée+branchée | P0 | `sales/tax.ts` (`extractLineTax`/`sumLineTax`) — **6/6** dont test-propriété = formule fiscale inline (hash-safe). Branché dans `createSale`. Doublon `shared.extractTax` (arrondi net-first) → `TD-TAX-DUP`. |
| POS-064 | Statut actif/inactif | ⚠️ | P2 | `product` |
| POS-065 | Import/export catalogue | ✅ (P340) | P2 | Export CSV back-office existant + **import** `POST /api/products/import` (dry-run par défaut, doublons EAN/nom in-file+magasin refusés, fournisseur par nom sans création implicite, cap 2000, audit synthétique) — validation pure 5/5 + preuves pg-mem. |
| POS-066 | Anti-doublons SKU/EAN/nom normalisé | ✅ branché+testé | P1 | EAN : index unique `(ean,storeId)`. Nom : **dédup branchée** dans `products.service.create` (même nom normalisé/même magasin → ConflictException) + colonne `normalized_name` (migration `1722`) + sync sur update. `name-normalize` 6/6 + `products.service.spec` dédup **7/7**. Legacy backfill accents = `TD-066-LEGACY-BACKFILL`. Pas de SKU → `TD-066-SKU`. |

## Promotions / remises

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-070 | Codes promo + fenêtre validité | ✅ validité+coupons testés | P1 | promos : `getActivePromos`+`isPromoActive`. Coupons : `coupon-policy.ts` (idempotency-key, dispo, expiry, cooldown) **7/7** + `coupon.service` redeem refactor (régression **6/6**), idempotence en transaction. |
| POS-071 | Scope magasin/produit/cat + limite d'usage | ✅ scope + plafond (exclusion) | P1 | Scope produit/catégorie + hors-portée ✅ ; **plafond d'usage** : colonnes `usage_limit`/`usage_count` (migration `1724`) + `isUsageLimitReached` testé + `getActivePromos` exclut les promos au plafond (`promotions.service.spec` **14/14**). Increment à l'application = `TD-073-USAGE-INCREMENT`. |
| POS-072 | Traçabilité usage | 🟡 coupons OK | P1 | Coupons : redemption + idempotency tracés. `promo_rule` : pas de compteur d'usage (lié `TD-073-USAGE-LIMIT`). |
| POS-073 | Refus auto (expirée / plafond / doublon) | 🟡 expiry+anti-cumul OK ; plafond manquant | P0 | **Expirée** ✅ `getActivePromos`+`isPromoActive`. **Doublon/cumul** ✅ **branché+testé** : `applyPromos` retourne `dedupeBestPerProduct` (service spec **11/11**, dont test anti-stacking). **Plafond usage** ❌ pas de champ `promo_rule` → `TD-073-USAGE-LIMIT`. Coupons idempotents (séparé). |

## Stock

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-080 | Stock par magasin | ✅ (vérifié) | P0 | `product.stockQuantity` + index unique `(ean, storeId)` ; helper testé `stock/stock-level.ts` (7/7) |
| POS-081 | Mouvement stock à chaque vente | ⚠️ ÉCART | P0 | `createSale` décrémente en SQL brut (L596) **sans** écrire de `stock_movement` ni déclencher d'alerte (il n'appelle PAS `stockService`). → `TD-081-MOVEMENT` |
| POS-082 | Retour stock si annulation/remboursement | 🟡 partiel | P0 | `returns.service` restock OK (L189 `+qty`) mais **sans** ligne `stock_movement`. → `TD-082-MOVEMENT` |
| POS-081b | Unifier les 2 systèmes de stock (store `stockQuantity` ↔ journal `stock_movements` location-keyed) | ⛔ DÉCISION ARCHI | P1 | **GATE** : brancher le journal mouvement à la vente exige de décider du mapping magasin→location. Voir `TD-STOCK-TWO-SYSTEMS` + dossier `EXECUTION_LOG` PAQUET 7. Non exécuté. |
| POS-083 | Alerte stock bas (20% d'une baseline par/max) | ✅ branché + migration réversible ; ⚠️ test runtime/migration en local ; alertes pas sur voie vente (cf POS-081) | P1 | Décision produit : 20% d'un par/max. `product.stockBaselineQuantity` + migration `1721000000000-AddStockBaseline` (additive/nullable, `down` DROP). `effectiveAlertThreshold` (tests 9/9) branché dans `getAlerts` (SQL COALESCE) + `decrementStock`. Fallback seuil absolu si baseline NULL (aucun changement existant). |
| POS-084 | Vérif physique obligatoire avant correction + trace | ⚠️ | P1 | `inventory-scan` |
| POS-085 | Inventaire / écart stock | ✅ ajustement+variance testés | P1 | `inventory-scan/inventory-adjust.ts` (`applyStockAdjustment` delta/absolute, `inventoryVariance`) **7/7** + branché dans `applyScansToStock`. UI `InventoryVariancePage` (non commité). |
| POS-086 | Synchro cloud + cohérence offline/online | 🟡 résolution conflit testée | P1 | `sync/conflict.ts` (`isServerNewerThanSync`, `resolveCustomerSync` server-wins) **7/7** + branché `sync.push` (régression `sync.service.spec` OK). Ventes dédupliquées par idempotence. Cohérence stock offline = lié `TD-STOCK-TWO-SYSTEMS`. |

## Employés / planning / paie

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-090 | Employés / rôles / permissions | ✅ hiérarchie testée | P0 | `employees` (CRUD+PIN) ; `roles.guard` refactor → `role-hierarchy.ts` (`roleSatisfies`) testé **9/9**, comportement préservé (admin>manager>cashier) |
| POS-091 | Binding employé ↔ session POS | ✅ (vérifié) | P0 | `pos-session` porte `employeeId`+`terminalId` (1 session active/(store,terminal)) ; `employee-store-access` pour l'accès multi-magasin |
| POS-092 | TimeWin24 (HR source of truth) | 🟡 service + helpers testés ; live non testé | P1 | `timewin.service` (login/sync/shifts/payroll/clock/pushEvent). **Auth HMAC** extraite+testée `pos-hmac.ts` (5/5) ; **mapping employés** `employee-map.ts` (3/3) ; circuit breaker. Connectivité TW24 réelle **non testée** ici (réseau). |
| POS-093 | Paywin24 paie (heures travaillées) | ⛔ | P1 | aucune réf code — à créer |
| POS-094 | Ventes par employé + actions sensibles tracées | ✅ endpoint + agrégateur testé | P1 | `GET /api/reports/sales-by-employee` (admin/manager) → `reports.service.getSalesByEmployee` → `aggregateSalesByEmployee` **4/4** + régression service OK. Actions sensibles déjà auditées (`audit` + `manual_discount_*`, `voidSale`). |

## Comptabilité / pré-compta

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-100 | Exports ventes/paiements/TVA/caisse/espèces/remboursements | 🟡 export local OK, envoi externe ⛔ | P1 | `reports/accounting-export.ts` (`buildDailyAccountingExport` TTC/HT/TVA/cash/card/autres/remise + `toAccountingCsv`) **5/5** + endpoint `GET /api/reports/accounting-export?format=csv\|json` (depuis Z-report figé, admin/manager). Envoi **Comptamax24** = `TD-COMPTAMAX` (externe, non branché). |
| POS-101 | Comptamax24 (API/événement) | ⛔ | P1 | aucune réf code — à créer |
| POS-102 | Rapprochement paiements + pièces justificatives | 🟡 rapprochement OK | P1 | `reports/payments-breakdown.ts` (`aggregatePaymentsByMethod` count/total/méthode) **3/3** + endpoint `GET /api/reports/payments-breakdown` (admin/manager). Pièces justificatives = follow-up. |

## Supervision mobile

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-110 | Cockpit mobile lecture seule | 🟡 backend livré, UI à faire | P1 | endpoint backend `mobile-cockpit` créé ; UI `packages/mobile` à brancher |
| POS-111 | `GET /api/mobile/v1/alerts` | ✅ créé (tsc clean) ; ⚠️ runtime local | P1 | `mobile-cockpit.controller` (`GET /api/mobile/v1/alerts`) + service + shaper testé (cockpit 6/6). Garde **employé JWT + manager** (pas customer token). |
| POS-112 | Alertes (caisse/stock/paiement/fermeture/anomalies) | 🟡 stock+anomalies OK | P1 | agrège `stockService.getAlerts` + `sale_anomaly_logs` (status detected). Paiement/fermeture : pas de source dédiée → `TD-112-MORE-ALERTS`. |
| POS-113 | Aucune action dangereuse depuis mobile | ✅ | P0 | endpoint **lecture seule** (aucune mutation) + `@Roles('manager')` ; customer token exclu. |

## Intégrité fiscale / NF525 (transverse P0)

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-120 | Hash-chain ventes (fingerprint v2) | ✅(code) ⚠️(test local) | P0 | `fiscal/fiscal-verify.service.ts` vérifie 3 chaînes (sales/credit_notes/fiscal_journal) par pointeurs `hashChainPrev→hashChainCurrent` ; script `npm run fiscal:verify` |
| POS-121 | Immutabilité vente validée (no UPDATE) | ✅ prouvé (P332) | P0 | Comportemental : `void-m4-journal-chain.spec` (hash/montants d'origine intacts après void). Surface : `sale-immutability-guard.spec` **7/7** — aucun PATCH/PUT/DELETE sur `sales.controller`, aucun `UPDATE/DELETE sales` runtime, `save(SaleEntity` limité aux 3 sites sanctionnés (create/void/sync-insert), filtre anti-écrasement sync verrouillé. |
| POS-122 | Z-report figé | ✅ agrégation testée+branchée | P0 | `reports/z-report-aggregate.ts` (totaux, cash/card, top produits, peak hours, panier moyen) **6/6** + `reports.service.spec` régression OK + branché dans `generateZReport`. Z-report immuable après génération. |
| POS-123 | Journal fiscal append-only annulations | ✅ prouvé (P332) | P0 | Chaînage : `void-m4-journal-chain.spec` (genesis→maillon→maillon, pas de fork). Append-only verrouillé : `sale-immutability-guard.spec` — zéro `UPDATE/DELETE/TRUNCATE fiscal_journal`, zéro `update/delete/remove/save(FiscalJournalEntity` (insert-only, non-vacuité vérifiée). |
| POS-124 | Vérificateur de chaîne fiscale | ✅ prouvé adversarial (P332) | P0 | `fiscal-verify.spec` **6/6** : sain PASS + 5 tampers détectés — champ fiscal modifié, pointeur falsifié, **suppression d'un maillon au milieu** (linkage), **tamper montant avoir** (credit_notes), **tamper payload journal** (recompute authoritaire). |

## Sécurité (transverse — voir POS_SECURITY.md)

| # | Titre | Statut | Prio |
|---|---|---|---|
| POS-130 | PIN login prod 500 | ⚠️ | P0 |
| POS-131 | Secrets dans historique git | 🔴 CONFIRMÉ (P332) → ⛔ rotation utilisateur | P0 | Scan historique complet : 2 vraies clés (PRIM + Google Maps) dans `f2ad1b5` (toujours dans l'historique) et encore utilisées dans `.env` local. Rien d'autre (Stripe/AWS/DB/JWT propres). **Action : révoquer+régénérer les 2 clés** — détail POS_SECURITY.md S2. |
| POS-132 | Receipts auth + anti-XSS | ✅ XSS testé ; auth publique by-design | P0 | `escapeHtml` extrait+testé **5/5** (payloads neutralisés) + appliqué à tous les champs du reçu HTML. Endpoint reçu public = design QR client (note, pas un écart). |
| POS-133 | Erreurs front non avalées | ✅ corrigé+verrouillé (P332) | P1 | StockAlertsPage affichait déjà son erreur ; LabelsPage settait `loadError` **sans jamais le rendre** → bandeau d'erreur ajouté (`data-testid="labels-load-error"`). Verrou source vitest `errors-not-swallowed.test.ts` **3/3** (catch→état→rendu JSX pour les 2 pages). |

---

## Sélection PAQUET 1 (en cours)

POS-001, POS-002, POS-003, POS-004, POS-005 — gouvernance & alignement, **non dangereux, réversible, testable** (lint/build sur doc = n/a, pas de code métier modifié). Voir `EXECUTION_LOG.md`.

## PAQUET 2 (proposé — démarrage automatique après commit P1)

POS-047 (idempotence), POS-048 (cohérence paiement=total), POS-052/054 (gardes remise/annulation), POS-120 (hash-chain) — **vérification par tests ciblés** des invariants P0 déjà codés, sans modification de comportement tant que les tests passent.
