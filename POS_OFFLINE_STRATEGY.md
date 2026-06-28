# POS_OFFLINE_STRATEGY.md — Stratégie offline (vérifié 2026-06-28)

> Architecture cible : **cloud-centrée**, postes POS = fenêtres connectées, secours offline/SIM si nécessaire.

## Existant (vérifié dans le code)

- `pos-desktop/src/renderer/stores/offlineStore.ts` — store état offline.
- `pos-desktop/src/renderer/hooks/useOfflineMode.ts` — détection mode dégradé.
- `pos-desktop/src/renderer/services/syncEngine.ts` — moteur de synchro.
- `pos-desktop/src/renderer/services/cloudSyncIdentity.ts` — identité de synchro.
- Backend `modules/sync` — push/pull, résolution de conflits (à prouver).
- Auth : fallback local DB si TW24 injoignable (selon CLAUDE.md).

## À prouver / à vérifier (non confirmé par tests ici)

1. File d'attente (outbox) durable des ventes offline (IndexedDB/disque) — mécanisme exact à documenter.
2. Rejouabilité **idempotente** de la synchro (clé d'idempotence par vente) pour ne jamais dupliquer une vente lors d'un replay offline → online.
3. Cohérence stock offline ↔ online après reconnexion.
4. Comportement paiement carte hors-ligne (différé) — voir `POS_PAYMENT_STRATEGY.md`.
5. Tests offline automatisés : **présence non confirmée** → dette `TD-OFFLINE-TESTS`.

## Règles

- Une vente offline finalisée doit porter une clé d'idempotence client.
- La synchro ne crée jamais de doublon : réutilise/rejette une clé déjà traitée (cohérent avec `IdempotencyKey`).
- Aucune perte silencieuse : toute vente non synchronisée doit rester visible et retracée.
