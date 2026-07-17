# Fiche produit ERP — Architecture cible (à VALIDER avant tout développement)

> Statut : PROPOSITION. Aucune implémentation avant validation owner.
> Principes ratifiés : aucune donnée fictive · aucun champ simulé · aucun faux bouton ·
> migrations propres (additives, testées sur PostgreSQL réel up/down/up) ·
> migration `products` = Tier-2 (GO owner explicite).
> Base : Phase 1 livrée (page 11 onglets, scan-first, marge auto — commit 0eba794).

## 1. Base de données (migrations additives, numérotation à la pose)

### M-A `products` — extension (colonnes nouvelles, toutes nullables)
```
long_designation varchar(300) · internal_description text · receipt_description varchar(80)
upc varchar(20) · internal_code varchar(40) · manufacturer varchar(120)
lifecycle_status varchar(20) DEFAULT 'active'   -- active|inactive|discontinued|seasonal
   (≠ `status` existant qui est le WORKFLOW draft/pending_validation/… — on ne le détourne pas)
min_price_minor_units int · recommended_price_minor_units int
weight_gross_g int · weight_net_g int · width_mm int · height_mm int · length_mm int
volume_ml int · package_dims jsonb · pallet_dims jsonb
stock_reserved int DEFAULT 0 · stock_min int · stock_max int · stock_safety int
aisle varchar(40) · shelf varchar(40) · level varchar(40)   -- rayon/allée/niveau (texte court)
tags jsonb DEFAULT '[]'
```
Calculés, JAMAIS stockés : stock disponible (= actuel − réservé), valeur du stock
(= stock × PA), coefficient multiplicateur (= PV TTC / PA HT), rotation, classement ABC,
dernière entrée/sortie (dérivés des mouvements existants `stock-locations`/ventes).
L'emplacement structuré réutilise le module `stock_locations` existant (liaison), les
3 champs texte couvrent le marquage simple en magasin.

### M-B `product_categories` — hiérarchie (catégorie > sous-catégorie > famille > sous-famille)
```
id uuid PK · store_id · parent_id uuid NULL (FK self) · name varchar(120) · level smallint
UNIQUE(store_id, parent_id, name)
products.category_node_id uuid NULL (FK)  -- `category_id` texte existant conservé (legacy, lecture)
```

### M-C `product_images` — multi-photos
```
id uuid PK · product_id FK CASCADE · url text · kind varchar(12)  -- main|face|back|detail|other
position smallint · created_at
UNIQUE partiel (product_id) WHERE kind='main'
```
**Décision owner D-FP1 — stockage** : (a) data-URL en base (immédiat, alourdit la DB) vs
(b) stockage objet (R2/S3, endpoint upload dédié — recommandé au-delà de quelques photos).

### M-D `product_suppliers` — multi-fournisseurs avec méta
```
id uuid PK · product_id FK · supplier_id FK · is_primary bool
supplier_reference varchar(80) · last_price_minor_units int · purchase_currency varchar(3)
moq int · lead_time_days int · incoterm varchar(10)
last_order_at / last_delivery_at timestamptz NULL   -- alimentés par le futur module commandes ;
                                                    -- affichés « — » tant qu'aucune commande réelle
UNIQUE(product_id, supplier_id) · un seul is_primary par produit (index partiel)
+ extension `suppliers` : address varchar(300), website varchar(200), contact_name varchar(120)
```

### M-E `product_audit_log` — historique COMPLET des modifications (append-only)
```
id uuid PK · product_id · changed_by uuid · changed_by_role varchar(20)
field varchar(60) · old_value text · new_value text (bornés) · reason varchar(300)
changed_at timestamptz DEFAULT now() · INDEX(product_id, changed_at)
```
Écrit dans la MÊME transaction que l'update (diff champ par champ côté service).
`price_history` existant conservé (source de l'historique prix/marges — la marge
historique se dérive de prix+coût à date, pas de duplication).

### M-F `product_promotions` — promotions multiples et datées
```
id uuid PK · product_id · price_minor_units int NULL · percent numeric NULL (XOR prix/%)
starts_at / ends_at · store_ids jsonb NULL (null = tous) · priority smallint DEFAULT 0
stackable bool DEFAULT false · created_by · created_at · revoked_at NULL
```
Résolution en caisse : promo active de plus haute priorité ; `store_product_prices`
existant conservé (override permanent par magasin) — ordre documenté :
promotion > prix magasin > prix catalogue. **Décision owner D-FP2** : règles de cumul
exactes (avec codes promo/coupons existants).

### M-G `user_saved_filters` — filtres enregistrables du catalogue
```
id uuid PK · employee_id · page varchar(30) · name varchar(60) · config jsonb · created_at
```

## 2. API (extensions ; contrôle admin/manager comme aujourd'hui)
- `POST/PUT /products` : DTO étendus aux nouveaux champs (validators stricts).
- `GET /products` (recherche/catalogue) : filtres `ean|sku|name|namePrefix|brandId|
  categoryNodeId|supplierId|priceMin/Max|stockMin/Max|tag|lifecycleStatus`, tri multiple
  `sort=stock:asc,name:desc`, `groupBy=category|supplier|brand`, pagination.
- `GET/POST/PUT/DELETE /products/:id/images` + `PUT /products/:id/images/reorder`
  (+ `POST /uploads` si D-FP1=b).
- `GET/POST/PUT/DELETE /products/:id/suppliers`.
- `GET /products/:id/audit` (paginated) · `GET /products/:id/stats` (agrégat réel :
  CA, quantités, panier moyen contenant le produit, marge générée, nb ventes, rang,
  comparaison période, série temporelle — depuis les ventes réelles, module
  product-analytics étendu).
- `GET/POST/PUT/DELETE /products/:id/promotions`.
- `GET/POST/DELETE /me/saved-filters`.
- Scanner intelligent : `GET /products/scan/:ean` inchangé + **enrichissement externe
  optionnel** `GET /product-integration/lookup/:ean` (connecteur configurable —
  ex. Open Food Facts / catalogue fournisseur s'il expose une API). **Décision owner
  D-FP3** : quelle(s) source(s) externe(s) ; sans config → le bouton n'apparaît PAS
  (aucun faux bouton).

## 3. Interface
- **Fiche** : les 11 onglets Phase 1 conservés, chaque encadré « Phase 2 » remplacé par
  les champs réels ci-dessus. Tarification : + prix min/conseillé (le PV < min est bloqué
  UI + serveur), coefficient affiché, historique prix ET marges (dérivé). Stock : réservé/
  disponible/min/max/sécurité, emplacement (module réel + rayon/allée/niveau), rotation &
  ABC calculés, dernière entrée/sortie réelles, valeur du stock. Packs : + coût réel du
  pack (Σ coûts composants), marge réelle du pack, visualisation simple (liste pondérée →
  graphique barre). Variantes : photo par variante (via product_images de la variante).
  Historique : product_audit_log + price_history fusionnés chronologiquement.
- **Catalogue** (`/products`) : vue tableau ↔ cartes, colonnes personnalisables
  (persistées dans saved-filters), tri multiple, regroupements, recherche instantanée
  (debounce), filtres modernes + enregistrables.
- Composants : conventions existantes (pas de nouveau design system), accent #E5117A.

## 4. Phasage proposé (chaque phase = migration testée PG réel + PR + GO)
1. **P-A** M-A + M-D + M-E (cœur ERP : champs, fournisseurs, audit complet) + DTO/UI.
2. **P-B** M-C images (selon D-FP1) + M-B catégories hiérarchiques + UI.
3. **P-C** M-F promotions + résolution caisse (Tier-2 : touche le calcul de prix en
   caisse → tests de non-régression ventes complets).
4. **P-D** Catalogue (M-G, recherche étendue, vues) + stats enrichies + scanner enrichi
   (selon D-FP3).

## 5. Décisions owner requises avant GO
| # | Décision |
|---|---|
| D-FP1 | Stockage images : data-URL en base vs stockage objet (R2/S3) — recommandé : objet |
| D-FP2 | Règles de cumul promotions (entre elles + avec codes promo/coupons) |
| D-FP3 | Source(s) du catalogue externe pour l'enrichissement scan (OFF ? fournisseur ?) |
| D-FP4 | Catégories : bascule hiérarchique (M-B) ou texte simple conservé un temps |
| D-FP5 | GO global schéma + ordre des phases |
