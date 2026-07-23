# Fiche produit unique (organisation) + affectation multi-magasins — analyse & plan de migration

> 2026-07-23 — dossier de décision. **Aucun code, aucun merge, aucun déploiement sans GO
> nominatif owner** (directive du 2026-07-23 : « Fais d'abord l'analyse de l'existant et
> propose le plan de migration »).

## 1. Constat — le modèle actuel est « une fiche PAR magasin »

| Élément | État actuel (vérifié dans le code @ `main` 4c3ddea) |
|---|---|
| `products` | **1 ligne par magasin** : `store_id NOT NULL`, index unique `(ean, store_id)`, `stock_quantity`, `is_active`/`status` portés par la ligne |
| « Produit dans 2 magasins » | = **2 fiches distinctes** (ids différents) — c'est la conception que l'owner rejette |
| Prix magasin | `store_product_prices` existe déjà (fenêtres programmées) mais **unique sur `product_id` seul** — cohérent avec le modèle par-magasin, à étendre |
| Stock | Sur la ligne produit (décrément vente `sales.service`, ajustements `stock`, inventaires `inventory-scan`, écarts `stock-reconciliation`) ; `stock_movements` porte déjà `store_id` ✔ |
| Référentiels | **Catégories, marques ET fournisseurs sont aussi par magasin** (`unique (store_id, name)`) — une fiche unique org ne peut pas référencer proprement un référentiel de magasin |
| Multi-tenant | `TenantInterceptor` filtre par `storeId` du JWT (admin bypass) |
| POS | Pull complet `GET /products?storeId=<magasin>` (rafraîchi ≤ 15 s + à chaque vente) |
| UI création | Assistant : champ « **Magasin de publication** » (menu déroulant mono-magasin) — le champ à remplacer |
| Couplage code | `products.service.ts` seul : **224 références à `storeId`** ; s'ajoutent sales, stock, imports CSV, bulk actions, stats |

### Données de production (photographie 2026-07-23, session owner)
- **3 produits au total** : 1 × Boutique Paris (témoin 22/07), 2 × The Wesley Test
  (« teste » + « TEST CODE WESLEY — vrac », WES-P-000000000001).
- **0 doublon d'EAN inter-magasins** → aucune consolidation de fiches à opérer.
- Conclusion : **fenêtre idéale** — la migration de données est triviale AUJOURD'HUI ;
  chaque produit importé d'ici là la complexifie.

## 2. Cible (conforme à la directive)

- `products` = **fiche unique au niveau organisation** (nom, code-barres, catégorie, marque,
  photo, TVA, type…). Le code-barres (GTIN ou WES-P) devient **unique org-wide**.
- Nouvelle table **`product_store_assignments`** :
  `product_id` + `store_id` **UNIQUE**, `is_active` (visible/vendable dans ce magasin),
  `stock_quantity` + seuils **par magasin**, horodatage. **Décocher un magasin =
  `is_active=false` — jamais de DELETE** : ventes, prix et stocks passés intacts.
- Prix : prix de base sur la fiche + `store_product_prices` étendu à `(product_id, store_id)`
  unique = prix magasin.
- UI : section « **Magasins dans lesquels ce produit est disponible** » — cases à cocher
  (tous les magasins), Tout sélectionner / Tout désélectionner, précochage du magasin
  contextuel (décochable), libre en Vue globale, **modifiable après création depuis la
  fiche** sans recréer le produit.
- POS : visible/scannable **uniquement si** affecté **ET** actif dans le magasin de la
  caisse ; non affecté ou décoché → absent ; **aucune récupération globale automatique**.

## 3. Plan de migration — 5 phases, chacune additive, testable, réversible

### Phase 0 — Garde-fous (aucun risque)
- Specs PG « photographie » du comportement actuel (list/scan/POS par magasin) pour
  détecter toute régression pendant la transition.
- Contrôle doublons EAN org-wide (fait : 0) — à re-vérifier au moment de chaque phase.

### Phase 1 — Schéma additif (migration 1774, Tier-2 : GO dédié)
- `CREATE TABLE product_store_assignments` (unique `product_id+store_id`,
  `is_active`, `stock_quantity`, seuils, `created_at/updated_at`).
- **Backfill** : 1 ligne par produit existant → (`product_id`, son `store_id` actuel,
  `is_active` = état actuel, stock copié). Les 3 produits prod gardent exactement leurs
  affectations — **aucun produit dupliqué, supprimé ou déplacé**.
- `store_product_prices` : contrainte unique étendue à `(product_id, store_id)`.
- `products.store_id` **conservé tel quel** (legacy) — rien n'est supprimé.

### Phase 2 — Backend en double-écriture / double-lecture (pattern éprouvé du stock-journal F2)
- Écritures stock (vente, ajustement, inventaire) : assignment **ET** colonne legacy.
- Lectures (`list`, `scan`, POS, stats) : via assignment, **fallback legacy** si assignment
  absent (ceinture pendant la transition).
- `TenantInterceptor` inchangé : un caissier ne voit que son magasin — le filtre passe
  simplement de `p.store_id = :x` à `EXISTS (assignment actif pour :x)`.

### Phase 3 — UI + endpoints d'affectation
- Assistant : « Magasin de publication » → section cases à cocher (multi), précochage
  contextuel, Tout sélectionner/désélectionner.
- Fiche en édition : même section, modifiable à tout moment ; `PUT /products/:id/stores`
  (upsert des affectations, désactivation sans suppression).
- Les 6 tests de la directive (cf. §4).

### Phase 4 — Référentiels org-level (chantier séparé mais NÉCESSAIRE à la fiche unique)
- Catégories / marques / fournisseurs : aujourd'hui par magasin → passage org-level
  (dédoublonnage par nom, mapping des références). Peut suivre la phase 3 : en attendant,
  la fiche référence le référentiel du magasin « propriétaire » (compat).

### Phase 5 — Bascule des invariants (après preuve en prod des phases 1-3)
- Index unique `ean` **org-wide** (remplace `(ean, store_id)`).
- Retrait progressif des lectures legacy ; `products.store_id` déprécié — **jamais de
  DROP** tant que tout n'est pas prouvé sur plusieurs semaines d'exploitation.

## 4. Tests exigés (directive) → couverture prévue

| # | Exigence | Preuve prévue |
|---|---|---|
| 1 | Affecté Marseille + Cergy → visible dans les 2 | spec PG assignment + E2E POS-API par magasin |
| 2 | Non coché Châtelet → absent de cette caisse | spec filtrage POS (aucune récupération globale) |
| 3 | Décocher Marseille → retiré de la caisse, historique intact | spec : ventes/mouvements/prix conservés, `is_active=false`, aucun DELETE |
| 4 | Modifier la fiche générale → répercuté partout | spec : update nom/TVA → visible via les 2 magasins (même `product_id`) |
| 5 | Prix et stocks différents par magasin | spec : `store_product_prices` + `assignments.stock_quantity` divergents |
| 6 | Code-barres unique dans toute l'organisation | spec contrainte + 409 à la création (déjà en place pour WES-P, étendu aux GTIN) |

## 5. Risques & points de décision owner

1. **Stock par magasin** : porté par `product_store_assignments` (proposé, simple) ou table
   de stock dédiée ? → proposition : assignment (le journal `stock_movements` reste la
   traçabilité).
2. **Référentiels org (phase 4)** : avant ou après la phase 3 ? → proposition : après,
   avec compat temporaire.
3. **Sort final de `products.store_id`** : dépréciation longue proposée, jamais de DROP
   sans GO dédié.
4. **Sync offline POS** : les caisses gardent un cache — la double-lecture (phase 2)
   garantit qu'aucune caisse ne perd son catalogue pendant la bascule.
5. Migration sur `products` = **Tier-2** : chaque phase avec migration aura son GO propre.

## 6. Archivage automatique des produits inactifs (6 mois) — directive 2026-07-23

> Purge = **archivage réversible par magasin**, jamais de suppression physique.
> S'appuie sur `product_store_assignments` (§2-3) — c'est la **Phase 3b** du plan.

### 6.1 Modèle technique

Extension de `product_store_assignments` (intégrée au DDL de la phase 1 — un seul GO
migration au lieu de deux) :

| Colonne | Rôle |
|---|---|
| `status` | `active` \| `archived_inactivity` \| `archived_manual` (remplace le simple `is_active` du §2 ; motifs distincts obligatoires) |
| `archived_at` / `archived_reason` | date + motif consultables par le responsable |
| `last_sale_at` | dernière vente CE produit / CE magasin — figée au moment de l'archivage (consultation) ; source de vérité = requête ventes au moment du job (pas de dérive de cache) |
| `first_stocked_at` | première entrée en stock dans ce magasin (posée au 1er mouvement d'entrée) |
| `reactivated_at` / `reactivated_by` | réactivation par responsable — **l'horloge repart d'ici** |

**Job quotidien** (`@Cron` 04:00 Europe/Paris — infra `ScheduleModule` déjà en place,
pattern shift-reminders) :

1. Pour chaque affectation `status='active'` : `dernière vente = MAX(sale.created_at)`
   (JOIN `sale_line_items`, produit + magasin) — requête autoritaire, pas de compteur.
2. Point de départ de l'horloge : dernière vente s'il y en a une ; sinon
   `first_stocked_at` ; sinon date d'affectation ; **et jamais avant `reactivated_at`**.
3. Si « six mois complets » écoulés (mois calendaires, strictement) →
   `UPDATE … SET status='archived_inactivity', archived_at=now(), last_sale_at=…
   WHERE id=… AND status='active'` — **transition atomique** : le WHERE garantit
   l'impossibilité d'archivage en double (double exécution du job, deux instances).
4. Uniquement si la ligne a réellement transitionné : entrée d'**audit** (chaîne
   `audit_entries` existante, action `product_store_archived_inactivity`) +
   **notifications** (3 canaux) :
   - responsable du magasin (module `notifications` existant + `notifications_log`) ;
   - back-office (centre de notifications) ;
   - caisse concernée : « Le produit [nom/code] n'a enregistré aucune vente depuis six
     mois et a été retiré du catalogue actif. » (feed lu par le POS à la synchro ≤ 15 s).
5. Fiche générale : si TOUTES les affectations du produit sont archivées (auto ou
   manuel) → `products.status='archived'` (section Produits archivés). La réactivation
   d'un seul magasin la fait ressortir.

**Ce que l'archivage ne touche JAMAIS** : la fiche, les ventes, les mouvements de stock,
les prix, les journaux — aucune ligne supprimée ni modifiée hors la transition de statut
(preuve par diff dans les tests).

**Caisse / scan d'un produit archivé** : la synchro POS inclut les affectations archivées
avec leur statut ; la recherche et la vente ne montrent que l'actif, mais le scan d'un code
archivé affiche : « Produit archivé pour inactivité — réactivation par un responsable
nécessaire. » (fonctionne aussi hors-ligne, le statut étant dans le cache catalogue).

**Réactivation** : fiche produit → section Magasins → badge « Archivé pour inactivité »
(motif + dernière vente + date d'archivage) → bouton Réactiver (rôle manager/admin) →
`status='active'`, `reactivated_at/by`, audit, retour en caisse à la synchro suivante.

### 6.2 Cas limites (et arbitrages proposés)

1. **Réactivé puis toujours pas vendu** → l'horloge repart de `reactivated_at`, sinon
   re-archivage dès le lendemain.
2. **Jamais vendu, jamais stocké** → 6 mois depuis l'affectation.
3. **Frontière des « six mois complets »** : archive si dernière vente `< now − 6 mois`
   stricts (une vente au jour anniversaire garde le produit actif).
4. **Vente offline synchronisée APRÈS archivage** (caisse hors-ligne avec l'ancien
   catalogue) : la vente est **toujours acceptée** (réalité comptable) et met à jour la
   dernière vente. → **Décision owner** : réactivation automatique, ou notification
   « vendu alors qu'archivé » au responsable (proposé : notification, pas d'auto-réactivation).
5. **Produit dans un panier au moment de l'archivage** : la ligne de panier est figée —
   l'encaissement en cours n'est jamais cassé ; le produit disparaît à la synchro suivante.
6. **Réassort récent sans vente** (entrée de stock il y a 1 mois, dernière vente il y a
   8 mois) : la règle des ventes archive quand même. → **Décision owner** : appliquer
   strictement (proposé, conforme à la directive) ou différer si entrée de stock < N mois.
7. **Retours/avoirs** : un avoir n'est PAS une vente — ne réinitialise pas l'horloge
   (proposé ; à confirmer).
8. **Archivage manuel** : motif distinct (`archived_manual`), jamais touché par le job ;
   les deux motifs sont affichés différemment.
9. **Nouveau magasin coché récemment** : horloge depuis l'affectation — aucun archivage
   possible avant 6 mois.
10. **Fuseau** : mois calendaires Europe/Paris ; job idempotent (re-run sans effet).
11. **WES-P vs EAN fabricant** : strictement identiques face à la règle.

### 6.3 Tests exigés (s'ajoutent aux 6 du §4)

| # | Scénario | Attendu |
|---|---|---|
| A1 | Vendu il y a 7 mois à Marseille, 1 mois à Cergy | archivé Marseille, actif Cergy |
| A2 | Jamais vendu, affecté il y a 7 mois | archivé (départ = affectation/1re entrée stock) |
| A3 | Jamais vendu, affecté il y a 5 mois | PAS archivé |
| A4 | Frontière : vente à 6 mois − 1 j / + 1 j | actif / archivé |
| A5 | Job exécuté 2× (ou 2 instances) | UN archivage, UN audit, UNE notification |
| A6 | Archivé dans tous les magasins | fiche générale → Produits archivés ; réactivation d'un magasin → fiche active |
| A7 | Réactivation sans vente ensuite | pas de re-archivage avant 6 nouveaux mois |
| A8 | Scan d'un archivé en caisse | message exact affiché, ajout panier refusé, hors-ligne inclus |
| A9 | Vente offline syncée après archivage | vente acceptée, horloge mise à jour, notification (selon arbitrage cas 4) |
| A10 | Diff avant/après archivage | ventes, prix, stocks, journaux STRICTEMENT identiques ; seule la transition de statut + audit |
| A11 | Notifications | responsable + back-office + caisse reçoivent le message exact |
| A12 | Motifs | archivage manuel et inactivité affichés distinctement, le job ignore le manuel |

## 7. Produit test du 2026-07-23

`WES-P-000000000001` (« TEST CODE WESLEY — vrac 2026-07-23 », id `dbb9ba9f-…`) a été publié
sur The Wesley Test **avant** la directive d'arrêt. Non touché. Options : le laisser (il
servira au test physique douchette/Code 128) ou le passer « Archivé » (1 clic, réversible).
