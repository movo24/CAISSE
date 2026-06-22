# M107 — Source unique du stock réel (pré-design, lecture seule)

> Note d'analyse pour décision owner. **Aucun code touché.** Le sujet est sensible
> (stock réel + flux de vente déjà utilisé) → pas d'implémentation avant GO + choix d'option.
> Réf dette : `TECHNICAL_DEBT.md` D11.

## Le problème, mécanisme exact (vérifié dans le code)
Deux écritures concurrentes sur `products.stock_quantity`, sans source unique :

1. **Ventes / retours** décrémentent **la colonne legacy** directement, dans la transaction de vente :
   - `sales.service.ts:591` → `UPDATE products SET stock_quantity = GREATEST(0, stock_quantity - $1) WHERE id=$2 AND store_id=$3`
   - retour : `sales.service.ts:1185` → `stock_quantity = stock_quantity + $1`
   - ⇒ les ventes **ne touchent PAS** `stock_balances` (multi-emplacements).

2. **Opérations stock-locations** (réception, transfert, dispatch, perte) écrivent `stock_balances`, puis appellent `syncLegacyStock` :
   - `stock-locations.service.ts:435` → `syncLegacyStock` : `SELECT COALESCE(SUM(sb.quantity),0) ... ; UPDATE products SET stock_quantity = $1 WHERE id = $2`
   - ⇒ **écrase** `products.stock_quantity` par la **somme des balances**.

### Conséquence (divergence silencieuse)
Après des ventes (colonne décrémentée, balances inchangées), la **première** op stock-locations qui appelle `syncLegacyStock` **réécrit** `stock_quantity = SUM(balances)` → **les décréments de vente depuis le dernier sync sont perdus** (le stock « remonte »). Inverse aussi vrai : les balances ignorent les ventes. Aucune des deux n'est faisant autorité ; elles se contredisent.

## Interaction fiscale (important pour le périmètre)
- Le **niveau de stock n'entre PAS dans la chaîne de hachage** des ventes (le hash couvre items/quantités/montants/paiements, pas le stock courant). Donc changer la source de vérité du stock **ne modifie pas** la chaîne fiscale.
- MAIS le décrément de stock se fait **dans la transaction de vente**. Toute option qui change ce que la tx de vente écrit (option B) touche un **flux déjà utilisé** → sensible, à tester avec soin (atomicité, race, rollback).
- À vérifier avant build : la valorisation d'inventaire / Z-report lit-elle `stock_quantity` ou les balances ? (impacte le choix).

## Options
**A. Colonne legacy = source de vérité (mono-magasin), stock-locations = réseau/entrepôt seulement.**
- `syncLegacyStock` cesse d'écraser la quantité vendable du magasin (ou ne gère qu'un emplacement « réseau » distinct du sellable).
- Touche : `stock-locations.service.ts` (le sync). **Ne touche pas** le flux de vente. Plus petit, plus sûr.
- Limite : pas de vérité multi-emplacements unifiée pour le sellable.

**B. `stock_balances` = source de vérité unique ; colonne legacy = cache dérivé.**
- Les ventes décrémentent la balance d'un emplacement « magasin » (+ émettent un mouvement `sale`), la colonne devient un reflet.
- Touche : **le flux de vente** (sales.service decrement) + stock-locations. Plus gros, sensible (atomicité in-tx, concurrence). Cohérent à long terme (multi-emplacements réel).

**C. Réconciliation (court terme, sans trancher).**
- `CHECK (quantity >= 0)` sur `stock_balances` ; empêcher `syncLegacyStock` d'écraser quand le magasin a un sellable legacy plus récent (timestamp/garde) ; tâche de réconciliation qui signale les divergences (pas de correction auto, cf. décision 7).

## Recommandation
Pour un POS mono-magasin aujourd'hui : **A** (sûr, ne touche pas la vente) + le **garde de C** (`CHECK >= 0` + arrêter l'écrasement) comme filet. **B** est la cible si/quand le multi-emplacements devient réel — à planifier comme lot dédié avec design de concurrence in-tx, pas en passant.

## Ce qu'il faut de l'owner pour donner le GO
1. Choix A / B / C.
2. Confirmer ce que lit la valorisation/Z (colonne vs balances).
3. Si B : valider que toucher le décrément in-tx de la vente est acceptable (re-tests fiscaux + concurrence).

## Plan de test (à l'implémentation, après GO)
- gated real-PG : concurrence vente × syncLegacyStock (pas de perte de décrément) ; `CHECK >= 0` ; pour B, atomicité décrément balance + mouvement `sale` + rollback.
- pg-mem : direction des écritures (limites pg-mem connues sur l'arithmétique stock → assertions de direction).
