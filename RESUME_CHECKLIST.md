# RESUME_CHECKLIST — reprise propre du projet (sécurité de reprise)

> But : reprendre le projet sans redécouverte, vérifier qu'il est sain, puis
> traiter les gates externes. Aucune étape ci-dessous n'exige de secret/prod.

## 0. Récupérer le code (si besoin, depuis le bundle)
Le travail des paquets est sur la branche `recovery/pos-audit-session`, packagé dans
`pos-recovery.bundle` (à la racine + dans les sorties).
```bash
git clone pos-recovery.bundle caisse-restore
cd caisse-restore && git checkout recovery/pos-audit-session
# ou, dépôt existant :
git bundle verify pos-recovery.bundle && git fetch pos-recovery.bundle 'refs/heads/*:refs/heads/*'
```

## 1. Installer & vérifier la santé (local, non dangereux)
```bash
npm install
npm run test:backend      # attendu : ~1080 tests / 155 suites PASS (+2 .pg skip)
npm run test:front        # attendu : 46 tests / 11 fichiers PASS
cd packages/backend && npx tsc --noEmit && npx nest build   # EXIT 0 / RC 0
cd ../backoffice-web && npx tsc --noEmit && npx vite build   # EXIT 0 / build vert
cd ../pos-desktop && npx tsc --noEmit && npx vite build      # EXIT 0 / build vert
```
Note bac à sable arm64 : si vite/vitest échoue sur `@rollup/rollup-linux-arm64-gnu`,
`npm i -D @rollup/rollup-linux-arm64-gnu --no-save` (optionnel par-arch ; la CI x64 le gère seule).

## 2. Configurer l'environnement
```bash
# Backend (51 variables documentées, placeholders) :
cp packages/backend/.env.example packages/backend/.env
# Remplir au minimum : DATABASE_URL, JWT_SECRET (≥32), JWT_REFRESH_SECRET (≥32).
# La validation fail-fast au boot (validateRequiredEnv, testée) refuse un démarrage mal configuré.

# Front (Vite) — les 2 packages ont un .env.example :
cp packages/backoffice-web/.env.example packages/backoffice-web/.env   # VITE_API_URL
cp packages/pos-desktop/.env.example   packages/pos-desktop/.env       # VITE_API_URL
```
`npm run preflight` vérifie automatiquement la complétude .env.example backend ET front
(échoue si une variable lue — `process.env.*` ou `import.meta.env.VITE_*` — n'est pas documentée).

## 3. État courant (voir PROJECT_STATUS.md v9)
- Portée locale : épuisée proprement (intégration, interfaces, inventaire, arbitrages, couverture, hygiène, CI).
- Restent 3 gates externes → voir `EXTERNAL_GATES_RUNBOOK.md`.

## 4. Traiter les gates externes (quand infos/accès fournis)
| Gate | Doc | Info à fournir |
|---|---|---|
| TD-INT-RELAY | `OUTBOX_RELAY_KIT.md` | `OUTBOX_PUBLISH_URL` + `OUTBOX_PUBLISH_SECRET` |
| MIGRATION-1725 | `EXTERNAL_GATES_RUNBOOK.md` §2 | `DATABASE_URL` cible + GO |
| TD-INT-SOCIAL-ENTRIES | `EXTERNAL_GATES_RUNBOOK.md` §3 | plan de comptes social validé (codes + validatedBy) |

## 5. Garde-fous en place (fail-closed, testés)
- Relais : simulation tant que URL+SECRET absents (jamais de demi-activation).
- Migration : additive/réversible (dry-run prouvé sur base jetable).
- Social : `canPostSocialEntries` refuse sans plan validé.
- Boot : `validateRequiredEnv` refuse un démarrage mal configuré (secrets, prod CORS/Redis/synchronize).

## 5bis. Dépannage (symptôme → cause probable → diagnostic → correction)

| Symptôme | Cause probable | Commande de diagnostic | Correction |
|---|---|---|---|
| `preflight` = FAIL "env.example completeness" | une `process.env.X` lue non documentée | `npm run preflight` puis `cd packages/backend && npx jest test/env-example-completeness.spec.ts` | ajouter la variable (placeholder) dans `packages/backend/.env.example` |
| Boot backend crash "Missing required environment variables" | `DATABASE_URL`/`JWT_SECRET`/`JWT_REFRESH_SECRET` absents | lire le message ; `grep -E "^(DATABASE_URL\|JWT_SECRET\|JWT_REFRESH_SECRET)=" packages/backend/.env` | remplir ces clés dans `.env` (JWT ≥ 32 car., `openssl rand -hex 32`) |
| Boot crash "JWT_SECRET must be at least 32 characters" / "insecure defaults" | secret trop court ou valeur par défaut | `npx jest src/common/config/env-validation.spec.ts` | régénérer un secret ≥ 32 (`openssl rand -hex 32`) |
| Boot prod crash "REDIS_URL must be set" | prod sans Redis et sans opt-out | vérifier `NODE_ENV`, `REDIS_URL`, `ALLOW_INMEMORY_CACHE` | fournir `REDIS_URL`, ou `ALLOW_INMEMORY_CACHE=true` (mono-pod uniquement) |
| Boot prod crash "CORS_ORIGIN ..." | CORS absent ou `*` en prod | vérifier `CORS_ORIGIN` | liste explicite d'origines, jamais `*` |
| Build front échoue `@rollup/rollup-linux-arm64-gnu` | binaire natif par-arch manquant (bac à sable arm64) | `node -e "console.log(process.arch)"` | `npm i -D @rollup/rollup-linux-arm64-gnu --no-save` (CI x64 le gère seule) |
| `tsc`/`nest build` échoue | régression type / import | `cd packages/backend && npx tsc --noEmit` | corriger l'erreur affichée (fichier:ligne) |
| Migration dry-run échoue | SQL/entité divergents | `npx jest test/migration-1725-dryrun.spec.ts test/migration-1725-outbox.spec.ts` | corriger la migration/entité (parité P177) ; ne PAS jouer sur cible avant PASS |
| OUTBOX reste en "simulation" | `OUTBOX_PUBLISH_URL`/`OUTBOX_PUBLISH_SECRET` absents (attendu) | `npx jest src/modules/integration/outbox-publisher.spec.ts` | fournir les 2 secrets (cf. OUTBOX_RELAY_KIT.md) — sinon comportement normal |
| Écriture sociale "bloquée" | plan de comptes non validé (attendu) | `npx jest src/modules/comptamax/social-entries-guard.spec.ts` | fournir plan validé (codes + `validatedBy`) — décision comptable |
| Tests `.pg.spec` "skipped" | pas de Postgres réel (attendu) | — | fournir `TEST_DATABASE_URL` (CI Postgres) si besoin de les exécuter |

## 6. Sécurité (immuable — cf. CLAUDE.md)
- Jamais de secret commité ; `.env.example` = placeholders uniquement.
- Backend A (`api.addxintelligence.com`) = prod canonique, INTOUCHABLE sans GO.
- Pas de DNS cutover / régénération JWT sans GO explicite.
