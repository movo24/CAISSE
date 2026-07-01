# RESUME_CHECKLIST — reprise du projet (humain ou agent) — LIRE EN PREMIER

> Réécrit P295 (2026-07-02). C'est LE point d'entrée unique de reprise.
> Règle de la maison : **preuve avant affirmation** — rien n'est « fait/testé/branché » sans commande + résultat.

## 0. Où commencer (5 minutes)

1. Lis ce fichier en entier.
2. État réel détaillé : `PROJECT_STATUS.md` (jalons v19→v22 en tête) + `STATE_INDEX.md` (index par module).
3. Séquence de travail : `MASTER_ROADMAP.md`. Journal : `EXECUTION_LOG.md` (P1→P294).
4. Contrats d'intégration : `POS_PUSH_CONTRACT.md` (push POS), `TIMEWIN24_CONTRACT.md` (RH), `TIMESCALE_PLAN.md` (time-series, doc only).
5. API : `POS_API_MAP_DETAILED.md` (générée — `npm run api:map` pour rafraîchir).
6. Serveur neuf : `SERVER_SETUP_RUNBOOK.md`. Railway/Neon existant : `packages/backend/RUNBOOK.md`.

## 1. État réel (vérifié P294)

- **Git SAIN** : branche de travail `recovery/pos-audit-session` (l'ancien blocage FUSE des refs est réparé depuis P272 ; `GIT_RECOVERY.md` = historique, plus une procédure à suivre). `pos-recovery.bundle` à la racine = filet de secours, régénéré à chaque jalon.
- **Backend vert** : ~196 suites PASS / 3 skip `.pg` (gated `TEST_DATABASE_URL`) · ~1320 tests / 0 échec · `tsc` EXIT 0 · `nest build` RC 0. Front : 14 fichiers / 59 tests vitest. Compteurs exacts : dernier jalon de `PROJECT_STATUS.md`.
- **Zéro push distant effectué** — tout est en commits locaux + bundle.

## 2. Vérifier la santé avant de toucher quoi que ce soit

```bash
npm install
bash scripts/preflight.sh              # attendu : OVERALL PASS
npm run test:security                  # attendu : 10 suites / 34 tests PASS
npm run test:backend                   # complet (long) — par tranches si timeout (cf. §7 dernière ligne)
npm run test:front
```

## 3. Gates bloquantes (les VRAIS stops — ne pas contourner)

| Gate | Il manque | Kit prêt |
|---|---|---|
| **GATE 1 — push réel outbox** | `OUTBOX_PUBLISH_URL` + `OUTBOX_PUBLISH_SECRET` (+ `OUTBOX_RELAY_ENABLED=true`) | `OUTBOX_RELAY_KIT.md` §6-7 ; répétition locale : `node scripts/mock-receiver.js` ; chaîne prouvée par `relay-e2e-loopback.pgmem.spec.ts` |
| **GATE 2 — migration 1725** | `DATABASE_URL` cible + GO écrit | `EXTERNAL_GATES_RUNBOOK.md` §2 (dry-run prouvé) |
| **GATE 3 — écritures sociales** | plan de comptes validé comptable (codes + validatedBy) | garde `canPostSocialEntries` fail-closed |
| Runtime recette | Postgres jetable (lever #1 PIN-500, e2e Playwright RUN) | `GATES_READINESS.md` |
| TW24 live | accès réseau + secrets TW24 | `TIMEWIN24_CONTRACT.md` §7 |

## 4. Ce qu'il ne faut SURTOUT PAS faire

- ❌ Toucher Backend A (`api.addxintelligence.com`) — prod canonique, GO explicite requis.
- ❌ Push distant, régénération JWT, cutover DNS sans GO.
- ❌ `TYPEORM_SYNCHRONIZE=true` ou `db:push` en prod ; UPDATE/DELETE sur `audit_entry`, ventes validées, Z-reports.
- ❌ Convertir `sales`/`integration_events`/`audit_entry` en hypertables Timescale (casse idempotence + NF525 — `TIMESCALE_PLAN.md` §1-2).
- ❌ Inventer des règles métier (plan comptable, fériés, barèmes) ou committer un secret (7 gardes CI le bloquent).
- ❌ « Corriger » `wire-contract.spec.ts` si le contrat push change : c'est un GEL — bump `schemaVersion` + coordination consommateurs.

## 5. Commandes utiles

```bash
npm run api:map                        # régénérer la carto API
npm run test:security                  # gardes anti-secret
cd packages/backend && npm run fiscal:verify   # vérif chaînes NF525 (lecture seule, requiert DB)
node scripts/mock-receiver.js          # receveur de recette local (GATE 1 rehearsal)
./docker/backup.sh [list|restore f]    # backup/restore Postgres compose
./docker/deploy.sh                     # déploiement gardé (voir SERVER_SETUP_RUNBOOK.md)
git bundle create pos-recovery.bundle --all   # rafraîchir le filet
```

## 6. Prochaines décisions BUSINESS (aucune n'est du code)

1. **Fournir GATE 1** (URL+secret du premier consommateur réel) → première preuve de push end-to-end. **Débloquant n°1.**
2. GO GATE 2 (migration 1725 sur base cible).
3. Plan de comptes social (GATE 3).
4. Modèle des **variantes produit** (TD-PRODUCT-VARIANTS — la règle produit les veut, le modèle n'existe pas).
5. Canal TW24 : webhook dédié actuel vs consommateur outbox standard.
6. Paywin24 : périmètre paie à définir avant tout code.

## 7. Dépannage (symptôme → cause → correction)

| Symptôme | Cause probable | Correction |
|---|---|---|
| `preflight` FAIL env completeness | variable lue non documentée | l'ajouter (placeholder) dans `.env.example` (`npx jest test/env-example-completeness.spec.ts` pour la localiser) |
| Boot crash « Missing required environment variables » | `.env` incomplet | `DATABASE_URL`, `JWT_SECRET`/`JWT_REFRESH_SECRET` ≥ 32 (`openssl rand -hex 32`) |
| Boot prod crash Redis/CORS | prod sans `REDIS_URL` / CORS `*` | `REDIS_URL` ou `ALLOW_INMEMORY_CACHE=true` (mono-pod) ; CORS liste explicite |
| vite/vitest échoue `@rollup/rollup-linux-arm64-gnu` | binaire natif par-arch (sandbox arm64) | `npm i -D @rollup/rollup-linux-arm64-gnu --no-save` |
| Migration dry-run échoue | SQL/entité divergents | `npx jest test/migration-1725-dryrun.spec.ts test/migration-1725-outbox.spec.ts` ; ne PAS jouer sur cible avant PASS |
| Tests `.pg.spec` skipped | pas de Postgres réel | attendu ; fournir `TEST_DATABASE_URL` pour les jouer |
| OUTBOX reste « simulation » | secrets absents | attendu (fail-closed) ; cf. GATE 1 |
| Écriture sociale « bloquée » | plan de comptes non validé | attendu ; cf. GATE 3 |
| `stores/sync` → `total: 0` | secrets TW24 absents sur l'env | `TIMEWIN24_POS_SECRET`/`API_KEY` |
| jest timeout global (sandbox ~45 s/commande) | suite complète trop longue | `npx jest --listTests \| split -n l/5`, lancer chaque tranche avec `--maxWorkers=2` |

## 8. Sécurité (immuable — cf. CLAUDE.md)

Jamais de secret commité ; `.env.example` = placeholders uniquement ; argent = centimes entiers ; audit append-only ; hash-chain intouchable ; idempotence sur toute écriture d'argent ; Backend A intouchable sans GO.
