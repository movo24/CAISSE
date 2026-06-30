# Audit interfaces front/back-office — POS-INT-140

> Méthode : audit réel du câblage écran↔API, correction des trous visibles.
> Baseline `tsc --noEmit` back-office : **EXIT 0 après correction** (était cassé).

## 1. Défaut critique trouvé & corrigé (P140)
- **`InventoryVariancePage.tsx`** : page **orpheline** (non routée dans `main.tsx`) important `stockReconciliationApi` (`pending/count/confirm/reject`) **inexistant** dans `services/api.ts` **et** sans backend correspondant. Conséquence : `tsc --noEmit` du back-office **échouait** → build front cassé.
- **Action** : page supprimée (réversible via git). `tsc` repasse **EXIT 0**.
- **Dette ouverte** `TD-FRONT-INVENTORY-VARIANCE` : la fonctionnalité « écart d'inventaire » (comptage physique vs système) reste à construire proprement (backend `inventory-variance` + API client + page routée) si désirée.

## 2. Trou majeur : épic intégration invisible côté humain
Aucun des endpoints construits (62 paquets backend) n'est câblé au back-office :
`/comptamax/journal`, `/comptamax/cash-control`, `/comptamax/social`,
`/integration/shifts`, `/integration/stock-signals`, `/integration/events`,
`/integration/reconciliation`, `/integration/outbox/stats`, `/integration/relay`.
→ **0 écran, 0 méthode API, 0 route.** Plan de câblage : P141→P144.

## 3. Carte des écrans back-office (routés, `main.tsx`)
Branchés et routés : Dashboard, Network, Products, StockAlerts, Labels, Performance,
Reports, SalesGuards, Returns, StockNetwork, Organizations, Units, Stores,
ConnectedApps, AirtableOps, Employees, Payroll, Planning, Billing, Settings,
StoreSelect, Login. **Placeholder** : `/timewin24` → `ComingSoonPage` (assumé).

## 4. Gate environnement (honnête)
- `packages/backoffice-web` n'a pas de `node_modules` local ; les deps sont **hoistées à la racine** (workspaces) → typecheck/build front exécutables via symlink `node_modules` racine. `vite build` complet non lancé en sandbox (lourd) ; `tsc --noEmit` est la preuve de compilation utilisée.

## 5. Plan PAQUETS 140→144
- **P140** (ce paquet) : audit + suppression page morte → front typecheck vert. ✅
- **P141** : API client `comptamaxApi` + `integrationApi` (méthodes des 9 endpoints) — fondation, prouvée par tsc.
- **P142** : page **Comptabilité / Intégration** (journal + cash-control + écart de caisse) routée + nav, états vides/erreurs visibles.
- **P143** : page **Supervision intégration** (sync/outbox stats, events, reconciliation, stock-signals) — états + alertes.
- **P144** : exports CSV reliés (boutons → endpoints `format=csv`), cohérence UX (pas de bouton vers API absente), consolidation + audit.
