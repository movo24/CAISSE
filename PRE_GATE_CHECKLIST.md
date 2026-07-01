# PRE_GATE_CHECKLIST — à valider AVANT tout branchement de gate externe

> Ultra strict. Ne franchir une gate que si TOUTES les cases sont cochées.
> Rien ne s'active sans un GO humain explicite + les valeurs réelles fournies par le responsable.
> Valeurs sensibles : jamais inventées, jamais commitées, jamais loggées (voir redact.ts).

## Commun (toutes gates)
- [ ] `npm run preflight:full` = OVERALL PASS.
- [ ] `npm run test:security` = tous verts (secrets/env/docs/source/gitignore/scripts CI).
- [ ] `git status` propre ; branche connue ; sauvegarde/bundle à jour.
- [ ] Aucune valeur réelle dans le repo (gardes secret .env/.md verts).
- [ ] GO humain explicite pour CETTE gate.
- **STOP si** : preflight FAIL, secret détecté, doute sur une valeur, pas de GO.

---

## GATE 1 — TD-INT-RELAY (publication OUTBOX réelle)
**Responsable** : ops/infra + consommateur (Comptamax24/TimeWin24/Analytik R).
- [ ] **Prérequis** : `OUTBOX_PUBLISH_URL` + `OUTBOX_PUBLISH_SECRET` fournis (hors repo, hors log).
- [ ] **Dry-run** : `npx jest src/modules/integration/outbox-publisher.spec.ts` (loopback) = PASS ; test contre un receveur de RECETTE avant prod.
- [ ] **Preuve attendue** : `GET /api/integration/outbox/stats` → `published` croît, `failed` = 0.
- [ ] **Rollback prévu** : `OUTBOX_RELAY_ENABLED=false` (ou retirer URL/SECRET) → retour simulation, 0 perte.
- **Interdits** : pointer une URL de prod consommateur non validée ; committer/logger le secret.
- **STOP si** : 401/403 du consommateur, `failed` > 0 en recette, secret exposé.

## GATE 2 — MIGRATION-1725 (table integration_events sur cible)
**Responsable** : ops/DBA.
- [ ] **Prérequis** : `DATABASE_URL` cible (hors repo) + GO ; sauvegarde base cible faite.
- [ ] **Dry-run** : `npx jest test/migration-1725-dryrun.spec.ts test/migration-1725-outbox.spec.ts` = PASS (apply/no-drift/rollback).
- [ ] **Commande** : `DATABASE_URL="…cible…" npm run migration:run` (ou redéploiement, `migrationsRun:isProd`).
- [ ] **Preuve attendue** : `\d integration_events` (17 colonnes) + ligne dans `migrations`.
- [ ] **Rollback prévu** : `npm run migration:revert` (down = DROP TABLE, additif/réversible).
- **Interdits** : jouer sur une base non sauvegardée ; toucher Backend A prod sans GO DNS/prod.
- **STOP si** : dry-run KO, base non sauvegardée, cible ambiguë.

## GATE 3 — TD-INT-SOCIAL-ENTRIES (écritures sociales réelles)
**Responsable** : expert-comptable (décision métier).
- [ ] **Prérequis** : plan de comptes social **validé** = codes des 4 slots (grossSalaries~641, employerCharges~645, socialAgenciesPayable~431, netPayable~421) + `validatedBy` + `validatedAt`.
- [ ] **Dry-run** : `npx jest src/modules/comptamax/social-entries-guard.spec.ts` = PASS ; `canPostSocialEntries('true', chart).allowed === true` uniquement avec chart complet+validé.
- [ ] **Preuve attendue** : écritures produites conformes au plan validé (revue comptable).
- [ ] **Rollback prévu** : `SOCIAL_ENTRIES_ENABLED=false` → retour justificatif RH seul.
- **Interdits** : inventer un mapping de comptes ; activer sans `validatedBy`.
- **STOP si** : plan incomplet/non validé, doute comptable.

---

## Après franchissement (toute gate)
- [ ] Preuve capturée (stats/`\d`/revue) archivée.
- [ ] `EXECUTION_LOG.md` mis à jour (commande réelle + résultat).
- [ ] Rollback re-testé disponible.
