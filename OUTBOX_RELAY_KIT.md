# OUTBOX_RELAY_KIT — brancher la publication réelle (TD-INT-RELAY)

> But : quand les secrets seront fournis, activer le relais outbox HTTP **sans redécouverte**.
> Aucune variable ci-dessous n'est inventée : ce sont exactement celles lues par le code.

## 1. Variables à fournir (exactes, lues dans le code)

| Variable | Requise | Lue dans | Effet |
|---|---|---|---|
| `OUTBOX_PUBLISH_URL` | OUI | `modules/integration/outbox-publisher.ts` (`createOutboxPublisher`) | URL du webhook consommateur (Comptamax24 / TimeWin24 / Analytik R) |
| `OUTBOX_PUBLISH_SECRET` | OUI | idem | Secret HMAC-SHA256 partagé (signature `x-pos-signature`) |
| `OUTBOX_RELAY_ENABLED` | OUI pour le cron | `modules/integration/outbox-relay.cron.ts` (`isRelayCronEnabled`) | `true` ou `1` → active le cron de relais automatique |

Règles de sécurité **déjà prouvées par tests** (`outbox-publisher.spec.ts`, `outbox-relay.spec.ts`) :
- Publisher = **simulation** tant que `URL` **ET** `SECRET` ne sont pas tous deux présents (config partielle ou vide → jamais d'activation accidentelle).
- Cron **désactivé** tant que `OUTBOX_RELAY_ENABLED` ≠ `true`/`1`.

## 2. Contrat de livraison (déjà implémenté + testé loopback P171)
- POST `OUTBOX_PUBLISH_URL`, corps = enveloppe JSON canonique (`publishEnvelope`).
- En-têtes : `content-type: application/json`, `x-pos-event-id`, `x-pos-timestamp`, `x-pos-signature` (HMAC-SHA256 sur `${timestamp}.${body}`).
- Le receveur vérifie via `verifyPublishSignature` (fenêtre de fraîcheur 5 min = anti-rejeu).
- 2xx → `published` ; non-2xx → retry (backoff exponentiel, cap 5 tentatives → dead-letter `failed`).

## 3. Procédure d'activation (à exécuter QUAND les secrets sont dispo — pas avant)
```bash
# 1. Définir les 3 variables sur l'environnement cible (jamais commitées) :
export OUTBOX_PUBLISH_URL="https://<consumer>/webhook/pos"
export OUTBOX_PUBLISH_SECRET="<secret partagé fourni par le consommateur>"
export OUTBOX_RELAY_ENABLED="true"

# 2. Vérifier que la factory bascule bien en HTTP (sans envoyer) :
cd packages/backend && npx jest src/modules/integration/outbox-publisher.spec.ts

# 3. (optionnel) Test bout-en-bout contre un receveur de recette AVANT prod.
# 4. Redéploiement backend (voir RUNBOOK.md).
```

## 4. Critères de succès / rollback
- Succès : `GET /api/integration/outbox/stats` montre `published` qui croît, `failed` = 0.
- Rollback immédiat : `OUTBOX_RELAY_ENABLED=false` (ou retirer URL/SECRET) → retour en simulation, aucune donnée perdue (outbox persistée).

## 5. Ce qui reste bloqué ici
- Fournir `OUTBOX_PUBLISH_URL` + `OUTBOX_PUBLISH_SECRET` réels (secrets — hors sandbox).
- Sans eux : simulation seule (comportement prouvé). Aucune autre inconnue.
