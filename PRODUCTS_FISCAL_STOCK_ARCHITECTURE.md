# Architecture — Journal de stock unifié & surface fiscale (NF525)

> **Statut : PROPOSITION — AUCUN CODE tant que cette architecture n'est pas validée
> par l'owner.** Périmètre STRICTEMENT gaté (charte §1/§6, surface fiscale) :
> journal de stock unifié, décrément de stock pendant la vente, `voidSale`, toute
> modification impactant l'immuabilité ou le journal fiscal.
> Rédigé sur lecture du code réel (références `fichier:ligne`).

---

## 0. Pourquoi ce document (et pas du code)

Modifier le décrément de stock dans la transaction de vente, ou `voidSale`, touche
la **chaîne de hash NF525** et l'intégrité comptable. Une erreur y corrompt l'audit
fiscal de façon **non réversible par simple rollback de schéma**. Cette surface exige
donc un plan validé, pas une implémentation « au fil de l'eau ». Le catalogue (additif,
réversible) avance sans GO ; ceci attend un GO **nommé** par bloc.

---

## 1. Flux actuel (constaté dans le code)

### 1.1 Deux systèmes de stock parallèles

| Système | Où | Rôle | Écrit par |
|---|---|---|---|
| **A — scalaire** | `products.stock_quantity` (+ seuils) | stock « vendable » lu par la caisse | vente, `stock.adjustStock`, inventaire, sync |
| **B — multi-emplacements** | `stock_balances` (qty par `location_id`) + `stock_movements` (journal immuable, 10 types) | réception / transfert / dispatch / pertes | `stock-locations.service.ts` |

**Pont unidirectionnel** : `syncLegacyStock` (`stock-locations.service.ts:~524-537`)
recopie `SUM(balances de type store)` → `products.stock_quantity`. Diagnostic M107
(`findStockDivergences`, lecture seule) constate que les deux peuvent diverger.

### 1.2 Décrément de stock à la vente (surface fiscale)

- `sales.service.ts` : décrément **atomique conditionnel** sur le scalaire
  `UPDATE products SET stock_quantity = GREATEST(0, stock_quantity - :q) WHERE id=:id AND stock_quantity >= :q RETURNING …` (~l.768-792), dans la **transaction de vente**.
  Prouvé race-safe (`sales-stock-concurrency.pg.spec`).
- Packs : décrément des composants + snapshot figé `sale_component_movements`
  (~l.803-842), HORS empreinte de hash (allowlist).
- **Ce décrément n'écrit PAS `stock_movements`** : le type `sale` existe dans l'enum
  mais n'est jamais émis. Le journal B ignore les ventes.

### 1.3 `voidSale` (surface fiscale)

- `voidSale` (`sales.service.ts:~1428-1502`) : le void est un **UPDATE de statut +
  un maillon append-only** sur la chaîne de hash (le hash d'origine reste intact).
- Restaure le stock **parent** (~l.1431-1439) ; **ne relit pas** `sale_component_movements`
  → **bug G3** : les composants d'un pack ne sont pas restitués (fuite de stock).
- Void interdit si cash réalisé (force le chemin avoir) + plafond manager 500 €.

### 1.4 Chaîne fiscale

- Hash chain v2 (`sales.service.ts:~665-690`) : allowlist de champs fiscaux ; session/
  terminal/stock **hors** empreinte. Ticket séquentiel sous verrou magasin.
- Avoirs D1.4 scellés + atomiques (`returns.service.ts`), 4 maillons de journal.

---

## 2. Flux cible

### 2.1 Principe directeur

**Le journal `stock_movements` devient la source unique de vérité de tout mouvement
de stock** (réception, transfert, perte, **vente**, **retour**, **ajustement**,
**void**, **consommation pack**). Le scalaire `products.stock_quantity` devient un
**cache dérivé** (projection), jamais écrit « à la main » : il est recalculé depuis le
journal (ou maintenu par trigger/service transactionnel).

### 2.2 Invariants cibles (non négociables)

1. **La chaîne de hash fiscale reste inchangée** : le stock n'entre toujours PAS dans
   l'empreinte NF525. Ajouter un mouvement de stock ne modifie AUCUN hash de vente.
2. **Atomicité** : `écriture vente` + `écriture mouvement(s) de stock` dans **la même
   transaction** ; un échec de l'un annule tout (déjà vrai pour le pack via snapshot).
3. **Idempotence** : rejeu (sync offline, double-clic) ne crée jamais un 2ᵉ mouvement
   (clé = `sale_id`/`sale_line_item_id`/`clientEntryId`).
4. **Réversibilité comptable** : un void écrit un **mouvement inverse** (type `void`/
   contre-passation), il n'efface jamais le mouvement d'origine — symétrie exacte du
   retour (qui, lui, est déjà correct).
5. **Non-régression caisse** : le décrément conditionnel race-safe (jamais d'oversell,
   jamais de négatif) est **préservé** — la garde `WHERE stock_quantity >= q` reste.

### 2.3 Cible détaillée par opération

| Opération | Aujourd'hui | Cible |
|---|---|---|
| Vente (ligne simple) | UPDATE scalaire conditionnel | idem **+** INSERT `stock_movements(type=sale, sale_id, sale_line_item_id)` dans la même tx |
| Vente (pack) | décrément composants + snapshot | idem **+** INSERT mouvements `pack_consumption` par composant |
| Retour | restaure scalaire + composants (OK) | idem **+** INSERT `stock_movements(type=return_customer)` |
| Ajustement (`stock.adjustStock`) | UPDATE scalaire + audit | idem **+** INSERT `inventory_adjust` (motif obligatoire, déjà partiel) |
| **Void** | restaure parent seul (**G3**) | INSERT mouvement inverse `void` **pour parent ET composants** (relire snapshot) |
| Réception/transfert/perte | déjà journalisé (système B) | inchangé |

### 2.4 Options d'implémentation (à trancher à la validation)

- **Option 1 — service transactionnel** (recommandée) : une méthode `recordStockMovement()`
  appelée dans la même tx que la vente/retour/ajustement/void ; le scalaire est mis à
  jour dans la même tx. Pas de trigger DB. Le plus lisible, testable, réversible.
- **Option 2 — trigger PostgreSQL** : `AFTER INSERT ON stock_movements` recalcule le
  scalaire. Découplé mais opaque, plus dur à tester en pg-mem, risque de divergence si
  un chemin oublie le journal. **Non recommandé.**
- **Option 3 — projection asynchrone** : file d'événements. Sur-ingénierie ici, fenêtre
  d'incohérence inacceptable pour la caisse. **Rejeté.**

---

## 3. Impacts techniques

- `sales.service.ts` : ajout d'INSERT `stock_movements` dans la tx de vente (lignes +
  composants) ; `voidSale` relit `sale_component_movements` et écrit les mouvements
  inverses. **Aucune modification de la construction du hash.**
- `returns.service.ts` : ajout de l'écriture `return_customer` (le stock est déjà
  restauré ; on ajoute la trace journal).
- `stock.service.ts` / `stock-locations.service.ts` : convergence — un seul chemin
  d'écriture ; `syncLegacyStock` remplacé par une projection depuis le journal.
- Migration **additive** possible (voir §5) : `stock_movements` a déjà les colonnes ;
  ajouter au besoin `sale_id`, `sale_line_item_id`, `client_entry_id` (idempotence),
  index. **Aucune colonne fiscale touchée.**
- Tests : nouveaux specs **vrai PG** (gated) — vente→mouvement, void→mouvements inverses
  parent+composants, rejeu→un seul mouvement, `fiscal-verify` inchangé après vente.

## 4. Impacts fiscaux (NF525)

- **Nul sur la chaîne de hash** si l'invariant §2.2.1 est respecté : le stock reste hors
  empreinte. À **prouver** par un test « hash identique avant/après ajout du journal ».
- Le journal de stock **n'est pas** un journal fiscal : il ne remplace ni le ticket, ni
  la chaîne d'avoirs, ni le Z-report. Il est **auxiliaire** (traçabilité stock).
- Point d'attention : ne jamais permettre qu'un échec d'écriture du journal de stock
  **rollback une vente déjà hashée/ticketée** de façon à créer un « trou » de séquence.
  → l'INSERT stock doit se faire **avant** le COMMIT, dans la même tx, donc soit tout
  réussit, soit rien n'est ticketé (pas de trou).

## 5. Plan de migration (par blocs, chacun GO nommé)

1. **F0 — additif schéma** (réversible) : `stock_movements +=` `sale_id`, `sale_line_item_id`,
   `client_entry_id` (nullable) + index + contrainte d'unicité partielle pour idempotence.
   Aucune écriture de comportement. *Rollback = DROP COLUMN.*
2. **F1 — écriture en double (shadow)** : la vente/retour/ajustement écrivent AUSSI le
   journal, mais le scalaire reste la source lue par la caisse. Comparaison
   `scalaire vs SUM(journal)` en lecture seule (étend `findStockDivergences`).
   *Rollback = cesser d'écrire le journal (feature flag).*
3. **F2 — void symétrique (fix G3)** : `voidSale` restitue parent+composants via mouvements
   inverses. Tests rouges → verts d'abord. *Rollback = revert du bloc.*
4. **F3 — bascule de lecture** : la caisse lit la projection issue du journal (le scalaire
   devient cache maintenu). Bascule derrière flag, avec fenêtre de double-run.
   *Rollback = re-basculer la lecture sur le scalaire.*
5. **F4 — retrait du double système** : suppression de `syncLegacyStock` une fois la
   projection stable et prouvée. *Rollback = réactiver syncLegacyStock.*

## 6. Stratégie de rollback

- Chaque bloc F0–F4 est **feature-flaggé** et **réversible** indépendamment.
- F0 additif → DROP COLUMN. F1/F2/F3 → flags off + revert commit. F4 → réactivation.
- **Aucune donnée fiscale n'est jamais réécrite** : les mouvements sont append-only ;
  un rollback cesse d'en produire, il n'en efface pas.
- Sauvegarde/restore DB avant F3 (bascule de lecture) — point de non-retour applicatif.

## 7. Points de validation (avant tout code)

- [ ] **GO owner nommé** sur ce document.
- [ ] Choix Option 1 (service tx) vs trigger — recommandation : Option 1.
- [ ] Confirmation invariant « stock hors hash » + test de non-régression du hash.
- [ ] Confirmation du modèle void = mouvement inverse (pas d'effacement).
- [ ] Ordre des blocs F0→F4 et gating individuel.
- [ ] Environnement de preuve : vrai PG (gated), pas seulement pg-mem, pour F1/F2/F3.
- [ ] Fenêtre de double-run F1↔F3 et critère de bascule (0 divergence sur N jours).

---

**Tant que ce document n'est pas validé, aucun code n'est écrit sur : journal de stock
unifié, décrément de vente, `voidSale`, ou toute surface NF525.**
