# GATES_READINESS — état de préparation des 3 gates externes

> Snapshot local (2026-07-01, jalon PAQUET 219). Aucun secret affiché — placeholders uniquement.
> Le "comment faire" détaillé est dans `EXTERNAL_GATES_RUNBOOK.md`.
> Vérification rapide : `npm run preflight` (structure) / `npm run preflight:full` (+ tsc & tests ciblés).

## Tableau de bord

| Gate | Prêt (prouvé local) | Manquant (à fournir) | Pourquoi bloqué | Sévérité |
|---|---|---|---|---|
| **TD-INT-RELAY** | Publisher HTTP + signature HMAC + anti demi-activation + relais/backoff/dead-letter ; kit `OUTBOX_RELAY_KIT.md` ; 8 tests loopback | `OUTBOX_PUBLISH_URL`, `OUTBOX_PUBLISH_SECRET` (+ `OUTBOX_RELAY_ENABLED=true`) | Secrets réels indisponibles en sandbox ; interdits par contrainte | gate (secret) |
| **MIGRATION-1725** | SQL up/down + 17 colonnes + parité entité + dry-run runner réel (apply/no-drift/rollback) ; 6 tests | `DATABASE_URL` de la base cible + GO | Pas d'accès base cible ; migration cible interdite sans GO | gate (accès DB) |
| **TD-INT-SOCIAL-ENTRIES** | Garde `canPostSocialEntries` fail-closed + 7 tests ; slots requis listés (641/645/431/421) ; export = justificatif RH | plan de comptes social **validé** (codes des 4 slots + `validatedBy`) | Décision comptable non tranchée ; mapping jamais inventé | gate (décision métier) |

## Détail par gate

### TD-INT-RELAY — publication outbox réelle
- **Prêt** : `outbox-publisher.ts` (factory env-gated), `publish-request.ts` (envelope + HMAC + verify anti-rejeu), relais backoff/cap 5 → dead-letter. Preuves : `outbox-publisher.spec.ts` (8), `outbox-relay.spec.ts`.
- **Comportement actuel (attendu, sûr)** : simulation tant que les 2 secrets absents ; jamais de demi-activation.
- **Débloquer** : fournir les 2 variables → `OUTBOX_RELAY_KIT.md` §3.

### MIGRATION-1725 — table integration_events
- **Prêt** : `1725000000000-AddIntegrationOutbox.ts` + `integration-event.entity.ts` (parité 17 col). Preuves : `migration-1725-outbox.spec.ts` (3), `migration-1725-dryrun.spec.ts` (3).
- **Comportement actuel (attendu)** : table non présente sur cible tant que non jouée ; additif/réversible.
- **Débloquer** : `DATABASE_URL` cible + GO → `EXTERNAL_GATES_RUNBOOK.md` §2 (ou auto au redéploiement, `migrationsRun:isProd`).

### TD-INT-SOCIAL-ENTRIES — écritures sociales
- **Prêt** : `social-entries-guard.ts` (fail-closed) + `social-preaccounting.ts` (justificatif RH). Preuve : `social-entries-guard.spec.ts` (7).
- **Comportement actuel (attendu)** : aucune écriture sociale ; export = justificatif seulement.
- **Débloquer** : plan validé (codes 4 slots + `validatedBy`) → `EXTERNAL_GATES_RUNBOOK.md` §3.

## Rappel contraintes
Zéro secret, zéro prod, zéro migration cible, zéro appel réel, zéro activation OUTBOX, zéro mapping comptable inventé. Tout reste local, réversible, testé.
