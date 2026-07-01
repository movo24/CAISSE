# POS_PUSH_CONTRACT.md — Contrat d'intégration push POS Caisse → systèmes tiers

> Version 1 (`schemaVersion: 1`) — 2026-07-02 (bloc A3, P283).
> **Gelé par test** : `src/modules/integration/wire-contract.spec.ts` échoue si ce contrat change sans bump de version.
> Consommateurs cibles : Comptamax24, TimeWin24, Analytik R, ou toute caisse/receveur tiers.
> Prérequis d'activation : GATE 1 (`OUTBOX_PUBLISH_URL` + `OUTBOX_PUBLISH_SECRET`, puis `OUTBOX_RELAY_ENABLED=true`) et GATE 2 (migration 1725 sur la base cible — crée `integration_events`).

## 1. Modèle : outbox transactionnel, push par événement

POS Caisse écrit chaque fait métier dans la table `integration_events` **dans la même transaction** que l'opération métier (vente, retour, session, stock, Z-report). Un relais hors-chemin-caisse (`OutboxRelayService`, cron gated ou déclenchement admin) publie ensuite les événements `pending`/`failed` vers le receveur HTTP. **Le chemin de vente n'attend jamais le réseau.**

La livraison est **par événement** (1 POST = 1 événement). Il n'y a pas d'enveloppe de lot : l'idempotence est portée par l'`event id`, pas par un lot — un `batch_id` de corrélation existe en header pour le debug (voir §3).

## 2. Enveloppe (body JSON, ordre des clés stable)

| Clé | Type | Correspondance demandée | Description |
|---|---|---|---|
| `id` | uuid | **event_id** | Id unique de l'événement, généré côté POS dans la transaction. **Clé d'idempotence du receveur.** |
| `type` | string | — | Catalogue §5. |
| `aggregateType` | string | — | `sale`, `credit_note`, `pos_session`, `product`, `z_report`… |
| `aggregateId` | string | **ticket_id** (pour `sale.*`) | Id de l'objet métier (vente/ticket, avoir, session…). |
| `storeId` | string | **store_id** | Magasin émetteur. |
| `organizationId` | string\|null | — | Organisation (résolue via hiérarchie). |
| `terminalId` | string\|null | **terminal_id** | Terminal émetteur quand applicable. |
| `occurredAt` | ISO 8601 UTC | **ts** | Horodatage métier (timestamptz en base). |
| `payload` | object | — | Données métier figées (montants en **centimes entiers**, valeurs NF525 verbatim, jamais recalculées). |
| `schemaVersion` | int | — | Version du contrat (actuel : 1). Le consommateur **ignore** les versions > à celle qu'il connaît (forward-compat testée, `consumer-contract.ts`). |
| `source` | string | — | `pos-caisse`. |

Champs additionnels en base non exposés dans l'enveloppe : `employee_id`, `actor_role` (audit interne).

## 3. Transport & authentification

- `POST {OUTBOX_PUBLISH_URL}` avec headers :
  - `content-type: application/json`
  - `x-pos-event-id` : = `id` (dédup possible sans parser le body)
  - `x-pos-timestamp` : epoch ms de l'envoi (≠ `occurredAt` : c'est l'horodatage de livraison)
  - `x-pos-signature` : **HMAC-SHA256 hex** de `` `${x-pos-timestamp}.${body}` `` avec le secret partagé
  - `x-pos-batch-id` (optionnel) : **batch_id** de corrélation = id du run de relais (uuid). Debug/groupement uniquement ; **jamais** une clé d'idempotence ; n'entre pas dans la signature.
- Vérification côté receveur : `verifyPublishSignature(body, sig, secret, ts)` (fournie dans `publish-request.ts`, réutilisable) — comparaison temps-constant + **fenêtre anti-rejeu 5 min** (`stale` au-delà). Résultats : `ok | bad_signature | stale | malformed`.

## 4. Sémantique d'erreur, retry, idempotence

| Côté | Règle |
|---|---|
| Succès | Toute réponse **2xx** → événement marqué `published` (`published_at` figé). |
| Échec | Non-2xx, timeout (10 s) ou exception → réessai. |
| Retry | Backoff exponentiel `1s·2^attempts`, plafonné 1 h ; **5 tentatives max** (`MAX_RELAY_ATTEMPTS`). |
| Dead-letter | Au-delà de 5 : statut `failed` définitif — visible via `GET /api/integration/outbox/stats`, réarmable manuellement. |
| Idempotence receveur | **Dédupliquer sur `id`** (= `x-pos-event-id`). Un retry renvoie le MÊME id avec un `x-pos-timestamp`/signature/batch différents. Répondre 2xx sur un doublon déjà traité (ack idempotent). |
| Ordre | Publication FIFO par `created_at`, mais l'ordre n'est **pas garanti** bout-en-bout (retries). Le consommateur ordonne par `occurredAt` + `id` (curseur keyset fourni par l'API pull, cf. §6). |
| Immutabilité | Seules les métadonnées de livraison (`status`, `attempts`, `published_at`) changent ; les champs métier sont append-only. |

## 5. Catalogue d'événements (v1 — gelé par `consumer-contract.ts`, garde de synchro testée)

`sale.created` · `sale.completed` · `sale.voided` · `payment.captured` · `credit_note.issued` · `cash_session.opened` · `cash_session.closed` · `employee_activity.recorded` · `stock.movement` · `stock.low` · `stock.depleted`

(11 types — le Z-report est publié comme `cash_session.closed` par `reports.service`/`cash-session-events.ts`, il n'existe **pas** de type `z_report.*` distinct.)

Émetteurs branchés (preuve : `grep toOutboxRow`) : `sales.service`, `returns.service`, `pos-session.service`, `stock.service`, `reports.service`. Tout type émis non déclaré fait échouer la garde de synchro (spec).

## 6. Alternative pull (déjà livrée)

Pour un consommateur qui préfère tirer : `GET /api/integration/events?since=<cursor>&type=&limit=` — keyset `occurredAt|id` strict (aucune perte/doublon, prouvé pg-mem P271), scope tenant, + `GET /api/integration/outbox/stats`. Un `ReferenceConsumer` idempotent et résumable est fourni (`consumer-contract.ts`, 15 tests).

## 7. Ce qui manque encore pour brancher une vraie caisse (honnête)

1. **GATE 1** — secrets receveur (`OUTBOX_PUBLISH_URL`/`OUTBOX_PUBLISH_SECRET`) + `OUTBOX_RELAY_ENABLED=true`. Sans eux : `SimulationOutboxPublisher` (aucun envoi réel, fail-closed).
2. **GATE 2** — migration `1725-AddIntegrationOutbox` sur la base cible (la table n'existe pas encore en cible).
3. Un receveur de recette pour la preuve end-to-end (`published` croît) — kit : `OUTBOX_RELAY_KIT.md`.
4. Décision consommateur : mode push (ce contrat) ou pull (§6) par système.
