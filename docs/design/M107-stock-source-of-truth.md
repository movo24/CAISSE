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

## Qui LIT `stock_quantity` (consommateurs — vérifié en lecture, 2026-06-22)
Ce qui fixe la vraie gravité (cf. ta question #3) :
- **Valorisation du stock (analytique management)** : `reports/product-analytics.util.ts:143` → `valeurStockMinorUnits = stockQuantity × priceMinorUnits` (+ stockout, réappro, classification dormant). ⇒ une colonne fausse = **valorisation de stock fausse** = **chiffres de gestion publiés faux**.
- **Garde de disponibilité à la vente** : `sales.service.ts:240` → `if (product.stockQuantity < qty) refuse`. ⇒ une colonne gonflée (décréments perdus après un sync) peut **autoriser une survente** (ou bloquer à tort).
- **Alertes stock bas/critique** : `stock.service.decrementStock` (seuils).
- **Le Z-report FISCAL n'est PAS concerné** : il agrège les **ventes** (`reports.service`), pas le stock. ⇒ la divergence est un **incident de gestion/opérationnel (valorisation + garde de vente)**, **pas** un incident de chiffre fiscal.

**Conséquence sur le plan** : (1) gravité = reporting de gestion + survente possible, pas fiscal ; (2) les valeurs ont **déjà dérivé** à chaque sync passé ⇒ le correctif demande une **réconciliation one-shot** (recompter/recaler), pas seulement une correction en avant. La réconciliation = opération sur le **stock réel** ⇒ sensible, GO + procédé human-validated (cohérent décision 7), jamais de correction silencieuse de masse.

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
