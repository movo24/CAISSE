# EXTERNAL_GATES_RUNBOOK — déblocage propre des 3 gates externes

> Objectif : quand l'info/accès est fourni, exécution sans redécouverte.
> Tout le reste (mécaniques, tests, dry-run, garde-fous) est déjà prouvé en local.
> Interdits absolus tant que non fourni : secret réel, prod, migration cible réelle, décision comptable.

---

## GATE 1 — TD-INT-RELAY (publication outbox HTTP réelle)

**Responsable de validation** : ops/infra (fournir secrets) + consommateur (Comptamax24/TimeWin24/Analytik R).
**Prérequis (à fournir)** : `OUTBOX_PUBLISH_URL`, `OUTBOX_PUBLISH_SECRET` (secret HMAC partagé avec le consommateur).
**Détail complet** : voir `OUTBOX_RELAY_KIT.md`.

**Commandes**
```bash
export OUTBOX_PUBLISH_URL="https://<consumer>/webhook/pos"
export OUTBOX_PUBLISH_SECRET="<fourni>"
export OUTBOX_RELAY_ENABLED="true"
cd packages/backend && npx jest src/modules/integration/outbox-publisher.spec.ts   # factory bascule HTTP
# puis redéploiement backend (RUNBOOK.md)
```
**Critères de succès** : `GET /api/integration/outbox/stats` → `published` croît, `failed` = 0.
**Rollback** : `OUTBOX_RELAY_ENABLED=false` (ou retirer URL/SECRET) → retour simulation, 0 perte (outbox persistée).
**Risques** : URL/secret erronés → 401/403 côté consommateur (dead-letter après 5 tentatives, pas de perte). Mitigé : tester d'abord contre un receveur de recette.

---

## GATE 2 — MIGRATION-1725 (table integration_events sur base cible)

**Responsable de validation** : ops/DBA (accès base cible Neon).
**Prérequis** : `DATABASE_URL` de la base cible (hors prod sans GO explicite).
**Déjà prouvé** : SQL up()/down() + 17 colonnes + parité entité (P176/P177) ; dry-run via runner réel sur base jetable (P207) → apply / no-drift / rollback.

**Commandes** (une des deux)
```bash
# Option A — explicite :
cd packages/backend && DATABASE_URL="postgresql://...cible...?sslmode=require" npm run migration:run
# Option B — auto au boot : migrationsRun:isProd (app.module.ts) → un redéploiement backend applique la migration.
```
**Critères de succès** : `\d integration_events` (17 colonnes) ; `SELECT name FROM migrations WHERE name='AddIntegrationOutbox1725000000000';` renvoie 1 ligne.
**Rollback** : `npm run migration:revert` (down() = DROP TABLE, additif/réversible, 0 perte sur tables existantes).
**Risques** : très faibles (additif, `CREATE TABLE IF NOT EXISTS`). Aucune table existante modifiée.

---

## GATE 3 — TD-INT-SOCIAL-ENTRIES (écritures sociales réelles)

**Responsable de validation** : **expert-comptable** (décision métier — NON tranchée ici).
**Prérequis** : plan de comptes social validé = un code pour chaque slot + preuve de validation :
- `grossSalaries` (~PCG 641), `employerCharges` (~645), `socialAgenciesPayable` (~431), `netPayable` (~421)
- `validatedBy` (identité comptable), `validatedAt`.
**Déjà prouvé** : garde-fou `social-entries-guard.ts` (P208) refuse toute écriture tant que flag + chart complet + `validatedBy` ne sont pas réunis. L'export social actuel reste un justificatif RH (pas des écritures).

**Commandes** : aucune tant que le plan n'est pas validé (fail-closed). Une fois validé, alimenter le chart + `SOCIAL_ENTRIES_ENABLED=true`, puis brancher la production d'écritures sur le garde.
**Critères de succès** : `canPostSocialEntries('true', chart).allowed === true` uniquement avec chart complet+validé.
**Rollback** : `SOCIAL_ENTRIES_ENABLED=false` → retour au justificatif RH seul.
**Risques** : élevés si activé sans plan validé → le garde-fou l'empêche (fail-closed, testé).

---

## Ordre recommandé
1. GATE 2 (migration) — prérequis technique à l'outbox persistant.
2. GATE 1 (relais) — une fois la table présente + secrets fournis.
3. GATE 3 (social) — indépendant, dépend uniquement de la décision comptable.

## Ce que je dois recevoir pour agir
- GATE 1 : `OUTBOX_PUBLISH_URL` + `OUTBOX_PUBLISH_SECRET` (+ GO redéploiement).
- GATE 2 : `DATABASE_URL` cible + GO migration (ou GO redéploiement).
- GATE 3 : plan de comptes social validé (codes + `validatedBy`).
