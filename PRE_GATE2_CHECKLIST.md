# PRE_GATE2_CHECKLIST.md — Pre-flight `run-gate2.sh` (migrations 1725→1728 sur Neon) — P357

> Exécution : **machine d'Omar uniquement** (le sandbox ne résout pas l'hôte Neon —
> prouvé P350). Le script fait déjà backup→état-avant→run→contrôles→verdict ;
> cette checklist couvre ce qui est AUTOUR du script.

## 1. Prérequis (5 min, avant de lancer)

- [ ] `psql --version` et `pg_dump --version` répondent (sinon `brew install libpq && brew link --force libpq`)
- [ ] `DATABASE_URL` Neon sous la main (console Neon → Connection string, **pooler**, `?sslmode=require`)
- [ ] Neon console : **PITR/history retention actif** (filet au-dessus du dump logique)
- [ ] Fenêtre calme : pas de déploiement Railway simultané (le boot auto-migre — deux exécutions concurrentes des mêmes migrations = risque de lock/course inutile)
- [ ] Espace disque local pour le dump (taille base < qq Go a priori)
- [ ] Repo à jour : `git -C ~/CAISSE log --oneline -1` ≥ `ea9072d` (le script attend la file 1725→1728)

## 2. Vérification READ-ONLY de l'état actuel (avant le script — optionnel, le script la refait)

```bash
psql "$DATABASE_URL" -c "SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 3;"
# Attendu : 1724000000000-AddPromoUsageLimit en tête (ou 1725/26/27 si partiellement joué)
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM sales;"          # noter le chiffre
psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='sales' AND column_name='pos_session_id';"  # attendu 0
```
> Depuis le sandbox : **pas d'accès même en lecture** (DNS Neon non résolu) — cette
> vérification n'a pas pu être faite à distance, elle est à faire sur ta machine.

## 3. Exécution

```bash
cd ~/CAISSE
DATABASE_URL="postgresql://…neon.tech/…?sslmode=require" ./scripts/run-gate2.sh
```

## 4. Rollback PAR MIGRATION (si un contrôle échoue)

`npm run migration:revert` annule UNE migration à la fois, dans l'ordre inverse :

| Revert n° | Annule | Effet | Sans risque si… |
|---|---|---|---|
| 1 | **1728** | DROP des 3 colonnes cash de `pos_sessions` | toujours (colonnes nullables, aucune donnée legacy) |
| 2 | **1727** | DROP colonnes variantes + table `suppliers` | `suppliers` encore vide (sinon corriger EN AVANT) |
| 3 | **1726** | DROP `sales.pos_session_id` + index | toujours (lignes legacy = NULL) |
| 4 | **1725** | DROP `integration_events` | table encore vide (sinon événements en attente détruits → corriger EN AVANT) |

Dernier recours : `pg_restore` du dump `pre-gate2-*.dump` créé à l'étape A du script.

## 5. Critères de succès (le script les vérifie ; le verdict imprimé fait foi)

1. Tête migrations = `…1728…`
2. `COUNT(sales)` STRICTEMENT inchangé vs avant
3. `integration_events` existe et = 0 lignes ; `suppliers` existe et = 0 lignes
4. `sales.pos_session_id` non-NULL = 0 ; `pos_sessions.opening_float_minor_units` non-NULL = 0
5. Verdict script : `GATE 2 : SUCCÈS ✅`

## 6. Post-GO (après succès)

- [ ] Coller le verdict du script dans la conversation → je passe GATE 2 ✅ dans GATES_READINESS/EXECUTION_LOG
- [ ] Prochain déploiement Railway du backend B : boot sans migration à jouer (déjà en base) — normal
- [ ] Activer/observer le relais outbox (POS-INT) : après une vente de test, `GET /api/integration/outbox/stats` → pending ≥ 1
