# PROJECT_STATUS.md — état live

> Tableau de bord du chantier modulaire. Détail modules : `MASTER_ROADMAP.md`. Dette : `TECHNICAL_DEBT.md`. Journal : `EXECUTION_LOG.md`.
> Dernière reconstruction : **2026-06-21** (audit 10 agents + vérification centrale). Branche : `feat/pos-caisse-build`.

## Vérification centrale (faits objectifs, 2026-06-21)
| Package | tsc | tests | note |
|---|---|---|---|
| backend | ✅ | jest **543** (81 fichiers) | +gated `*.pg.spec` skipped |
| backoffice-web | ✅ | vitest **12** (3 fichiers) | couverture mince |
| pos-desktop | ✅ | vitest **75** (11 fichiers) | |
| mobile | ✅ | vitest **5** (1 fichier) | réparé (6ce722c) |
| customer-app | ⛔ | 0 | dep `@capacitor/preferences` non installée (M704) |

## Répartition des 94 modules audités
✅ Fait **48** · ⚠️ À vérifier **27** · 🔄 En cours **12** · ⛔ Bloqué **4** · ⬜ À faire **3**

## Worklist P0 / P1 (ordre d'exécution)
> Cochée = livrée + vérifiée dans cette campagne. Voir EXECUTION_LOG pour les hash.

### P0
- [x] **M802** Rédiger le token Railway en clair (`MONITORING-PLAYBOOK.md:168`) — rotation effective = ⛔ owner (D6)
- [ ] **INC** Vérifier que la séparation des bases prod (postmortem 2026-04-01) est faite — sinon risque destruction shared-DB live (D7)

### P1 — Sécurité / authz (cluster prioritaire) — ✅ LIVRÉ (commit a128bfd)
- [x] **M406** connected-apps : `api_key` retiré des réponses + `@Roles('admin')` sur les GET
- [x] **M203/M208** Tenant : `@Roles('admin')` sur `GET /organizations`, `/units`, `/stores` (list)
- [x] **M301** customers : `otpCode` retiré de la réponse `POST /customers` (specs lisent l'OTP via le store)
- [x] **M403** sync : `POST /sync/push` confronte `payload.storeId` à `req.user` (resolveStoreId)
- [ ] **AUDIT-FINAL** Vérifier remediation S1 (clés en git/historique), S2 (XSS receipts), S3 (receipts public sans auth) — D8/D9

### P1 — Correctness / intégrité
- [x] **M005** sales DTO : `store_credit` whitelisté + `creditNoteCode` (commit b9fdebe)
- [ ] **M006** fiscal : `verifyChain` recompute + index unique anti-fork + spec
- [ ] **M402** audit : `verifyChain` recompute + persister payload + index unique + spec tamper
- [ ] **M107** stock multi-emplacements : trancher source unique + `CHECK(quantity>=0)` + specs
- [ ] **M108** réconciliation stock : spec 19/20/21 % + reject
- [ ] **M302** RGPD : anonymisation/soft-delete customer

### P1 — Build / front
- [x] **M703** mobile : tsc réparé (commit 6ce722c) — vite-env.d.ts, vitest 5/5
- [~] **M704** customer-app : **fix vérifié** (installer `@capacitor/preferences@^6` → tsc vert) mais **NON applicable depuis ce worktree** : `node_modules` est un symlink partagé avec le checkout principal ; `npm install` ici casse le store partagé (testé + recovery effectué). Le manifeste déclare déjà la dep → résolu par `npm install` dans un checkout normal. Pas de bug code.
- [ ] **M601** POS : câbler branche succès TPE (ou bouton confirm) + test
- [ ] **M603** POS : inclure `creditNoteCode` dans l'enqueue offline + tests finalize
- [ ] **M607** POS : confirmer transmission réelle des headers HMAC sync

## Bloqués réels (⛔) — préparés, attente owner/accès
- **D6** Rotation token Railway (accès Railway = owner)
- **D8** Rotation des clés fuitées dans l'historique git (AUDIT-FINAL S1) — accès secrets + réécriture historique = owner
- **M310 / M509** Subscriptions/Billing Stripe = domaine PARQUÉ + env Stripe absent
- **DNS cutover / déploiement Railway** = GO owner explicite requis (jamais auto)

## Parqué (STOP volontaire — ne pas construire)
NF525 Z-seal · Comptamax export comptable · porte offline-sale · onboarding/pricing SaaS.

## Prochaine action automatique
Cluster sécurité P1 ✅ + M005 ✅ + M703 ✅ livrés. Suite P1 correctness/intégrité :
**M108** (spec réconciliation 19/20/21 %) → **M006/M402** (verifyChain recompute + index anti-fork + specs) → **M107** (source unique stock) → **M302** (RGPD). Verify-then-fix, lots cohérents.
