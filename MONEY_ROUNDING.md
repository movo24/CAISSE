# Conventions d'arrondi monétaire — audit POS-INT-138

> Tous les montants sont des **entiers en centimes**. Référence vérifiée par tests
> (11 suites / 93 tests verts). Sens d'arrondi choisi pour ne jamais léser le
> commerçant ni le client de façon systématique, et garantir les invariants NF525.

| Helper | Fichier | Règle | Sens | Vérifié |
|---|---|---|---|---|
| `loyaltyPointsEarned` | sales/loyalty-points.ts | 1 pt / € | **floor** (jamais de points indus) | ✅ |
| `computeMaxAllowedDiscount` | sales/discount-totals.ts | plafond remise employé | **floor** (cap jamais dépassé) | ✅ |
| `percentageDiscount` / `buyXGetDiscount` / `firstPurchaseDiscount` | promotions/promo-discount.ts | remise promo | `round` unique, appliqué tel quel (pas de re-dérivation) | ✅ |
| `distributeManualDiscount` | sales/discount-policy.ts | répartition remise sur lignes | floor + **plus-grand-reste** → Σ = remise exacte | ✅ |
| `computeLineRefund` | returns/returns-policy.ts | avoir partiel | **arrondi cumulatif** → Σ partiels = total ligne exact (P127) | ✅ |
| `validatePayments` | sales/payment-policy.ts | rendu monnaie | change **uniquement cash** ; sur-paiement non-espèces rejeté (P128) | ✅ |
| `assertSaleTotalsConsistent` | sales/sale-total.ts | total = Σ nets lignes | garde **fail-closed** NF525 (P131) | ✅ |
| `taxBreakdownByRate` / `sumLineTax` | sales/tax.ts | TVA par taux | Σ TVA par taux === Σ TVA lignes (P96) | ✅ |
| `convertMinor` | currency/convert-amount.ts | conversion FX (affichage) | montant entier × taux **d'abord** → 0 dérive .5 (P137) | ✅ |
| `partitionPushSales` | sync/conflict.ts | idempotence offline | vente sans id **rejetée** (pas de doublon au replay, P136) | ✅ |
| `dedupeBatch` | common/integration/consumer-dedup.ts | exactly-once conso | dédup par `id` (P102) | ✅ |

## Invariants garantis
1. Une vente : `Σ nets lignes (après promo+remise) === total enregistré === ticket`.
2. Une remise répartie : `Σ allocations === remise` (au centime).
3. Un avoir d'une ligne entièrement retournée : `Σ remboursements === total net payé`.
4. Le rendu monnaie est toujours **adossé aux espèces**.
5. Un replay offline/relais ne crée jamais de doublon (idempotence par id).

## Bugs d'arrondi/argent corrigés (prouvés avant/après)
P127 (fuite centime avoir partiel) · P128 (sur-paiement non-espèces) · P136 (doublon sync sans id) · P137 (off-by-one conversion FX, 34/87594 → 0).
