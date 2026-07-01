# TIMESCALE_PLAN.md — Plan technique time-series (PRÉPARATION SEULE — ⛔ aucune activation sans GO spécifique)

> 2026-07-02 (bloc A6, P286). Statut : **plan**, zéro code, zéro migration. Le dépôt ne contient aujourd'hui AUCUNE référence Timescale (vérifié par grep) — ce document part de zéro sur les vraies tables.

## 0. Correction de périmètre (vérifiée dépôt)

Les tables `tickets` et `register_events` **n'existent pas** dans CAISSE. Les tables réelles concernées par le time-series et par le piège « PK mono-colonne vs `ts` » sont :

| Table réelle | PK actuelle | Contraintes uniques | Rôle |
|---|---|---|---|
| `sales` | `id` uuid (mono-colonne) | `(ticket_number, store_id)` unique · `(store_id, sale_seq)` unique | Ledger NF525 : hash-chain, immutabilité, idempotence de création |
| `integration_events` | `id` uuid **généré côté client dans la transaction métier** (mono-colonne) | — | Outbox : l'`id` EST la clé d'idempotence du contrat push/pull (`POS_PUSH_CONTRACT.md`) |
| `audit_entry` | `id` uuid | chaîne SHA-256 append-only | Journal légal |
| `customer_visits` | `id` uuid | — | Fréquentation (time-series léger) |

## 1. Le piège (exactement celui que tu as identifié, transposé)

Timescale impose que **toute contrainte UNIQUE (PK comprise) d'une hypertable contienne la colonne de partitionnement** (`created_at`/`occurred_at`). Convertir ces tables exigerait `PRIMARY KEY (id, ts)` — et ça casse :

1. **Idempotence** : deux insertions du même `id` avec deux `ts` différents deviendraient DEUX lignes valides. Le rejeu offline (`sync.push`, prouvé P280) et la dédup consommateur (contrat P283) reposent sur l'unicité mono-colonne de `id`. Rupture directe de l'invariant « un retry ne crée jamais deux ventes ».
2. **Les FK entrantes** : `sale_line_items.sale_id → sales.id` (et autres) ne peuvent plus référencer `id` seul ; Timescale restreint de toute façon les FK vers les hypertables.
3. **NF525** : la hash-chain et l'immutabilité de `sales`/`audit_entry` sont incompatibles avec les politiques de rétention/compression par chunks (un chunk droppé = trou dans la chaîne légale).

## 2. Décision recommandée (règle dure)

**Les tables ledger (`sales`, `sale_line_items`, `audit_entry`, `credit_notes`, `fiscal_journal`) ne deviennent JAMAIS des hypertables.** Elles sont légales, chaînées, référencées par FK, et leur volumétrie (ventes d'un réseau de confiseries) reste gérable en Postgres pur avec de bons index pendant des années.

Le besoin time-series réel (dashboards CA/jour, tendances, occupancy, Analytik R) se traite sur des **données dérivées, reconstructibles**, jamais sur le ledger.

## 3. Options par ordre de risque croissant

### Option A — Postgres pur optimisé (recommandée tant que < ~50 M lignes/table)
- Index **BRIN** sur `integration_events(occurred_at)` et `customer_visits(visited_at)` (quasi gratuit, excellent pour les scans par plage temporelle).
- Vues matérialisées `daily_store_ca`, `daily_product_units` rafraîchies par cron (le code d'agrégation existe déjà : `product-analytics.service`, prouvé P274).
- Purge applicative de `integration_events` `published` au-delà de N jours (métadonnées de livraison — PAS un registre légal ; les faits restent dans `sales`/`audit_entry`).
- ✅ Zéro nouvelle dépendance, zéro impact idempotence, réversible trivialement. **Aucun GO nécessaire sauf la migration d'index (additive).**

### Option B — Table analytique dédiée en hypertable (si Timescale voulu)
- Nouvelle table `analytics_events (ts timestamptz, event_id uuid, store_id, type, payload)` **alimentée par le consommateur outbox** (le `ReferenceConsumer` P249 dédupe par `event_id` AVANT insertion → l'hypertable peut vivre avec `PRIMARY KEY (ts, event_id)` sans porter l'idempotence).
- Propriétés : données **reconstructibles** depuis `integration_events`/`sales` (droppable sans risque), rétention/compression Timescale libres, continuous aggregates pour les dashboards.
- Le ledger et l'outbox restent intouchés → idempotence intacte.
- Prérequis : extension `timescaledb` sur l'instance (⚠️ **Neon ne la propose pas** — il faudrait un Postgres autogéré/cloud compatible pour CETTE base analytique, ou la coloc sur le compose docker).

### Option C — Convertir `integration_events` en hypertable (❌ REJETÉE)
PK composite obligatoire → rupture d'idempotence du contrat push/pull + réécriture des consommateurs keyset. Le gain (rétention par chunks) est obtenable par la purge applicative de l'option A. Ne pas faire.

## 4. Séquence si GO sur l'option B (chaque étape réversible)

1. Migration additive : créer `analytics_events` en table Postgres NORMALE (pas hypertable) + brancher le consommateur (dédup event_id) → prouver le flux en recette.
2. Vérifier l'extension sur l'instance cible (`CREATE EXTENSION timescaledb` — droits requis).
3. `SELECT create_hypertable('analytics_events','ts', migrate_data => true)` en fenêtre calme (table encore petite).
4. Continuous aggregates (CA/jour/magasin, unités/produit/jour) + politique de rétention brute (ex. 13 mois) — les agrégats se conservent.
5. Rollback à tout moment : les données sont dérivées → drop et re-consommation depuis l'outbox/ledger.

## 5. Critères de GO (à fournir avant toute exécution)

- Volumétrie réelle constatée (lignes/jour sur `integration_events` et `sales` en cible) justifiant plus que l'option A.
- Choix d'hébergement compatible extension (Neon = non).
- GO écrit explicite ; exécution hors sandbox avec `DATABASE_URL` cible ; backup préalable (`docker/backup.sh` / PITR).
