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
- [x] **M402** audit : v2 recompute (couvre `details`) + `hashed_at` + index unique anti-fork + retry + migration 1744 + spec (commit 4355922) — GO owner
- [x] **M006** fiscal : recompute `fiscal_journal` autoritatif + spec **déjà présents** (auditeur les a ratés) ; sous-item index anti-fork fiscal_journal **différé** (toucherait la tx de void sans retry) ; recompute sales/credit_notes = NF525 PARQUÉ
- [~] **M107** stock source unique : **pré-design livré** `docs/design/M107-stock-source-of-truth.md` (divergence caractérisée, options A/B/C, reco) — ⏸ attente choix owner avant code
- [x] **M108** réconciliation stock : spec déjà présente (auditeur l'a ratée) + ajout boundary 19/20/21 % & reject (commit df08a09)
- [~] **M302** RGPD : **note de politique livrée** `docs/design/M302-rgpd-nf525-policy.md` (constat : ventes = `customer_id` seul, zéro PII ⇒ pas de heurt fiscal ; colonnes déjà là, logique absente) — ⏸ attente décision politique owner
- [x] **D16 interim** : alerte `AUDIT_WRITE_FAILED` (419b2fd) + **fix classe-3 audit fantôme** (f2b39b9, stock.adjustStock + coupon.redeem → audit post-commit) ; décision archi globale reste owner

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

## Gate de validation (périmètre POS sensible — owner décide avant exécution)
Livré sous GO : M402 (audit recompute), M006 (déjà couvert), D16 classe-3 (audit fantôme). **Reste gated** :
- **D16 archi globale** : in-tx fail-closed vs out-of-band best-effort — gated **D17** (périmètre NF525 de `AuditService`). Interim alerte + fix classe-3 déjà en place ⇒ pas de blocage opérationnel.
- **M107/D11** source unique du **stock réel** — choix A/B/C + **réconciliation one-shot** (valeurs déjà dérivées) ; Z fiscal non concerné, mais valorisation analytique + garde de vente le sont. Note prête.
- **M302/D13** anonymisation RGPD client — politique (champs à scrubber) ; rétention factures 10 ans **à confirmer comptable** ; portée fiscale nulle ⇒ implémentable sans attendre dès que les champs sont posés. Note prête.
- **D9** patch reçus (`<title>` esc / expiry) — modif reçus = sensible.
- **#3** diagnostic fork prod — **besoin accès prod** (requête read-only fournie).

## Prochaine action automatique (safe uniquement)
Périmètre safe + GO encadré épuisé proprement (notes de décision prêtes, classe-3 corrigée). En attente d'une décision owner parmi : champs M302, choix M107, périmètre D17, patch D9, ou accès prod #3. Items safe résiduels mineurs : barrel `entities/index.ts` (cosmétique, inoffensif), nit commentaire health 2s/5s.
