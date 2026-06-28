# POS_TEST_PLAN.md — Plan de tests (vérifié 2026-06-28)

## État réel des tests

- Backend : **66 fichiers `*.spec.ts`**, **~488 cas** (`it(`/`test(`). Runner : Jest + ts-jest + pg-mem (helper `test/helpers/pgmem`).
- `bcrypt` natif rebuild Linux effectué pour permettre l'exécution dans le sandbox.
- Vérifié vert : suite **money → 9/9 PASS**. Streaming de la suite complète : PASS observés, aucun FAIL avant coupure.
- ⚠️ **Suite complète non confirmée verte ici** (limite 45 s/commande + coût ts-jest). À exécuter sur machine sans limite : `npm run test:backend`.
- Front / e2e Playwright (`pos-desktop/e2e`, `playwright.config.ts`) / build desktop : **non lancés**.

## Suites clés (présentes, vérifié)

`sales.service.idempotency.spec.ts`, `sales.service.audit.spec.ts`, `sales.service.store-credit.spec.ts`, `coupon.service.spec.ts`, `returns.service.spec.ts`, `circuit-breaker.spec.ts`, `stripe-terminal.service.spec.ts`, `units.service.spec.ts`, `price-verdict.spec.ts`, `sales-trend.util.spec.ts`, `e2e-money-flow.spec.ts`, + fiscal/audit/tenant suites.

## À chaque paquet de 5 blocs — tests adaptés

- [ ] lint (`npm run lint`)
- [ ] typecheck / build (`npm run build:backend`)
- [ ] tests unitaires backend ciblés (specs des blocs)
- [ ] tests intégration / API (si routes touchées)
- [ ] tests RBAC/sécurité (si gardes touchés)
- [ ] tests offline (si dispo)
- [ ] tests paiement simulé (mock)
- [ ] build web/desktop (si concerné)

## Dettes de test identifiées

- `TD-OFFLINE-TESTS` — couverture offline auto à confirmer/créer.
- `TD-PAYMENT-TESTS` — étendre tests paiement simulé (mixtes, différé).
- `TD-FULL-SUITE-CI` — garantir suite complète verte en CI (hors sandbox 45 s).
- `TD-FRONT-TESTS` — couverture front backoffice/POS à mesurer.
