# GO_PC_PACKAGE.md — Dossier de décision P-C (`product_promotions` / M-F)

> **Statut : EN ATTENTE DE GO NOMINATIF.** P-C touche le **calcul du prix en caisse** →
> Tier-2 fiscal. Aucune ligne de code P-C écrite. Ce dossier documente l'impact, le diff
> prévu, le plan de tests, le rollback et une recommandation motivée pour un GO éclairé.
> Décision owner de référence : **D-FP2** (promos cumulables via moteur priorité/exclusions/plafonds).

---

## 1. Ce que ça change au calcul du prix en caisse

**Point unique de résolution aujourd'hui** — `ProductsService.resolveEffectivePrice()`
(`products.service.ts:384-390`), appelé en vente à `sales.service.ts:413`. Son résultat
alimente `lineItem.unitPriceMinorUnits` → total ligne → total vente → **hash fiscal NF525**.

**Résolution actuelle :** `store_product_prices` (override magasin à fenêtre, s'il est actif et dans sa période) **sinon** prix catalogue `product.priceMinorUnits`. Aucune couche promotion.

**Résolution cible (spec §M-F) :** `promotion active la + prioritaire` **>** `override magasin` **>** `prix catalogue`, avec cumul configurable (D-FP2).

### Avant / après sur cas concrets (produit à 10,00 € catalogue)

| Cas | Aujourd'hui | Après P-C |
|-----|-------------|-----------|
| **Promo simple** −20 % active | 10,00 € (ignorée) | **8,00 €** |
| **Promos cumulées** −20 % (prio 10, stackable) + −10 % (prio 5, stackable) | 10,00 € | **7,20 €** (10 → 8,00 → 7,20 ; successif, pas additif) |
| **Promo expirée** (endsAt < now) | 10,00 € | **10,00 €** (ignorée — inchangé) |
| **Override magasin 9,00 € + promo −20 %** | 9,00 € | **8,00 €** (promo prime sur override) |
| **Produit en pack** (le pack a son propre prix ; promo sur un composant) | prix pack | **prix pack inchangé** — la promo se résout sur le produit VENDU (le pack), pas ses composants |
| **Aucune promo** (table vide) | prix courant | **identique** (chemin `resolveEffectivePrice` inchangé) |

---

## 2. Recommandation motivée (règles de résolution)

1. **Ordre** : promotion > override magasin > catalogue (spec).
2. **Cumul successif, pas additif** : chaque % s'applique sur le prix courant (10→8→7,20), jamais somme des % (évite les remises >100 % et le sur-escompte). Motif : standard retail, borne naturellement le total.
3. **Priorité + `stackable`** : on applique d'abord la promo non-stackable la + prioritaire (elle fixe une base) ; puis, si elle est stackable, on empile les stackables suivantes par priorité décroissante, en respectant les **groupes d'exclusion**. Une promo à **prix absolu** (`price_minor_units`) est non-stackable par nature (elle fixe le prix).
4. **Plancher** : le prix final est **borné par `product.min_price_minor_units`** (déjà livré en M-A !) — un cumul ne peut jamais descendre sous le prix minimum autorisé. Plus un plafond de remise optionnel par promo.
5. **Arrondi déterministe** : calcul en centimes entiers, `Math.round` (demi au sup.) **une fois par étape** de cumul, ordre fixé par (priorité desc, id asc) pour la reproductibilité. Motif : évite la dérive de double-arrondi et rend le résultat testable au centime.

**Le test qui le prouve** (voir §4) : `−20 %` puis `−10 %` sur 10,00 € = **7,20 €** exactement, et l'inversion d'ordre d'insertion donne le **même** résultat (déterminisme par priorité, pas par ordre d'insertion).

---

## 3. Diff prévu, fichier par fichier (À VENIR — non écrit)

| Fichier | Nature |
|---------|--------|
| `migrations/1770…-CreateProductPromotions.ts` | **additif** — table `product_promotions` (spec §M-F : `price_minor_units` XOR `percent`, `starts_at/ends_at`, `store_ids jsonb`, `priority`, `stackable`, `revoked_at`) + index `(product_id)` partiel actif |
| `entities/product-promotion.entity.ts` | nouvelle entité (typage TypeORM strict) |
| `common/dto/products.dto.ts` | `CreatePromotionDto` / `UpdatePromotionDto` (XOR prix/%, validators) |
| `products.service.ts` | `resolvePromotions(product, now, storeId)` (moteur §2) + **intégration dans `resolveEffectivePrice`** (promotion > override > catalogue) + CRUD |
| `products.controller.ts` | `GET/POST/PUT/DELETE :id/promotions` (`@Roles('admin','manager')`) |
| `ProductEditPage.tsx` (onglet Promotions) | CRUD promotions réelles (au-dessus du mécanisme override existant, conservé) |

---

## 4. Plan de tests (dont non-régression fiscale)

**Unitaires (moteur, sans DB)** : simple −20 % ; cumul successif −20 %+−10 % = 7,20 € ; déterminisme (ordre d'insertion indifférent) ; promo expirée ignorée ; override battu par promo ; plancher `min_price` respecté ; pack = résolution sur le produit vendu.

**Gated PG (`*.pg.spec.ts`, TEST_DATABASE_URL) — NON-RÉGRESSION FISCALE, le cœur du GO :**
1. **Vente SANS promo** → montants **identiques** au bit près à l'existant + **hash chain intègre** et **inchangé** (le chemin `resolveEffectivePrice` sans promo ne bouge pas).
2. **Vente AVEC promo** → `unitPriceMinorUnits` = prix résolu ; total & TVA cohérents ; hash chaîné valide.
3. **Rejeu / idempotence** d'une vente avec promo : pas de double application.
4. Suite ventes complète (`sale-transaction`, `report`, `money-precision`) : **failure-set inchangé**.

---

## 5. Rollback & sûreté

- Migration **additive** → `down` = `DROP TABLE product_promotions` (réversible, testé up/down/up PG isolé).
- **Inerte par défaut** : `resolveEffectivePrice` ne change de comportement **que s'il existe une ligne de promotion active** pour ce produit/magasin. Zéro promotion → **zéro changement** de prix/hash sur tout le parc. Le risque est borné au produit explicitement mis en promo.
- Optionnel : garde par feature-flag si l'owner veut un interrupteur global.

## 6. Risques & mitigations

| Risque | Mitigation |
|--------|-----------|
| Dérive d'arrondi sur cumul | Arrondi 1×/étape, ordre déterministe (priorité), test au centime |
| Régression hash fiscal | Test gated « vente sans promo = amounts+hash identiques » (bloquant) |
| Sur-escompte / prix négatif | Plancher `min_price_minor_units` + cumul successif (borné) |
| Conflit avec override magasin | Précédence explicite promotion > override, testée |
| Promo sur composant de pack | Résolution sur le produit vendu (le pack), documentée + testée |

---

**Décision demandée :** GO nominatif pour implémenter P-C selon §2/§3, avec la barrière
§4.1 (non-régression hash) comme condition bloquante avant tout merge. En cas de GO, je
livre en zone verte (branche + migration testée PG isolé) et **m'arrête** avant exécution
sur base partagée et avant merge (Tier-2).
