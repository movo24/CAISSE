# PRODUCT_VARIANTS_DECISION.md — Modèle des variantes produit (TD-PRODUCT-VARIANTS)

> P321 (cycle I4) — 2026-07-02. Décisions produit DÉJÀ actées par toi : variantes/SKU **oui** · prix par magasin **oui** · marque/fournisseur **oui** · doublons **interdits**. Ce qui reste à trancher : LE MODÈLE. 3 options ci-dessous, une recommandation, zéro migration exécutée (préparation invasive = risque sans ton choix).

## 0. État vérifié du code

`products` aujourd'hui : `id, ean (unique/magasin), name (+normalized_name dédup), price(+override/magasin), cost, tax, stock(+seuils+baseline), category_id, unit_type(unit|weight), image, is_active, store_id`. **Aucune notion de variante, de marque ni de fournisseur.** Tout le POS (vente, stock, promos, analytics, journal P306) est indexé sur `product.id`+`ean` — c'est l'invariant à ne pas casser.

## 1. Les 3 modèles possibles

### Option A — « la variante EST un produit » + parent facultatif (recommandée)
Chaque variante (Fraise 100 g, Fraise 250 g) reste une ligne `products` à part entière avec SON ean, SON prix, SON stock, SES seuils — exactement comme aujourd'hui. On ajoute :
- `parent_product_id` (uuid nullable, auto-référence) : les variantes pointent leur produit « parent » (le parent peut être un produit vendable ou un simple regroupement `is_active=false`) ;
- `variant_label` (varchar nullable : « 100 g », « Citron ») ;
- `brand` (varchar nullable) et `supplier_id` (uuid nullable → table `suppliers` minimale : id, name, contact — la marque est déclarative, le fournisseur est un référentiel).
- Dédup : l'unicité `(ean, store_id)` existante couvre déjà les doublons de variantes ; la dédup nom normalisé s'applique au nom COMPLET (« Fraise Tagada 100g » ≠ « Fraise Tagada 250g » → pas de faux positif).

✅ **Zéro impact sur le POS** : la caisse continue de scanner/vendre des `products` — le décrément, la hash-chain, le journal P306, les promos, l'override prix/magasin marchent SANS modification. Migration additive nullable (même famille que 1723/1726). Le front gagne juste un regroupement visuel.
⚠️ Limite : pas d'« attributs structurés » (taille/parfum en colonnes typées) — le label est libre. Suffisant pour une confiserie ; extensible plus tard (option B) sans casse.

### Option B — attributs structurés (table `product_variants` + `variant_attributes`)
Produit maître + table de variantes portant des combinaisons d'attributs typés (axe taille × parfum), l'EAN/prix/stock descendant au niveau variante.
✅ Puissant pour du textile (matrices tailles/couleurs). ❌ Pour POSC : TOUTES les FK du POS (lignes de vente, stock, promos, journal, analytics) doivent basculer de `product_id` vers `variant_id` → refonte du chemin argent + grosse migration de données + re-test complet. Disproportionné pour le besoin confiserie actuel.

### Option C — attributs JSON sur `products`
`variants jsonb` sur le produit maître (liste embarquée avec ean/prix/stock par entrée).
❌ Le stock et l'EAN dans un JSON = plus d'index unique `(ean, store)`, plus de décrément atomique simple, dédup et alertes à réécrire. Fragilise des invariants prouvés. Rejetée.

## 2. Recommandation

**Option A.** Elle honore les 4 décisions produit (variantes, prix/magasin déjà livré par produit donc par variante, marque/fournisseur, doublons via l'unique existant), ne touche à AUCUN invariant caisse, et se livre comme d'habitude : 1 migration additive nullable (`parent_product_id`, `variant_label`, `brand`, `supplier_id`) + table `suppliers` + endpoints CRUD fournisseur + regroupement UI + specs pg-mem. Un cycle de 5 blocs. Réversible (colonnes nullables, down() propre).

## 3. Impacts si GO option A

| Couche | Impact |
|---|---|
| Schéma | migration 1727 additive (4 colonnes nullables + table suppliers + index parent) — dry-run pg-mem comme 1726 |
| API | `POST/GET /suppliers` (CRUD léger) ; `products` accepte/expose les 4 champs ; filtre `?parentId=` |
| POS caisse | **AUCUN** (scan EAN → produit, inchangé) |
| Back-office | ProductsPage : champs marque/fournisseur/parent + regroupement des variantes sous le parent |
| Tests | dry-run migration, dédup inter-variantes, CRUD supplier, tenant |
| Dédup | inchangée : `(ean, store)` unique + nom normalisé (les libellés de variantes diffèrent naturellement) |

## 4. Ce que j'attends de toi

Un mot : **« GO variantes option A »** (ou B si tu assumes la refonte, mais je la déconseille formellement). Sans ça, rien ne bouge — cette note remplace TD-PRODUCT-VARIANTS comme référence.
