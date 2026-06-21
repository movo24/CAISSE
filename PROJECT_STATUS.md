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

### P1 — Sécurité / authz (cluster prioritaire)
- [ ] **M406** connected-apps : exclure `api_key` des réponses + scoper org + `@Roles`
- [ ] **M203/M208** Tenant : `@Roles('admin')` sur `GET /organizations`, `/units`, `/stores` (list)
- [ ] **M301** customers : ne plus renvoyer `otpCode` dans la réponse `POST /customers`
- [ ] **M403** sync : `POST /sync/push` doit confronter `payload.storeId` à `req.user`
- [ ] **AUDIT-FINAL** Vérifier remediation S1 (clés en git/historique), S2 (XSS receipts), S3 (receipts public sans auth)

### P1 — Correctness / intégrité
- [ ] **M005** sales DTO : whitelister `store_credit` + `creditNoteCode`
- [ ] **M006** fiscal : `verifyChain` recompute + index unique anti-fork + spec
- [ ] **M402** audit : `verifyChain` recompute + persister payload + index unique + spec tamper
- [ ] **M107** stock multi-emplacements : trancher source unique + `CHECK(quantity>=0)` + specs
- [ ] **M108** réconciliation stock : spec 19/20/21 % + reject
- [ ] **M302** RGPD : anonymisation/soft-delete customer

### P1 — Build / front
- [ ] **M704** customer-app : installer deps Capacitor manquantes → tsc vert
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
Exécuter le cluster sécurité P1 (M406 → M203/M208 → M301 → M403), vérifier chaque faille contre le code réel avant correctif, tester, committer par lot « security hardening », puis M704 et la suite P1.
