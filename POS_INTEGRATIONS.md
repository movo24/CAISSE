# POS_INTEGRATIONS.md — Intégrations internes/externes (vérifié 2026-06-28)

> Légende : ✅ branché & prouvé · 🟡 présent, non prouvé live · 🟦 simulé/mock · ⛔ non branché / à créer.

## Internes

| Lien | État | Preuve / Localisation |
|---|---|---|
| POS ↔ backend | 🟡 | `pos-desktop/src/renderer/services/api.ts`, 213 routes backend |
| POS ↔ base de données | 🟡 | TypeORM 47 entités ; connexion live non testée ici |
| POS ↔ auth/RBAC | 🟡 | `roles.guard.ts`, `jwt-auth.guard.ts`, `tenant.interceptor.ts` |
| POS ↔ logs/audit | 🟡 | modules `audit`, `fiscal`, `utils/hash.ts` ; tests à confirmer verts |
| POS ↔ cloud sync | 🟡 | module `sync` + `syncEngine.ts` |
| POS ↔ offline queue | 🟡 | `offlineStore.ts`, `useOfflineMode.ts` — voir `POS_OFFLINE_STRATEGY.md` |
| POS ↔ exports | 🟡 | `reports` (`product-analytics`, `sales-trend`) ; exports compta dédiés ⛔ |

## Périphériques

| Lien | État | Preuve |
|---|---|---|
| POS ↔ scanner code-barres | 🟡 | `useScannerZXing.ts`, `useBluetoothScanner.ts`, `ScannerTool.tsx` |
| POS ↔ lecteur QR | 🟡 | ZXing (mêmes hooks) |
| POS ↔ imprimante ESC/POS | 🟡 | `useBluetoothPrinter.ts` (client only — pas de backend, normal) |
| POS ↔ Stripe Terminal (WisePad 3) | 🟡 | `useStripeTerminal.ts` + backend `stripe-terminal/` ; paiement réel **non testé** |

## Externes

| Lien | État | Preuve / Décision |
|---|---|---|
| POS ↔ TimeWin24 (planning, HR source of truth) | 🟡 | `timewin.service.ts` (HMAC pos-feed **testé** `pos-hmac` 5/5 ; mapping employés **testé** `employee-map` 3/3 ; circuit breaker). Connectivité live non testée ici ; OPEN signalé avril → re-vérifier en local. |
| POS ↔ Paywin24 (paie) | ⛔ | **Aucune référence code**. À spécifier : quelles données employé/heures viennent de Paywin24 ; ne PAS dupliquer les données critiques côté POS |
| POS ↔ Comptamax24 (compta) | 🟡 export local / ⛔ envoi | **Export local prêt** : `reports/accounting-export.ts` + `GET /api/reports/accounting-export` (JSON/CSV depuis Z-report figé). **Envoi vers Comptamax24** toujours ⛔ (externe, non branché — `TD-COMPTAMAX`). |
| POS ↔ cockpit mobile | ⛔ | `GET /api/mobile/v1/alerts` **inexistant** ; à créer (lecture seule) |

## Règles d'intégration (à documenter au fur et à mesure)

1. **Source de vérité unique** : employés/HR = TimeWin24 ; stores = CAISSE ; paie = Paywin24 (futur). Aucune donnée employé critique dupliquée arbitrairement.
2. Toute intégration externe doit avoir : auth (clé/HMAC), schéma payload, gestion erreurs, idempotence, trace.
3. Une intégration "prévue mais non branchée" doit rester marquée ⛔ jusqu'à preuve de connexion réelle.
