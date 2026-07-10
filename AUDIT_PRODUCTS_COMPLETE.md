# AUDIT_PRODUCTS_COMPLETE — Audit technique et fonctionnel du système produits

> **Date** : 2026-07-10 · **Base auditée** : `main` @ `5526834` (arbre propre, synchronisé)
> **Méthode** : lecture du code réel (backend, backoffice, POS, shared), schéma = migrations
> (pas les entités), exécution locale de la suite complète (**920 tests verts**, lint 0 erreur,
> 3 builds ✓), cartographie parallèle par domaine avec preuves `fichier:ligne`, contre-vérification
> manuelle des constats critiques. **Aucune correction effectuée** — constats uniquement.
> Détails : `PRODUCTS_FUNCTIONAL_MATRIX.md` (matrice complète), `PRODUCTS_GAPS.md` (manques),
> `PRODUCTS_TEST_COVERAGE.md` (preuves), `PRODUCTS_REMEDIATION_PLAN.md` (roadmap).

---

## 1. Verdict exécutif — notes sur 100

| Domaine | Note | Résumé d'une ligne |
|---|---|---|
| Modèle produit | **62** | Socle sain (EAN/SKU uniques par magasin, money entier, soft-delete) ; catégories mortes, FK absentes, écart schéma `price_history` |
| Création/modification | **48** | API backend solide et validée serveur ; **écran backoffice cassé** (payload ≠ DTO → 400) |
| Variantes | **55** | Backend + écran création OK ; pas d'édition, pas d'attributs normalisés, invisibles au POS |
| Packs | **72** | Vente/retour/snapshot/concurrence prouvés sur vrai Postgres ; **void ne restitue pas les composants** ; imbrication incohérente |
| Import | **55** | Upsert + rapport d'erreurs honnête ; virgule seule, pas de dry-run, pas transactionnel, gros volumes non viables |
| Prix | **60** | Cap 30 % + approbateur + codes promo race-safe exemplaires ; **override magasin plante en prod** (migration manquante) |
| Stock | **60** | Décrément concurrent prouvé, réconciliation 20 % conforme ; sync offline rejouable/non bornée, journal non unifié |
| Vente | **80** | Calcul serveur, hash v2, idempotence, capture carte vérifiée — le point fort du système |
| Retours | **82** | D1.4 scellé, atomicité prouvée PG, anti-double-retour ; refund carte manuel, motif absent sur by-ticket |
| Multi-magasin | **75** | Isolation + IDOR + rôles conformes ; orgs/units non scopés (admin global assumé ?) |
| Backoffice | **45** | Écrans satellites bons (packs, prix magasin, import) ; **écran principal produit inopérant**, cap 50, catégories non branchées |
| POS | **55** | Vente offline en file + invariants forts ; **catalogue non persistant** (froid offline = bloqué), scan non normalisé, desktop ≠ iPad |
| API | **70** | DTO globaux + pagination cœur ; endpoints `body:any`, listes non paginées |
| Sécurité | **75** | Tenant/rôles/validation/ratelimit réels ; remparts front cosmétiques (assumé), voie sync à durcir |
| Tests | **65** | 920 verts + 5 suites vrai-PG en CI sur les points critiques ; zéro E2E HTTP/UI/migration — les 2 P0 étaient invisibles pour cette suite |
| Production | **50** | Backend Railway sain ; 2 casses prod latentes (G1 visible utilisateur, G2 au premier override), DNS non basculé |

**Note globale pondérée : ~63/100.** Le cœur transactionnel (vendre, encaisser, retourner,
tracer fiscalement) est nettement au-dessus (75-82) ; la gestion de catalogue (créer, importer,
organiser les produits) est nettement en dessous (45-55) — le déséquilibre est le message central
de cet audit.

## 2. Solide et validé (extrait — matrice complète dans PRODUCTS_FUNCTIONAL_MATRIX.md)

| Fonction | État réel | Preuve | Niveau | Risque résiduel |
|---|---|---|---|---|
| Décrément stock concurrent (2+ caisses) | ✅ | `sales.service.ts:768-792` + `sales-stock-concurrency.pg.spec` (PG CI) | P4 | négligeable |
| Packs : vente, snapshot figé, retour prorata, concurrence | ✅ | `1754`, `sales.service.ts:803-842`, `returns.service.ts:273-295`, 12+2 tests | P4 | void (voir §4) |
| Cap remise 30 % + code responsable + approbateur tracé | ✅ | `sales.service.ts:226,502-516`, `discount-enforcement.spec` | P3 | cumul non testé |
| Capture carte vérifiée serveur (jamais payé sans capture) | ✅ | `sales.service.ts:161-223`, `card-capture-verify.spec` (9 cas) | P3 | PI orphelin sans balayage |
| Idempotence vente (même clé → même vente, in-tx) | ✅ | `sales.service.ts:290-337,875-884` | P3 | pas de 409 si params ≠ |
| Avoirs D1.4 : n° séquentiel, 4 maillons journal, atomicité | ✅ | `returns.service.ts:198-380`, `avoir-d14-atomicity.pg` (PG CI) | P4 | — |
| Codes promo : cap d'usage race-safe dans la tx de vente | ✅ | `promo-codes.service.ts:117-166` + PG CI | P4 | scope produit inappliqué |
| Anti-doublon EAN/SKU (index DB + 409 applicatif) | ✅ | `product.entity.ts:14`, `1740:22-24` | P3 | — |
| POS : jamais de création produit en caisse (invariant testé) | ✅ | `posProductCreationGuard.test.ts`, PIN-gate serveur | P3 | — |
| Isolation multi-tenant + IDOR + rôles | ✅ | `tenant.interceptor.ts:77-110`, `findOneForStore` | P3 | orgs/units global-admin |
| Réconciliation inventaire ≥20 % → intervention humaine | ✅ | `stock-reconciliation.service.ts:62-124` | P3 | — |
| Snapshot des lignes de vente (modif produit sans effet rétroactif) | ✅ | `sale-line-item.entity.ts:17-38` | P3 | — |

## 3. Présent mais partiel (extrait — liste complète dans PRODUCTS_GAPS.md §🟠)

| Fonction | Ce qui marche | Ce qui manque | Impact magasin | Priorité |
|---|---|---|---|---|
| Import CSV | upsert + rapport par ligne | `;`, encodage, dry-run, transaction, volumes, colonnes | catalogues français réels souvent inimportables | P2 |
| Sync offline | ventes dédupées par id, file POS saine | stockAdjustments rejouables/non bornés ; ventes push sans hash/ticket | intégrité stock + chaîne fiscale | **P1** |
| POS catalogue | iPad : polling 15 s | desktop figé au montage ; rien de persisté | prix périmés ; froid offline bloqué | **P1** |
| Statut produit | archivage soft OK | `update()` désaligne `isActive`/`status` | produit archivé revendable | P1 |
| Retours | POST /returns complet | by-ticket sans motif ; refund carte manuel | traçabilité + oubli de remboursement | P1 |
| Catégories/marques/fournisseurs | tables + unicité + CSV | non branchés fiche produit ni UI catégories | taxonomie inexploitable | P2 |
| Recherche/scan POS | douchette + caméra multi-formats | UPC↔EAN, zéros, accents, inactif au scan | scans ratés en caisse | P2 |

## 4. Absent ou cassé (extrait — liste complète dans PRODUCTS_GAPS.md §🔴/⚫)

| Fonction | Blocage | Conséquence | Correction | Effort |
|---|---|---|---|---|
| 🔴 Écran création/modif produit (backoffice) | payload `{price,stock,category,storeId}` ≠ DTO + forbidNonWhitelisted | 400 systématique — cœur du backoffice inopérant | R1 (mapping + champs) | S |
| 🔴 `price_history` en prod | entité ≠ table migrée (3 colonnes) | override prix magasin **plante** ; historique perdu en silence | R2 ⚠️ migration additive | S |
| 🔴 Void pack | composants jamais restitués | fuite de stock définitive | R3 ⚠️ (tests-as-spec puis fix) | S/M |
| 🔴 Sync stockAdjustments | ni idempotence ni borne | double application ; stock négatif | R4 | M |
| 🔴 POS froid offline | catalogue non persisté | caisse muette sans réseau au boot | R5 | M |
| ⚫ Duplication produit, attributs normalisés, multi-EAN, prix barré, stock réservé, variantes/packs/images au POS, E2E HTTP/UI/charge/migration | non construits | voir GAPS | roadmap | — |

## 5. Parcours critiques — état de preuve

| Parcours | Verdict | Preuve / trou |
|---|---|---|
| Créer un produit simple (API) | 🟢 P3 | DTO+409 testés indirectement ; `create()` sans test unitaire dédié |
| Créer un produit simple (backoffice) | 🔴 P0 | G1 — 400 systématique (vérifié à la main) |
| Créer un produit à variantes | 🟢 P3 | `product-variants.spec` + écran dédié fonctionnel |
| Créer un pack | ✅ P3 | `product-packs.spec` + section backoffice branchée |
| Importer un catalogue | 🟠 P3/P0 | round-trip testé ; volumes/`;` non viables |
| Affecter un prix magasin | 🔴 en prod / ✅ en test | G2 — plantage au premier override prod |
| Recevoir du stock | 🟢 P3 | `stock-locations.spec` (système B) ; non relié au journal des ventes |
| Vendre le produit | ✅ P4 | `sale-transaction` + concurrence PG |
| Vendre le pack | ✅ P4 | packs pg-mem + PG |
| Retourner le produit | ✅ P4 | `returns` + `avoir-d14-atomicity.pg` |
| Retourner le pack | ✅ P4 | snapshot + prorata testés |
| Vendre simultanément sur deux caisses | ✅ P4 | `sales-stock-concurrency.pg` (CI) |
| Vendre offline puis synchroniser | 🟠 P2 | file POS + dédup testées unitairement ; aucun E2E coupure/reprise ; voie `/sync/push` fragile |
| Scanner un code-barres | 🟠 P4 partiel | e2e smoke (1 chemin) ; UPC/zéros non normalisés |
| Modifier un produit déjà vendu | ✅ P3 | snapshots lignes + retours au prix payé |
| Désactiver un produit | 🟢 P3 | vente bloquée (`is_active`) ; incohérence status possible via update |
| Tenter de créer un doublon | ✅ P3 | 409 + index unique (+ 21 cas product-integration) |

## 6. Dette technique classée

- **P0 bloquant magasin** : G1 écran produit backoffice ; G2 price_history prod ; G5 POS froid offline ; import gros volumes (G13 partie limite body).
- **P1 risque financier/stock** : G3 void pack ; G4 sync stockAdjustments ; G6 `/sync/push` ventes ; G7 isActive/status ; G8 idempotence sans 409 ; G9 refund carte manuel ; G10 motif by-ticket ; G11 PI orphelins.
- **P2 fonctionnement incomplet** : G12 journal stock unifié ; G13 import CSV réel ; G14 packs imbriqués ; G15 pagination backoffice ; G16 catégories ; G17 marques/fournisseurs fiche ; G18 scan POS ; G19 cumul remises non prouvé ; G20 motif ajustement ; G21 endpoints `any` ; absence E2E/UI/migration tests.
- **P3 amélioration** : duplication produit, attributs normalisés, prix barré, CMUP, multi-EAN, images POS, stock réservé, notifications push stock, écran mouvements, rôles front, `first_purchase` paramétrable.

## 7. Plan de correction

Voir `PRODUCTS_REMEDIATION_PLAN.md` : **10 blocs autonomes** (R1–R10) + 5 décisions produit (D-A–D-E).
Ordre : R1+R2⚠️+R3⚠️ → R4+R6 → R5→R9 → R7+R8, R10 en continu. Les blocs ⚠️ (migration produits,
surface vente/fiscale) attendent chacun un **GO owner nommé** ; le reste relève du continue-default
(réversible, testé, en branche).

---

## 8. Conclusion obligatoire

**Le système produits peut-il être utilisé aujourd'hui dans un magasin réel ?**
**Oui pour ENCAISSER, non pour GÉRER le catalogue.** Un magasin dont le catalogue est déjà chargé
(via import CSV ou API) peut vendre, encaisser (espèces + carte vérifiée), rendre et tracer
fiscalement avec un niveau de preuve élevé. Il ne peut PAS : créer/modifier un produit depuis
l'écran principal du backoffice (G1), poser un prix magasin en production (G2), démarrer la caisse
hors ligne à froid (G5), ni faire confiance au stock après un void de pack (G3) ou un rejeu de
sync (G4).

**Fonctions réellement sûres** : vente complète (calcul serveur, hash v2, ticket séquentiel),
paiements carte vérifiés serveur, idempotence de la voie POS, remises plafonnées 30 % avec
approbateur, codes promo sous concurrence, décrément stock sous concurrence, packs à la vente et
au retour, avoirs D1.4 scellés et atomiques, isolation multi-tenant, non-création produit en caisse,
réconciliation d'inventaire à 20 %.

**Fonctions à NE PAS utiliser encore** : création/modification produit via l'écran principal
backoffice ; prix magasin en production (jusqu'à R2) ; void d'une vente contenant un pack (passer
par le retour, qui est correct) ; ajustements de stock via `/sync/push` en conditions réseau
instables ; import CSV > quelques centaines de lignes ou au format Excel FR (`;`) ; packs
imbriqués (composition à 2 niveaux).

**Les cinq risques les plus dangereux** :
1. **G2** — premier override de prix magasin en prod = 500, et perte silencieuse d'historique de prix à chaque update (déjà actif).
2. **G4** — rejeu de sync offline = stock faux (double application, négatif possible), invisible jusqu'à l'inventaire.
3. **G3** — void d'un pack payé carte = stock composants perdu définitivement, sans trace.
4. **G1** — le magasin ne peut pas faire vivre son catalogue au quotidien (opérationnel, visible immédiatement).
5. **G6** — la voie `/sync/push` peut insérer des ventes sans hash/ticket serveur → pollution potentielle de la chaîne fiscale.

**Corrections avant la prochaine ouverture** (si le magasin doit gérer son catalogue et vendre des
packs) : R1 (écran produit), R2 (migration price_history, sur GO), R3 (void pack, sur GO), et
consigne d'exploitation immédiate sans code : *ne pas void une vente pack (faire un retour), ne pas
poser d'override de prix en prod, importer les catalogues en < 100 lignes UTF-8 virgule*.

**Pourcentage du système produits réellement prêt** : **~63 %** (pondéré par criticité ; cœur
transactionnel ~80 %, gestion de catalogue ~48 %).

**Blocs restant à livrer** : **10 blocs** (R1–R10) + **5 décisions** produit (D-A–D-E), dont
2 blocs sous gate Tier-2 (R2, R3).
