# AUDIT_INTEGRATIONS_COMPLETE — Audit des connexions & intégrations POS CAISSE

> **Date** : 2026-07-10 · **Base** : `main` @ `6238350` (arbre propre) · **Méthode** : lecture du code réel
> (backend, 4 fronts, workflows, infra), 7 cartographies parallèles par domaine avec preuves `fichier:ligne`,
> **contre-vérification manuelle** des constats critiques. **Aucune mutation, aucun workflow déclenché,
> aucune correction** (phase constats). Détails : `INTEGRATION_MATRIX.md`, `API_CONNECTION_MAP.md`,
> `INTEGRATION_GAPS.md`, `INTEGRATION_REMEDIATION_PLAN.md`.

---

## 1. Verdict exécutif — notes sur 100

| Domaine de connexion | Note | Résumé |
|---|---|---|
| Fronts ↔ backend (transport/auth) | **72** | Refresh robuste, audiences séparées, customer-app impeccable ; mais 3 clients cross-origin (CORS sensible) + 2 endpoints POS morts (404) |
| Backend ↔ PostgreSQL | **88** | Pool, migrations auto, 503 si down ; retry/SSL non forcés côté app |
| Backend ↔ Redis | **58** | Cache + realtime OK avec fallback ; throttler & occupancy **pas** sur Redis malgré la doc |
| Backend ↔ Stripe / WisePad 3 | **82** | SDK réel, capture serveur prouvée (9 specs), webhook billing signé ; refund carte absent, pas de webhook caisse |
| CI ↔ Railway | **65** | Workflow deploy complet et défensif ; exécution non prouvée sur disque ; deploy manuel structurel |
| Railway ↔ IONOS / DNS | **55** | Outillage cutover prêt et gaté ; bloqué sur clé IONOS ; checklist doc fausse |
| POS ↔ TimeWin24 | **50** | Shift reminders/fin-shift solides ; **sync magasins destructif non testé** ; doctrine employés incohérente |
| POS ↔ Comptamax24 / Analytik R | **10** | Zéro code — prévu par doctrine, aucun mécanisme d'export réel |
| Intégrations sortie (Airtable/mail/alertes) | **70** | Réelles avec dégradation gracieuse ; Airtable dormant par design |
| Desktop Electron (IPC/OS/hardware) | **68** | Printing + customer-display complets et honnêtes ; tiroir/wedge/signature absents (assumés) |
| Offline sync | **62** | File + idempotency solides ; HMAC device et détection conflits = stubs |

**Note globale pondérée : ~63/100.** Les connexions **critiques pour encaisser** (backend↔PG, capture carte,
auth, backoffice same-origin) sont solides ; les **intégrations externes et l'exploitation multi-magasin/DNS**
sont fragiles ou dormantes. Un risque prod destructif (sync TW24) et deux 404 POS ressortent nettement.

## 2. Connexions validées (extrait — détail dans INTEGRATION_MATRIX.md)

| Connexion | Preuve | Test |
|---|---|---|
| Capture carte vérifiée serveur (jamais payé sans capture) | `sales.service.ts:161-218` | `card-capture-verify.spec.ts` (9) |
| WisePad 3 réel (connection-token → SDK Terminal) | `useStripeTerminal.ts:138-307` | `cardPaymentMode.test.ts` |
| Webhook Stripe billing signé + dédup | `stripe-billing.service.ts:133-165` | mockable |
| PostgreSQL pool + migrations auto + 503 si down | `app.module.ts:69-87`, `health.controller.ts:47-60` | boot réel (PR #40) |
| Redis cache/realtime avec fallback + circuit-breaker | `cache-store.ts:125-397`, `realtime.service.ts:45-93` | résilience |
| Séparation audience staff / `mobile-app` | `mobile-auth.guard.ts:33-40` | routes matchées |
| Customer-app ↔ backend (100 % routes, stockage natif) | `customer-app/src/services/api.ts` | — |
| Auth local-first + fallback TW24 | `auth.service.ts:127-171` | `auth.service.spec.ts:86-173` |
| Shift reminders / fin-shift TW24 (probant) | `shift-reminder.service.ts`, `pos-session.service.ts:295-318` | 2 specs |
| IPC desktop printing + customer-display honnête | `posPrinting.ts:25-58`, `customerDisplay.ts:406-432` | `printHonesty.test.ts` |
| Idempotency offline sync | `syncEngine.ts:135-149` | `idempotency.test.ts` |

## 3. Connexions partielles (extrait — INTEGRATION_GAPS.md §🟠)

CORS cross-origin (I8), base URL prod sur CNAME non basculé (I7), refund carte non exécuté (I9), PI orphelins
(I10), HMAC device stub (I11), conflits sync stub (I12), doctrine employés TW24 (I13), HMAC/Bearer piège (I14),
timeout 15 s uniforme (I18), env incohérentes (I19).

## 4. Connexions cassées / absentes (INTEGRATION_GAPS.md §🔴/⚫)

- 🔴 **I1 Sync magasins TW24 destructif** (liste vide → tout désactivé) — contre-vérifié `stores.service.ts:390-399`.
- 🔴 **I2/I3 POS 404** : `/api/weather/*` (aucun contrôleur) et `/api/occupancy/:storeId/weather` (route supprimée) — contre-vérifiés.
- 🔴 **I4 Backoffice create/update produit** — **corrigé par PR #46 (R1)**.
- 🔴 **I5 Throttler mémoire** malgré doc « Redis » — contre-vérifié `app.module.ts:90`.
- 🔴 **I6 Douchette wedge** code mort.
- ⚫ Comptamax24, Analytik R, refund carte Stripe, webhook caisse, import employés TW24, tiroir desktop, signature .exe, SMS.

## 5. Détections demandées — réponses

| Cible | Réponse |
|---|---|
| APIs présentes mais jamais appelées | `products/:id/price-history`, `products/:id/generate-barcode` (barcode SVG local), payroll/getEmployeeContext/getStoreConfig TW24, connected-apps (registre sans moteur) |
| Écrans avec mocks/données fictives | **Aucun** — les 4 fronts consomment l'API réelle (grep mock/fake ⇒ tests + commentaires anti-faux-ticket seulement) |
| Endpoints morts | POS `weatherApi.*`, `occupancyApi.getWeather` → 404 (routes inexistantes/supprimées mais appelées) |
| Variables d'env incohérentes | `ALLOW_INMEMORY_CACHE` non documenté ; `CORS_ORIGIN` doc≠code ; PORT 3001 vs 8080 ; workspace Railway nommée différemment |
| Erreurs CORS | risque réel pour POS/mobile/customer-app (cross-origin absolu) si `CORS_ORIGIN` incomplet |
| Tokens/permissions | Bearer + refresh OK ; cookie refresh jamais transmis (pas de `withCredentials`) ; audiences séparées ✅ |
| Timeouts | 15 s uniforme, inadapté aux exports/PDF lourds |
| Absence d'idempotence | ventes/scan idempotents ; **`sync.push stockAdjustments` non idempotent** (déjà dans l'audit produits) |
| Synchro offline fragile | HMAC device stub, détection conflits stub |
| Incompatibilités schéma front↔backend | backoffice create/update produit (R1, corrigé) ; mobile create = déjà aligné |
| Services déployés mais non reliés | connected-apps (coquille), payroll/context TW24, météo (migrée sans consommateur) |
| Connexions local-only | fallbacks localhost (dev only), aucun localhost en chemin prod réel |
| Intégrations annoncées non branchées | Comptamax24, Analytik R, refund carte, SMS notifications, HMAC device sync |

## 6. Conclusion

**Les connexions du cœur transactionnel sont fiables** (base de données, capture carte vérifiée serveur,
auth, backoffice same-origin, terminal WisePad 3, webhook billing signé). **Les intégrations périphériques et
l'exploitation multi-magasin/DNS sont le point faible.**

**Les cinq risques les plus dangereux** :
1. **I1** — la synchro magasins TimeWin24 peut **désactiver tout le réseau** sur une réponse vide (non testée).
2. **I7/I8** — les fronts POS/mobile/customer-app dépendent d'un CNAME **non basculé** + d'un `CORS_ORIGIN` complet ; un écart = fronts hors service.
3. **I9/I10** — remboursement carte non exécuté via Stripe + PI capturés orphelins non réconciliés → écarts d'argent silencieux.
4. **I2/I3** — 404 systématiques au démarrage POS (météo) — bruit et dépendances mortes.
5. **I5** — rate-limit annoncé « Redis/multi-instance » mais réellement en mémoire → protection illusoire en multi-pod.

**Intégrations réellement câblées et sûres aujourd'hui** : PostgreSQL, Stripe (terminal + billing), Airtable
(dormant), mail reçus, alertes Slack/Discord, TimeWin24 (login/shift-reminders), IPC desktop printing.
**À NE PAS considérer comme opérationnel** : Comptamax24 et Analytik R (zéro code), refund carte, notifications
SMS/push, import employés TW24, HMAC device sync, signature .exe.

**Pourcentage des connexions réellement prêtes** : **~63 %**.
**Blocs restant à livrer** : **9 blocs** (N1–N9, dont N1/N7/N8/N9 sous gate Tier-2) + **5 décisions** (D-I…D-V).

> Correction déjà engagée en parallèle : **PR #46 (GO R1)** répare l'écran produit backoffice (I4) — front only,
> tests API+UI, 64 tests verts. Aucune autre correction n'est engagée sans GO sur ce verdict.
