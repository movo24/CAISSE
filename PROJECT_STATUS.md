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
## État consolidé — 2026-07-02 (jalon PAQUET 277, v20 — cycle 2 Fab 5 : docs alignées + pg-mem money-path)

- **P273** docs alignées sur le réel : CLAUDE.md (44 modules, 21 migrations dont 1725 gated, compteurs tests, 48 entités) + STATE_INDEX (les 10 priorités re-statuées : ✅ 4/5/9 faites, 🟡 3/10 partielles, ⛔ 5 gated).
- **P274** `product-analytics.service.pgmem.spec` (5) — vraies requêtes d'agrégation prouvées sur pg-mem : fenêtres 7j/30j/prev-30j, `completed` uniquement (pending exclu), isolation tenant, `lastSoldAt` = MAX, CA quotidien bucketé jour local magasin, cache TTL store+jour.
- **P275** `sales-guards.service.pgmem.spec` (5) — garde pré-vente (chemin argent) : enrichissement coût côté serveur **tenant-scoped** (produit d'un autre magasin → COST_MISSING, jamais son coût), vente sous coût = critical+blocking persistée `detected`, filtres/tri/count réels de `listAnomalies`, summary groupé par code/sévérité, machine à états review (detected→approved une seule fois, 404 sinon).
- **P276** `customer-visits.service.pgmem.spec` (6) — fenêtre anti-doublon 5 min **par magasin** (vraie requête), insert transactionnel + UPDATE SQL brut `visit_count`/`last_visit_at` (pas d'incrément sur doublon), tri DESC, lecture sécurisée anti-IDOR (autre magasin interdit, bypass admin, 404). Note : artefact pg-mem documenté (incrément SQL brut rendu en texte) — assertions via Number(), réel PG non affecté.
- **P277** consolidation : suite backend COMPLÈTE rejouée en 5 tranches —
  **191 suites PASS / 2 skip (.pg) · 1290 tests PASS / 3 skip · 0 échec** (Δ v19 : +3 suites, +16 tests). `tsc --noEmit` EXIT 0.

Commits locaux : `56b41ed` (P273) · `47c9113` (P274) · `506688f` (P275) · `f3fd2f9` (P276). Interdits respectés : zéro push, zéro secret, zéro prod, zéro migration cible.

---
## État consolidé — 2026-07-02 (jalon PAQUET 272, v19 — reprise Fab 5 : git réparé + re-preuve globale)

- **Git réparé (définitif)** : les locks résiduels `.git/HEAD.lock`/`index.lock` (28 juin, FUSE) ont pu être supprimés cette session → refs de nouveau inscriptibles. Historique complet restauré depuis `pos-recovery.bundle` : branche **`recovery/pos-audit-session`** fetchée (P271 = `579851c`), HEAD basculé dessus **sans modifier le working tree** (diff tree vs bundle tip = 0). Les 4 symlinks `node_modules` trackés par accident retirés de l'index (`28f57d9`). Les commits ne dépendent plus du bundle ; le bundle reste comme filet tant qu'aucun push n'est autorisé.
- **Re-preuve globale bout-en-bout** (la v18 admettait ne pas l'avoir rejouée) — suite backend COMPLÈTE exécutée en 5 tranches (`jest --maxWorkers=2`, 190 fichiers) :
  **188 suites PASS / 2 skip (.pg) — 1274 tests PASS / 3 skip — 0 échec.**
  Front : back-office 6 fichiers/23 tests, pos-desktop 5/23, mobile 3/13 — **14 fichiers / 59 tests PASS**. `tsc --noEmit` backend EXIT 0 · `nest build` RC 0 · `test:security` 10 suites/34 tests PASS.
- **Invariant remises re-vérifié** : `sales/discount-policy.ts` = plafond dur 30 % canal `pos` (jamais contournable), justification obligatoire 21–30 %, code responsable obligatoire, back-office ≤ 100 % admin+motif — conforme aux règles produit, specs dédiées vertes (policy + edge + totals).
- Traçabilité rattrapée : `EXECUTION_LOG.md` couvrait P246 alors que le code était à P271 → entrée de raccord ajoutée (P247→P271 documentés dans PROJECT_STATUS v10→v18) + entrée P272.

**Gates restantes (inchangées)** : TD-INT-RELAY (secrets), MIGRATION-1725 (DB cible + GO), TD-INT-SOCIAL-ENTRIES (décision comptable), runtime DB/e2e run/Capacitor.

---
## État consolidé — 2026-07-01 (jalon PAQUET 271, v18 — session autonome, pg-mem haute fidélité)

- **P271** `outbox-query.service.pgmem.spec` (4) — exécuté contre un **vrai Postgres en mémoire (pg-mem)** via le harness `test/helpers/pgmem.ts`, donc le **query builder keyset réel** est prouvé (pas mocké) : scope tenant (store), filtre de type, pagination curseur `occurredAt|id` (reprise stricte sans perte/doublon), stats groupées par statut/type. Consumer feed Analytik R = `GET /api/integration/events`.

**Non-régression :** slice integration **73 tests verts (10 suites)** ; `tsc --noEmit` EXIT 0. Spec uniquement (harness pg-mem existant réutilisé).

**Compteurs (honnêtes) :** backend 187 → **188 suites**, **+4 tests** (~1270 → ~1274). Cumul session autonome (v12→v18) : **+14 suites, +80 tests**. Méthode pg-mem ouverte pour les prochains services query-heavy (product-analytics, etc.). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

---
## État consolidé — 2026-07-01 (jalon PAQUET 270, v17 — session autonome suite)

- **P270** `comptamax.service.spec` (3) — contrat de requête du modèle de lecture comptable : `buildDayJournal`/`buildJournalRange`/`buildCashControl` interrogent bien le magasin + la plage jour/période + le filtre de types d'events attendus ; journal vide pour 0 event ; comptage Z-report + paiements capturés. Les maths comptables restent couvertes par les specs helpers purs (journal/cash-control).

**Non-régression :** slice comptamax **61 tests verts (9 suites)** ; `tsc --noEmit` EXIT 0. Spec uniquement.

**Compteurs (honnêtes) :** backend 186 → **187 suites**, **+3 tests** (~1267 → ~1270). Cumul session autonome (v12→v17) : **+13 suites, +76 tests**. Services sans spec colocée couverts cette session : loyalty-card, loyalty-token, inventory-scan, reconciliation, jackpot, customer-visits, notifications, subscriptions, stripe-billing, ai-learning, mobile-auth, external-context, comptamax. Restent (query-heavy ou déjà couverts par `test/`) : product-analytics, fiscal-verify, timewin, airtable-ops (2), outbox-query, sales.service (audit/currency couverts par `test/`). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

---
## État consolidé — 2026-07-01 (jalon PAQUET 268→269, v16 — session autonome suite)

- **P268** `loyalty-token.service.spec` (6) — **round-trip HMAC QR** (sécurité) : generate→verify OK, rejet mauvais secret / payload falsifié / token malformé / expiré (constant-time, aucune fuite du check échoué), unicité du secret.
- **P269** `external-context.service.spec` (4) — **contrat fail-safe** météo/transport : sans clé (ou coords/station) → contexte NEUTRE `available:false`, **aucun appel réseau** ; getFullContext → overallImpact `neutral`. Applique la règle STATE_INDEX « pas de live sans clé ».

**Non-régression :** slice loyalty-card/sales-ai **66 tests verts (9 suites)** ; `tsc --noEmit` EXIT 0. Specs uniquement.

**Compteurs (honnêtes) :** backend 184 → **186 suites**, **+10 tests** (~1257 → ~1267). Cumul session autonome (v12→v16) : **+12 suites, +73 tests** (…, mobile-auth, stripe-billing, loyalty-token, external-context). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

---
## État consolidé — 2026-07-01 (jalon PAQUET 266→267, v15 — session autonome suite)

- **P266** `mobile-auth.service.spec` (5) — gardes register/login Wesley Club **avant émission de token** : email invalide, mot de passe < 8, compte dupliqué (409), utilisateur inconnu, mauvais mot de passe (401). Tokens = `mobile-tokens.spec`.
- **P267** `stripe-billing.service.spec` (5) — **gardes des flux monétaires** : Stripe non configuré, plan inconnu, refus checkout plan gratuit, portail sans customer Stripe, webhook **fail-closed** si `STRIPE_WEBHOOK_SECRET` absent (jamais de webhook non vérifiable). Aucun appel Stripe réel (client mocké).

**Non-régression :** slice mobile-auth/subscriptions **34 tests verts (5 suites)** ; `tsc --noEmit` EXIT 0. Specs uniquement.

**Compteurs (honnêtes) :** backend 182 → **184 suites**, **+10 tests** (~1247 → ~1257). Cumul session autonome (v12→v15) : **+10 suites, +63 tests** (loyalty-card, inventory-scan, reconciliation, jackpot, customer-visits, notifications, subscriptions, ai-learning, mobile-auth, stripe-billing). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

---
## État consolidé — 2026-07-01 (jalon PAQUET 264→265, v14 — session autonome suite)

- **P264** `subscriptions.service.spec` (12) — cycle de vie + **enforcement des limites de plan** : une seule souscription/magasin, plan inconnu rejeté, double-annulation refusée, limite produits (bypass illimité / sous limite / dépassement→403), gate feature, lecture not-found. Denial/limite pures = `subscription-policy.spec`.
- **P265** `ai-learning.service.spec` (4) — boucle d'apprentissage reco : tracking display/click/add-to-cart/conversion, agrégation performance (compteurs + CA), blacklist fail-open sans historique.

**Non-régression :** slice subscriptions/sales-ai **55 tests verts (7 suites)** ; `tsc --noEmit` EXIT 0. Specs uniquement.

**Compteurs (honnêtes) :** backend 180 → **182 suites**, **+16 tests** (~1231 → ~1247). Cumul session autonome (v12→v14) : **+8 suites, +53 tests** (loyalty-card, inventory-scan, reconciliation, jackpot, customer-visits, notifications, subscriptions, ai-learning). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

---
## État consolidé — 2026-07-01 (jalon PAQUET 262→263, v13 — session autonome suite)

- **P262** `customer-visits.service.spec` (6) — anti-doublon scan 5 min (early-return sans transaction), insert transactionnel + bump `visit_count`, lecture fréquence sécurisée (not-found → 404, cross-store non-admin → 403).
- **P263** `notifications.service.spec` (3) — `generateQrReminderMessage` tenant-scopé, garde not-found, branches message premier-achat (-5%) vs points fidélité.

**Non-régression :** slice customer-visits/notifications/customers/reports **98 tests verts (19 suites)** ; `tsc --noEmit` EXIT 0. Specs uniquement.

**Compteurs (honnêtes) :** backend 178 → **180 suites**, **+9 tests** (~1222 → ~1231). Cumul session autonome (v12+v13) : **+6 suites, +37 tests** (loyalty-card, inventory-scan, reconciliation, jackpot, customer-visits, notifications). ⚠️ Suite complète non re-jouée bout-en-bout (cap 45 s).

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
