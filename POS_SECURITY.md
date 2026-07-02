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
| S2 | Clés API dans historique git | 🟠 **DÉSAMORCÉ localement (P354)** — révocation console RESTANTE | Fuite confirmée P332 (2 clés réelles dans `f2ad1b5`, toujours dans l'historique). **P354 (2026-07-02)** : les 2 valeurs compromises RETIRÉES de `packages/backend/.env` (0 occurrence dans tout l'arbre de travail, vérifié) ; Google Maps désactivé volontairement (décision utilisateur, CB requise) — mode no-key testé (external-context fail-safe 4 tests) ; nouvelle clé PRIM régénérée par l'utilisateur, à poser dans `.env` par lui seul. **Restant** : ① RÉVOQUER les 2 anciennes clés en console (PRIM + Google Cloud) — seule action qui neutralise l'historique ; ② Railway si les variables y existent. |
| S3 | Receipts publics sans auth | 🟠 | exiger auth sur `/api/receipts/:id` |
| S4 | XSS receipts HTML (échappement) | ✅ résolu | `escapeHtml` testé (5/5) appliqué à tous les champs du reçu (`receipts.controller`) |
| S5 | Erreurs avalées front (StockAlerts, Labels) | 🟠 | remonter erreurs UI |
| S6 | Redis "unknown" prod (revocation multi-instance) | 🟠 | `REDIS_URL` |

## Règle de preuve

Aucun point de sécurité n'est marqué "résolu" sans : (a) commit identifié, (b) test associé vert. Sinon → "À VÉRIFIER".
