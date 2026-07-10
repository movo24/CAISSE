# PRODUCTS_GAPS — Manques et casses du système produits

> Audit 2026-07-10, `main` @ `5526834`. Complément de `PRODUCTS_FUNCTIONAL_MATRIX.md`.
> Classement : P0 bloquant magasin · P1 risque financier/stock · P2 fonctionnement incomplet · P3 amélioration.

## 🔴 CASSÉ

| # | Fonction | Blocage | Conséquence | Correction requise | Effort |
|---|---|---|---|---|---|
| G1 | **Création/modification produit (backoffice)** — P0 | `ProductsPage.tsx:241-249` envoie `{price, stock, category, storeId}` ; DTO exige `priceMinorUnits` (requis), `stockQuantity`, `categoryId` ; `forbidNonWhitelisted` → 400 systématique | Impossible de créer/éditer un produit depuis l'écran principal du backoffice (l'API, l'import CSV et les écrans satellites fonctionnent) | Mapper le payload + exposer les champs manquants (coût, TVA, description, seuils) | S |
| G2 | **`price_history` : écart entité↔migration** — P0 | Entité écrit `store_id/change_source/changed_by_role` (`price-history.entity.ts:22-31`) ; table migrée = 7 colonnes seulement (`1700:286-294`), aucun ALTER | En prod (`synchronize:false`) : pose/retrait d'un **prix magasin plante** (`products.service.ts:98,126` non protégés) ; historique de prix du `update()` **perdu silencieusement** (`:355-368`) | Migration additive (3 colonnes nullable) — ⚠️ migration produits = Tier-2, GO owner requis | S |
| G3 | **Void d'une vente pack : composants non restitués** — P1 (risque stock) | `voidSale` (`sales.service.ts:1431-1439`) ne relit pas `sale_component_movements` (le retour le fait, `returns.service.ts:273-295`) | Void carte d'un pack = fuite définitive de stock sur tous les composants ; écart d'inventaire inexpliqué | Restaurer les composants depuis le snapshot dans la tx de void + test dédié — ⚠️ surface vente/fiscal = GO owner requis | S/M |
| G4 | **Sync offline `stockAdjustments` : rejouable et non borné** — P1 | `sync.service.ts:206-221` : aucune clé d'idempotence, `stock_quantity + :delta` sans condition | Rejeu réseau = double application des deltas ; delta négatif → **stock négatif** en base | Clé d'idempotence par ajustement (type `clientEntryId`) + borne `GREATEST(0, …)` ou décrément conditionnel + tests | M |
| G5 | **POS : catalogue non persistant** — P0 (magasin hors ligne au démarrage) | Catalogue uniquement en state React ; IndexedDB réservé aux médias écran client | Coupure réseau au démarrage = caisse incapable de scanner/vendre | Persister le catalogue (IndexedDB) + charge au boot + invalidation | M |

## 🟠 PARTIEL (risque réel)

| # | Fonction | Ce qui marche | Ce qui manque | Impact magasin | Priorité |
|---|---|---|---|---|---|
| G6 | `/sync/push` ventes offline | dédup par `sale.id`, storeId forcé serveur | pas de recalcul hash/ticket/stock ; hash client cru | chaîne fiscale polluable par un client bogué/malveillant (la voie POS réelle passe par POST /sales, saine) | P1 |
| G7 | Cohérence `isActive`/`status` | intégration produit aligne les deux | `update()` écrit `isActive` brut ; la vente ne filtre que `is_active` | produit « archivé » revendable après un update isActive=true | P1 |
| G8 | Idempotence vente | même clé → même vente | pas de `requestHash` → clé réutilisée avec panier différent = vente d'origine renvoyée en silence (pas de 409, exigence CLAUDE.md non tenue) | encaissement trompeur en cas de bug client | P1 |
| G9 | Retour carte | avoir + journal + montants corrects | aucun refund Stripe exécuté (enregistrement seul) | remboursement carte à faire à la main sur le dashboard Stripe — risque d'oubli | P1 |
| G10 | Motif de retour | obligatoire sur POST /returns | non imposé sur `/returns/by-ticket` (body brut) | retours offline sans motif → traçabilité incomplète | P1 |
| G11 | PI Stripe orphelin | vente refusée si PI invalide ; replay même clé récupère | aucun balayage serveur des PI capturés sans vente (crash avant commit) | argent encaissé sans ticket jusqu'à intervention manuelle | P1 |
| G12 | Journal de stock unifié | mouvements B (réception/transfert/perte) journalisés | ventes/retours/ajustements hors journal ; 2 systèmes divergents (diag M107 read-only) | traçabilité « qui a bougé ce stock » incomplète pour l'exploitation | P2 |
| G13 | Import CSV | upsert + rapport d'erreurs propre | séparateur `;`, encodage, dry-run, transaction, colonnes (catégorie/SKU/stock/prix magasin), limite body non configurée (413 probable sur gros fichiers) | import de catalogue réel français (Excel) souvent impossible | P2 |
| G14 | Packs imbriqués | anti-cycle OK | vente/retour mono-niveau : sous-composants ignorés | compo à 2 niveaux = stock des sous-composants faux | P2 (ou interdire) |
| G15 | Backoffice liste produits | recherche/tri/filtres | pagination non pilotée → cap silencieux à 50 produits | catalogue > 50 invisible dans le backoffice | P2 |
| G16 | Catégories | table + endpoints existants | non branchés dans l'UI ; `category` texte libre ≠ `categoryId` ; hiérarchie morte | taxonomie catalogue inexploitable | P2 |
| G17 | Marques/fournisseurs sur la fiche produit | tables + création à la volée CSV | `brandId`/`supplierId` absents des DTO produit et de l'UI ; pas de référence fournisseur | réassort par fournisseur impossible | P2 |
| G18 | POS scan | douchette champ focalisé + caméra | pas de normalisation UPC-A↔EAN-13/zéros de tête ; anti-double-scan absent du desktop ; accents non gérés ; inactif/rupture ajoutables au panier (bloqués seulement au paiement) | scans ratés ou quantités doublées en caisse | P2 |
| G19 | Remises cumulées | chaque mécanisme testé isolément | aucun test d'intégration override+promo+manuel+code | comportement du cumul non prouvé | P2 |
| G20 | Ajustement stock | tx + lock + audit | motif non contraint non-vide | ajustements sans justification possible | P2 |
| G21 | Endpoints `body: any` | types structurels TS | pas de DTO class-validator (promo-codes, brands, suppliers, categories, components, variants, store-price, returns by-ticket) | validation d'entrée incomplète | P2 |
| G22 | Rôles front backoffice | rempart backend réel | routes front accessibles par URL (gating sidebar cosmétique) | confusion utilisateur, pas de faille sécurité réelle | P3 |
| G23 | Prix de base négatif | DTO `@Min(0)` | pas de garde service dans create/update (incohérent avec override/CSV) | défense en profondeur incomplète | P3 |
| G24 | `first_purchase` | promo appliquée | pourcentage codé en dur 5 % (ignore la règle) | promo mal paramétrable | P3 |
| G25 | Marges | marge courante calculée | pas de coût historique/CMUP (`costBasis:'current_cost_approx'`) | marges passées approximatives | P3 |

## ⚫ ABSENT (fonctions non construites)

| Fonction | Conséquence | Priorité |
|---|---|---|
| Duplication produit | ressaisie complète | P3 |
| Attributs normalisés (taille/couleur), poids/dimensions/conditionnement | pas de matrice de déclinaisons | P3 |
| Prix barré (`old_price_minor_units` jamais écrit) | affichage promo « avant/après » impossible | P3 |
| Multi-codes-barres par produit | produits multi-références fournisseur non scannables | P2 |
| Variantes au POS (sélecteur/résolution SKU) | vente d'une variante = scan direct de son EAN uniquement | P2 |
| Images produit au POS | grille par couleurs de catégorie | P3 |
| Stock réservé/disponible | pas de réservation panier | P3 |
| Tests E2E HTTP, tests UI backoffice, tests de charge, tests de migration | preuve d'intégration bout-en-bout limitée | P2 |
| Notifications push/email d'alerte stock | alertes = logs/audit/endpoint seulement | P3 |
| Écran historique des mouvements de stock par produit | investigation d'écart manuelle en SQL | P3 |

## Ce qui est SOLIDE et ne bloque rien (rappel)

Le cœur transactionnel est le point fort du système : calcul de vente 100 % serveur, hash fiscal v2,
idempotence de la voie POS réelle, capture carte vérifiée serveur, cap remise 30 % + approbateur,
codes promo race-safe, décrément stock conditionnel prouvé sous concurrence réelle, packs
(vente/retour) avec snapshot figé, avoirs D1.4 scellés et atomiques, isolation multi-tenant.
Voir `PRODUCTS_FUNCTIONAL_MATRIX.md`.
