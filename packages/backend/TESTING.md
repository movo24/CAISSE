# Backend — Test & CI Guide

> Établi et prouvé lors de l'audit POS-INT-120→125. Chiffres mesurés en sandbox
> (2026-06-30). Les commandes ci-dessous sont l'ordre d'exécution recommandé en CI.

## Vue d'ensemble

| Groupe | Emplacement | DB requise | Commande | Mesuré |
|---|---|---|---|---|
| Unitaires + logique | `src/**/*.spec.ts` | non | `--maxWorkers=2` | 129 suites / 862 tests ✅ |
| Intégration in-memory | `test/*.spec.ts` (pg-mem) | non (pg-mem) | `--runInBand` | 20 suites / 164 tests ✅ |
| E2E Postgres | `test/*.pg.spec.ts` | **oui** (`TEST_DATABASE_URL`) | `--runInBand` + DB | **auto-skip** si non défini |

Total exécutable sans Postgres : **149 suites / 1026 tests**. Les 2 suites `.pg`
se **skippent proprement** quand `TEST_DATABASE_URL` est absent (vérifié : 2
skipped / 3 tests skipped) — donc une CI sans Postgres reste **verte avec skips**,
jamais rouge.

## Commandes

### 1. Unitaires (`src/**`) — rapides, sans DB
```bash
cd packages/backend
npx jest --roots src --maxWorkers=2
```
- `--maxWorkers=2` : au-delà, des suites qui bootent un module Nest peuvent
  flaker par contention CPU/mémoire (timeouts), pas un défaut de code.

### 2. Intégration in-memory (`test/`, hors `.pg`) — pg-mem
```bash
npx jest --roots test --testPathIgnorePatterns '\.pg\.spec\.ts$' --runInBand
```
- `--runInBand` obligatoire : chaque suite démarre un `DataSource` pg-mem +
  modules ; en parallèle elles saturent (TD-TEST-DB-SERIAL).

### 3. E2E Postgres (`*.pg.spec.ts`) — Postgres réel requis
```bash
# Prérequis : un Postgres joignable + DATABASE_URL exporté
docker run -d --name caisse-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"
npx jest --roots test --testMatch '**/*.pg.spec.ts' --runInBand
```

## Détails d'environnement (gates connus)

- **bcrypt natif** — le binaire `bcrypt_lib.node` est compilé par plateforme.
  En CI Linux, soit `npm rebuild bcrypt`, soit le mock de test est utilisé
  automatiquement : `jest.moduleNameMapper["^bcrypt$"] → test/mocks/bcrypt.mock.ts`
  (mock fidèle : format `$2b$`, sel, round-trip `compare`). Aucune action requise
  pour les tests ; le rebuild n'est nécessaire qu'au runtime applicatif.
- **Redis** — neutralisé en test via `test/jest.setup.ts` (`REDIS_URL=''` →
  cache in-memory). Aucun Redis requis pour les tests.
- **Cache** : `REDIS_URL` non défini ⇒ `InMemoryCacheStore` ; défini ⇒
  `ResilientCacheStore` (Redis + fallback in-memory).

## Qualité / build
```bash
npx tsc --noEmit      # typecheck (EXIT 0 attendu)
npx nest build        # build (RC 0 attendu, ~345 .js)
npm run lint          # ESLint
```

## NF525 / intégrité (rappels couverts par les suites)
- Immuabilité ventes & Z-report, chaîne de hash audit append-only.
- Idempotence des écritures monétaires (clé d'idempotence).
- Outbox d'intégration transactionnel (POS ↔ Comptamax24 ↔ TimeWin24, prep Analytik R).

## CI (GitHub Actions `.github/workflows/ci.yml`)
La CI (ubuntu-latest, Node 20) exécute à chaque push/PR :
1. `npm run lint`
2. `npm run test:backend` (jest backend)
3. `npm run test:backoffice` (vitest — 4 suites front : parseCounts, supervisionVerdict, severity, payroll/export-utils)
4. `npm run test:pos` (vitest — manual-discount-guard, paymentMachine, hmacSecurity, rightsStore, pointageStore)
5. `npm run build:backend` / `build:backoffice` / `build:pos` (tsc --noEmit + vite/nest — installe le binaire rollup Linux natif)

Sur ubuntu, `npm install` récupère `@rollup/rollup-linux-x64-gnu` → `vite build` et `vitest` fonctionnent (contrairement au bac à sable arm64 où le binaire manque, cf. TD-FE-ROLLUP-NATIVE). Les helpers purs front sont aussi prouvés hors CI via `tsc → node` (assertions) à chaque paquet.

## Sécurité auth mobile (Wesley Club)
- `src/modules/mobile-auth/mobile-tokens.spec.ts` : garde le contrat JWT client (audience `mobile-app`, TTL access 15m / refresh 30j, isolation des secrets access/refresh, rejet mauvaise audience, **anti-duplication `aud`** — cf. règle sécurité 5 de CLAUDE.md).
- Total backend courant : 154 suites PASS / 2 skip (156) ; 1072 tests PASS / 3 skip (2 `.pg.spec` = Postgres réel).
