# POS_SECURITY.md — Sécurité (vérifié 2026-06-28)

> Règles immuables reprises de CLAUDE.md + points d'audit à re-vérifier.

## Règles immuables (CLAUDE.md)

1. Jamais de secret en clair commité ; `.env.example` placeholders uniquement ; vrais `.env` en `.gitignore`.
2. `JWT_SECRET` / `JWT_REFRESH_SECRET` ≥ 32 chars, distincts.
3. JWT : pas de `aud` dans le payload, uniquement `audience` en options.
4. Pas de cutover DNS / régénération JWT sans GO explicite.
5. Backend A (`api.addxintelligence.com`) **intouchable**.
6. Pas de changement Cloudflare/Railway sans GO.

## Mécanismes en place (vérifié)

- RBAC `roles.guard.ts` (admin>manager>cashier), `jwt-auth.guard.ts`.
- Multi-tenant `tenant.interceptor.ts` (storeId du JWT, blocage cross-store).
- Audit hash-chain append-only (`audit`, `fiscal`).
- Validation env au boot (`main.ts`).

## Points à re-vérifier (issus AUDIT-FINAL avril — statut À VÉRIFIER)

| # | Point | Sévérité | Action |
|---|---|---|---|
| S1 | PIN login 500 prod | 🔴 | re-tester `POST /api/auth/login/pin` |
| S2 | Clés API potentiellement dans historique git (`docker/.env.production.example`) | 🔴 | scanner historique ; rotation si confirmé |
| S3 | Receipts publics sans auth | 🟠 | exiger auth sur `/api/receipts/:id` |
| S4 | XSS receipts HTML (échappement) | 🟠 | échapper noms produits/employés/magasins |
| S5 | Erreurs avalées front (StockAlerts, Labels) | 🟠 | remonter erreurs UI |
| S6 | Redis "unknown" prod (revocation multi-instance) | 🟠 | `REDIS_URL` |

## Règle de preuve

Aucun point de sécurité n'est marqué "résolu" sans : (a) commit identifié, (b) test associé vert. Sinon → "À VÉRIFIER".
