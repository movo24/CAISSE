# POS_BLOCKS.md — Registre numéroté des blocs (vérifié 2026-06-28)

> Statut : ✅ Fait · 🔄 En cours · ⬜ À faire · ⚠️ À vérifier · ⛔ Bloqué réel
> Priorité : P0 (intégrité/sécurité/caisse) · P1 (cœur métier) · P2 (confort) · P3 (futur)
> **Honnêteté** : "⚠️ À vérifier" = le code existe mais n'est pas prouvé branché/testé ici. Aucun bloc n'est ✅ sans preuve (commit + test vert).

## Gouvernance (PAQUET 1 — en cours)

| # | Titre | Statut | Prio | Fichiers/preuve | Dépend. |
|---|---|---|---|---|---|
| POS-001 | Audit global read-only | ✅ | P0 | `PROJECT_STATUS.md` (faits vérifiés) | — |
| POS-002 | 12 fichiers de pilotage | ✅ (tenus, P343) | P0 | les 12 `.md` racine | 001 |
| POS-003 | Registre des blocs numéroté | ✅ (réconcilié P344) | P0 | ce fichier | 001 |
| POS-004 | Aligner CLAUDE.md sur le réel (drift) | ✅ (jalon v34) | P1 | `CLAUDE.md` vs audit | 001 |
| POS-005 | EXECUTION_LOG + cadence paquets | ✅ (343 paquets tracés) | P0 | `EXECUTION_LOG.md` | 002 |

## Socle POS desktop

| # | Titre | Statut | Prio | Localisation | Critère d'acceptation |
|---|---|---|---|---|---|
| POS-010 | App desktop Electron + dual-window | ⚠️ | P0 | `pos-desktop/src/main/*`, `ClientDisplayPage` | Lance POS + écran client |
| POS-011 | Écran caisse principal | ⚠️ | P0 | `POSPage.tsx`, `components/pos`, `ipad` | Saisie articles OK |
| POS-012 | Écran panier | ⚠️ | P0 | `useCart.ts`, layout | Ajout/retrait/qté |
| POS-013 | Écran paiement | ⚠️ | P0 | `usePayment.ts` | Choix moyen + validation |
| POS-014 | Écran/édition ticket | ⚠️ | P0 | `receipts`, `useBluetoothPrinter` | Ticket émis après paiement |
| POS-015 | Écran retour / annulation | ⚠️ | P0 | `ReturnModal.tsx`, `returns` | Avoir généré, NF525 OK |
| POS-016 | Ouverture / fermeture caisse | ✅ complet (P351) | P0 | open/close terminal-bound prouvé + **fond de caisse à l'ouverture** (`openingFloatMinorUnits`, DTO validé entier ≥ 0, migration 1728 file GATE 2) ; clôture avec comptage (P326) — tests primitive 4 nouveaux cas. |
| POS-017 | Comptage espèces (midi + fermeture) | ✅ complet (P351) | P1 | Comptage saisi à la clôture désormais **persisté** (`countedCashMinorUnits`) et **écart signé calculé+figé CÔTÉ SERVEUR** (`cashVarianceMinorUnits` = compté − fond − espèces session). Sans saisie : NULL, comportement historique. Preuves : primitive spec (écart −50 exact, invalide refusé, NULL). |
| POS-017b | Câblage comptage : lien session↔ventes + champs session | ✅ complet (P312+P351) | P1 | Lien 1726 + stamp + cash-summary (e2e 10/10) ET champs float/counted/variance persistés (migration **1728**, additive/nullable/réversible, dry-run pg-mem 2 tests). File GATE 2 = 1725→1728 (`run-gate2.sh` à jour). |
| POS-018 | Historique ventes | ✅ filtres + DTO validé | P1 | `GET /api/sales` : page/limit/date + employeeId/from/to/status (`findByStore`). **POS-018b** : `ListSalesQueryDto` validé (types/bornes, limit≤100, UUID) câblé — spec 4/4. Admin cross-store. Runtime DB local. |
| POS-019 | Paramètres terminal | ✅ prouvé (P363) | P2 | Config persistée : `terminal-id` (localStorage, override admin) déjà testé (P325) ; classifieurs responsive PURS prouvés `device-profile.test` **3/3** (bornes écran exactes 1024/1440, contrat classes CSS des layouts). Registre backend `terminals` existant. |
| POS-020 | État connexion / mode dégradé | ✅ prouvé (P346) | P0 | `offlineStore.test.ts` **9/9** : bascule online/offline journalisée (antifraude_log), paiements dégradés (cash toujours, carte si TPE autonome, QR/wallet jamais offline), file locale persistante (survit au redémarrage), garde-fous (2 voids consécutifs, 5/jour, 50€ remboursement, 500€/ticket, anomalies resync). | Bascule offline visible |

## Matériel caisse

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-030 | Scanner code-barres | 🟡 logique prouvée (P355) ; caméra/douchette réelles = test physique | P1 | Nettoyage + anti-rebond extraits et testés 7/7 (cf POS-037) ; branchés dans `useScannerZXing` sans changement de comportement. |
| POS-031 | Imprimante ESC/POS | 🟡 trames prouvées (cf POS-037) ; matériel réel non testé | P1 | Builders ESC/POS exportés+testés 6/6 ; connexion BLE réelle = test physique. |
| POS-032 | Lecteur QR | ⚠️ | P2 | ZXing |
| POS-033 | TPE Stripe Terminal WisePad 3 | 🟡 idempotence PI testée ; paiement réel non testé | P0 | `stripe-terminal.service` + `payment-intent-key.ts` (clé idempotence déterministe, anti double-charge) **5/5** + régression service 4/4. POS hook `useStripeTerminal`. Paiement live interdit/non testé. |
| POS-034 | Passerelle mobile paiement iOS/Android | ⬜ | P2 | à définir |
| POS-035 | Gestion erreurs périphériques + reconnexion | ⚠️ | P1 | hooks HW |
| POS-036 | Réimpression ticket | 🟡 logiciel prouvé (P361) ; impression BLE réelle = physique | P2 | `lib/reprint.ts` **6/6** : duplicata marqué EN TÊTE + pied (« NE VAUT PAS ORIGINAL »), montants copiés jamais recalculés, date de la vente originale, compteur n°X, journal `recordReprint` immuable, **trame ESC/POS bout-en-bout validée** via les builders POS-037. Droit `canReprintTicket` déjà gardé (useTicketHistory). |
| POS-037 | Tests matériel simulé (mocks) | ✅ complet côté logiciel (P347+P355) | P1 | Imprimante+tiroir : `escpos-builders` 6/6. Scanner : cœur extrait PUR (`scan-gate.ts`, zéro changement de comportement) — `scan-gate.test` **7/7** (nettoyage trames douchette CR/LF/GS, borne longueur, matrice anti-rebond caisse vs inventaire). Restent physiques par nature : caméra ZXing + BLE réels. |

## Paiements

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-040 | Espèces (+ monnaie rendue) | ✅ testé | P0 | `sale-payment` + `payment-policy.validatePayments` (`changeMinorUnits`) — 7/7 |
| POS-041 | Carte / Stripe Terminal | 🟡 idempotence PI testée | P0 | `stripe-terminal` ; clé idempotence PaymentIntent testée (anti double-charge) ; tenant ownership check. Paiement réel non testé. |
| POS-042 | Paiement différé/offline carte | 🟡 stratégie+moteur+EXÉCUTEUR prouvés (P352-353) ; irreductible = TPE physique | P1 | Policy **12/12** + `deferred-capture-executor.ts` **6/6** (deps injectées) : captured→finalize puis synced, declined→abandon+failed, error/exception→retry, **capture-OK/finalisation-KO rejouable sans double charge** (même clé, prouvé), entrées synced/failed jamais retraitées, zéro échec silencieux. Restant : adaptateur TPE réel + branchement UI (`TD-042-EXECUTOR` réduit). |
| POS-043 | Store credit / avoir | ✅ cap résiduel + DTO corrigé | P1 | `payment-policy` (avoir ≤ reste dû) testé. **Bug corrigé** : `SalePaymentDto` acceptait pas `store_credit` (rejet ValidationPipe) → `PAYMENT_METHODS` (incl. `store_credit`) + champ `creditNoteCode`. Specs 7/7. |
| POS-044 | Paiements mixtes | ✅ testé | P1 | `sale-payment` (multi) + `validatePayments` (cash+card+avoir) — testé |
| POS-045 | Annulation paiement | ✅ garde void cash (cf POS-052) | P0 | void interdit sur leg cash réalisé → passe par retour ; testé (voidSale guard) |
| POS-046 | Remboursement | ✅ math extrait+testé, régression OK | P1 | `returns.service` + `returns-policy.ts` (`returnableQuantity`, `computeLineRefund` proportionnel) — `returns-policy` 7/7 + `returns.service.spec` **17/17 sans régression** |
| POS-047 | Idempotence stricte (double paiement interdit) | ✅ prouvé (idempotency.spec + e2e replay, P343) | P0 | `sales.service.ts` L176-184 replay + L350-355 in-tx + L509-519 persist même tx + expiry 7j + ConflictException |
| POS-048 | Cohérence paiement ≥ total avant finalisation | ✅ branché+testé | P0 | extrait en `payment-policy.validatePayments` (pur, **7/7**), appelé dans `createSale` (messages identiques → comportement préservé ; mapping BadRequestException). |
| POS-049 | Synchro paiement cloud | ✅ prouvé (P349) | P1 | `sync` : push offline insert-only (ids existants filtrés — verrou P332), rejeu dédupliqué (e2e), résolution conflit server-wins testée — suites sync **3/17** re-exécutées vertes + e2e « offline sync push replay deduped ». |

## Règles caisse

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-050 | Sessions liées `(store_id, terminal_id)` | ✅ prouvé (db-invariant 2/2 + primitive ~15 tests) | P0 | `pos-session`, migration `1719...TerminalId` |
| POS-051 | Interdiction doublons sessions/ventes | ✅ prouvé (index partiel sessions + idempotence ventes + dedup sync e2e) | P0 | `idempotency-key` |
| POS-052 | Garde annulation espèces | ✅ prouvé (void-cash-realized-guard vert sandbox, P341) | P0 | `sales.service.ts` voidSale L948-965 (`cashRealized` → ConflictException) + limite void manager 500€ L916-927 |
| POS-053 | Remises internes interdites sauf code responsable | ✅ couvert par la chaîne POS-054 | P1 | Caisse : >20% exige PIN responsable réel (bcrypt) + verrou 5 essais/15 min (H3), cap 30% strict, audit append-only ; back-office admin-only séparé. Preuves : discount-policy 14/14 + 054b/c/d/e. |
| POS-054 | Politique remise (caisse 30% strict / justif 21-30% / back-office 100% admin) — **moteur pur** | ✅ code+test (14/14 vérifié) | P0 | `sales/discount-policy.ts` + `discount-policy.spec.ts` (matrice produit complète, exécutée verte dans le sandbox) |
| POS-054b | Câblage caisse : champs DTO (`manualDiscountMinorUnits`, `responsablePin`, `discountJustification`) + appel politique + distribution sur lignes (TVA cohérente) dans `createSale` | ✅ codé+branché, **tsc clean** ; ⚠️ test runtime vente à exécuter localement | P0 | `common/dto/sales.dto.ts`, `sales.service.ts` (bloc avant calcul totaux). N'altère PAS les promotions. |
| POS-054c | Vérification réelle du code responsable | ✅ branché (réel) | P0 | `sales.service.verifyResponsablePin` : PIN employé `manager`/`admin` (bcrypt `pin_hash`) du magasin. Pas de nouveau secret. Dette : rate-limit/lockout (`TD-RESP-PIN`). |
| POS-054d | Persistance audit remise (append-only) | ✅ complet (terminal id threadé P349) | P0 | `auditService.log` actions `manual_discount_applied` / `manual_discount_blocked` (caissier, responsable, %, motif, ticket, magasin). **Pas de migration** (audit_entry existant, hash-chain). `terminalId` (X-Terminal-Id, POS-INT-83) désormais dans les détails `manual_discount_applied`/`blocked` — TD-054D clos. |
| POS-054e | Endpoint remise back-office (≤100%, admin only, motif+validateur+audit) | ✅ codé+branché+testé (5/5) | P1 | nouveau module `backoffice-discounts` : `POST /api/backoffice/discounts/authorize` (`@Roles('admin')`). Jamais 100% depuis caisse (channel séparé). Application à une vente = follow-up `TD-054E-APPLY`. |
| POS-055 | Jours fériés paramétrables + quiet hours alertes | ✅ branché+prouvé (P292, réconcilié P349) | P2 | `isSilentNow` câblé dans le sweep cron (env QUIET_START/END_HOUR + HOLIDAYS, défaut fenêtre vide = zéro changement). Specs : helper 5/5 + wiring 4 tests (fenêtre 21h→8h wrap, férié ISO, sweep supprimé n'appelle même pas TW24). TD-055 clos. |
| POS-056 | Audit log actions sensibles, aucune suppression silencieuse | ✅ primitives testées | P0 | `audit/audit-hash.ts` (`computeAuditHash`+`verifyAuditChain`) extrait+testé **8/8** ; `audit.service` refactor behavior-preserving (controller spec 6/6) ; entité append-only. Dup `shared.createAuditHash` → `TD-AUDIT-HASH-DUP`. |

## Produits / catalogue

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-060 | Produit parent + variantes/SKU | ✅ option A livrée (P327→P338) | P1 | `parent_product_id`/`variant_label` (migration 1727, file GATE 2), variantes sœurs + EAN unique PAR variante prouvés pg-mem, garde 1 seul niveau + tenant (Cycle P), regroupement UI (M). SKU dédié = TD-066-SKU (inchangé). |
| POS-061 | Prix par magasin + override | ✅ override branché+testé | P1 | Prix par magasin (lignes scopées `storeId`) + **override prioritaire** : colonne `price_override_minor_units` (migration `1723`, nullable) + `resolveEffectivePrice` (override>global) **testé 4/4** + branché dans `createSale` (prix ligne effectif). Override NULL → prix global (aucun changement). |
| POS-062 | Marque / fournisseur / catégories / images | 🟡 marque+fournisseur+catégories ✅ ; images non traitées | P2 | `brand` (1727) + référentiel `suppliers` (CRUD tenant, soft-delete, audité P339, références validées P338) + catégories existantes. Images produit : rien de nouveau. |
| POS-063 | TVA / prix TTC | ✅ extraction testée+branchée | P0 | `sales/tax.ts` (`extractLineTax`/`sumLineTax`) — **6/6** dont test-propriété = formule fiscale inline (hash-safe). Branché dans `createSale`. Doublon `shared.extractTax` (arrondi net-first) → `TD-TAX-DUP`. |
| POS-064 | Statut actif/inactif | ✅ prouvé | P2 | `findAll` actif-only + tenant (pg-mem), `deactivate` soft + audité `product_deactivated` (P339), fournisseur inactif refusé en nouvelle assignation (P338). |
| POS-065 | Import/export catalogue | ✅ (P340) | P2 | Export CSV back-office existant + **import** `POST /api/products/import` (dry-run par défaut, doublons EAN/nom in-file+magasin refusés, fournisseur par nom sans création implicite, cap 2000, audit synthétique) — validation pure 5/5 + preuves pg-mem. |
| POS-066 | Anti-doublons SKU/EAN/nom normalisé | ✅ branché+testé | P1 | EAN : index unique `(ean,storeId)`. Nom : **dédup branchée** dans `products.service.create` (même nom normalisé/même magasin → ConflictException) + colonne `normalized_name` (migration `1722`) + sync sur update. `name-normalize` 6/6 + `products.service.spec` dédup **7/7**. Legacy backfill accents = `TD-066-LEGACY-BACKFILL`. Pas de SKU → `TD-066-SKU`. |

## Promotions / remises

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-070 | Codes promo + fenêtre validité | ✅ validité+coupons testés | P1 | promos : `getActivePromos`+`isPromoActive`. Coupons : `coupon-policy.ts` (idempotency-key, dispo, expiry, cooldown) **7/7** + `coupon.service` redeem refactor (régression **6/6**), idempotence en transaction. |
| POS-071 | Scope magasin/produit/cat + limite d'usage | ✅ scope + plafond (exclusion) | P1 | Scope produit/catégorie + hors-portée ✅ ; **plafond d'usage** : colonnes `usage_limit`/`usage_count` (migration `1724`) + `isUsageLimitReached` testé + `getActivePromos` exclut les promos au plafond (`promotions.service.spec` **14/14**). Increment à l'application = `TD-073-USAGE-INCREMENT`. |
| POS-072 | Traçabilité usage | 🟡 coupons OK | P1 | Coupons : redemption + idempotency tracés. `promo_rule` : pas de compteur d'usage (lié `TD-073-USAGE-LIMIT`). |
| POS-073 | Refus auto (expirée / plafond / doublon) | ✅ complet (P341 e2e) | P0 | **Expirée** ✅ (`getActivePromos`+`isPromoActive`). **Doublon/cumul** ✅ (`dedupeBestPerProduct`, spec 14/14 anti-stacking). **Plafond usage** ✅ : colonnes `usage_limit`/`usage_count` (migration 1724) + exclusion au plafond + **incrément réel à l'application** prouvé e2e (« promo usage cap really counts down across REAL sales », P341). Coupons idempotents (séparé). |

## Stock

| # | Titre | Statut | Prio | Localisation |
|---|---|---|---|---|
| POS-080 | Stock par magasin | ✅ (vérifié) | P0 | `product.stockQuantity` + index unique `(ean, storeId)` ; helper testé `stock/stock-level.ts` (7/7) |
| POS-081 | Mouvement stock à chaque vente | ✅ (option 1, P306) | P0 | `recordSaleMovements` appelé DANS la transaction de vente (`sales.service` L656) — journal append-only + décrément atomiques. Preuves : `stock-movement-journal.pgmem.spec` + e2e « a REAL sale writes append-only stock movements ». |
| POS-082 | Retour stock si annulation/remboursement | ✅ (recordReturnMovements, P306) | P0 | `recordReturnMovements` branché dans `returns.service` — restock + ligne journal atomiques. Preuve e2e (retour réel → mouvement append-only). |
| POS-081b | Unifier les 2 systèmes de stock (store `stockQuantity` ↔ journal `stock_movements`) | ✅ GO option 1 exécuté (P306 — TD-STOCK-TWO-SYSTEMS résolu) | P1 | GO utilisateur option 1 (P306) : location paresseuse idempotente par magasin, journal = source d'audit, compteur = lecture rapide, réconciliation read-only (`stock-reconcile`, F1). `STOCK_UNIFICATION_DECISION.md`. |
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
| POS-110 | Cockpit mobile lecture seule | ✅ complet côté logiciel (P362) | P1 | Endpoint (shaper 6/6) + view-model **8/8** + **écran `AlertsPage` livré** : route `/alerts`, tuile Home visible manager/admin uniquement (même garde que le backend), badge global, sections par gravité, erreurs jamais avalées (bandeau+réessayer), zéro action possible (lecture seule par construction). Build vite RC 0. Test smartphone réel = runtime. |
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
| POS-131 | Secrets dans historique git | 🟠 désamorcé localement (P354) ; révocation console = utilisateur | P0 | Valeurs compromises RETIRÉES du `.env` local (0 occurrence arbre, vérifié) ; Google Maps volontairement désactivé (no-key testé) ; nouvelle clé PRIM régénérée (pose locale = utilisateur seul). Restant : révocation des 2 anciennes clés en console + Railway éventuel. Détail S2. |
| POS-132 | Receipts auth + anti-XSS | ✅ XSS testé ; auth publique by-design | P0 | `escapeHtml` extrait+testé **5/5** (payloads neutralisés) + appliqué à tous les champs du reçu HTML. Endpoint reçu public = design QR client (note, pas un écart). |
| POS-133 | Erreurs front non avalées | ✅ corrigé+verrouillé (P332) | P1 | StockAlertsPage affichait déjà son erreur ; LabelsPage settait `loadError` **sans jamais le rendre** → bandeau d'erreur ajouté (`data-testid="labels-load-error"`). Verrou source vitest `errors-not-swallowed.test.ts` **3/3** (catch→état→rendu JSX pour les 2 pages). |

---

## Sélection PAQUET 1 (en cours)

POS-001, POS-002, POS-003, POS-004, POS-005 — gouvernance & alignement, **non dangereux, réversible, testable** (lint/build sur doc = n/a, pas de code métier modifié). Voir `EXECUTION_LOG.md`.

## PAQUET 2 (proposé — démarrage automatique après commit P1)

POS-047 (idempotence), POS-048 (cohérence paiement=total), POS-052/054 (gardes remise/annulation), POS-120 (hash-chain) — **vérification par tests ciblés** des invariants P0 déjà codés, sans modification de comportement tant que les tests passent.
