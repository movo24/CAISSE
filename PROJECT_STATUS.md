# PROJECT_STATUS.md — État réel du projet POS Caisse The Wesley

> Généré par audit read-only le **2026-06-28**.
> Règle d'honnêteté : rien n'est déclaré "fait/testé/branché" sans preuve. Voir `EXECUTION_LOG.md`.

## 1. Méthode

Audit → Plan → Exécution par paquets de 5 blocs. Référentiel des blocs : `POS_BLOCKS.md`.

## 2. Faits vérifiés (preuves par commandes read-only)

| Élément | Valeur réelle vérifiée | Source documentée (CLAUDE.md) | Écart |
|---|---|---|---|
| Packages | 5 (`backend`, `backoffice-web`, `customer-app`, `mobile`, `pos-desktop`) + `shared/` | 5 + shared | OK |
| Modules backend | **40** | 37 | ⚠️ doc périmée |
| Entités TypeORM | **47** | 45 | ⚠️ doc périmée |
| Migrations | **16** (jusqu'à `1720000000000-AddSaleSeqCursor`) | 11 | ⚠️ doc périmée |
| Controllers backend | **37** | n/c | — |
| Décorateurs de routes | **213** | n/c | — |
| Fichiers de specs backend | **66** (`*.spec.ts`) | 49 | ⚠️ doc périmée |
| Cas de test (approx `it(`/`test(`) | **~488** | "405 tests" | ⚠️ doc périmée |
| Branche git courante | `fix/ticket-number-sequence-cursor` | — | — |

### Modules non documentés dans CLAUDE.md (présents dans le code)
`documents`, `fiscal`, `pos-session`.

## 3. Exécution réelle des tests (honnête)

- Le module natif `bcrypt` de `node_modules` était compilé pour macOS → échec `invalid ELF header` dans le sandbox Linux. **Rebuild Linux effectué** (`npm rebuild bcrypt`, réversible, node_modules uniquement).
- Sous-ensemble vérifié : suite "money" → **9/9 PASS**. Les suites diffusées montraient PASS sans FAIL avant coupure.
- ⚠️ **La suite complète (~488 cas) n'a PAS pu être confirmée verte dans ce sandbox** : la limite de 45 s/commande + le coût de compilation `ts-jest` empêchent une exécution complète en une fenêtre. À confirmer sur une machine sans cette limite (`npm run test:backend`).
- Tests front / e2e Playwright / build desktop : **non lancés** dans ce sandbox.

## 4. Intégrations — état réel

| Intégration | État vérifié |
|---|---|
| TimeWin24 | Service présent (`modules/timewin/timewin.service.ts`). Connectivité réelle **non testée** ici. AUDIT-FINAL-2026-04 signalait circuit breaker OPEN — à re-vérifier. |
| Stripe Terminal | Service backend + hooks POS présents. Paiement réel **non testé** (interdit en audit). |
| Paywin24 (paie) | **Aucune référence dans le code** → futur / non branché. |
| Comptamax24 (compta) | **Aucune référence dans le code** → futur / non branché. |
| Cockpit mobile `GET /api/mobile/v1/alerts` | **Inexistant**. Controllers `mobile` présents (auth, coupons) mais pas d'endpoint alertes. À créer. |
| ESC/POS | Côté POS uniquement (`useBluetoothPrinter`). Pas de backend (normal). |

## 5. Risques ouverts hérités (à re-vérifier — issus de AUDIT-FINAL-2026-04-01)

Ces points datent d'avril 2026 ; plusieurs commits fiscaux/correctifs ont suivi. **Statut = À VÉRIFIER**, pas "ouvert" ni "résolu".

1. PIN login 500 en prod (auth.service) — à re-tester.
2. Clés API réelles potentiellement dans l'historique git (`docker/.env.production.example`).
3. Erreurs avalées côté front (`StockAlertsPage`, `LabelsPage`).
4. XSS possible dans receipts HTML (échappement).
5. Receipts publics sans auth.
6. Boutons morts (exports).

## 6. Prochaine action

Voir `POS_BLOCKS.md` → premier paquet (PAQUET 1). Détail d'exécution dans `EXECUTION_LOG.md`.
