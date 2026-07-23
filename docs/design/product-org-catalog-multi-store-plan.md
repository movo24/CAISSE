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

## 6. Produit test du 2026-07-23

`WES-P-000000000001` (« TEST CODE WESLEY — vrac 2026-07-23 », id `dbb9ba9f-…`) a été publié
sur The Wesley Test **avant** la directive d'arrêt. Non touché. Options : le laisser (il
servira au test physique douchette/Code 128) ou le passer « Archivé » (1 clic, réversible).
