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

Ces points datent d'avril 2026 ; plusieurs commits fiscaux/correctifs ont suivi. **Statuts re-vérifiés aux paquets 241-243 :**

1. PIN login 500 en prod (auth.service) — ⏳ À VÉRIFIER en runtime local (non reproductible sans DB/prod ici). Auth JWT couvert par tests (auth-security, mobile-tokens).
2. Clés API réelles dans `docker/.env.production.example` — ✅ VÉRIFIÉ PROPRE (scan `findSecretLeaks` P236) ; garde testé sur TOUS les `.env*` suivis empêche toute réintroduction.
3. Erreurs avalées côté front (`StockAlertsPage`, `LabelsPage`) — ✅ PÉRIMÉ : les deux pages surfacent leurs erreurs (audit P242) ; StockAlertsPage durci via `safeErrorMessage`.
4. XSS receipts HTML (échappement) — ✅ MITIGÉ + TESTÉ : `escapeHtml` (POS-132) câblé sur tous les champs texte ; verrou e2e anti-`<script>` (P241).
5. Receipts publics sans auth — ✅ INTENTIONNEL : `saleId` = UUID → capability-URL non énumérable (modèle Stripe) ; email protégé JwtAuthGuard (P241).
6. Boutons morts (exports) — ✅ traité : hygiène front (P181/182/196) a supprimé le code mort ; exports CSV branchés (Comptabilité/Supervision/Inventaire). À re-vérifier ponctuellement.

## 6. Prochaine action

Voir `POS_BLOCKS.md` → premier paquet (PAQUET 1). Détail d'exécution dans `EXECUTION_LOG.md`.

---
## État consolidé — 2026-07-01 (jalon PAQUET 257→261, v12 — session autonome, couverture services)

Session autonome (méthode : additif, prouvé, réversible ; zéro gate franchie).

**Livré & prouvé (jest + tsc) :**
- **P257** `loyalty-card.service.spec` (12) — createCard idempotent, gate statut actif sur les vues (403), rotation QR, suspend, `resolveToken` (malformé/inconnu/inactif → 403 ; succès après vérif HMAC).
- **P258** `inventory-scan.service.spec` (7) — validation magasin + store_code, **idempotence offline** (replay clientEntryId), matched vs new, early-return apply sans transaction, roll-up stats session.
- **P259** `reconciliation.service.spec` (3) — **dégradation gracieuse** POS↔TimeWin (TimeWin injoignable → `timewinReachable=false`, résultat POS-only, ne bloque jamais la caisse) + scope employeeId ; `jackpot.service.spec` (6) — config CRUD (lookup actif-only, not-found/forbidden, storeId/id immuables) + comptes du jour.

**Non-régression :** slice loyalty-card/inventory-scan/jackpot/integration/customers/coupon **155 tests verts (21 suites)** ; `tsc --noEmit` EXIT 0. Aucun code métier modifié (specs uniquement) → DI/build inchangés.

**Compteurs (honnêtes) :** backend 174 → **178 suites** (+loyalty-card, +inventory-scan, +reconciliation, +jackpot), **+28 tests** (~1194 → ~1222, 2 `.pg` skip inchangés). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

**Gates restantes : inchangées** (voir `GATES_READINESS.md`).

---
## État consolidé — 2026-07-01 (jalon PAQUET 252→256, v11 — couverture services CRUD)

Suite directe de v10 : on ferme des trous de couverture « services sans spec colocée » (audit P252).

**Livré & prouvé (jest + tsc + nest build) :**
- **P252** `stock-locations.service.spec` (8) — gardes locations/balances : code dupliqué (400), not-found (404), listing actif-only + ordre, balance par défaut 0, code mis en MAJUSCULE. (Les méthodes transactionnelles receive/transfer/dispatch restent couvertes par `dispatch-policy.spec`.)
- **P253** `pos-session.service.spec` (14) — cycle de vie caisse (invariant γ : une session active par (store, terminal)) : champs requis, refus 2ᵉ session terminal (409), map unique-violation 23505 → 409, refus close cross-store/cross-employee, refus déjà-fermée, **outbox best-effort non bloquant** (ouverture réussit même si l'insert outbox échoue).
- **P254** `occupancy.service.spec` (5) — feed radar in-memory : clamp négatif→0, arrondi, défaut sûr store inconnu, `getView` frais/périmé + niveau ; `mobile-cockpit.service.spec` (4) — cockpit read-only : requête anomalies tenant-scopée `status='detected'`, roll-up summary + overall ok/critical.

**Non-régression (ce paquet) :** slice large stock-locations/pos-session/occupancy/mobile-cockpit/sales-guards/employees/products **137 tests verts (20 suites)** ; `nest build` RC 0 ; `tsc --noEmit` EXIT 0.

**Compteurs (honnêtes) :** backend 170 → **174 suites** (+stock-locations, +pos-session, +occupancy, +mobile-cockpit), **+31 tests** (~1163 → ~1194, 2 `.pg` skip inchangés). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s) ; additions purement additives (nouvelles suites uniquement, aucun code métier modifié).

**Gates restantes : inchangées** (voir `GATES_READINESS.md`).

---
## État consolidé — 2026-07-01 (jalon PAQUET 247→251, v10 — points faibles STATE_INDEX)

Paquet de renforcement des couches **maîtrisables** (hors gates externes), suite à `STATE_INDEX.md`.

**Livré & prouvé (jest/vitest + tsc + nest build) :**
- **P247** CRUD couverts : `connected-apps.service.spec` + `terminals.service.spec` (18 tests DI-mockés — branches org/not-found/Stripe-fallback/heartbeat/location-reuse). Comble le trou « services CRUD sans spec ».
- **P248** **Reçu PDF** : endpoint public `GET /api/receipts/:saleId/pdf` → duplicata PDF (StreamableFile `application/pdf`), réutilise le `PdfService` déjà testé, **valeurs figées imprimées verbatim** (NF525, jamais recalculées). Comble le gap « receipt PDF absent » de STATE_INDEX. Tests : magic header `%PDF-`, 404 avant DB sur saleId non-UUID.
- **P249** **Contrat consommateur Analytik R** (`consumer-contract.ts`) : validation d'enveloppe + `ReferenceConsumer` idempotent (dédup par id, skip forward-incompatible, rejet malformé, curseur résumable) + **garde de synchro** qui échoue si un `type` émis n'est pas déclaré. 15 tests. Zéro live.
- **P250** Durcissement clients : mobile `deviceId` + `network` (8 tests unitaires, stubs navigateur) → mobile 3 suites/13 ; customer-app **ErrorBoundary** (anti écran blanc, parité mobile).
- **P251** e2e Playwright **déjà scaffolé** (`e2e/pos-smoke.spec.ts`, parcours argent login→scan→paiement) : spec **collectable** prouvée (`playwright --list`), câblée en CI (`test:e2e:list`) ; mobile vitest ajouté en CI ; gates runtime documentées dans `GATES_READINESS.md`.

**Non-régression (ce paquet) :** slices adjacentes vertes — intégration/receipts/terminals/connected-apps/documents **97 tests**, stock/reports/comptamax **149 tests**, gardes sécurité **27 tests** ; `nest build` RC 0. Additions purement additives (3 nouvelles suites backend + 2 tests receipts).

**Compteurs (honnêtes) :** backend passe de 167 → **170 suites** (+connected-apps, +terminals, +consumer-contract), **+35 tests** backend (1128 → ~1163, 2 `.pg` skip inchangés). Front mobile +8 tests (+2 suites). ⚠️ Suite backend complète **non** re-jouée bout-en-bout ce paquet (cap 45 s/commande) : jalon 167/1128 tient, additions prouvées isolément.

**Gates restantes (inchangées, non franchies)** — voir `GATES_READINESS.md` : TD-INT-RELAY (secrets), MIGRATION-1725 (accès DB cible), TD-INT-SOCIAL-ENTRIES (décision comptable) + gates runtime : **e2e run** (chromium+backend seedé), **build natif Capacitor** (`@capacitor/*` non installés en sandbox), **PIN login 500** (à vérifier en runtime DB).

---
## État consolidé — 2026-07-01 (jalon PAQUET 202, v9)

**Backend : 167 suites PASS / 2 skip (169) ; 1128 tests PASS / 3 skip.** (`jest`, maxWorkers=2/runInBand)
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
