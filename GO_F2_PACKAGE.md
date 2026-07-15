# Dossier de GO — F2 (void inverse + fix G3) & F1b (inventory_adjust shadow)

> **PROPOSITION. Aucune ligne de code de comportement n'est écrite ici.** Deux GO
> nominatifs, indépendants, donnables en lisant une page chacun. Surfaces Tier-2
> (fiscal / stock) → chacun requiert un GO explicite en canal (charte §1/§3).
> Prérequis livrés : [F0+F1](PRODUCTS_FISCAL_STOCK_SYNTHESIS.md).

> **Indépendance & ordre de merge (analyse par diff, 2026-07-16).** Le lot fiscal est
> **fonctionnellement indépendant du catalogue** : intersection des fichiers touchés = 3 docs de
> suivi seulement (aucun fichier de code), et toutes les tables dont il dépend (stock_movements/1735,
> product_components+sale_component_movements/1754, fiscal_journal/1717, credit_notes/1714,
> audit/1744) sont sur `origin/main`. **Véhicule canonique du GO : `feat/stock-journal-nf525-on-main`**
> (branché sur `origin/main`, re-prouvé intégralement) — mergeable **seul**, sans embarquer la refonte
> catalogue. La branche empilée `feat/stock-journal-nf525` reste **archive**. **Aucun ordre
> catalogue→fiscal imposé.** (Merge = Tier-2, GO owner.)

---

## F2 — mouvement inverse `void` + correctif G3

### Objet
Aujourd'hui `voidSale` restaure **seulement les produits parents** et **ignore les
composants de pack** → fuite de stock permanente (**bug G3**). F2 : (a) corrige G3
(restaurer les composants depuis le snapshot figé `sale_component_movements`, exactement
comme le fait déjà `createReturn`), et (b) sous le flag `STOCK_JOURNAL_SHADOW`, écrit les
**mouvements inverses `void`** (parent + composants) dans la même transaction.

### Changement de comportement fiscal exact — cas concret
Vente d'un pack **« Coffret » = 3 × « Mug »**, puis `void` de la vente (sans espèces réalisées) :

| Produit | Sortie à la vente | **Avant F2** (void) | **Après F2** (void) |
|---|---|---|---|
| Coffret (parent) | −1 | **+1** ✅ | +1 ✅ |
| Mug (composant) | −3 | **+0** ❌ (perte fantôme −3) | **+3** ✅ |

Le **hash de la vente d'origine reste intact** (le void reste un maillon append-only sur
`fiscal_journal`, inchangé). Seul le **stock** des composants est corrigé. C'est un
**changement de comportement fiscalement sensible** (le stock physique après void change).

### Diff prévu — fichier par fichier
- **`src/modules/sales/sales.service.ts`** (`voidSale`, ~l.1546-1553) :
  - après la boucle de restauration parent, ajouter une boucle qui relit
    `sale_component_movements WHERE sale_id = :saleId` et fait
    `UPDATE products SET stock_quantity = stock_quantity + quantity_consumed …` par composant
    (miroir exact de `createReturn` l.273-295) — **dans la tx void existante**.
  - sous `stockJournalShadow` : `INSERT stock_movements(type='void', quantity, product_id,
    store_id, sale_id, sale_line_item_id, employee_id/name, reference=ticketNumber,
    occurred_at)` pour parent **et** chaque composant (mouvement inverse).
- **`src/database/entities/stock-movement.entity.ts`** : union `movementType += 'void'`.
- **Aucune** modification de la construction du hash, de `fiscal_journal`, des avoirs, de l'audit.

### Idempotence
Le mouvement `void` porte `sale_id` → couvert par l'index unique partiel F0
`(sale_line_item_id, product_id, movement_type)` : `type='void'` distinct de `'sale'`/
`'pack_consumption'` → un void rejoué (même clé d'idempotence void) n'insère qu'un seul
jeu de mouvements inverses. Garde void-once (`status='voided'` throw) déjà en place.

### Plan de tests (gated PG)
1. **Deltas exacts** : vente pack (−1/−3) → void → stock parent +1, composant +3 (fix G3, rouge→vert).
2. **Mouvements inverses** (flag ON) : void écrit `void` pour parent + composant, quantités exactes.
3. **Hash inchangé** : le hash de la vente voidée et le maillon `fiscal_journal` void sont identiques avant/après (recalcul canonique).
4. **Non-régression** : `avoir-d14-atomicity`, `fiscal-e2e` restent verts ; void interdit si cash réalisé inchangé.
5. **Idempotence** : void rejoué → un seul jeu de mouvements inverses.

### Rollback
Flag OFF → aucun mouvement écrit. Le **fix G3 lui-même** (restauration composants) n'est PAS
sous flag (c'est une correction de bug) → rollback = `git revert` du bloc F2. Additif, aucune
migration. Aucune donnée fiscale réécrite (mouvements append-only).

### Risques
- Le fix G3 change le stock résultant des void de packs déjà en prod-futur → à activer sciemment.
- Double-restore : neutralisé par la garde void-once + idempotence (prouvé au test 5).
- Cas void d'une vente **sans** composants : boucle composant vide → comportement inchangé.

---

## F1b — `inventory_adjust` en shadow (même nature que F1)

### Objet
`stock.adjustStock` modifie le scalaire (audit déjà écrit) mais **n'écrit aucun mouvement**.
Sous `STOCK_JOURNAL_SHADOW`, écrire un mouvement `inventory_adjust` = **complète la couverture
shadow** pour que `SUM(mouvements)` devienne comparable au scalaire (cf. dette [[TECHNICAL_DEBT]]).
Surface nommée (stock) → GO requis, mais **même nature que F1** (flag OFF, additif, réversible).

### Diff prévu
- **`src/modules/stock/stock.service.ts`** (`adjustStock`, tx ~l.122-151) : sous flag, dans la
  tx existante, `INSERT stock_movements(type='inventory_adjust', quantity, product_id, store_id,
  reason, employee_id, employee_name=employeeId)` avec `delta = saved.stockQuantity − oldQty`.

### Décision de signe — RECOMMANDATION (à valider, pas une question ouverte)
**Proposition : `quantity` SIGNÉ pour `inventory_adjust` uniquement** (`quantity = delta = new − old`,
donc négatif pour une casse, positif pour une régularisation à la hausse).
**Motivation :** (1) la réconciliation (`RECONCILE_SQL`) traite déjà `inventory_adjust` en
`+quantity` — un delta signé s'y agrège **exactement** (`SUM(delta) == variation du scalaire`),
sans convention de sens supplémentaire ; (2) un ajustement absolu (`mode='absolute'`) n'a pas de
sens `in`/`out` intrinsèque — seul le delta est univoque ; (3) l'alternative (deux types
`adjust_in`/`adjust_out`, ou `quantity` positif + colonne de direction) alourdit l'enum et la
requête sans gain. La règle « quantity toujours positif » reste vraie pour tous les **autres**
types (le sens y vient du couple `from/to_location` ou du type) ; `inventory_adjust` est
l'**exception unique et documentée**.
**Cas de test qui la prouve (gated PG) :** produit stock 20 → `adjustStock(delta −5)` → un mouvement
`inventory_adjust quantity=−5` ; puis `adjustStock(absolute 30)` (old 15 → new 30) → un mouvement
`inventory_adjust quantity=+15` ; et `RECONCILE_SQL` : le `gap` **reste constant** après ces deux
ajustements (le journal suit désormais le scalaire) — c'est-à-dire l'inverse exact du 3ᵉ test de
`stock-reconciliation-readonly.pg.spec.ts`, où l'adjust non couvert faisait varier le `gap`.

### Tests (gated PG) / Rollback / Risques
- Tests : voir le cas ci-dessus (delta négatif + absolu → delta positif, `gap` constant) ; flag OFF → aucun mouvement ; audit inchangé.
- Rollback : flag OFF (aucun mouvement) ; additif, pas de migration.
- Risque : la seule zone à verrouiller au GO est la convention de signe ci-dessus — **recommandation ferme : delta signé**.

---

## Ce qu'il vous suffit de dire (GO nominatifs)
- **« GO F2 »** — void inverse + fix G3 (avec le changement de comportement du tableau ci-dessus).
- **« GO F1b »** — inventory_adjust en shadow, **convention `delta` signé** validée.

Restent gatés au-delà : F3 (bascule de lecture + cutover solde d'ouverture), F4 (retrait legacy),
activation du flag hors test local, tout merge.
