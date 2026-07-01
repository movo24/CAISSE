# PROJECT_STATUS.md — État réel du projet POS Caisse The Wesley

> Généré par audit read-only le **2026-06-28**, enrichi au fil des paquets.
> Règle d'honnêteté : rien n'est déclaré "fait/testé/branché" sans preuve. Voir `EXECUTION_LOG.md`.

## 0. Bilan session 2026-06-28 (paquets 1→28, blocs jusqu'à #61)

**Vérifié dans le sandbox** : **223 tests PASS** sur 33 suites (helpers purs + DTO + services à repo mocké), `tsc --noEmit` **EXIT 0** à chaque paquet.
- Lot A (helpers purs) 13 suites / 106 · Lot B (helpers+DTO) 13 / 60 · Lot C (services mockés) 7 / 57.

**Livré & branché (prouvé tests + tsc)** : POS-054 remises (caisse 30% strict + justif 21-30% + back-office 100% admin), POS-083 alerte stock 20% baseline, POS-066 dédup nom normalisé, POS-061 override prix magasin, POS-073 anti-cumul + plafond usage (exclusion), POS-018/018b historique+DTO validé, POS-132 anti-XSS, POS-085 inventaire/écart, POS-122 Z-report, POS-094 ventes/employé (endpoint), POS-100 export compta local (CSV), POS-102 rapprochement paiements, TimeWin24 HMAC+mapping. **Bug corrigé** : `store_credit` rejeté à la validation (avoirs).

**Migrations réversibles ajoutées** : 1721 (stock baseline), 1722 (normalized_name), 1723 (price override), 1724 (promo usage). **NON exécutées dans le sandbox** → `npm run migration:run` en local.

**Modules créés** : `backoffice-discounts`, `mobile-cockpit` (42 modules).

**Limites honnêtes** : suites lourdes (sale-transaction/fiscal/pg-mem) non exécutables ici (cap 45 s) → à confirmer vertes en local ; runtime DB des nouveaux endpoints à valider local ; **Paywin24 / Comptamax24 (envoi) non branchés** ; connectivité TimeWin24 live non testée.

**Git** : ref bloquée (mount FUSE — `index.lock`/`HEAD.lock` non supprimables). Tout le travail est sur disque + objet commit `4ff20b3` (dangling, paquets 2→28) + `_BACKUP_PAQUET_2-28.patch`. Récupération : `GIT_RECOVERY.md`.

**Gates / décisions ouvertes** : `TD-STOCK-TWO-SYSTEMS` (unification stock), `TD-073-USAGE-INCREMENT`, `TD-COMPTAMAX`/Paywin24, `TD-055-QUIET-HOURS-WIRING`.

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
| Cockpit mobile `GET /api/mobile/v1/alerts` | **Créé** (PAQUET 9) : module `mobile-cockpit`, read-only, manager/admin, agrège stock + anomalies. Shaper testé 6/6, tsc clean. Runtime DB à valider en local. |
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

---
## État consolidé — 2026-07-01 (jalon PAQUET 202, v9)

**Backend : 160 suites PASS / 2 skip (162) ; 1110 tests PASS / 3 skip.** (`jest`, maxWorkers=2/runInBand)
- 2 suites skip = `test/*.pg.spec.ts` (auto-skip sans `TEST_DATABASE_URL` — CI Postgres réel).
- `tsc --noEmit` EXIT 0 · `nest build` RC 0.

**Front : 11 fichiers vitest / 46 tests PASS** (back-office 6/23 + pos-desktop 5/23) ; `vite build` ×2 verts (back-office ~1989 modules, pos-desktop ~2082 modules) ; `tsc --noEmit` EXIT 0 sur les 2. CI (`.github/workflows/ci.yml`) exécute lint + tests backend + vitest front + builds.

**Gate front (TD-FE-ROLLUP-NATIVE) levé** : binaire rollup natif présent → front exécutable en sandbox et CI.

### Historique (jalon PAQUET 133, v8) — pour mémoire
- 150 suites / 1047 tests ; 130 suites/883 unitaires + 20 suites/164 intégration pg-mem.

Épic intégration POS↔Comptamax24↔TimeWin24 (+prep Analytik R) : 62 paquets (71→133).
Détails commandes : `packages/backend/TESTING.md`. Détail intégration : `INTER_SYSTEM_INTEGRATION.md` (§A→§J).

Corrections métier récentes prouvées : avoir partiel sans fuite centime (P127), anti sur-paiement non-espèces (P128), garde NF525 cohérence total vente (P131), sécurité CSV 5/5 exports (P113-114).

Dette ouverte (documentée, non franchie) : TD-INT-SOCIAL-ENTRIES, publisher HTTP réel (secrets), migration 1725 (DB), e2e .pg (Postgres/CI), TD-TEST-DB-SERIAL, TD-FE-ROLLUP-NATIVE (build/vitest front en CI Linux uniquement).

Axe interfaces front/back-office : 16 paquets (140→155) — écrans Comptabilité, Supervision intégration, Santé système, Dettes ouvertes, remise responsable caisse (POS-054), **écart d'inventaire reconstruit** (helper pur `computeStockVariance` → endpoint read-only `POST /stock/variance` → écran branché → parseCounts util). Dette TD-FRONT-INVENTORY-VARIANCE **RÉSOLUE** (P153). Non-régression globale re-prouvée P156 : 151 suites PASS/2 skip, 1059 tests PASS/3 skip.

Arbitrage caisse hors-ligne : **TD-FE-OFFLINE-DISCOUNT RÉSOLUE** (P159) — remise responsable bloquée hors-ligne (PIN serveur invérifiable, cohérent NF525 + paiements QR/wallet Internet-only). Helper pur `manual-discount-guard.ts` câblé POSPage (bouton désactivé + garde défensive à la validation).
