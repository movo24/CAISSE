# PRODUCTS_FUNCTIONAL_MATRIX — Matrice fonctionnelle produits/catalogue/stock/vente

> Audit du 2026-07-10 sur `main` @ `5526834`. Statuts : ✅ SOLIDE ET VALIDÉ · 🟢 FONCTIONNEL ·
> 🟠 PARTIEL · 🔴 CASSÉ · ⚫ ABSENT · ⚠️ NON PROUVÉ. Niveaux de preuve : P0 aucune · P1 code
> présent · P2 test unitaire · P3 test d'intégration (pg-mem) · P4 vrai Postgres/E2E · P5 prod.
> Les specs `*.pg.spec.ts` tournent en CI sur Postgres 16 jetable (`.github/workflows/ci.yml:19-59`) → P4.

## A. Modèle produit

| Fonction | Statut | Preuve | Niveau |
|---|---|---|---|
| Produit simple (ean, nom, prix, TVA, stock, seuils, actif) | ✅ | `product.entity.ts:20-93`, `1700-InitialSchema.ts:74-96`, 920 tests verts | P3 |
| Variantes/SKU (ligne produit + `parent_product_id`, unicité `(store_id,sku)` partielle) | 🟢 | `1740-AddProductVariants.ts:18-24`, `products.service.ts:146-188`, `test/product-variants.spec.ts` | P3 |
| Variante de variante interdite | 🟢 | `products.service.ts:153` | P2 |
| Catégories (hiérarchie `parent_id` en table, **jamais câblée** ; `products.category_id` varchar sans FK) | 🟠 | `product-category.entity.ts`, `products.service.ts:552-576`, `1700:80` | P1 |
| Marques (table + unicité `(store_id,name)`, filtre liste) — **absentes des DTO produit** | 🟠 | `1738-CreateBrandsSuppliers.ts:12-20`, `products.service.ts:192-207` | P2 |
| Fournisseurs (idem marques) — **pas de référence fournisseur par produit** | 🟠 | `1738:22-35`, `products.dto.ts` (aucun supplierId) | P2 |
| Attributs / tailles / couleurs normalisés | ⚫ | seul `variant_name` texte libre (`1740:20`) | — |
| Poids / dimensions / conditionnement | ⚫ | seul `unit_type` texte libre (`1700:81`) | — |
| Statut (`draft/pending_validation/active/rejected/archived`) + archivage soft | 🟢 | `1746:20-22`, `products.service.ts:331-335` | P3 |
| Cohérence `isActive` ↔ `status` dans `update()` | 🔴 | `products.service.ts:384` écrit `isActive` brut sans réaligner `status` ; la vente ne filtre que `is_active` (`:271,303`) | P1 |
| Unicité EAN par magasin (index + garde applicative 409) | ✅ | `product.entity.ts:14`, `1710500000000:20-23`, `products.service.ts:223-243` | P3 |
| Unicité SKU par magasin (index partiel) | 🟢 | `1740:22-24` | P2 |
| Images produit (mono-image URL) | 🟢 | `product.entity.ts:69`, DTO create/update | P1 |
| TVA (`tax_rate numeric` défaut 20, non nullable) | 🟢 | `1700:86` — réserve : decimal→string runtime, pas de borne haute DTO | P3 |
| Prix d'achat (`cost_minor_units`) / marge (courante, pas de CMUP ni coût historique) | 🟠 | `products.service.ts:694-810` (`costBasis:'current_cost_approx'`) | P2 |
| Prix par magasin (`store_product_prices` + fenêtre validité + résolution à la vente) | 🟢* | `1739:12-30`, `products.service.ts:63-69`, `test/store-price-override.spec.ts:75-86` — *voir 🔴 price_history ci-dessous | P3 |
| Prix barré (`old_price_minor_units`) | ⚫ | colonne jamais écrite (aucun DTO/service) — colonne morte | — |
| **Historique de prix — écart entité↔migration** | 🔴 | entité `price-history.entity.ts:22-31` a `store_id/change_source/changed_by_role` ; la table migrée ne les a PAS (`1700:286-294`, aucun ALTER). En prod (`synchronize:false`) : `setStoreOverride`/`clearStoreOverride` **plantent** (`products.service.ts:98,126` non protégés) ; `update()` perd l'historique silencieusement (`:355-368`). Vérifié à la main. | P1 (cassé prod) |
| Money = centimes entiers partout | ✅ | toutes colonnes `*_minor_units integer` ; arrondis `Math.round` explicites | P3 |
| FK/intégrité : `brand_id/supplier_id/category_id/parent_product_id`, `store_product_prices.*`, `price_history.*` **sans FK** | 🟠 | migrations 1738/1739/1740 (colonnes nues) | P1 |

## B. Création / modification produit

| Fonction | Statut | Preuve | Niveau |
|---|---|---|---|
| POST /products (rôles admin/manager, storeId forcé JWT, DTO validé serveur) | ✅ | `products.controller.ts:28-36`, `products.dto.ts:14-87`, ValidationPipe `main.ts:277-283` | P3 |
| PUT /products/:id (DTO complet, imageUrl null accepté) | 🟢 | `products.controller.ts:254-273` — réserve : historique prix non bloquant | P3 |
| Duplication produit | ⚫ | aucun endpoint (grep confirmé) | — |
| Anti-doublon EAN à la création (409 + payload fiche existante) | ✅ | `products.service.ts:223-243` + index unique | P3 |
| Création POS interdite (demande d'intégration seulement, PIN-gaté) | ✅ | `product-integration.service.ts:33-43,434-521`, `posProductCreationGuard.test.ts` | P3 |
| Produit sans prix refusé / TVA défaut 20 / stock défaut 0 / catégorie facultative | 🟢 | DTO requis `priceMinorUnits` ; défauts entité | P3 |
| `categoryId` non validé (ni UUID ni existence) | 🟠 | `products.dto.ts:36` | P1 |
| Suppression = soft delete (archived), jamais physique | ✅ | `products.controller.ts:282-287`, `products.service.ts:331-335` | P2 |
| Modification d'un produit déjà vendu : ventes intactes (snapshot lignes) | ✅ | `sale-line-item.entity.ts:17-38`, `sales.service.ts:443-457` | P3 |
| **Écran backoffice création/modification produit** | 🔴 | `ProductsPage.tsx:241-249` envoie `{price,stock,category,storeId}` ≠ DTO (`priceMinorUnits,stockQuantity,categoryId`) + `forbidNonWhitelisted` → **400 systématique**. Vérifié à la main. | P0 (cassé) |

## C. Import / export catalogue

| Fonction | Statut | Preuve | Niveau |
|---|---|---|---|
| POST /products/import (JSON `{csv}`) + rapport `{total,created,updated,skipped,errors[ligne,ean,motif]}` | 🟢 | `products.controller.ts:134-139`, `products.service.ts:424-536`, UI `ProductsPage.tsx:662-719` | P3 |
| Export CSV serveur + anti-injection formule + round-trip lossless | 🟢 | `csv.util.ts`, `test/products-csv.spec.ts` (4 cas) | P3 |
| Upsert par `(ean, storeId)` avec historisation prix (`csv_import`) | 🟢 | `products.service.ts:493-530` | P3 |
| Marques/fournisseurs créés à la volée par nom | 🟢 | `products.service.ts:488-491` | P3 |
| Séparateur `;` (Excel FR) | ⚫ | `csv.util.ts:39` virgule codée en dur | — |
| Encodage autre qu'UTF-8 | ⚫ | `ProductsPage.tsx:153` `file.text()` | — |
| Prévisualisation / dry-run | ⚫ | envoi direct | — |
| Import atomique (transaction englobante) | ⚫ | ligne-par-ligne, commits indépendants | — |
| Colonnes catégorie / SKU / stock initial / images / variantes / prix magasin | ⚫ | colonnes canoniques `products.service.ts:24-34` | — |
| Gros volumes (1 000–10 000 lignes) | ⚠️ | pas de limite body configurée (`main.ts`), boucle séquentielle — risque 413/timeout, jamais testé | P0 |

## D. Stock

| Fonction | Statut | Preuve | Niveau |
|---|---|---|---|
| Décrément vente race-safe (`UPDATE … WHERE stock_quantity >= $1 RETURNING`) | ✅ | `sales.service.ts:768-792` + `test/sales-stock-concurrency.pg.spec.ts` (vrai PG, CI) | P4 |
| Deux caisses simultanées : jamais d'oversell, jamais négatif | ✅ | même spec PG (N ventes sur dernières unités) | P4 |
| Retour → restauration stock (+ composants selon snapshot) | ✅ | `returns.service.ts:256-295` | P4 (deltas PG) |
| Void → restauration stock parent | 🟢 | `sales.service.ts:1431-1439` | P3 |
| **Void → restauration composants pack** | 🔴 | `voidSale` ne lit jamais `sale_component_movements` → fuite de stock composants sur void carte d'un pack. Convergence de 3 analyses indépendantes. Aucun test. | P0 (bug) |
| Ajustement manuel (tx + lock + audit + rôles) | 🟢 | `stock.service.ts:110-176`, `stock.controller.ts:45-62` — réserve : `reason` non contraint non-vide | P3 |
| Inventaire scan (atomique, idempotent par `clientEntryId`) | ✅ | `inventory-scan.service.ts:33-182`, `inventory-scan.idempotency.spec.ts` | P3 |
| Réconciliation ≥ 20 % → `pending_review`, correction manager motif allowlist, anti-double-traitement | ✅ | `stock-reconciliation.service.ts:62-124`, bornes 19/20/21 % testées | P3 |
| Réception fournisseur / transfert / dispatch / pertes typées (`loss_breakage/theft/expired/unknown`) | 🟢 | `stock-locations.service.ts:213-485`, motif obligatoire pertes | P3 |
| Journal unifié des mouvements (ventes/retours/ajustements dans `stock_movements`) | 🟠 | ventes/retours/ajustements **n'écrivent pas** le journal ; 2 systèmes (scalaire produit vs multi-emplacements) reliés par `syncLegacyStock` un seul sens (`stock-locations.service.ts:524-537`) ; divergence diagnostiquée (M107) non corrigée | P1 |
| Transferts entre magasins | 🟢 | `transfer`/`dispatch` (système B) — non relié au stock vendable hors syncLegacy | P3 |
| Stock négatif bloqué (vente, ajustements planchers 0) | 🟢 | `sales.service.ts:782`, `stock.service.ts:138-141` | P4 |
| **Sync offline `stockAdjustments` : idempotence + bornes** | 🔴 | `sync.service.ts:206-221` : aucun clé d'idempotence (rejeu = double application), delta non borné (**stock négatif possible**). Aucun test. | P0 |
| Stock réservé vs disponible | ⚫ | inexistant | — |
| Stock par variante | 🟢 | chaque variante = ligne produit avec son stock | P3 |
| Seuils bas/critique + alertes (log/audit + endpoint) | 🟢 | `stock.service.ts:63-105,204-228`, `sales.service.ts:1140-1179` — pas de push/email | P3 |

## E. Packs / produits composés

| Fonction | Statut | Preuve | Niveau |
|---|---|---|---|
| Tables + contraintes (qty>0, parent≠composant, unicité triple) | ✅ | `1754:26-39` | P3 |
| Snapshot figé à la vente, HORS hash fiscal v2 (allowlist) | ✅ | `sales.service.ts:672-689,829`, recomputation testée `product-packs.spec.ts:218-233` | P3 |
| Anti-boucle direct/indirect (BFS, profondeur 50) | 🟢 | `products.service.ts:918-942`, tests direct+indirect | P3 |
| Décrément composants atomique + race-safe dans la tx de vente | ✅ | `sales.service.ts:803-842` + `product-packs-concurrency.pg.spec.ts` (10 ventes ‖, 5 passent, 0 orphelin) | P4 |
| Retour pack selon snapshot (prorata, composition modifiée après vente) | ✅ | `returns.service.ts:273-295`, `product-packs.spec.ts:299-333` | P4 |
| Composant désactivé ignoré (ni décrémenté ni snapshoté) | 🟢 | filtres `is_active` `sales.service.ts:393,810`, testé | P3 |
| Composant sans stock → vente refusée, message explicite, rien d'écrit | ✅ | `sales.service.ts:409-413,823-828`, testé pg-mem + PG | P4 |
| Doublon composant interdit (index + 409) | ✅ | `products.service.ts:957-966` | P3 |
| **Void d'une vente pack** | 🔴 | composants jamais restitués (cf. D) | P0 |
| Packs imbriqués (A⊃B⊃C) | 🟠 | composition l'autorise (acyclique) mais vente/retour **mono-niveau** (`sales.service.ts:804`) → sous-composants jamais consommés. Comportement non spécifié, non testé. | P1 |
| Backoffice section Pack (4 endpoints branchés, erreurs verbatim) | 🟢 | `ProductsPage.tsx:618,737-974`, `api.ts:174-180` | P1 (pas de test UI) |
| Affichage POS de la composition | ⚫ | aucune référence dans `pos-desktop/src` — parent = seule ligne commerciale (conforme à la règle), mais zéro visibilité caissier | — |

## F. Prix / TVA / promotions / remises

| Fonction | Statut | Preuve | Niveau |
|---|---|---|---|
| Cap remise manuelle 30 % côté serveur + code responsable manager/admin obligatoire + approbateur tracé | ✅ | `sales.service.ts:226,502-516`, migration 1742, `discount-enforcement.spec.ts:71-105` | P3 |
| Miroir client du cap 30 % (POS) + événements de score | 🟢 | `discount-policy.ts:10,34-49`, `discount-policy.test.ts` | P2 |
| Prix magasin résolu à la vente (override → ligne → hash) | ✅ | `sales.service.ts:358`, `store-price-override.spec.ts:75-86` | P3 |
| TVA extraite du TTC ligne à ligne après remise | 🟢 | `sales.service.ts:570-577` — duplication formule vs `money.ts:extractTax` inutilisé | P3 |
| Ventilation TVA par taux stockée sur la vente | 🟠 | agrégat seul (`taxTotalMinorUnits`) ; dérivable des lignes ; avoirs recalculent ligne à ligne | P1 |
| Promotions auto (buy_x, percentage, fixed, first_purchase) | 🟢 | `promotions.service.ts:104-160` — `first_purchase` codé en dur 5 % (`:151`), pas de plafond d'usage règles | P2 |
| Codes promo : validate/redeem/reserve-at-sale, cap race-safe dans la tx de vente | ✅ | `promo-codes.service.ts:117-166`, `promo-codes-concurrency.pg.spec.ts` (vrai PG) | P4 |
| Code promo scopé produit/catégorie à la vente | 🟠 | `sales.service.ts:542` valide sans contexte produit → codes scopés toujours refusés (limitation V1 documentée) | P1 |
| Cumul override + promo + remise manuelle + code (additif, lignes clampées ≥0) | ⚠️ | logique présente (`sales.service.ts:461-566`) mais **aucun test d'intégration du cumul** | P1 |
| Retour d'un article remisé : rembourse le prix payé (snapshot ligne) | ✅ | `returns.service.ts:150` | P3 |
| Prix de base négatif refusé côté service | 🟠 | validé sur override (`:85`) et CSV (`:462`) mais pas dans `create/update` (DTO `@Min(0)` seul rempart) | P1 |
| Historique de prix à chaque changement | 🔴 | voir A (écart migration) — fonctionne en test, casse/perd en prod | P3 (test) / P0 (prod) |

## G/H. Codes-barres, scanner, recherche (POS)

| Fonction | Statut | Preuve | Niveau |
|---|---|---|---|
| Scan douchette (champ focalisé + Enter) + caméra ZXing (EAN-8/13, UPC, Code128…) | 🟢 | `POSPage.tsx:414-417,601-607`, `useScannerZXing.ts:311-319` | P4 (e2e smoke) |
| Scan répété → quantité +1 | 🟢 | `posStore.ts:390-408` | P2 |
| Anti-double-scan (<1,5 s) | 🟠 | présent iPad (`useCart.ts:139-147`), **absent desktop** | P1 |
| Normalisation UPC-A↔EAN-13 / zéros de tête | ⚫ | match strict `p.ean === value.trim()` (`POSPage.tsx:541`) | — |
| Produit inconnu → demande d'intégration uniquement (jamais création) | ✅ | `POSPage.tsx:577-594`, invariant testé `posProductCreationGuard.test.ts` | P3 |
| Produit inactif/rupture au scan | 🟠 | ajoutable au panier ; bloqué seulement au paiement (SaleGuards fail-open + erreur serveur) | P1 |
| Plusieurs codes-barres par produit | ⚫ | modèle mono-EAN | — |
| Recherche nom/EAN partielle, insensible casse | 🟢 | `POSPage.tsx:479-489` | P2 |
| Recherche insensible aux accents | ⚫ | aucun `normalize()` | — |
| Wedge clavier global | ⚫ | code mort (`startBarcodeListener` jamais appelé) | — |

## I/J. Vente et retours (backend)

| Fonction | Statut | Preuve | Niveau |
|---|---|---|---|
| Calcul total 100 % serveur (client n'envoie que `{ean, quantity}`) | ✅ | `sales.service.ts:436-588` | P3 |
| Ticket séquentiel sous verrou store + index unique | ✅ | `sales.service.ts:634-650` | P3 |
| Hash chain v2 (allowlist fiscale complète, session/terminal hors hash) | ✅ | `sales.service.ts:665-690`, `sale-m2-hash-fingerprint.spec` | P3 |
| Idempotency-Key : réutilisation → même vente (fast-path + re-check in-tx) | ✅ | `sales.service.ts:290-337,620-630,875-884`, 2 specs | P3 |
| Même clé + paramètres différents → 409 | ⚫ | pas de `requestHash` (`idempotency-key.entity.ts`) → renvoie la vente d'origine silencieusement | — |
| Idempotence sans header (opt-in) | 🟠 | double-clic sans clé = deux ventes ; le POS génère toujours une clé (`idempotency.ts:12-23`) | P2 |
| Capture carte vérifiée serveur (PI succeeded + montant ≥ déclaré, sinon refus/pending) | ✅ | `sales.service.ts:161-223`, `card-capture-verify.spec` (9 cas) | P3 |
| Vente mixte multi-paiements + avoir capé au reste dû | ✅ | `sales.service.ts:590-602,726-742`, `avoir-m1-m3.spec` | P3 |
| Paiement différé (`payment_pending` → régularisation manager) | 🟢 | `sales.service.ts:747-750,1247-1300` | P3 |
| PI Stripe orphelin (capture puis crash avant vente) : balayage serveur | ⚫ | aucune réconciliation Stripe→sales ; reprise = replay client même clé | — |
| Immutabilité : void = UPDATE statut + maillon journal append-only (hash origine intact) | 🟢 | `sales.service.ts:1428-1502`, `void-m4-journal-chain.spec` | P3 |
| Void interdit si cash réalisé (force le chemin avoir) + plafond manager 500 € | ✅ | `sales.service.ts:1368-1415`, `void-cash-realized-guard.spec` | P3 |
| **Vente offline via `/sync/push`** | 🟠 | dédup par `sale.id` client seul ; vente insérée **sans recalcul hash/ticket/stock** (`sync.service.ts:99-147`) → risque intégrité chaîne | P2 |
| Vente offline via POST /sales + Idempotency-Key (voie POS réelle) | 🟢 | file locale persistée localStorage, clé par checkout, FIFO, 4xx définitif/5xx retry (`syncEngine.ts`, `offlineStore.ts:184,528-549`) | P2 |
| Retours : total/partiel/prorata, anti-double-retour cumulatif, avoir séquentiel, journal 4 maillons, atomicité prouvée | ✅ | `returns.service.ts:91-380`, `avoir-d14-atomicity.pg.spec` (vrai PG) | P4 |
| Motif retour obligatoire | 🟠 | imposé sur POST /returns (DTO) ; **pas** sur `/returns/by-ticket` (body brut, `returns.controller.ts:49`) | P3/P1 |
| Retour carte : refund Stripe réel | ⚫ | enregistré (`refundMethod:'card'`) mais aucun `refunds.create` — remboursement manuel | — |
| Reçus/duplicata audités (qui/quand), HTML échappé | 🟢 | `receipts.controller.ts:117-246` | P3 |

## K/N. Multi-tenant, API, BDD

| Fonction | Statut | Preuve | Niveau |
|---|---|---|---|
| Isolation storeId (JWT forcé aux controllers + TenantInterceptor global + scoping service) | ✅ | `products.controller.ts:32-35`, `tenant.interceptor.ts:77-110`, `findOneForStore` `products.service.ts:316-329` | P3 |
| IDOR bloqué (produit/vente/retour/promotion d'un autre magasin → 403/404) | ✅ | `findOneForStore`, `sales.controller.ts:79-80` | P3 |
| Rôles : cashier ne peut ni créer/modifier produit ni ajuster stock | ✅ | `@Roles('admin','manager')` + RolesGuard | P3 |
| `RolesGuard` niveau classe partout sauf StockController (méthode par méthode) | 🟠 | `stock.controller.ts:19,31,46` — fragile aux oublis futurs | P1 |
| Validation DTO globale (whitelist + forbidNonWhitelisted) | ✅ | `main.ts:277-283` | P3 |
| Endpoints `body: any` sans DTO (promo-codes create/validate/redeem, brands/suppliers/categories, components, variants, store-price, returns by-ticket) | 🟠 | `promo-codes.controller.ts:17,34,41`, `products.controller.ts:72-222`, `returns.controller.ts:49` | P1 |
| Pagination plafonnée 100 (produits, ventes, retours, alertes) | 🟢 | `products.service.ts:260-296` | P3 |
| Listes non paginées (promotions, promo-codes, brands, suppliers, categories) | 🟠 | `promotions.controller.ts:39`, `promo-codes.controller.ts:28` | P1 |
| Admin = super-admin global (orgs/units non scopés par enseigne) | ⚠️ | `organizations.controller.ts:30`, `units.controller.ts:28` — à clarifier si org-admins prévus | P1 |
| Rate limiting global 3 paliers (50/s, 1000/min, 30000/h) | 🟢 | `app.module.ts:90-94,150-153` | P2 |
| Règle TypeORM type explicite sur nullable | 🟠 | violations sans crash (types string simples) : `product.entity.ts:29,32`, `price-history.entity.ts:21,24` | P1 |

## L. Backoffice (écran par écran)

| Écran | Verdict |
|---|---|
| Liste produits (recherche/tri/filtres client-side, états vide/chargement) | 🟠 présent+branché mais **cap silencieux à 50** (pagination backend non pilotée) |
| **Création produit** | 🔴 payload ≠ DTO → 400 systématique (`ProductsPage.tsx:241-249`) |
| **Modification produit** | 🔴 même cause |
| Variantes (`/catalog/variants`) | 🟢 create+read (pas d'édition/désactivation) |
| Prix par magasin (`/catalog/store-prices`) | 🟢 complet (fenêtres datées, rétablir base) — mais 🔴 en prod (price_history) |
| Stock / ajustement avec motif (`/stock-alerts`) | 🟢 (quantité absolue, pas delta) |
| Packs / composants (section en édition produit) | 🟢 branché 4 endpoints — accessible uniquement via la modale d'édition |
| Catégories | ⚫ non branché (endpoints backend orphelins, champ texte libre) |
| Marques / fournisseurs | 🟠 create+read seulement ; aucun rattachement au produit dans l'UI |
| Import CSV | 🟢 rapport d'erreurs par ligne honnête |
| Export | 🟢 serveur + client (BOM UTF-8) |
| Historique prix (price-analytics) | 🟢 (`priceHistory` api orpheline) |
| Historique mouvements stock par produit | ⚫ |
| Alertes stock bas (page + widget dashboard) | 🟢 |
| Droits par rôle sur routes front | 🟠 gating sidebar cosmétique, rempart réel = backend |
| Gestion d'erreurs | 🟠 incohérente (`alert()` bloquant vs bandeaux vs `catch {}` silencieux) |

## M. POS Caisse

| Fonction | Verdict |
|---|---|
| Chargement catalogue | 🟠 iPad : montage + polling 15 s + refresh post-vente ; **desktop : une seule fois, aucun refresh** |
| Catalogue offline à froid | 🔴 aucune persistance (ni IndexedDB ni localStorage) → démarrage hors ligne = scan impossible |
| Vente offline (catalogue déjà chargé) | 🟢 file persistée, idempotency key client, anti-fraude offline (plafonds) |
| Sync : détection de conflits | 🟠 stub (`syncEngine.ts:59-83` toujours `hasConflict:false`) ; HMAC device non câblé |
| Recherche | 🟠 partielle+casse OK, accents non gérés |
| Variantes / packs / images / multi-EAN | ⚫ absents du POS |
| Performance gros catalogue | 🟠 tout en mémoire, aucune virtualisation |
| Erreur réseau vs métier, reconnexion, panier conservé | 🟢 (`usePayment.ts:220-276`, ping santé 15 s) |
| Écran client (miroir read-only) | 🟢 |

## O. Preuves d'exécution locales (2026-07-10)

- `npm run test:backend` : **920 verts / 0 échec** (7 skipped = 5 suites PG gated, exécutées en CI).
- `npm run lint` : 0 erreur (59 warnings unused-vars).
- `npm run build:backend` / `build:backoffice` / `build:pos` : ✓ sans erreur TypeScript.
