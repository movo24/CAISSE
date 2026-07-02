# MIGRATION_RUNBOOK.md — Jouer 1725 + 1726 + 1727 sur la base cible (GATE 2)

> P319 (cycle I2) — 2026-07-02. Procédure humaine, pas à pas. **Rien ici ne s'exécute tout seul** : il te faut le `DATABASE_URL` cible et ta décision. Durée ≈ 10 min, fenêtre calme recommandée (les deux migrations sont additives → pas de coupure nécessaire, mais prudence d'abord).

## 0. Ce que font ces migrations (et ce qu'elles ne font PAS)

| Migration | Ajoute | Touche aux données existantes ? | Réversible |
|---|---|---|---|
| **1725-AddIntegrationOutbox** | table `integration_events` (17 colonnes) + index | NON (nouvelle table) | ✅ `down()` = DROP de la table (vide tant que le relais n'a pas tourné) |
| **1726-AddSalePosSessionId** | colonne `sales.pos_session_id` (uuid **nullable**) + index composite | NON (lignes existantes = NULL) | ✅ `down()` = DROP colonne + index |
| **1727-AddProductVariantsAndSuppliers** | 4 colonnes **nullables** sur `products` (parent/label/marque/fournisseur) + table `suppliers` + index | NON (lignes existantes = NULL, produits simples) | ✅ `down()` = DROP colonnes + table (⚠️ seulement si `suppliers` encore vide, sinon corriger en avant) |

Preuves déjà jouées en local : `migration-1725-dryrun.spec` + parité entité 17 colonnes (P176/177) ; `migration-1726-dryrun.pgmem.spec` (P319 : up idempotent, lignes legacy intactes, down propre). Aucune des deux ne touche `sales` existantes, à la hash-chain, ni aux montants.

## 1. Comment elles s'exécutent en réalité (à savoir AVANT)

⚠️ **En production, les migrations se jouent AUTOMATIQUEMENT au boot du backend** (`migrationsRun: isProd` dans `app.module.ts`). Concrètement : le prochain déploiement du backend sur un environnement dont la base ne les a pas encore = elles se jouent à ce boot. C'est le comportement Railway existant, pas une nouveauté. La procédure manuelle ci-dessous sert à les jouer AVANT un déploiement, de façon contrôlée.

## 2. Procédure manuelle contrôlée

```bash
# ── A. BACKUP D'ABORD (non négociable) ──
# Neon : vérifier que le PITR est actif (console Neon) ; ET prendre un dump logique :
pg_dump "$DATABASE_URL" --no-owner -Fc -f pre-1725-1726-$(date +%Y%m%d-%H%M).dump
# (chemin docker-compose : ./docker/backup.sh)

# ── B. ÉTAT AVANT ──
psql "$DATABASE_URL" -c "SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 3;"
# attendu : 1724000000000-AddPromoUsageLimit en tête (ou plus ancien)
psql "$DATABASE_URL" -c "\d integration_events" 2>&1 | head -2   # attendu : Did not find any relation
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name='sales' AND column_name='pos_session_id';"
# attendu : 0 ligne

# ── C. JOUER (les deux se jouent ensemble, dans l'ordre des timestamps) ──
cd packages/backend
DATABASE_URL="<CIBLE>" npm run migration:run
# attendu : 3 migrations exécutées : 1725 puis 1726 puis 1727 (variantes+suppliers, additive, dry-run pg-mem P327)

# ── D. CONTRÔLES POST-MIGRATION ──
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM integration_events;"                  # 0 (table neuve)
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM sales WHERE pos_session_id IS NOT NULL;"  # 0 (legacy = NULL)
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM sales;"                               # INCHANGÉ vs avant
# Santé applicative après redéploiement : GET /api/health → 200 "ok"
# puis une vente de test → GET /api/integration/outbox/stats (pending ≥ 1 : l'outbox écrit)
```

## 3. Rollback

```bash
cd packages/backend
DATABASE_URL="<CIBLE>" npm run migration:revert   # annule 1727
DATABASE_URL="<CIBLE>" npm run migration:revert   # annule 1726
DATABASE_URL="<CIBLE>" npm run migration:revert   # annule 1725
# Vérifier : la table integration_events et la colonne pos_session_id ont disparu ;
# SELECT COUNT(*) FROM sales; inchangé. En dernier recours : restaurer le dump de l'étape A.
```
⚠️ Ne revert 1725 QUE si `integration_events` est encore vide (sinon tu détruis des événements en attente — dans ce cas, corrige en avant, ne recule pas).

## 4. Garde anti-exécution accidentelle

- Le sandbox/dev ne peut PAS jouer ces migrations sur la cible : il n'a pas `DATABASE_URL` cible (fail-closed par absence de secret — la même barrière que GATE 1).
- `npm run migration:run` sans `DATABASE_URL` valide échoue immédiatement (validation de connexion TypeORM).
- La CI ne lance jamais `migration:run` (vérifiable dans `.github/workflows/ci.yml`).
- Décision consciente requise = fournir l'URL + taper la commande. Nous n'ajoutons PAS de garde interactive dans le chemin de boot prod : le boot auto-migrant est le mécanisme de déploiement Railway existant, le changer serait un changement de comportement de prod (hors périmètre sans GO dédié).

## 5. Critères de GO

1. Backup A fait et vérifié (taille > 0, `pg_restore --list` fonctionne).
2. Fenêtre calme (pas d'obligation d'arrêt, mais évite un déploiement simultané).
3. Toi qui tapes la commande — pas un agent.
