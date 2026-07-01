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
cp packages/backend/.env.example packages/backend/.env   # 51 variables documentées, placeholders
# Remplir au minimum : DATABASE_URL, JWT_SECRET (≥32), JWT_REFRESH_SECRET (≥32).
# La validation fail-fast au boot (validateRequiredEnv, testée) refuse un démarrage mal configuré.
```

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

## 6. Sécurité (immuable — cf. CLAUDE.md)
- Jamais de secret commité ; `.env.example` = placeholders uniquement.
- Backend A (`api.addxintelligence.com`) = prod canonique, INTOUCHABLE sans GO.
- Pas de DNS cutover / régénération JWT sans GO explicite.
