# Audit front caisse (pos-desktop) — POS-FE-145

> Baseline `tsc --noEmit` pos-desktop : **EXIT 0** (compile proprement).
> Gate build complet : `vite build` natif rollup (TD-FE-ROLLUP-NATIVE), comme back-office.

## Flux caisse — statut câblage (priorité 2)
| Flux | Statut | Preuve / endpoint |
|---|---|---|
| Vente | ✅ branché | `POST /sales` + header **Idempotency-Key** (api.ts create) |
| Paiement (espèces/carte/mixte/avoir/gift) | ✅ branché | union `cash/card/mixed/voucher/gift_card/store_credit` ; AvoirTenderModal |
| Annulation | ✅ branché | `POST /sales/:id/void` + Idempotency + `rights.canVoid` + offline `enqueueVoid` |
| Retour / remboursement / avoir | ✅ branché | `POST /returns` + `/returns/by-ticket` (Idempotency) ; ReturnModal ; returnable check |
| Offline / resync | ✅ branché & visible | `useOfflineMode` (enqueue, network watcher, manual sync) ; bandeaux OFFLINE/SYNC %, pendingCount, conflictCount |
| Alertes stock | ✅ branché | `StockAlertToast` + `/products/stock-alerts` |
| Garde-fous (anomalies) | ✅ branché | `SaleGuardsGate` → `POST /sales-guards/evaluate` |
| PIN responsable (override) | ✅ présent | `EmployeePinGate` |
| **Remise caisse manuelle** | ❌ **NON branché** | aucune occurrence de `manualDiscountMinorUnits` dans le renderer |

## Trou critique : remise caisse sans interface
- Backend **POS-054** (cap **30 %**, PIN responsable + justification pour **21-30 %**, audit append-only, `discount-policy.ts` testé) est complet et exposé via `createSale.manualDiscountMinorUnits`.
- **Mais le POS n'a aucune UI pour saisir une remise manuelle** : seules les remises **promo automatiques** (`discountMinorUnits` par ligne) s'affichent. Un caissier/responsable **ne peut pas accorder de remise** depuis la caisse.
- Classé `TD-FE-MANUAL-DISCOUNT` → à corriger **P146** : modal remise (montant/%, cap 30 %, PIN responsable au-delà de 20 %, motif obligatoire) → envoi `manualDiscountMinorUnits` (+ motif) dans `createSale`.

## Conclusion
Le front caisse est globalement **mûr et réellement exploitable** (vente, paiements, retours, offline, alertes, garde-fous), **sauf** la remise manuelle responsable — fonctionnalité métier construite côté moteur mais inatteignable par l'humain. C'est le prochain correctif prioritaire.
