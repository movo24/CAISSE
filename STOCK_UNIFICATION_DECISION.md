# STOCK_UNIFICATION_DECISION.md — Dossier d'arbitrage TD-STOCK-TWO-SYSTEMS

> P304 (bloc D4) — 2026-07-02. **Décision produit/architecture NON tranchée** : ce dossier cadre les options et une recommandation ; rien n'est exécuté sans ton GO. Tout ce qui suit est vérifié dans le code.

## 1. Le problème (prouvé)

Deux systèmes de stock coexistent sans se parler :

| Système | Clé | Écrit par | Lu par | Testé |
|---|---|---|---|---|
| **A — compteur** `products.stock_quantity` | magasin | `sales.service` (décrément atomique à la vente), `returns` (re-crédit), `stock.service` (adjust), `inventory-scan` (apply), `sync` (deltas offline) | POS, alertes 20 %, variance, analytics | ✅ pg-mem P278/P301 + e2e |
| **B — journal** `stock_movements` + `stock_balance` | `stock_locations` (entrepôt/magasin) | `stock-locations.service` uniquement (réceptions, transferts, dispatch) | écrans stock-locations | ✅ specs module |

Constats vérifiés :
- Le commentaire de `stock-movement.entity.ts` prétendait que les ventes créent un mouvement — **FAUX** (corrigé P304) : aucune vente/retour n'écrit dans le journal B.
- `stock-locations.service` maintient une **rétro-compat partielle** : après ses opérations, il resynchronise `products.stock_quantity` = somme des balances магasin (`UPDATE products SET stock_quantity…`, L376-389). L'inverse n'existe pas : une vente ne touche jamais B.
- Conséquence : dès qu'un magasin utilise les deux (réceptions par B, ventes par A), **B diverge de la réalité à la première vente** ; le journal ne peut pas servir de source d'audit des mouvements (POS-081/082 non branchables en l'état).

## 2. Ce que ça bloque

- POS-081/082 (journal de mouvement à la vente/retour — traçabilité entrepôt↔magasin).
- Toute valorisation de stock « au fil de l'eau » multi-emplacements.
- La promesse implicite du module stock-locations (balance = vérité) est fausse en magasin.

## 3. Options

### Option 1 — A reste maître ; B devient dérivé (recommandée)
La vente/le retour/l'ajustement émettent un **mouvement** dans B (append-only) dans la même transaction, via un mapping `store_id → stock_location(type='store')` créé paresseusement. `stock_balance` magasin devient une **projection** reconstruite depuis les mouvements ; `products.stock_quantity` reste LE compteur opérationnel (rien ne change pour le POS, les alertes, la variance).
- ✅ Additif, réversible (on peut cesser d'émettre), aucun changement de comportement caisse, POS-081/082 débloqués, testable pg-mem.
- ⚠️ Coût : écriture supplémentaire par vente (négligeable) ; backfill optionnel du journal (non requis pour démarrer).

### Option 2 — B devient maître ; A devient cache
`createSale` décrémente via le journal (mouvement + balance), et `stock_quantity` n'est qu'une projection.
- ❌ Chemin argent réécrit (décrément atomique prouvé → logique balance), risque NF525/perf, migration de données obligatoire, tout le stock re-testé. Disproportionné aujourd'hui.

### Option 3 — Statu quo documenté
Interdire l'usage de B pour les magasins (le réserver à l'entrepôt central), documenter la frontière.
- ✅ Zéro travail. ❌ POS-081/082 restent bloqués ; la divergence reste possible si quelqu'un branche B sur un magasin.

## 4. Recommandation

**Option 1.** Elle respecte l'invariant « POS Caisse maître des ventes », ne touche pas au décrément prouvé, et transforme le journal en ce qu'il aurait dû être : une trace append-only alimentée par les faits. Périmètre d'exécution estimé : 1 mapping paresseux + 3 points d'émission (vente/retour/ajustement) + projection balance + specs pg-mem — un paquet de 5 blocs.

## 5. Ce qu'il faut pour démarrer (GO requis)

1. Ton GO sur l'option (1 recommandée, 3 acceptable en attendant).
2. Si option 1 : confirmer la sémantique voulue pour `stock_balance` magasin (projection reconstruite vs balance incrémentale) et si un backfill historique est souhaité (non nécessaire).

Sans GO : rien n'est modifié ; la frontière actuelle est documentée ici et dans `stock-movement.entity.ts`.

---
## 6. EXÉCUTÉ — GO reçu 2026-07-02, option 1 livrée (P306)

- `stock-movement-journal.ts` : `ensureStoreLocation` (paresseux, idempotent), `recordSaleMovements`, `recordReturnMovements`, `recordAdjustMovement`, `journalNetQuantities` (projection reconstruite — sous-choix retenu ; aucune écriture `stock_balance` depuis la caisse).
- **5 chemins câblés, même transaction que le fait métier** : `createSale` (POS-081), `createReturn` (POS-082), `stock.adjustStock`, `inventory-scan.applyScansToStock`, `sync.push` (deltas offline, émis seulement si la ligne du bon magasin est touchée).
- Preuves : `stock-movement-journal.pgmem.spec.ts` (4 tests : lazy/idempotent, directions from/to par type, projection nette, items invalides ignorés) + assertion e2e (vente et retour réels écrivent leurs mouvements, une seule location auto-créée).
- `products.stock_quantity` inchangé (compteur opérationnel) — zéro impact caisse, réversible en cessant d'émettre.
