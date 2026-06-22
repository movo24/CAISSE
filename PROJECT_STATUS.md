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
- [x] **S2/S3 (D9)** XSS receipts **remédié+durci** (esc partout + `<title>`, commit 5309908) ; S3 public = par design (QR/UUID). Reste S1 = rotation clés historique (D8, owner)

### P1 — Correctness / intégrité
- [x] **M005** sales DTO : `store_credit` whitelisté + `creditNoteCode` (commit b9fdebe)
- [x] **M402** audit : v2 recompute (couvre `details`) + `hashed_at` + index unique anti-fork + retry + migration 1744 + spec (commit 4355922) — GO owner
- [x] **M006** fiscal : recompute `fiscal_journal` autoritatif + spec **déjà présents** (auditeur les a ratés) ; sous-item index anti-fork fiscal_journal **différé** (toucherait la tx de void sans retry) ; recompute sales/credit_notes = NF525 PARQUÉ
- [~] **M107** stock : pré-design + **diagnostic read-only livré** (`findStockDivergences` + `GET /stock-locations/divergences`, commit 0123cca) ; reste = décision A/B/C + réconciliation one-shot (prod-gated)
- [x] **M108** réconciliation stock : spec déjà présente (auditeur l'a ratée) + ajout boundary 19/20/21 % & reject (commit df08a09)
- [~] **M302** RGPD : code livré PUIS **GELÉ** derrière `CUSTOMER_ANONYMIZE_ENABLED` (commit 7012e99 — correction discipline) ; sous-erase vérifié ≈ nul (PII confinée à `customers`). Reste = **politique champs + carve-out factures** (owner/comptable) avant activation du flag.
- [x] **D16 interim** : alerte `AUDIT_WRITE_FAILED` (419b2fd) + **fix classe-3 audit fantôme** (f2b39b9, stock.adjustStock + coupon.redeem → audit post-commit) ; décision archi globale reste owner

### P1 — Build / front
- [x] **M703** mobile : tsc réparé (commit 6ce722c) — vite-env.d.ts, vitest 5/5
- [~] **M704** customer-app : **fix vérifié** (installer `@capacitor/preferences@^6` → tsc vert) mais **NON applicable depuis ce worktree** : `node_modules` est un symlink partagé avec le checkout principal ; `npm install` ici casse le store partagé (testé + recovery effectué). Le manifeste déclare déjà la dep → résolu par `npm install` dans un checkout normal. Pas de bug code.
- [ ] **M601** POS : câbler branche succès TPE (ou bouton confirm) + test
- [ ] **M603** POS : inclure `creditNoteCode` dans l'enqueue offline + tests finalize
- [~] **M607** POS : vérifié → couche HMAC sync **morte** (token jamais provisionné, header non posé, backend ne vérifie pas) ; commentaires trompeurs corrigés (6a05c0b, D19) ; sync authentifié par JWT. Câblage end-to-end = gated (chemin écriture sync).

## Bloqués réels (⛔) — préparés, attente owner/accès
- **D6** Rotation token Railway (accès Railway = owner)
- **D8** Rotation des clés fuitées dans l'historique git (AUDIT-FINAL S1) — accès secrets + réécriture historique = owner
- **M310 / M509** Subscriptions/Billing Stripe = domaine PARQUÉ + env Stripe absent
- **DNS cutover / déploiement Railway** = GO owner explicite requis (jamais auto)

## Parqué (STOP volontaire — ne pas construire)
NF525 Z-seal · Comptamax export comptable · porte offline-sale · onboarding/pricing SaaS.

## Salve audit read-only secondaire (continuité, 2026-06-22)
- [x] **M303** loyalty QR token : vérifié sain (HMAC/TTL/constant-time) + spec sécurité (487ceb1)
- [x] **M105** CSV : garde anti formula-injection CWE-1236 dans `toCsv` (d8ea297) ; round-trip+brand/supplier déjà testés
- [x] **M306/D14** jackpot : vérifié read-only → faux positif (fail-closed serveur)
- [⛔] **M207/D18** stores.hardDelete : ~20 tables `store_id` orphelines dont fiscal → **décision owner/comptable** (destructif+fiscal+rétention légale), non touché

## Reste vraiment bloqué (vrai danger / décision / credential — pas prudence administrative)
- **M107 réconciliation one-shot** : ÉCRIT le stock réel → **validation prod requise** avant exécution (le diagnostic read-only est livré). + **choix A/B/C** = décision archi.
- ✅ **D16/D17 RATIFIÉS** (owner 2026-06-22) : fiscal_journal in-band fail-closed (NF525) ; AuditService out-of-band best-effort + alerte (hors NF525) ; event opposable → fiscal_journal. Modèle = contrat ; classe-3 cohérente. CLOSED.
- **D6/D8** rotations de secrets (token Railway, clés historique git) · **D7** séparation bases prod · **DNS/déploiement** : credential/accès prod owner.
- **#3** diagnostic fork audit prod : besoin accès prod (requête read-only fournie).
- **M310/M509** Stripe billing = PARQUÉ + env absent.

## Prochaine action automatique (continuité)
Exécution autonome sur le safe restant (audit read-only des ⚠️, garde-fous additifs, tests, docs). Vrais blocages ci-dessus uniquement.
